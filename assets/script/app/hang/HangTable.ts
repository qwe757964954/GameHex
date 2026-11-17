/**
 * 挂机收益判定纯函数，只允许纯 `core` 依赖，禁止 `cc` / framework / 其它 feature。
 * 收益展示用已通关最后一关，快速征收费体力用最高三星关，两者不能合并。
 * CmdBattleLevel.star 是 3 位位掩码不是星数；要星数走 levelStarCount()。
 */
import { formatHmsMs } from '../../core/time/TimeMs';
import type { IRewardAmount } from '../../core/types/Reward';

// 常量

/** 挂机收益封顶时长 —— 老端 `LayerHangUI.maxIdleTime = 8 * 60 * 60 * 1000`。 */
export const HJ_MAX_IDLE_MS = 8 * 60 * 60 * 1000;

/**
 * 领取的最小累计时长 —— 老端 `onClickReceive` 里 `diffTime < 3600000` 就弹
 * `FULL_ONE_HOUR`（mL.json id=289「挂机满一小时可领取」）。
 */
export const HJ_MIN_CLAIM_MS = 60 * 60 * 1000;

/**
 * 快速征收的倍率档位 —— 老端 `LayerHang.SWEEP_GEARS` 写死。
 *
 * 老端注释：*「目前客户端写死：gameConfig 里没有对应配置项（已逐条核对全部 150 项）」*。
 * Demo3.8 的 `gameConfig` 同样没有这一项，**继续写死**，别再去找配置。
 */
export const HJ_SWEEP_GEARS: readonly number[] = [1, 5, 10, 20, 50];

/** 默认档位下标（= 1 倍）。 */
export const HJ_DEFAULT_GEAR_INDEX = 0;

/** `gameConfig` 里免费扫荡次数的 key（实测值 3）。 */
export const HJ_CFG_SWEEP_FREE_TIMES = 'sweepFreeTimes';

/** `sweepFreeTimes` 读不到时的兜底（老端同值）。 */
export const HJ_FALLBACK_SWEEP_FREE_TIMES = 3;

/**
 * 体力的 `resId`。
 *
 * 老端 `LayerHangUI.init` 里是 `this.ModelMgr.ModelGoods.GetGoodsIconKeyByRefId(roleProperty.end)`，
 * 而 `roleProperty` 是 **`generated/refGen/RefEnum.ts` 里的代码枚举**（不是 `roleProperty.json` 的列！
 * 那张表只有 `resId/key/type/name/quality/describe/showType/unenoughTips/access/useJump` 十列，
 * 根本没有 `end`）。`RefEnum.roleProperty.end = 9`，两端同值（已逐行比对）。
 * 表里 `resId = 9` 那行 `name = 体力`、`icon = 图标_体力`、`quality = 3` ⇒ 常量与图标路径据此。
 */
export const HJ_END_RES_ID = 9;

/** `interactReward.type` 里「挂机收益建筑」的值（老端 `ModelHang.GetInteractTaxRewards` 里的 `AFK_BLDG_TYPE`）。 */
export const HJ_INTERACT_TYPE_AFK_BLDG = 3;

/** `CmdRoleInteractInfo.state` = 已互动。 */
export const HJ_INTERACT_STATE_DONE = 1;

/** `guankaReward.instanceType` = 普通关卡（老端 `InstanceType.Normal`；实测该列取值 `[0,1,2,3,4,9,10]`）。 */
export const HJ_INSTANCE_TYPE_NORMAL = 0;

/**
 * 「完美通关」的星级**掩码**门槛（老端 `StageProgress.threeStar`）。
 *
 * 名字里的 `STAR` 指的是**星档**，但比较对象是 `CmdBattleLevel.star` 这个**位掩码**：
 * `mask >= 3` ⇔ `0b011` ⇔ bit0 + bit1 都置位 ⇔ **1 星与 2 星都拿到**。
 * 也就是说这个门槛的实际语义是「**2 星及以上**」，与 FGUI 文案一致（见文件头）。
 * 别把它当「星数 >= 3」用 —— 那会让 2 星关被当成满星关，静默改变快速征收的体力档
 * 与「当天可征收关卡」的取值。
 */
export const HJ_PERFECT_STAR = 3;

/** 「已通关」的星级门槛（`mask >= 1` ⇔ `mask > 0`，与 `GetStageIsClean` / `FirstRechargeAutoOpen.isLevelPassed` 同口径）。 */
export const HJ_PASSED_STAR = 1;

/**
 * 星数**掩码**的位数（3 档：1 星 / 2 星 / 3 星）。
 *
 * `ToLocalStar` 只取低 3 位 —— 服务端把 star 当「按位或的宝箱档位」，高位不用。
 */
export const HJ_STAR_BITS = 3;

/** 一关都没过时 `GetMaxChallengeLevel()` 的返回值（老端 `let maxLevel = 1`）。 */
export const HJ_MIN_CHALLENGE_LEVEL = 1;

/** 收益关卡取不到时的兜底关号（老端此时界面空白，Demo3.8 退到第 1 关，保证看得见东西）。 */
export const HJ_FALLBACK_INCOME_LEVEL = 1;

/** 快速征收的 `CmdBattleSweepReqMsg.type`（`CmdBattleType.CHAPTER`）。 */
export const HJ_SWEEP_TYPE_CHAPTER = 1;

// 奖励条目

/** 一条奖励（`{resId, number}`）；与 `core/types/Reward.IRewardAmount` 同一结构。 */
export type IHjReward = IRewardAmount;

/**
 * 把 `unknown` 洗成奖励数组。
 *
 * 坏条目（非对象 / `resId` 或 `number` 不是正整数）**直接丢**，不抛 —— 表里
 * `idleRewards` 允许为空数组（`guankaReward` 1632 行里有 200 行是空的）。
 */
export function normalizeRewards(input: unknown): IHjReward[] {
    if (!Array.isArray(input)) return [];
    const out: IHjReward[] = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const r = raw as Record<string, unknown>;
        const resId = Number(r.resId);
        const number = Number(r.number);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        if (!Number.isFinite(number) || number <= 0) continue;
        out.push({ resId, number });
    }
    return out;
}

/**
 * 合并「关卡基础产出」与「探索层互动建筑加成」。
 *
 * 老端 `LayerHangUI._mergeTaxRewards` 的逐字口径：**同 resId 相加，新 resId 追加到末尾**。
 * 顺序有语义 —— 界面右侧那个 `16/h` 用的是 `merged[0]`、`1/h` 用 `merged[1]`。
 */
export function mergeRewards(base: readonly IHjReward[], extra: readonly IHjReward[]): IHjReward[] {
    const merged: { resId: number; number: number }[] = base.map((r) => ({ resId: r.resId, number: r.number }));
    for (const add of extra) {
        const hit = merged.find((m) => m.resId === add.resId);
        if (hit) hit.number += add.number;
        else merged.push({ resId: add.resId, number: add.number });
    }
    return merged;
}

/** 拿合并结果里的第 N 条（右侧两个 `/h` 展示位）；越界返回 `null`。 */
export function rewardAt(list: readonly IHjReward[], index: number): IHjReward | null {
    return list[index] ?? null;
}

/** `16/h` 这种「每小时产出」文案。 */
export function perHourText(reward: IHjReward | null): string {
    return reward ? `${reward.number}/h` : '';
}

// 表解析

/** `guankaReward` 里本模块用到的一行。 */
export interface IHjGuankaRow {
    readonly level: number;
    readonly instanceType: number;
    readonly chapter: number;
    readonly stage: number;
    /** 快速征收一次的体力消耗（老端 `ref.end`）。 */
    readonly end: number;
    /** 该关的每小时基础产出。 */
    readonly idleRewards: readonly IHjReward[];
}

/** 洗一行 `guankaReward`；坏行返回 `null`。 */
export function parseGuankaRow(value: unknown): IHjGuankaRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const r = value as Record<string, unknown>;
    const level = Number(r.level);
    if (!Number.isSafeInteger(level) || level <= 0) return null;
    return {
        level,
        instanceType: Number(r.instanceType) || 0,
        chapter: Number(r.chapter) || 0,
        stage: Number(r.stage) || 0,
        end: Number(r.end) || 0,
        idleRewards: normalizeRewards(r.idleRewards),
    };
}

/** 洗整张 `guankaReward`。 */
export function parseGuankaRows(values: unknown): IHjGuankaRow[] {
    if (!Array.isArray(values)) return [];
    const out: IHjGuankaRow[] = [];
    for (const raw of values) {
        const row = parseGuankaRow(raw);
        if (row) out.push(row);
    }
    return out;
}

/** 按 `level` 取行；找不到返回 `null`。 */
export function guankaRowOf(rows: readonly IHjGuankaRow[], level: number): IHjGuankaRow | null {
    for (const row of rows) if (row.level === level) return row;
    return null;
}

/** `interactReward` 里本模块用到的一行。 */
export interface IHjInteractRow {
    readonly id: number;
    readonly type: number;
    readonly rewards: readonly IHjReward[];
}

/** 洗整张 `interactReward`。 */
export function parseInteractRows(values: unknown): IHjInteractRow[] {
    if (!Array.isArray(values)) return [];
    const out: IHjInteractRow[] = [];
    for (const raw of values) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const r = raw as Record<string, unknown>;
        const id = Number(r.id);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        out.push({ id, type: Number(r.type) || 0, rewards: normalizeRewards(r.rewards) });
    }
    return out;
}

/**
 * 汇总「已互动的挂机收益建筑」带来的固定加成（老端 `ModelHang.GetInteractTaxRewards`）。
 *
 * @param rows        `interactReward` 全表
 * @param interactedIds 玩家已互动（`state === 1`）的 `resId` 集合
 *
 * 只算 `type === 3` 的行 —— `interactReward` 里 type 有 `[0,1,2,3,4]` 五种，
 * 只有 3 是产税建筑（9 行，`battlelevel` 26/46/66/…）。
 */
export function collectInteractTaxRewards(
    rows: readonly IHjInteractRow[],
    interactedIds: ReadonlySet<number>,
): IHjReward[] {
    const merged = new Map<number, number>();
    for (const row of rows) {
        if (row.type !== HJ_INTERACT_TYPE_AFK_BLDG) continue;
        if (!interactedIds.has(row.id)) continue;
        for (const r of row.rewards) merged.set(r.resId, (merged.get(r.resId) ?? 0) + r.number);
    }
    return Array.from(merged, ([resId, number]) => ({ resId, number }));
}

/** 洗 `gameConfig` 成 `key → value`。 */
export function parseGameConfigRows(values: unknown): Map<string, unknown> {
    const map = new Map<string, unknown>();
    if (!Array.isArray(values)) return map;
    for (const raw of values) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const r = raw as Record<string, unknown>;
        const key = typeof r.key === 'string' ? r.key.trim() : '';
        if (key) map.set(key, r.value);
    }
    return map;
}

/** 免费扫荡次数上限（读不到用兜底 3）。 */
export function sweepFreeTimesOf(config: ReadonlyMap<string, unknown>): number {
    const raw = config.get(HJ_CFG_SWEEP_FREE_TIMES);
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : HJ_FALLBACK_SWEEP_FREE_TIMES;
}

// 进度条 / 倒计时

/** 已累计时长（毫秒，负数归零）—— 老端 `Math.max(0, now - startTime)`。 */
export function idleElapsedMs(startMs: number, nowMs: number): number {
    const start = Number.isFinite(startMs) ? startMs : 0;
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    return Math.max(0, now - start);
}

/** 进度条用的时长（封顶 8h）。 */
export function idleCappedMs(elapsedMs: number): number {
    return Math.min(Math.max(0, elapsedMs), HJ_MAX_IDLE_MS);
}

/** 进度条 0..1。 */
export function idleProgress01(elapsedMs: number): number {
    return idleCappedMs(elapsedMs) / HJ_MAX_IDLE_MS;
}

/** 是否已封顶（决定 `maxImg`（MAX 标签）显示与 1s 定时器停不停）。 */
export function idleReachedMax(elapsedMs: number): boolean {
    return elapsedMs >= HJ_MAX_IDLE_MS;
}

/** 能不能领取（满 1 小时）。 */
export function canClaim(elapsedMs: number): boolean {
    return elapsedMs >= HJ_MIN_CLAIM_MS;
}

/** 累加 1s 的定时器还该不该跑（封顶后就该停 —— 老端 `timer.stop()`）。 */
export function shouldTick(elapsedMs: number): boolean {
    return !idleReachedMax(elapsedMs);
}

/**
 * `08:00:00` 形态的倒计时，直接复用 `core/time/TimeMs.formatHmsMs`。
 *
 * 口径：输入是毫秒；秒数 `Math.ceil` 进位（`3_599_999ms` → `01:00:00`）；
 * 负数归零；小时可超过 24；不做业务封顶（挂机 8h 封顶由 `idleCappedMs()` /
 * `cappedElapsedMsOf()` 先行处理）。与战令带「N天」前缀的格式不是同一个函数。
 */
export const formatHms = formatHmsMs;

// 倍率档位

/**
 * 当前倍率。
 *
 * **当前口径：倍率对所有玩家开放**，不再要求福利月卡。
 * 协议 `CmdCityChapterSweepReqMsg` 新增 `optional uint32 times = 3`，由服务端按
 * `倍率 × 单次消耗` 扣体力、按倍率发奖 ⇒ 客户端的档位不再需要「持卡」这道门禁。
 * 老端 `refreshGearBtn` 那套「无特权把下标复位成 0」随之作废（见 `HangPage.reload`）。
 *
 * 保留下来的只有「越界下标退默认档」：`_gearIndex` 只会是 0..4，越界属于调用方传错，
 * 退默认档能让错误可预测。
 */
export function sweepTimesOf(gearIndex: number = HJ_DEFAULT_GEAR_INDEX): number {
    const i = Number.isInteger(gearIndex) && gearIndex >= 0 && gearIndex < HJ_SWEEP_GEARS.length
        ? gearIndex
        : HJ_DEFAULT_GEAR_INDEX;
    return HJ_SWEEP_GEARS[i];
}

/**
 * 循环切下一档（1 → 5 → 10 → 20 → 50 → 1）。
 *
 * 越界下标**归到默认档**（0）而不是「归一化后再前进」：老端 `_sweepGearIndex` 是私有字段，
 * 只会是 0..4，越界属于调用方传错；这里选「退默认档」是为了让错误可预测（否则
 * `nextGearIndex(99)` 会返回 1，看起来像「切了一档」，排错时极具误导性）。
 */
export function nextGearIndex(current: number): number {
    if (!Number.isInteger(current) || current < 0 || current >= HJ_SWEEP_GEARS.length) {
        return HJ_DEFAULT_GEAR_INDEX;
    }
    return current + 1 >= HJ_SWEEP_GEARS.length ? HJ_DEFAULT_GEAR_INDEX : current + 1;
}

/** 角标文案 `x5`。 */
export function gearLabel(times: number): string {
    return `x${times}`;
}

/**
 * 快速征收按钮上的花费文案 `x10`。
 *
 * 服务端按 `end × times` 扣体力（老端 `BattleSweepHandler` 第 3 步），
 * 这里同口径算，**不是**客户端乘算。
 */
export function sweepCostText(end: number, times: number): string {
    const e = Number.isFinite(end) && end > 0 ? end : 0;
    const t = Number.isFinite(times) && times > 0 ? times : 1;
    return `x${e * t}`;
}

// 关卡进度推导

/**
 * 星级**掩码** → 星数（0~3）—— 老端 `VOBattleChapter.ToLocalStar` 的逐字实现。
 *
 * `mask=0b111` → 3、`0b011` → 2、`0b001` → 1。**只有要显示「几颗星」时才用它**；
 * 所有门槛比较都直接比掩码（见 `HJ_PERFECT_STAR` 的说明）。
 */
export function levelStarCount(starMask: number): number {
    const mask = Number.isFinite(starMask) ? Math.floor(starMask) : 0;
    if (mask <= 0) return 0;
    return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}

/**
 * 「最新可挑战关卡」—— 老端 `ModelChapterNew.GetMaxChallengeLevel()`。
 *
 * 从 1 起顺序数普通关，遇到第一个没过就停；通关 N 关 ⇒ `N + 1`。
 * `isPassed` 由调用方注入（Repository 传 `CmdBattleLevel.star >= 1`），保持本文件零 import。
 *
 * 上界是**普通关总数**，不是 `normal.length + 1`；两张表都空时返回 **0**
 * （老端 `if (maxLevel > tlRef.length) maxLevel = tlRef.length` 且 `tlRef` 已被
 * `getTlRef("instanceType", Normal)` 过滤过 ⇒ 空表得 0）。这一条与
 * `FirstRechargeAutoOpen.deriveMaxChallengeLevel` 的既有单测同口径，**别"顺手"钳到 1**：
 * 调用方要兜底请用 `incomeLevelOf()`。
 */
export function deriveMaxChallengeLevel(
    rows: readonly IHjGuankaRow[],
    isPassed: (level: number) => boolean,
): number {
    const normal = rows.filter((r) => r.instanceType === HJ_INSTANCE_TYPE_NORMAL);
    let maxLevel = HJ_MIN_CHALLENGE_LEVEL;
    for (const row of normal) {
        if (isPassed(row.level)) maxLevel++;
        else break;
    }
    return Math.min(maxLevel, normal.length);
}

/**
 * 「最高完美通关关卡」—— 老端 `ModelChapterNew.GetSweetLevel()`。
 *
 * 遍历普通关，记下**最后一个**达 `HJ_PERFECT_STAR` 掩码门槛的 `level`；
 * 一个都没有时返回 `null`（老端此时返回 `undefined`）。
 *
 * 两个注入器的语义都别写错：
 * · `starOf(level)` 返回的是 **`CmdBattleLevel.star` 位掩码**（不是星数）；
 * · `hasChapter(chapter)` 对应老端 `VOBattleChapterBag.Get(ref.chapter) == null`
 * —— 老端在这里是 **`break`（整段停止扫描）而不是 `continue`**：某章从没挑战过
 * （服务端不发该章缓存）之后的所有章都不再看。照抄这个 break，别改成 continue，
 * 否则「中间缺章的脏档」会取到后面的关，与线上表现不符。
 */
export function deriveSweetLevel(
    rows: readonly IHjGuankaRow[],
    starOf: (level: number) => number,
    hasChapter: (chapter: number) => boolean,
): number | null {
    const normal = rows.filter((r) => r.instanceType === HJ_INSTANCE_TYPE_NORMAL);
    let sweet: number | null = null;
    for (const row of normal) {
        if (!hasChapter(row.chapter)) break;
        if (starOf(row.level) >= HJ_PERFECT_STAR) sweet = row.level;
    }
    return sweet;
}

/**
 * 收益展示用的关号 —— 老端 `initView` 的 `GetMaxChallengeLevel() - 1`。
 *
 * 这一处是**有意的纯展示偏差**（与老端不同，已记账）：一关没过时老端去查 `level = 0`
 * （表里没有 ⇒ `if (!cfg) return`，收益条与 6 格全空），Demo3.8 退到第 1 关，
 * 让离线预览 / 新号也能看到「产出奖励」区长什么样。
 * **只有展示**——它不参与任何请求（发请求的关号见 `sweepLevelOf`，那个**没有**兜底）。
 */
export function incomeLevelOf(maxChallengeLevel: number): number {
    const n = Math.floor(Number.isFinite(maxChallengeLevel) ? maxChallengeLevel : HJ_MIN_CHALLENGE_LEVEL);
    return Math.max(HJ_FALLBACK_INCOME_LEVEL, n - 1);
}

/**
 * 快速征收按哪一关算体力 —— 老端 `refreshBtn` / `onClickLevy` 的 `GetSweetLevel()`。
 *
 * **没有兜底，与老端一致**：老端 `GetRefGuanKaRewardsByLevel(level)` 在「一关都没满星」时
 * 返回 `null` ⇒ `if (ref) cost.setText(...)` 不写花费文案、`onClickLevy` 第一句就 `return`
 * （**一个请求都不发**）。所以这里返回 `0`（= 没有可扫的关），由调用方按 0 处理。
 *
 * 为什么这里**不能**像 `incomeLevelOf` 那样退到第 1 关：那会让「没过第 1 关的新号」
 * 真的发出 `{level: 1, type: 1}` 的扫荡请求 —— 老端从不会发。**纯展示可以退，发请求不能退。**
 */
export function sweepLevelOf(sweetLevel: number | null): number {
    return Number.isFinite(sweetLevel as number) && (sweetLevel as number) > 0 ? (sweetLevel as number) : 0;
}

// 快照查询（页面直接调，不必自己拼）

/**
 * 这批函数要用到的快照字段 —— **结构性子集**。
 *
 * 为什么不直接 import `IHangSnapshot`：那个定义在 `HangRepository` 里，而 `HangRepository`
 * 拖进 `cc` / `RefUtil` / `CacheMgr`（引擎依赖），一旦 import 本文件就再也跑不了 Node 单测。
 * 家族约定见 `BattleTokenTable` —— **判定逻辑必须留在零引擎依赖的模块里**，
 * 所以这里放一份结构子集，`IHangSnapshot` 声明 `extends IHjSnapshotView` 即可无缝传入。
 */
export interface IHjSnapshotView {
    /** 是否有「无限次快速扫荡」特权（本轮恒 `false`）。 */
    readonly hasUnlimited: boolean;
    /** 免费扫荡次数上限（`gameConfig.sweepFreeTimes`，缺省 3）。 */
    readonly sweepFreeTimes: number;
    /** 快速征收按的那一关的单次体力消耗（`guankaReward.end`）；查不到为 0。 */
    readonly sweepEnd: number;
    /** 组装快照的时刻（毫秒）。 */
    readonly now: number;
    /** `CmdRole` 第一行；读不到为 `null`。 */
    readonly role: {
        readonly lastIdleRewardTimeMs: number;
        readonly sweepTimes: number;
    } | null;
    /** 福利月卡 ref；表里找不到为 `null`。 */
    readonly monthCard: { readonly rmb: number } | null;
}

/**
 * 挂机已累计时长（毫秒，**未钳到上限**）。
 *
 * 起点为 0（缓存没推 / 离线）时**这里也会算出一个巨大的值** —— 页面不要直接用它，
 * 用 `cappedElapsedMsOf` / `progressOf`（那三个做了起点兜底）。
 */
export function elapsedMsOf(snapshot: IHjSnapshotView): number {
    const start = snapshot.role ? snapshot.role.lastIdleRewardTimeMs : 0;
    return idleElapsedMs(start, snapshot.now);
}

/**
 * 挂机已累计时长（毫秒，**已钳到 8h 上限**，且起点为 0 时归 0）。
 *
 * 老端 `refreshLastTime()` 写的是 `lastIdleRewardTime ? lastIdleRewardTime : nowMillisecond()`
 * ⇒ 起点 <= 0 时从「现在」起算（进度 0），而不是从 1970 年算起（那样一进来就是满格 + MAX）。
 */
export function cappedElapsedMsOf(snapshot: IHjSnapshotView): number {
    const start = snapshot.role ? snapshot.role.lastIdleRewardTimeMs : 0;
    if (!(start > 0)) return 0;
    return idleCappedMs(idleElapsedMs(start, snapshot.now));
}

/** 进度条比例 `0..1`。 */
export function progressOf(snapshot: IHjSnapshotView): number {
    return idleProgress01(cappedElapsedMsOf(snapshot));
}

/** 是否已到上限（显示 `MAX` 角标、停止倒计时）。 */
export function reachedMaxOf(snapshot: IHjSnapshotView): boolean {
    return idleReachedMax(cappedElapsedMsOf(snapshot));
}

/** 「领取」按钮是否可点（满 1 小时）。 */
export function claimableOf(snapshot: IHjSnapshotView): boolean {
    return canClaim(cappedElapsedMsOf(snapshot));
}

/**
 * 快速征收按钮上的花费文案 `x10`。
 *
 * 服务端按 `end × times` 扣体力（老端 `BattleSweepHandler` 第 3 步），
 * 这里同口径算，**不是**客户端乘算。
 */
export function costTextOf(snapshot: IHjSnapshotView, gearIndex: number = HJ_DEFAULT_GEAR_INDEX): string {
    return sweepCostText(snapshot.sweepEnd, sweepTimesOf(gearIndex));
}

/** 今日已扫荡次数（`CmdRole.sweepTimes`；读不到按 0）。 */
export function sweepUsedOf(snapshot: IHjSnapshotView): number {
    return snapshot.role ? snapshot.role.sweepTimes : 0;
}

/**
 * 「广告次数」那一行的**分支** —— 老端 `refreshBtn` 的三个互斥分支。
 *
 * · `unlimited`：有月卡 ⇒ `无限征收`
 * · `watch`：免费次数用完 ⇒ `今日看广告次数:{a}/{b}`
 * · `left`：还有免费次数 ⇒ `今日剩余({x}/{y})`
 *
 * 本轮只有 `left` 会走到（无月卡 + `sweepTimes` 读不到 ⇒ 0 < 3）。另两个分支照抄老端，
 * 等月卡 / 广告链路接上即可生效 —— 所以**分支判定必须可单测**（这正是它留在这里的原因）。
 */
export type HJAdCountBranch = 'unlimited' | 'watch' | 'left';

/** 当前该走哪个分支（纯判定，文案由调用方套模板）。 */
export function adCountBranchOf(snapshot: IHjSnapshotView): HJAdCountBranch {
    if (snapshot.hasUnlimited) return 'unlimited';
    return sweepUsedOf(snapshot) >= snapshot.sweepFreeTimes ? 'watch' : 'left';
}

/** `left` 分支里「剩余」那个数（免费次数 - 已用，不为负）。 */
export function adLeftOf(snapshot: IHjSnapshotView): number {
    return Math.max(0, snapshot.sweepFreeTimes - sweepUsedOf(snapshot));
}

/**
 * 「快速征收」按钮的 `免费` 控制器页码。
 *
 * 老端 `btn.setSelectedIndex("免费", sweepTimes >= sweepFreeTimes ? 0 : 1)`：
 * · `0` = 「否」⇒ 显示「看视频」小图标（`n6` 的 `gearDisplay pages="0"`）
 * · `1` = 「是」⇒ 藏小图标，`title` 落到 `(79,53)`
 *
 * 语义反直觉：**「免费=是」才是「还有免费次数」**。写反了界面照样跑，
 * 只是图标与文案位置错位 —— 所以必须钉住。
 */
export function freePageOf(snapshot: IHjSnapshotView): number {
    if (snapshot.hasUnlimited) return 1;
    return sweepUsedOf(snapshot) >= snapshot.sweepFreeTimes ? 0 : 1;
}

/** 月卡条是否显示（无月卡 ⇒ 显示销售条；FGUI `n74` 的 `gearDisplay pages="1"` 正是「否」页）。 */
export function monthCardBarVisibleOf(snapshot: IHjSnapshotView): boolean {
    return !snapshot.hasUnlimited;
}

/** 一个内容节点在弹窗根节点局部坐标系里的竖直范围（下边 / 上边，均以根节点中心为原点）。 */
export interface IHjLocalBox {
    /** 下边 = `position.y − height × anchorY`。 */
    bottom: number;
    /** 上边 = `position.y + height × (1 − anchorY)`。 */
    top: number;
}

/**
 * 内容块相对弹窗根节点中心的竖直偏移 —— **取负**就是让整块内容竖直居中的位移量。
 *
 * ## 为什么需要它（老端口径）
 *
 * 老端 `client/.../ctrl/hang/LayerHang.ts` 的 `init()` 第一行是
 * `this.com.toFullCenterParent(this.container)`（`toFull()` + `toCenter()`，见
 * `framework/fgui/FairyExtend_GObject.ts:85`），而 FGUI 原稿
 * `挂机/组件/组件_挂机_界面.xml` 的组 `n78` 又挂着
 * `<relation target="" sidePair="center-center,middle-middle"/>`
 * ⇒ **运行时整块内容在屏幕上竖直居中**；`xy="48,241"` 只是设计器里的静态值。
 *
 * 新端移植时只搬了静态坐标、没搬 relation ⇒ 内容偏下（预览实测世界坐标偏 **114**）。
 *
 * ## 为什么按「声明矩形」而不是「渲染包围盒」
 *
 * 老端 FGUI 求组 AABB 用的是子项的 `x/y/width/height`（**组件声明的尺寸**），
 * 标题横幅（`组件_公共弹窗_新` 内部、骑出底板顶 28px）不计入。
 * 所以这里也用 `position + contentSize + anchorPoint` 算，与老端同口径；
 * 换成 `getBoundingBoxToWorld()` 会把骑出的部分算进来，与老端差 14px。
 *
 * ## 为什么必须动态算
 *
 * 月卡条（FGUI `n74`，高 141）挂的是 `gearDisplay pages="1"`：**无月卡才显示**，
 * 它显隐会改内容块高度（1054 ↔ 903）⇒ 居中位移量在 128 / 52.5 之间切换。
 * 写死一个常数会让「已购月卡」的玩家看到偏下的界面。
 */
export function contentCenterOffsetY(boxes: readonly IHjLocalBox[]): number {
    if (boxes.length === 0) return 0;
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    for (const b of boxes) {
        if (b.top > top) top = b.top;
        if (b.bottom < bottom) bottom = b.bottom;
    }
    return (top + bottom) / 2;
}
