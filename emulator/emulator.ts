import { Word, Arr, registers_to_string, indent } from "./util.js";
import {Opcode, Operant_Operation, Operant_Prim, Opcodes_operants, Instruction_Ctx, URCL_Header, IO_Port, Register, Header_Run, register_count} from "./instructions.js";
import { Debug_Info, Program } from "./compiler.js";
import { Device, Device_Host, Device_Input, Device_Output, Device_Reset } from "./devices/device.js";

export enum Step_Result {
    Continue, Halt, Input
}

export class Emulator implements Instruction_Ctx, Device_Host {
    public program!: Program;
    public debug_info!: Debug_Info;
    constructor(public on_continue: ()=>void){
    }
    private heap_size = 0;
    load_program(program: Program, debug_info: Debug_Info){
        this.program = program, this.debug_info = debug_info;
        const bits = program.headers[URCL_Header.BITS].value;
        const static_data = program.data;
        const heap = program.headers[URCL_Header.MINHEAP].value;
        const stack = program.headers[URCL_Header.MINSTACK].value;
        const registers = program.headers[URCL_Header.MINREG].value + register_count;
        const run = program.headers[URCL_Header.RUN].value;
        this.heap_size = heap;
        if (run === Header_Run.RAM){
            throw new Error("emulator currently doesn't support running in ram");
        }
        let WordArray;
        if (bits <= 8){
            WordArray = Uint8Array;
            this.bits = 8;
        } else if (bits <= 16){
            WordArray = Uint16Array;
            this.bits = 16;
        } else if (bits <= 32){
            WordArray = Uint32Array;
            this.bits = 32;
        } else {
            throw new Error(`BITS = ${bits} exceeds 32 bits`);
        }
        if (registers >= this.max_value){
            throw new Error(`Too many registers ${registers}, must be <= ${this.max_value}`)
        }
        const memory_size = heap + stack + static_data.length
        if (memory_size > this.max_value){
            throw new Error(`Too much memory heap:${heap} + stack:${stack} = ${heap+stack}, must be <= ${this.max_value+1}`);
        }
        this.registers = new WordArray(this.buffer, 0, registers).fill(0);
        this.memory = new WordArray(this.buffer, registers * WordArray.BYTES_PER_ELEMENT, memory_size).fill(0);

        for (let i = 0; i < static_data.length; i++){
            this.memory[i] = static_data[i];
        }

        this.reset();
    }
    reset(){
        this.stack_ptr = this.memory.length;
        this.pc = 0;
        for (const reset of this.device_resets){
            reset();
        }
    }
    buffer = new ArrayBuffer(1024*1024*512);
    registers: Arr & {byteLength: number, byteOffset: number, [Symbol.iterator](): IterableIterator<number> } = new Uint8Array(32);
    memory: Arr & {byteLength: number, byteOffset: number} = new Uint8Array(256);
    get pc(){
        return this.registers[Register.PC];
    }
    set pc(value: Word){
        this.registers[Register.PC] = value;
    }
    get stack_ptr(){
        return this.registers[Register.SP];
    }
    set stack_ptr(value: Word){
        this.registers[Register.SP] = value;
    }
    bits = 8;
    private device_inputs: {[K in IO_Port]?: Device_Input} = {};
    private device_outputs: {[K in IO_Port]?: Device_Output} = {};
    private device_resets: Device_Reset[] = [];
    public add_io_device(device: Device){
        if (device.inputs){
            for (const port in device.inputs){
                const input = device.inputs[port as any as IO_Port] as Device_Input;
                this.device_inputs[port as any as IO_Port] = input.bind(device);
            }
        }
        if (device.outputs){
            for (const port in device.outputs){
                const output = device.outputs[port as any as IO_Port] as Device_Output;
                this.device_outputs[port as any as IO_Port] = output.bind(device);
            }
        }
        if (device.reset){
            this.device_resets.push(device.reset.bind(device));
        }
    }
    

    get max_value(){
        return 0xff_ff_ff_ff >>> (32 - this.bits);
    }
    get max_signed(){
        return (1 << (this.bits-1)) - 1;
    }
    get sign_bit(){
        return (1 << (this.bits-1));
    }
    push(value: Word): void {
        if (this.stack_ptr <= this.heap_size){
            this.error(`Stack overflow: ${this.stack_ptr} <= ${this.heap_size}}`);
        }
        this.memory[--this.stack_ptr] = value;
    }
    pop(): Word { 
        if (this.stack_ptr >= this.memory.length){
            this.error(`Stack underflow: ${this.stack_ptr} >= ${this.memory.length}`);
        }
        return this.memory[this.stack_ptr++];
    }
    in(port: Word, target: Arr<Word>): boolean {
        const device = this.device_inputs[port as IO_Port];
        if (device === undefined){
            this.warn(`unsupported input device port ${port} (${IO_Port[port]})`);
            return false;
        }
        const res = device(this.finish_step_in.bind(this));
        if (res === undefined){
            return true;
        } else {
            target[0] = res as number;
            return false;
        }
    }
    out(port: Word, value: Word): void{
        const device = this.device_outputs[port as IO_Port];
        if (device === undefined){
            this.warn(`unsupported output device port ${port} (${IO_Port[port]})`);
            return;
        }
        device(value);
    }
    run(max_duration: number): Step_Result {
        const burst_length = 128;
        const end = Date.now() + max_duration;
        do {
            for (let i = 0; i < burst_length; i++){
                const res = this.step();
                if (res !== Step_Result.Continue){
                    return res;
                }
            }
        } while (Date.now() < end);
        return Step_Result.Continue;
    }
    step(): Step_Result {
        const pc = this.pc++;
        if (pc >= this.program.opcodes.length){return Step_Result.Halt;}
        const opcode = this.program.opcodes[pc];
        if (opcode === Opcode.HLT){
            return Step_Result.Halt;
        }
        const instruction = Opcodes_operants[opcode];
        if (instruction === undefined){this.error(`unkown opcode ${opcode}`);}
        const [op_operations, func] = instruction;
        const op_types = this.program.operant_prims[pc];
        const op_values = this.program.operant_values[pc];
        const ops = op_operations.map(() => 0);
        let ram_offset = 0;
        for (let i = 0; i < op_operations.length; i++){
            switch (op_operations[i]){
                case Operant_Operation.GET: ops[i] = this.read(op_types[i], op_values[i]); break;
                case Operant_Operation.GET_RAM: ops[i] = this.read_mem(this.read(op_types[i], op_values[i]) + ram_offset); break;
                case Operant_Operation.RAM_OFFSET: ram_offset = this.read(op_types[i], op_values[i]); break;
            }
        }
        if (func(ops, this)) {
            return Step_Result.Input;
        }
        for (let i = 0; i < op_operations.length; i++){
            switch (op_operations[i]){
                case Operant_Operation.SET: this.write(op_types[i], op_values[i], ops[i]); break;
                case Operant_Operation.SET_RAM: this.write_mem(this.read(op_types[i], op_values[i]) + ram_offset, ops[i]); break;
            }
        }
        return Step_Result.Continue;
    }
    write_mem(addr: number, value: number){
        if (addr >= this.memory.length){
            this.error(`Heap overflow on store: ${addr} >= ${this.memory.length}`);
        }
        this.memory[addr] = value;
    }
    read_mem(addr: number){
        if (addr >= this.memory.length){
            this.error(`Heap overflow on load: ${addr} >= ${this.memory.length}`);
        }
        return this.memory[addr];
    }
    // this method only needs to be called for the IN instruction
    finish_step_in(result: Word){
        const pc = this.pc-1;
        const type = this.program.operant_prims[pc][0];
        const value = this.program.operant_values[pc][0];
        this.write(type, value, result);
        this.on_continue();
    }
    write(target: Operant_Prim, index: Word, value: Word){
        switch (target){
            case Operant_Prim.Reg: this.registers[index] = value;return;
            case Operant_Prim.Imm: return; // do nothing
            default: this.error(`Unknown operant target ${target}`);
        }
    }
    read(source: Operant_Prim, value: Word){
        switch (source){
            case Operant_Prim.Imm: return value;
            case Operant_Prim.Reg: return this.registers[value];
            default: this.error(`Unknown operant source ${source}`); 
        }
    }
    error(msg: string): never {
        const {pc_line_nrs, lines, file_name} = this.debug_info;
        const line_nr = pc_line_nrs[this.pc-1];
        throw Error(`${file_name??"eval"}:${line_nr + 1} - ERROR - ${msg}\n    ${lines[line_nr]}\n\n${indent(registers_to_string(this), 1)}`);
    }
    warn(msg: string): void {
        const {pc_line_nrs, lines, file_name} = this.debug_info;
        const line_nr = pc_line_nrs[this.pc-1];
        console.warn(`${file_name??"eval"}:${line_nr + 1} - warning - ${msg}\n ${lines[line_nr]}`);
    }
}
