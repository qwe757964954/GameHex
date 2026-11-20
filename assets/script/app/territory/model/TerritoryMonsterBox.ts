/**
 * 章节「怪物宝箱」（协议 `ChapterMonsterBoxInfo`）的解析与合并。
 *
 * 服务端在 `CmdCityChapterCellInfoRspMsg.monsterBoxInfos` 里下发**整章**的宝箱等级，
 * 升级走 `CmdCityChapterUpMonsterBoxLvReqMsg`，回包只带回那一格的**新等级**（`monsterBoxInfo`）。
 * 两处形状相同（`{ cellId, lv }`）⇒ 读法只留这一份，否则「快照里的箱子」与
 * 「升级回包里的箱子」会各解析一遍，脏值口径迟早分叉。
 *
 * 容错策略：怪物宝箱数据为增量属性，脏数据按单条过滤，避免阻断整体快照。
 */

/** 一格怪物宝箱：格子号 + 当前等级。 */
export interface ITerritoryMonsterBox {
    readonly cellId: number;
    readonly lv: number;
}

/**
 * 读一条宝箱；非法（缺字段 / 非整数 / 负数）返回 `null`，由调用方丢弃。
 *
 * `lv` 允许 0：服务端可以下发「已生成但还没算等级」的占位值，
 * 它与"根本没有这条记录"是两件事（后者在集合里查不到）。
 */
export function readTerritoryMonsterBox(raw: unknown): ITerritoryMonsterBox | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as { cellId?: unknown; lv?: unknown };
    const cellId = Number(record.cellId);
    const lv = Number(record.lv);
    if (!Number.isInteger(cellId) || cellId < 0) return null;
    if (!Number.isInteger(lv) || lv < 0) return null;
    return { cellId, lv };
}

/**
 * 读整章宝箱集合。
 *
 * @param maxCell 可选上界（`rows × columns`）：服务端扩容过章节而客户端拿的是旧地图时，
 *   越界的箱子会被裁掉 —— 与 `decodeCellBitSet` 同一条理由，别让 UI 按越界坐标定位。
 */
export function readTerritoryMonsterBoxes(raw: unknown, maxCell?: number): ITerritoryMonsterBox[] {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) return [];
    const limit = typeof maxCell === 'number' && Number.isFinite(maxCell) && maxCell > 0 ? maxCell : Infinity;
    const byCell = new Map<number, ITerritoryMonsterBox>();
    for (const item of raw) {
        const box = readTerritoryMonsterBox(item);
        if (!box || box.cellId >= limit) continue;
        // 同 cellId 重复下发：后一条覆盖前一条（服务端顺序即权威，别自作主张"取大值"）。
        byCell.set(box.cellId, box);
    }
    return [...byCell.values()].sort((a, b) => a.cellId - b.cellId);
}

/**
 * 升级回包落地：同 `cellId` 覆盖，结果按格子号升序。
 *
 * 与 {@link readTerritoryMonsterBoxes} 同形状，这样「快照读出来的」和「升级后合并出的」
 * 两套数据能直接互相替换（`deepEqual` 也能比），不会因顺序不同冒出假差异。
 */
export function withTerritoryMonsterBox(
    boxes: readonly ITerritoryMonsterBox[],
    box: ITerritoryMonsterBox,
): ITerritoryMonsterBox[] {
    const byCell = new Map<number, ITerritoryMonsterBox>();
    for (const item of boxes) byCell.set(item.cellId, item);
    byCell.set(box.cellId, box);
    return [...byCell.values()].sort((a, b) => a.cellId - b.cellId);
}

/**
 * 格子号 → 等级 的查询表（视图状态组装用）。
 *
 * 站点渲染是逐格查询（`O(站点数)`），不要在里面 `find` 一遍数组 —— 那是 `O(n × m)`。
 */
export function territoryMonsterBoxLvByCell(
    boxes: readonly ITerritoryMonsterBox[] | null | undefined,
): ReadonlyMap<number, number> {
    const levels = new Map<number, number>();
    if (!boxes) return levels;
    for (const box of boxes) levels.set(box.cellId, box.lv);
    return levels;
}
