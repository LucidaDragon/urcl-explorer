export enum Color_Mode {
    GRB, Mono, Bin
}

export class Display {
    private ctx: CanvasRenderingContext2D
    private image: ImageData;
    private ints: Uint32Array;
    private buffer_enabled: 1 | 0 = 0;
    private x = 0;
    private y = 0;
    
    constructor (
        canvas: HTMLCanvasElement,
        width: number,
        height: number,
        public bits: number,
        private _color_mode = Color_Mode.Bin
    ){
        const ctx = canvas.getContext("2d");
        if (!ctx){throw new Error("unable to get 2d rendering context");}
        canvas.width = width; canvas.height = height;
        this.ctx = ctx;
        this.image = ctx.createImageData(width, height);
        const data = this.image.data;
        this.ints = new Uint32Array(data.buffer, data.byteOffset, data.byteLength/Uint32Array.BYTES_PER_ELEMENT);
    }
    resize(width: number, height: number){
        this.image = this.ctx.getImageData(0, 0, width, height);
        const data = this.image.data;
        this.ints = new Uint32Array(data.buffer, data.byteOffset, data.byteLength/Uint32Array.BYTES_PER_ELEMENT);
        this.width = width; this.height = height;
        this.ctx.putImageData(this.image, 0, 0);
    }
    set color_mode(mode: Color_Mode){
        const displayed = this.ctx.getImageData(0, 0, this.width, this.height);
        const data = displayed.data;
        const ints = new Uint32Array(data.buffer, data.byteOffset, data.byteLength/Uint32Array.BYTES_PER_ELEMENT);
        for (let i = 0; i < ints.length; i++){
            ints[i] = this.full_to_short(ints[i]);
        }
        this._color_mode = mode;
        for (let i = 0; i < ints.length; i++){
            ints[i] = this.short_to_full(ints[i]);
        }
        this.ctx.putImageData(displayed, 0, 0);
    }
    x_in(){
        return this.width;
    }
    y_in(){
        return this.height;
    }

    x_out(value: number){
        this.x = value;
    }
    y_out(value: number){
        this.y = value;
    }
    color_in(){
        if (!this.in_bounce(this.x, this.y)){
            return 0;
        }
        return this.full_to_short(this.ints[this.x + this.y * this.width]);
    }
    // bbgggrrr
    // bbbbbggggggrrrrr
    // bbbbbbbbggggggggrrrrrrrr
    color_out(color: number){
        if (!this.in_bounce(this.x, this.y)){
            return;
        }
        this.ints[this.x + this.y * this.width] = this.short_to_full(color);
        if (!this.buffer_enabled){
            this.ctx.putImageData(this.image, 0, 0);
        }
    }
    buffer_in(){
        return this.buffer_enabled;
    }
    buffer_out(value: number){
        switch (value){
            case 0: {
                this.ctx.putImageData(this.image, 0, 0);
                this.ints.fill(0xff_00_00_00);
                this.buffer_enabled = 0;
            }; break;
            case 1: {
                this.buffer_enabled = 1;
            } break;
            case 2: {
                this.ctx.putImageData(this.image, 0, 0);
            } break;
        }
    }


    private in_bounce(x: number, y: number){
        return x >= 0 && x < this.width
            && y >= 0 && y < this.height;
    }
    private get used_bits(){
        return Math.min(this.bits, 24);
    }
    private short_to_full(short: number){
        switch (this._color_mode){
        case Color_Mode.GRB: {
            const blue_bits = 0| this.used_bits / 3;
            const blue_mask = (1 << blue_bits) - 1;
            const red_bits = 0| (this.used_bits - blue_bits) / 2;
            const red_mask = (1 << red_bits) - 1;
            const green_bits = this.used_bits - blue_bits - red_bits;
            const green_mask = (1 << green_bits) - 1;
            
            const green_offset = red_bits;
            const blue_offset = green_offset + green_bits;
            return ((short & red_mask) * 255 / red_mask)
                | ((((short >>> green_offset) & green_mask) * 255 / green_mask) << 8 )
                | ((((short >>> blue_offset) & blue_mask) * 255 / blue_mask) << 16 )
                | 0xff_00_00_00
        }
        case Color_Mode.Mono: {
            return short * ((1 << 24)-1) / ((1 << this.bits)-1) | 0xff_00_00_00;
        }
        case Color_Mode.Bin: {
            return short > 0 ? 0xff_ff_ff_ff : 0xff_00_00_00;
        }
        default: return 0xff_ff_00_ff;
        }
    }
    private full_to_short(full: number){
        switch (this._color_mode){
        case Color_Mode.GRB: {
            const blue_bits = 0| this.used_bits / 3;
            const blue_mask = (1 << blue_bits) - 1;
            const red_bits = 0| (this.used_bits - blue_bits) / 2;
            const red_mask = (1 << red_bits) - 1;
            const green_bits = this.used_bits - blue_bits - red_bits;
            const green_mask = (1 << green_bits) - 1;
            
            const green_offset = red_bits;
            const blue_offset = green_offset + green_bits;
            return (full & red_mask) 
                | (((full >>> 8) & green_mask) << green_offset)
                | (((full >>> 16) & blue_mask) << blue_offset);
        }
        case Color_Mode.Mono: {
            return 0| (full & 0x00_ff_ff_ff) * ((1 << this.bits)-1) / ((1 << 24)-1);
        }
        case Color_Mode.Bin: {
            return (full & 0x00_ff_ff_ff) > 0 ? 1 : 0;
        }
        default: return 0;
        }
    }

    get width(){
        return this.ctx.canvas.width;
    }
    private set width(value: number){
        this.ctx.canvas.width = value;
    }
    get height(){
        return this.ctx.canvas.height;
    }
    private set height(value: number){
        this.ctx.canvas.height = value;
    }
}