/**
 * 采样「地皮换色」的曲线与错峰档期，输出 JSON 给 `tools/preview_hex_recolor.py` 画图。
 *
 * 与 `preview_hex_spawn_curves.ts` 同一套路：**图与代码同一份真源** —— 这里直接调
 * `model/TerritoryHexRecolor` 的真函数采样，改了参数重跑一遍图就跟着变，不会漂。
 *
 * 用法（在仓库根目录）：
 *     npx tsx tools/preview_hex_recolor_curves.ts
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_HEX_RECOLOR_IN_FROM_SCALE,
    TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION,
    TERRITORY_HEX_RECOLOR_IN_START,
    TERRITORY_HEX_RECOLOR_OUT_END,
    TERRITORY_HEX_RECOLOR_OUT_SCALE,
    TERRITORY_HEX_RECOLOR_SECONDS,
    TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
    territoryHexRecolorBatchSeconds,
    territoryHexRecolorDelays,
    territoryHexRecolorFrame,
} from '../assets/script/app/territory/model/TerritoryHexRecolor';

const OUT = 'docs/.tmp-hex-recolor-curves.json';
/** 采样步长 1/240s：交叉那一段只有 90ms，太粗会看不出"两层同时可见"。 */
const STEP = 1 / 240;
/** 采样到 0.6s：单格 0.36s 结束，后面留一段平线证明「收口后不再变」。 */
const SPAN = 0.6;

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

// ── 单格曲线 ────────────────────────────────────────────────
const curve: { t: number; outScale: number; outOpacity: number; inScale: number; inOpacity: number }[] = [];
for (let step = 0; step * STEP <= SPAN + 1e-9; step += 1) {
    const t = step * STEP;
    const frame = territoryHexRecolorFrame(t);
    curve.push({
        t: round5(t),
        outScale: round5(frame.outScale),
        outOpacity: round5(frame.outOpacity),
        inScale: round5(frame.inScale),
        inOpacity: round5(frame.inOpacity),
    });
}

// ── 一批格子的错峰档期（3×3 axial 菱形，真六边格布局）────────
// 与生成预览同一套几何：相邻格水平间距 √3·R、行距 1.5·R（y 轴向上，画时翻）。
const RADIUS = 46;
const DX = Math.sqrt(3) * RADIUS;
const DY = 1.5 * RADIUS;
const raw: { cellId: number; x: number; y: number }[] = [];
for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
        raw.push({
            cellId: row * 3 + column + 1,
            x: DX * (column + row / 2),
            y: -DY * row,
        });
    }
}
const centreX = (Math.min(...raw.map((c) => c.x)) + Math.max(...raw.map((c) => c.x))) / 2;
const centreY = (Math.min(...raw.map((c) => c.y)) + Math.max(...raw.map((c) => c.y))) / 2;
for (const cell of raw) {
    cell.x = Math.round((cell.x - centreX) * 1e3) / 1e3;
    cell.y = Math.round((cell.y - centreY) * 1e3) / 1e3;
}
const delays = territoryHexRecolorDelays(raw);

writeFileSync(OUT, JSON.stringify({
    step: STEP,
    span: SPAN,
    curve,
    radius: RADIUS,
    cluster: raw.map((cell) => ({ ...cell, delay: round5(delays.get(cell.cellId) ?? 0) })),
    constants: {
        seconds: TERRITORY_HEX_RECOLOR_SECONDS,
        outScale: TERRITORY_HEX_RECOLOR_OUT_SCALE,
        inFromScale: TERRITORY_HEX_RECOLOR_IN_FROM_SCALE,
        outEnd: TERRITORY_HEX_RECOLOR_OUT_END,
        inStart: TERRITORY_HEX_RECOLOR_IN_START,
        inOpacityPortion: TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION,
        stagger: TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
        staggerMax: TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS,
        batchCount: raw.length,
        batchSeconds: round5(territoryHexRecolorBatchSeconds(raw.length)),
    },
}, null, 1));
console.log(`已写出 ${OUT}`);
