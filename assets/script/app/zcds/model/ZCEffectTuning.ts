/** 战斗特效时长（秒）、缩放基准与状态 ID 前缀 */

export const ZC_EFFECT_TUNING = {
    blinkSeconds: 0.75,              // 18 帧 @ 24fps
    boltSeconds: 20 / 30,            // 20 帧 @ 30fps，boltDelay 0.15 落在第 5 帧
    chainSeconds: 20 / 30,
    chainStepSeconds: 0.05,          // 仅表现错帧，结算仍同帧完成
    chainFadeStep: 0.12,
    chainFadeFloor: 0.4,
    dashSeconds: 0.3,
    dashGuardSeconds: 17 / 12,       // 17 帧 @ 12fps
    quakeStrikeSeconds: 29 / 24,     // 29 帧 @ 24fps，需覆盖完整 clip
    singleStrikeSeconds: 8 / 12,     // 8 帧 @ 12fps
    trapSpawnSeconds: 12 / 30,       // 12 帧 @ 30fps
    trapExpireSeconds: 18 / 30,      // 18 帧 @ 30fps
    hurricaneTouchSeconds: 0.05,     // 20Hz 每步判定一次
    barrageScatterRadius: 15,        // 逻辑 px
    barrageFlightSpeed: 300,         // 逻辑 px/s
    barrageDefaultInterval: 0.4,
    barrageMinFlightSeconds: 0.12,   // 防止贴脸出手帧瞬爆
    barrageImpactReferenceRadius: 80,// 逻辑 px，缩放 1.0 基准
    impactEffectSeconds: 0.5,
    projectileFadeSeconds: 0.18,
    eventSeconds: 0.3,
    shockwaveEventSeconds: 0.35,
    defaultAttackTravelSeconds: 0.32,
    defaultProjectileSpeed: 500,     // 逻辑 px/s
} as const;

/** 屏上 px 与逻辑 px 换算及 prefab 缩放基准 */
export const ZC_EFFECT_SCALE = {
    /** combatDistanceScale(0.3) * 视图缩放比(2.5625) */
    screenPxPerLogic: 0.76875,
    /** 普攻爆炸 prefab 屏上宽：UITransform 141 * 节点缩放 2.0 */
    burstPrefabScreenWidth: 282,
    /** 射线集束 prefab 基准半长（逻辑 px，对应可见宽 575 屏上 px） */
    rayBeamReferenceHalfLength: 374,
    fanBurstCount: 3,
    fanBurstRadiusRatio: 0.5,
    fanBurstDistanceRatio: 0.6,
    fanBurstSpread: 0.6,
    beamMinLength: 6,                // 视图 px，防止贴脸缩成 0 不可见
    summonAuraCoverScale: 1.99,
    summonAuraRingHalfScreenX: 91.9, // effectScale = 1 时的可见环半轴（屏上 px）
    summonAuraRingHalfScreenY: 36.05,
} as const;

export const ZC_EFFECT_STATUS_PREFIX = {
    boltNumb: 'numb',                // 落雷软控：禁攻 + 减速
    burstGuard: '__burstguard',
    dashGuard: '__dashguard',
    dashVulnerable: '__dashvuln',
    fanSlow: '__fanslow',
    splashSlow: '__shotslow',
    singleStrikeStun: '__stunstrike',
    singleStrikeHaste: '__strikehaste',
} as const;

/** 命中附加特效的落点比例（与 pvpSkill.impactEffectAnchor 0~1 一致） */
export const ZC_IMPACT_ANCHOR_RATIO = {
    target: 0,
    midpoint: 0.5,
} as const;
