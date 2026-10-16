let BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
let BASE64_VALUES = new Array(123); // max char code in base64Keys
for (let i = 0; i < 123; ++i) {
    BASE64_VALUES[i] = 64; // fill with placeholder('=') index
}
for (let i = 0; i < 64; ++i) {
    BASE64_VALUES[BASE64_KEYS.charCodeAt(i)] = i;
}

export class Base64 {
    public static __cname: string = "Base64";

    public static decode(input) {
        var output = [],
            chr1, chr2, chr3,
            enc1, enc2, enc3, enc4,
            i = 0;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        let strValue = BASE64_VALUES;
        while (i < input.length) {
            enc1 = strValue[input.charCodeAt(i++)];
            enc2 = strValue[input.charCodeAt(i++)];
            enc3 = strValue[input.charCodeAt(i++)];
            enc4 = strValue[input.charCodeAt(i++)];

            chr1 = (enc1 << 2) | (enc2 >> 4);
            chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            chr3 = ((enc3 & 3) << 6) | enc4;

            output.push(String.fromCharCode(chr1));

            if (enc3 !== 64) {
                output.push(String.fromCharCode(chr2));
            }
            if (enc4 !== 64) {
                output.push(String.fromCharCode(chr3));
            }
        }
        let result = output.join('');
        return result;
    }

    public static decodeAsArray(input, bytes) {
        var dec = this.decode(input),
            ar = [], i, j, len;
        for (i = 0, len = dec.length / bytes; i < len; i++) {
            ar[i] = 0;
            for (j = bytes - 1; j >= 0; --j) {
                ar[i] += dec.charCodeAt((i * bytes) + j) << (j * 8);
            }
        }
        return ar;
    }
}
