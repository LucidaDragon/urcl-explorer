import { compile } from "./emulator/compiler.js";
import { Clock } from "./emulator/devices/clock.js";
import { Console_IO } from "./emulator/devices/console-io.js";
import { Color_Mode } from "./emulator/devices/display.js";
import { Gamepad_Key, Pad } from "./emulator/devices/gamepad.js";
import { Gl_Display } from "./emulator/devices/gl-display.js";
import { Emulator, Step_Result } from "./emulator/emulator.js";
import { parse } from "./emulator/parser.js";
import { enum_from_str, enum_strings, expand_warning, hex, hex_size, pad_center, registers_to_string } from "./emulator/util.js";
let animation_frame;
let running = false;
const source_input = document.getElementById("urcl-source");
const output_element = document.getElementById("output");
const memory_view = document.getElementById("memory-view");
const register_view = document.getElementById("register-view");
const console_input = document.getElementById("stdin");
const console_output = document.getElementById("stdout");
const null_terminate_input = document.getElementById("null-terminate");
let input_callback;
console_input.addEventListener("keydown", e => {
    if (!e.shiftKey && e.key === "Enter" && input_callback) {
        e.preventDefault();
        if (null_terminate_input.checked) {
            console_input.value += "\0";
        }
        else {
            console_input.value += "\n";
        }
        input_callback();
    }
});
const console_io = new Console_IO({
    read(callback) {
        input_callback = callback;
    },
    get text() {
        return console_input.value;
    },
    set text(value) {
        console_input.value = value;
    }
}, (text) => {
    console_output.innerText += text;
}, () => {
    console_output.textContent = "";
    input_callback = undefined;
});
const canvas = document.getElementsByTagName("canvas")[0];
const gl = canvas.getContext("webgl2");
if (!gl) {
    throw new Error("Unable to get webgl rendering context");
}
canvas.width = 32;
canvas.height = 32;
const display = new Gl_Display(gl);
const color_mode_input = document.getElementById("color-mode");
color_mode_input.addEventListener("change", change_color_mode);
function change_color_mode() {
    const color_mode = enum_from_str(Color_Mode, color_mode_input.value);
    display.color_mode = color_mode ?? display.color_mode;
    display.update_display();
}
const width_input = document.getElementById("display-width");
const height_input = document.getElementById("display-height");
width_input.addEventListener("input", resize_display);
height_input.addEventListener("input", resize_display);
resize_display();
function resize_display() {
    const width = parseInt(width_input.value) || 16;
    const height = parseInt(height_input.value) || 16;
    display.resize(width, height);
}
const emulator = new Emulator({ on_continue: frame });
emulator.add_io_device(console_io);
emulator.add_io_device(display);
emulator.add_io_device(new Clock());
emulator.add_io_device(new Pad());
source_input.oninput = compile_and_run;
fetch("examples/urcl/game.urcl").then(res => res.text()).then((text) => {
    if (source_input.value) {
        return;
    }
    source_input.value = text;
    compile_and_run();
});
const compile_and_run_button = document.getElementById("compile-and-run-button");
const pause_button = document.getElementById("pause-button");
const compile_and_reset_button = document.getElementById("compile-and-reset-button");
const step_button = document.getElementById("step-button");
compile_and_run_button.addEventListener("click", compile_and_run);
compile_and_reset_button.addEventListener("click", compile_and_reset);
pause_button.addEventListener("click", pause);
step_button.addEventListener("click", step);
function step() {
    process_step_result(emulator.step());
}
function pause() {
    if (running) {
        if (animation_frame) {
            cancelAnimationFrame(animation_frame);
            animation_frame = undefined;
            pause_button.textContent = "Start";
            running = false;
            step_button.disabled = running;
        }
    }
    else {
        animation_frame = requestAnimationFrame(frame);
        pause_button.textContent = "Pause";
        running = true;
        step_button.disabled = running;
    }
}
function compile_and_run() {
    compile_and_reset();
    pause_button.textContent = "Pause";
    pause_button.disabled = false;
    if (!running) {
        running = true;
        step_button.disabled = running;
        frame();
    }
}
function compile_and_reset() {
    output_element.innerText = "";
    try {
        const source = source_input.value;
        const parsed = parse(source, {
            constants: Object.fromEntries(enum_strings(Gamepad_Key).map(key => ["@" + key, "" + (1 << Gamepad_Key[key])])),
        });
        if (parsed.errors.length > 0) {
            output_element.innerText = parsed.errors.map(v => expand_warning(v, parsed.lines) + "\n").join("");
            output_element.innerText += parsed.warnings.map(v => expand_warning(v, parsed.lines) + "\n").join("");
            return;
        }
        output_element.innerText += parsed.warnings.map(v => expand_warning(v, parsed.lines) + "\n").join("");
        const [program, debug_info] = compile(parsed);
        emulator.load_program(program, debug_info);
        output_element.innerText += `
compilation done
bits: ${emulator.bits}
register-count: ${emulator.registers.length}
memory-size: ${emulator.memory.length}
`;
        if (animation_frame) {
            cancelAnimationFrame(animation_frame);
        }
        animation_frame = undefined;
        pause_button.textContent = "Start";
        pause_button.disabled = false;
        step_button.disabled = false;
        running = false;
        update_views();
    }
    catch (e) {
        output_element.innerText += e.message;
        throw e;
    }
}
function frame() {
    if (running) {
        try {
            process_step_result(emulator.run(16));
        }
        catch (e) {
            output_element.innerText += e.message + "\nProgram Halted";
            throw e;
        }
    }
    else {
        step_button.disabled = false;
        pause_button.disabled = false;
    }
}
function process_step_result(result) {
    animation_frame = undefined;
    switch (result) {
        case Step_Result.Continue:
            {
                if (running) {
                    animation_frame = requestAnimationFrame(frame);
                    running = true;
                    step_button.disabled = running;
                    pause_button.disabled = false;
                }
            }
            break;
        case Step_Result.Input:
            {
                step_button.disabled = true;
                pause_button.disabled = true;
            }
            break;
        case Step_Result.Halt:
            {
                output_element.innerText += "Program halted";
                step_button.disabled = true;
                pause_button.disabled = true;
                pause_button.textContent = "Start";
                running = false;
            }
            break;
        default: {
            console.warn("unkown step result");
        }
    }
    update_views();
}
function update_views() {
    const bits = emulator.bits;
    memory_view.innerText = memoryToString(emulator.memory, 0, emulator.memory.length, bits);
    register_view.innerText =
        registers_to_string(emulator);
}
function memoryToString(view, from = 0x0, length = 0x1000, bits = 8) {
    const width = 0x10;
    const end = Math.min(from + length, view.length);
    const hexes = hex_size(bits);
    let lines = [
        " ".repeat(hexes) + Array.from({ length: width }, (_, i) => {
            return pad_center(hex(i, 1), hexes);
        }).join(" ")
    ];
    for (let i = from; i < end;) {
        const sub_end = Math.min(i + width, end);
        let subs = [];
        const addr = hex(0 | i / width, hexes - 1, " ");
        for (; i < sub_end; i++) {
            subs.push(hex(view[i], hexes));
        }
        const line = subs.join(" ");
        lines.push(addr + " ".repeat(hexes - addr.length) + line);
    }
    return lines.join("\n");
}
change_color_mode();
//# sourceMappingURL=index.js.map