/**
 * 给一份**已有布局**补算「势力范围」（`rangeHex`）与「势力邻接」（`adjacentCityIds`）。
 *
 * ## 为什么要这个工具
 *
 * 2026-10-22 用户口径：「根据 dadi_tuchugao 中每个城池的势力范围，给对应城池势力范围内的
 * 所有地块都上色，现在只有城池所在的地块上了色」。
 *
 * 表现层（`BigMapWorldView`）已经改成按 `rangeHex` 铺色，但**线上布局 `world_01.json`
 * 里每座城的 `rangeHex` 只有 7 格**（城池本体 4 格 + 半圈），`adjacentCityIds` 全是空。
 * 数据不补，代码改得再对，屏幕上也几乎看不出变化。这个工具就是把「整片地」算出来写回去。
 *
 * ## 算法：加权 Voronoi + 连通性修补
 *
 * 1. 每个非边界格，判给 `六边距离 / 权重` 最小的那座城（权重按 `ring` 推：越靠中心越大，
 *    与「等级越高范围越大」的设定同向）。
 * 2. 加一点低频扰动，让边界不是死板的多边形边（扰动幅度小，不产生飞地）。
 * 3. **连通性修补**：万一有城被切出一块飞地，把不含锚点的碎块并给接触最多的邻居。
 *    这条是硬约束 —— 飞地在画面上就是「别人地盘里孤零零一块自己的颜色」。
 * 4. 城池本体（`hexIds`）强制归自己：扰动/取整再怎么抖，城池脚下的格子不能被邻居抢走。
 * 5. 最外一圈留白当荒野（与 `dadi_tuchugao` 同口径）。
 * 6. 邻接**由范围真实相接推导**（两边各有一格互为六邻居），不按锚点距离猜。
 *
 * 全程确定性：同一份输入 + 同一个 `--seed` 必然产出同一份输出，方便 diff。
 *
 * ## 用法
 *
 *     npx tsx tools/map-editor/gen_bigmap_ranges.ts                       # 处理线上 world_01
 *     npx tsx tools/map-editor/gen_bigmap_ranges.ts <布局路径>             # 处理指定布局
 *     npx tsx tools/map-editor/gen_bigmap_ranges.ts <布局> --dry           # 只算不写盘
 *     npx tsx tools/map-editor/gen_bigmap_ranges.ts <布局> --border=2      # 荒野留 2 圈
 *     npx tsx tools/map-editor/gen_bigmap_ranges.ts <布局> --noise=0       # 边界拉直
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexGridNeighborIds } from '../../assets/script/core/hex/HexGridLayout';
import { parseBigMapLayout, type IBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';

const here = dirname(resolve(process.argv[1] ?? join(process.cwd(), 'gen_bigmap_ranges.ts')));
const DEFAULT_LAYOUT = join(here, '../../assets/resources/config/bigmap-maps/world_01.json');

const args = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const arg of args) {
    if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        flags.set(key, value ?? 'true');
    } else {
        positional.push(arg);
    }
}

const layoutPath = resolve(positional[0] ?? DEFAULT_LAYOUT);
const dryRun = flags.has('dry');
/** 荒野留几圈（最外这些格不归属任何城）。 */
const BORDER = Number(flags.get('border') ?? 1);
/** 边界扰动幅度（单位：格）。0 = 完全按加权 Voronoi，边界是直线段的拼接。 */
const NOISE = Number(flags.get('noise') ?? 1.1);

const raw = JSON.parse(readFileSync(layoutPath, 'utf8')) as Record<string, unknown>;
/** 先过一遍校验：脏布局（越界/重叠/外键缺失）在这里就炸，不要写出一份更难查的数据。 */
const layout: IBigMapLayout = parseBigMapLayout(raw);

const ROWS = layout.rows;
const COLUMNS = layout.columns;
const TOTAL = ROWS * COLUMNS;
const rowOf = (hexId: number): number => Math.floor(hexId / COLUMNS);
const colOf = (hexId: number): number => hexId % COLUMNS;
const hexIdOf = (row: number, col: number): number => row * COLUMNS + col;

/** offset(odd-r) → axial，与 `HexGridLayout` 的相位一致。 */
function axialOf(hexId: number): { q: number; s: number } {
    const row = rowOf(hexId);
    const col = colOf(hexId);
    return { q: col, s: row - (col + (col & 1)) / 2 };
}

function hexDistance(a: number, b: number): number {
    const p = axialOf(a);
    const q = axialOf(b);
    const dq = p.q - q.q;
    const ds = p.s - q.s;
    return (Math.abs(dq) + Math.abs(ds) + Math.abs(dq + ds)) / 2;
}

interface ICity {
    readonly cityId: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
    readonly ring: number;
}

const cities: ICity[] = layout.cities.map((city) => ({
    cityId: city.cityId,
    anchorHexId: city.hexIds[0],
    hexIds: [...city.hexIds],
    ring: city.ring,
}));

/**
 * 抢地权重：`ring` 0（王座，图中心）→ 2.0，最外圈 → 1.0。
 *
 * 权重是分母，越大越占便宜 ⇒ 中心城范围约是外圈的两倍，与「等级越高、越靠中心、范围越大」同向。
 */
const weightOf = new Map<number, number>();
{
    const rings = cities.map((city) => city.ring);
    const minRing = Math.min(...rings);
    const maxRing = Math.max(...rings);
    // 全部城池同 ring（脏数据）时 span 会是 0，兜成 1 保证权重恒为 1，不抛也不除零。
    const span = Math.max(1, maxRing - minRing);
    for (const city of cities) weightOf.set(city.cityId, 1 + (maxRing - city.ring) / span);
}

// ── ① 逐个非边界格判归属 ────────────────────────────────────────────────
const ownerOf = new Int32Array(TOTAL).fill(0); // 0 = 未归属
const borderCells = new Set<number>();
for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
        if (row < BORDER || col < BORDER || row >= ROWS - BORDER || col >= COLUMNS - BORDER) {
            borderCells.add(hexIdOf(row, col));
        }
    }
}

for (let hexId = 0; hexId < TOTAL; hexId += 1) {
    if (borderCells.has(hexId)) continue;
    let bestId = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const city of cities) {
        const weight = weightOf.get(city.cityId) ?? 1;
        // 低频扰动：两个正弦叠加，看的是**格坐标**而不是格 id，所以边界会平滑地弯。
        const wobble = NOISE * (
            Math.sin(colOf(hexId) * 0.55 + city.cityId * 0.37)
            + Math.cos(rowOf(hexId) * 0.47 + city.cityId * 0.61)
        ) * 0.5;
        const score = hexDistance(hexId, city.anchorHexId) / weight + wobble;
        if (score < bestScore - 1e-9) {
            bestScore = score;
            bestId = city.cityId;
        }
    }
    ownerOf[hexId] = bestId;
}

// ── ② 城池本体强制归自己 ───────────────────────────────────────────────
for (const city of cities) {
    for (const hexId of city.hexIds) ownerOf[hexId] = city.cityId;
}

// ── ③ 连通性修补：飞地并给接触最多的邻居 ───────────────────────────────
function componentsOf(cityId: number): number[][] {
    const cells: number[] = [];
    for (let hexId = 0; hexId < TOTAL; hexId += 1) if (ownerOf[hexId] === cityId) cells.push(hexId);
    const seen = new Set<number>();
    const result: number[][] = [];
    for (const start of cells) {
        if (seen.has(start)) continue;
        const group: number[] = [];
        const queue = [start];
        seen.add(start);
        while (queue.length > 0) {
            const current = queue.pop()!;
            group.push(current);
            for (const neighbor of hexGridNeighborIds(current, ROWS, COLUMNS)) {
                if (seen.has(neighbor) || ownerOf[neighbor] !== cityId) continue;
                seen.add(neighbor);
                queue.push(neighbor);
            }
        }
        result.push(group);
    }
    return result;
}

for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (const city of cities) {
        const groups = componentsOf(city.cityId);
        if (groups.length <= 1) continue;
        const main = groups.reduce((a, b) => (a.length >= b.length ? a : b));
        for (const group of groups) {
            if (group === main) continue;
            // 这块碎地四周谁占得多就给谁（并列取 cityId 小的，保证确定性）
            const contact = new Map<number, number>();
            for (const hexId of group) {
                for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
                    const other = ownerOf[neighbor];
                    if (!other || other === city.cityId) continue;
                    contact.set(other, (contact.get(other) ?? 0) + 1);
                }
            }
            const target = [...contact.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))[0];
            // 四周全是荒野（或自己）就留在原主，别把碎块丢给不存在的邻居
            if (!target || contact.size === 0) continue;
            for (const hexId of group) ownerOf[hexId] = target[0];
            moved = true;
        }
    }
    if (!moved) break;
}

// ── ④ 收尾：算出 rangeHex 与邻接 ────────────────────────────────────────
const rangeOf = new Map<number, number[]>();
for (const city of cities) rangeOf.set(city.cityId, []);
for (let hexId = 0; hexId < TOTAL; hexId += 1) {
    const owner = ownerOf[hexId];
    if (owner) rangeOf.get(owner)!.push(hexId);
}

const adjacency = new Map<number, Set<number>>();
for (const city of cities) adjacency.set(city.cityId, new Set());
for (let hexId = 0; hexId < TOTAL; hexId += 1) {
    const owner = ownerOf[hexId];
    if (!owner) continue;
    for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
        const other = ownerOf[neighbor];
        if (!other || other === owner) continue;
        adjacency.get(owner)!.add(other);
        adjacency.get(other)!.add(owner);
    }
}

const isolated = cities.filter((city) => (adjacency.get(city.cityId)?.size ?? 0) === 0);
if (isolated.length > 0) {
    console.warn(`⚠️ 有 ${isolated.length} 座城没有任何邻接：${isolated.map((c) => c.cityId).join(',')}`
        + '（四周全是荒野或被包住，染色会退化成单色，检查一下城池间距）');
}

// ── ⑤ 写回 ──────────────────────────────────────────────────────────────
const citiesRaw = raw.cities as Array<Record<string, unknown>>;
for (const entry of citiesRaw) {
    const cityId = Number(entry.cityId);
    const range = [...(rangeOf.get(cityId) ?? [])].sort((a, b) => a - b);
    // 城池本体必须落在自己的范围里（表现层按范围铺色，本体不在范围里就会出现"城墙没色"）
    for (const hexId of (entry.hexIds as number[]) ?? []) {
        if (!range.includes(hexId)) range.push(hexId);
    }
    range.sort((a, b) => a - b);
    entry.rangeHex = range;
    entry.adjacentCityIds = [...(adjacency.get(cityId) ?? [])].sort((a, b) => a - b);
}

const sizes = cities.map((city) => rangeOf.get(city.cityId)?.length ?? 0);
const degrees = cities.map((city) => adjacency.get(city.cityId)?.size ?? 0);
const claimed = sizes.reduce((sum, size) => sum + size, 0);
console.log(`布局：${layoutPath}`);
console.log(`  ${ROWS}×${COLUMNS}=${TOTAL} 格，${cities.length} 座城，荒野留 ${BORDER} 圈（${borderCells.size} 格）`);
console.log(`  势力范围：${claimed} 格（占地 ${(claimed / TOTAL * 100).toFixed(1)}%），`
    + `每座 ${Math.min(...sizes)}~${Math.max(...sizes)} 格，均值 ${(claimed / cities.length).toFixed(1)}`);
console.log(`  邻接度：${Math.min(...degrees)}~${Math.max(...degrees)}`);
console.log(`  连通块检查：${cities.every((city) => componentsOf(city.cityId).length === 1) ? '全部单块 ✓' : '仍有飞地 ✗'}`);

if (dryRun) {
    console.log('  --dry：不写盘');
} else {
    const outPath = flags.has('out') ? resolve(flags.get('out')!) : layoutPath;
    writeFileSync(outPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    console.log(`  已写回：${outPath}`);
}
