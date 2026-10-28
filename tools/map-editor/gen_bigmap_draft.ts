/**
 * 生成「大地图初稿」布局（100×100，81 座城由内到外铺开 + 势力范围 + 野怪跟随）。
 *
 * 需求（2026-10-20 第二版）：
 *  · 尺寸 100×100 格；
 *  · 城池数量按《D-大地图城池等级》的等级-数量表：
 *    L1 22 / L2 15 / L3 13 / L4 9 / L5 8 / L6 7 / L7 6 / L8 1（共 81 座）；
 *  · **城池之间最小间距 12 格**（用户口径）—— 见下面的「间距」说明；
 *  · 势力范围格数在该等级 [rangeMin, rangeMax] 之间随机；
 *  · 等级越高越靠中心（王座居中，外面依次是战盟 / 联盟 / 个人圈）；
 *  · 野怪**每级 12 只**（共 60 只），跟着同等级城池的势力范围**散落在全图各区**。
 *
 * ## 间距这条约束算过账，必须说清楚
 *
 * 100×100 = 10000 格；六边格里「两两间距 ≥ D」的极限密度约 `D²·√3/2` 格/座：
 *  · D=12 ⇒ 每座占 ~124.7 格 ⇒ 上限约 **80 座**，还要扣边界损耗，贪心实测只放得下 **75 座**；
 *  · D=11 ⇒ 刚好放得下 **81 座**。
 * 也就是说「81 座」与「间距 ≥ 12」在 100×100 里**物理上不能同时成立**。
 * 本脚本的选择：**保住 81 座（用户给的等级-数量表）**，间距自动取「81 座能取到的最大值」（当前 11）。
 * 要严格 12 格间距，把 `MIN_CITY_DISTANCE` 改成 12 并把 L1 数量从 22 减到 16（总数 75）。
 *
 * 用法：
 *     npx tsx tools/map-editor/gen_bigmap_draft.ts [输出名] [种子]
 *     npx tsx tools/map-editor/gen_bigmap_draft.ts dadi_tuchugao 20261020
 *
 * 产物：`tools/map-editor/presets/bigmap/<名>.json`（编辑器「预设」下拉里直接可选）。
 *
 * ⚠️ 预设文件名只能用 `[A-Za-z0-9_-]`（`server.mjs` 的 `idPattern` 会用它拼文件名）：中文名放在
 *    `worldName` 里，编辑器下拉显示「大地图初稿」。
 *
 * ⚠️ 城池 id 用 **2001 起**、按「等级从高到低」分配，与 `D-大地图城池.xlsx` / `bigmapCity` **逐座对齐**。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hexGridNeighborIds } from '../../assets/script/core/hex/HexGridLayout';
import { parseBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';

const here = dirname(resolve(process.argv[1] ?? join(process.cwd(), 'gen_bigmap_draft.ts')));

const outputName = process.argv[2] ?? 'dadi_tuchugao';
const seed = Number(process.argv[3] ?? 20261020);
if (!/^[A-Za-z0-9_-]+$/.test(outputName)) {
    throw new Error(`输出名只允许字母/数字/下划线/连字符，收到 ${outputName}`);
}
if (!Number.isInteger(seed)) throw new Error(`种子必须是整数，收到 ${process.argv[3]}`);

const ROWS = 100;
const COLUMNS = 100;
const FIRST_CITY_ID = 2001;

/**
 * 用户要求的城池最小间距（格）。放不下 81 座时自动降档，见文件头说明。
 *
 * 取 **10**（用户区间 10~15 的下界）：先按 10 铺满 81 座（这是唯一能放下 81 座的档位），
 * 再对每座城做一次「±1 格抖动」，让实际间距散在 10~13 之间，而不是全体整齐的 11。
 */
const MIN_CITY_DISTANCE = 10;

/** 等级 → 数量 / 势力范围格数区间。 */
const CITY_PLAN = [
    { level: 8, count: 1, range: [17, 23] },
    { level: 7, count: 6, range: [17, 23] },
    { level: 6, count: 7, range: [20, 30] },
    { level: 5, count: 8, range: [20, 30] },
    { level: 4, count: 9, range: [20, 30] },
    { level: 3, count: 13, range: [20, 30] },
    { level: 2, count: 15, range: [25, 35] },
    { level: 1, count: 22, range: [25, 35] },
] as const;

const CITY_TOTAL = CITY_PLAN.reduce((sum, plan) => sum + plan.count, 0);

/** 城池占格：文档「据点占 4 格」，王座 6 格。 */
const CITY_FOOTPRINT = 4;
const THRONE_FOOTPRINT = 6;

/** 野怪：每级 12 只（用户 2026-10-20 口径），配置表里该级的 monsterId 循环复用。 */
const MONSTERS_PER_LEVEL = 12;
const MONSTER_IDS_BY_LEVEL: Record<number, number[]> = {
    1: [8001, 8002, 8003, 8004, 8005, 8006],
    2: [8007, 8008, 8009, 8010, 8011],
    3: [8012, 8013, 8014, 8015],
    4: [8016, 8017, 8018],
    5: [8019, 8020],
};
const MONSTER_OCCUPY: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4 };

/** 可复现的伪随机（线性同余）：同种子必得同一张图，便于和策划对图。 */
function makeRandom(initial: number): () => number {
    let state = initial >>> 0;
    return (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}
const random = makeRandom(seed);
const randInt = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

const rowOf = (hexId: number): number => Math.floor(hexId / COLUMNS);
const colOf = (hexId: number): number => hexId % COLUMNS;
const hexIdOf = (row: number, col: number): number => row * COLUMNS + col;
const inBounds = (row: number, col: number): boolean => row >= 0 && row < ROWS && col >= 0 && col < COLUMNS;

/** offset(odd-r) → axial。**中心必须取整数格**：100 列时几何中心在 49.5，带 .5 会让环号变半整数。 */
const CENTER_ROW = Math.floor((ROWS - 1) / 2);
const CENTER_COL = Math.floor((COLUMNS - 1) / 2);
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
const CENTER_HEX = CENTER_ROW * COLUMNS + CENTER_COL;
const ringOf = (hexId: number): number => hexDistance(hexId, CENTER_HEX);

const totalCells = ROWS * COLUMNS;
const taken = new Set<number>();

/** 从锚点向外 BFS 抢 size 格（与 `BigMapWorld.claimFootprint` 同口径）。 */
function claimFootprint(anchor: number, size: number): number[] {
    const claimed: number[] = [];
    const queue: number[] = [anchor];
    while (queue.length > 0 && claimed.length < size) {
        const hexId = queue.shift()!;
        if (taken.has(hexId) || !inBounds(rowOf(hexId), colOf(hexId))) continue;
        taken.add(hexId);
        claimed.push(hexId);
        for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
            if (!taken.has(neighbor)) queue.push(neighbor);
        }
    }
    return claimed;
}

/**
 * 从中心往外做「最远点式」贪心铺点：按环号升序扫全图，只有与已选点距离 ≥ distance 才收。
 * 扫描顺序就是内→外，落位天然是**同心的**，等级也就能按环号顺序分配。
 */
function packCenters(distance: number, limit: number): number[] {
    const cells: number[] = [];
    for (let hexId = 0; hexId < totalCells; hexId += 1) cells.push(hexId);
    cells.sort((a, b) => ringOf(a) - ringOf(b) || a - b);
    const chosen: number[] = [];
    for (const hexId of cells) {
        if (chosen.length >= limit) break;
        let ok = true;
        for (const other of chosen) {
            if (hexDistance(hexId, other) < distance) { ok = false; break; }
        }
        if (ok) chosen.push(hexId);
    }
    return chosen;
}

/** 从用户要求的值往下找「能放下 81 座」的最大间距。 */
let minDistance = MIN_CITY_DISTANCE;
let centers = packCenters(minDistance, CITY_TOTAL);
if (centers.length < CITY_TOTAL) {
    for (let distance = MIN_CITY_DISTANCE - 1; distance >= 6; distance -= 1) {
        minDistance = distance;
        centers = packCenters(distance, CITY_TOTAL);
        if (centers.length >= CITY_TOTAL) break;
    }
}
if (centers.length < CITY_TOTAL) {
    throw new Error(`间距降到 ${minDistance} 仍只放得下 ${centers.length} 座城（需要 ${CITY_TOTAL}）`);
}
centers = centers.slice(0, CITY_TOTAL);

// 抖动：每座城在自己的六邻格里试挪一格，只要保证「与所有其他城仍 ≥ MIN_CITY_DISTANCE」就接受。
// 目的是让间距散在 10~13（用户区间 10~15），而不是所有城整齐地排成 11。
for (let index = 0; index < centers.length; index += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const neighbors = hexGridNeighborIds(centers[index], ROWS, COLUMNS);
        if (neighbors.length === 0) break;
        const candidate = neighbors[randInt(0, neighbors.length - 1)];
        let ok = true;
        for (let other = 0; other < centers.length; other += 1) {
            if (other === index) continue;
            if (hexDistance(candidate, centers[other]) < MIN_CITY_DISTANCE) { ok = false; break; }
        }
        if (ok) { centers[index] = candidate; break; }
    }
}

/**
 * 城池编号 = **纯数字拼接**（用户 2026-10-27）：章节数字直接衔关卡数字，关卡不足两位补 0。
 *
 * | 旧 | 新 | 说明 |
 * | --- | --- | --- |
 * | `1-1` | `101` | 拼完只有 2 位 ⇒ 中间补 0 |
 * | `1-11` | `111` | 拼完 3 位 ⇒ 只是删掉横杠 |
 *
 * 等价于"章节 + 关卡补足两位"，章节 1~8、关卡 ≤ 99 时恒为 3 位、不带任何分隔符
 * （地图上的编号气泡只有一格宽，`1-1` 的横杠会把编号挤成两行）。
 *
 * ⚠️ 改这里要同步 `presets/bigmap/*.json` 里的存量数据；`tools/build_camp81.py` 两种格式都认。
 */
function cityLabel(level: number, index: number): string {
    return `${level}${String(index).padStart(2, '0')}`;
}

interface ICityDraft {
    cityId: number;
    level: number;
    label: string;
    anchorHexId: number;
    hexIds: number[];
    ring: number;
    rangeHex: number[];
    adjacentCityIds: number[];
}

const cities: ICityDraft[] = [];
let nextCityId = FIRST_CITY_ID;
let cursor = 0;
for (const plan of CITY_PLAN) {
    for (let index = 0; index < plan.count; index += 1) {
        const anchor = centers[cursor];
        cursor += 1;
        const footprintSize = plan.level === 8 ? THRONE_FOOTPRINT : CITY_FOOTPRINT;
        const claimed = claimFootprint(anchor, footprintSize);
        if (claimed.length < footprintSize) {
            throw new Error(`L${plan.level} 第 ${index + 1} 座城占不到 ${footprintSize} 格（锚点 ${anchor}）`);
        }
        cities.push({
            cityId: nextCityId,
            level: plan.level,
            label: cityLabel(plan.level, index + 1),
            anchorHexId: claimed[0],
            hexIds: claimed,
            ring: Math.round(ringOf(claimed[0])),
            rangeHex: [],
            adjacentCityIds: [],
        });
        nextCityId += 1;
    }
}

// ── 势力范围：**先把中间地带按中线均分，再各自补足/裁剪** ──────────────────────
//
// 用户口径（2026-10-20 v3）：
//  · 城池间距 10~15 格；
//  · 势力范围**必须彼此相接**（不能各长各的圆点，中间留一圈野地）；
//  · 会超过该等级上限时，**中间地带均分**（各让一半，不是一方吃掉另一方）；
//  · 多出来的格子**优先并给低级城**。
//
// 做法分四步：
//  ① **走廊**：对每一对距离 ≤ MAX_LINK 的城画一条六边格直线，直线上的格子按「离谁更近」判给谁
//     （等距就判给等级更低的 —— 这就是「中间地带均分」+「偏向低级」）；
//  ② **补足下限**：所有城从自己的格子向外做一轮 BFS，只吃没人认领的格子，直到达到该级区间下限；
//  ③ **削到上限**：超过上限的城，把**离自己最远**的格子让给相邻的低级城（对方没满就收），
//     没人收就退回野地；
//  ④ 剩下的没被认领的格子留作野地，不再强塞。
const cityCells = new Set<number>();
for (const city of cities) for (const hexId of city.hexIds) cityCells.add(hexId);

const MAX_LINK = 15;          // 超过这个距离就不算「邻居」，不画走廊
const rangeOf = new Map<number, Set<number>>();
for (const city of cities) rangeOf.set(city.cityId, new Set<number>(city.hexIds));
/** 走廊骨架：这些格子是「通向邻城」的连接点，削到上限时**最后才让**（先让会断开相接）。 */
const spineOf = new Map<number, Set<number>>();
for (const city of cities) spineOf.set(city.cityId, new Set<number>());
const levelOf = new Map<number, number>();
for (const city of cities) levelOf.set(city.cityId, city.level);
const rangeLimit = new Map<number, readonly [number, number]>();
for (const city of cities) {
    const plan = CITY_PLAN.find((item) => item.level === city.level)!;
    rangeLimit.set(city.cityId, plan.range);
}

/** 六边格直线（cube lerp）：返回 a→b 途经的格子，含两端。 */
function lineCells(a: number, b: number): number[] {
    const toCube = (hexId: number): { x: number; y: number; z: number } => {
        const { q, s } = axialOf(hexId);
        return { x: q, y: -q - s, z: s };
    };
    const pa = toCube(a);
    const pb = toCube(b);
    const steps = hexDistance(a, b);
    if (steps === 0) return [a];
    const round = (v: number): number => Math.round(v);
    const out: number[] = [];
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        let x = pa.x + (pb.x - pa.x) * t;
        let y = pa.y + (pb.y - pa.y) * t;
        let z = pa.z + (pb.z - pa.z) * t;
        let rx = round(x);
        let ry = round(y);
        let rz = round(z);
        const dx = Math.abs(rx - x);
        const dy = Math.abs(ry - y);
        const dz = Math.abs(rz - z);
        if (dx > dy && dx > dz) rx = -ry - rz;
        else if (dy > dz) ry = -rx - rz;
        else rz = -rx - ry;
        // cube → axial：q = x、r = z；axial → offset(odd-r)：row = r + (q + (q&1)) / 2
        const col = rx;
        const row = rz + (rx + (((rx % 2) + 2) % 2)) / 2;
        if (inBounds(row, col)) out.push(hexIdOf(row, col));
    }
    return out;
}

// ① 先定「连哪几个邻居」：每座城只连**最近的 K 个**（距离 ≤ MAX_LINK）。
//    全都连的话，6 个邻居 × 每对 5 格走廊 + 4 格本体 = 34 格，直接顶穿上限 30 ——
//    范围会全部被削成「刚好 max」的小团，反而看不出相接。
const LINK_NEIGHBORS = 3;
const linkPairs: Array<{ a: ICityDraft; b: ICityDraft; distance: number }> = [];
{
    const linked = new Set<string>();
    for (const city of cities) {
        const nearest = cities
            .filter((other) => other.cityId !== city.cityId)
            .map((other) => ({ other, distance: hexDistance(city.anchorHexId, other.anchorHexId) }))
            .filter((item) => item.distance <= MAX_LINK)
            .sort((a, b) => a.distance - b.distance || a.other.cityId - b.other.cityId)
            .slice(0, LINK_NEIGHBORS);
        for (const item of nearest) {
            const key = city.cityId < item.other.cityId
                ? `${city.cityId}-${item.other.cityId}`
                : `${item.other.cityId}-${city.cityId}`;
            if (linked.has(key)) continue;
            linked.add(key);
            linkPairs.push({
                a: city.cityId < item.other.cityId ? city : item.other,
                b: city.cityId < item.other.cityId ? item.other : city,
                distance: item.distance,
            });
        }
    }
}

// ① 走廊：每对邻居的中间地带按中线分（等距判给等级低的）
for (const { a, b } of linkPairs) {
    {
        for (const hexId of lineCells(a.anchorHexId, b.anchorHexId)) {
            if (cityCells.has(hexId)) continue;        // 城池本体不让
            const da = hexDistance(hexId, a.anchorHexId);
            const db = hexDistance(hexId, b.anchorHexId);
            const owner = da < db ? a.cityId
                : db < da ? b.cityId
                    : (a.level <= b.level ? a.cityId : b.cityId);   // 等距 → 低级优先
            for (const set of rangeOf.values()) set.delete(hexId);
            rangeOf.get(owner)!.add(hexId);
            spineOf.get(owner)!.add(hexId);
        }
    }
}

// ② 补足下限：只吃没人认领的格子，就近扩张（保持连通）
const claimedBy = (hexId: number): number => {
    for (const [cityId, set] of rangeOf) if (set.has(hexId)) return cityId;
    return 0;
};
for (const city of cities) {
    const [min, max] = rangeLimit.get(city.cityId)!;
    // 补到 [min, max] 之间的**随机**目标（不是一律补到 min）：外层城周围野地多，
    // 补到 25~35 就自然有大小差别；内层城走廊已经吃满，第三步会削回上限。
    const min2 = min;
    const target = randInt(min2, max);
    const owned = rangeOf.get(city.cityId)!;
    let guard = 0;
    while (owned.size < target && guard < 400) {
        guard += 1;
        let grew = false;
        for (const hexId of [...owned]) {
            for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
                if (owned.size >= target) break;
                if (cityCells.has(neighbor)) continue;
                if (claimedBy(neighbor) !== 0) continue;
                owned.add(neighbor);
                grew = true;
            }
            if (owned.size >= target) break;
        }
        if (!grew) break;
    }
}

// ③ 削到上限：超出者把**最远**的格子让给相邻的低级城（对方没满就收），没人收就退回野地
for (const city of cities) {
    const [, max] = rangeLimit.get(city.cityId)!;
    const owned = rangeOf.get(city.cityId)!;
    if (owned.size <= max) continue;
    const spine = spineOf.get(city.cityId)!;
    const surplus = [...owned]
        .filter((hexId) => !city.hexIds.includes(hexId))
        // 先让「不在走廊上、又离自己最远」的格子；走廊格子是相接的命根子，最后才动。
        .sort((a, b) => {
            const spineA = spine.has(a) ? 1 : 0;
            const spineB = spine.has(b) ? 1 : 0;
            if (spineA !== spineB) return spineA - spineB;
            return hexDistance(b, city.anchorHexId) - hexDistance(a, city.anchorHexId);
        });
    for (const hexId of surplus) {
        if (owned.size <= max) break;
        // 找接壤的、等级更低、且还没满的邻居城
        let receiver = 0;
        for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
            const owner = claimedBy(neighbor);
            if (!owner || owner === city.cityId) continue;
            if (levelOf.get(owner)! >= city.level) continue;
            const limit = rangeLimit.get(owner)!;
            if (rangeOf.get(owner)!.size >= limit[1]) continue;
            receiver = owner;
            break;
        }
        owned.delete(hexId);
        if (receiver) rangeOf.get(receiver)!.add(hexId);
    }
}

// ④ 修补：削到上限时可能把某座城**通向邻城的走廊尾巴**也削掉了（典型是中心的王座），
//    结果是「范围不与任何城相接」的孤岛。这里补一轮：沿最近的邻城方向，一格一格把
//    无人认领的格子补上；已经顶到上限就先让掉自己最远的一格（换，不超）。
const isOwned = (hexId: number): boolean => claimedBy(hexId) !== 0;
const touches = (city: ICityDraft): number => {
    let count = 0;
    for (const hexId of rangeOf.get(city.cityId)!) {
        for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
            const owner = claimedBy(neighbor);
            if (owner && owner !== city.cityId) { count += 1; break; }
        }
        if (count > 0) break;
    }
    return count;
};
for (const city of cities) {
    const owned = rangeOf.get(city.cityId)!;
    const [, max] = rangeLimit.get(city.cityId)!;
    let guard = 0;
    while (touches(city) === 0 && guard < 10) {
        guard += 1;
        const nearest = cities
            .filter((other) => other.cityId !== city.cityId)
            .sort((a, b) => hexDistance(a.anchorHexId, city.anchorHexId) - hexDistance(b.anchorHexId, city.anchorHexId))[0];
        const path = lineCells(city.anchorHexId, nearest.anchorHexId);
        const candidate = path.find((hexId) => !cityCells.has(hexId) && !isOwned(hexId)
            && hexGridNeighborIds(hexId, ROWS, COLUMNS).some((neighbor) => owned.has(neighbor)));
        if (candidate === undefined) break;
        if (owned.size >= max) {
            const farthest = [...owned]
                .filter((hexId) => !city.hexIds.includes(hexId))
                .sort((a, b) => hexDistance(b, city.anchorHexId) - hexDistance(a, city.anchorHexId))[0];
            if (farthest === undefined || farthest === candidate) break;
            owned.delete(farthest);
        }
        owned.add(candidate);
    }
}

// ⑤ 填洞：走廊围成的闭环里会留出小空腔（截图上就是城与城之间那块「没主的空地」）。
//    把**不与地图边缘连通**的未认领格子全部并给相邻城池：谁的格数少就给谁（并列时给等级低的），
//    这样空腔被均分掉、外界荒野仍然留白（否则整张 100×100 都会被吃掉）。
{
    const ownedNow = (hexId: number): boolean => claimedBy(hexId) !== 0 || cityCells.has(hexId);
    // 从地图边缘往里灌，灌得到的都是「外界荒野」
    const outside = new Set<number>();
    const queue: number[] = [];
    for (let col = 0; col < COLUMNS; col += 1) {
        for (const row of [0, ROWS - 1]) {
            const hexId = hexIdOf(row, col);
            if (!ownedNow(hexId) && !outside.has(hexId)) { outside.add(hexId); queue.push(hexId); }
        }
    }
    for (let row = 0; row < ROWS; row += 1) {
        for (const col of [0, COLUMNS - 1]) {
            const hexId = hexIdOf(row, col);
            if (!ownedNow(hexId) && !outside.has(hexId)) { outside.add(hexId); queue.push(hexId); }
        }
    }
    while (queue.length > 0) {
        const hexId = queue.shift()!;
        for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
            if (outside.has(neighbor) || ownedNow(neighbor)) continue;
            outside.add(neighbor);
            queue.push(neighbor);
        }
    }
    // 剩下的未认领格子 = 闭环内的空腔
    const holes: number[] = [];
    for (let hexId = 0; hexId < totalCells; hexId += 1) {
        if (!ownedNow(hexId) && !outside.has(hexId)) holes.push(hexId);
    }
    const pending = new Set<number>(holes);
    // 由外向内逐圈认领：每格给自己相邻城里「格数最少」的那座（并列取等级低的）
    let guard = 0;
    while (pending.size > 0 && guard < 200) {
        guard += 1;
        let progressed = false;
        for (const hexId of [...pending]) {
            const candidate = new Map<number, number>();   // cityId -> 相邻次数
            for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
                const owner = claimedBy(neighbor);
                if (owner) candidate.set(owner, (candidate.get(owner) ?? 0) + 1);
            }
            if (candidate.size === 0) continue;
            const best = [...candidate.keys()].sort((a, b) => {
                const sizeA = rangeOf.get(a)!.size;
                const sizeB = rangeOf.get(b)!.size;
                if (sizeA !== sizeB) return sizeA - sizeB;
                return levelOf.get(a)! - levelOf.get(b)!;
            })[0];
            rangeOf.get(best)!.add(hexId);
            pending.delete(hexId);
            progressed = true;
        }
        if (!progressed) break;
    }
    // 极端情况：空腔太大、一圈一圈认领没吃完（理论上不会有），剩下的按最近城兜底
    for (const hexId of pending) {
        const nearest = cities.reduce((best, city) => (
            hexDistance(hexId, city.anchorHexId) < hexDistance(hexId, best.anchorHexId) ? city : best
        ), cities[0]);
        rangeOf.get(nearest.cityId)!.add(hexId);
    }
}

for (const city of cities) city.rangeHex = [...rangeOf.get(city.cityId)!].sort((a, b) => a - b);

// ── 相邻：按**范围真实相接**推导（削格/修补之后，谁和谁挨着只有格子说得准）────────
const adjacency = new Map<number, Set<number>>();
for (const city of cities) adjacency.set(city.cityId, new Set());
{
    const ownerOfCell = new Map<number, number[]>();
    for (const city of cities) {
        for (const hexId of city.rangeHex) {
            const list = ownerOfCell.get(hexId) ?? [];
            list.push(city.cityId);
            ownerOfCell.set(hexId, list);
        }
    }
    for (const city of cities) {
        for (const hexId of city.rangeHex) {
            for (const neighbor of hexGridNeighborIds(hexId, ROWS, COLUMNS)) {
                for (const other of ownerOfCell.get(neighbor) ?? []) {
                    if (other === city.cityId) continue;
                    adjacency.get(city.cityId)!.add(other);
                    adjacency.get(other)!.add(city.cityId);
                }
            }
        }
    }
}
for (const city of cities) city.adjacentCityIds = [...adjacency.get(city.cityId)!].sort((x, y) => x - y);

// ── 野怪：每级 12 只，轮流挂到**同等级**城池的势力范围里（散在全图各区）─────────────
function citiesOfLevel(level: number): ICityDraft[] {
    const exact = cities.filter((city) => city.level === level);
    if (exact.length > 0) return exact;
    for (let probe = level + 1; probe <= 8; probe += 1) {
        const pool = cities.filter((city) => city.level === probe);
        if (pool.length > 0) return pool;
    }
    return cities;
}

const monsters: Array<{
    instanceId: number; monsterId: number; level: number; anchorHexId: number; hexIds: number[];
}> = [];
for (let level = 1; level <= 5; level += 1) {
    const pool = citiesOfLevel(level);
    const ids = MONSTER_IDS_BY_LEVEL[level];
    for (let index = 0; index < MONSTERS_PER_LEVEL; index += 1) {
        const city = pool[index % pool.length];
        const monsterId = ids[index % ids.length];
        const free = city.rangeHex.filter((hexId) => !taken.has(hexId));
        const anchor = free.length > 0 ? free[randInt(0, free.length - 1)] : city.anchorHexId;
        const hexIds = claimFootprint(anchor, MONSTER_OCCUPY[level]);
        monsters.push({
            instanceId: monsters.length + 1,
            monsterId,
            level,
            anchorHexId: hexIds[0],
            hexIds,
        });
    }
}

// ── 组装布局 ────────────────────────────────────────────────────────────────
const layout = {
    kind: 'bigmapWorld',
    version: 1,
    layoutVersion: 1,
    worldId: 1,
    worldName: '大地图初稿',
    rows: ROWS,
    columns: COLUMNS,
    terrainSeed: seed,
    terrainOverrides: [],
    cities: cities.map((city) => ({
        cityId: city.cityId,
        anchorHexId: city.anchorHexId,
        hexIds: city.hexIds,
        ring: city.ring,
        rangeHex: city.rangeHex,
        adjacentCityIds: city.adjacentCityIds,
        label: city.label,
    })),
    monsters,
    bases: [],
    blocked: [],
    spawnZones: [],
    points: [],
    background: '',
};

// 自证：结构校验（配置表对账留给编辑器「发布」那一步）。
parseBigMapLayout(layout);

const targetDir = join(here, 'presets', 'bigmap');
mkdirSync(targetDir, { recursive: true });
const target = join(targetDir, `${outputName}.json`);
writeFileSync(target, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');

// 实际最小间距：报告里给的是真实值，不是「要求值」。
let achievedMin = Number.POSITIVE_INFINITY;
for (let i = 0; i < cities.length; i += 1) {
    for (let j = i + 1; j < cities.length; j += 1) {
        const distance = hexDistance(cities[i].anchorHexId, cities[j].anchorHexId);
        if (distance < achievedMin) achievedMin = distance;
    }
}

console.log(`已写出 ${target}`);
console.log(`  尺寸 ${ROWS}×${COLUMNS} · 种子 ${seed} · 城池 ${cities.length} 座 · 野怪 ${monsters.length} 只`);
console.log(`  城池最小间距：要求 ${MIN_CITY_DISTANCE}，实际 ${achievedMin}（算法取的档位 ${minDistance}）`);
console.log(`  城池最远环号 ${Math.max(...cities.map((city) => city.ring))}`);
for (const plan of CITY_PLAN) {
    const group = cities.filter((city) => city.level === plan.level);
    const values = group.map((city) => city.rangeHex.length);
    console.log(`  L${plan.level}: ${group.length} 座 · 范围 ${Math.min(...values)}~${Math.max(...values)} 格（目标 ${plan.range[0]}~${plan.range[1]}）`);
}
const perLevel = new Map<number, number>();
for (const monster of monsters) perLevel.set(monster.level, (perLevel.get(monster.level) ?? 0) + 1);
console.log(`  野怪分级 ${[...perLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => `L${level}:${count}`).join(' ')}`);
console.log(`  相邻关系 ${cities.reduce((sum, city) => sum + city.adjacentCityIds.length, 0) / 2} 对`);
