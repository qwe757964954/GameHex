import type { ZCAttackTrait, ZCCardType, ZCCombatEventType, ZCUnitId, ZCUnitDefinition } from './ZCCombatCatalog';
//  真源在 `ZCCombatCatalog`（攻击档案的领域），这里转出以保持既有 `from './ZCGameTypes'` 的取用路径。
export type { ZCCombatEventType };
import type { ZCFaction, ZCOwner } from './ZCMapConfig';
import type { ZCPvpTileType } from './ZCPvpTileRules';
import type { ZCStatusSystemSnapshot } from './ZCStatusEffect';
import type { ZCLegacyBuffApplication } from './ZCLegacySkillEffect';

/** 渲染读取实时状态；只有 exportSnapshot() 返回可独立修改的存档。*/
export type DeepReadonly<T> = T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** 伤害来源种类：单位 / 建筑 / 神器（建筑与神器没有 `unitId`，见 `ZCDamageSource.attackerTrait`）。*/
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
    /** 出手与命中日志用同一个弹道 ID 串联。*/
    projectileId?: number;
    /** Old Client battle-text classification carried from cast to actual hit.*/
    floatTextKind?: ZCCombatFloatTextKind;
    /** Damage already displayed by the same hit (used to merge execute into one number).*/
    floatTextValueOffset?: number;
    /**
     * 攻击方的攻击职业（=卡表 `traits.attack`），用来挑受击特效。
     *
     * 为什么不是渲染层自己反查：建筑 / 神器造成的伤害根本没有 unitId（见 `ZCGameModel`
     * 里 `kind:'artifact'` / `kind:'building'` 两处调用），渲染层拿不到攻击方是谁；而单位攻击
     * 的伤害源头就在这里，是唯一能把职业带到位的地方。留空 ⇒ 不播受击特效。
    */
    attackerTrait?: ZCAttackTrait;
    /**
     * 本次伤害是否算「远程」（投射物 / 范围 / 持续区域）。
     *
     * 2026-10-29 为藤盾（`damageTakenRangedPct`）而加。不标记 ⇒ 按近战处理，
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

/** 攻击目标种类：单位 / 城墙 / 建筑（`ZCTargetingSystem` 与 `ZCCombatTarget` 共用）。*/
export const ZCCombatTargetKind = {
    Unit: 'unit',
    Wall: 'wall',
    Building: 'building',
} as const;
export type ZCCombatTargetKind = (typeof ZCCombatTargetKind)[keyof typeof ZCCombatTargetKind];

/** Old Client `DamageTextType` variants that represent hostile damage.*/
export const ZCCombatFloatTextKind = {
    Damage: 'damage',
    Critical: 'critical',
    Restraint: 'restraint',
    Resisted: 'resisted',
    Execute: 'execute',
} as const;
export type ZCCombatFloatTextKind = (typeof ZCCombatFloatTextKind)[keyof typeof ZCCombatFloatTextKind];
/**
 * 战斗飘字。`gold` 是击杀/拆建筑掉落（原地缩小消失，无数字）；
 * `goldincome` 是主城/金矿产出（升起 50px + 数字）；`miss` 留给后续闪避管线。
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
    /** 已开发地块外围城墙的独立耐久；归零后单位才能攻击本格建筑。*/
    wallHp: number;
    wallMaxHp: number;
    /** 城墙被击破时形成的单边缺口（0~5）；null 表示完整或旧版整墙已毁状态。*/
    wallBreachedEdge?: number | null;
    developmentCost: number;
    /** 可开发时展示并使用的 PVP 地块类别；主城为 null。*/
    tileType: ZCPvpTileType | null;
    /** 已支付并完成过本格抽取；抽空也会消耗地块，不能重复开发。*/
    developmentResolved: boolean;
    cardId: string | null;
    /**
     * 本局从该点位所属资源组合里抽中的资源项 id（`neutralResourceGroup.id`）。
     * `null` / 缺省 = 这格不是资源点，或资源已被领走（领取是一次性的，靠清空本字段判重）。
    */
    neutralResourceId?: number | null;
    /** 大于 0 时建筑仍在建造，不能产金、产兵或攻击。*/
    constructionRemainingSeconds: number;
    constructionTotalSeconds: number;
    captureOwner: ZCOwner | null;
    /** 当前进攻阵营的控制进度（秒）；阈值和增减倍率来自本局运行时配置。*/
    captureSeconds: number;
}

export interface ZCUnitState {
    neutralReinforcement?: boolean;
    /**
     * 召唤物的到期时刻（秒，同 `chainReadyAt` 的绝对时间基准）；2026-11-18 第 17 批
     * `summon_unit`（舞王 103103「舞王召唤」）。
     *
     * 缺省 `undefined` ⇒ **不过期**，一直活到被打死为止（101404「一人成军」的裁定口径）。
     * 到点由 `ZCGameModel.syncSummons` 收场：置 `dead` + `deathRemoveAt = now`，
     * 同一帧就被 `removeDeadUnits` 摘掉，所以「到期一起消失」不留尸体。
    */
    summonUntil?: number;
    /**
     * 召唤物的本体单位实例 id（不是 unitId）；有值 ⇒ 这个单位是召唤物。
     *
     * 两个作用：① `syncSummons` 每帧把它的位置钉在「本体 + 阵位」上；
     * ② `ZCUnitSystem` 看到它就跳过一切寻路 / 追人分支（召唤物只听本体走）。
     * 本体死了（或找不到）⇒ 召唤物一起收场，否则位置无从算起。
    */
    summonMasterId?: number;
    /**
     * 固定阵位编号 0~3（左上 / 右上 / 左下 / 右下），跟随时按本体朝向镜像摆放。
     * 缺省 `undefined` ⇒ 不钉阵位（101404 那种「放出去自己走」的分身）。
    */
    summonSlot?: number;
    /**
     * 阵位半径（**世界 px**，召唤时按 `summonSlotRadius × combatDistanceScale` 算好存下）。
     *
     * 为什么存进单位而不每帧读配表：`syncSummons` 是每逻辑步都跑的跟随，读一次
     * `skillRuntime[x].get(...)` 换来的只是同一个常数；而且跟随链一旦丢参数（比如本体
     * 换了技能书）就会突然缩到 0、四个舞伴全叠在本体身上。
    */
    summonSlotRadius?: number;
    /**
     * 召唤物的整体半透明度（0~1，表现层用；设计口径「半透明的艺术加工」= 0.5）。
     * 缺省 `undefined` ⇒ 全不透明，既有单位表现逐字不变。
     * 只写视图，不参与任何战斗判定。
    */
    summonAlpha?: number;
    /**
     * 「独立分身」标记（2026-11-19 第 26 批，101404 一人成军的 3/4/6 只分裂菇分身）。
     *
     * 有值 ⇒ 三处「跟随本体」的语义一起取消，按普通单位跑完整状态机：
     *  ① `ZCUnitSystem` 不再短路（自己寻路、追人、出手）；
     *  ② `ZCGameModel.syncSummons` 不再因为本体阵亡而收场（设计口径「血量为 0 才消失」）；
     *  ③ `ZCUnitRegistry.count` 不把它算进 `unitCapPerSide`（设计口径「不加入单位计算数量」）。
     *
     * 缺省 `undefined` ⇒ 舞王舞伴那套（钉阵位、只听本体、本体没了就散）。
     * 🔴 不要靠「有没有 `summonSlot`」来推断：那两件事是正交的，舞伴可以只跟随不钉阵位。
    */
    summonIndependent?: boolean;
    /**
     * 累计普攻制的召唤计数（2026-11-18 第 17 批，101404「一人成军」）。
     *
     * 与 `summonReadyAt` 是**两套触发**、互不干扰：101404 设计写的是「累计普攻 8 次后召唤」，
     * 舞王 103103 是「冷却 12 秒」。共用一格会让「换一张卡就变口径」变成隐性 bug。
     * 记的是 `completedAttackCount` 的**上次快照值**，不是「还剩几次」——
     * 与 `counterFiredCount` / `trapFiredCount` / `barrageFiredCount` 同一口径。
    */
    summonFiredCount?: number;
    /**
     * 怒吼（`roar`，2026-11-18 第 17 批 南瓜战神 102304「大吼大叫」）的下次可用时刻。
     * 与 `chainReadyAt` / `summonReadyAt` 同一套绝对时间基准；不还原就是读档白送一次怒吼。
    */
    roarReadyAt?: number;
    /**
     * 飓风（`storm_zone`，2026-11-18 第 17 批 三叶小丑 102004「飓风」）的下次可用时刻。
     * 同样独占一格：同卡 102001 / 102002 也各占各的冷却，共用会互相拖累。
    */
    stormReadyAt?: number;
    /**
     * 射线集束（`ray_beam`，2026-11-19 科学家 103503）的累计普攻计数。
     *
     * 设计 I 列是「主动-累计普攻 8」⇒ 没有冷却，只有次数，所以不需要 `rayReadyAt`。
     * 记账口径与 `auraFiredCount` / `trapFiredCount` 一致：存 `completedAttackCount` 的
     * **上次快照值**，第一次推进只记基线不补放；被拒不消费次数。
    */
    rayFiredCount?: number;
    /**
     * 由**自己**击杀的单位数（2026-11-18 第 17 批，102204 嗜血术 III 级「友军击杀敌人延长」）。
     *
     * 只在 `ZCDamageResolutionSystem.damageUnit` 里由「打出最后一击的那个人」累加。
     * 反射打死的不计（那条路径没有「谁在打谁」的归属，硬算会把功劳记到挨打的人身上）。
     * 缺省 `undefined` ⇒ 0，不影响任何存量单位。
    */
    killCount?: number;
    /** 团队增益（`team_buff`，102204）在**施法者**身上的冷却截止时刻。*/
    teamBuffReadyAt?: number;
    /** 团队增益的窗口截止时刻（施法者身上）：窗口内每步给半径内友军续状态。*/
    teamBuffWindowEnd?: number;
    /** 团队增益在**受惠者**身上的截止时刻（含击杀延长）；缺省 ⇒ 没被这条技能罩到过。*/
    teamBuffUntil?: number;
    /** 受惠者上一次结账时的 `killCount`；击杀延长的增量就从这里算。*/
    teamBuffKillBase?: number;
    /** 受惠者已经吃到的延长秒数（用于封顶 `teamBuffKillExtendMaxSeconds`）。*/
    teamBuffExtendUsed?: number;
    /** 兵营传送批次的表现时间轴；恢复时继续飞行，不重新扣次数。*/
    portalFlight?: { fromHexId: number; barracksHexId: number; startedAt: number };
    inheritedStats?: Pick<ZCUnitDefinition, 'attack' | 'moveSpeed' | 'attackInterval' | 'attackRange' | 'bodyRadius'>
        & Partial<Pick<ZCUnitDefinition, 'maxHp'>>;
    gateSize?: 'enlarge' | 'shrink';
    gateScale?: number;
    /**
     * 技能驱动的基础体型缩放倍数（1 = 不缩放）。
     *
     * 2026-11-18 第 17 批：由 `ZCGameModel.syncBodyScale` 每帧从
     * 「构筑期 patch + 状态 mods」的 `bodySizePct` 折算写入，只给表现层用
     * （`ZCUnitView` 的本体缩放 / 血条偏移）。**不参与命中判定**——`bodyRadius` 保持原值。
     * 与 `gateScale`（中立资源门的格子效果）是两条独立来源，视图里两者相乘。
     * 缺省 undefined ⇒ 1，等价于既有表现逐字不变。
    */
    bodyScale?: number;
    gateMoveMultiplier?: number;
    gateAttackSpeedMultiplier?: number;
    gateDamageMultiplier?: number;
    gateHpFlat?: number;
    id: number;
    owner: ZCOwner;
    /** 单位 id（= `pvpCard.json` 卡行的 `unitId`，合表后同表自引用），用于查数值与父 Prefab。*/
    unitId: ZCUnitId;
    cardId: string;
    tier: number;
    sourceHexId: number;
    targetHexId: number | null;
    progress: number;
    hp: number;
    maxHp: number;
    /** 领地塔防波次的单位独立攻击倍率；普通单位缺省为 1。*/
    attackMultiplier?: number;
    /** Non-stacking temporary absorption pool granted by shield skills.*/
    shield?: number;
    battleState: ZCUnitBattleState;
    stateTime: number;
    targetUnitId: number | null;
    targetWallHexId: number | null;
    targetBuildingHexId: number | null;
    nextAttackAt: number;
    waitUntil: number;
    attackHitDone: boolean;
    /** 追击状态：离开射程后追击起点的坐标与起始时刻。*/
    chase?: { x: number; y: number; startedAt: number };
    /** 追击脱战后暂时忽略的目标单位 ID 列表。*/
    disengagedUnitIds?: readonly number[];
    /**
     * 本帧是否正在冲刺：纯派生值，每帧先清、只有冲刺推进处置真，不进快照。
     * 只给表现层用，冲刺期间把移动动作换成循环攻击动作；冷却待机期间必须为 false。
    */
    charging?: boolean;
    /**
     * 本次冲刺的终点快照（世界坐标，起冲那一刻从目标身上拍下来）。
     *
     * 2026-11-02 把冲刺从「移速倍率」改成真·撞击：冲刺期间一路直线跑到这个点，
     * 途中不再修正朝向 —— 目标让开就是冲空，不再有「一直追着目标所以必中」。
     * 不拿 `targetUnitId` 每帧现算终点，正是这一条的落地方式；拿现算值就等于没改。
    */
    dashX?: number;
    dashY?: number;
    /**
     * 本次冲刺的截止时刻（秒，绝对时间基准同 `nextAttackAt`）；有值 ⇒ 正在冲刺。
     *
     * 只是一个兜底：正常收场是「撞到人」或「跑到终点」，只有在终点被墙挡住 / 坐标异常
     * 这种极端情况下才会靠超时结束。超时与冲空同责 —— 不结算伤害、冷却照扣。
    */
    dashUntil?: number;
    /**
     * 冲刺收场后的原地待机截止时刻（秒）：冷却从撞上/冲空那一刻起算，不是起冲。
     * 与 `nextAttackAt` 不同，冷却期间不索敌、不挪窝。
    */
    dashRecoverUntil?: number;
    hatredUnitId: number | null;
    hatredUntil: number;
    facingRadians: number;
    deathRemoveAt: number;
    /** 自由直线移动（无索敌直行）：前进方向角；null = 逐格移动（追敌/攻击）*/
    marchAngle: number | null;
    /** 单位的连续实际坐标；状态切换时保留，避免攻击前回退到格子中心。*/
    freeX: number;
    freeY: number;
    /**
     * 已完成的普攻次数；用于 PVP 技能表 empoweredEvery 强化攻击。
     *
     * 2026-10-13 从 `attackCount` 改名：表里 `pvpAttrMap.statId='attackCount'` 指
     * 「一次普攻打几段」（连击段数），与这里的「累计次数」同名不同义。
    */
    completedAttackCount?: number;
    /**
     * 强化技的下次可用时刻（秒，绝对时间基准 = `ZCGameState.elapsedSeconds`）。
     *
     * 只在 `attackProfile.trigger === 'every_seconds'`（按 CD 触发）时使用。首次出手时被初始化为
     * 「出手时刻 + cooldown」，所以开局第一击不会立刻强化；之后每满 `cooldown` 秒，
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
     * 2026-10-29 给「亡者护盾」这类有持续时间的吸收盾用：`shield` 原本只是个数字，
     * 没有到期概念，`applyShieldAura` 的护盾会一直留到被打完。缺省 undefined ⇒ 永不过期，
     * 存量护盾行为不变（由 `ZCSkillTriggerSystem` 每步清理到期的那批）。
    */
    shieldExpireAt?: number;
    /** 连发剩余发数（机关枪）。0 / 缺省 = 没有连发计划。*/
    burstShotsLeft?: number;
    /** 下一发连发的时刻（秒）。*/
    burstNextAt?: number;
    /** 连发间隔（秒）。*/
    burstInterval?: number;
    /** 连发每发的伤害倍率（相对普攻）。*/
    burstDamageRate?: number;
    /**
     * 低血护体上次触发时刻（秒）。用于按 `lowHpCooldown` 判内置冷却；
     * 缺省 = 从未触发（开局即可触发一次）。
    */
    lowHpGuardFiredAt?: number;
    /** 常驻被动状态是否已挂（`passive_status`）；避免每步重复 apply。*/
    passiveStatusApplied?: boolean;
    /**
     * 受击反弹减益：护体生效期间，每次被单位打中就按这个百分比降低攻击者的攻速
     * （格挡 III 的「使攻击者攻击速度降低10%」）。缺省 0 ⇒ 受伤结算里整段不执行。
    */
    retaliateSlowPct?: number;
    /** 受击反弹减益的截止时刻（秒）；与 `retaliateSlowPct` 成对出现。*/
    retaliateUntil?: number;
    /**
     * 冷却型自身施法（`behaviorKey = 'self_cast'`）的下次可用时刻（秒，同 `empoweredReadyAt` 的绝对时间基准）。
     *
     * 2026-10-30「吃口菠萝 / 嗜血 / 迅击」这类不出手的主动：既占不到强化槽（那个给累计普攻的那条），
     * 也占不到副轨（副轨只出扇形伤害），所以由 `ZCSkillTriggerSystem` 按这个时间自己推进。
     * 缺省 undefined ⇒ 首次推进时初始化为「当前 + CD」，开局不立刻放。
    */
    selfCastReadyAt?: number;
    /**
     * 自身光环的下次可用时刻（秒）。`applySelfAura` 按它推进；
     * 缺省 undefined ⇒ 首次推进初始化为「当前 + CD」，开局不立刻放。
    */
    auraReadyAt?: number;
    /**
     * 自身光环（按累计普攻触发，`auraEvery`）上一次触发时的 `completedAttackCount`。
     *
     * 2026-11-11 磁电菇「磁电冲击」101604：累计 8 次普攻放一次冲击波。
     * 与 `auraReadyAt` 是同一条车道的两种口径（二选一），互不干扰。
     * 缺省 undefined ⇒ 第一次推进时只记下当前计数，不立刻放。
    */
    auraFiredCount?: number;
    /**
     * `counter_self_buff` 上一次触发时的 `completedAttackCount`（2026-11-18 第 17 批）。
     *
     * 101904 生命爆发 / 102704 战神附体：累计 N 次普攻给自己开一段限时增益。
     * 与 `auraFiredCount` 同一套算法但**各自一份计数** —— 共用会把「光环刚放过」
     * 当成「增益也放过了」，两条车道互相吃对方的次数。
     * 缺省 undefined ⇒ 第一次推进只记下当前计数，不立刻放（与 `auraFiredCount` 同口径）。
    */
    counterFiredCount?: number;
    /**
     * `trap_place` 走「累计普攻」口径时上一次丢陷阱的 `completedAttackCount`
     * （2026-11-18 第 17 批，毒箭蘑菇「穿甲爆矢」101704）。
     *
     * 101704 的原话是「累计普攻 8 次后朝目标丢出陷阱」—— 不是冷却，所以不能复用
     * `trapReadyAt`。另开一份计数而不复用 `counterFiredCount`：同一张卡既攒自我增益、
     * 又攒陷阱时，共用会让「buff 刚放完」被当成「陷阱也放过了」。
     * 缺省 undefined ⇒ 第一次推进只记下当前计数，不立刻丢（与 `auraFiredCount` 同口径）。
     */
    trapFiredCount?: number;
    /**
     * 五雷轰顶的下次可用时刻（秒），由 `applyBoltStrike` 推进。
     * 缺省 undefined ⇒ 首次初始化为「当前 + CD」。
    */
    boltReadyAt?: number;
    /**
     * 精密陷阱的下次可用时刻（秒）：放下就不管的一次性布置，单独一条车道。
     * 缺省 undefined ⇒ 首次初始化为「当前 + CD」。
    */
    trapReadyAt?: number;
    /**
     * 闪电链的下次可用时刻（秒），由 `ZCSkillTriggerSystem.applyChainLightning` 推进。
     * 缺省 undefined ⇒ 首次初始化为「当前 + CD」（与 `boltReadyAt` / `trapReadyAt` 同口径）。
     * 单独一个字段而不复用 `boltReadyAt`：雷蕉同一张卡上还挂着 102204 嗜血术，
     * 共用会让「闪电链放完」把嗜血术一起送进冷却。
    */
    chainReadyAt?: number;
    /**
     * 召唤（`summon_unit`）的下次可用时刻（秒），由 `ZCSkillTriggerSystem.applySummonUnit` 推进。
     *
     * 2026-11-18 第 17 批 舞王 103103「舞王召唤」。单独一个字段：艺术家 68031 这张卡上
     * 还挂着 103104「迪斯科旋风」，共用槽位会变成「召完舞伴，旋风也进冷却」。
     * 缺省 undefined ⇒ 首次初始化为「当前 + CD」，开局不立刻召。
    */
    summonReadyAt?: number;
    /**
     * 施法动作窗口截止时刻（秒）：主动技能放出的那一刻写 now + ZC_SKILL_CAST_ACTION_SECONDS，
     * 表现层据此把片段换成攻击动作。只管播哪一段，不挡移动与攻击。
    */
    castActionUntil?: number;
    /**
     * 原地施法锁截止时刻（秒）：只有 buff 类（`self_cast`）才写，锁定期内单位原地站住，
     * 射程内有目标照样出拳。缺省 undefined ⇒ 不锁。
    */
    castHoldUntil?: number;
    /** 多点打击（`behaviorKey = 'random_strike'`，按 CD 触发）的下次可用时刻（秒）。*/
    strikeReadyAt?: number;
    /**
     * 多点打击（按累计普攻触发）上一次触发时的 `completedAttackCount`。
     * 缺省 undefined ⇒ 第一次推进时只记下当前计数，不立刻打一波。
    */
    strikeFiredCount?: number;
    /** 多点打击的持续窗口结束时刻（秒）；配了 `strikeSeconds` 才会有。*/
    strikeUntil?: number;
    /** 持续窗口内下一波的时刻（秒）。*/
    strikeNextAt?: number;
    /**
     * 多点打击打空后的下次重试时刻（秒）：退避 0.2s 并按 unit.id 错峰，避免多枚导弹齐射。
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
     * 孢爆箭 / 孢子凝珠（`behaviorKey = 'splash_shot' / 'spore_burst'`，101303 / 101104）的
     * 下次可用时刻（秒）。
     *
     * 与 `selfCastReadyAt` / `boltReadyAt` / `blinkReadyAt` 同一套「绝对时刻」口径；
     * 缺省 undefined ⇒ 首次推进时初始化为「当前 + CD」，开局不立刻放。
     * 🔴 单独一条车道而不是复用 `strikeReadyAt`：同一张卡上「多点打击」与「射一发会爆的弹」
     * 可能同时存在，共用槽位会互相把对方的冷却顶掉。
    */
    splashReadyAt?: number;
    /**
     * 菌毯爆发 / 菌核爆裂（`behaviorKey = 'burst_aura' / 'burst_knockback'`，101504 / 101804）的
     * 下次可用时刻（秒）。
     *
     * 与 `splashReadyAt` 同一套「绝对时刻」口径，但仍是**独立的一格**：这两条与
     * 「射一发会爆的弹」可以落在同一张卡上（配表允许），共用一个槽位会互相把对方的冷却顶掉。
     * 两条行为键共用这一格 —— 它们的机制是同一件事（自心圆一次性爆发），只差爆完加什么。
    */
    burstReadyAt?: number;
    /**
     * 毒液喷吐（诅咒菇 101803，2026-11-18 第 17 批）的下次可用时刻。
     *
     * 与 `burstReadyAt` 分开：同一张卡同时挂着菌核爆裂 101804，共用一个字段会变成
     * 「爆完这个、那个也进冷却」。缺省 undefined ⇒ 首次初始化为「当前 + CD」。
    */
    venomReadyAt?: number;
    /**
     * 菌丝绞杀（`behaviorKey = 'fan_slow'`，101503）的下次可用时刻（秒）。
     *
     * 与 `secondaryReadyAt` 分开：那条是**副轨**（半径按普攻射程 ×倍率、无人数上限、可击退），
     * 这条是**主动计划行**（半径取表值 150、最多 4/5/6 人、带减速）。
     * 同一张卡（机甲菇 68015）现在有四条独立 CD：`secondary` / `burst` / `fan` / `strike`，
     * 共用一格就会互相顶掉冷却。
    */
    fanReadyAt?: number;
    /**
     * 菌丝突刺（`behaviorKey = 'single_strike'`，101403）的下次可用时刻（秒）。
     *
     * 与 `blinkReadyAt` 分开：那条是魔术师 103404「移形换影」（往返 / 分身 / 搜索半径封顶），
     * 这条是分裂菇 101403「突进单体 + 眩晕」。两条都可能出现在同一场对局的不同单位上，
     * 共用一个槽位在换卡 / 复用同一 `ZCUnitState` 形状时会互相干扰。
    */
    singleReadyAt?: number;
    /**
     * 菌盾冲锋（`behaviorKey = 'charge_shield'`，101204）的下次可用时刻（秒）。
     *
     * 与 `dashReadyAt` 分开：两条都是「位移 + 线段命中」，但一条是定长 1 格 + 自护盾、
     * 一条是朝最近敌人 / 面朝往前冲 + 眩晕或易伤。虽然当前没有任何一支部队同时带两条，
     * 但 `unit.*ReadyAt` 是「一条车道一格」的口径（同卡多主动共存是这个项目的常态），
     * 共用会在换卡 / 复用同一 `ZCUnitState` 形状时互相顶掉冷却。
    */
    chargeReadyAt?: number;
    /**
     * 冲锋 / 尖刺冲锋（`behaviorKey = 'legacy_dash'`，102303 / 102703）的下次可用时刻（秒）。
     *
     * 两条技能共用一个槽位是有意的：它们的行为键相同、结算骨架相同，
     * 只是参数（选向 / 命中状态 / 自保）不同 —— 同一条车道就该共用一格 CD。
    */
    dashReadyAt?: number;
    /**
     * 孢爆箭（`behaviorKey = 'wind_bolt'`，101303）的下次可用时刻（秒）。
     *
     * 与 `splashReadyAt` 分开：同一张卡（风炮菇 68013）此前那条「射一发会爆的弹」就占着
     * 那一格，而本批把 101303 改成了「风弹 + 命中点留飓风」——
     * 若继续共用，同一张卡上再出现一条 `splash_shot` 时会互相顶掉冷却。
    */
    windReadyAt?: number;
    /**
     * 连射导弹（`behaviorKey = 'missile_barrage'`，101304）上一次触发时的 `completedAttackCount`。
     *
     * 这条车道按「累计 N 次普攻」触发（同 `auraFiredCount` / `strikeFiredCount`），没有 CD。
     * 单独一格：风炮菇同一张卡上可能同时有按次数触发的另一条车道，共用会互相吃掉计数。
    */
    barrageFiredCount?: number;
    /**
     * 连射导弹「这一轮还剩几颗没发」+「下一颗的时刻」。
     *
     * 一轮 3 颗按 0/0.4/0.8s 错峰，与 `burstShotsLeft` / `burstNextAt`（普攻连发）同一套算法。
     * 为什么不把三颗弹体的 `startedAt` 直接排到未来：快照校验要求
     * `startedAt <= elapsedSeconds`，排未来的弹体过不了校验；而且「每颗按当时的目标重算落点」
     * 本来就需要逐颗出手。发完 `delete` 掉，回到 `undefined`。
    */
    barrageShotsLeft?: number;
    barrageNextAt?: number;
    /**
     * 分身的爆炸时刻（秒）；`blinkCloneX/Y` 是爆炸点（施法时的原位）。
     *
     * 为什么要单独记坐标：分身是「留在原地」的，本体闪现回来之后还会继续跑位，
     * 拿 `unit.freeX/freeY` 当爆炸点会跟着本体漂走 —— 那就不是分身了。
    */
    blinkCloneAt?: number;
    blinkCloneX?: number;
    blinkCloneY?: number;
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

/** 逻辑层产生、视图层只读消费的短生命周期战斗表现事件。*/
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
     * 定格光束：命中后的余韵，长度不再变化，只负责淡出。
     * `from`/`to` 是出手点与命中点，`durationSeconds` 是淡出秒数；不结算伤害、不参与判定。
    */
    beamHold?: boolean;
    /**
     * 出现时由小长大的时长（秒）；缺省 undefined ⇒ 不生长，直接是 prefab 烘焙大小。
     * `combatEvents` 不进存档，加字段不影响兼容。
    */
    growSeconds?: number;
    /**
     * 入场生长的**起始占比**（0~1，2026-11-20 第 28 批 102004 飓风）。
     *
     * `growSeconds` 那条缓动在 t = 0 时是 0，只能表达「从看不见长到满」；「出生就是 10%、
     * 边飞边长大」得靠这一格补起点。视图合成 `growFrom + (1-growFrom) × ease(t)`，
     * 缺省 `undefined` ⇒ 当成 0（= 老口径）。`combatEvents` 不进存档，加字段不影响兼容。
    */
    growFrom?: number;
    /**
     * 这条特效要播的骨架动画名（如 `move` / `attack`）。
     * 名字跟着事件走，阶段判断留在模型；缺省 undefined ⇒ 保留预制体默认动画。
    */
    spineAnimation?: string;
    /**
     * 是否点亮预制体里的「叠加层」子节点（火船只在提速段烧起来）。
     * 模型只说该不该亮，具体节点由 `zcCombatEffectOverlayChild` 决定。
     * 缺省 undefined ⇒ 不改预制体自身状态。
    */
    overlayFx?: boolean;
    /**
     * 这条特效的朝向（度，逆时针，0 = 朝 +x）。`area` 事件起终点相同，视图算不出方向，
     * 只能由模型把施法那一刻的方位角带过来；缺省 undefined ⇒ 保持 0°。
    */
    angleDegrees?: number;
    /**
     * 特效整体竖直抬升（屏上 px）：单位根节点是逻辑脚点，不抬会有一半埋在地面线下。
     * 缺省 undefined ⇒ 不抬。
    */
    visualLiftPx?: number;
    /**
     * 这条特效的整体尺寸倍率（一次性范围爆发用）；缺省 undefined ⇒ 1，全部既有特效逐字不变。
     *
     * 为什么不能靠 `radius`：`ZCCombatEffectView` 从不按 `event.radius` 缩放，而
     * `普攻爆炸` 这一个 prefab 被普攻命中 / 孢爆箭溅射 / 两条爆发共用 ⇒ 也没法给路径登记
     * 全局倍率（会把别人的爆炸一起放大）。`combatEvents` 不进存档，加字段不影响兼容。
    */
    effectScale?: number;
    /**
     * 整体透明度（0~1，`1` = 原色）；缺省 undefined ⇒ 全不透明，既有特效逐字不变。
     *
     * 2026-11-18 第 17 批闪电链 102203（设计案 O 列「逐跳降透明度」）：同一条链的多跳
     * 是**同一份 prefab**，不靠这个字段就分不出「刚起跳」和「传到第六跳」。
     * 视图走宿主节点的 `UIOpacity` 级联整棵子树（与光束淡出同一条通道），
     * 逐层改 `Sprite.color` 会漏掉亮芯/柔光里的某一层。
     */
    effectAlpha?: number;
    /**
     * 起点的跟随锚（单位实例 id）：有它 ⇒ 模型**每帧**把 `fromX/fromY` 重写成这个单位的当前位置。
     *
     * 2026-11-19 第 21 批闪电链 102203（用户原话「释放端的卡牌静止不动，敌人移动，
     * 技能尾端会跟随旋转或伸缩」）：电弧是 `area` 事件，坐标写一次就定死 —— 目标一转身，
     * 电弧的尾巴就留在原地。想让「弧跟着人走」只有两条路：要么每帧新建事件（会把
     * `nextCombatEventId` 打爆、也别想淡出），要么让事件自己长着眼睛。
     * 缺省 undefined ⇒ 所有既有特效的坐标仍然只由施法那一刻决定，逐字不变。
     */
    followFromUnitId?: number | null;
    /**
     * 终点的跟随锚（单位实例 id）：与 `followFromUnitId` 成对使用。
     * 只有一端有锚时，另一端保持施法那一刻的坐标（「钉住一端、另一端摆」也是合法用法）。
     */
    followToUnitId?: number | null;
    /**
     * 一条长链路被切成 `followPieceCount` 段时，本条是第几段（0 起）。
     * 每帧按「起点 + 单段位移 × 本段序号」重算位置 ⇒ 两端一起动时整条链仍然首尾相接。
     * 缺省 undefined ⇒ 视为 0（本来就只有一个锚点）。
     */
    followPieceIndex?: number;
    /** 一条长链路被切成几段；缺省 undefined ⇒ 1。见 `followPieceIndex`。*/
    followPieceCount?: number;
    /**
     * **只沿长轴**的缩放倍率（1 = 原长）；缺省 undefined ⇒ 等比，逐字不变。
     *
     * 与 `effectScale` 的分工：`effectScale` 是等比的（视图 `node.setScale`），拿它把一段
     * 闪电拉长会把**粗细**一起拉粗。这条链路要的是「长度不够就摊薄到刚好够」——
     * 预制体长轴 = 本地 +y、锚点在底端 ⇒ `scaleY` 单独乘这个倍率，`scaleX` 原样不动。
     * 2026-11-19 第 21 批闪电链（用户原话「可以拉伸特效或者复制多个节点（复制后压缩）」）：
     * 段数还是 `ceil(段距 / 单段长度)`，但每段压到 `段距 / 段数`，末段正好落在目标中心，
     * 既不缺口、也不越过目标半段。
     */
    stretchAlongAxis?: number;
}

/** 在途弹道属于可恢复的战斗状态，碰撞后才产生伤害。坐标均为棋盘逻辑坐标。*/
export interface ZCProjectileState extends ZCCombatEvent {
    type: 'projectile';
    targetKind: ZCCombatTargetKind;
    targetId: number;
    sourceCardId: string;
    /** 出手时的攻击属性；克制系数在命中实际目标时计算。*/
    baseDamage: number;
    x: number;
    y: number;
    previousX: number;
    previousY: number;
    velocityX: number;
    velocityY: number;
    collisionRadius: number;
    /**
     * 弹体体积倍率（2026-11-17 磁电菇「巨囊弹体」101602）：视图按它缩放弹体节点。
     *
     * 与 `collisionRadius` 是**同一件事的两面** —— 出手时已经把这个倍率乘进判定半径了，
     * 这里只是把同一个数值带给表现层，让「看着变大」与「真的更容易擦到」同步。
     * 缺省 1 ⇒ 所有既有弹道逐字不变。
    */
    sizeScale?: number;
    canHitAir: boolean;
    /** 命中后在落点创建持续区域（火船/风龙：投射物飞过去命中后才烧）。*/
    zoneDuration?: number;
    zoneWaves?: number;
    zoneSlow?: number;
    /** Damage used by the persistent zone created at impact; separate from collision damage.*/
    zoneDamage?: number;
    /** Number of additional enemy units this projectile may pass through after its first hit.*/
    remainingPierces?: number;
    /**
     * 每次穿透后剩余伤害的相对衰减（0.2 = 每穿一人降 20%，2026-10-30 玉林好汉「精英猎手」）。
     *
     * 缺省 0 ⇒ 不衰减，行为与改动前逐字一致；衰减就地乘在 `baseDamage` 上，
     * 因为命中结算（`resolveProjectileHit`）与溅射都只从 `baseDamage` 现算。
    */
    pierceFalloff?: number;
    /** Units already hit by this projectile; persisted so restore cannot hit the same unit twice.*/
    hitUnitIds?: number[];
    /**
     * 「穿过己方单位回血」（2026-11-17 急冻瓜「贯穿滋养」102401）的单次回复比例。
     *
     * 值就是比例本身（`0.03` = 回复该单位最大生命的 3%），出手时从
     * `skillParamJson.allyPierceHealPct` 拷一份到弹道上 —— 弹道在途时施法者可能已经死了，
     * 结算不该再回头查技能运行时。
     * 缺省 / ≤0 ⇒ 这条弹道不治疗友军，存量弹道逐字不变。
    */
    allyHealPct?: number;
    /**
     * 这一颗弹道还能治疗几个己方单位（3 / 4 / 5）。
     *
     * 与 `allyHealPct` 一起拷进来，每次治疗自减一次，归零后不再触发 ——
     * 「一颗子弹最多给 N 个己方单位回复」就是靠这个计数器实现的，它是**每颗弹道**的额度，
     * 不是每张卡的额度（多发弹幕的每一颗各算各的）。
    */
    allyHealLeft?: number;
    /** 已经被这颗弹道治疗过的己方单位 id（同一颗子弹对同一个单位只回一次）。*/
    allyHealIds?: number[];
    /** Empowered-hit execute chance in the normalized 0..1 range.*/
    executeChance?: number;
    /** Critical is rolled when the projectile is launched and must survive snapshot restore.*/
    criticalHit?: boolean;
    /** 命中单位后施加的状态 id（出手时随 profile 快照，避免命中时再查表）。*/
    onHitStatusId?: string;
    /** Formula buff results are snapshotted at launch so restore does not reroll conditions.*/
    legacyBuffs?: ZCLegacyBuffApplication[];
    /** Old skillEffect `伤害范围`, already converted to board units.*/
    splashRadius?: number;
    /**
     * 溅射伤害比例（2026-10-30「爆囊扩散」100802/100902/103202）。
     *
     * 旧技能表的溅射一律按全额 `baseDamage` 结算（`splashRadius` 有值就全套用），
     * 而新被动要的是「命中对周围造成 30/40/50% 溅射」——倍率和半径是两件事。
     * 缺省 1 ⇒ 既有溅射（旧 skillEffect）逐字不变。
    */
    splashDamageRate?: number;
    /**
     * 溅射的「多目标递减」系数（2026-11-14 口径：普攻衍生的溅射必须随目标数递减）。
     *
     * 旁溅目标按**距离由近到远**排序，第 n 个（n 从 0 计）伤害
     * = 直击伤害 × `splashDamageRate` × `(1 - splashFalloff)^n`。
     * 缺省 0 ⇒ 每个旁溅目标同额，存量溅射（旧 skillEffect 全额溅射）逐字不变。
    */
    splashFalloff?: number;
    /**
     * 命中后（或到点后）播放的爆炸特效路径（镭射飞龙「追踪导弹」101003）。
     *
     * 与弹道本身的 `effectPrefabPath`（飞行段的弹体）是两个 prefab：
     * 弹体飞到头 / 撞到人那一刻，视图按这个路径换播爆炸（`镭射飞龙_导弹技能命中`）。
     * 缺省 ⇒ 与既有弹道一致，只把 `effectPrefabPath` 那一个特效播到底。
    */
    impactEffectPrefabPath?: string | null;
    /**
     * 命中后爆炸的判定半径（世界 px，出手时已乘 combatDistanceScale），
     * 以命中点为圆心把包括主目标在内的敌人各打一次。与 `splashRadius` 的溅射是两件事。
     * 缺省 0/undefined ⇒ 不执行。
    */
    burstRadius?: number;
    /** 爆炸瞬间那一下的伤害（出手时按 `impactBurstDamageRate` 算好，含暴击）。*/
    burstDamage?: number;
    /**
     * 第二段爆炸伤害（设计案：「爆炸开始后第 26 帧造成 1 次伤害」）。
     *
     * 缺省 `undefined` ⇒ 只有一段爆炸。有值时按 `burstSecondDelay` 在命中点补一轮。
    */
    burstSecondDamage?: number;
    /** 第二段爆炸的延迟秒数（缺省 0 = 与第一段同时）。第 26 帧 @30fps ⇒ 0.8333。*/
    burstSecondDelay?: number;
    /** 爆炸表现的时长（秒）。缺省 ⇒ 沿用命中特效的 0.5s。用于活够整段序列帧动画。*/
    burstEffectSeconds?: number;
    /** 弧线飞行：出手点到目标点之间的中段最大横向偏移（世界坐标，缺省 0 = 直线）。*/
    arcOffset?: number;
    /**
     * 飞行途中**不碰任何东西**（2026-11-18 第 16 批「连射导弹」101304）。
     *
     * 设计原话：「炸弹只有达到落点才会爆炸，行径过程不会提前触碰其他目标」。
     * 打开后 `ZCProjectileSystem` 整段跳过扫掠（单位与墙体/建筑都不收），
     * 只按速度推进到 `durationSeconds` 结束，再由 `explodeOnArrival` 在落点引爆。
     * 缺省 `undefined` ⇒ 存量弹道逐字不变（撞到谁就结算给谁）。
    */
    ignoresMidAirCollision?: boolean;
    /**
     * 到点（`startedAt + durationSeconds`）引爆，而不是「命中才炸」。
     *
     * 与 `ignoresMidAirCollision` 配对使用：让 `ZCProjectileSystem` 在弹体自然飞完那一刻
     * 回调 `context.arrive`（转给 `ZCAttackResolutionSystem.resolveProjectileArrival`）。
     * 缺省 ⇒ 飞完就是消失，与存量「打空续飞」一致。
    */
    explodeOnArrival?: boolean;
    /** 落点爆炸的判定半径（世界 px，出手时已乘 `combatDistanceScale`）。*/
    arriveRadius?: number;
    /** 落点爆炸对半径内每个敌人的伤害（出手时算好，逐目标再乘克制）。*/
    arriveDamage?: number;
    /**
     * 命中点留下的持续区域（2026-11-18 第 16 批「孢爆箭」101303 的飓风）。
     *
     * 四个字段是一组，`hurricaneRadius > 0` 即视为要留一块区域：
     * 半径（世界 px）/ 存活秒 / 每次接触伤害 / 表现路径。
     * 区域本身走 `ZCGroundZoneSystem`：`hitOncePerUnit` 保证同一敌人只挨一次。
     * 缺省 ⇒ 命中即结束，存量弹道不变。
    */
    hurricaneRadius?: number;
    hurricaneSeconds?: number;
    hurricaneDamage?: number;
    hurricanePrefabPath?: string | null;
    /**
     * 命中/到点爆炸特效（`impactEffectPrefabPath`）的事件级尺寸倍率。
     *
     * 同一份 prefab 被两条技能以不同半径复用时只能走这一格（路径级倍率是全局的）：
     * 镭射飞龙那条按「半径 80 逻辑 px」标定，连射导弹这条是 180 ⇒ 2.25。
     * 缺省 `undefined` ⇒ 按 1（存量导弹逐字不变）。
    */
    impactEffectScale?: number;
}

/**
 * 逻辑层产生、视图层只读消费的飘字（Old Client 战斗文本 / 金币增长）。
 *
 * 和 `damageStats` 一样刻意不写进 ZCSnapshot：这是本局生命周期内的瞬时表现，
 * 混进快照会牵动 `version` 与存档兼容，收益不成正比。
*/
export interface ZCFloatText {
    id: number;
    kind: ZCFloatTextKind;
    /** 造成伤害 / 获得金币的一方；用于归属、筛选和后续阵营表现扩展。*/
    owner: ZCOwner;
    /**
     * 「**本机席位**的卡牌被扣血」这一种伤害飘字（2026-11-20 用户）：
     * 染色走红、数值前面带负号（`-5`）。缺省 ⇒ 白字，表示我方打出去的伤害。
     *
     * 🔴 攻方是谁**不影响**这个标记：被另一个玩家打、被 NPC 打，都是同一个样式
     * （红字、无前缀、只有 `-血量`）。字段名里的 `FromPlayer` 是历史叫法，
     * 语义已经收敛成「我方被扣血」—— 别按名字理解成只认玩家。
     *
     * 由模型按两端席位判定（`ZCGameModel.floatTextToneOf`），视图不自己猜：
     * 视图只拿到 `owner`（攻方），判不出被打的那张卡是不是本机的。
     */
    takenFromPlayer?: true;
    /**
     * 「这一条伤害是玩家席位打出去的」⇒ 才允许带 `暴击 / 克制 / 抵抗 / 秒杀` 前缀
     * （2026-11-20 用户口径）。
     *
     * 🔴 前缀是**我方战果**的标记，不是伤害本身的属性：
     *   · 我方对别人造成伤害 ⇒ 带前缀（暴击 / 克制 / 抵抗 / 秒杀）；
     *   · 我方被扣血 —— 被另一个玩家打、被 NPC 打都算 —— **只有「负号 + 血量」**。
     * 反例就是踩过的坑：塔防局里整局都是 NPC 在打我方卡，按 `kind` 直接出前缀的话，
     * 屏幕上每一下都挂一个【克制】【暴击】，数字反而读不出来。
     *
     * 由模型按攻方席位判定（`ZCGameModel.damageUnit`），视图不自己猜：
     * 视图只拿到 `owner`（攻方），判不出 `npcOwners` 里谁是 NPC。
     */
    dealtByPlayer?: true;
    /** 实际结算数值；MISS 为 0，其余类型为正整数。*/
    value: number;
    /**
     * 这条飘字**实际打掉的血量**（不含 `value` 上的展示偏移）。
     *
     * 只有需要「事后合并」的场景才写：`tryExecuteUnit` 会先把刚排队的那条普通伤害
     * 撤销（`removeFloatText` 拿回它的真实伤害），再并进一条 `execute` 秒杀飘字 ——
     * 撤销时读的就是这个字段，读 `value` 会把 `floatTextValueOffset` 一起算进去。
     */
    appliedDamage?: number;
    /** 飘字锚点的逻辑坐标（受击目标 / 产出金币的建筑 / 阵亡单位）。*/
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 受击特效的锚点语义：打在单位 / 城墙 / 建筑上。模型只透传语义，
 * 屏上偏移（建筑图比格心高 15.65px 等）由视图的 `zcHitFxSurfaceLiftY` 决定。
*/
export type ZCHitFxSurface = 'unit' | 'building' | 'wall';

/**
 * 受击特效展示项，与 `ZCFloatText` 同口径：不进快照，模型管队列与过期，视图按时间回收。
 * `trait` 是攻击方职业（不是被打方），对应 `ZCAttackTrait` 与美术的四组目录。
*/
export interface ZCHitFx {
    id: number;
    /** 攻击方攻击职业；渲染层用它选 `受击特效/<trait>受击/<trait>受击` 的 prefab。*/
    trait: ZCAttackTrait;
    /**
     * 被打一方的归属；预留给「只给敌对伤害播闪白」这类阵营过滤（当前不筛）。
     * 结构物（城墙 / 建筑）这边取 `hex.owner`，可能是 `'neutral'` ⇒ 用 {@link ZCFaction}。
    */
    owner: ZCFaction;
    /**
     * 打在什么上（2026-11-06 需求：建筑 / 城墙受击也要播攻击方职业的受击特效）。
     *
     * 视图按它决定锚点补偿：`unit` / `wall` 就是格心，`building` 要抬到建筑图的中心
     * （`ZCGameHex.prefab` 的 `BuildingIcon` 在 +15.65px）。
    */
    surface: ZCHitFxSurface;
    /**
     * 被打那一方的模型等比缩放（`pvpCard` / `monsterCard` 的 `prefabSize`，基准 1），
     * 受击特效按它跟体型走。放在受击方而不是攻击方：闪白贴在被打的身体上，与谁打的无直接关系。
    */
    targetScale: number;
    /** 特效锚点的世界坐标（=被打单位当前插值位置，与飘字同源）。*/
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 「抽到卡牌」小卡牌展示项，与 `ZCFloatText` 同口径：不进快照，模型管队列与过期。
 * 不带美术资源名，建筑图由渲染层按 `cardId -> buildIcon` 解析。
*/
export interface ZCCardReveal {
    monsterClaim?: boolean;
    id: number;
    /** 抽中的卡牌 id；渲染层据此读取卡表里的 buildIcon。*/
    cardId: string;
    /** 抽到这张卡的一方；目前双方对称展示（与飘字一致）。*/
    owner: ZCOwner;
    /** 该卡落地成的建筑类型，决定卡面用哪张建筑图。*/
    building: ZCBuildingType;
    /** 建筑品级 1..4（绿蓝紫金），决定卡框与品级名颜色。*/
    tier: number;
    /** 卡名（卡表 `name`），如「精灵弓箭手」。*/
    cardName: string;
    /**
     * 该卡产出的兵种 id（`pvpCard.unitId`），卡面立绘按它取兵种的 idle 图。
     *
     * 金矿 / 主城 / 防御塔这类没有产出兵种的卡留 `null`，卡面回退到建筑图。
    */
    unitId: string | null;
    /**
     * 问号地块（`all-random`）翻出时的运气评语（见 `ZC_LUCK_TEXTS`）。
     *
     * 非空时视图把上方 `LuckSprite` 切成对应品级的评语切图；确定地块（兵营/金矿）
     * 结果明摆着，这里放空串，上方那行就不显示。
    */
    luckText: string;
    /** 卡牌弹出的锚点格；视图默认把卡牌压在格心上（`ZCCardRevealView.offsetY` 可调）。*/
    hexId: number;
    /** 锚点格的逻辑坐标；视图直接消费，不必再回查地图配置。*/
    x: number;
    y: number;
    /**
     * 卡牌起点（秒）。
     *
     * 落地那一刻还不是卡牌的起点：地块先播点击动画 —— 脉冲水波纹与原地缩没
     * 并发（同起同收，宽 `ZC_CARD_START_SECONDS`）—— 卡牌要等它播完才弹。
     * 所以这里存的是「点击动画结束」的时刻，推后于开发事件本身。
    */
    startedAt: number;
    durationSeconds: number;
}

/**
 * 开发成功时的地块激活表现事件（纯表现，不进快照，口径同 `ZCCardReveal`）。
 * 轴上是「脉冲 ∥ 缩没 → 卡牌」，总长 `ZC_HEX_ACTIVATION_SECONDS` = 0.7 + 1.156 = 1.856s；
 * 建筑在卡牌淡出窗内长完，不单独占段。进度按 `startedAt / durationSeconds` 每帧算。
*/
export interface ZCHexActivation {
    id: number;
    /** 被激活的地块（开发成功、已落定建筑的那一格）。*/
    hexId: number;
    /**
     * 这次开发是否跟着一条卡牌揭示（`pushCardReveal`）—— 即抽到的卡是否落在格子上。
     *
     * 它决定「收场段之后」怎么接：有卡牌时整格隐藏、让卡牌独占视线；
     * 抽空 / 抽到不能建的卡时没有卡牌，再隐藏就是「格子凭空消失、露出棋盘底」。
     * 全类型随机问号格的 `empty` 权重是 0.7（七成空手），所以这条路走得很多。
    */
    hasCardReveal: boolean;
    /**
     * 本次开发抽到的卡牌品阶（1 绿 / 2 蓝 / 3 紫 / 4 金；`0` = 没抽到卡）。
     *
     * 2026-10-19 用户口径：脉冲序列帧「整体颜色根据对应获得的卡牌品阶」上色，
     * 没抽到卡时按绿（1 档）走。它只影响脉冲那一层的染色，与「有没有卡牌揭示」是两件事：
     * 抽到卡但建不上（`!result.building`）时仍有品阶、没有揭示。
    */
    cardRarity: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 建筑「该抖一下了」的一次性通知，产兵与产金两个来源共用。
 * 只带 hexId：曲线真源在 `ZCGameViewUtil`，起点由渲染层收走那一拍的时钟落定。
 * 取走即空、不参与 prune（抖动不幂等，重复消费会重头播）。
*/
export interface ZCBuildingShake {
    id: number;
    /** 抖动的那一格（主城 / 金矿 / 兵营）。*/
    hexId: number;
}

/**
 * 建筑被摧毁的一次性通知：HP 归零那一拍由模型显式发出，渲染层据此播白烟雾爆炸。
 * 与 `ZCBuildingShake` 同型，只带 hexId，取走即空。
*/
export interface ZCBuildingDestruction {
    id: number;
    /** 被摧毁建筑所在的那一格。*/
    hexId: number;
}

/**
 * 中立资源被领取的一次性表现通知：发奖那一拍由模型发出，快照里已看不到领取信息。
 * 与 `ZCFloatText` 同口径，不进快照；时长真源在 `ZCBattlePresentationQueue`。
*/
export interface ZCNeutralReward {
    id: number;
    /** 被领取的那一格。*/
    hexId: number;
    /** 领取的资源项 id（`neutralResourceGroup.id`）；视图据此判「金币飞行 / 神器飞行 / 不出特效」。*/
    itemId: number;
    /** 领取的一方；非玩家领取不播「飞向 HUD」的特效（目标不在玩家界面上）。*/
    owner: ZCOwner;
    /** 实际入账的金币；> 0 时视图播「金币飞向金币栏 + 上飘 +N」。*/
    gold: number;
    /** 实际入账的神器充能；> 0 时视图播「神器飞向神器栏」。*/
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
    /** 冻结配置版本；旧 version 4 存档缺省为 legacy。*/
    configHash?: string;
    elapsedSeconds: number;
    /** 尚未推进的固定步长余量；旧 version 4 存档默认为 0。*/
    pendingSeconds?: number;
    /** 实际已出塔防波数；旧存档缺省时按配置时间推导。*/
    nextDefenceWaveIndex?: number;
    durationSeconds: number;
    playerGold: number;
    enemyGold: number;
    /** 各席位独立金币；player/enemy 同步保留上面两个旧字段，兼容既有 UI 与 version 4 存档。*/
    goldByOwner?: OwnerNumberRecord;
    /** 已完成充能、当前可以储存并释放的神器次数。*/
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
    /** 独立的状态实例快照；旧 version 4 存档缺省为空。*/
    statusEffects?: ZCStatusSystemSnapshot;
    /** 持续区域（暴风雪类 area 技能）；缺省 = 空。*/
    groundZones: ZCGroundZoneState[];
    /**
     * 排队中的召唤物（2026-11-20 第 33 批 101404 分裂菇的「0.1s 间隔 + 先特效后出现」）。
     *
     * 必须进快照：这 0.6~0.9s 是**真状态**，不是表现 —— 重连 / 读档时丢掉队列，
     * 玩家会白丢 6 只分身（累计普攻的次数已经消费掉了）。旧存档缺省 = 空。
     */
    pendingSummons?: IZCPendingSummon[];
}

/**
 * 一个「还没出生」的召唤物（2026-11-20 第 33 批，101404 分裂菇 68014「一人成军」）。
 *
 * 为什么不是「先召出来再隐藏」：隐藏的单位仍是合法目标 —— 会被看不见的东西挨打、
 * 也会自己往敌人方向走开，等到该出现时它已经不在那个坐标上了。所以真正推迟的是
 * `spawnUnit`，队列里只留「出生需要的一切」，到点按原样重建。
 *
 * 两个时刻分开存（`fxAtSeconds` / `spawnAtSeconds`）：先播特效、再出现，中间那 0.32s
 * 的间隔是设计口径的一部分，不是渲染延迟。
 */
export interface IZCPendingSummon {
    /** 这一只播「生成」特效的时刻（秒，`elapsedSeconds` 基准）。*/
    fxAtSeconds: number;
    /** 这一只真正出生的时刻（秒）= `fxAtSeconds + 出现延迟`。*/
    spawnAtSeconds: number;
    /** 特效是否已经推给视图（同一条只推一次）。*/
    fxPlayed?: boolean;
    owner: ZCOwner;
    cardId: string;
    tier: number;
    sourceHexId: number;
    /** 本体（施法者）的实例 id，只给日志与「谁召的」追溯用，出生不依赖它还活着。*/
    masterId: number;
    /** 召唤技能本身（事件与日志用）。*/
    skillId: number;
    skillName: string;
    /** 出生坐标（逻辑 px，已经散落在以本体为圆心的圆内）。*/
    x: number;
    y: number;
    /** 继承后的属性：施法那一刻算好，本体中途阵亡也不影响这几只。*/
    maxHp: number;
    attack: number;
    moveSpeed: number;
    attackInterval: number;
    attackRange: number;
    bodyRadius: number;
    /** 到期时刻（秒）；缺省 = 到战死（独立分身的裁定口径）。*/
    summonUntil?: number;
    /** 半透明度（0~1）；缺省 = 不透明。*/
    summonAlpha?: number;
    summonIndependent?: boolean;
}

/**
 * 持续伤害区域（暴风雪类 area 技能）：在目标点停留若干秒，分波造成范围伤害并减速。
 * 坐标是棋盘逻辑坐标；每波间隔 = durationSeconds / waves。
*/
export interface ZCGroundZoneState {
    x: number;
    y: number;
    radius: number;
    /** 施术者阵营；只对敌方单位造成伤害与减速。*/
    owner: ZCOwner;
    sourceUnitId: number;
    skillId: number;
    skillName: string;
    effectPrefabPath?: string | null;
    /** 剩余秒数。*/
    remainingSeconds: number;
    /** 还剩几波要结算。*/
    wavesLeft: number;
    /** 下一波结算的绝对时刻（= elapsedSeconds）。*/
    nextWaveAt: number;
    /** 每波间隔秒。*/
    waveInterval: number;
    /** 每波对每个敌人造成的伤害。*/
    damage: number;
    /** Cast-time damage text classification, persisted with the zone.*/
    floatTextKind?: ZCCombatFloatTextKind;
    /** 每波命中时施加的移速减速（0~1）；0 = 不减速。*/
    slowRatio: number;
    /** One-shot damage dealt when the zone expires.*/
    expireDamage?: number;
    /** Optional status applied with the expiry damage.*/
    expireStatusId?: string;
    /** Per-instance status duration override in seconds.*/
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
     * 已经打过的单位 id（移动区域专用）：一个区域对同一个敌人只结算一次。
     *
     * 原地区域（波次伤害）不需要它 —— 那是有意每波重复打；移动区域表达的是
     * 「风扫过路径上最多 N 个敌人」，同一个敌人被同一阵风连打三波是错的。
    */
    hitUnitIds?: number[];
    /** 命中名额上限（移动区域专用）；打满就提前消散。缺省 0 = 不限。*/
    maxHits?: number;
    /**
     * 每多命中一个目标伤害再降的系数（0~1）：第 k 个目标吃 `damage × (1 - falloff)^k`。
     * 缺省 undefined ⇒ 不递减，既有区域行为不变。
    */
    damageFalloff?: number;
    /**
     * 整段持有视觉：区域创建后推一条长效 `area` 事件，每帧改写坐标跟着区域走，
     * 区域消散时同步摘掉。不设则按波次推事件（移动区域会闪成一串残影）。
    */
    holdVisual?: boolean;
    /**
     * 上面那条长效表现事件在 `combatEvents` 里的 id，由 `ZCGroundZoneSystem` 自己维护。
     *
     * 刻意不进快照（`combatEvents` 本来也不进存档，`ZCSnapshotCodec.restore` 会清空整列），
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
     * 上面那段入场生长的**起始占比**（0~1，2026-11-20 第 28 批 102004 飓风）。
     *
     * `growSeconds` 的曲线是 `1-(1-t)²`，t = 0 时系数是 **0** —— 只能表达「从看不见长到满」。
     * 需求是「初始生成的大小只有 10%，随移动过程逐渐成长」，那 10% 的起点必须单独给。
     * 视图侧合成 `growFrom + (1-growFrom) × ease(t)`，所以最终大小仍是 prefab 说了算。
     * 缺省 `undefined` ⇒ 当成 0，存量特效（从 0 长起来 / 压根不生长）逐字不变。
    */
    growFrom?: number;
    /**
     * 追踪段的慢速档（世界 px/秒）：给了就进入追踪式移动，
     * 慢档不结算，距目标 ≤ `sprintRange` 切快档 `sprintSpeed` 并开始结算，目标死了自动改追最近的敌人。
     * 缺省 undefined ⇒ 没有追踪阶段。
    */
    approachSpeed?: number;
    /** 追踪的目标单位 id（`unit.id`）；目标倒下时由区域系统改追最近敌人。*/
    approachTargetId?: number;
    /** 与目标的距离 ≤ 它（世界 px）就切快档。缺省 0 ⇒ 一出生就快档。*/
    sprintRange?: number;
    /** 快档速度（世界 px/秒）；同时写进 `moveVelocityX/Y`（世界 px/秒）。缺省 0 ⇒ 切档后原地不动。*/
    sprintSpeed?: number;
    /**
     * 到点后把移动权交回随机游走（2026-11-20 第 28 批 102004 飓风）。
     *
     * 为什么光有 `approachSpeed` 不够：`advanceChase` 一旦看到 `approachSpeed > 0` 就
     * 恒返回 `true`，位移那一段永不落到 `advanceWander` 手上 —— 于是「飞到目标之后
     * 继续随机飘」这件事根本轮不上（`sprintSpeed` 配 0 就是原地定住，配正数就一直
     * 朝旧方向冲）。所以走到位（或目标丢失）的那一刻必须显式「下车」：清掉
     * `approachSpeed / approachTargetId / sprintSpeed`、把 `sprinting` 置真（顺带让
     * `enterSprint` 把 `nextWaveAt` 重置到此刻，否则落地那一帧会把赶路期间攒下的
     * 波次一口气全打出去），下一帧起 `advanceChase` 返回 false ⇒ 游走接管。
     * 缺省 `undefined` ⇒ 保持「追到就停」的老口径（103405 鹿神守护），存量逐字不变。
    */
    arriveWander?: boolean;
    /**
     * 赶路段**已耗时**（秒，2026-11-20 第 28 批 102004 飓风的总时长口径）。
     *
     * `remainingSeconds` 在赶路期不读秒（`isApproaching` 为真），可设计要的是
     * 「总共活 N 秒（含赶路）」而不是「落地后再活 N 秒」⇒ 这段账必须在落地那一刻
     * 一次性结清：`releaseToWander` 把本格从 `remainingSeconds` 里扣掉，并据剩余时间
     * 重算 `wavesLeft`（不重算就会把整段 12 波塞进剩下的几秒里，变成「落地后每 0.17 秒打一下」）。
     *
     * 由 `advanceChase` 每帧 `+= dt` 累加（只有真在追的帧才算），所以它不是「施放到落地」
     * 的墙钟差 —— 中途被别的分支暂停也不会多算。缺省 `undefined` ⇒ 老车道（103405）
     * 不累计、也不扣，行为逐字不变。
    */
    approachSeconds?: number;
    /**
     * 「最后已知目标坐标」（世界 px，2026-11-20 第 31 批）。
     *
     * 用户口径原话：「锁定目标，移动，目标丢失，切换目标，没有目标继续往旧的目标坐标移动，
     * 不会静止」。`approachTargetId` 只能表达「追谁」，追不到人就无从知道该往哪飞 ——
     * 老代码在这种情况下要么沿旧速度方向继续冲（越过目标后一直飞），要么因为
     * `sprintSpeed` 缺省取到 0 而**整片定住**（飓风的投送段只有 `approachSpeed`、没有
     * `sprintSpeed`，走到这一步就是一动不动的一片风）。
     *
     * 于是把「目标活着的每一帧的坐标」记下来：目标全没了就朝这个坐标继续飞，飞到了才按
     * 各车道自己的收尾走（`arriveWander` 交给随机游走、其余继续沿同方向飞）。
     * 缺省 `undefined` ⇒ 从出生就没锁定过目标，行为与改动前逐字一致（沿原速度方向兜底）。
    */
    chaseGoalX?: number;
    /** 见 `chaseGoalX`。两者同生同灭，只写一个没有意义。*/
    chaseGoalY?: number;
    /**
     * 是否已经切到快档。
     *
     * 缺省 / false ⇒ 仍在慢档（或压根没有追踪阶段）。必须进快照：存档还原后小鹿不能
     * 又从出生点重新走一遍，也不能把「已经读过的两秒」再读一次。
    */
    sprinting?: boolean;
    /**
     * 当前该播的骨架动画名（`sp.Skeleton.setAnimation`，2026-11-07 鹿神守护）。
     *
     * 由区域系统按阶段改写，`syncHoldVisual` 每次把它抄进那条长效表现事件；
     * 视图只在名字变化时才真的 `setAnimation`，否则每帧重播会把动画钉在第一帧。
     * 缺省 undefined ⇒ 视图不碰动画（既有特效的预制自带 `defaultAnimation`，行为逐字不变）。
    */
    visualAnimation?: string;
    /**
     * 跟随本体的绑定单位 id：区域每帧把坐标改写成该单位当前位置，判定圆心永远裹在施法者身上。
     * 缺省 undefined ⇒ 区域原地不动。
    */
    followUnitId?: number;
    /**
     * 跟随时保持的身前距离（世界 px）：落点 = 本体 + 朝向前移该值，并同步刷新 `angleDegrees`。
     * 缺省 0 ⇒ 圆心贴本体。
    */
    followForward?: number;
    /**
     * 每一波命中后按概率挂状态，与伤害同拍判定（每道雷打到的每个敌人各判一次）。
     * 与 `expireStatusId` 的区别是那个只在到期时挂一次。缺省 ⇒ 不挂。
    */
    hitStatusId?: string;
    /** 命中挂状态的概率（0~1）。缺省 0 ⇒ 不挂；为 1 时等价于必挂。*/
    hitStatusChance?: number;
    /** 命中挂状态的持续秒数；缺省用状态表里的 `durationSeconds`。*/
    hitStatusSeconds?: number;
    /**
     * 每一波最多打几个目标：每波重新计数，同一敌人下一波还能再吃，区域不提前消失。
     * 与 `maxHits`（整个区域的命中名额）不同。缺省 0 ⇒ 不限。
    */
    waveMaxTargets?: number;
    /**
     * 施法期间施法者美术整体上抬（屏上 px），时长与区域同生共死。
     * 只抬 `visualRoot`，不动单位坐标，避免命中与索敌跟着飘。缺省 0 ⇒ 不抬。
    */
    casterLiftPx?: number;
    /**
     * 矩形判定的两条半边长（逻辑 px）：`rectHalfHeight > 0` 才启用矩形，否则仍是圆形。
     * `rectHalfLength` 缺省跟随 `radius`；要贴合美术就在表里显式写 182。
     * 矩形与坐标轴对齐，不跟朝向旋转。
    */
    rectHalfLength?: number;
    rectHalfHeight?: number;
    /**
     * 区域朝向（度，逆时针，0 = 朝 +x）：判定先把点转回本地系，表现抄进 `area` 事件。
     * 缺省 undefined ⇒ 0°。必须进快照，否则读档后光束会突然躺平。
    */
    angleDegrees?: number;
    /**
     * 表现的竖直抬升（屏上 px）：单位根节点是脚点，脚点到身体中心约 30px。
     * 与弹道的 `zcCombatEffectLiftY` 同口径，屏幕竖直、不跟旋转。缺省 0 ⇒ 不抬。
    */
    visualLiftPx?: number;
    /**
     * 触碰触发半径（世界 px）：每个逻辑步扫一次，第一个踩进来的吃 `contactDamage`，
     * 随后区域清零走到期通道爆炸。与爆炸半径 `radius` 分开（50 vs 100 逻辑 px）。
     * 缺省 undefined ⇒ 不启用触碰。
    */
    contactRadius?: number;
    /**
     * 触碰那一下的伤害（绝对值，已经算过暴击 / 克制；`damageUnit` 直接吃这个数）。
     *
     * 与 `damage`（每波伤害）分开存：陷阱既没有波次、又要有两份不同的伤害
     * （踩上去的 200%/250%/300% 与爆炸均摊的 180%/220%/280%），一个标量装不下。
    */
    contactDamage?: number;
    /**
     * 区域消失那拍要播的一次性表现（陷阱爆炸）；爆炸时刻由踩中决定，只能存在区域里。
     * 与常驻的 `effectPrefabPath` 分工明确。缺省 undefined ⇒ 不插表现。
    */
    expirePrefabPath?: string | null;
    /** 上面那条一次性表现要活几秒（≥ 动画总长，否则尾段会被事件裁剪提前摘掉）。*/
    expireFxSeconds?: number;
    /**
     * 常驻表现推后多少秒出场：生成与常驻是两段美术，同帧出场会双影。
     * 视图据此延后建节点。缺省 undefined/0 ⇒ 立刻出现。
    */
    visualDelaySeconds?: number;
    /**
     * 「同一个敌人只挨一次」的持续接触区域（2026-11-18 第 16 批，孢爆箭的飓风 101303）。
     *
     * 与 `maxHits` 的区别：那个是**总名额**（打满 N 人就整片散场，移动区域 / 追踪弹用），
     * 这个是**去重**（名额不限、区域活满整段时长，每个敌人首次接触挨一次，
     * 之后站在里面也不再挨）—— 设计原话「同个敌人持续接触也只是 1 次伤害」。
     * 实现上复用 `hitUnitIds` 记账：命中过的 id 进数组，后续波次直接跳过。
     * 缺省 `undefined` ⇒ 每波都可以重复打（存量区域逐字不变）。
    */
    hitOncePerUnit?: boolean;
    /**
     * 投掷段的剩余飞行秒数（2026-11-18 第 17 批，毒箭蘑菇「穿甲爆矢」101704）。
     *
     * `> 0` 表示区域还在空中：位置由 `moveVelocityX/Y` 每帧推进，到 0 就地落地、
     * 速度归零，之后按 `remainingSeconds` 原地停留。缺省 `undefined` ⇒ 出生即落地，
     * 既有区域（陷阱 / 光环 / 暴风）逐字不变。
     */
    flightSeconds?: number;
    /**
     * 投掷段**总时长**（秒，2026-11-20 抛掷弧线）。
     *
     * `flightSeconds` 是「还剩几秒」，落到 0 就没法反推进度了；弧线的竖直抬升要按
     * 「已飞了百分之几」算，所以出生那一刻的总时长必须另存一格。
     * 缺省 `undefined`（或 `flightArcPx` 为 0）⇒ 不算弧线，平飞，存量投掷逐字不变。
    */
    flightTotalSeconds?: number;
    /**
     * 抛掷弧线的**峰值抬升**（屏上 px，2026-11-20 用户口径「蘑菇爆炸要有弧线飞行落地的过程」）。
     *
     * 只影响表现：`settleFlight` 每帧把 `visualLiftPx` 刷成抛物线 `4h·p·(1-p)`（起点/落点为 0、
     * 中途最高），**不动 `zone.x/y`** —— 那是地面坐标，接触判定与牵引都按它算，改了就是
     * 「判定飞在半空」。缺省 0 ⇒ 平飞。
    */
    flightArcPx?: number;
    /**
     * 投掷段（`flightSeconds > 0`）期间的**持有表现**路径（2026-11-19 蘑菇爆炸 101704）。
     *
     * 为什么要单独一格：一件投掷物的「还在飞」和「已落地」是两段美术 ——
     * 飞行段播「生成」（`科学家_陷阱_出现`），落地后换成常驻的 `effectPrefabPath`
     * （`科学家_陷阱`）。两者同一拍出场会双影，靠 `visualDelaySeconds` 又只能延后、
     * 不能换图，所以让区域自己带一份「飞行期路径」，`ZCGroundZoneSystem.settleFlight`
     * 落地那一刻摘掉飞行段那条事件、下一帧按 `effectPrefabPath` 重建。
     * 缺省 `undefined` ⇒ 整段都用 `effectPrefabPath`，存量区域（含 103504 精密陷阱）逐字不变。
     */
    flightVisualPath?: string | null;
    /**
     * 是否「只有被踩响才炸」（2026-11-18 第 17 批 101704）。
     *
     * 为 `true` 时**自然到期不结算 `expireDamage`、也不播 `expirePrefabPath`**，整片区域
     * 直接消失 —— 101704 的原话是「到期无人触碰直接消失」。而既有语义里
     * `expireDamage > 0` 恒等于「到时自爆」（103504 就靠这个收尾：无人踩中也得炸），
     * 所以必须多一个开关，不能靠把伤害配成 0 来表达（那样踩响了也不掉血）。
     * 缺省 `undefined` / `false` ⇒ 到期照旧结算，存量区域不受影响。
     */
    expireRequiresContact?: boolean;
    /**
     * 这片区域是否已经被敌人踩响过（仅供 `expireRequiresContact` 判定，不参与伤害计算）。
     *
     * 由 `ZCGroundZoneSystem.resolveContact` 置位。与 `sprinting` 同一类「阶段标记」：
     * 决定后续分支走哪条，所以必须进快照，否则读档回来「已经踩响的陷阱」会变成哑弹。
     */
    contactTriggered?: boolean;
    /**
     * 随机游走速度（世界 px/秒，2026-11-18 第 17 批 三叶小丑「飓风」102004）。
     *
     * 与 `moveVelocityX/Y` 的区别：那两个是**定方向**飞（暴风 / 小鹿冲刺），这个是
     * 「每隔 `wanderTurnSeconds` 秒随机换一次方向」。由 `ZCGroundZoneSystem.advanceWander`
     * 每帧把结果写回 `moveVelocityX/Y`，位移仍然走原来的那一句 —— 不另开一套位置推进。
     * 缺省 `undefined` ⇒ 不游走，存量区域（陷阱 / 光环 / 暴风）逐字不变。
    */
    wanderSpeed?: number;
    /** 换向间隔秒数（设计原话「方向随机变化」）。缺省 1 秒。*/
    wanderTurnSeconds?: number;
    /** 下次换向的绝对时刻；由区域系统自己维护（不还原则读档后立刻偏一次，无伤大雅但会抖）。*/
    wanderNextTurnAt?: number;
    /** 当前朝向（弧度，-π~π）；缺省时由第一帧抽一次。可负 ⇒ 快照校验按有限数走。*/
    wanderAngleRadians?: number;
    /**
     * 当前转向角速度（弧度/秒，**可负** = 左转 / 右转，2026-11-20 S 型游走）。
     *
     * 老实现是「每 `wanderTurnSeconds` 秒把朝向整段重掷成随机角」⇒ 折线；现在是
     * 「每帧按本角速度累加、到点取反」⇒ 一左一右的蛇形（S）。幅值固定为
     * `ZC_ZONE_WANDER_SWING_RADIANS / wanderTurnSeconds`，取反时只翻号不翻幅。
     * 缺省 `undefined` ⇒ 下一帧按当前 `wanderTurnSeconds` 补一个初值（读档兼容）。
    */
    wanderTurnRate?: number;
    /**
     * 牵引：把 `pullRadius` 内的敌人以 `pullSpeed`（世界 px/秒）拽向区域圆心。
     *
     * 与 `legacy_traction` **同一套算法**（最小距离 `20 × combatDistanceScale`、每步位移
     * `speed × dt` 且不超过「到最小距离的剩余」、只拽敌方）—— 差别只有力心：
     * 那条车道以**单位坐标**为力心（挂在施法者身上），飓风的力心是**会飘的圆心**，
     * 所以不能直接挂状态，得在区域里算。缺省 0 ⇒ 不牵引。
    */
    pullSpeed?: number;
    /** 牵引作用半径（世界 px）。缺省 0 ⇒ 不牵引。*/
    pullRadius?: number;
    /**
     * 区域表现的**事件级**整体缩放（2026-11-19 射线集束 103503）。
     *
     * 为什么必须有：`area` 事件**不按 `radius` 缩放**（视图只读事件上的 `effectScale`），
     * 所以「同一条矩形光束、长度由表值驱动」只能靠这一格把美术拉到判定大小。
     * 抄进 `syncHoldVisual` / `resolveWave` / `pushExpireVisual` 三处事件。
     * 缺省 `undefined` ⇒ 不写这一格，存量区域（陷阱 / 光环 / 暴风）逐字不变。
    */
    effectScale?: number;
}

/**
 * 动作失败的机器可读原因。
 *
 * 给表现层用的：要为某一类失败做专属反馈（如金币栏跳动）时看这个字段，
 * 不要去解析 `message` —— 那是给玩家看的文案，策划改字就变，今天的写法明天就失效。
 * 只登记真正有专属表现的原因，其余失败留空走通用文案。
*/
export type ZCActionFailureReason = 'insufficientGold';

export interface ZCActionResult {
    ok: boolean;
    /** 仅供主动点击类操作（神器按钮等）弹吐司；棋盘开格路径只读 `reason`，不构造文案。*/
    message?: string;
    /** 失败原因；`ok === true` 或原因未分类时为 `undefined`。*/
    reason?: ZCActionFailureReason;
}

export interface ZCScoreBreakdown {
    territory: number;
    mainCityHp: number;
    unitCount: number;
    totalUnitHp: number;
}
