/**
 * 战斗特效的时长、缩放、状态 id 前缀与通用兜底值的单一真源。
 *
 * 本文件是纯 TS，不依赖 `cc`；Fx 模块只把这里的值按原导出名转出，
 * 业务系统不需要为了调一个时长或状态前缀去改逻辑文件。
 */

/** 行为技能与通用表现事件的时长（秒）。*/
export const ZC_EFFECT_TUNING = {
    /** 瞬间移动 clip：18 帧 @ sample 24。*/
    blinkSeconds: 0.75,
    /** 落雷 clip：20 帧 @ sample 30；配表 boltDelay 0.15 落在第 5 帧。*/
    boltSeconds: 20 / 30,
    /** 链雷单跳时长；与落雷同一份美术。*/
    chainSeconds: 20 / 30,
    /** 链雷逐跳错开间隔；只为观感，结算仍在同一帧完成。*/
    chainStepSeconds: 0.05,
    /** 链雷逐跳透明度递减量。*/
    chainFadeStep: 0.12,
    /** 链雷透明度下限。*/
    chainFadeFloor: 0.4,
    /** 冲锋残影：静态单帧，按设计给的 0.3s。*/
    dashSeconds: 0.3,
    /** 刀盾护盾 clip：17 帧 @ 12fps。*/
    dashGuardSeconds: 17 / 12,
    /**
     * 仙桃行者重击柱 clip：29 帧 @ 24fps（`仙桃行者_重击技能-play`）。
     *
     * 与 `tools/build_xiantao_quake_fx.py` 的 `FRAMES` / `SAMPLE` 必须一致：事件寿命短于 clip
     * 会被 `ZCGameModel` 按 `startedAt + durationSeconds` 提前摘掉，表现出来就是「砸到一半就没了」。
     */
    quakeStrikeSeconds: 29 / 24,
    /** 长戟兵撕裂 clip：8 帧 @ 12fps。*/
    singleStrikeSeconds: 8 / 12,
    /** 陷阱生成动画：12 帧 @ sample 30，同时是常驻视觉的延迟。*/
    trapSpawnSeconds: 12 / 30,
    /** 陷阱爆炸动画：18 帧 @ sample 30。*/
    trapExpireSeconds: 18 / 30,
    /** 飓风接触判定间隔：20Hz 模拟下每逻辑步一波。*/
    hurricaneTouchSeconds: 0.05,
    /** 连射炸弹落点散布半径（逻辑 px）；设计写的是 30px 直径。*/
    barrageScatterRadius: 15,
    /** 连射炸弹飞行速度（逻辑 px/s）；设计没给，取与 1.2s 节拍同量级的值。*/
    barrageFlightSpeed: 300,
    /** 连射间隔兜底；配表 `barrageInterval` 缺省时使用。*/
    barrageDefaultInterval: 0.4,
    /** 炸弹最短飞行时间，避免贴脸时在出手帧就炸。*/
    barrageMinFlightSeconds: 0.12,
    /** 导弹命中爆炸的基准判定半径（逻辑 px），事件级缩放以它为 1.0。*/
    barrageImpactReferenceRadius: 80,
    /** 通用命中爆点事件时长兜底（秒）。*/
    impactEffectSeconds: 0.5,
    /** 无命中爆点时的弹道收尾时长（秒）。*/
    projectileFadeSeconds: 0.18,
    /** 通用近战 / 区域事件时长兜底（秒）。*/
    eventSeconds: 0.3,
    /** 近战冲击环的余波时长；比主特效长一点，但不盖住下一次普攻。*/
    shockwaveEventSeconds: 0.35,
    /** 未登记飞行段时，近战 / 区域事件时长（`ZCCombatSystem.attackTravelSeconds` 同源）。*/
    defaultAttackTravelSeconds: 0.32,
    /** 未给弹速时的兜底（逻辑 px/s）。*/
    defaultProjectileSpeed: 500,
} as const;

/** 屏上 px 与逻辑 px 的换算、按 prefab 烘焙尺寸反算缩放时用的基准。*/
export const ZC_EFFECT_SCALE = {
    /** 屏上 px = 逻辑 px × 0.76875（`combatDistanceScale` 0.3 × view/logical 2.5625）。*/
    screenPxPerLogic: 0.76875,
    /** `普攻爆炸` prefab 的屏上宽度：UITransform 141 × 根 `_lscale` 2.0。*/
    burstPrefabScreenWidth: 282,
    /**
     * 射线集束那张图烘进 prefab 的基准半长（逻辑 px）。
     *
     * 2026-11-23 第 43 批换图：雷电冲击 → 镭射飞龙_普攻（用户口径「射线颜色和镭射飞龙
     * 普攻一致」）。按可见内容重算：画布 700×73、alpha bbox 66~641 ⇒ 可见宽 575，
     * 根 `_lscale.x = 1` ⇒ 屏上 575 px ⇒ 逻辑 575 / 0.76875 ≈ 748 ⇒ 半长 **374**。
     * （旧值 180 是按雷电冲击算的：可见宽 485 × 0.575963 / 0.76875 / 2 ≈ 182。）
     * 🔴 改这条必须同步 `zcRayBeamEffectScale` 的结果：屏上光束长度要等于表值判定长度。
     */
    rayBeamReferenceHalfLength: 374,
    /** 菌丝绞杀扇形里铺几发爆点。*/
    fanBurstCount: 3,
    /** 每发爆点半径 = 扇形半径 × 该比例。*/
    fanBurstRadiusRatio: 0.5,
    /** 爆点离施法者距离 = 扇形半径 × 该比例。*/
    fanBurstDistanceRatio: 0.6,
    /** 相邻爆点角度间隔 = 半个扇形角 × 该比例。*/
    fanBurstSpread: 0.6,
    /** 光束最短长度（视图 px）：贴脸时 `to` 可能落在发射口后面，缩成 0 会整条消失。*/
    beamMinLength: 6,
    /** 召唤光环可见环要盖住「本体 + 4 个舞伴」的放大倍率（事件级 effectScale）。*/
    summonAuraCoverScale: 1.99,
    /** `effectScale = 1` 时「持续光环伤害效果」可见环的半轴（屏上 px）。*/
    summonAuraRingHalfScreenX: 91.9,
    summonAuraRingHalfScreenY: 36.05,
} as const;

/** 参数化状态 id 的固定前缀；格式化函数仍留在各自 Fx facade。*/
export const ZC_EFFECT_STATUS_PREFIX = {
    /** 落雷麻痹：只禁攻击、移速 -50%，不是 3 秒硬控。*/
    boltNumb: 'numb',
    /** 护盾期受到伤害降低。*/
    burstGuard: '__burstguard',
    /** 冲锋落地后受到伤害降低。*/
    dashGuard: '__dashguard',
    /** 冲锋命中后目标受到伤害提高。*/
    dashVulnerable: '__dashvuln',
    /** 扇形减速。*/
    fanSlow: '__fanslow',
    /** 孢爆箭 / 孢子凝珠减速。*/
    splashSlow: '__shotslow',
    /** 单目标硬控眩晕。*/
    singleStrikeStun: '__stunstrike',
    /** 命中后自身攻速提高。*/
    singleStrikeHaste: '__strikehaste',
} as const;

/** 命中附加特效的落点比例；与配表 `pvpSkill.impactEffectAnchor` 的 0~1 口径一致。*/
export const ZC_IMPACT_ANCHOR_RATIO = {
    target: 0,
    midpoint: 0.5,
} as const;
