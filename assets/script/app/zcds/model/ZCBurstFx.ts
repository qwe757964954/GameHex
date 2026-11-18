/**
 * 菌毯爆发 / 菌核爆裂（`burst_aura` / `burst_knockback`，菌壶菇 101504 / 菌王菇 101804）
 * 的表现常量与「护盾期间减伤」状态 id。
 *
 * 这两条是「以自身为圆心的一次性范围结算」—— 与第 12 批的 `splash_shot`
 * （射一枚会爆的弹、在**命中点**爆）正好互补：那个的圆心由目标决定，这个的圆心恒等于自己。
 *
 * 为什么路径要写在代码里：行为技能的参数全压在 `pvpSkillPlan.skillParamJson` 上，
 * 那张表只有数值槽、没有造型列（同 `ZCBlinkCastFx` / `ZCSelfAuraFx` / `ZCTrapFx` /
 * `ZCSplashShotFx`）。硬编码路径必须同时进 `ZCVisualResourcePlan` 的清单，否则技能照常结算、
 * 屏幕上一次都不亮，而且一条错都不报。
 *
 * 设计案 O 列的口径是「零新增资源」：爆点复用普攻爆炸、护盾复用既有 shield 光圈。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/**
 * 爆点特效：普攻爆炸（31 帧）。
 *
 * 与 `ZCAttackResolutionSystem` 里区域伤害事件用的、以及 `ZCSplashShotFx` 命中点用的
 * 是同一个 prefab —— 半径由数据决定，美术不需要按档位另做一套（150 与 120 共用一个）。
*/
export const ZC_BURST_IMPACT_PREFAB_PATH = 'units/projectiles/普攻爆炸/普攻爆炸';

/** 爆发 + 自护盾（菌毯爆发 101504）。*/
export const ZC_BURST_AURA_BEHAVIOR_KEY = 'burst_aura';

/** 爆发 + 击退（菌核爆裂 101804）。*/
export const ZC_BURST_KNOCKBACK_BEHAVIOR_KEY = 'burst_knockback';

const BURST_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_BURST_AURA_BEHAVIOR_KEY, ZC_BURST_KNOCKBACK_BEHAVIOR_KEY,
]);

/** 这个行为键走不走「以自身为圆心爆一次」这条车道。*/
export function zcIsBurstBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && BURST_BEHAVIOR_KEYS.has(behaviorKey);
}

/**
 * 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。
 *
 * 两条行为键共用同一个爆点 prefab（只差「爆完给自己套盾」还是「爆完把怪推开」）——
 * 收成一个函数是为了让「播不播」和「加不加载」用同一个判据。
*/
export function zcBurstEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsBurstBehavior(behaviorKey)) return [];
    return [ZC_BURST_IMPACT_PREFAB_PATH];
}

/**
 * 「护盾存在期间受到伤害降低」的状态 id：`__burstguard:<百分点>:<秒>__`。
 *
 * 为什么要动态生成：菌毯爆发 III 级的减伤是 15%，而 `pvpStatus` 里**没有任何通用减伤定值档**
 * （只有 `vulnerability` 那几条「受到伤害提高」，方向相反），装不下这条。
 * 沿用低血护体（`__lowhp:`）与孢子凝珠（`__shotslow:`）的做法：同参数复用同一条定义，
 * 不往状态系统里按卡塞定义。
 *
 * 百分点口径与 `statJson` 一致（`damageTakenPct: -15` = 受到伤害 −15%），
 * 由 `ZCDamageResolutionSystem` 的 `1 + damageTakenPct / 100` 消费。
*/
export function burstGuardStatusId(reducePct: number, seconds: number): string {
    return `__burstguard:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

/**
 * `普攻爆炸` prefab 的屏上宽度（px）= `UITransform` 141 × prefab 根 `_lscale` 2.0。
 *
 * 量法（与 §26 光环那一套同源）：读 prefab 的 `cc.UITransform._contentSize.width`，
 * 再乘根节点的 `_lscale`。**不要**用节点 `_contentSize` —— 那格在 prefab 里是空的。
*/
export const ZC_BURST_IMPACT_PREFAB_SCREEN_WIDTH = 282;

/**
 * 屏上 px = 逻辑 px × 0.76875（= `combatDistanceScale` 0.3 × view/logical 2.5625）。
 * 设计说的「N px」一律是**表值逻辑 px**，判定半径走的也是这个口径。
*/
export const ZC_BURST_SCREEN_PER_LOGIC = 0.76875;

/**
 * 爆发特效的整体尺寸倍率：让爆炸的**屏上直径**等于判定直径。
 *
 * 为什么需要这一格：`ZCCombatEffectView` **从不**按 `event.radius` 缩放
 * （见那附近「area 类地面区域的视觉尺寸完全来自 prefab 的烘焙缩放」的注释），
 * 而 `普攻爆炸` 这一个 prefab 现在被四处共用 —— 普攻命中、孢爆箭的 90px 溅射、
 * 菌毯爆发的 150、菌核爆裂的 120。所以也不能给路径登记一个全局倍率
 * （`NODE_SCALE_BY_PREFAB_PATH`），那会把别人的爆炸一起放大。
 * ⇒ 只能让事件自带一份倍率，视图里与路径倍率相乘。
 *
 * 不这么做的后果是可量化的：原生尺寸 ≈ 半径 183 逻辑 px，
 * 配 120 的菌核爆裂会「看着半径 183、只有 120 内掉血」—— 就是项目里反复踩的
 * 「看着大、打不到」。
 *
 * `logicRadius` 传**表值**（`burstRadius`），不是乘过 `combatDistanceScale` 的世界值：
 * 0.76875 里已经含了那一步。非法值退回 1（宁可尺寸没改，也不能把节点缩成 0 让特效消失）。
*/
export function zcBurstEffectScale(logicRadius: number): number {
    if (!Number.isFinite(logicRadius) || logicRadius <= 0) return 1;
    const screenDiameter = logicRadius * 2 * ZC_BURST_SCREEN_PER_LOGIC;
    const scale = screenDiameter / ZC_BURST_IMPACT_PREFAB_SCREEN_WIDTH;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
