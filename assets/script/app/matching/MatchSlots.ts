import { MATCH_SLOT_BARS } from '../ArtPaths';

/** 最少几条：我方 + 至少一个对手（1 人局的匹配界面没有意义）。 */
export const MATCH_MIN_PARTICIPANTS = 2;

/** 最多几条 —— 由槽位配色表的长度决定，别写死数字。 */
export const MATCH_MAX_PARTICIPANTS = MATCH_SLOT_BARS.length;

/** 转成数字后向下取整。非有限值或超出席位范围时返回 null。 */
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
 * 展示席位取预期席位与服务端已确认参战人数中的较大值，并限制在支持范围内。
 * 两者都未知时展示最少席位。已确认参战人数少于展示席位时保留空位。
 *
 * @param room        resolveMatchSeats 得到的预期席位数（null = 未知）
 * @param serverUnits 服务端回包里的参战单元数（0 = 还没回包）
 */
export function matchSlotCount(room: number | null, serverUnits: number): number {
    const units = Number.isFinite(serverUnits) && serverUnits > 0 ? Math.floor(serverUnits) : 0;
    const known = Math.max(room ?? 0, units);
    if (known <= 0) return MATCH_MIN_PARTICIPANTS;
    return Math.min(MATCH_MAX_PARTICIPANTS, Math.max(MATCH_MIN_PARTICIPANTS, known));
}
