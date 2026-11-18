/**
 * 冲锋车道（`charge_shield` / `legacy_dash`）的表现常量与三个状态 id。
 *
 * 三条技能共用一套「位移 + 线性命中」的骨架（2026-11-17 第 15 批）：
 *  · 菌盾冲锋 101204（菇八戒 68012）—— `charge_shield`：**朝目标方向定长 1 格**，
 *    撞到的敌人吃伤害，落点给自己按最大生命百分比的护盾；
 *  · 冲锋 102303（南瓜战神 68023）—— `legacy_dash`：**朝最近敌人**冲，
 *    路径上的敌人吃伤害 + 眩晕，III 级落地后自己减伤；
 *  · 尖刺冲锋 102703（爆锤莲王 68027）—— `legacy_dash`：**朝面朝方向**冲，
 *    路径上的敌人吃伤害 + 易伤（受伤提高），III 级落地后给自己护盾。
 *
 * 与既有三条位移车道的关系（都不能复用）：
 *  · `blink_strike`（103404）—— 闪现到落点打**一个**，还带往返 / 分身；
 *  · `single_strike`（101403，第 14 批）—— 贴上去打**一个**，落点固定为目标身边；
 *  · 本车道 —— 命中集合是**一整条线段**（起点 → 落点），且落点由「冲刺格数」决定、
 *    不是「贴到目标身边」。用 `strikeTargets`（只认圆形）或 `castFanSweep`（只认扇形）
 *    都表达不了「路径上的人都挨一下」。
 *
 * 设计案 O 列点名的两个 prefab 都在工程里、此前没有任何技能在用：
 *  · `轻骑兵_冲锋`（contentSize 300×140、根 `_lscale` 1、单片 1 帧 loop ⇒ 静态图）；
 *  · `刀盾兵_护盾`（contentSize 100×100、根 `_lscale` 1、17 帧 loop = 1.417s）。
 * 两条都必须进 `ZCVisualResourcePlan` 的清单，否则技能照常结算、屏幕上什么都没有且不报错。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 菌盾冲锋的行为键。*/
export const ZC_CHARGE_SHIELD_BEHAVIOR_KEY = 'charge_shield';

/** 冲锋 / 尖刺冲锋的行为键（两条共用同一套实现，只有参数不同）。*/
export const ZC_LEGACY_DASH_BEHAVIOR_KEY = 'legacy_dash';

/** 冲锋位移的表现：轻骑兵_冲锋（静态单帧）。*/
export const ZC_DASH_EFFECT_PREFAB_PATH = 'units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋';

/**
 * 冲锋残影播多久（秒）= 设计案 O 列原话「沿朝向平移留 0.3s 残影」。
 *
 * 这一条**不**按「帧数 ÷ 采样率」算：那个口径是给序列帧用的，而 `轻骑兵_冲锋` 的 clip
 * 只有 1 帧（`_duration` 0.0833、`wrapMode` 2 = loop）⇒ 它本质上是一张静态图，
 * 时长由设计给的残影时长决定，不由帧数决定。
*/
export const ZC_DASH_EFFECT_SECONDS = 0.3;

/** 落地自保的表现：刀盾兵_护盾（设计案 O 列「叠 刀盾兵_护盾(缩 55%)」）。*/
export const ZC_DASH_GUARD_PREFAB_PATH = 'units/projectiles/刀盾兵_护盾/刀盾兵_护盾';

/**
 * 护盾表现的播放时长（秒）= 17 帧 ÷ 12fps。
 *
 * 与 `ZC_DASH_EFFECT_SECONDS` 相反：这一条是**序列帧**，必须按帧数走完，
 * 拍一个短于它的时长会把动画截断（`长戟兵_撕裂` 踩过同一个坑，见 `ZCSingleStrikeFx`）。
 * 16 帧 × 1/12 = 1.3333，但 clip 的 `_duration` 实测 1.4167 = 17 × 1/12 ⇒ 以 clip 为准。
*/
export const ZC_DASH_GUARD_SECONDS = 17 / 12;

/**
 * 这条行为键走不走「冲锋」车道。
 *
 * `charge_shield` 与 `legacy_dash` 共用一个实现、只是参数不同（一个定长 1 格 + 护盾，
 * 一个朝最近敌人 / 面朝 + 眩晕或易伤），所以判据是「两个键之一」而不是单个相等。
 * 反馈到配表：两个键各自的参数前缀仍是分开的（`charge*` / `dash*`），
 * 因为 68012 / 68023 / 68027 三张卡的参数袋里已经住着别的车道。
*/
export function zcIsChargeBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey === ZC_CHARGE_SHIELD_BEHAVIOR_KEY
        || behaviorKey === ZC_LEGACY_DASH_BEHAVIOR_KEY;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcChargeEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsChargeBehavior(behaviorKey)) return [];
    //  落点自保的 `刀盾兵_护盾` 只在 102303 III 级（减伤）时出现，参数是运行时才知道的；
    //  加载清单按「这条车道可能要什么」收，多收一个 prefab 的代价远小于「该播的时候没加载」。
    return [ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_GUARD_PREFAB_PATH];
}

/**
 * 冲锋后「自身受到伤害降低 N%」的状态 id：`__dashguard:<百分点>:<秒>__`。
 *
 * 102303 III 级原话「冲锋结束后自身受到伤害降低 25%，持续 3 秒」。
 * `pvpStatus` 里**没有**「受到伤害降低」的通用档（`vulnerability*` 是反方向：受伤提高），
 * 所以与 `__burstguard:`（第 13 批菌毯爆发）同一套做法：按「百分点 + 秒数」现拼再注册。
 * `damageTakenPct` 用百分点口径（`-25` = 受伤 −25%）。
*/
export function dashGuardStatusId(reducePct: number, seconds: number): string {
    return `__dashguard:${reducePct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

/**
 * 冲锋命中后「目标受到的伤害提高 N%」的状态 id：`__dashvuln:<百分点>:<秒>__`。
 *
 * 102703 II 级「使目标受到的伤害提高 20%，持续 4 秒」/ III 级「破甲 35% 持续 6 秒」——
 * 两条是同一个机制的两档强度，所以合成一条参数化签名。
 * 与 `dashGuardStatusId` **方向相反**：这里是 `damageTakenPct: +20`（受伤提高），
 * 共用一条 id 会把「自保」和「破甲」写反，而且反了之后谁都看不出来。
*/
export function dashVulnerableStatusId(pct: number, seconds: number): string {
    return `__dashvuln:${pct.toFixed(4)}:${seconds.toFixed(2)}__`;
}

//  眩晕不在这里另立一套 id：`single_strike`（第 14 批）的 `__stunstrike:<秒>__` 就是
//  「参数化硬控」的规范签名（`control: 'stun'`），机制完全一样 ⇒ 直接复用
//  `ZCSingleStrikeFx.singleStrikeStunStatusId`。同一件事写两个 id 只会让状态系统里多一条
//  永远命不中的定义。
