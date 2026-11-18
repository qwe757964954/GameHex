/**
 * 风炮菇 68013 的两条主动（2026-11-18 第 16 批，设计案 V12）：
 *  · `wind_bolt`（101303「孢爆箭」）—— 射一枚风弹，命中留一片飓风，接触者各吃一次；
 *  · `missile_barrage`（101304「连射导弹」）—— 每累计 N 次普攻，1.2s 内抛 3 枚炸弹，
 *    落点在目标周围随机，到达落点才爆炸（途中不碰人）。
 *
 * 为什么路径写在代码里：行为技能的参数全压在 `pvpSkillPlan.skillParamJson` 上，
 * 那张表只有数值槽、没有造型列（同 `ZCBlinkCastFx` / `ZCSplashShotFx` / `ZCDashFx`）。
 * 硬编码路径必须同时进 `ZCVisualResourcePlan` 的清单，否则技能照常结算、
 * 屏幕上什么都不出现，而且一条错都不报。
 *
 * 资源口径（零新增资源）：
 *  · 风弹飞行段借 `风法师_绿风`（青色月牙，原本是镭射飞龙普攻的候选；
 *    那条后来改成了光束，这个 prefab 目前没有技能在用）；
 *  · 命中爆点与炸弹落点爆炸都复用 `普攻爆炸`（与溅射 / 爆发 / 扇形同一条）；
 *  · 飓风区域借 `风法师_龙卷风`（已在 `ZCCombatEffectScale` 登记过 0.5 的尺寸基准，
 *    说明它就是为「世界尺寸由数据决定」这一类区域准备的美术）。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 风弹的飞行段（青色月牙）。*/
export const ZC_WIND_BOLT_MISSILE_PREFAB_PATH = 'units/projectiles/风法师_绿风/风法师_绿风';

/** 风弹命中当拍的爆点（与普攻爆炸同一个 prefab）。*/
export const ZC_WIND_BOLT_IMPACT_PREFAB_PATH = 'units/projectiles/普攻爆炸/普攻爆炸';

/**
 * 命中点留下的飓风（常驻区域）。
 *
 * 与爆点是两个 prefab：爆点只在命中那一拍闪一次，飓风要活满 `windZoneSeconds`。
 * 用同一个的话，角色身上会挂着一段「爆炸序列帧」当区域，看着像一直在挨打。
*/
export const ZC_WIND_BOLT_ZONE_PREFAB_PATH = 'units/projectiles/风法师_龙卷风/风法师_龙卷风';

/** 连射导弹的飞行段：与风弹共用那枚月牙（都是「风系弹体」，同一张卡）。*/
export const ZC_MISSILE_BARRAGE_MISSILE_PREFAB_PATH = ZC_WIND_BOLT_MISSILE_PREFAB_PATH;

/** 连射导弹的落点爆炸：与普攻爆炸同一条。*/
export const ZC_MISSILE_BARRAGE_IMPACT_PREFAB_PATH = ZC_WIND_BOLT_IMPACT_PREFAB_PATH;

/**
 * 连射导弹落点爆炸的表现时长（秒）。
 *
 * 与 `普攻爆炸` 那条序列帧的既有口径一致（`castSplashShot` / `castBurstSkill` 同样取 0.5）。
 * 短这个数会被模型按 `startedAt + durationSeconds` 提前摘掉，爆炸只播一半。
*/
export const ZC_MISSILE_BARRAGE_IMPACT_SECONDS = 0.5;

/** 风弹车道的行为键。*/
export const ZC_WIND_BOLT_BEHAVIOR_KEY = 'wind_bolt';

/** 连射导弹车道的行为键。*/
export const ZC_MISSILE_BARRAGE_BEHAVIOR_KEY = 'missile_barrage';

const WIND_BOLT_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([ZC_WIND_BOLT_BEHAVIOR_KEY]);

const MISSILE_BARRAGE_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([ZC_MISSILE_BARRAGE_BEHAVIOR_KEY]);

/** 这个行为键走不走「射一枚风弹、命中留飓风」这条车道。*/
export function zcIsWindBoltBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && WIND_BOLT_BEHAVIOR_KEYS.has(behaviorKey);
}

/** 这个行为键走不走「累计普攻发射连射导弹」这条车道。*/
export function zcIsMissileBarrageBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && MISSILE_BARRAGE_BEHAVIOR_KEYS.has(behaviorKey);
}

/**
 * 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。
 *
 * 收成一个函数是为了让「播不播」和「加不加载」用同一个判据 ——
 * 两处各写一遍字符串迟早会对不上（`ZCBlinkCastFx` / `ZCSplashShotFx` 同一条理由）。
*/
export function zcWindBoltEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsWindBoltBehavior(behaviorKey)) return [];
    return [ZC_WIND_BOLT_MISSILE_PREFAB_PATH, ZC_WIND_BOLT_IMPACT_PREFAB_PATH, ZC_WIND_BOLT_ZONE_PREFAB_PATH];
}

export function zcMissileBarrageEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsMissileBarrageBehavior(behaviorKey)) return [];
    return [ZC_MISSILE_BARRAGE_MISSILE_PREFAB_PATH, ZC_MISSILE_BARRAGE_IMPACT_PREFAB_PATH];
}
