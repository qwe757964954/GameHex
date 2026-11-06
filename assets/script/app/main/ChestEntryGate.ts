/**
 * 战斗宝箱入口的**开启条件** + 「生成」缩放动画 —— 纯函数，零引擎依赖，可单测。
 *
 * 需求（2026-11-03）：*「在功能开启表中补充完整战斗宝箱掉落的开启条件，只有当 pvp 节点
 * 20001 胜利通过后，才展示出战斗宝箱入口 icon，播放 icon 生成的缩放动画」*。
 *
 * ## 条件写在表里，代码不认关卡号
 * `open.json` 的 `refId = 701`（`name = 战斗掉落宝箱`，策划表里本来就有的那一行）是这条功能的载体：
 *
 * ```json
 * {"refId":701,"belond":0,"order":0,"resShowType":[10,7],"type":2,"tipShow":"通关第20001关后解锁",
 *  "name":"战斗掉落宝箱",
 *  "visibleCondition":[{"param":{"resId":20001},"type":"territoryLevel"}],"condition":[]}
 * ```
 *
 * ⚠️ 条件类型是 **`territoryLevel`（领地据点），不是 `battleLevel`（主线 `CmdBattleLevel`）**。
 * 2026-11-03 实机：`CmdBattleLevel 里没有 level=20001 这一行` —— pvp 据点通关服务端不写那张表，
 * 用 `battleLevel` 配 20001 会永远锁死。领地据点的通关状态在 `CmdCityChapterCellInfo.passCells`。
 *
 * 本模块只做「把那一行捞出来 → 用 `MainEntranceVisible` 判它可不可见」，**不判具体关卡号**：
 * 与主界面两侧入口是**同一套** `visibleCondition` 语义。策划要换关卡、叠 `roleLevel`、
 * 叠 `notTiShen`，改表即可，客户端一行不动。
 *
 * ⚠️ `refId` 用的是**策划表里已有的 701**（2026-11-03 用户指明「补充到 701 对应行内」），
 * 不要另开一行 —— 表重新导出时多出来的行会被冲掉，而代码就会静默变成「入口永远不显示」。
 *
 * ⚠️⚠️ **改表要改到运行时真正读的那一份**（2026-11-03 实机踩到：日志报「找不到 refId=701」）：
 * `open` 在 `tools/ref/small.txt` 里是合并表成员，`RefUtil.loadRefSmallAll()` 注册之后，
 * `getResData` 见到合并表成员**直接返回 null** ⇒ 只从 `assets/remoteRef/refSmallAll.json`
 * 取；同目录的 `open.json` 是历史残留的**死文件**，改它对运行时毫无影响。
 * 链路：Excel → `doc/塔防数据配置/json/client/open.json` → `tools/ref/ref_compress_json.py`
 * → `assets/remoteRef/refSmallAll.json`。只改中间任一层而不重跑压缩脚本 = 白改。
 *
 * ## 为什么 `belond = 0`
 * 底部宝箱入口是 HUD 上的节点（`BottomHud/ChestEntry`），**不是**左右两列的活动入口。
 * `collectEntranceItems` 只收 `belond ∈ {2, 3}`，`belond = 0` 让它只当「条件载体」，
 * 不会在两侧多长出一颗图标（同 `refId = 13` 聊天入口的处理）。
 *
 * ## 为什么只有 `resShowType` 没有 `icon` / `url`
 * `resShowType = [10, 7]`（金币 + 体力）是策划表给的货币条口径，留着备查；
 * 真正显示的入口图标是 prefab 上那颗 `ChestEntry`（`hud_chest.png`）自带的，不按表加载 ——
 * `open.json` 的 `icon` 只在 `belond ∈ {2,3}` 时才会被 `HeadArt` 解析成贴图。
 * 也没有对应界面，所以不填 `url`（填了会被 `MainEntranceRoute` 白名单要求路由）。
 *
 * ## 表缺行 ⇒ 不显示
 * 表没下发 / `refId` 被改 / 整张表读失败，一律按「未解锁」处理 —— 与
 * `EMPTY_ENTRANCE_PLAYER_STATE` 的「带条件入口一律不显示」同一个口径。
 * 但 `rowMissing` 会单独报出来，免得它和「条件没满足」混在一起排障。
 */

import {
    evaluateEntranceCondition,
    indexOpenRowsByRefId,
    isEntranceRowVisible,
} from './MainEntranceVisible';
import type { EntrancePlayerState, EntranceVisibleRow } from './MainEntranceVisible';

// ============================================================
// 常量
// ============================================================

/** 「战斗掉落宝箱」在 `open.json` 里的行（策划表 701，`belond = 0`，纯条件载体）。 */
export const CHEST_ENTRY_OPEN_REF_ID = 701;

/** 「生成」缩放动画时长（秒）。0.34s ≈ 地块 / 宝箱出场的量级，再长就挡底部操作了。 */
export const CHEST_ENTRY_POP_SECONDS = 0.34;

/** 生成动画的峰值缩放（`0 → 1.15 → 1`），与领地宝箱 `TERRITORY_CHEST_POP_OVERSHOOT` 同一个数。 */
export const CHEST_ENTRY_POP_OVERSHOOT = 1.15;

/**
 * 上升段占比：前 65% 长到峰值，剩下 35% 落回 1。
 *
 * 与 `TerritoryChestAnimation.springPop` **同一条曲线**（`rise = 0.65` + `easeOutCubic`）——
 * 两处的「弹出来」手感必须像一家人，改一处记得同步另一处（用例 `chest-entry-gate`
 * 会拿领地宝箱的曲线做对拍）。
 */
const POP_RISE_PORTION = 0.65;

// ============================================================
// 判定
// ============================================================

export interface ChestEntryGate {
    /** 入口该不该显示。 */
    readonly unlocked: boolean;
    /** 表里根本没有 `refId = CHEST_ENTRY_OPEN_REF_ID` 那一行（或整张表没拿到）。 */
    readonly rowMissing: boolean;
}

/** 从 `open` 全表里捞「战斗宝箱」那一行；没有返回 `null`。 */
export function findChestEntryRow(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
): EntranceVisibleRow | null {
    for (const row of openRows ?? []) {
        if (row && Number(row.refId) === CHEST_ENTRY_OPEN_REF_ID) return row;
    }
    return null;
}

/**
 * 战斗宝箱入口现在开没开。
 *
 * `openRows` 传 `open` 全表（不是单行）：`preResId` 前置链要顺着全表往上找条件。
 */
export function resolveChestEntryGate(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
    state: EntrancePlayerState,
): ChestEntryGate {
    const row = findChestEntryRow(openRows);
    if (!row) {
        // ⚠️ 文案别写 `open.json`：运行时只认 `refSmallAll.json` 的 `open` 块，
        // 同目录的 `open.json` 是死文件（2026-11-03 实机踩到一次、
        // 2026-11-04 SVN 合并又把它冲回旧版一次）。写错文件名会让人去改死文件。
        console.warn(
            `[ChestEntryGate] open 表里找不到 refId=${CHEST_ENTRY_OPEN_REF_ID} 的战斗宝箱行，入口先不显示`
            + '（运行时读 assets/remoteRef/refSmallAll.json 的 open 块，改同目录 open.json 无效；'
            + 'SVN 合并后常被冲回旧版，重跑 tmp/restore_open701_refsmallall.py 恢复）',
        );
        return { unlocked: false, rowMissing: true };
    }
    const unlocked = isEntranceRowVisible(row, indexOpenRowsByRefId(openRows), state);
    return { unlocked, rowMissing: false };
}

/**
 * 排障用：把 `refId = 701` 那一行**每一条条件单独判一遍**，连同它读的关卡号一起吐出来。
 *
 * 为什么单独做：`resolveChestEntryGate` 只给一个 `false`，而「表没下发」「关卡号配错」
 * 「`CmdBattleLevel` 里没这一关」三种情况长得一模一样 —— 排查时只能靠这条快照区分。
 * 关卡号**从表里读**，不写死（用例也会扫源码不许出现 20001）。
 */
export interface ChestEntryConditionReport {
    readonly type: string;
    /** `battleLevel` 的关卡号 / `roleLevel` 的阈值，取表里那个参数。 */
    readonly resId: number | null;
    readonly verdict: 'pass' | 'fail' | 'skip';
}

export function inspectChestEntryConditions(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
    state: EntrancePlayerState,
): ChestEntryConditionReport[] {
    const row = findChestEntryRow(openRows);
    if (!row) return [];
    return (row.visibleCondition ?? []).map((condition) => ({
        type: String(condition?.type ?? ''),
        resId: typeof condition?.param?.resId === 'number' ? condition.param.resId : null,
        verdict: evaluateEntranceCondition(condition, state),
    }));
}

/** 只要「开没开」这一个布尔时的简写。 */
export function isChestEntryUnlocked(
    openRows: readonly EntranceVisibleRow[] | null | undefined,
    state: EntrancePlayerState,
): boolean {
    return resolveChestEntryGate(openRows, state).unlocked;
}

/**
 * 这条 `fail` 是「暂时不过」还是「真没过」。
 *
 * `territoryLevel` 读的是领地渲染快照（`stageByCell` + `progress`）。主城页 `onLoad` 时
 * 快照还没到 —— 注意是**空表**而不是 `null`，所以「没数据」和「这一章没有这关」在
 * `stageByCell.size === 0` 上长得一模一样。此时 `territoryLevel` 必然 fail，
 * 但那是「还没数据」，不是「没通关」。
 *
 * 2026-11-03 实机：icon 出现前先刷了两行
 * `战斗宝箱入口未解锁: territoryLevel(20001) => fail（…当前章节 0 格）`，
 * 把排障方向直接带偏（看着像关卡号配错 / 章节没格子）。
 *
 * 约定：只要有 `territoryLevel` 条件、且快照没到位，整条诊断按「暂缓」处理 ——
 * 不打 warn（领地渲染完会再判一次），只打一条 log 说明还在等。
 */
export function isChestEntryVerdictProvisional(
    reports: readonly ChestEntryConditionReport[],
    territorySnapshotReady: boolean,
): boolean {
    if (territorySnapshotReady) return false;
    return reports.some((report) => report.type === 'territoryLevel');
}

// ============================================================
// 领地据点：「这一关通没通」要跨章节算
// ============================================================

/**
 * 判「领地这一关通没通」要的两个快照。
 *
 * 结构类型而非直接 import `TerritoryCampaignStage` / `TerritoryProgress`：本模块要保持
 * 零引擎依赖（Node 里直接跑用例），只认这里真的会用到的两个方法。
 */
export interface ChestEntryTerritoryView {
    /** 当前章的「格子 → 关卡」映射；`null` = 快照还没到（注意空 Map 也是「没到」）。 */
    readonly stageByCell: ReadonlyMap<number, { readonly levelId: number }> | null;
    /** 领地进度：这一格（所在区域）通了没有。 */
    readonly isAreaPassed: ((cellId: number) => boolean) | null;
}

/** 当前章里属于 `levelId` 的格子（一片战斗区域常常横跨好几格）。 */
export function territoryLevelCellsInChapter(
    view: ChestEntryTerritoryView,
    levelId: number,
): number[] {
    const stageByCell = view.stageByCell;
    if (!stageByCell) return [];
    const cells: number[] = [];
    for (const [cellId, stage] of stageByCell) {
        if (stage.levelId === levelId) cells.push(cellId);
    }
    return cells;
}

/**
 * 当前章里**已经通关**的关卡号（去重）。
 *
 * 给 `MainPage` 在领地每次渲染时整批记进账号成就用 —— 这样「记账」只有一处，
 * 条件判定 `isTerritoryLevelPassedInTerritory` 保持纯函数（不写盘、无副作用）。
 */
export function passedTerritoryLevelIds(view: ChestEntryTerritoryView): number[] {
    const stageByCell = view.stageByCell;
    const isAreaPassed = view.isAreaPassed;
    if (!stageByCell || !isAreaPassed) return [];
    const passed = new Set<number>();
    for (const [cellId, stage] of stageByCell) {
        if (!passed.has(stage.levelId) && isAreaPassed(cellId)) passed.add(stage.levelId);
    }
    return Array.from(passed);
}

/**
 * 领地据点（`levelInfo.levelId`）通关了没有 —— **跨章节**判。
 *
 * ## 为什么不能只看当前章
 * `levelInfo.levelChapter` 决定了关卡归属哪一章：20001 属第 1 章，而第 2 章是
 * 10011~20007，**根本不含 20001**。只看当前章的 `stageByCell`：
 *
 * ```
 * 第 1 章：20001 通关 ⇒ 战斗宝箱入口长出来（✔ 2026-11-03 实机正常）
 * 切到第 2 章：stageByCell 里没有 20001 ⇒ 判定恒 false ⇒ 入口消失（✘ 2026-11-04 实机）
 * ```
 *
 * 所以「通关」是**一次性成就**：`archived` 是账号级落盘的已通关关卡集合
 * （`TerritorySaveStore.loadPassedLevels`），命中就直接算过，与当前在哪个章节无关。
 *
 * 两条来源的先后**不能反**：先看落盘（不受切章影响），再看当前章快照（首次通关那一刻
 * 只有快照知道 —— 落盘由 `MainPage` 在领地渲染时用 {@link passedTerritoryLevelIds} 整批做，
 * 本函数是**纯的**，不写盘）。
 */
export function isTerritoryLevelPassedInTerritory(
    levelId: number,
    view: ChestEntryTerritoryView,
    archived: { has(levelId: number): boolean } | null = null,
): boolean {
    if (archived?.has(levelId)) return true;
    const isAreaPassed = view.isAreaPassed;
    if (!isAreaPassed) return false;
    for (const cellId of territoryLevelCellsInChapter(view, levelId)) {
        if (isAreaPassed(cellId)) return true;
    }
    return false;
}

// ============================================================
// 生成动画
// ============================================================

/**
 * 「生成」缩放动画在 `elapsedSeconds` 时的缩放值。
 *
 *  · `< 0` / 非数 → `0`（还没起播 ⇒ 藏起来）；
 *  · `0 ~ 时长` → `0 → 1.15 → 1`（先冲过头再落回，别用线性，线性看着像"被拉大"）；
 *  · `≥ 时长` → 恒 `1`（落位，之后不再碰缩放）。
 */
export function chestEntryPopScale(elapsedSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    if (elapsedSeconds >= CHEST_ENTRY_POP_SECONDS) return 1;
    const p = elapsedSeconds / CHEST_ENTRY_POP_SECONDS;
    if (p < POP_RISE_PORTION) return CHEST_ENTRY_POP_OVERSHOOT * easeOutCubic(p / POP_RISE_PORTION);
    const fall = (p - POP_RISE_PORTION) / (1 - POP_RISE_PORTION);
    return CHEST_ENTRY_POP_OVERSHOOT + (1 - CHEST_ENTRY_POP_OVERSHOOT) * easeOutCubic(fall);
}

function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}
