/**
 * 孢爆箭 / 孢子凝珠（`splash_shot` / `spore_burst`，风炮菇 101303 / 水手菇 101104）
 * 的表现常量与减速状态 id。
 *
 * 为什么路径要写在代码里：行为技能的参数全压在 `pvpSkillPlan.skillParamJson` 上，
 * 那张表只有数值槽、没有造型列（同 `ZCBlinkCastFx` / `ZCSelfAuraFx` / `ZCTrapFx`）。
 * 硬编码路径必须同时进 `ZCVisualResourcePlan` 的清单，否则技能照常结算、
 * 屏幕上箭与爆炸都不出现，而且一条错都不报。
 *
 * 设计案 O 列的口径是「零新增资源」：弹体复用投枪那枚通用箭矢，命中爆点复用普攻爆炸。
 * 两个 prefab 都已经被别的技能在用，这里只是把「哪个行为键用哪两条」写成一张表。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 弹体（飞行段）特效：投枪/贯穿箭用的那枚通用箭矢。*/
export const ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH = 'units/projectiles/子弹_新怪物/通用箭矢';

/**
 * 命中爆点特效：普攻爆炸（31 帧）。
 *
 * 与 `ZCAttackResolutionSystem` 里区域伤害事件用的 `units/projectiles/普攻爆炸/普攻爆炸`
 * 是同一个 prefab —— 溅射半径由数据决定，美术不需要按档位另做一套。
*/
export const ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH = 'units/projectiles/普攻爆炸/普攻爆炸';

/** 无减速的那条（孢爆箭 101303）：射一发、炸一片。*/
export const ZC_SPLASH_SHOT_BEHAVIOR_KEY = 'splash_shot';

/** 带减速的那条（孢子凝珠 101104）：同上，外加给命中目标挂一段按档位变比例的减速。*/
export const ZC_SPORE_BURST_BEHAVIOR_KEY = 'spore_burst';

const SPLASH_SHOT_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_SPLASH_SHOT_BEHAVIOR_KEY, ZC_SPORE_BURST_BEHAVIOR_KEY,
]);

/** 这个行为键走不走「射一发会爆的弹」这条车道。*/
export function zcIsSplashShotBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && SPLASH_SHOT_BEHAVIOR_KEYS.has(behaviorKey);
}

/**
 * 行为键 → 这条车道需要的两条 prefab 路径；不是这条车道返回空数组。
 *
 * 收成一个函数是为了让「播不播」和「加不加载」用同一个判据，
 * 两处各写一遍字符串迟早会对不上（`ZCBlinkCastFx` 同一条理由）。
*/
export function zcSplashShotEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsSplashShotBehavior(behaviorKey)) return [];
    return [ZC_SPLASH_SHOT_MISSILE_PREFAB_PATH, ZC_SPLASH_SHOT_IMPACT_PREFAB_PATH];
}

/**
 * 减速状态的 id：`__shotslow:<百分点>:<秒>__`。
 *
 * 为什么要动态生成：孢子凝珠三档的减速是 15 / 20 / 25%，时长 2 / 2 / 3 秒，
 * 而 `pvpStatus` 表里的 `slow` 是**一张定值档**，装不下按档位变的比例。
 * 这里沿用友军光环（`teamAuraStatusId`）的做法：同参数复用同一条定义，
 * 不往状态系统里按卡塞定义。
 *
 * 百分点口径与 `statJson` 一致（`moveSpeedPct: -15` = 移速 −15%），
 * 不是 0~1 的小数 —— 与 `teamAura*MoveSpeedPct` 的 40 = +40% 同一个单位。
*/
export function splashShotSlowStatusId(slowPct: number, seconds: number): string {
    return `__shotslow:${slowPct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
