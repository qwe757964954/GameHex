/**
 * 采样「新地块生成」的曲线与错峰档期，输出 JSON 给 `tools/preview_hex_spawn.py` 画图。
 *
 * 与 `preview_chest_curves.ts` 同一套路：**图与代码同一份真源** —— 这里直接调
 * `model/TerritoryHexSpawn` 的真函数采样，改了参数重跑一遍图就跟着变，不会漂。
 *
 * 用法（在仓库根目录）：
 *     npx tsx tools/preview_hex_spawn_curves.ts
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_HEX_SPAWN_FROM_SCALE,
    TERRITORY_HEX_SPAWN_OPACITY_PORTION,
    TERRITORY_HEX_SPAWN_SECONDS,
    TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    territoryHexSpawnBatchSeconds,
    territoryHexSpawnDelays,
    territoryHexSpawnFrame,
} from '../assets/script/app/territory/model/TerritoryHexSpawn';

const OUT = 'docs/.tmp-hex-spawn-curves.json';
/** 采样步长 1/120s：图上曲线要顺，又不至于把 JSON 撑大。 */
const STEP = 1 / 120;
/** 采样到 0.8s：单格 0.4s 结束，后面留一段平线证明「收口后不再变」。 */
const SPAN = 0.8;

const round5 = (value: number): number => Math.round(value * 1e5) / 1e5;

// ── 单格曲线 ────────────────────────────────────────────────
const curve: { t: number; scale: number; opacity: number }[] = [];
for (let step = 0; step * STEP <= SPAN + 1e-9; step += 1) {
    const t = step * STEP;
    const frame = territoryHexSpawnFrame(t);
    curve.push({ t: round5(t), scale: round5(frame.scale), opacity: round5(frame.opacity) });
}

// ── 一批格子的错峰档期（3×3 axial 菱形，真六边格布局）────────
// ⚠️ 这里**不追求**「外环按顺时针编号」：几何上完全等距的一簇格子，`dx²+dy²` 的浮点值会差
// 千分之几，`territoryHexSpawnDelays` 的「等距按 cellId 兜底」根本撞不上 ⇒ 档期顺序看似随机。
// 真实批次（进度推进新露出的边界格）形状从来不对称，所以这不影响观感，图里也就只画档期（甘特）。
const RADIUS = 46;
const DX = Math.sqrt(3) * RADIUS;
const DY = 1.5 * RADIUS;
const cells: { cellId: number; x: number; y: number }[] = [];
for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
        // 轴向坐标 (q, r) → 像素：x = DX · (q + r/2)、y 轴向上
        cells.push({
            cellId: row * 3 + column + 1,
            x: DX * (column + row / 2),
            y: -DY * row,
        });
    }
}
// 平移成以包围盒中心为原点（画图时直接按中心摆）。
const centreX = (Math.min(...cells.map((c) => c.x)) + Math.max(...cells.map((c) => c.x))) / 2;
const centreY = (Math.min(...cells.map((c) => c.y)) + Math.max(...cells.map((c) => c.y))) / 2;
for (const cell of cells) {
    cell.x -= centreX;
    cell.y -= centreY;
}
const delays = territoryHexSpawnDelays(cells);
const cluster = cells.map((cell) => ({
    cellId: cell.cellId,
    x: round5(cell.x),
    y: round5(cell.y),
    delay: round5(delays.get(cell.cellId) ?? 0),
}));

writeFileSync(OUT, JSON.stringify({
    radius: RADIUS,
    step: STEP,
    constants: {
        seconds: TERRITORY_HEX_SPAWN_SECONDS,
        stagger: TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
        staggerMax: TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
        fromScale: TERRITORY_HEX_SPAWN_FROM_SCALE,
        opacityPortion: TERRITORY_HEX_SPAWN_OPACITY_PORTION,
        batchSeconds: territoryHexSpawnBatchSeconds(cells.length),
        batchCount: cells.length,
    },
    curve,
    cluster,
}, null, 0));

console.log(`wrote ${OUT}: ${curve.length} 个采样点 / ${cluster.length} 格`);
