/**
 * 势力配色 —— **纯 TS，零 `cc` 依赖**。
 *
 * 口径（2026-10-21 用户要求）：每个城池占据的势力范围都要染色，**相邻的势力必须不同色**。
 *
 * 这就是图着色问题：城池 = 顶点，两块地「够近」= 有边。为什么不用 `cityId % 色板长度`：
 * 城池在环上按 slot 等分排布（见 `BigMapWorld.ts` 的 `pickRingAnchor`），取模必然让环上
 * 相邻两座城撞色，而且换一座城的 id 就会整片错位。这里用 **DSATUR**（饱和度高优先）贪心：
 * 每次先染「已染邻居颜色种类最多」的那块，平面图上 4 色就够，色板给 6~8 个绰绰有余。
 *
 * 只在 `build` 时算一次（世界是只读快照，城池占格不会变），渲染层缓存结果。
 *
 * 2026-10-28 追加口径：色板只服务**无主**势力；己方占的城染绿、其他玩家占的城染红
 * （`bigMapTerritoryOwnerOf`）。所以色板里不能再出现红族/绿族，否则归属和势力编号混在一起。
 */

/** 一块势力范围（城池）。 */
export interface ITerritoryColorRegion {
    /** 唯一 id（城池 id）。 */
    readonly id: number;
    /** 该势力占的格子。 */
    readonly hexIds: readonly number[];
}

/**
 * 势力归属类别（2026-10-28 用户口径）。
 *
 * - `self`：**我占据**的城池 → 整片范围染绿；
 * - `other`：**其他玩家**占据的城池 → 整片范围染红；
 * - `neutral`：无主 → 按 `BIGMAP_TERRITORY_COLORS` 上色（相邻不同色）。
 *
 * 为什么要有这一层而不是在视图里直接判 `state === 'occupied'`：
 * 「被占」和「我占的」在联机档是两件事 —— 服务端 `CmdSlgCampInfo` 只给 `opType = 1`（有人占），
 * 归属要看 `SlgGameInfo.toCampId`。放在纯模型里，三种归属的口径只有一处。
 */
export type BigMapTerritoryOwner = 'self' | 'other' | 'neutral';

/**
 * 一座城的势力范围该归属到哪一类颜色。
 *
 * @param mine    这座城就是「我所在的城」。联机档 = `SlgGameInfo.toCampId === cityId`；
 *                离线档没有 `toCampId`，拿本地进度里的「已占领」当己方（那本来就是我打的）。
 * @param occupied 这座城已经被某个玩家占据（联机档 `opType === 1`，离线档 `state === 'occupied'`）。
 *
 * 两个入参分开传：`occupied && !mine` 才是「其他玩家占的」，
 * 合成一个 bool 就没法区分「我占的」和「别人占的」，红绿必然反过来。
 */
export function bigMapTerritoryOwnerOf(mine: boolean, occupied: boolean): BigMapTerritoryOwner {
    if (mine) return 'self';
    return occupied ? 'other' : 'neutral';
}

/**
 * 玩家基地该用哪一块势力色 —— 服务器 `SlgGameInfo.toCampId` 指向的城池**就是**基地所属势力。
 *
 * 口径（2026-10-23 山猫）：*「染成所属城池的势力色，后端给城池 id，城池 id 在配置表，
 * 地图会配置城池 id，从地图查找到，那个就是大地图的基地。」*
 * 所以这里不自己算距离、不猜最近城，只做「拿 id 去色槽表里查」这一件事。
 *
 * @param campId 我所处的城池 id（0 = 未收到包 / 服务端明确未归属）
 * @param slots  城池 id → 色板下标（`assignTerritoryColorSlots*` 的产物）
 * @returns 色板下标；`null` = 没有归属（或该城不在地图上），调用方回退兜底色
 */
export function bigMapPlayerBaseColorSlot(
    campId: number,
    slots: ReadonlyMap<number, number>,
): number | null {
    if (!Number.isInteger(campId) || campId <= 0) return null;
    const slot = slots.get(campId);
    return slot === undefined ? null : slot;
}

/**
 * 给每个势力分配一个色板下标（**靠距离猜邻接**，种子世界的兜底）。
 *
 * @param regions      势力集合（顺序无关，结果只跟几何关系有关）。
 * @param distance     两格之间的六边距离（`bigMapHexDistance`）。
 * @param paletteSize  色板长度；超出时退回 `序号 % paletteSize`（不会崩，只是可能撞色）。
 * @param neighborGap  两格距离 ≤ 这个值就算「相邻」。默认 2：贴身算，中间隔一格也算
 *                     —— 隔一格的两块地在视觉上仍然挨着，同色会连成一片看不出边界。
 * @returns id → 色板下标
 */
export function assignTerritoryColorSlots(
    regions: readonly ITerritoryColorRegion[],
    distance: (a: number, b: number) => number,
    paletteSize: number,
    neighborGap = 2,
): Map<number, number> {
    const neighbors = regions.map(() => [] as number[]);
    for (let i = 0; i < regions.length; i += 1) {
        for (let j = i + 1; j < regions.length; j += 1) {
            if (!isNeighbor(regions[i].hexIds, regions[j].hexIds, distance, neighborGap)) continue;
            neighbors[i].push(j);
            neighbors[j].push(i);
        }
    }
    return colorGraph(regions, neighbors, paletteSize);
}

/**
 * 给每个势力分配色板下标（**用编辑器推导好的邻接表**，有布局时的首选）。
 *
 * 为什么优先这个：势力范围形状不规则、还会互相咬合，「锚点距离 ≤ N」这种几何近似必然有例外
 * （两片贴在一起但锚点隔着 6 格 ⇒ 判成不相邻 ⇒ 撞色）。布局里的 `adjacentCityIds`
 * 是编辑器按**范围实际邻接**推出来的，直接信它。
 *
 * @param neighborsOf id → 相邻 id 列表（不认识的 id 会被忽略）。
 */
export function assignTerritoryColorSlotsFromAdjacency(
    regions: readonly ITerritoryColorRegion[],
    neighborsOf: (id: number) => readonly number[],
    paletteSize: number,
): Map<number, number> {
    const indexById = new Map<number, number>();
    regions.forEach((region, index) => indexById.set(region.id, index));
    const neighbors = regions.map((region) => neighborsOf(region.id)
        .map((id) => indexById.get(id))
        .filter((index): index is number => index !== undefined && index >= 0));
    return colorGraph(regions, neighbors, paletteSize);
}

/**
 * DSATUR 贪心着色（两个入口共用）。
 *
 * 每次先染「已染邻居颜色种类最多」的那块（饱和度优先），平手再取邻居多的 ——
 * 平面图上 4 色够用，色板给 6~8 个绰绰有余。
 */
function colorGraph(
    regions: readonly ITerritoryColorRegion[],
    neighbors: readonly (readonly number[])[],
    paletteSize: number,
): Map<number, number> {
    const result = new Map<number, number>();
    if (regions.length === 0 || paletteSize <= 0) return result;

    const count = regions.length;
    const slots = new Array<number>(count).fill(-1);
    for (let step = 0; step < count; step += 1) {
        let pick = -1;
        let pickSaturation = -1;
        let pickDegree = -1;
        for (let i = 0; i < count; i += 1) {
            if (slots[i] >= 0) continue;
            const saturation = distinctNeighborColors(neighbors[i], slots);
            const degree = neighbors[i].length;
            if (saturation > pickSaturation || (saturation === pickSaturation && degree > pickDegree)) {
                pick = i;
                pickSaturation = saturation;
                pickDegree = degree;
            }
        }
        if (pick < 0) break;

        const taken = new Set<number>();
        for (const neighbor of neighbors[pick]) {
            if (slots[neighbor] >= 0) taken.add(slots[neighbor]);
        }
        let slot = 0;
        while (slot < paletteSize && taken.has(slot)) slot += 1;
        slots[pick] = slot < paletteSize ? slot : pick % paletteSize;
    }

    regions.forEach((region, index) => result.set(region.id, slots[index]));
    return result;
}

function isNeighbor(
    a: readonly number[],
    b: readonly number[],
    distance: (x: number, y: number) => number,
    gap: number,
): boolean {
    for (const from of a) {
        for (const to of b) {
            if (distance(from, to) <= gap) return true;
        }
    }
    return false;
}

function distinctNeighborColors(neighbors: readonly number[], slots: readonly number[]): number {
    const seen = new Set<number>();
    for (const neighbor of neighbors) {
        const slot = slots[neighbor];
        if (slot >= 0) seen.add(slot);
    }
    return seen.size;
}
