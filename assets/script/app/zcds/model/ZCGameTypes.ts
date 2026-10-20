import type { ZCAttackTrait, ZCCardType, ZCCombatEventType, ZCUnitId } from './ZCCombatCatalog';
//  真源在 `ZCCombatCatalog`（攻击档案的领域），这里转出以保持既有 `from './ZCGameTypes'` 的取用路径。
export type { ZCCombatEventType };
import type { ZCFaction, ZCOwner } from './ZCMapConfig';
import type { ZCNeutralResourceId } from './ZCNeutralResourceReward';
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
    owner: ZCOwner;
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
/** Transient battle text. `miss` is supported for the later dodge pipeline as in Old Client. */
export type ZCFloatTextKind = ZCCombatFloatTextKind | 'heal' | 'miss' | 'gold';

export interface ZCHexState {
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
    /** 自选出生点阶段从固定点位资源池抽出的本局中立资源。 */
    neutralResourceId?: ZCNeutralResourceId | null;
    /** 大于 0 时建筑仍在建造，不能产金、产兵或攻击。 */
    constructionRemainingSeconds: number;
    constructionTotalSeconds: number;
    captureOwner: ZCOwner | null;
    /** 当前进攻阵营的控制进度（秒）；阈值和增减倍率来自本局运行时配置。 */
    captureSeconds: number;
}

export interface ZCUnitState {
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
    /** 被打一方的归属；预留给「只给敌对伤害播闪白」这类阵营过滤（当前不筛）。 */
    owner: ZCOwner;
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
    /** 领取的资源 id（金币堆 / 金矿 / 宝箱 / 神器充能 / 兵力）。 */
    resourceId: ZCNeutralResourceId;
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
