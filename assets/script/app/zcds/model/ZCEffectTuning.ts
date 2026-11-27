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
    fanSweepSeconds: 19 / 24,        // 19 帧 @ 24fps（机甲菇_武器绞杀，全透明帧已剔除）
    meteorSlamSeconds: 33 / 24,      // 33 帧 @ 24fps（运动霸_砸落技能，无全透明帧）
    /**
     * 通用治疗特效（Spine `eff_cost_01` / 动画 `eff_buff_heal`）的 clip 时长 = 1.0s。
     *
     * 这个数**是从二进制里读出来的，不是估的**：该 `.skel` 是 Spine 3.8 二进制、
     * 浮点大端、时间轴是**绝对时间**（不是增量）。可解析段里 12 条 slot 颜色时间轴的
     * 末帧分别是 0.5 / 0.6667 / 0.7333 / 0.8 / 0.8333 / **1.0000**，最长为 1.0000 且出现 8 次
     * ⇒ clip 时长 1.0s。改动素材（换 skel）必须重读，别沿用这个数。
     *
     * 🔴 不会报错的两个坑：事件寿命 < clip ⇒ 播一半被摘；寿命 > clip 且 `loop = false`
     * ⇒ 停在末帧。所以这条必须与素材同步。
     */
    healAuraSeconds: 1.0,
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
    /** 技能范围白环 prefab 在 scale 1 时的**横向**半径（屏上 px）；纵向 = 横向 × 0.8361 */
    rangeRingReferenceRadius: 256,
    beamMinLength: 6,                // 视图 px，防止贴脸缩成 0 不可见
    summonAuraCoverScale: 1.99,
    summonAuraRingHalfScreenX: 91.9, // effectScale = 1 时的可见环半轴（屏上 px）
    summonAuraRingHalfScreenY: 36.05,
    selfAuraLandingAngleDegrees: 180,
    selfAuraLandingSeconds: 0.5,
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
