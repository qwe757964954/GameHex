/**
 * 战斗统计上报（`CmdBattleStatisticsInfo`）的**纯数据层** —— 零引擎依赖，Node 可直接单测。
 *
 * ## 协议口径（`client_proto/protoCompiled.proto`，r862 由服务端补全注释）
 *
 * ```
 * // 事件类型1,怪物波次,塔防模式使用,k固定为0,v为波次数
 * // 事件类型2,伤害统计,kv中传入伤害,k固定为harm,v为伤害总数
 * message CmdBattleStatisticsInfo {
 *   required uint32 unitId    = 1;//单元id
 *   required uint32 eventType = 2;//事件类型
 *   required uint32 frameId   = 3;//帧id(某一帧触发)
 *   repeated string kv        = 4;//k_v_k_v的形式(前端后约定)
 * }
 * ```
 *
 * 三件**不能自己发明**的事：
 *   ① `eventType` 是**枚举**，1 = 怪物波次（塔防），2 = 伤害统计 —— 不是"随便标个号"；
 *   ② 伤害统计的 **key 固定 `harm`**，`kv` 是 `[k, v, k, v, …]` **扁平字符串数组**；
 *   ③ `kv` 里每一项都是 **`string`**（proto 写死 `repeated string`）：直接塞 number，
 *      protobufjs 的 writer 会抛错 / 写出畸形载荷 ⇒ 必须 `String(...)`。
 *
 * ## 为什么 unitId 不是 0 就完事
 *
 * `unitId` 是**服务端下发的战斗单元 id**（`CmdBattleUnitInfo.unitId`），服务端靠它把这条
 * 统计归属到具体参战单元。前端恒填 0 ⇒ 服务端拿到的所有伤害都挂在"0 号单元"上，
 * 整张统计表只有一个桶，**且全程零报错**。所以调用方必须把 `seatUnitIds` 传进来；
 * 真拿不到（本地局 / 老回包缺字段）才退 0，并在注释里写明这是兜底而不是默认值。
 */

/**
 * 统计事件类型 —— 对应 `CmdBattleStatisticsInfo.eventType`。
 *
 * 用 `as const` 对象 + 同名派生类型（工程规范，禁 `enum` / 禁数组下标）。
 */
export const ZC_BATTLE_STAT_EVENT_TYPE = {
    /** 怪物波次（塔防模式）：`kv = ['0', 波次数]`，k 固定字符串 `0`。 */
    Wave: 1,
    /** 伤害统计：`kv = ['harm', 伤害总数]`。 */
    Damage: 2,
} as const;

export type ZCBattleStatEventType = (typeof ZC_BATTLE_STAT_EVENT_TYPE)[keyof typeof ZC_BATTLE_STAT_EVENT_TYPE];

/** 伤害统计的 kv key（协议定死的字面量，前端不得自造别的名字）。 */
export const ZC_BATTLE_STAT_DAMAGE_KEY = 'harm';

/**
 * 与 `CmdBattleStatisticsInfo` **同形同名**的上报行。
 *
 * 刻意不复用全局 `CmdBattleStatisticsInfo` 声明：那份是 `Cmd.d.ts` 的 ambient 全局类型，
 * 只有 Cocos 运行时有；本模块要能在 Node 里单测 ⇒ 用结构化类型，赋值给协议类型时字段一一对应。
 */
export interface IZCBattleStatInfo {
    unitId: number;
    eventType: number;
    frameId: number;
    kv: string[];
}

/** 一条伤害统计的输入：哪个单元、造成多少伤害。 */
export interface IZCBattleStatDamage {
    /** 服务端单元 id（`seatUnitIds` 映射而来）；拿不到时调用方传 0。 */
    readonly unitId: number;
    /** 该单元本局造成的伤害总数（承受伤害不上报，协议只有 `harm` 一个 key）。 */
    readonly harm: number;
}

/**
 * `unitId` 收敛：`required uint32`，负数/小数/NaN 一律 0（不让畸形值把整包编码打挂）。
 */
export function normalizeStatUnitId(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(0xffffffff, Math.floor(num));
}

/** 伤害值收敛：uint32 量级的非负整数（`harm` 是"总数"，负数没有语义）。 */
export function normalizeStatHarm(value: unknown): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(0xffffffff, Math.floor(num));
}

/**
 * 伤害统计 → `CmdBattleStatisticsInfo[]`（**每个参战单元一条**）。
 *
 * 每条固定 `eventType = 2`、`kv = ['harm', '数字']`；`frameId` 恒 0 ——
 * 伤害是**整局汇总**，不属于"某一帧触发"（该字段留给逐帧埋点，别拿结束帧凑）。
 *
 * 空输入返回空数组：一条都没有时宁可不发，也不要发一条 `harm = 0` 的假数据。
 */
export function buildDamageStatistics(rows: readonly IZCBattleStatDamage[]): IZCBattleStatInfo[] {
    const result: IZCBattleStatInfo[] = [];
    for (const row of rows) {
        if (!row) continue;
        result.push({
            unitId: normalizeStatUnitId(row.unitId),
            eventType: ZC_BATTLE_STAT_EVENT_TYPE.Damage,
            frameId: 0,
            // ⚠️ `kv` 是 `repeated string` ⇒ 数字必须转字符串（见文件头 ③）。
            kv: [ZC_BATTLE_STAT_DAMAGE_KEY, String(normalizeStatHarm(row.harm))],
        });
    }
    return result;
}
