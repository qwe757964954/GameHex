/**
 * 读 PNG 的**画布尺寸 + alpha 包围盒**（零依赖，只支持本项目美术的编码）。
 *
 * ## 为什么测试要自己解 PNG
 *
 * 宝箱表演的「箱子与地图上那只一样大、摆在同一处」全靠 `TERRITORY_CHEST_ART_METRICS`
 * 那几个实测数字。数字一旦和美术脱节（换图 / 重新烘焙补帧），表现会静默错位 ——
 * 不报错、不抛异常，只是箱子变大或下沉。所以判据必须**回到 PNG 本身**量一遍。
 *
 * Cocos 的 `.meta` 里没有可用信息：补帧图是 `trimType: "none"` 导入的，
 * `trimX/trimY/width/height` 恒等于整块画布（连透明边一起算）。
 *
 * ## 支持范围
 *
 * 8bit / 非隔行 / `colorType = 6`（RGBA）。本项目的美术就是这一种；
 * 遇到别的编码**直接抛错**（测试红），不做"猜一个值"的降级 —— 猜出来的数是假判据。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 画布尺寸 + alpha 包围盒（**坐标系原点在左下**，`right/top` 为开区间）。 */
export interface IPngAlphaBox {
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
    readonly top: number;
}

/** PNG 签名（8 字节）。 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUInt32(buffer: Buffer, offset: number): number {
    return buffer.readUInt32BE(offset);
}

/** 把一个 PNG 的 IDAT 全部解压并反滤波成逐行 RGBA。 */
function decodeRgba(buffer: Buffer): { width: number; height: number; pixels: Buffer } {
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
        if (buffer[index] !== PNG_SIGNATURE[index]) throw new Error('不是 PNG 文件（签名不对）');
    }
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat: Buffer[] = [];
    let cursor = PNG_SIGNATURE.length;
    while (cursor + 8 <= buffer.length) {
        const length = readUInt32(buffer, cursor);
        const type = buffer.toString('ascii', cursor + 4, cursor + 8);
        const start = cursor + 8;
        if (type === 'IHDR') {
            width = readUInt32(buffer, start);
            height = readUInt32(buffer, start + 4);
            bitDepth = buffer[start + 8];
            colorType = buffer[start + 9];
            interlace = buffer[start + 12];
        } else if (type === 'IDAT') {
            idat.push(buffer.subarray(start, start + length));
        } else if (type === 'IEND') {
            break;
        }
        cursor = start + length + 4; // 跳过内容与 CRC
    }
    if (!width || !height) throw new Error('PNG 缺少 IHDR');
    if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`只支持 8bit RGBA 非隔行 PNG（实得 bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}）`);
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    // 反滤波（PNG spec 9.2）：每行首字节是 filter type，0 none / 1 sub / 2 up / 3 average / 4 paeth。
    for (let row = 0; row < height; row += 1) {
        const filter = raw[row * (stride + 1)];
        const source = row * (stride + 1) + 1;
        const target = row * stride;
        const prior = target - stride;
        for (let x = 0; x < stride; x += 1) {
            const rawByte = raw[source + x];
            const a = x >= 4 ? pixels[target + x - 4] : 0;
            const b = row > 0 ? pixels[prior + x] : 0;
            const c = row > 0 && x >= 4 ? pixels[prior + x - 4] : 0;
            let value = rawByte;
            if (filter === 1) value += a;
            else if (filter === 2) value += b;
            else if (filter === 3) value += (a + b) >> 1;
            else if (filter === 4) {
                // Paeth 预测器
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            } else if (filter !== 0) {
                throw new Error(`未知的行滤波类型 ${filter}（第 ${row} 行）`);
            }
            pixels[target + x] = value & 0xff;
        }
    }
    return { width, height, pixels };
}

/**
 * 量一张 PNG 的 alpha 包围盒（`alpha > threshold` 的像素才算"可见"）。
 *
 * 返回的 `left/bottom` 含、`right/top` 不含，且 **y 轴已翻成从下往上**（与 Cocos 的
 * `SpriteFrame.rect` / `offset` 同向，直接就能和手写的"画布像素"常数比对）。
 */
export function readPngAlphaBox(filePath: string, threshold = 0): IPngAlphaBox {
    const { width, height, pixels } = decodeRgba(readFileSync(filePath));
    let minX = width;
    let maxX = -1;
    let minRow = height;
    let maxRow = -1;
    for (let row = 0; row < height; row += 1) {
        for (let x = 0; x < width; x += 1) {
            if (pixels[row * width * 4 + x * 4 + 3] <= threshold) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
        }
    }
    if (maxX < 0) throw new Error(`${filePath} 整张全透明，量不出包围盒`);
    return {
        width,
        height,
        left: minX,
        right: maxX + 1,
        // PNG 的行序是自上而下 ⇒ 翻成自下而上（bottom 含、top 不含）。
        bottom: height - 1 - maxRow,
        top: height - minRow,
    };
}
