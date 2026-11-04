/**
 * 章节选择弹窗的行数据（纯逻辑，**零 `cc` 依赖**，供 Node 用例直接 import）。
 *
 * 口径（2026-11-03 与用户确认）：
 * - 可切章节 = `TerritoryChapterInfoRepository.availableChapters`（服务端下发）；
 * - 列表范围 = `1 .. 全部章节数`（配表 chapterName 定义全集，缺省回落旧口径
 *   「最高可切章节 + 1」）；**未解锁的章节一律占行并显示为锁定**，不做号段空洞跳过；
 * - 行完成度 = 「已占领站点数 / 该章站点总数」（站点 = 地图 `sites[].cellId`），
 *   与 HUD 的「已占领 x/y」同一类占领口径，但分母换成了**本章站点数**（HUD 用的是关卡数）；
 * - 100% 视同通关（`cleared`，金色状态块），其余可切章节是 `progress`（绿色），
 *   不在 `availableChapters` 里的是 `locked`（铁灰底板 + 挂锁）。
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
    /** 已占领站点百分比 0..100；锁定行固定 0。 */
    readonly percent: number;
    readonly state: ChapterSelectState;
    /** 是否当前章节（外侧套金色高亮环）。 */
    readonly current: boolean;
}

/** 弹窗关心的一章地图信息（从地图 JSON 裁剪，避免把整张地图塞进数据里）。 */
export interface IChapterSelectMapInfo {
    readonly name: string;
    /** 本章全部站点代表格；完成度的分母。 */
    readonly siteCells: readonly number[];
}

/** 没有地图时序号块标题的兜底文案。 */
export function fallbackChapterTitle(chapterId: number): string {
    return `第 ${chapterId} 章`;
}

/**
 * 单章完成度百分比。
 *
 * 分子只数**站点格**（`ownedCells` 里可能混着非站点格：资源点扩散、旧档残留），
 * 分母为 0（地图没站点 / 加载失败）时给 0，不给 NaN。
 */
export function chapterPercentOf(
    map: IChapterSelectMapInfo | null,
    ownedCells: readonly number[],
): number {
    const siteCells = map?.siteCells;
    if (!siteCells || siteCells.length === 0) return 0;
    const owned = new Set(ownedCells);
    let hit = 0;
    for (const cellId of siteCells) if (owned.has(cellId)) hit++;
    return Math.max(0, Math.min(100, Math.round((hit / siteCells.length) * 100)));
}

/**
 * 组装弹窗列表。
 *
 * @param availableChapters 服务端可切章节（乱序/重复由调用方归一，这里只做 `includes` 判定）
 * @param currentChapterId 当前章节（画金环）
 * @param maps 已加载到的地图信息；**缺项 = 该章没有地图资源**
 * @param ownedCellsByChapter 各章本地存档的已占领格
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
        // 全部章节都占行：未解锁一律显示为锁定；地图有无只影响完成度分母，不影响是否展示。
        const percent = unlocked ? chapterPercentOf(map, ownedCellsByChapter.get(chapterId) ?? []) : 0;
        rows.push({
            chapterId,
            index: rows.length + 1,
            title: chapterNames.get(chapterId) ?? map?.name ?? fallbackChapterTitle(chapterId),
            percent,
            state: !unlocked
                ? CHAPTER_SELECT_STATE.locked
                : percent >= 100 ? CHAPTER_SELECT_STATE.cleared : CHAPTER_SELECT_STATE.progress,
            current: chapterId === currentChapterId,
        });
    }
    return rows;
}
