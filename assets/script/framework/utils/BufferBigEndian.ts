interface UnicodeOk {
    unicode?: number
    ok: boolean
}

interface UnicodeLen {
    unicode?: number
    len: number
}

export class BufferBigEndian {
    buffer: number[];//uint8array
    private readOffset: number;

    constructor() {
        this.buffer = [];
        this.readOffset = 0;
    }

    initWithUint8Array(array: ArrayLike<number>, len?: number) {
        len = len || array.length;
        this.buffer = [];
        for (let i = 0; i < len && i < array.length; i++)
            this.buffer[i] = array[i];
        this.readOffset = 0;
    }

    getUint8(): number {
        // console.log("getUint8 readOffset=" + this.readOffset + ",total=" + this.buffer.length);
        if (this.readOffset + 1 > this.buffer.length)
            return null;
        return this.buffer[this.readOffset++];
    }

    pushUint8(value: number): void {
        if (value > 255)
            throw Error("BufferBigEndian pushUint8 value need <= 255");
        this.buffer.push(value);
    }

    getUint16(): number {
        if (this.readOffset + 2 > this.buffer.length)
            return null;
        let uint1 = this.getUint8();
        let uint2 = this.getUint8();
        return (uint1 << 8) | uint2;
    }

    pushUint16(value: number): void {
        this.pushUint8((value >> 8) & 0xFF);
        this.pushUint8(value & 0xFF);
    }

    getUint32(): number {
        /*
        实验：
         let a = 34302;
         let b = 32200;
         console.log("a << 16 | b=" + (a << 16 | b) + ",a * 65536 + b=" + (a * 65536 + b)
         + ",(a * 65536) | b=" + ((a * 65536) | b) + ",(a << 16) + b=" + ((a << 16) + b));
         实际打印结果 a << 16 | b=-2046919224,a * 65536 + b=2248048072,
         (a * 65536) | b=-2046919224,(a << 16) + b=-2046919224
         结果表明 js的位运算仅限在4字节32位。如果想要扩展到8字节64位，那么只能用乘除加减的方法。
         */
        if (this.readOffset + 4 > this.buffer.length)
            return null;
        let uint1 = this.getUint16();
        let uint2 = this.getUint16();
        return uint1 * 65536 + uint2;
    }

    pushUint32(value: number): void {
        /*
        这里可以直接这样使用。
        buf.initWithUint8Array([]);
        buf.pushUint32(2248048072);
        console.log("2248048072 uint16 =" + buf.getUint16() + ",uint16=" + buf.getUint16());
        buf.changeReadOffset(-4);
        console.log("2248048072 uint32 =" + buf.getUint32());
         */
        this.pushUint16((value >> 16) & 0xFFFF);
        this.pushUint16(value & 0xFFFF);
    }

    getInt64(): number {
        let hi = this.getUint32();
        // console.log("hi=" + hi);
        let lo = this.getUint32();
        // console.log("lo=" + lo);
        if (hi >> 31 == 1)
            return -(hi * 4294967296 + lo);
        return hi * 4294967296 + lo;
    }

    pushUnicodeWithUtf8(value: number): void {
        // console.log("encodeUnicode value=" + value);
        if (value <= 0x7F) {
            this.pushUint8(value);
        } else if (value <= 0xFF) {
            this.pushUint8((value >> 6) | 0xC0);
            this.pushUint8((value & 0x3F) | 0x80);
        } else if (value <= 0xFFFF) {
            this.pushUint8((value >> 12) | 0xE0);
            this.pushUint8(((value >> 6) & 0x3F) | 0x80);
            this.pushUint8((value & 0x3F) | 0x80);
        } else if (value <= 0x1FFFFF) {
            this.pushUint8((value >> 18) | 0xF0);
            this.pushUint8(((value >> 12) & 0x3F) | 0x80);
            this.pushUint8(((value >> 6) & 0x3F) | 0x80);
            this.pushUint8((value & 0x3F) | 0x80);
        } else if (value <= 0x3FFFFFF) {//后面两种情况一般不大接触到，看了下protobuf.js中的utf8，他没去实现
            this.pushUint8((value >> 24) | 0xF8);
            this.pushUint8(((value >> 18) & 0x3F) | 0x80);
            this.pushUint8(((value >> 12) & 0x3F) | 0x80);
            this.pushUint8(((value >> 6) & 0x3F) | 0x80);
            this.pushUint8((value & 0x3F) | 0x80);
        } else {//Math.pow(2, 32) - 1
            this.pushUint8((value >> 30) & 0x1 | 0xFC);
            this.pushUint8(((value >> 24) & 0x3F) | 0x80);
            this.pushUint8(((value >> 18) & 0x3F) | 0x80);
            this.pushUint8(((value >> 12) & 0x3F) | 0x80);
            this.pushUint8(((value >> 6) & 0x3F) | 0x80);
            this.pushUint8((value & 0x3F) | 0x80);
        }
    }

    getUnicodeWithUtf8(): UnicodeLen {
        let result;
        let start = this.getUint8();
        if (start == null)
            return null;
        let n = 7;
        while (((start >> n) & 1) == 1)
            n--;
        n = 7 - n;
        if (n == 0)
            result = start;
        else
            result = start & (Math.pow(2, 7 - n) - 1);
        // console.log("start=" + start.toString(16).toUpperCase() + ",n=" + n + ",result=" + result);
        for (let i = 1; i < n; i++) {
            let follow = this.getUint8();
            if ((follow & 0x80) == 0x80) {
                result = result << 6 | (follow & 0x3F);
            } else {
                //不是标准的UTF8字符串。。我们直接取第一个。
                result = start;
                this.changeReadOffset(1 - n);
                n = 0;
                break;
            }
        }
        return {unicode: result, len: n == 0 ? 1 : n};
    }

    parseUnicodeFromUtf16(ch1: number, ch2: number): UnicodeOk {
        if ((ch1 & 0xFC00) === 0xD800 && (ch2 & 0xFC00) === 0xDC00) {
            return {unicode: (((ch1 & 0x3FF) << 10) | (ch2 & 0x3FF)) + 0x10000, ok: true}
        }
        return {ok: false}
    }

    pushStringWithUtf8(value: string): number {
        let oldlen = this.buffer.length;
        for (let i = 0; i < value.length; i++) {
            let ch1 = value.charCodeAt(i);
            // console.log("pushStringWithUtf8 i=" + i + ",ch1=" + ch1 + "," + ch1.toString(16).toUpperCase());
            if (ch1 < 128)
                this.pushUnicodeWithUtf8(ch1);
            else if (ch1 < 2048) {
                this.pushUnicodeWithUtf8(ch1);
            } else {
                let ch2 = value.charCodeAt(i + 1);
                // console.log("pushStringWithUtf8 i=" + i + ",ch2=" + ch2 + "," + ch2.toString(16).toUpperCase());
                let unicodeOk = this.parseUnicodeFromUtf16(ch1, ch2);
                // console.log("unicodeOk=" + JSON.stringify(unicodeOk));
                if (unicodeOk.ok) {
                    this.pushUnicodeWithUtf8(unicodeOk.unicode);
                    i++;
                } else {
                    this.pushUnicodeWithUtf8(ch1);
                }
            }
        }
        return this.buffer.length - oldlen;
    }

    getStringWithUtf8(len: number): string {
        if (len < 1)
            return "";
        // console.log("this.readOffset=" + this.readOffset + ",len=" + len + ",total=" + this.buffer.length);
        if (this.readOffset + len > this.buffer.length)
            return "";
        let str = "";
        let read = 0;
        while (read < len) {
            let unicodeLen = this.getUnicodeWithUtf8();
            if (!unicodeLen) {
                break;
            }
            read += unicodeLen.len;
            // console.log("read unicode=" + JSON.stringify(unicodeLen));
            if (unicodeLen.unicode < 0x10000) {
                str += String.fromCharCode(unicodeLen.unicode);
            } else {
                let minus = unicodeLen.unicode - 0x10000;
                let ch1 = (minus >> 10) | 0xD800;
                let ch2 = (minus & 0x3FF) | 0xDC00;
                str += String.fromCharCode(ch1, ch2)
            }
        }
        // console.log("getStringWithUtf8 len=" + len + ",str.len=" + str.length);
        return str;
    }

    pushStringWithUtf16(value: string): number {
        let oldlen = this.buffer.length;
        for (let i = 0; i < value.length; i++) {
            let ch = value[i].charCodeAt(0);
            this.pushUint16(ch);
        }
        return this.buffer.length - oldlen;
    }

    getStringWithUtf16(len: number): string {
        if (len < 1)
            return "";
        if (this.readOffset + len > this.buffer.length || len % 2 != 0)
            return "";
        let str = "";
        for (let i = 0; i < len; i += 2) {
            let ch1 = this.getUint16();
            let ch2 = this.getUint16();
            str += String.fromCharCode(ch1, ch2);
        }
        return str;
    }

    pushUint8List(val: ArrayLike<number>) {
        for (let i = 0; i < val.length; i++)
            this.pushUint8(val[i]);
    }

    getUint8List(len?: number): Uint8Array {
        len = len || this.buffer.length;
        return new Uint8Array(this.buffer.slice(this.readOffset, this.readOffset + len));
    }

    tostring(): string {
        let result = "";
        for (let i = 0; i < this.buffer.length; i++) {
            let ch = this.buffer[i].toString(16);
            result += ch.length == 1 ? "0" + ch.toUpperCase() : ch.toUpperCase();
        }
        return result;
    }

    toUint8Array(): Uint8Array {
        let array = new Uint8Array(this.buffer.length);
        for (let i = 0; i < this.buffer.length; i++)
            array[i] = this.buffer[i];
        return array;
    }

    changeReadOffset(len: number) {
        this.readOffset = Math.max(0, Math.min(this.buffer.length, this.readOffset + len))
    }
}