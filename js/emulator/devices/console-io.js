import { IO_Port } from "../instructions.js";
import { f32_decode } from "../util.js";
export class Console_IO {
    input;
    write;
    _reset;
    bits = 32;
    constructor(input, write, _reset) {
        this.input = input;
        this.write = write;
        this._reset = _reset;
    }
    inputs = {
        [IO_Port.TEXT]: this.text_in,
        [IO_Port.NUMB]: this.numb_in,
    };
    outputs = {
        [IO_Port.TEXT]: this.text_out,
        [IO_Port.NUMB]: this.numb_out,
        [IO_Port.UINT]: this.numb_out,
        [IO_Port.HEX]: (v) => this.write(v.toString(16).padStart(Math.ceil(this.bits / 4), "0")),
        [IO_Port.BIN]: (v) => this.write(v.toString(2).padStart(this.bits, "0")),
        [IO_Port.FLOAT]: (v) => this.write(f32_decode(v).toString()),
        [IO_Port.INT]: (v) => {
            const sign_bit = 2 ** (this.bits - 1);
            if (v & sign_bit) {
                v = (v & (sign_bit - 1)) - sign_bit;
            }
            this.write(v.toString());
        },
        // TODO: make specific implementations for these
        [IO_Port.ASCII]: this.text_out,
        [IO_Port.CHAR5]: this.text_out,
        [IO_Port.CHAR6]: this.text_out,
        [IO_Port.ASCII]: this.text_out,
        [IO_Port.UTF8]: this.text_out,
        [IO_Port.UTF16]: this.text_out,
        [IO_Port.UTF32]: this.text_out,
    };
    set_text(text) {
        this.input.text = text;
    }
    reset() {
        this.input.text = "";
        this._reset();
    }
    text_in(callback) {
        if (this.input.text.length === 0) {
            this.input.read(() => {
                const char_code = this.input.text.codePointAt(0) ?? this.input.text.charCodeAt(0);
                this.input.text = this.input.text.slice(1);
                callback(char_code);
            });
            return undefined;
        }
        const char_code = this.input.text.charCodeAt(0);
        this.input.text = this.input.text.slice(1);
        return char_code;
    }
    text_out(value) {
        this.write(String.fromCodePoint(value));
    }
    numb_in(callback) {
        if (this.input.text.length !== 0) {
            const num = parseInt(this.input.text);
            if (Number.isInteger(num)) {
                this.input.text = this.input.text.trimStart().slice(num.toString().length);
                return num;
            }
        }
        this.input.read(() => {
            const num = this.numb_in(callback);
            if (num !== undefined) {
                callback(num);
            }
        });
    }
    numb_out(value) {
        this.write("" + value);
    }
}
//# sourceMappingURL=console-io.js.map