import type { ZCAttackTrait, ZCCardRarity, ZCCardType, ZCCombatEventType, ZCUnitId, ZCUnitDefinition } from './ZCCombatCatalog';
// 转出以保持既有 import 路径兼容
export type { ZCCombatEventType };
import type { ZCFaction, ZCOwner } from './ZCMapConfig';
import type { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCStatusSystemSnapshot } from './ZCStatusEffect';
import type { ZCLegacyBuffApplication } from './ZCLegacySkillEffect';

/** 渲染读取实时状态；只有 exportSnapshot() 返回可独立修改的存档。 */
export type DeepReadonly<T> = T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** 伤害来源种类：单位 / 建筑 / 神器。 */
export const ZCDamageSourceKind = {
    Unit: 'unit',
    Building: 'building',
    Artifact: 'artifact',
} as const;
export type ZCDamageSourceKind = (typeof ZCDamageSourceKind)[keyof typeof ZCDamageSourceKind];

export interface ZCDamageSource {
    owner: ZCFaction;
    kind: ZCDamageSourceKind;
    unitId?: number;
    /** 出手与命中日志关联的弹道 ID。 */
    projectileId?: number;
    /** 飘字表现类型。 */
    floatTextKind?: ZCCombatFloatTextKind;
    /** 同一次命中已显示的伤害偏移（用于秒杀等数值合并）。 */
    floatTextValueOffset?: number;
    /** 攻击方职业（对应卡表 traits.attack），用于匹配受击特效；留空则不播放。 */
    attackerTrait?: ZCAttackTrait;
    /** 是否为远程伤害（投射物/范围/持续区域），用于减伤计算；缺省为近战。 */
    ranged?: boolean;
}

/** 对局生命周期状态。 */
export const ZCGameStatus = {
    Playing: 'playing',
    Victory: 'victory',
    Defeat: 'defeat',
    Draw: 'draw',
} as const;
export type ZCGameStatus = (typeof ZCGameStatus)[keyof typeof ZCGameStatus];

export const ZCBuildingType = {
    None: 'none',
    Hq: 'hq',
    Mine: 'mine',
    Barracks: 'barracks',
    Tower: 'tower',
} as const;
export type ZCBuildingType = (typeof ZCBuildingType)[keyof typeof ZCBuildingType];

export const ZCTileState = {
    Occupied: 'occupied',
    Occupiable: 'occupiable',
    Developable: 'developable',
    Developed: 'developed',
    Ruins: 'ruins',
} as const;
export type ZCTileState = (typeof ZCTileState)[keyof typeof ZCTileState];

export const ZCUnitBattleState = {
    Born: 'born',
    Target: 'target',
    MoveForward: 'moveForward',
    Move: 'move',
    WaitAttack: 'waitAttack',
    Attack: 'attack',
    Idle: 'idle',
    Dead: 'dead',
} as const;
export type ZCUnitBattleState = (typeof ZCUnitBattleState)[keyof typeof ZCUnitBattleState];

/** 攻击目标种类：单位 / 城墙 / 建筑。 */
export const ZCCombatTargetKind = {
    Unit: 'unit',
    Wall: 'wall',
    Building: 'building',
} as const;
export type ZCCombatTargetKind = (typeof ZCCombatTargetKind)[keyof typeof ZCCombatTargetKind];

/** 战斗伤害飘字类型。 */
export const ZCCombatFloatTextKind = {
    Damage: 'damage',
    Critical: 'critical',
    Restraint: 'restraint',
    Resisted: 'resisted',
    Execute: 'execute',
} as const;
export type ZCCombatFloatTextKind = (typeof ZCCombatFloatTextKind)[keyof typeof ZCCombatFloatTextKind];

/** 完整飘字类型，包含伤害、治疗、闪避及金币掉落/产出。 */
export type ZCFloatTextKind = ZCCombatFloatTextKind | 'heal' | 'miss' | 'gold' | 'goldincome';

export interface ZCHexState {
    neutralFeature?: IZCNeutralFeatureState;
    id: number;
    owner: ZCFaction;
    state: ZCTileState;
    building: ZCBuildingType;
    tier: number;
    hp: number;
    maxHp: number;
    /** 外围城墙独立耐久；归零后方可攻击本格建筑。 */
    wallHp: number;
    wallMaxHp: number;
    /** 城墙被击破的单边缺口索引（0~5）；null 为完整或旧版全毁。 */
    wallBreachedEdge?: number | null;
    developmentCost: number;
    /** PVP 地块类别；主城为 null。 */
    tileType: ZCPvpTileType | null;
    /** 本格是否已完成抽取开发（已消耗）。 */
    developmentResolved: boolean;
    cardId: string | null;
    /** 本局抽中的中立资源项 ID；null 或缺省表示非资源点或已被领取。 */
    neutralResourceId?: number | null;
    /** 建造剩余秒数；> 0 时不可产出或攻击。 */
    constructionRemainingSeconds: number;
    constructionTotalSeconds: number;
    captureOwner: ZCOwner | null;
    /** 当前进攻阵营的占领进度（秒）。 */
    captureSeconds: number;
}

export interface ZCUnitState {
    neutralReinforcement?: boolean;
    /** 召唤物到期时刻（绝对秒数）；缺省表示不过期（持续到阵亡）。 */
    summonUntil?: number;
    /** 召唤物的施法者单位实例 ID；跟随本体移动，本体阵亡后一同销毁。 */
    summonMasterId?: number;
    /** 跟随阵位编号（0~3：左上/右上/左下/右下）；缺省表示自由移动不绑定阵位。 */
    summonSlot?: number;
    /** 阵位角度列表（基准度数）；缺省走 SUMMON_SLOT_DEGREES。*/
    summonSlotAngles?: readonly number[];
    /** 阵位半径（世界 px，召唤时换算并固化）。 */
    summonSlotRadius?: number;
    /** 跟随型召唤物的拴绳横向半径（世界 px）；超出范围被拉回，缺省钉死在阵位。 */
    summonLeashRadius?: number;
    /** 拴绳纵向半轴（世界 px）；配合椭圆光环判定，缺省与横向半径一致（圆形）。 */
    summonLeashRadiusY?: number;
    /** 召唤物表现透明度（0~1，纯表现）；缺省为 1（不透明）。 */
    summonAlpha?: number;
    /** 是否为独立分身；为 true 时不跟随本体、独立寻路行动且不占人口。 */
    summonIndependent?: boolean;
    /** 普攻累计型召唤技能上次触发时的普攻次数快照。 */
    summonFiredCount?: number;
    /** 怒吼技能下次可用时刻（秒）。 */
    roarReadyAt?: number;
    /** 飓风技能下次可用时刻（秒）。 */
    stormReadyAt?: number;
    /** 射线集束技能上次触发时的普攻次数快照。 */
    rayFiredCount?: number;
    /** 文明之火技能上次触发时的普攻次数快照。 */
    fireFiredCount?: number;
    /** 自身击杀的单位数量（用于击杀增益延长等被动）。 */
    killCount?: number;
    /** 团队增益在施法者身上的冷却截止时刻（秒）。 */
    teamBuffReadyAt?: number;
    /** 团队增益窗口截止时刻（秒，窗口内每步给半径内友军刷新状态）。 */
    teamBuffWindowEnd?: number;
    /** 团队增益在受惠者身上的截止时刻（秒，含击杀延长）。 */
    teamBuffUntil?: number;
    /** 受惠者上次结算击杀延长时的 killCount 快照基准。 */
    teamBuffKillBase?: number;
    /** 受惠者已获得的累计延长秒数（用于上限封顶）。 */
    teamBuffExtendUsed?: number;
    /** 兵营传送批次表现时间轴。 */
    portalFlight?: { fromHexId: number; barracksHexId: number; startedAt: number };
    inheritedStats?: Pick<ZCUnitDefinition, 'attack' | 'moveSpeed' | 'attackInterval' | 'attackRange' | 'bodyRadius'>
        & Partial<Pick<ZCUnitDefinition, 'maxHp'>>;
    gateSize?: 'enlarge' | 'shrink';
    gateScale?: number;
    /** 技能驱动的表现体型缩放倍率（纯表现，不影响判定半径 bodyRadius）；缺省为 1。 */
    bodyScale?: number;
    gateMoveMultiplier?: number;
    gateAttackSpeedMultiplier?: number;
    gateDamageMultiplier?: number;
    gateHpFlat?: number;
    id: number;
    owner: ZCOwner;
    /** 卡牌单位 ID（对应 pvpCard.json 的 unitId）。 */
    unitId: ZCUnitId;
    cardId: string;
    tier: number;
    sourceHexId: number;
    targetHexId: number | null;
    progress: number;
    hp: number;
    maxHp: number;
    /** 领地塔防波次单位独立攻击倍率；缺省为 1。 */
    attackMultiplier?: number;
    /** 护盾吸收量（数值池）。 */
    shield?: number;
    battleState: ZCUnitBattleState;
    stateTime: number;
    targetUnitId: number | null;
    targetWallHexId: number | null;
    targetBuildingHexId: number | null;
    nextAttackAt: number;
    waitUntil: number;
    attackHitDone: boolean;
    /** 追击状态：离开射程后追击起点的坐标与起始时刻。 */
    chase?: { x: number; y: number; startedAt: number };
    /** 追击脱战后暂时忽略的目标单位 ID 列表。 */
    disengagedUnitIds?: readonly number[];
    /** 本帧是否正在冲刺（表现层切换冲刺攻击动作；纯派生值，不进快照）。 */
    charging?: boolean;
    /** 冲刺目标终点世界坐标（起冲时固化，直线冲向此点）。 */
    dashX?: number;
    dashY?: number;
    /** 冲刺截止时刻（秒，超时保底）。 */
    dashUntil?: number;
    /** 冲刺命中或冲空后的原地硬直/后摇截止时刻（秒）。 */
    dashRecoverUntil?: number;
    hatredUnitId: number | null;
    hatredUntil: number;
    facingRadians: number;
    deathRemoveAt: number;
    /** 自由直线移动前进方向角；null 表示逐格移动（追敌/攻击）。 */
    marchAngle: number | null;
    /** 单位连续实际坐标（平滑移动，避免状态切换时回退）。 */
    freeX: number;
    freeY: number;
    /** 累计完成的普攻次数（用于强化普攻、按攻击计数技能判定）。 */
    completedAttackCount?: number;
    /** 强化普攻下次可用时刻（秒，基于 elapsedSeconds 绝对时刻）。 */
    empoweredReadyAt?: number;
    /** 副轨主动技能下次可用时刻（秒）。 */
    secondaryReadyAt?: number;
    /** 护盾到期时刻（秒）；缺省永不过期。 */
    shieldExpireAt?: number;
    /** 连发剩余发数；0 或缺省表示无连发计划。 */
    burstShotsLeft?: number;
    /** 下一发连发时刻（秒）。 */
    burstNextAt?: number;
    /** 连发间隔（秒）。 */
    burstInterval?: number;
    /** 连发每发相对普攻的伤害倍率。 */
    burstDamageRate?: number;
    /** 低血护体上次触发时刻（秒，用于内置冷却校验）。 */
    lowHpGuardFiredAt?: number;
    /** 常驻被动状态是否已挂载（避免每步重复施加）。 */
    passiveStatusApplied?: boolean;
    /** 受击反弹减攻速比例（0~1）；护体期间受击时降低攻击者攻速。 */
    retaliateSlowPct?: number;
    /** 受击反弹效果截止时刻（秒）。 */
    retaliateUntil?: number;
    /** 自身施法类主动（self_cast）下次可用时刻（秒）。 */
    selfCastReadyAt?: number;
    /** 自身光环下次可用时刻（秒，冷却型触发）。 */
    auraReadyAt?: number;
    /** 自身光环上次触发时的普攻次数快照（攻击计数型触发）。 */
    auraFiredCount?: number;
    /** 自身强化（counter_self_buff）上次触发时的普攻次数快照。 */
    counterFiredCount?: number;
    /** 陷阱投掷上次触发时的普攻次数快照（攻击计数型触发）。 */
    trapFiredCount?: number;
    /** 五雷轰顶下次可用时刻（秒）。 */
    boltReadyAt?: number;
    /** 陷阱技能下次可用时刻（秒，冷却型触发）。 */
    trapReadyAt?: number;
    /** 闪电链技能下次可用时刻（秒）。 */
    chainReadyAt?: number;
    /** 召唤技能下次可用时刻（秒，冷却型触发）。 */
    summonReadyAt?: number;
    /** 施法动作表现窗口截止时刻（秒，仅用于切换表现层动作）。 */
    castActionUntil?: number;
    /** 原地施法定身截止时刻（秒，期间不可位移，允许原地索敌与攻击）。 */
    castHoldUntil?: number;
    /** 多点打击下次可用时刻（秒，冷却型）。 */
    strikeReadyAt?: number;
    /** 多点打击上次触发时的普攻次数快照（攻击计数型）。 */
    strikeFiredCount?: number;
    /** 多点打击持续窗口截止时刻（秒）。 */
    strikeUntil?: number;
    /** 多点打击持续期内下一波时刻（秒）。 */
    strikeNextAt?: number;
    /** 多点打击打空后的重试退避时刻（秒）。 */
    strikeRetryAt?: number;
    /** 移形换影技能下次可用时刻（秒）。 */
    blinkReadyAt?: number;
    /** 范围爆裂弹技能下次可用时刻（秒）。 */
    splashReadyAt?: number;
    /** 爆发/击退类范围技能下次可用时刻（秒）。 */
    burstReadyAt?: number;
    /** 毒液喷吐技能下次可用时刻（秒）。 */
    venomReadyAt?: number;
    /** 扇形减速技能下次可用时刻（秒）。 */
    fanReadyAt?: number;
    /** 单体突刺技能下次可用时刻（秒）。 */
    singleReadyAt?: number;
    /** 菌盾冲锋技能下次可用时刻（秒）。 */
    chargeReadyAt?: number;
    /** 冲锋类技能下次可用时刻（秒）。 */
    dashReadyAt?: number;
    /** 风炮弹技能下次可用时刻（秒）。 */
    windReadyAt?: number;
    /** 连射弹幕技能上次触发时的普攻次数快照。 */
    barrageFiredCount?: number;
    /** 连射弹幕本轮剩余待发数量。 */
    barrageShotsLeft?: number;
    /** 连射弹幕下一发时刻（秒）。 */
    barrageNextAt?: number;
    /** 分身爆炸时刻（秒）。 */
    blinkCloneAt?: number;
    /** 分身原地爆炸世界坐标 X。 */
    blinkCloneX?: number;
    /** 分身原地爆炸世界坐标 Y。 */
    blinkCloneY?: number;
    /**
     * 腾云驾雾（仙桃行者 68009，2026-11-24 第 44 批）的「起手待跑」标记。
     *
     * `prepareAttack` 在强化那一击上认出这条车道后**不结算、不推事件**，只写这个时刻 +
     * `dashChainTargetId`；同一帧的 `ZCSkillTriggerSystem.applyDashChain` 接着把序列开起来。
     * 写成两段而不是在攻击系统里直接开跑：`blinkTo` / `strike` 只接在触发侧。
     * 缺省 ⇒ 这条车道整段不执行。
    */
    dashChainPendingAt?: number;
    /** 起手锁定的**目标 1**（单位实例 id）；后续 3 个从它周围索取。*/
    dashChainTargetId?: number;
    /**
     * 四段突进的访问顺序（单位实例 id），`dashChainIndex` 是**当前正在逼近**的那一段。
     *
     * `index >= ids.length` ⇒ 已经在回程（回到目标 1 的位置）。三个字段同生同灭：
     * `index` 有值就代表序列在跑，清序列时一起 `delete`（`undefined` = 空闲）。
    */
    dashChainIds?: number[];
    dashChainIndex?: number;
    /** 回程落点 = 起手那一刻**目标 1 的坐标**（不是本体起手点，用户口径「回到目标1的位置」）。*/
    dashChainReturnX?: number;
    dashChainReturnY?: number;
}

export interface IZCMonsterPatrolState {
    fromHexId: number;
    toHexId: number;
    startedAt: number;
    durationSeconds: number;
    pausedAt?: number;
}

export interface IZCNeutralFeatureState {
    claimed: boolean;
    gateId?: number;
    cooldownSeconds?: number;
    usesRemaining?: number;
    portalAt?: number;
    startedAt?: number;
    lineProgress?: number;
    lineDamage?: number;
    hitUnitIds?: number[];
    mowerOwner?: ZCOwner;
    effect?: import('./ZCNeutralResourceGroup').IZCGateEffect;
    readyAt?: number;
    windowUntil?: number;
    insideUnitIds?: readonly number[];
    lineHexIds?: readonly number[];
    portalExitId?: number;
    awake?: boolean;
    targetUnitId?: number | null;
    nextAttackAt?: number;
    attackStartedAt?: number;
    attackTargetUnitId?: number;
    monsterFacing?: 1 | -1;
    monsterResourceId?: number;
    unlockedOwners?: ZCOwner[];
    focusOwners?: ZCOwner[];
    focusReadyAt?: Partial<Record<ZCOwner, number>>;
    retaliationUnitIds?: number[];
    disengagedAt?: number;
    regenUpdatedAt?: number;
    patrol?: IZCMonsterPatrolState;
}

/** 短生命周期战斗表现事件（逻辑层产生，视图层只读消费，不进快照）。 */
export interface ZCCombatEvent {
    id: number;
    type: ZCCombatEventType;
    owner: ZCOwner;
    sourceUnitId: number;
    targetUnitId: number | null;
    skillId: number;
    skillName: string;
    effectKey: string | null;
    projectileKey: string | null;
    effectPrefabPath?: string | null;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    radius: number;
    damage: number;
    empowered: boolean;
    startedAt: number;
    durationSeconds: number;
    /** 定格光束表现（长度固定，仅淡出，不参与判定与伤害）。 */
    beamHold?: boolean;
    /** 表现由小长大的时长（秒）；缺省为 0（不生长，直接为预制体尺寸）。 */
    growSeconds?: number;
    /** 生长起始尺寸比例（0~1）；配合 growSeconds 实现从初值按缓动膨胀。 */
    growFrom?: number;
    /** 指定播放的 Spine 动画名；缺省保留预制体默认动画。 */
    spineAnimation?: string;
    /** 是否点亮叠加层子节点；缺省不改变预制体自身状态。 */
    overlayFx?: boolean;
    /** 特效朝向角度（度，逆时针，0 为 +X 方向）。 */
    angleDegrees?: number;
    /** 特效竖直抬升高度（屏幕 px）。 */
    visualLiftPx?: number;
    /** 特效整体尺寸缩放倍率；缺省为 1。 */
    effectScale?: number;
    /** 特效整体透明度（0~1）；缺省为 1（不透明）。 */
    effectAlpha?: number;
    /** 事件级颜色覆盖（[r, g, b]，0~255）；缺省使用预制体或配置表染色。 */
    tint?: readonly [number, number, number];
    /** 起点跟随的单位实例 ID；每帧将 from 坐标对齐该单位位置。 */
    followFromUnitId?: number | null;
    /** 终点跟随的单位实例 ID；每帧将 to 坐标对齐该单位位置。 */
    followToUnitId?: number | null;
    /** 多段跟随连线中的分段序号（0 起）。 */
    followPieceIndex?: number;
    /** 多段跟随连线的总段数。 */
    followPieceCount?: number;
    /** 仅沿长轴方向的拉伸倍率（等粗拉长）；缺省为 1（等比缩放）。 */
    stretchAlongAxis?: number;
}

/** 在途弹道状态（可恢复的战斗状态，碰撞后产生伤害，坐标为棋盘逻辑坐标）。 */
export interface ZCProjectileState extends ZCCombatEvent {
    type: 'projectile';
    targetKind: ZCCombatTargetKind;
    targetId: number;
    sourceCardId: string;
    /** 出手时的基础攻击伤害（克制系数在命中实际目标时计算）。 */
    baseDamage: number;
    x: number;
    y: number;
    previousX: number;
    previousY: number;
    velocityX: number;
    velocityY: number;
    collisionRadius: number;
    /** 弹体尺寸与判定半径倍率；缺省为 1。 */
    sizeScale?: number;
    canHitAir: boolean;
    /** 命中后在落点创建的持续区域存活时长（秒）。 */
    zoneDuration?: number;
    zoneWaves?: number;
    zoneSlow?: number;
    /** 命中后落点持续区域造成的伤害值。 */
    zoneDamage?: number;
    /** 首个目标命中后允许穿透的额外敌方单位数量。 */
    remainingPierces?: number;
    /** 穿透每命中一个单位后的伤害衰减比例（0~1）；缺省为 0（不衰减）。 */
    pierceFalloff?: number;
    /** 已经命中的单位 ID 列表（防止重复判定）。 */
    hitUnitIds?: number[];
    /** 穿透己方单位时的治疗比例（按目标最大生命百分比）；缺省不治疗。 */
    allyHealPct?: number;
    /** 弹道剩余可治疗己方单位数量。 */
    allyHealLeft?: number;
    /** 已被本弹道治疗过的己方单位 ID 列表。 */
    allyHealIds?: number[];
    /** 斩杀概率（0~1）。 */
    executeChance?: number;
    /** 是否暴击（出手时判定并固化在快照中）。 */
    criticalHit?: boolean;
    /** 命中时施加的状态 ID。 */
    onHitStatusId?: string;
    /** 出手时快照的 Buff 判定结果。 */
    legacyBuffs?: ZCLegacyBuffApplication[];
    /** 溅射范围半径（棋盘逻辑单位）。 */
    splashRadius?: number;
    /** 溅射伤害相对直击伤害的比例；缺省为 1。 */
    splashDamageRate?: number;
    /** 溅射多目标递减系数（0~1，按距离逐级衰减）；缺省为 0。 */
    splashFalloff?: number;
    /** 命中或到达落点时播放的爆炸特效预制体路径。 */
    impactEffectPrefabPath?: string | null;
    /** 命中爆炸判定半径（世界 px）。 */
    burstRadius?: number;
    /** 命中爆炸伤害值。 */
    burstDamage?: number;
    /** 第二段爆炸伤害值。 */
    burstSecondDamage?: number;
    /** 第二段爆炸延迟秒数。 */
    burstSecondDelay?: number;
    /** 爆炸表现持续时长（秒）。 */
    burstEffectSeconds?: number;
    /** 首目标重击伤害基数（仅首个命中的单位生效）。 */
    quakeDamage?: number;
    /** 首目标重击落点范围判定半径（世界 px，除首目标外的波及半径）。 */
    quakeRadius?: number;
    /** 首目标重击表现时长（秒）。 */
    quakeEffectSeconds?: number;
    /** 弧线飞行最大横向偏移（世界坐标，缺省为 0 直线飞行）。 */
    arcOffset?: number;
    /** 飞行途中是否忽略中途碰撞（仅在飞到终点时触发）。 */
    ignoresMidAirCollision?: boolean;
    /** 到达落点时是否自动引爆。 */
    explodeOnArrival?: boolean;
    /** 落点爆炸判定半径（世界 px）。 */
    arriveRadius?: number;
    /** 落点爆炸对范围内敌人的伤害值。 */
    arriveDamage?: number;
    /** 命中点留存的持续飓风区域半径（世界 px）。 */
    hurricaneRadius?: number;
    /** 持续飓风留存时长（秒）。 */
    hurricaneSeconds?: number;
    /** 持续飓风每次接触伤害。 */
    hurricaneDamage?: number;
    /** 持续飓风预制体路径。 */
    hurricanePrefabPath?: string | null;
    /** 命中爆炸特效尺寸倍率；缺省为 1。 */
    impactEffectScale?: number;
}

/** 战斗飘字数据（纯瞬时表现，不进快照）。 */
export interface ZCFloatText {
    id: number;
    kind: ZCFloatTextKind;
    /** 造成伤害或获得金币的一方席位。 */
    owner: ZCOwner;
    /** 是否为本机席位受到伤害（红字负号表现）。 */
    takenFromPlayer?: true;
    /** 是否为玩家席位造成的伤害（显示暴击/克制/秒杀等前缀）。 */
    dealtByPlayer?: true;
    /** 实际结算数值；MISS 为 0，其余为正整数。 */
    value: number;
    /** 实际结算扣除的血量（供斩杀合并等逻辑追溯）。 */
    appliedDamage?: number;
    /** 飘字锚点逻辑坐标。 */
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/** 受击特效挂载目标类型（单位/建筑/城墙）。 */
export type ZCHitFxSurface = 'unit' | 'building' | 'wall';

/** 受击特效展示项（纯表现，不进快照）。 */
export interface ZCHitFx {
    id: number;
    /** 攻击方职业，用于匹配对应受击特效预制体。 */
    trait: ZCAttackTrait;
    /** 受击方归属阵营。 */
    owner: ZCFaction;
    /** 受击附着表面，决定视图锚点偏移。 */
    surface: ZCHitFxSurface;
    /** 受击方体型缩放，特效按此等比适配。 */
    targetScale: number;
    /** 特效世界坐标。 */
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/** 抽卡揭示表现展示项（纯表现，不进快照）。 */
export interface ZCCardReveal {
    monsterClaim?: boolean;
    /** 是否为问号格抽取。 */
    randomTile?: boolean;
    id: number;
    cardId: string;
    owner: ZCOwner;
    building: ZCBuildingType;
    tier: number;
    cardName: string;
    /** 兵种 ID；金矿/主城等无兵种建筑为 null。 */
    unitId: string | null;
    /** 问号地块抽取评语（非空时展示评语切图）。 */
    luckText: string;
    hexId: number;
    x: number;
    y: number;
    /** 卡牌弹出起点时刻（秒，地块点击脉冲动画结束后开始）。 */
    startedAt: number;
    durationSeconds: number;
}

/** 地块开发激活表现事件（纯表现，不进快照）。 */
export interface ZCHexActivation {
    id: number;
    hexId: number;
    /** 是否伴随卡牌揭示（决定脉冲后地块是否隐藏让位于卡牌）。 */
    hasCardReveal: boolean;
    /** 本次开发抽到的卡牌品阶（0 为未抽到，1~4 对应绿蓝紫金品质染色）。 */
    cardRarity: number;
    startedAt: number;
    durationSeconds: number;
}

/** 建筑抖动通知（纯表现，取走即空）。 */
export interface ZCBuildingShake {
    id: number;
    hexId: number;
}

/** 建筑被摧毁通知（纯表现，取走即空，渲染层据此播爆炸）。 */
export interface ZCBuildingDestruction {
    id: number;
    hexId: number;
}

/** 中立资源领取表现通知（纯表现，不进快照）。 */
export interface ZCNeutralReward {
    id: number;
    hexId: number;
    itemId: number;
    owner: ZCOwner;
    gold: number;
    artifactCharge: number;
    startedAt: number;
    durationSeconds: number;
}

/** 建筑冷却相位（纯表现，用于进度条颜色与文案）。 */
export const ZCBuildingPhase = {
    Construction: 'construction',
    Income: 'income',
    Spawn: 'spawn',
    Attack: 'attack',
} as const;
export type ZCBuildingPhase = (typeof ZCBuildingPhase)[keyof typeof ZCBuildingPhase];

export interface ZCBuildingCooldownState {
    phase: ZCBuildingPhase;
    progress: number;
    remainingSeconds: number;
    totalSeconds: number;
    ready: boolean;
}

export type OwnerNumberRecord = Record<ZCOwner, number>;
type OwnerTypeRecord = Record<ZCOwner, Record<ZCCardType, number>>;

export interface ZCCombatTarget {
    kind: ZCCombatTargetKind;
    id: number;
    x: number;
    y: number;
    bodyRadius: number;
    cardId: string | null;
}

export interface ZCSnapshot {
    version: 4;
    mapId?: string;
    /** 冻结配置版本；旧 version 4 存档缺省为 legacy。 */
    configHash?: string;
    elapsedSeconds: number;
    /** 尚未推进的固定步长余量；旧 version 4 存档默认为 0。 */
    pendingSeconds?: number;
    /** 实际已出塔防波数；旧存档缺省时按配置时间推导。 */
    nextDefenceWaveIndex?: number;
    durationSeconds: number;
    playerGold: number;
    enemyGold: number;
    /** 各席位独立金币。 */
    goldByOwner?: OwnerNumberRecord;
    /** 当前可储存并释放的神器可用次数。 */
    artifactReadyUses: number;
    artifactCharge: number;
    artifactCooldown: number;
    enemyFrozenSeconds: number;
    status: ZCGameStatus;
    resultReason: string;
    hexes: ZCHexState[];
    units: ZCUnitState[];
    nextUnitId: number;
    incomeClock: number;
    aiClock: number;
    towerClock: number;
    spawnClocks: Record<string, number>;
    drawCursor: OwnerNumberRecord;
    allRandomNonGoldDraws: OwnerNumberRecord;
    builtTypeCounts: OwnerTypeRecord;
    combatEvents: ZCCombatEvent[];
    projectiles: ZCProjectileState[];
    nextCombatEventId: number;
    /** 独立的状态效果系统快照。 */
    statusEffects?: ZCStatusSystemSnapshot;
    /** 持续区域列表。 */
    groundZones: ZCGroundZoneState[];
    /** 排队待生成的召唤物队列（保证定时间隔和延迟生成在重连/读档后不丢失）。 */
    pendingSummons?: IZCPendingSummon[];
}

/** 排队待生成的召唤物数据（包含延迟出现与出场表现时序）。 */
export interface IZCPendingSummon {
    /** 播放出生特效的时刻（秒）。 */
    fxAtSeconds: number;
    /** 实体真正出生的时刻（秒）。 */
    spawnAtSeconds: number;
    /** 特效是否已推给视图（避免重复推送）。 */
    fxPlayed?: boolean;
    owner: ZCOwner;
    cardId: string;
    tier: number;
    sourceHexId: number;
    /** 施法者实例 ID。 */
    masterId: number;
    skillId: number;
    skillName: string;
    /** 出生特效 Prefab 路径（缺省走分裂菇分身特效）。*/
    effectPrefabPath?: string;
    /** 出生世界坐标 X。 */
    x: number;
    /** 出生世界坐标 Y。 */
    y: number;
    maxHp: number;
    attack: number;
    moveSpeed: number;
    attackInterval: number;
    attackRange: number;
    bodyRadius: number;
    /** 到期时刻（秒）；缺省表示持续到阵亡。 */
    summonUntil?: number;
    /** 半透明度（0~1）；缺省为 1（不透明）。 */
    summonAlpha?: number;
    /** 是否为独立分身。 */
    summonIndependent?: boolean;
}

/** 持续伤害区域状态（暴风雪、地带等 area 技能，坐标为棋盘逻辑坐标）。 */
export interface ZCGroundZoneState {
    x: number;
    y: number;
    radius: number;
    /** 施术者阵营。 */
    owner: ZCOwner;
    sourceUnitId: number;
    skillId: number;
    skillName: string;
    effectPrefabPath?: string | null;
    /** 剩余存活秒数。 */
    remainingSeconds: number;
    /** 剩余波次数。 */
    wavesLeft: number;
    /** 下一波结算绝对时刻（秒）。 */
    nextWaveAt: number;
    /** 每波间隔秒数。 */
    waveInterval: number;
    /** 每波对每个敌人的伤害值。 */
    damage: number;
    /** 飘字类型。 */
    floatTextKind?: ZCCombatFloatTextKind;
    /** 每波命中减速比例（0~1）；0 为不减速。 */
    slowRatio: number;
    /** 区域到期单次结算伤害。 */
    expireDamage?: number;
    /** 区域到期施加的状态 ID。 */
    expireStatusId?: string;
    /** 区域到期施加状态的持续时长（秒）。 */
    expireStatusDuration?: number;
    /** 区域移动速度 X（世界坐标/秒）；缺省为 0。 */
    moveVelocityX?: number;
    /** 区域移动速度 Y（世界坐标/秒）；缺省为 0。 */
    moveVelocityY?: number;
    /** 移动区域已命中的单位 ID（防止单次穿过重复结算）。 */
    hitUnitIds?: number[];
    /** 移动区域最大命中人数上限；达到后提前消散，缺省为 0（不限）。 */
    maxHits?: number;
    /** 多目标命中伤害衰减比例（0~1）；缺省不衰减。 */
    damageFalloff?: number;
    /** 是否整段持有单一表现事件（跟随移动，避免每波刷新）。 */
    holdVisual?: boolean;
    /** 持有的长效表现事件 ID（纯运行时维护，不进快照）。 */
    visualEventId?: number;
    /** 视觉入场从起始尺寸膨胀到全尺寸的时长（秒）。 */
    growSeconds?: number;
    /** 入场生长的起始尺寸比例（0~1）；配合 growSeconds。 */
    growFrom?: number;
    /** 追踪目标的慢速阶段速度（世界 px/秒）。 */
    approachSpeed?: number;
    /** 追踪目标单位 ID；目标死亡后自动切换最近敌人。 */
    approachTargetId?: number;
    /** 触发快档冲刺的距离阈值（世界 px）。 */
    sprintRange?: number;
    /** 快档冲刺速度（世界 px/秒）。 */
    sprintSpeed?: number;
    /** 到达目标后是否切换为随机游走。 */
    arriveWander?: boolean;
    /** 赶路追踪阶段已耗时（秒，用于落地结算扣除）。 */
    approachSeconds?: number;
    /** 目标丢失时继续飞往的最后已知目标坐标 X（世界 px）。 */
    chaseGoalX?: number;
    /** 目标丢失时继续飞往的最后已知目标坐标 Y（世界 px）。 */
    chaseGoalY?: number;
    /** 是否已切换至快档冲刺阶段。 */
    sprinting?: boolean;
    /** 表现层骨架动画名；阶段变化时同步至长效事件。 */
    visualAnimation?: string;
    /** 跟随的施法者单位 ID；区域每帧同步至该单位位置。 */
    followUnitId?: number;
    /** 跟随时保持的身前距离偏移（世界 px）。 */
    followForward?: number;
    /** 每波命中概率附加的状态 ID。 */
    hitStatusId?: string;
    /** 每波命中附加状态的概率（0~1）。 */
    hitStatusChance?: number;
    /** 命中状态持续时间（秒）；缺省使用状态配置默认值。 */
    hitStatusSeconds?: number;
    /** 每一波最多结算的目标数量；缺省为 0（不限）。 */
    waveMaxTargets?: number;
    /** 施法期间施法者整体竖直抬升（屏幕 px，仅影响视觉）。 */
    casterLiftPx?: number;
    /** 矩形判定半长（逻辑 px，rectHalfHeight > 0 启用矩形判定）。 */
    rectHalfLength?: number;
    /** 矩形判定半高（逻辑 px）。 */
    rectHalfHeight?: number;
    /** 区域朝向角度（度，逆时针）。 */
    angleDegrees?: number;
    /** 表现竖直抬升高度（屏幕 px）。 */
    visualLiftPx?: number;
    /** 触碰触发判定半径（世界 px，首个进入者触发）。 */
    contactRadius?: number;
    /** 触碰触发时造成的单次伤害值。 */
    contactDamage?: number;
    /** 区域到期或触发爆炸时播放的一次性预制体路径。 */
    expirePrefabPath?: string | null;
    /** 爆炸预制体播放时长（秒）。 */
    expireFxSeconds?: number;
    /** 常驻表现延迟出现秒数（避免与生成特效重叠）。 */
    visualDelaySeconds?: number;
    /** 是否每个敌人仅生效一次（持续接触不重复造成伤害）。 */
    hitOncePerUnit?: boolean;
    /** 投掷飞行阶段剩余秒数（> 0 表示处于空中）。 */
    flightSeconds?: number;
    /** 投掷飞行总时长（秒，用于计算抛物线进度）。 */
    flightTotalSeconds?: number;
    /** 抛掷弧线峰值抬升高度（屏幕 px）。 */
    flightArcPx?: number;
    /** 投掷飞行阶段的表现特效路径（落地后切换为常驻特效）。 */
    flightVisualPath?: string | null;
    /** 是否仅在被踩中触发时结算爆炸伤害（自然超时则直接消失）。 */
    expireRequiresContact?: boolean;
    /** 是否已被踩中触发。 */
    contactTriggered?: boolean;
    /** 随机游走速度（世界 px/秒）。 */
    wanderSpeed?: number;
    /** 游走换向间隔时间（秒）。 */
    wanderTurnSeconds?: number;
    /** 下次游走换向绝对时刻（秒）。 */
    wanderNextTurnAt?: number;
    /** 当前游走移动朝向角（弧度）。 */
    wanderAngleRadians?: number;
    /** 当前游走角速度（弧度/秒，正负表示左右转向）。 */
    wanderTurnRate?: number;
    /** 牵引速度（世界 px/秒）；向区域中心拖拽敌人。 */
    pullSpeed?: number;
    /** 牵引作用半径（世界 px）。 */
    pullRadius?: number;
    /** 区域表现整体缩放倍率；缺省为 1。 */
    effectScale?: number;
    /** 区域表现事件级颜色覆盖（[r, g, b]，0~255）。 */
    tint?: [number, number, number];
}

/** 动作失败机器可读原因码（表现层据此触发专属反馈，如金币不足抖动）。 */
export type ZCActionFailureReason = 'insufficientGold';

export interface ZCActionResult {
    ok: boolean;
    /** 仅供主动点击类操作（神器按钮等）弹吐司；棋盘开格路径只读 reason，不构造文案。 */
    message?: string;
    /** 失败原因；ok === true 或原因未分类时为 undefined。 */
    reason?: ZCActionFailureReason;
}

/**
 * 玩家点地块开垦的结果（`ZCGameModel.developHex`）。
 *
 * 在通用 {@link ZCActionResult} 上补一格**这一格翻出了什么**：表现层要按品阶选音效
 * （抽空 / 蓝绿 / 紫 / 金），而 `message` 是文案、`cardReveals` 只在「卡牌 + 建得上」时才有，
 * 都判不了「抽空」。
 *
 * 抽空与各类失败都保持 `undefined`；**抽到卡但该格建不上时仍有值** ——
 * 音效按「抽到什么」走，不按「建没建成」走。
*/
export interface ZCDevelopResult extends ZCActionResult {
    /** 翻出来的卡牌品阶；抽空 / 失败时 `undefined`。*/
    readonly cardRarity?: ZCCardRarity;
}

export interface ZCScoreBreakdown {
    territory: number;
    mainCityHp: number;
    unitCount: number;
    totalUnitHp: number;
}
