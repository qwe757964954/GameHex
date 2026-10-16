/**
 * 服务端种子 → 确定性随机源。
 * 按十进制字符串逐字符混合（xmur3 + sfc32），全程 32 位整数运算，
 * 引擎与 Node 逐位一致。零引擎依赖，可单测。
 */

const UINT32_RANGE = 4294967296;

/** 十进制字符串 → 4 个 32 位种子（xmur3）。 */
function seedWords(text: string): readonly [number, number, number, number] {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i += 1) {
        h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    const next = (): number => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
    return [next(), next(), next(), next()];
}

/**
 * 种子 → () => number（[0,1)），sfc32。
 * 空 / 缺省种子返回 Math.random（离线对局、编辑器预览不受影响）。
 */
export function createSeededRandom(seed: string | null | undefined): () => number {
    const text = typeof seed === 'string' ? seed.trim() : '';
    if (!text) return Math.random;

    const words = seedWords(text);
    let a = words[0];
    let b = words[1];
    let c = words[2];
    let d = words[3];
    return (): number => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / UINT32_RANGE;
    };
}
