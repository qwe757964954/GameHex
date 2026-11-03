/**
 * 本局**实际参与人数** → 匹配界面要摆几条信息条。
 *
 * 用户 2026-11-02：「匹配界面按[4]不能写死，需要根据实际参与人数展示 3人4人或2人」。
 *
 * ## 人数从哪来（按可信度排序，只认这几个真源）
 *
 * | 来源 | 什么时候有 | 权威性 |
 * | --- | --- | --- |
 * | `CmdStartBattleRspMsg.unitInfos` 的条数 | **匹配成功那一刻**（`battle.units`） | 权威 —— 服务端真发了几个人 |
 * | `IMatchingEntryParams.participants` | 入口就知道（按模式） | 入口声明 |
 * | `getZCLocalPlayerCountOverride()` | 本地玩法固定 2/3/4 时 | 本机兜底（`zcds.playerCount` / `__ZCDS_PLAYER_COUNT__`） |
 *
 * 搜索阶段服务端还没回包，前两项里只有"入口声明 / 本地固定人数"可能有值；都没有时
 * **不猜**——按最小值（我方 + 1 条搜索占位）铺，回包那一下再按真实人数重排。
 * 这条与"写死 4"的区别：4 是猜的，这里永远等于已知的那个数。
 *
 * 上限来自槽位配色表本身（`MATCH_SLOT_BARS` 蓝 / 红 / 紫 / 黄），多画一条也没有第 5 种颜色。
 *
 * 与 `ZCGameLoader` 的选图口径一致：那边也是 `battle.units.length` 优先、其次本地覆盖
 * （见 `loadRandomMap` 的 `battlePlayerCount`）—— 两处都按"这一局到底几个人"算。
 */
import { MATCH_SLOT_BARS } from '../ArtPaths';

/** 最少几条：我方 + 至少一个对手（1 人局的匹配界面没有意义）。 */
export const MATCH_MIN_PARTICIPANTS = 2;

/** 最多几条 —— 由槽位配色表的长度决定，别写死数字。 */
export const MATCH_MAX_PARTICIPANTS = MATCH_SLOT_BARS.length;

/** 脏值（缺省 / 0 / 小数 / 超范围 / 字符串）一律当"不知道"（`null`），不夹取。 */
export function normalizeMatchSeats(value: unknown): number | null {
    const seats = Math.floor(Number(value));
    if (!Number.isFinite(seats)) return null;
    return seats >= MATCH_MIN_PARTICIPANTS && seats <= MATCH_MAX_PARTICIPANTS ? seats : null;
}

/**
 * 入口声明 / 本地固定人数，取两者里**较大**的那个（都不知道 ⇒ `null`）。
 *
 * 取大不取小：本地固定 4 人时，入口就算按老模式报了 2，实际这局也是 4 个席位。
 */
export function resolveMatchSeats(entry: unknown, local: unknown): number | null {
    const declared = normalizeMatchSeats(entry);
    const localSeats = normalizeMatchSeats(local);
    if (declared !== null && localSeats !== null) return Math.max(declared, localSeats);
    return declared ?? localSeats;
}

/**
 * 信息条条数 = **实际参与人数**。
 *
 * @param room        入口声明 / 本地固定的席位数（`null` = 不知道）
 * @param serverUnits 服务端回包里的参战单元数（0 = 还没回包）
 */
export function matchSlotCount(room: number | null, serverUnits: number): number {
    const units = Number.isFinite(serverUnits) && serverUnits > 0 ? Math.floor(serverUnits) : 0;
    const known = Math.max(room ?? 0, units);
    if (known <= 0) return MATCH_MIN_PARTICIPANTS;
    return Math.min(MATCH_MAX_PARTICIPANTS, Math.max(MATCH_MIN_PARTICIPANTS, known));
}
