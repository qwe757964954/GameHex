/** 确定性噪声：同 seed/index/salt 必复现，不依赖 Math.random。 */
export function hashNoise01(seed: number, index: number, salt: number): number {
    let h = Math.imul(seed | 0, 0x27d4eb2d)
        ^ Math.imul(index + 1, 0x9e3779b1)
        ^ Math.imul(salt + 1, 0x85ebca6b);
    h = (h ^ (h >>> 15)) | 0;
    h = Math.imul(h, 0x2545f491);
    h = (h ^ (h >>> 13)) | 0;
    return (h >>> 0) / 4294967296;
}

/** 经典 sin 取小数噪声，返回 [0,1)。 */
export function sinNoise01(a: number, b: number): number {
    const raw = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return raw - Math.floor(raw);
}
