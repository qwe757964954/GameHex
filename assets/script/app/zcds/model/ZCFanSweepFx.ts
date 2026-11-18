/**
 * 菌丝绞杀（`fan_slow`，机甲菇 101503）的表现常量与减速状态 id。
 *
 * 「向身前 120° 扇形甩出去」—— 与第 12 / 13 批的关系：
 *  · `splash_shot`（第 12 批）是**一个点**炸开（圆心由命中点决定）；
 *  · `burst_*`（第 13 批）是**一个圆**炸开（圆心恒等于自己、360°）；
 *  · 这一条是**一段扇形**（圆心恒等于自己，但只覆盖身前 120°），所以「圆心在脚下」这点
 *    与 `burst_*` 相同、命中集合与它们都不同 —— 既不能复用 `strikeTargets`（只认圆形），
 *    也不能直接调 `castFanSkill`（那条是副轨，半径按普攻射程 ×倍率算、且没有人数上限）。
 *
 * 设计案 O 列的口径是「表现用普攻爆炸沿扇形展开，不新增序列帧」：
 * 扇形这个形状没有现成美术，所以铺 3 发普攻爆炸在扇形里（见下面的三个比例常量），
 * 读起来就是「一片扇形被打亮」。等美术给了真正的扇形序列帧，只改这个文件即可。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

import { ZC_BURST_IMPACT_PREFAB_PATH } from './ZCBurstFx';

/** 菌丝绞杀的行为键。*/
export const ZC_FAN_SWEEP_BEHAVIOR_KEY = 'fan_slow';
/** 扇形里铺几发爆点。3 发是「一头一尾加正中」，再多会糊成一片。*/
export const ZC_FAN_SWEEP_BURSTS = 3;

/** 每发爆点的半径 = 扇形半径 × 这个比例。*/
export const ZC_FAN_SWEEP_BURST_RADIUS_RATIO = 0.5;

/** 爆点离施法者的距离 = 扇形半径 × 这个比例（贴边的话扇形的「内圈」会是空的）。*/
export const ZC_FAN_SWEEP_BURST_DISTANCE_RATIO = 0.6;

/**
 * 相邻爆点的角度间隔 = 半个扇形角 × 这个比例。
 * 0.6 ⇒ 三发分别落在 −0.6H / 0 / +0.6H，最外侧那发仍在扇形内（0.6 < 1）。
*/
export const ZC_FAN_SWEEP_BURST_SPREAD = 0.6;

/** 这个行为键走不走「扇形甩击」这条车道。*/
export function zcIsFanSweepBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && behaviorKey === ZC_FAN_SWEEP_BEHAVIOR_KEY;
}

/**
 * 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。
 *
 * 爆点复用 `普攻爆炸`（与 `ZCSplashShotFx` / `ZCBurstFx` 同一个 prefab）：
 * 设计案 O 列写明「不新增序列帧」，尺寸由 `zcBurstEffectScale` 反算，美术不需要另做一套。
 * 路径直接引 `ZC_BURST_IMPACT_PREFAB_PATH` 而不是再抄一遍字符串 —— 抄两遍迟早对不上。
*/
export function zcFanSweepEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsFanSweepBehavior(behaviorKey)) return [];
    return [ZC_BURST_IMPACT_PREFAB_PATH];
}

/**
 * 减速状态的 id：`__fanslow:<百分点>:<秒>__`。
 *
 * 为什么要动态生成：三档减速是 40 / 45 / 50%，`pvpStatus` 里的定值档装不下这种「按档位变比例」。
 * 与 `__shotslow:`（第 12 批孢子凝珠）/ `__burstguard:`（第 13 批护盾期减伤）同一套做法：
 * 同参数复用同一条定义，不往状态系统里按卡塞定义。
 *
 * `moveSpeedPct` 用百分点口径（`-40` = 移速 −40%），写 0.4 等于没有。
*/
export function fanSweepSlowStatusId(slowPct: number, seconds: number): string {
    return `__fanslow:${slowPct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
