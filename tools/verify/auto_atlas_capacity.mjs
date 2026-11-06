#!/usr/bin/env node
/**
 * auto-atlas 容量账（代码审查护栏真源）。
 *
 * 存在理由：加图不扩容，构建期才切图 / 糊图，本地零报错（规则 403）。
 * 本模块只提供「读真实产物 → 出诊断」的纯函数，由 tests/auto-atlas-capacity.test.ts 断言，
 * 不在用例里另抄一份像素算法。
 *
 * 判据口径（2026-11-05 实测校正，别按老口径改回去）：
 *  · 像素总量 ≤ maxWidth×maxHeight 是**单页容量**，超了 Cocos 会分多页；
 *    全库 56 个 auto-atlas 里 15 个本来就越界且运行正常 ⇒ 它不是全库硬规则，
 *    只用于已明确要求单页的关键目录（assets/resources/image/buildings）。
 *  · 全库硬规则是：容量字段必须是正整数，且单图不得超出 maxWidth / maxHeight。
 *
 * 约定：本文件是 .mjs 不是 .ts —— 工程 tsconfig 无 include，放 .ts 会被全量编译扫进去。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const norm = (p) => p.replace(/\\/g, '/');

/** 从 PNG 的 IHDR 读宽高，不依赖图像库；只读前 24 字节，不整文件加载。 */
export function pngSize(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(24);
        const n = fs.readSync(fd, buf, 0, 24, 0);
        if (n < 24 || buf.toString('ascii', 1, 4) !== 'PNG' || buf.readUInt32BE(12) !== 0x49484452) {
            throw new Error(`不是合法 PNG（缺 IHDR）：${file}`);
        }
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    } finally {
        fs.closeSync(fd);
    }
}

/** 递归收集目录下的 png（auto-atlas 的作用域是整棵子树）。 */
export function listPngs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listPngs(file));
        else if (entry.name.toLowerCase().endsWith('.png')) out.push(file);
    }
    return out;
}

/** 找仓库内所有 auto-atlas.pac.meta，返回相对仓库根的路径。 */
export function listAtlases(roots = ['assets/resources', 'assets/bundles']) {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.name === 'auto-atlas.pac.meta') out.push(norm(path.relative(ROOT, file)));
        }
    };
    for (const root of roots) {
        const abs = path.join(ROOT, root);
        if (fs.existsSync(abs)) walk(abs);
    }
    return out.sort();
}

/** 读 userData 容量字段；缺失 / 0 / 非整数都原样返回，由 atlasReport 判不合法。 */
export function readAtlasLimit(metaPath) {
    const abs = path.isAbsolute(metaPath) ? metaPath : path.join(ROOT, metaPath);
    const userData = JSON.parse(fs.readFileSync(abs, 'utf8')).userData || {};
    return { maxWidth: userData.maxWidth, maxHeight: userData.maxHeight };
}

/**
 * 出一个目录的容量账。override 允许在不改真实文件的前提下注入「没扩容」的容量，做变异自证。
 * ok = 字段合法 && 无单图超尺寸 && 总量不超单页。
 */
export function atlasReport(metaPath, override = {}) {
    const abs = path.isAbsolute(metaPath) ? metaPath : path.join(ROOT, metaPath);
    const dir = path.dirname(abs);
    const rel = norm(path.relative(ROOT, dir));
    const { maxWidth, maxHeight } = { ...readAtlasLimit(abs), ...override };
    const limitValid = Number.isInteger(maxWidth) && maxWidth > 0
        && Number.isInteger(maxHeight) && maxHeight > 0;

    const files = listPngs(dir);
    let pixels = 0;
    let maxSingleW = 0;
    let maxSingleH = 0;
    let biggest = '';
    for (const file of files) {
        const { w, h } = pngSize(file);
        pixels += w * h;
        if (w * h > maxSingleW * maxSingleH) {
            maxSingleW = w;
            maxSingleH = h;
            biggest = norm(path.relative(ROOT, file));
        }
    }

    const capacity = limitValid ? maxWidth * maxHeight : 0;
    const oversizedSingle = limitValid && (maxSingleW > maxWidth || maxSingleH > maxHeight);
    const overCapacity = limitValid && pixels > capacity;
    const reasons = [];
    if (!limitValid) reasons.push(`容量字段非法：${maxWidth}x${maxHeight}`);
    if (oversizedSingle) reasons.push(`单图 ${maxSingleW}x${maxSingleH} 超出 ${maxWidth}x${maxHeight}（${biggest}）`);
    if (overCapacity) reasons.push(`像素总量 ${pixels} 超出单页容量 ${capacity}`);

    return {
        dir: rel,
        maxWidth, maxHeight, capacity,
        files: files.length, pixels,
        maxSingleW, maxSingleH, biggest,
        limitValid, oversizedSingle, overCapacity,
        ok: limitValid && !oversizedSingle && !overCapacity,
        reasons,
    };
}
