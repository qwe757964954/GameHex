/**
 * 章节选择弹窗的行数据（纯逻辑，**零 `cc` 依赖**，供 Node 用例直接 import）。
 *
 * 口径（2026-11-03 与用户确认）：
 * - 可切章节 = `TerritoryChapterInfoRepository.availableChapters`（服务端下发）；
 * - 列表范围 = `1 .. 全部章节数`（配表 chapterName 定义全集，缺省回落旧口径
 *   「最高可切章节 + 1」）；**未解锁的章节一律占行并显示为锁定**，不做号段空洞跳过；
 * - 行完成度 = 「已**通关**的格子数 / 该章**全部**格子数」（2026-11-05 用户口径：
 *   *「章节完成度指的是章节内的所有格子已经都是通关状态，计算已通过的格子数和占据总格子数的比例」*）。
 *   格子 = 地图 `sites[].cellId`（关卡 / 首领 / 异步据点 / 资源据点 / 宝箱都算格，空格不算 ——
 *   空格永远没有"通关"这回事，把它算进分母会让完成度永远到不了 100%）；
 *   「通关」按**格子外观的同一判据**判（{@link chapterPercentOf}）：自己打通，或同 `configId`
 *   的那一片战斗区域里有一格打通（`TerritoryProgress.isAreaPassed`）—— 否则会出现
 *   「地图上每一格都显示已通关，完成度却是 60%」；
 * - 「已通关」（`cleared`，金色状态块）**不看完成度**：2026-11-04 起章节通关 = 通过本章
 *   最后一个首领关卡（见 `chapterFinalBossCell`），异步据点 / 普通关占没占满都不影响。
 *   判据见 {@link chapterClearedOf}：有首领格就只看那几个格，判不出来才退回完成度 100%；
 *   其余可切章节是 `progress`（绿色），不在 `availableChapters` 里的是 `locked`（铁灰底板 + 挂锁）。
 */

/** 单行状态（值对象；UI 只认这三个值，不自己派生）。 */
export const CHAPTER_SELECT_STATE = {
    locked: 'locked',
    progress: 'progress',
    cleared: 'cleared',
} as const;
export type ChapterSelectState = (typeof CHAPTER_SELECT_STATE)[keyof typeof CHAPTER_SELECT_STATE];

export interface IChapterSelectRow {
    readonly chapterId: number;
    /** 1-based 序号，直接上屏（序号块里的数字）。 */
    readonly index: number;
    readonly title: string;
    /** 已通关格子百分比 0..100；锁定行固定 0。 */
    readonly percent: number;
    readonly state: ChapterSelectState;
    /** 是否当前章节（外侧套金色高亮环）。 */
    readonly current: boolean;
}

/** 弹窗关心的一章地图信息（从地图 JSON 裁剪，避免把整张地图塞进数据里）。 */
export interface IChapterSelectMapInfo {
    readonly name: string;
    /** 本章**全部格子**（地图 `sites[].cellId`）；完成度的分母。 */
    readonly siteCells: readonly number[];
    /**
     * 同一片战斗区域占多格的组（`configId` 相同、`type ∈ {stage, boss, asyncPvp}`）。
     *
     * 一个关卡常常一次占好几格（chapter_01 的 `10005` 就占 7 格），打其中任意一格
     * **整片都显示已通关**。完成度必须跟着这个口径数，否则「地图上每格都通着、
     * 完成度才 6 成」。只收长度 > 1 的组；资源据点（`fixedResource` 同 `configId`
     * 有多格）**不参与** —— 它们是各自独立的据点，与 `TerritoryProgress.areaPeers` 同源。
     */
    readonly areaGroups?: readonly (readonly number[])[];
    /**
     * 本章**最后一个首领关卡**所占的全部格子（代表格 + 同 `configId` 的区域格）。
     *
     * 有它 ⇒ 「已通关」只看这几个格（与 HUD / 切章同一判据，异步据点不参与）；
     * 空 / 缺省 ⇒ 判不出来（配表缺行、地图没配这一关）⇒ 退回老的「完成度 100%」。
     * 缺数据时宁可显示"还没通关"也不要凭"完成度高"就发金牌。
     */
    readonly finalBossCells?: readonly number[];
}

/** 没有地图时序号块标题的兜底文案。 */
export function fallbackChapterTitle(chapterId: number): string {
    return `第 ${chapterId} 章`;
}

/**
 * 这一章里**处于通关状态**的格子集合（与地图上格子的外观同一个判据）。
 *
 * 两条路径，缺一不可：
 *  ① 自己通了（`ownedCells` 里有它）；
 *  ② 同一片战斗区域里有**任何一格**通了 —— `areaGroups` 里那一组的格子全算通，
 *     因为地图上它们本来就会一起变成"已通关"外观（`TerritoryProgress.isAreaPassed`）。
 *
 * 只补"查询态"，不动存档：这里算出来的集合只服务百分比，不会被写回 `ownedCells`。
 */
function passedCellSet(
    map: IChapterSelectMapInfo | null,
    ownedCells: readonly number[],
): Set<number> {
    const owned = new Set(ownedCells);
    const passed = new Set<number>();
    for (const cellId of map?.siteCells ?? []) if (owned.has(cellId)) passed.add(cellId);
    for (const group of map?.areaGroups ?? []) {
        let touched = false;
        for (const cellId of group) {
            if (!owned.has(cellId)) continue;
            touched = true;
            break;
        }
        if (!touched) continue;
        for (const cellId of group) passed.add(cellId);
    }
    return passed;
}

/**
 * 单章完成度百分比 = **已通关格子数 / 本章全部格子数**（2026-11-05 用户口径）。
 *
 * 分母 = 地图里的所有格子（`siteCells`，关卡 / 首领 / 异步据点 / 资源据点 / 宝箱都算），
 * **空格不算** —— 空格没有"通关"这回事，算进去 100% 就永远到不了。
 * 分子 = {@link passedCellSet}：自己通了，或同区域有一格通了（与格子外观同口径）。
 *
 * 分子里的非站点格不计（`ownedCells` 可能混着资源扩散 / 旧档残留）；
 * 分母为 0（地图没站点 / 加载失败）时给 0，不给 NaN。
 */
export function chapterPercentOf(
    map: IChapterSelectMapInfo | null,
    ownedCells: readonly number[],
): number {
    const siteCells = map?.siteCells;
    if (!siteCells || siteCells.length === 0) return 0;
    const passed = passedCellSet(map, ownedCells);
    let hit = 0;
    for (const cellId of siteCells) if (passed.has(cellId)) hit++;
    return Math.max(0, Math.min(100, Math.round((hit / siteCells.length) * 100)));
}

/**
 * 这一章**是否已通关**（弹窗的金色状态块）。
 *
 * 2026-11-04 用户口径：*「章节通关条件：通过该章节的最后 1 个 boss 关卡」*（异步据点不参与）。
 * 所以有 `finalBossCells` 时就**只看那几个格**——完成度 100% 但首领没打（理论上不会出现，
 * 但服务端下发顺序 / 旧档残留都会造成）不算通关；反过来只打了首领、一堆据点没占，也算通关。
 *
 * `finalBossCells` 缺失是"判不出来"，不是"没首领"。缺数据时退回完成度 100%：
 * 显示成"进行中"顶多让金牌晚一格出现，而反向出错会把没打完的章标成已通关。
 */
export function chapterClearedOf(
    map: IChapterSelectMapInfo | null,
    ownedCells: readonly number[],
): boolean {
    const finalBossCells = map?.finalBossCells;
    if (finalBossCells && finalBossCells.length > 0) {
        const owned = new Set(ownedCells);
        return finalBossCells.some((cellId) => owned.has(cellId));
    }
    return chapterPercentOf(map, ownedCells) >= 100;
}

/**
 * 组装弹窗列表。
 *
 * @param availableChapters 服务端可切章节（乱序/重复由调用方归一，这里只做 `includes` 判定）
 * @param currentChapterId 当前章节（画金环）
 * @param maps 已加载到的地图信息；**缺项 = 该章没有地图资源**
 * @param ownedCellsByChapter 各章本地存档的已占领格（完成度的分子取自它 + 区域扩散）
 * @param chapterNames 配表中的章节名称，以 chapterId 对应
 * @param totalChapters 展示的章节总数（配表全集）；缺省回落「最高可切章节 + 1（下一章预告）」旧口径
 */
export function buildChapterSelectRows(
    availableChapters: readonly number[],
    currentChapterId: number,
    maps: ReadonlyMap<number, IChapterSelectMapInfo>,
    ownedCellsByChapter: ReadonlyMap<number, readonly number[]>,
    chapterNames: ReadonlyMap<number, string> = new Map(),
    totalChapters?: number,
): IChapterSelectRow[] {
    const available = new Set(availableChapters);
    let highest = 0;
    for (const chapterId of available) if (chapterId > highest) highest = chapterId;
    const upper = totalChapters ?? Math.max(highest + 1, 1);

    const rows: IChapterSelectRow[] = [];
    for (let chapterId = 1; chapterId <= upper; chapterId++) {
        const unlocked = available.has(chapterId);
        const map = maps.get(chapterId) ?? null;
        const ownedCells = ownedCellsByChapter.get(chapterId) ?? [];
        // 全部章节都占行：未解锁一律显示为锁定；地图有无只影响完成度分母，不影响是否展示。
        const percent = unlocked ? chapterPercentOf(map, ownedCells) : 0;
        rows.push({
            chapterId,
            index: rows.length + 1,
            title: chapterNames.get(chapterId) ?? map?.name ?? fallbackChapterTitle(chapterId),
            percent,
            state: !unlocked
                ? CHAPTER_SELECT_STATE.locked
                : chapterClearedOf(map, ownedCells) ? CHAPTER_SELECT_STATE.cleared : CHAPTER_SELECT_STATE.progress,
            current: chapterId === currentChapterId,
        });
    }
    return rows;
}
