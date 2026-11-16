/**
 * 战斗统计上报的纯数据层，零引擎依赖，Node 可直接单测。
 *
 * 协议约定 eventType 1 是怪物波次、2 是伤害统计；伤害 key 固定 harm；
 * kv 是扁平字符串数组，数字必须转字符串，否则 protobuf 会写出畸形载荷。
 *
 * unitId 用服务端下发的战斗单元 id，由调用方通过 seatUnitIds 传入。拿不到时才退 0，
 * 否则所有伤害都会挂到 0 号单元，而且不会报错。
 */

/**
 * 统计事件类型。用 as const 对象加同名派生类型，不用 enum。
 */
export const ZC_BATTLE_STAT_EVENT_TYPE = {
    /** 怪物波次：kv = ['0', 波次数]。 */
    Wave: 1,
    /** 伤害统计：kv = ['harm', 伤害总数]。 */
    Damage: 2,
} as const;

export type ZCBattleStatEventType = (typeof ZC_BATTLE_STAT_EVENT_TYPE)[keyof typeof ZC_BATTLE_STAT_EVENT_TYPE];

/** 伤害统计的 kv key，协议定死。 */
export const ZC_BATTLE_STAT_DAMAGE_KEY = 'harm';

/**
 * 与 CmdBattleStatisticsInfo 同形的上报行。
 * 刻意不用 ambient 全局类型，保证本模块能在 Node 里单测。
 */
export interface IZCBattleStatInfo {
    unitId: number;
    eventType: number;
    frameId: number;
    kv: string[];
}

/** 一条伤害统计的输入。 */
export interface IZCBattleStatDamage {
    /** 服务端单元 id；拿不到时调用方传 0。 */
    readonly unitId: number;
    /** 该单元本局造成的伤害总数。 */
    readonly harm: number;
}

function toUint32(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(0xffffffff, Math.floor(num));
}

/** unitId 收敛为 uint32，畸形值归 0。 */
export function normalizeStatUnitId(value: unknown): number {
    return toUint32(value);
}

/** 伤害值收敛为 uint32 量级的非负整数。 */
export function normalizeStatHarm(value: unknown): number {
    return toUint32(value);
}

/**
 * 伤害统计转上报行，每个参战单元一条。
 * 每条固定 eventType = 2、frameId = 0；空输入返回空数组，不发假的 harm = 0。
 */
export function buildDamageStatistics(rows: readonly IZCBattleStatDamage[]): IZCBattleStatInfo[] {
    const result: IZCBattleStatInfo[] = [];
    for (const row of rows) {
        if (!row) continue;
        result.push({
            unitId: normalizeStatUnitId(row.unitId),
            eventType: ZC_BATTLE_STAT_EVENT_TYPE.Damage,
            frameId: 0,
            kv: [ZC_BATTLE_STAT_DAMAGE_KEY, String(normalizeStatHarm(row.harm))],
        });
    }
    return result;
}
