import type { ZCAttackTrait, ZCCardType, ZCCombatEventType, ZCUnitId, ZCUnitDefinition } from './ZCCombatCatalog';
//  真源在 `ZCCombatCatalog`（攻击档案的领域），这里转出以保持既有 `from './ZCGameTypes'` 的取用路径。
export type { ZCCombatEventType };
import type { ZCFaction, ZCOwner } from './ZCMapConfig';
import type { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCStatusSystemSnapshot } from './ZCStatusEffect';
import type { ZCLegacyBuffApplication } from './ZCLegacySkillEffect';

/** 渲染读取实时状态；只有 exportSnapshot() 返回可独立修改的存档。 */
export type DeepReadonly<T> = T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** 伤害来源种类：单位 / 建筑 / 神器（建筑与神器没有 `unitId`，见 `ZCDamageSource.attackerTrait`）。 */
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
    /** Old Client battle-text classification carried from cast to actual hit. */
    floatTextKind?: ZCCombatFloatTextKind;
    /** Damage already displayed by the same hit (used to merge execute into one number). */
    floatTextValueOffset?: number;
    /**
     * 攻击方的**攻击职业**（=卡表 `traits.attack`），用来挑受击特效。
     *
     * 🔴 为什么不是渲染层自己反查：建筑 / 神器造成的伤害**根本没有 unitId**（见 `ZCGameModel`
     * 里 `kind:'artifact'` / `kind:'building'` 两处调用），渲染层拿不到攻击方是谁；而单位攻击
     * 的伤害源头就在这里，是唯一能把职业带到位的地方。**留空 ⇒ 不播受击特效**。
     */
    attackerTrait?: ZCAttackTrait;
    /**
     * 本次伤害是否算「远程」（投射物 / 范围 / 持续区域）。
     *
     * 2026-10-29 为藤盾（`damageTakenRangedPct`）而加。**不标记 ⇒ 按近战处理**，
     * 所以存量伤害路径（近战挥击、建筑、神器）行为完全不变；只有
     * `ZCAttackResolutionSystem` 里明确走弹道 / 溅射 / 区域的几处才置 `true`。
     */
    ranged?: boolean;
}

/**
 * 状态取值真源：`as const` 对象 + 同名派生类型（与 `ZCCardType` 同一范式）。
 *
 * 值与类型共用一份定义：`ZCGameStatus.Playing` 是值，`ZCGameStatus` 是类型；
 * `Object.values(ZCGameStatus)` 直接就是运行时校验集合 —— 新增一个取值只改这里，
 * 「忘了同步校验集合」的坑不会再出现。值仍是字符串（原样进快照 / 配置 / 协议）。
 */
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

/** 攻击目标种类：单位 / 城墙 / 建筑（`ZCTargetingSystem` 与 `ZCCombatTarget` 共用）。 */
export const ZCCombatTargetKind = {
    Unit: 'unit',
    Wall: 'wall',
    Building: 'building',
} as const;
export type ZCCombatTargetKind = (typeof ZCCombatTargetKind)[keyof typeof ZCCombatTargetKind];

/** Old Client `DamageTextType` variants that represent hostile damage. */
export const ZCCombatFloatTextKind = {
    Damage: 'damage',
    Critical: 'critical',
    Restraint: 'restraint',
    Resisted: 'resisted',
    Execute: 'execute',
} as const;
export type ZCCombatFloatTextKind = (typeof ZCCombatFloatTextKind)[keyof typeof ZCCombatFloatTextKind];
/**
 * Transient battle text. `miss` is supported for the later dodge pipeline as in Old Client.
 *
 * 金币拆成**两种**飘字，因为两者的来处不同、读法也必须不同（2026-10-27 用户口径）：
 * · `gold` —— 击杀单位 / 拆建筑的**掉落**：从落点上方落到地面、停一下、缩小消失，没有数字；
 * · `goldincome` —— 主城 / 金矿的**产出**：金币 icon 与数字一起从**建筑顶部**升起 50px 并淡出。
 * 两者只差一个 kind，视图侧分别走 `floatTextGoldDrop` / `floatTextGoldRise` 两条曲线。
 */
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
    /** 已开发地块外围城墙的独立耐久；归零后单位才能攻击本格建筑。 */
    wallHp: number;
    wallMaxHp: number;
    /** 城墙被击破时形成的单边缺口（0~5）；null 表示完整或旧版整墙已毁状态。 */
    wallBreachedEdge?: number | null;
    developmentCost: number;
    /** 可开发时展示并使用的 PVP 地块类别；主城为 null。 */
    tileType: ZCPvpTileType | null;
    /** 已支付并完成过本格抽取；抽空也会消耗地块，不能重复开发。 */
    developmentResolved: boolean;
    cardId: string | null;
    /**
     * 本局从该点位所属**资源组合**里抽中的资源项 id（`neutralResourceGroup.id`）。
     * `null` / 缺省 = 这格不是资源点，或资源已被领走（领取是**一次性**的，靠清空本字段判重）。
     */
    neutralResourceId?: number | null;
    /** 大于 0 时建筑仍在建造，不能产金、产兵或攻击。 */
    constructionRemainingSeconds: number;
    constructionTotalSeconds: number;
    captureOwner: ZCOwner | null;
    /** 当前进攻阵营的控制进度（秒）；阈值和增减倍率来自本局运行时配置。 */
    captureSeconds: number;
}

export interface ZCUnitState {
    inheritedStats?: Pick<ZCUnitDefinition, 'attack' | 'moveSpeed' | 'attackInterval' | 'attackRange' | 'bodyRadius'>;
    gateSize?: 'enlarge' | 'shrink';
    gateScale?: number;
    gateMoveMultiplier?: number;
    gateAttackSpeedMultiplier?: number;
    gateDamageMultiplier?: number;
    gateHpFlat?: number;
    id: number;
    owner: ZCOwner;
    /** 单位 id（= `pvpCard.json` 卡行的 `unitId`，合表后同表自引用），用于查数值与父 Prefab。 */
    unitId: ZCUnitId;
    cardId: string;
    tier: number;
    sourceHexId: number;
    targetHexId: number | null;
    progress: number;
    hp: number;
    maxHp: number;
    /** 领地塔防波次的单位独立攻击倍率；普通单位缺省为 1。 */
    attackMultiplier?: number;
    /** Non-stacking temporary absorption pool granted by shield skills. */
    shield?: number;
    battleState: ZCUnitBattleState;
    stateTime: number;
    targetUnitId: number | null;
    targetWallHexId: number | null;
    targetBuildingHexId: number | null;
    nextAttackAt: number;
    waitUntil: number;
    attackHitDone: boolean;
    /**
     * 本帧是否正在**冲刺**（`dashUntil` 有值且还没到点，或本帧刚起冲）。
     *
     * 2026-10-31 运动霸「拳击冲撞」203301：纯派生值，`ZCUnitSystem` 每帧先清、只有冲刺
     * 推进处会置真，**不进快照语义**（`ZCSnapshotCodec` 不解码它，回放也不依赖它）。
     * 消费方只有表现层：冲刺期间把移动动作换成循环的攻击动作。
     * 2026-11-03 起冲刺就是这类单位的普攻，冷却待机期间它必须是 false（播待机，不是挥拳）。
     */
    charging?: boolean;
    /**
     * 本次冲刺的**终点快照**（世界坐标，起冲那一刻从目标身上拍下来）。
     *
     * 2026-11-02 把冲刺从「移速倍率」改成真·撞击：冲刺期间一路直线跑到这个点，
     * **途中不再修正朝向** —— 目标让开就是冲空，不再有「一直追着目标所以必中」。
     * 不拿 `targetUnitId` 每帧现算终点，正是这一条的落地方式；拿现算值就等于没改。
     */
    dashX?: number;
    dashY?: number;
    /**
     * 本次冲刺的**截止时刻**（秒，绝对时间基准同 `nextAttackAt`）；有值 ⇒ 正在冲刺。
     *
     * 只是一个兜底：正常收场是「撞到人」或「跑到终点」，只有在终点被墙挡住 / 坐标异常
     * 这种极端情况下才会靠超时结束。超时与冲空同责 —— 不结算伤害、冷却照扣。
     */
    dashUntil?: number;
    /**
     * 冲刺收场（撞上 / 冲空）之后的**原地待机截止时刻**（秒）。
     *
     * 2026-11-03 用户口径：「冲刺是运动霸的普通攻击，每次普通攻击都会有 0.7 秒的冷却时间，
     * 冷却时间静止在原地播放待机动作」。所以冷却起算点是**撞上 / 冲空那一刻**，
     * 不是起冲 —— 冲刺本身就是这套普攻的动作，动作做完才开始计冷却。
     *
     * 与 `nextAttackAt` 的区别：后者是所有单位共用的「下一次能出手的时刻」，冷却期间还要
     * 继续追人；这个只给冲刺单位用，冷却期间**不索敌、不挪窝**，站在原地播待机动作。
     */
    dashRecoverUntil?: number;
    hatredUnitId: number | null;
    hatredUntil: number;
    facingRadians: number;
    deathRemoveAt: number;
    /** 自由直线移动（无索敌直行）：前进方向角；null = 逐格移动（追敌/攻击） */
    marchAngle: number | null;
    /** 单位的连续实际坐标；状态切换时保留，避免攻击前回退到格子中心。 */
    freeX: number;
    freeY: number;
    /**
     * 已完成的普攻次数；用于 PVP 技能表 empoweredEvery 强化攻击。
     *
     * ⚠️ 2026-10-13 从 `attackCount` 改名：表里 `pvpAttrMap.statId='attackCount'` 指
     * 「一次普攻打几段」（连击段数），与这里的「累计次数」同名不同义。
     */
    completedAttackCount?: number;
    /**
     * 强化技的下次可用时刻（秒，绝对时间基准 = `ZCGameState.elapsedSeconds`）。
     *
     * 只在 `attackProfile.trigger === 'every_seconds'`（按 CD 触发）时使用。首次出手时被初始化为
     * 「出手时刻 + cooldown」，所以开局第一击**不会**立刻强化；之后每满 `cooldown` 秒，
     * 在下一次普攻时触发一次。用绝对时刻而非累加器，是为了让快照/回放落在同一时间基准上。
     */
    empoweredReadyAt?: number;
    /**
     * 副轨主动（`attackProfile.secondarySkillId`）的下次可用时刻（秒，同 `empoweredReadyAt` 的绝对时间基准）。
     *
     * 2026-11-04 椰蛋战士「横扫」：一条普攻行只有一个强化槽（暴风占了），
     * 冷却型的那条挂在副轨上，由 `ZCSkillTriggerSystem` 每步推进。
     * 缺省 undefined ⇒ 首次推进时初始化为「当前 + CD」，开局不立刻放。
     */
    secondaryReadyAt?: number;
    /**
     * 护盾到期时刻（秒，同 `empoweredReadyAt` 的绝对时间基准）。
     *
     * 2026-10-29 给「亡者护盾」这类**有持续时间的吸收盾**用：`shield` 原本只是个数字，
     * 没有到期概念，`applyShieldAura` 的护盾会一直留到被打完。缺省 undefined ⇒ 永不过期，
     * 存量护盾行为不变（由 `ZCSkillTriggerSystem` 每步清理到期的那批）。
     */
    shieldExpireAt?: number;
    /** 连发剩余发数（机关枪）。0 / 缺省 = 没有连发计划。 */
    burstShotsLeft?: number;
    /** 下一发连发的时刻（秒）。 */
    burstNextAt?: number;
    /** 连发间隔（秒）。 */
    burstInterval?: number;
    /** 连发每发的伤害倍率（相对普攻）。 */
    burstDamageRate?: number;
    /**
     * 低血护体上次触发时刻（秒）。用于按 `lowHpCooldown` 判内置冷却；
     * 缺省 = 从未触发（开局即可触发一次）。
     */
    lowHpGuardFiredAt?: number;
    /** 常驻被动状态是否已挂（`passive_status`）；避免每步重复 apply。 */
    passiveStatusApplied?: boolean;
    /**
     * 受击反弹减益：护体生效期间，每次被单位打中就按这个百分比降低**攻击者**的攻速
     * （格挡 III 的「使攻击者攻击速度降低10%」）。缺省 0 ⇒ 受伤结算里整段不执行。
     */
    retaliateSlowPct?: number;
    /** 受击反弹减益的截止时刻（秒）；与 `retaliateSlowPct` 成对出现。 */
    retaliateUntil?: number;
    /**
     * 冷却型自身施法（`behaviorKey = 'self_cast'`）的下次可用时刻（秒，同 `empoweredReadyAt` 的绝对时间基准）。
     *
     * 2026-10-30「吃口菠萝 / 嗜血 / 迅击」这类**不出手**的主动：既占不到强化槽（那个给累计普攻的那条），
     * 也占不到副轨（副轨只出扇形伤害），所以由 `ZCSkillTriggerSystem` 按这个时间自己推进。
     * 缺省 undefined ⇒ 首次推进时初始化为「当前 + CD」，开局不立刻放。
     */
    selfCastReadyAt?: number;
    /** 多点打击（`behaviorKey = 'random_strike'`，按 CD 触发）的下次可用时刻（秒）。 */
    strikeReadyAt?: number;
    /**
     * 多点打击（按累计普攻触发）上一次触发时的 `completedAttackCount`。
     * 缺省 undefined ⇒ 第一次推进时只记下当前计数，不立刻打一波。
     */
    strikeFiredCount?: number;
    /** 多点打击的持续窗口结束时刻（秒）；配了 `strikeSeconds` 才会有。 */
    strikeUntil?: number;
    /** 持续窗口内下一波的时刻（秒）。 */
    strikeNextAt?: number;
    /**
     * 多点打击「这一帧打空了」之后的下次重试时刻（秒）。
     *
     * 打空时**不推进 CD**（跑位途中别把机会转掉），但也不能每帧重试 ——
     * 多条镭射飞龙的导弹会因此同上同下：目标进入射程的那一帧**一起开火**，
     * 屏幕上就是一波 6 个导弹（2026-11-05 用户反馈）。
     * 改成「退避 0.2s + 按 `unit.id` 错峰」，齐射就被拆成先后两波。
     */
    strikeRetryAt?: number;
    /**
     * 移形换影（`behaviorKey = 'blink_strike'`，魔术师 103404）的下次可用时刻（秒）。
     *
     * 与 `selfCastReadyAt` / `strikeReadyAt` 同一套「绝对时刻」口径；缺省 undefined
     * ⇒ 首次推进时初始化为「当前 + CD」，开局不立刻放。
     */
    blinkReadyAt?: number;
    /**
     * 分身的爆炸时刻（秒）；`blinkCloneX/Y` 是爆炸点（**施法时的原位**）。
     *
     * 为什么要单独记坐标：分身是「留在原地」的，本体闪现回来之后还会继续跑位，
     * 拿 `unit.freeX/freeY` 当爆炸点会跟着本体漂走 —— 那就不是分身了。
     */
    blinkCloneAt?: number;
    blinkCloneX?: number;
    blinkCloneY?: number;
}

export interface IZCNeutralFeatureState {
    claimed: boolean;
    effect?: import('./ZCNeutralResourceGroup').IZCGateEffect;
    readyAt?: number;
    windowUntil?: number;
    insideUnitIds?: readonly number[];
    lineHexIds?: readonly number[];
    buildOwner?: ZCOwner;
    buildUsed?: boolean;
    portalExitId?: number;
    awake?: boolean;
    targetUnitId?: number | null;
    nextAttackAt?: number;
}

/** 逻辑层产生、视图层只读消费的短生命周期战斗表现事件。 */
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
    /**
     * 「定格光束」：这一条**只是**命中后的余韵，长度已经不动，只负责淡出。
     *
     * 2026-11-03 需求「镭射飞龙的普通攻击…触碰到第一个敌人时就会停止延长，造成 1 次伤害，
     * 特效缓慢变透消失，0.18s 内消失」。
     *
     * 弹道在命中那一拍就被 `ZCProjectileSystem` 摘掉（否则会再打一次），所以「定格 + 渐隐」
     * 只能另起一条纯表现事件：`from` = 出手点、`to` = **命中点**、`durationSeconds` = 淡出秒数
     * （见 `ZCCombatEffectFlight.zcCombatEffectFadeSecondsOf`）。
     * 视图看到这个标记就按满长画，并把整体透明度按 `progress` 压到 0；
     * 不结算任何伤害，也不参与命中判定。
     *
     * ⚠️ `combatEvents` 不进存档（`ZCSnapshotCodec.restore` 会把整列清空），所以加字段不影响兼容。
     */
    beamHold?: boolean;
    /**
     * 「出现时由小长大」的时长（秒，2026-11-07 椰蛋战士「暴风」100504）。
     *
     * 需求原话：「生成后由小变大到当前的大小」。视图从 `0` 线性缓出到 `1`，再乘到节点缩放上，
     * `growSeconds` 之后恒为 1 —— 所以「最终大小」仍然完全由 prefab 烘焙缩放（× `zcCombatEffectNodeScaleOf`）
     * 决定，这里只补一段入场。
     *
     * 缺省 `undefined` ⇒ 不生长（一次性挂上就是最终大小），所有既有特效行为逐字不变。
     *
     * ⚠️ `combatEvents` 不进存档，加字段不影响兼容。
     */
    growSeconds?: number;
    /**
     * 这条特效该播哪一段骨架动画（`sp.Skeleton.setAnimation`，2026-11-07 鹿神守护）。
     *
     * 背景：小鹿区域是**两段式**的 —— 先以「接近」速度走（播 `move`），到位后冲刺（播 `attack`）。
     * 动画名跟着事件走，而不是写死在视图里：视图只管「名字变了就切」，阶段判断留在模型
     * （阶段是真状态，得进快照）。
     *
     * 缺省 `undefined` ⇒ 视图一次都不碰动画，预制体自带的 `defaultAnimation` 照旧播 ——
     * 所有既有特效行为逐字不变。
     *
     * ⚠️ `combatEvents` 不进存档，加字段不影响兼容。
     */
    spineAnimation?: string;
}

/** 在途弹道属于可恢复的战斗状态，碰撞后才产生伤害。坐标均为棋盘逻辑坐标。 */
export interface ZCProjectileState extends ZCCombatEvent {
    type: 'projectile';
    targetKind: ZCCombatTargetKind;
    targetId: number;
    sourceCardId: string;
    /** 出手时的攻击属性；克制系数在命中实际目标时计算。 */
    baseDamage: number;
    x: number;
    y: number;
    previousX: number;
    previousY: number;
    velocityX: number;
    velocityY: number;
    collisionRadius: number;
    canHitAir: boolean;
    /** 命中后在落点创建持续区域（火船/风龙：投射物飞过去命中后才烧）。 */
    zoneDuration?: number;
    zoneWaves?: number;
    zoneSlow?: number;
    /** Damage used by the persistent zone created at impact; separate from collision damage. */
    zoneDamage?: number;
    /** Number of additional enemy units this projectile may pass through after its first hit. */
    remainingPierces?: number;
    /**
     * 每次穿透后剩余伤害的相对衰减（0.2 = 每穿一人降 20%，2026-10-30 玉林好汉「精英猎手」）。
     *
     * 缺省 0 ⇒ 不衰减，行为与改动前逐字一致；衰减就地乘在 `baseDamage` 上，
     * 因为命中结算（`resolveProjectileHit`）与溅射都只从 `baseDamage` 现算。
     */
    pierceFalloff?: number;
    /** Units already hit by this projectile; persisted so restore cannot hit the same unit twice. */
    hitUnitIds?: number[];
    /** Empowered-hit execute chance in the normalized 0..1 range. */
    executeChance?: number;
    /** Critical is rolled when the projectile is launched and must survive snapshot restore. */
    criticalHit?: boolean;
    /** 命中单位后施加的状态 id（出手时随 profile 快照，避免命中时再查表）。 */
    onHitStatusId?: string;
    /** Formula buff results are snapshotted at launch so restore does not reroll conditions. */
    legacyBuffs?: ZCLegacyBuffApplication[];
    /** Old skillEffect `伤害范围`, already converted to board units. */
    splashRadius?: number;
    /**
     * 溅射伤害比例（2026-10-30「爆囊扩散」100802/100902/103202）。
     *
     * 旧技能表的溅射一律按**全额** `baseDamage` 结算（`splashRadius` 有值就全套用），
     * 而新被动要的是「命中对周围造成 30/40/50% 溅射」——倍率和半径是两件事。
     * 缺省 1 ⇒ 既有溅射（旧 skillEffect）逐字不变。
     */
    splashDamageRate?: number;
    /**
     * 命中后（或到点后）播放的爆炸特效路径（镭射飞龙「追踪导弹」101003）。
     *
     * 与弹道本身的 `effectPrefabPath`（飞行段的弹体）是两个 prefab：
     * 弹体飞到头 / 撞到人那一刻，视图按这个路径换播爆炸（`镭射飞龙_导弹技能命中`）。
     * 缺省 ⇒ 与既有弹道一致，只把 `effectPrefabPath` 那一个特效播到底。
     */
    impactEffectPrefabPath?: string | null;
    /** 弧线飞行：出手点到目标点之间的**中段最大横向偏移**（世界坐标，缺省 0 = 直线）。 */
    arcOffset?: number;
}

/**
 * 逻辑层产生、视图层只读消费的飘字（Old Client 战斗文本 / 金币增长）。
 *
 * 和 `damageStats` 一样**刻意不写进 ZCSnapshot**：这是本局生命周期内的瞬时表现，
 * 混进快照会牵动 `version` 与存档兼容，收益不成正比。
 */
export interface ZCFloatText {
    id: number;
    kind: ZCFloatTextKind;
    /** 造成伤害 / 获得金币的一方；用于归属、筛选和后续阵营表现扩展。 */
    owner: ZCOwner;
    /** 实际结算数值；MISS 为 0，其余类型为正整数。 */
    value: number;
    /** 飘字锚点的逻辑坐标（受击目标 / 产出金币的建筑 / 阵亡单位）。 */
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 受击特效的**锚点语义**：这一下打在什么东西上。
 *
 * 模型层只知道「打在单位 / 城墙 / 建筑上」，**不知道**那三样在屏幕上各自画在哪 ——
 * 单位的锚点就是它自己的插值坐标，城墙铺在这一格的六条边上、建筑图则挂在格子 prefab 的
 * `BuildingIcon`（比格心高 15.65px）。偏移量属于视图口径，落在 `ZCCombatEffectPlacement`
 * 的 `zcHitFxSurfaceLiftY`，模型只透传这个语义。
 */
export type ZCHitFxSurface = 'unit' | 'building' | 'wall';

/**
 * 逻辑层产生、视图层只读消费的**受击特效**展示项（美术 `units/effects/受击特效/<职业>受击`）。
 *
 * 与 `ZCFloatText` 同一套口径：**刻意不写进 ZCSnapshot** —— 一次性表现，混进存档会牵动
 * `version` 与存档兼容，收益不成正比。模型只维护队列 + 过期清理，视图按
 * `startedAt / durationSeconds` 决定何时回收节点。
 *
 * 🔴 `trait` 是**攻击方**的职业（山猫 2026-10-15 拍板：按攻击方职业触发），不是被打方的 ——
 * 被法师打到的坦克也播法师那组闪白。取值就是卡表 `traits.attack` 的四个职业
 * （`ZCAttackTrait`），与美术那四组目录名一一对应。
 */
export interface ZCHitFx {
    id: number;
    /** 攻击方攻击职业；渲染层用它选 `受击特效/<trait>受击/<trait>受击` 的 prefab。 */
    trait: ZCAttackTrait;
    /**
     * 被打一方的归属；预留给「只给敌对伤害播闪白」这类阵营过滤（当前不筛）。
     * 结构物（城墙 / 建筑）这边取 `hex.owner`，可能是 `'neutral'` ⇒ 用 {@link ZCFaction}。
     */
    owner: ZCFaction;
    /**
     * 打在什么上（2026-11-06 需求：建筑 / 城墙受击也要播**攻击方职业**的受击特效）。
     *
     * 视图按它决定锚点补偿：`unit` / `wall` 就是格心，`building` 要抬到建筑图的中心
     * （`ZCGameHex.prefab` 的 `BuildingIcon` 在 +15.65px）。
     */
    surface: ZCHitFxSurface;
    /**
     * **被打那一方的模型等比缩放**（`pvpCard.prefabSize`，基准 1）—— 受击特效按它跟着体型走。
     *
     * 2026-10-31 需求「各类受击特效需要匹配受击目标的模型大小」。
     * 项目里「模型有多大」只剩这一个旋钮：spine 单位都按骨架 canvas 归一到可见高 67.27px，
     * 序列帧单位的画布也都压到 ~67px，差别全在 `prefabSize`（0.8~1.2）。详见 `ZCCombatEffectScale`。
     *
     * 为什么放在**受击方**而不是攻击方：闪白是贴在被打的那个身体上的，
     * 与「谁打的、用什么特效」无关（后者由 `trait` 决定）。
     */
    targetScale: number;
    /** 特效锚点的世界坐标（=被打单位当前插值位置，与飘字同源）。 */
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 逻辑层产生、视图层只读消费的「抽到卡牌」小卡牌展示项。
 *
 * 与 `ZCFloatText` 同一套口径：**刻意不写进 ZCSnapshot** —— 它只活 2 秒多，
 * 混进存档会牵动 `version` 与存档兼容，收益不成正比。模型只维护队列 + 过期清理，
 * 视图按 `startedAt / durationSeconds` 算进度。
 *
 * 不带美术资源名：建筑图由渲染层按 `cardId -> buildIcon` 解析，模型层不碰 resources 路径。
 */
export interface ZCCardReveal {
    id: number;
    /** 抽中的卡牌 id；渲染层据此读取卡表里的 buildIcon。 */
    cardId: string;
    /** 抽到这张卡的一方；目前双方对称展示（与飘字一致）。 */
    owner: ZCOwner;
    /** 该卡落地成的建筑类型，决定卡面用哪张建筑图。 */
    building: ZCBuildingType;
    /** 建筑品级 1..4（绿蓝紫金），决定卡框与品级名颜色。 */
    tier: number;
    /** 卡名（卡表 `name`），如「精灵弓箭手」。 */
    cardName: string;
    /**
     * 该卡产出的**兵种 id**（`pvpCard.unitId`），卡面立绘按它取兵种的 idle 图。
     *
     *  金矿 / 主城 / 防御塔这类没有产出兵种的卡留 `null`，卡面回退到建筑图。
     */
    unitId: string | null;
    /**
     * 问号地块（`all-random`）翻出时的**运气评语**（见 `ZC_LUCK_TEXTS`）。
     *
     *  非空时视图把上方 `LuckSprite` 切成对应品级的评语切图；确定地块（兵营/金矿）
     *  结果明摆着，这里放空串，上方那行就不显示。
     */
    luckText: string;
    /** 卡牌弹出的锚点格；视图默认把卡牌压在格心上（`ZCCardRevealView.offsetY` 可调）。 */
    hexId: number;
    /** 锚点格的逻辑坐标；视图直接消费，不必再回查地图配置。 */
    x: number;
    y: number;
    /**
     * 卡牌起点（秒）。
     *
     * ⚠️ 落地那一刻**还不是**卡牌的起点：地块先播**点击动画** —— 脉冲水波纹与原地缩没
     * **并发**（同起同收，宽 `ZC_CARD_START_SECONDS`）—— 卡牌要等它播完才弹。
     * 所以这里存的是「点击动画结束」的时刻，推后于开发事件本身。
     */
    startedAt: number;
    durationSeconds: number;
}

/**
 * 开发成功时的「地块激活表现」事件（纯表现，不进快照，口径同 `ZCCardReveal`）。
 *
 * 点击可开发地块后，模型立即落地建筑并同时入队一条激活事件；视图据此播放
 * 「阶段 1 脉冲（格子带 UI 原样不动）→ 脉冲到中间帧起 阶段 2 格子原地缩没 →
 * 卡牌弹出（`ZCCardReveal` 已有）→ 卡牌淡出时地块回场、建筑同拍由小变大 + 光效」的表现。进度按 `startedAt / durationSeconds`
 * 每帧计算，不引入 tween，切流程 / 暂停 / 快照回放都不会留下补间残影。
 *
 * ⚠️ 时长 = `ZC_CARD_START_SECONDS`（点击动画：脉冲 **∥** 缩没，取两者较长者 0.7s）
 * + `ZC_CARD_REVEAL_SECONDS`（卡牌段 1.156s） = `ZC_HEX_ACTIVATION_SECONDS` = 1.856s。
 * 建筑生成**不单开一段**：它在卡牌淡出窗（最后 38%）内长完（`ZC_HEX_BUILDING_SECONDS` 只是
 * 建筑自己的生长时长）。轴上是**两段**：① ∥ ② 并发（点击动画）→ ③ 卡牌，
 * 卡牌淡出与建筑生长是**同拍重叠**的。
 */
export interface ZCHexActivation {
    id: number;
    /** 被激活的地块（开发成功、已落定建筑的那一格）。 */
    hexId: number;
    /**
     * 这次开发是否跟着一条卡牌揭示（`pushCardReveal`）—— 即抽到的卡是否落在格子上。
     *
     * 🔴 它决定「收场段之后」怎么接：有卡牌时整格隐藏、让卡牌独占视线；
     * **抽空 / 抽到不能建的卡时没有卡牌**，再隐藏就是「格子凭空消失、露出棋盘底」。
     * 全类型随机问号格的 `empty` 权重是 0.7（七成空手），所以这条路走得很多。
     */
    hasCardReveal: boolean;
    /**
     * 本次开发**抽到的卡牌品阶**（1 绿 / 2 蓝 / 3 紫 / 4 金；`0` = 没抽到卡）。
     *
     * 2026-10-19 用户口径：脉冲序列帧「整体颜色根据对应获得的卡牌品阶」上色，
     * 没抽到卡时按绿（1 档）走。它只影响脉冲那一层的染色，与「有没有卡牌揭示」是两件事：
     * 抽到卡但**建不上**（`!result.building`）时仍有品阶、没有揭示。
     */
    cardRarity: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 建筑「该抖一下了」的一次性通知（表现层，2026-10-15 row12 / row13）。
 *
 * 两个来源共用这一条：
 *  · **产兵**：兵营倒计时结束、兵从 `isBirth` 站上来的那一拍（视图侧从单位出生直接触发，不走本队列）；
 *  · **产金**：主城 / 金矿的金币倒计时结束（`ZCEconomySystem.tickIncome` 的 `grantGold`）。
 *
 * 🔴 只带 `hexId`、**不带时长也不带起点**：抖动曲线（时长、拉多少、先 Y 后 X）的真源在
 * `ZCGameViewUtil`，视图自己知道怎么播；而「从哪一刻开始算」由渲染层在**收走这一拍的同一帧**
 * 用它与其它动画共用的那口时钟（`visualTime`）落定 —— 所以这条队列是**取走即空**的
 * （`ZCBattlePresentationQueue.drainBuildingShakes`），不参与 `prune`：
 * 抖动**不幂等**（`playBuildingShake` 会把起点重置到现在），重复消费会变成一直重头播。
 */
export interface ZCBuildingShake {
    id: number;
    /** 抖动的那一格（主城 / 金矿 / 兵营）。 */
    hexId: number;
}

/**
 * 建筑**被摧毁**的一次性通知（表现层），2026-10-19 新增。
 *
 * 建筑 HP 归零那一步在 `ZCDamageResolutionSystem.damageBuilding` 里把这一格改成
 * `state = 'ruins'`、`building = 'none'` —— 那之后渲染层只能看到「已经变成废墟」的快照，
 * **没有任何一帧还能知道「刚刚被打掉」**。所以必须由模型在判定那一拍显式发一条通知，
 * 渲染层才播得出白烟雾爆炸。
 *
 * 与 `ZCBuildingShake` 同型：**只带 hexId、不带时长也不带起点**。
 * 一次性、取走即空（`drainBuildingDestructions`），不参与 `prune`。
 */
export interface ZCBuildingDestruction {
    id: number;
    /** 被摧毁建筑所在的那一格。 */
    hexId: number;
}

/**
 * 中立资源被领取的一次性表现通知（2026-10-20 新增）。
 *
 * 领取发生在 `ZCDevelopmentSystem.claimAdjacentNeutralResources`（相邻自动领取）或
 * `develop`（AI 开发中立格）里 —— 那之后快照里 `neutralResourceId` 已被清空，渲染层
 * **没有任何一帧还能知道「刚刚领了哪一格、领了多少」**，所以由模型在发奖那一拍显式发一条。
 *
 * 与 `ZCFloatText` 同一套口径：**刻意不写进 ZCSnapshot**（瞬时表现，不进存档）。
 * 模型只维护队列 + 过期清理；视图按 `startedAt / durationSeconds` 算进度，
 * 且**只给玩家自己的领取播飞行特效**（金币 / 神器目标都在玩家 HUD 上）。
 *
 * 时长口径（`durationSeconds`）与视图动画共用 `ZC_NEUTRAL_REWARD_*` 常量，
 * 真源在 `ZCBattlePresentationQueue`。
 */
export interface ZCNeutralReward {
    id: number;
    /** 被领取的那一格。 */
    hexId: number;
    /** 领取的资源项 id（`neutralResourceGroup.id`）；视图据此判「金币飞行 / 神器飞行 / 不出特效」。 */
    itemId: number;
    /** 领取的一方；非玩家领取不播「飞向 HUD」的特效（目标不在玩家界面上）。 */
    owner: ZCOwner;
    /** 实际入账的金币；> 0 时视图播「金币飞向金币栏 + 上飘 +N」。 */
    gold: number;
    /** 实际入账的神器充能；> 0 时视图播「神器飞向神器栏」。 */
    artifactCharge: number;
    startedAt: number;
    durationSeconds: number;
}


/**
 * 建筑冷却条的相位：建造中 → 产金 / 产兵 / 攻击（后三者互斥，由建筑类型决定）。
 *
 * 视图只用它挑进度条颜色与文案，规则侧不读；因此纯表现，不进快照。
 */
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
    /** 各席位独立金币；player/enemy 同步保留上面两个旧字段，兼容既有 UI 与 version 4 存档。 */
    goldByOwner?: OwnerNumberRecord;
    /** 已完成充能、当前可以储存并释放的神器次数。 */
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
    /** 独立的状态实例快照；旧 version 4 存档缺省为空。 */
    statusEffects?: ZCStatusSystemSnapshot;
    /** 持续区域（暴风雪类 area 技能）；缺省 = 空。 */
    groundZones: ZCGroundZoneState[];
}

/**
 * 持续伤害区域（暴风雪类 area 技能）：在目标点停留若干秒，分波造成范围伤害并减速。
 * 坐标是棋盘逻辑坐标；每波间隔 = durationSeconds / waves。
 */
export interface ZCGroundZoneState {
    x: number;
    y: number;
    radius: number;
    /** 施术者阵营；只对敌方单位造成伤害与减速。 */
    owner: ZCOwner;
    sourceUnitId: number;
    skillId: number;
    skillName: string;
    effectPrefabPath?: string | null;
    /** 剩余秒数。 */
    remainingSeconds: number;
    /** 还剩几波要结算。 */
    wavesLeft: number;
    /** 下一波结算的绝对时刻（= elapsedSeconds）。 */
    nextWaveAt: number;
    /** 每波间隔秒。 */
    waveInterval: number;
    /** 每波对每个敌人造成的伤害。 */
    damage: number;
    /** Cast-time damage text classification, persisted with the zone. */
    floatTextKind?: ZCCombatFloatTextKind;
    /** 每波命中时施加的移速减速（0~1）；0 = 不减速。 */
    slowRatio: number;
    /** One-shot damage dealt when the zone expires. */
    expireDamage?: number;
    /** Optional status applied with the expiry damage. */
    expireStatusId?: string;
    /** Per-instance status duration override in seconds. */
    expireStatusDuration?: number;
    /**
     * 区域的移动速度（世界坐标/秒，2026-11-04 椰蛋战士「暴风」）。
     *
     * 缺省 undefined ⇒ 原地不动，所有既有区域（暴风雪 / 灼热地带 / 火船）行为逐字不变。
     * 给了速度就必须同时给 `hitUnitIds` + `maxHits` 这套「命中名额」，
     * 否则会变成一个一路刷伤害的移动炮台。
     */
    moveVelocityX?: number;
    moveVelocityY?: number;
    /**
     * 已经打过的单位 id（移动区域专用）：一个区域对**同一个敌人只结算一次**。
     *
     * 原地区域（波次伤害）不需要它 —— 那是有意每波重复打；移动区域表达的是
     * 「风扫过路径上最多 N 个敌人」，同一个敌人被同一阵风连打三波是错的。
     */
    hitUnitIds?: number[];
    /** 命中名额上限（移动区域专用）；打满就提前消散。缺省 0 = 不限。 */
    maxHits?: number;
    /**
     * 「每多命中一个目标，伤害再降 N」的递减系数（0~1，2026-11-06 魔术师「鹿神守护」103405）。
     *
     * 第 k 个被命中的目标吃 `damage × (1 - damageFalloff)^k`（k 从 0 起）。
     * 设计口径是「每多一个目标减少 50%」，即 0.5 ⇒ 100% / 50% / 25% …… 逐级递减。
     *
     * 缺省 undefined ⇒ 不递减，所有既有区域（暴风雪 / 灼热地带 / 火船 / 暴风）行为逐字不变。
     */
    damageFalloff?: number;
    /**
     * 「整段持有视觉」（2026-11-07 魔术师「鹿神守护」103405 的小鹿冲刺）。
     *
     * 区域的表现事件有两种口径：
     * - **按波次**（缺省，既有全部区域都是这个）：每一波在**当波位置**推一条
     *   `durationSeconds = waveInterval` 的 `area` 事件 ⇒ 移动区域会沿路径闪成一串残影。
     * - **整段持有**（本字段为 true）：区域创建后的第一拍推**一条**长效事件，`durationSeconds`
     *   直接取其剩余寿命，之后每帧把事件坐标改写成区域当前位置 ⇒ 一个视觉跟着区域走完全程，
     *   区域消散（含提前打满命中名额）时事件同步摘掉。
     *
     * 鹿神守护要的是「小鹿本体 + 上层循环火特效整段跟着冲刺」，一串残影做不到这件事。
     * 缺省 undefined ⇒ 所有既有区域（暴风雪 / 灼热地带 / 火船 / 暴风）行为逐字不变。
     */
    holdVisual?: boolean;
    /**
     * 上面那条长效表现事件在 `combatEvents` 里的 id，由 `ZCGroundZoneSystem` 自己维护。
     *
     * 刻意**不进快照**（`combatEvents` 本来也不进存档，`ZCSnapshotCodec.restore` 会清空整列），
     * 所以不需要在 `ZCSnapshotCodec` 的字段白名单里登记。
     */
    visualEventId?: number;
    /**
     * 视觉入场「由小长大」的秒数（2026-11-07 椰蛋战士「暴风」100504）。
     *
     * 只作用于「整段持有视觉」那条长效事件（见 `holdVisual`）：区域刚生成时视觉从 0 长到最终大小，
     * 而不是凭空一次性糊上一整块。缺省 undefined ⇒ 不生长。
     */
    growSeconds?: number;
    /**
     * 「接近阶段」的移动速度（世界 px/秒，2026-11-07 魔术师「鹿神守护」103405 需求 2）。
     *
     * 给了它就进入**两段式移动**：
     * 1. **接近**：朝 `approachTargetId` 走（每帧重算方向，目标会跑），速度 = 本字段；
     *    期间**不扣** `remainingSeconds`、**不结算**任何一波伤害；
     * 2. **冲刺**：与目标距离 ≤ `sprintRange`（或目标已倒下）时切段 —— 速度换成 `sprintSpeed`、
     *    方向锁定切换那一刻的朝向，`remainingSeconds` 从满值开始扣、波次照旧结算。
     *
     * 缺省 undefined ⇒ 没有接近阶段，所有既有区域（暴风雪 / 灼热地带 / 火船 / 暴风）行为逐字不变。
     */
    approachSpeed?: number;
    /** 接近阶段追的目标单位 id（`unit.id`）；目标倒下 / 找不到时立刻转冲刺。 */
    approachTargetId?: number;
    /** 与 `approachTargetId` 的距离 ≤ 它（世界 px）就转冲刺。缺省 0 ⇒ 一出生就冲。 */
    sprintRange?: number;
    /** 冲刺速度（世界 px/秒）；转段时写进 `moveVelocityX/Y`（世界 px/秒）。缺省 0 ⇒ 转段后原地不动。 */
    sprintSpeed?: number;
    /**
     * 是否已经切到冲刺段。
     *
     * 缺省 / false ⇒ 仍在接近（或压根没有接近阶段）。**必须进快照**：存档还原后小鹿不能
     * 又从出生点重新走一遍，也不能把「已经冲过的两秒」再冲一次。
     */
    sprinting?: boolean;
    /**
     * 当前该播的骨架动画名（`sp.Skeleton.setAnimation`，2026-11-07 鹿神守护）。
     *
     * 由区域系统按阶段改写，`syncHoldVisual` 每次把它抄进那条长效表现事件；
     * 视图只在**名字变化**时才真的 `setAnimation`，否则每帧重播会把动画钉在第一帧。
     * 缺省 undefined ⇒ 视图不碰动画（既有特效的预制自带 `defaultAnimation`，行为逐字不变）。
     */
    visualAnimation?: string;
}

/**
 * 动作失败的**机器可读**原因。
 *
 * 给表现层用的：要为某一类失败做专属反馈（如金币栏跳动）时看这个字段，
 * **不要去解析 `message`** —— 那是给玩家看的文案，策划改字就变，今天的写法明天就失效。
 * 只登记真正有专属表现的原因，其余失败留空走通用文案。
 */
export type ZCActionFailureReason = 'insufficientGold';

export interface ZCActionResult {
    ok: boolean;
    /** 仅供主动点击类操作（神器按钮等）弹吐司；棋盘开格路径只读 `reason`，不构造文案。 */
    message?: string;
    /** 失败原因；`ok === true` 或原因未分类时为 `undefined`。 */
    reason?: ZCActionFailureReason;
}

export interface ZCScoreBreakdown {
    territory: number;
    mainCityHp: number;
    unitCount: number;
    totalUnitHp: number;
}
