import fetch from "node-fetch";
import { compile } from "../../emulator/compiler.js";
import { Console_IO } from "../../emulator/devices/console-io.js";
import { Emulator, Step_Result } from "../../emulator/emulator.js";
import { parse } from "../../emulator/parser.js";
import { expand_warnings, registers_to_string } from "../../emulator/util.js";
import { parse_argv } from "../args.js";
import Canvas from "canvas"
import { Color_Mode, Display } from "../../emulator/devices/display.js";
import { URCL_Header } from "../../emulator/instructions.js";

const emus: Map<any, ReturnType<typeof discord_emu>> = new Map();

function get_emu(id: unknown){
    let emu = emus.get(id);
    if (!emu){
        emu = discord_emu();
        emus.set(id, emu);
    }
    return emu;
}

export function emu_start(id: unknown, argv: string[], source?: string){
    const emu = get_emu(id);
    return emu.start(argv, source);
}

export function emu_reply(id: unknown, msg: string){
    const emu = get_emu(id);
    return emu.reply(msg);
}
export function emu_stop(id: unknown) {
    let emu = emus.get(id);
    if (!emu){
        return "There is not emulator running for this channel";
    }
    return emu.stop();
}
const max_time = 1000;

function discord_emu(){
    let running = false;
    let busy = false;
    let stdout = "";
    let std_info = "";
    let text_cb: undefined | (()=>void);
    
    const emulator = new Emulator({on_continue});
    let display: Display = new Display(Canvas.createCanvas(1,1).getContext("2d"), 8, Color_Mode.PICO8, true)
    
    const console_io = new Console_IO({
        read(callback){
            text_cb = callback;
        },
        text: "",
        }, 
        (text) => {stdout += text;},
        () => {/*nothing todo here program is only executed ones*/}
    );
    emulator.add_io_device(console_io);


    const pub = {start, stop, reply};

    return pub;
    
    function on_continue(){
        try {
            const res = emulator.run(max_time);
            switch (res){
                case Step_Result.Continue: {
                    std_info += `\nProgram took more than ${max_time}ms and is paused.\n`
                        + "Continue the program by sending a ?";
                } break;
                case Step_Result.Input: {
                    std_info += "\nSend a message starting with ? to input\n";
                } break;
                case Step_Result.Halt: {
                    std_info += "\nProgram Halted!\n";
                    running = false;
                } break;
                default: {
                    throw new Error("\nunknown step result");
                }
            }
        } catch (e) {
            std_info += `[ERROR]: ${e}`
            running = false;
        }
        std_info += "\nregisters:\n" + registers_to_string(emulator);
    }
    function o(){
        const out = stdout;
        const info = std_info;
        const screens = display.buffers.slice();
        stdout = "";
        std_info = "";
        display.buffers.length = 0;
        return {out, info, screens};
    }
    function start(argv: string[], source?: string){
        if (busy){
            std_info += "Emulator is still busy loading the previous program";
            return o();
        }
        busy = true;
        const res = _start(argv, source);
        res.then(()=>busy=false).catch(()=>busy=false);
        return res;
    }
    async function _start(argv: string[], source?: string) {
    try {
        stdout = "";
        const {args, flags: {__width, __height, __color}} = parse_argv(["",...argv], {
            __storage: "",
            __storage_size: 0,
            __width: 32,
            __height: 32,
            __color: {val: Color_Mode.PICO8, in: Color_Mode}
        });
        const file_name = args[0]
        let s_name: undefined | string;
        if (!(source?.length)){
            if (file_name === undefined){
                std_info += `ERROR: no source specified`
                return o();
            }
            source = await (await fetch(file_name)).text();
            s_name = file_name.split("/").at(-1);
        }
        const code = parse(source);
        if (code.errors.length > 0){
            std_info += "ERRORS:\n"
                + expand_warnings(code.errors, code.lines, s_name)
                + "\n------------------------------\n";
        }
        if (code.warnings.length > 0){
            std_info += "warnings:\n"
                + expand_warnings(code.warnings, code.lines, s_name);
                + "\n------------------------------\n";
        }
        if (code.errors.length > 0){
            return o();
        }
        const [program, debug_info] = compile(code);
        emulator.load_program(program, debug_info);
        
        const canvas = Canvas.createCanvas(__width, __height);
        const ctx = canvas.getContext("2d", {alpha: false});
        display = new Display(ctx, program.headers[URCL_Header.BITS].value, __color.val, true);
        emulator.add_io_device(display);

        running = true;
        on_continue();
        return o();
    } catch (e){
        std_info += `\nERROR: ${e}`
        return o();
    }
    }
    function reply(msg: string) {
    try {
        if (!running){
            std_info += `No Program running`;
            return o();
        }
        if (!text_cb){
            std_info += "Continuing program without adding input";
            on_continue();
            return o();
        }
        console_io.input.text += msg;
        const cb = text_cb;
        text_cb = undefined;
        cb();
        return o();
    } catch (e){
        std_info += `\nERROR: ${e}`
        return o();
    }
    }
    function stop(): string {
        return "not implemented";
    }
}

