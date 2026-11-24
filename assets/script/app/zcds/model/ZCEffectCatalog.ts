/**
 * 战斗特效目录：路径、行为组、尺寸 / 锚点 / 层级 / 抬升 / 飞行 / 朝向 / 淡出 / 染色 / 导弹、
 * 弹道拖尾、光束与受击面抬升的单一真源。
 *
 * 本文件是纯 TS，不依赖 `cc`；视图与模型只通过下方查询函数读取，不再各自维护路径表。
 *
 * 新增或调整一条表现时只改本文件：
 *  - 纯路径/表现参数 → `ZC_EFFECT_PATHS` + `ZC_EFFECT_SPECS`；
 *  - 行为技能（`pvpSkill` 没有造型槽）→ `ZC_EFFECT_BEHAVIOR_SPECS`；
 *  - 弹道拖尾 / 光束几何 → `ZC_EFFECT_TRAIL_SPECS` / `ZC_EFFECT_BEAM_SPECS`；
 *  - 时长、缩放、状态 id 前缀 → `ZCEffectTuning`。
 *
 * 若某条同时受配表数值约束（`areaRadius` / `auraRadius` / `strikeSplashRadius`），
 * 必须按条目 `notes` 同步修改配表，否则会出现“看着变了、判定没变”。
 */

import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

export type ZCEffectAnchor = 'caster' | 'midpoint' | 'target';
export type ZCEffectLayer = 'ground' | 'top';
export type ZCEffectTint = readonly [number, number, number];
export type ZCEffectHitSurface = 'unit' | 'wall' | 'building';

/** 一条「先飞过去再炸」的配置。*/
export interface IZCEffectFlight {
    /** 飞行速度（世界坐标 px/秒）。*/
    readonly speed: number;
    /** 最短飞行秒数：贴脸时别瞬移。*/
    readonly minSeconds: number;
    /** 最长飞行秒数：射程再远也不能飞太久。*/
    readonly maxSeconds: number;
    /** 朝向偏移（度，逆时针为正）：美术正前方与飞行方向的夹角。*/
    readonly facingOffsetDegrees: number;
}

/** 「追踪导弹」类的多点打击特效，按单位登记（弹体 + 爆炸两份 prefab）。*/
export interface IZCEffectMissileSpec {
    readonly missilePrefabPath: string;
    readonly impactPrefabPath: string;
    /** 弧线中段最大横向偏移（世界坐标）。*/
    readonly arcOffset: number;
    /** 导弹自己的飞行速度；缺省 = 复用该技能的 `projectileSpeed`。*/
    readonly speed?: number;
    /** 一次施法恒定发几颗；缺省 = 听配表 `strikeCount`。*/
    readonly count?: number;
}

/**
 * 一条按 prefab 路径登记的特效表现。
 *
 * 未登记的字段一律走各自查询函数的既有兜底：
 * `nodeScale = 1`、`anchor = 'caster'`、`liftY = 0`、`layer` 按事件类型、
 * `overlayChild = null`、`flight = null`、`facing = null`、`fade = 0`、`tint = null`。
 */
export interface IZCEffectSpec {
    readonly prefabPath: string;
    readonly nodeScale?: number;
    readonly anchor?: ZCEffectAnchor;
    /** 弹道竖直补偿（视图 px，加在 `mapToViewY` 之后）。*/
    readonly liftY?: number;
    readonly layer?: ZCEffectLayer;
    /** prefab 根节点直下的叠层子节点名。*/
    readonly overlayChild?: string;
    readonly flight?: IZCEffectFlight;
    /** 只转身、不飞时登记的朝向偏移（度）。*/
    readonly facingDegrees?: number;
    /** 弹道消失后定格淡出的秒数。*/
    readonly fadeSeconds?: number;
    /**
     * 事件寿命**下限**（秒）：一次性长演出必须盖住整段 clip。
     *
     * `ZCGameModel` 按 `startedAt + durationSeconds` 摘事件，而近战 / 区域事件默认只有 0.32s
     * （`defaultAttackTravelSeconds`）⇒ 不登记这一项的 1 秒以上动画会被截在一半。
     * 未登记 = `0` ⇒ 调用方沿用原寿命，存量逐字不变。
     */
    readonly durationSeconds?: number;
    /** 乘算叠加色 `[r, g, b]`，0~255。*/
    readonly tint?: ZCEffectTint;
    /** 与配表同步的约束；不含日期与批次。*/
    readonly notes?: string;
}

/**
 * 行为技能的表现组。
 *
 * `pvpSkillPlan.skillParamJson` 只有数值槽，没有造型列，因此行为技能的路径只能登记在这里。
 * `warmup` 表示该组必须进全局开战预热（表扫描收不到、首战就要用）；
 * 未标记的组只在本局 `buildZCVisualResourcePlan` 命中时按需加载。
 */
export interface IZCEffectBehaviorSpec {
    readonly behaviorKey: string;
    readonly prefabPaths: readonly string[];
    /** 按单位覆盖默认路径；缺省用 `prefabPaths`。*/
    readonly unitPrefabPaths?: Readonly<Record<string, readonly string[]>>;
    readonly warmup?: boolean;
    /** 只写资源约束或分组语义，不写日期与批次。*/
    readonly notes?: string;
}

/** 弹道拖尾的形状与颜色；未登记的弹体不画拖尾。*/
export interface IZCEffectTrailSpec {
    /** 起点（贴弹体的一端）在宿主本地坐标的 X。*/
    readonly startX: number;
    /** 拖尾总长（本地 px，沿 -X）。*/
    readonly length: number;
    /** 贴弹体那端的半宽（本地 px）。*/
    readonly rootHalfWidth: number;
    /** 远离弹体那端的半宽（本地 px）。*/
    readonly tipHalfWidth: number;
    /** 沿长度切几段；段数越多渐隐越顺。*/
    readonly slices: number;
    /** 颜色（rgb，0~255）。透明度只由 `alpha` 与段位置决定。*/
    readonly color: readonly [number, number, number];
    /** 起点处的不透明度（0~1）；远端恒为 0。*/
    readonly alpha: number;
}

/** 光束的发射口、画布可见段与按技能追加的粗细 / 超长长度。*/
export interface IZCEffectBeamSpec {
    readonly muzzleForward: number;
    readonly muzzleLift: number;
    readonly contentStart: number;
    readonly contentEnd: number;
    readonly widthScale: number;
    readonly coreWidth: number;
    readonly tailLift?: number;
    readonly overShootBySkill?: Readonly<Record<number, number>>;
    readonly widthMultiplierBySkill?: Readonly<Record<number, number>>;
}

/** 全部特效 prefab 路径；业务模块只引用语义键，不再各写字符串。*/
export const ZC_EFFECT_PATHS = {
    stormEgg: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
    missileImpact: 'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中',
    missileBody: 'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能',
    windHurricane: 'units/projectiles/风法师_龙卷风/风法师_龙卷风',
    deerGuard: 'units/projectiles/鹿神守护/鹿神守护',
    bigFist: 'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效',
    sustainedAura: 'units/projectiles/持续光环伤害效果/持续光环伤害效果',
    lightningBullet: 'units/projectiles/雷弹攻击/雷弹攻击',
    //  2026-11-20：雷弹命中（`30231 雷法师普攻` 的命中爆点，68016 磁电菇 / 68022 雷蕉 两张卡共用）。
    //  单独给语义键是为了挂 `nodeScale` —— 美术本体烘焙 0.7，用户要「缩小成 50%」。
    thunderBulletImpact: 'units/projectiles/雷弹命中/雷弹命中',
    //  2026-11-20 同轮：`磁电菇_子弹命中`（`30717 杰克藕普攻` 的命中爆点，只有 68008 杰克藕用）
    //  也按同一口径缩 50%。它和上面那条是**两份独立美术**（本体烘焙 0.4），别合并成一个键。
    cidianBulletImpact: 'units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中',
    // 2026-11-19 第 23 批：闪电链**专属**电弧（美术新出的水墨风）。链路是「同一段首尾相接」，
    // 所以它和 `bolt`（落雷，一端亮团一端细丝）不能共用 —— 共用就会一段亮一坨、一段细丝。
    chainArc: 'units/projectiles/闪电链水墨风/闪电链水墨风',
    chargeDash: 'units/projectiles/轻骑兵_冲锋/轻骑兵_冲锋',
    dashGuard: 'units/projectiles/刀盾兵_护盾/刀盾兵_护盾',
    nutAttack: 'units/projectiles/巨力坚果_普攻/巨力坚果_普攻',
    yulinDart: 'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻',
    yulinDartEmpowered: 'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化',
    clownDart: 'units/projectiles/三叶小丑_普攻/三叶小丑_普攻',
    axeBlade: 'units/projectiles/斧盾兵_反击气刃/斧盾兵_反击气刃',
    boxerStrike: 'units/projectiles/消灭学霸_普攻/消灭学霸_普攻',
    laserAttack: 'units/projectiles/镭射飞龙_普攻/镭射飞龙_普攻',
    blink: 'units/projectiles/瞬间移动特效/瞬间移动特效',
    bolt: 'units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能',
    burstImpact: 'units/projectiles/普攻爆炸/普攻爆炸',
    singleStrike: 'units/projectiles/长戟兵_撕裂/长戟兵_撕裂',
    splashMissile: 'units/projectiles/子弹_新怪物/通用箭矢',
    trapSpawn: 'units/projectiles/科学家_陷阱/科学家_陷阱_出现',
    trapIdle: 'units/projectiles/科学家_陷阱/科学家_陷阱',
    trapExpire: 'units/projectiles/科学家_陷阱爆炸/科学家_陷阱爆炸',
    selfAuraFlame: 'units/projectiles/大威天芦_火焰光环/大威天芦_火焰光环',
    lightningImpact: 'units/projectiles/雷电冲击/雷电冲击',
    selfAuraFire: 'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰',
    //  2026-11-20 第 33 批：分裂菇 68014「一人成军」101404 的分身生成点。
    //  26 帧散图（1185 画布）× 一次性爆点，prefab / anim 由
    //  `tools/build_fission_spawn_fx.py` 生成 —— 手工改 prefab 会被重跑覆盖。
    fissionSpawn: 'units/projectiles/分裂菇_生成分身/分裂菇_生成分身',
    //  2026-11-23：仙桃行者 68009 的「重击」落地柱（大地之力 100904 的首目标 + 武将技 36241）。
    //  32 张 1065×2372 散图 → 29 帧一次性演出，prefab / anim 由
    //  `tools/build_xiantao_quake_fx.py` 生成 —— 手工改 prefab 会被重跑覆盖。
    //  🔴 画面里那圈地面裂纹 = 判定圆（半径 54 逻辑 px），改一边必须同步另一边。
    quakeStrike: 'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能',
    //  2026-11-23（第 42 批续）：仙桃行者 68009 的**普通攻击**造型。
    //  🔴 用户原话纠正：「搞错了，应该使用的是 旧值 长枪兵普攻_刀光」——不是枪阵那份
    //  `长枪兵_武将技能`。这里只留路径常量、**不登记 spec**：刀光 64×42 就是贴在本体出手点
    //  的一下挥击（锚点 `caster`、层按事件类型 `melee ⇒ top`、尺寸 1 全是兜底默认值），
    //  与长枪兵自己那行 30171 的播法逐字一致。
    spearSlash: 'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光',
    //  2026-11-23 第 43 批：灼热地带那张图（十簇火苗散图），文明之火直接复用。
    //  🔴 蓝色不在这里烘：目录按路径给 `tint`（见 `ZC_EFFECT_SPECS`），美术保持原样 ——
    //  火焰树妖 68003 自己的灼热地带还要继续用紫品红那一版。
    hotZone: 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能',
    // 68024 急冻瓜「冰山陨落」102403 落地冰锥
    iceCone: 'units/projectiles/冰法师_冰锥/冰法师_冰锥',
} as const;

/** 行为键单一真源；Fx facade、资源计划与行为判据都从这里取。*/
export const ZC_EFFECT_BEHAVIOR_KEYS = {
    blinkStrike: 'blink_strike',
    boltStrike: 'bolt_strike',
    chainDamage: 'chain_damage',
    selfAura: 'self_aura',
    trapPlace: 'trap_place',
    splashShot: 'splash_shot',
    sporeBurst: 'spore_burst',
    burstAura: 'burst_aura',
    burstKnockback: 'burst_knockback',
    fanSlow: 'fan_slow',
    singleStrike: 'single_strike',
    chargeShield: 'charge_shield',
    legacyDash: 'legacy_dash',
    windBolt: 'wind_bolt',
    missileBarrage: 'missile_barrage',
    stormZone: 'storm_zone',
    rayBeam: 'ray_beam',
    fireZone: 'fire_zone',
    /**
     * 四段突进连击（仙桃行者 68009「腾云驾雾」100904，2026-11-24 第 44 批）。
     *
     * 这条车道**没有自己的 prefab**：每次攻击播的是重击柱（`quakeStrike`），
     * 那张图已经按单位登记在 `skill_params` 的 `unitPrefabPaths['68009']` 里
     * （第 42 批为「大地之力」补的，本批沿用）⇒ 本车道只登记行为键，不重复收路径。
    */
    dashChain: 'dash_chain',
    summonUnit: 'summon_unit',
    /**
     * 「只带数据、不带行为」的参数袋车道（`ZCSkillRuntime` 里注册成 `stateMode: 'none'`）。
     *
     * 它本身没有造型，但**某些卡的自护盾就挂在这条车道上**（巨力坚果 68002 的
     * 「亡者护盾」100204：`triggerEvent = active`、`behaviorKey = skill_params`）⇒
     * 资源计划要能按单位给它补收表现，见下面 `ZC_EFFECT_BEHAVIOR_SPECS` 里那条 `unitPrefabPaths`。
     */
    skillParams: 'skill_params',
    /**
     * 冷却型自身施法（`applySelfCast`）：自愈 / 限时增益 / 净化 / 群体治疗。
     *
     * 这条车道同样没有造型槽 —— 但波利奥 68006「吃口菠萝」100603 是**群体**施法，
     * 吃到治疗的每个己方单位身上都要挂一圈 `刀盾兵_护盾`（2026-11-21 第 38 批）。
     * 路径按单位覆盖登记，别写进 `prefabPaths`：嗜血 / 迅击也在同一条车道，会连带预载。
     */
    selfCast: 'self_cast',
} as const;

/**
 * 行为键 → 本组需要的全部路径。
 *
 * `wind_bolt` / `missile_barrage` 与旧资源计划保持同一分组语义：
 * 任一键命中就收齐风弹 / 飓风 / 导弹 / 命中爆炸四条，避免同一张卡两条主动只加载一半。
 */
export const ZC_EFFECT_BEHAVIOR_SPECS: readonly IZCEffectBehaviorSpec[] = [
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.blinkStrike,
        prefabPaths: [ZC_EFFECT_PATHS.blink],
        notes: '施法瞬间闪现；资源计划按 behaviorKey 收取',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfAura,
        prefabPaths: [ZC_EFFECT_PATHS.sustainedAura],
        unitPrefabPaths: {
            '68025': [ZC_EFFECT_PATHS.selfAuraFlame],
            '68016': [ZC_EFFECT_PATHS.lightningImpact],
            '68026': [ZC_EFFECT_PATHS.selfAuraFire],
        },
        notes: '默认光柱；三个现有单位按单位覆盖，改半径需同步 auraRadius',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.boltStrike,
        prefabPaths: [ZC_EFFECT_PATHS.bolt],
        notes: '落雷；五雷轰顶专用（2026-11-19 第 23 批起闪电链另有 chainArc，不再共用）',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.chainDamage,
        prefabPaths: [ZC_EFFECT_PATHS.chainArc],
        notes: '每段首尾相接的水墨风电弧；不复用落雷（bolt）的端头造型',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.trapPlace,
        prefabPaths: [
            ZC_EFFECT_PATHS.trapSpawn,
            ZC_EFFECT_PATHS.trapIdle,
            ZC_EFFECT_PATHS.trapExpire,
            //  101704「蘑菇爆炸」的爆炸按 skillId 换成了通用爆点（`ZCTrapFx.zcTrapExpirePath`），
            //  清单必须一起收 —— 漏收就是「结算正常、屏幕没东西」。103504 仍然播 trapExpire。
            ZC_EFFECT_PATHS.burstImpact,
        ],
        notes: '生成 / 常驻 / 爆炸三段；101704 的爆炸改用通用爆点（普攻爆炸）',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.splashShot,
        prefabPaths: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '弹体 + 命中爆点；与 spore_burst 共用',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst,
        prefabPaths: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '弹体 + 命中爆点；与 splash_shot 共用',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.burstAura,
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '以自身为圆心的一次性爆点',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.burstKnockback,
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '以自身为圆心的一次性爆点',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.fanSlow,
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        notes: '扇形铺 3 发爆点，复用 burstImpact；预热由 burst / splash 组覆盖',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.singleStrike,
        prefabPaths: [ZC_EFFECT_PATHS.singleStrike],
        warmup: true,
        notes: '贴目标播放的撕裂',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.chargeShield,
        prefabPaths: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '残影 + 落地护盾；护盾只在 III 级出现，按整条车道预收',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.legacyDash,
        prefabPaths: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '残影 + 落地护盾；与 charge_shield 共用资源组',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.windBolt,
        prefabPaths: [
            ZC_EFFECT_PATHS.clownDart,
            ZC_EFFECT_PATHS.windHurricane,
            ZC_EFFECT_PATHS.missileBody,
            ZC_EFFECT_PATHS.missileImpact,
        ],
        warmup: true,
        notes: '风弹 / 飓风 / 导弹 / 命中四件套；与 missile_barrage 共组',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.missileBarrage,
        prefabPaths: [
            ZC_EFFECT_PATHS.clownDart,
            ZC_EFFECT_PATHS.windHurricane,
            ZC_EFFECT_PATHS.missileBody,
            ZC_EFFECT_PATHS.missileImpact,
        ],
        warmup: true,
        notes: '风弹 / 飓风 / 导弹 / 命中四件套；与 wind_bolt 共组',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.stormZone,
        prefabPaths: [ZC_EFFECT_PATHS.windHurricane],
        notes: '场上走动的飓风；复用 windHurricane，预热由 wind_bolt 组覆盖',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.rayBeam,
        //  🔴 2026-11-23 第 43 批换成【镭射飞龙_普攻】那张红色光束。
        //  用户原话：「机甲菇使用的射线颜色和镭射飞龙的普通攻击颜色一致，不需要改成蓝色」。
        //  原来用的是【雷电冲击】（主色青蓝 rgb(84,156,252)），而乘法染色只能压通道、不能提亮 ——
        //  青底乘红只会得到暗红，「与镭射飞龙一致」是做不到的，只能直接换同一张图。
        //  基准半长随之从 180 改成 374（见 `ZCEffectTuning.rayBeamReferenceHalfLength`）。
        prefabPaths: [ZC_EFFECT_PATHS.laserAttack],
        notes: '矩形光束；用镭射飞龙普攻那张红图，颜色与它天然一致',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.fireZone,
        //  文明之火（2026-11-23 第 43 批）：直接复用灼热地带那张图。
        //  🔴 蓝色**不在这里**登记 —— 它按事件染色（`ZC_FIRE_ZONE_TINT`），因为同一个路径
        //  被火焰树妖 68003 自己的灼热地带用着、那边必须保持紫品红。
        prefabPaths: [ZC_EFFECT_PATHS.hotZone],
        notes: '目标点周围撒 3 块火焰区域；图同灼热地带，颜色由事件级 tint 给蓝色',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.summonUnit,
        prefabPaths: [
            ZC_EFFECT_PATHS.fissionSpawn,
            //  舞王 103103 的「脚底持续光环」（2026-11-20 用户口径「本体脚底同步播放
            //  【持续光环伤害效果】，范围囊括本体和 4 个分身，纯表现」）。与 `self_aura` 共用
            //  同一份 prefab，但**没有单位的造型覆盖** ⇒ 这里必须单独收一次：
            //  `zcEffectPathsForBehavior` 只按本组给清单，漏收就是「光圈不出现、结算与伤害都正常」。
            ZC_EFFECT_PATHS.sustainedAura,
        ],
        //  🔴 不标 `warmup`：这条只在带分裂菇 68014 / 艺术家 68031 的阵容里用得上，进全局预热等于给
        //  所有对局多下 26 张 1185×1185 的散图 + 一份光环。`buildZCVisualResourcePlan` 按
        //  `skillPlans.behaviorKey` 命中本组，所以「有这张卡」才收。
        notes: '召唤（`summon_unit`）：分身 / 舞伴的生成爆点 + 舞王脚底持续光环；目前只有 68014 / 68031 用它',
    },
    {
        //  自护盾的表现（2026-11-21 第 37 批）。
        //
        //  🔴 巨力坚果 68002 的「亡者护盾」100204 写在**参数袋车道**上（`behaviorKey = skill_params`，
        //  `triggerEvent = active`），它自己没有造型槽；`pvpSkill` 那边 `30802 坚果重砸` 的造型
        //  是普攻的，`30803 亡者护盾` 又是一个只有名字、没有 `effectPrefabPath` 的 profile。
        //  于是「盾上了、画面什么都没有」—— 用户实测「巨力坚果没有释放刀盾兵的护盾效果」。
        //
        //  为什么用 `unitPrefabPaths` 而不是往 `prefabPaths` 里加：这条车道被十几种卡的
        //  被动共用，写进公共清单等于给所有卡预载一张护盾。按单位覆盖才是「有这张卡才收」。
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.skillParams,
        prefabPaths: [],
        unitPrefabPaths: {
            '68002': [ZC_EFFECT_PATHS.dashGuard],
            //  仙桃行者 68009 的「大地之力」100904 也在这条车道上（`skill_params` + 每 5 次普攻）。
            //  它的重击特效由代码常量推动（`ZC_EFFECT_PATHS.quakeStrike`），`pvpSkill` 那两行
            //  （30844 / 36241）**都不带这张图**能被本局清单收到 ⇒ 必须按单位补一次，
            //  否则「特效在编辑器里有、实战里一次都不播」。
            '68009': [ZC_EFFECT_PATHS.quakeStrike],
        },
        //  🔴 不标 `warmup`：`charge_shield` / `legacy_dash` 那两组已经带着这张 prefab 进了全局预热
        //  （`zcWarmupEffectPaths`），再标一次只是重复；这里补的是**本局清单**
        //  （`buildZCVisualResourcePlan` → `ZCGameLoader.effects`），缺了它预热有、实战没有。
        notes: '自护盾（`skill_params` 车道）：68002 亡者护盾补收刀盾兵_护盾；68009 大地之力补收重击柱；其余卡在这条车道零资源',
    },
    {
        //  群体自身施法的护盾表现（2026-11-21 第 38 批）。
        //
        //  波利奥 68006「吃口菠萝」100603 走的是 `self_cast` 车道：`selfCastAllyRadius 252`
        //  的群体治疗（自身 8/10/15% + 6 格友军 4/5/8%，III 级再解一个减益）。
        //  用户口径「这也是一个群体的护盾效果」+「保留治疗只补表现」⇒ 数值不动，
        //  由 `ZCSkillTriggerSystem.applySelfCast` 给半径内每个己方单位（含自己）推一条
        //  `刀盾兵_护盾` 的纯表现事件。
        //
        //  🔴 按单位覆盖，不写进 `prefabPaths`：同车道的嗜血 100703 / 迅击 100903 是纯自身增益，
        //  写进公共清单等于给它们也预载一张护盾，而且它们根本不会推这条事件。
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfCast,
        prefabPaths: [],
        unitPrefabPaths: { '68006': [ZC_EFFECT_PATHS.dashGuard] },
        //  🔴 不标 `warmup`：`charge_shield` / `legacy_dash` 那两组已经带着这张 prefab 进了全局预热，
        //  这里补的只是本局清单（`buildZCVisualResourcePlan` → `ZCGameLoader.effects`）——
        //  缺了它 = 预热有、实战没有。
        notes: '群体自身施法（`self_cast` 车道）：68006 吃口菠萝给半径内每个己方单位挂刀盾兵_护盾；其它卡零资源',
    },
];

/** 全部按路径登记的表现条目；新增条目必须保证 `prefabPath` 唯一。*/
export const ZC_EFFECT_SPECS: readonly IZCEffectSpec[] = [
    {
        prefabPath: ZC_EFFECT_PATHS.stormEgg,
        nodeScale: 0.7,
        notes: '30831 暴风：视觉 0.7；areaRadius 仍 30，改倍率需同步 pvpSkill.areaRadius',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.missileImpact,
        nodeScale: 123 / 202,
        notes: 'strikeSplashRadius 80 逻辑；分母取可见宽 202，不是画布 225',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.missileBody,
        nodeScale: 0.8,
        notes: '与爆炸 0.609 配套；拖尾画在同一宿主，按本地单位写',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.windHurricane,
        nodeScale: 0.5,
        tint: [96, 255, 128],
        notes: '36251 飓风：areaRadius 60→30 需同步；同路径也用于 101303 区域',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.deerGuard,
        nodeScale: 100 / 685,
        layer: 'top',
        overlayChild: 'fx_火船',
        notes: '画布高 685→100px；火船同宿一起缩，层序按 area 置顶',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.bigFist,
        nodeScale: 2.5,
        notes: '仅视觉；穿透/倍率/寿命在 pvpSkillPlan.skillParamJson',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.sustainedAura,
        nodeScale: 307.5 / (256 * 0.58),
        //  🔴 分母是**画布宽**，不是环宽：画布 256 里那圈可见环只有 153（alpha>60 实测），
        //  画布上半截是空的。所以 `nodeScale = 1` 语义下「画布 = 307.5 屏上」时，
        //  环其实只有 184 屏上 px（半轴 92）。68021 / 68024 的 `auraRadius 120`
        //  （判定直径 184.5）正好对得上这一档 ⇒ **别凭「200 半径」改这里**，
        //  需要更大的光环走事件级 `effectScale`（舞王 103103 就是那条，
        //  见 `ZCGameModel.ZC_SUMMON_AURA_COVER_SCALE`）。
        notes: '画布 307.5 屏上、可见环仅 184（环占画布 153/256）；68021/68024 的 120 半径匹配此档，改大小走 effectScale',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.lightningBullet,
        //  2026-11-19 第 23 批（用户原话「缩小并去掉长拖尾」）：0.5 时屏上 46.8×31.6，
        //  一颗电池弹比卡牌还宽，看起来就是「一根大电弧」；0.35 收到 32.8×22.1。
        nodeScale: 0.35,
        notes: '雷蕉普攻电弹；0.35 与「去掉拖尾」配套，改一个要一起看另一个',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.chargeDash,
        nodeScale: 0.4,
        anchor: 'midpoint',
        notes: '行程变时重算；残影取线段中点，不沿路径插值',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.dashGuard,
        nodeScale: 0.55,
        notes: '落地自保护盾，设计口径 55%',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.nutAttack,
        anchor: 'midpoint',
        notes: '30802/30803 共用；播在出手点与受击点中点',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.yulinDart,
        liftY: 20,
        notes: '脚点→身体中心补偿 20 视图 px',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.yulinDartEmpowered,
        liftY: 20,
        notes: '与普攻同一角色，高度必须一致',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.clownDart,
        liftY: 30,
        notes: '脚点→身体中心补偿 30 视图 px；强化飓风不走 projectile',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.axeBlade,
        flight: {
            speed: 420,
            minSeconds: 0.14,
            maxSeconds: 0.6,
            facingOffsetDegrees: 0,
        },
        notes: '30271；美术正面 +X，偏移 0（别改回 90）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.boxerStrike,
        facingDegrees: 180,
        notes: '30713/30852 共用；美术正面 -X，偏移 180',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.laserAttack,
        fadeSeconds: 0.18,
        notes: '30719/30845 共用；命中后定格 0.18s',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.thunderBulletImpact,
        nodeScale: 0.5,
        //  需求 2026-11-20：「68016 和 68022 的受击效果太大了，统一都改小成 50%」。
        //  这两个单位共用 `pvpSkill 30231 雷法师普攻`，全表只有它俩用它 ⇒ 按 prefab 路径
        //  挂倍率就是「只影响这两张卡」。prefab 本体烘焙 0.7，乘完屏上 0.35。
        //  🔴 命中爆点是 `area` 事件，判定半径来自配置（本行 `areaRadius` 为 0，纯表现），
        //  所以缩倍率不动任何判定；反过来说，谁要改它的**视觉**大小就改这里，别去改 prefab
        //  —— 那个 prefab 与 `雷弹攻击` 是同一批美术资产，改本体还会牵动拖尾与命中彩度口径。
        notes: '30231 命中爆点（68016 / 68022 共用）；烘焙 0.7 × 0.5 = 屏上 0.35',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cidianBulletImpact,
        nodeScale: 0.5,
        //  同一条需求的后半句：「杰克藕那份也缩」。它只挂在 `30717 杰克藕普攻`（68008）上。
        //  注意本体烘焙只有 0.4（比雷弹命中那份小），所以乘完屏上 0.2 —— 两张爆点不再一样大，
        //  这是「各自按自己原大小的 50%」的结果，不是漏改。
        notes: '30717 命中爆点（68008 杰克藕）；烘焙 0.4 × 0.5 = 屏上 0.2',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.quakeStrike,
        //  🔴 `target`：这条必须**落在受击目标的坐标**上，不是出手点。
        //  需求口径（2026-11-23）：「该特效的释放一定是在目标的坐标位置播放」。
        //  近战事件的 `from` 是施法者、`to` 才是目标，默认 `caster` 会整根柱子砸在自己头上。
        anchor: 'target',
        //  层：`top`。它是「打在空中的一下」，压在角色身上才对；`area` 事件类型默认会被压到地面层
        //  （`zcCombatEffectLayerOf`），所以这里按路径覆盖回来。
        layer: 'top',
        //  🔴 不写 `nodeScale`：尺寸已经烘进 prefab（`_lscale = 0.56`），再乘一次就是两个真源。
        //  画面里的地面裂纹环直径 83 屏上 px ↔ 判定圆直径 108 逻辑 px，两者是对齐的，
        //  要改必须同时改 `tools/build_xiantao_quake_fx.py` 与 `skillParamJson.quakeRadius`。
        notes: '仙桃行者 68009 重击（100904 首目标 / 36241 武将技）；画面上那圈裂纹 = 判定圆',
        //  一次性长演出（29 帧）：事件寿命必须盖住整段 clip，短了会被
        //  `ZCGameModel` 按 `startedAt + durationSeconds` 摘掉（「砸到一半没了」）。
        durationSeconds: ZC_EFFECT_TUNING.quakeStrikeSeconds,
    },
];

/**
 * 弹体 prefab 路径 → 拖尾配置。未登记 = 普通弹道不画拖尾。
 *
 * 只登记需要拖尾的弹体：每加一条都要单独调宽窄，默认全挂只会让画面糊。
 * 长度都是宿主本地 px；屏上长度 = 本地 × `zcEffectNodeScaleOf(path)`。
 */
export const ZC_EFFECT_TRAIL_SPECS: Readonly<Record<string, IZCEffectTrailSpec>> = {
    // 镭射飞龙追踪导弹：屏上 80px、接触端整宽约等于弹体半径，接触端压进弹体 26 本地。
    [ZC_EFFECT_PATHS.missileBody]: {
        startX: -26,
        length: 100,
        rootHalfWidth: 20,
        tipHalfWidth: 2,
        slices: 12,
        color: [255, 255, 255],
        alpha: 0.62,
    },
    //  🔴 2026-11-19 第二轮：用户「三角形拖尾要保留」⇒ 加回来。
    //  宿主缩放已从 0.5 收到 0.35，而**屏上**的形状要跟改之前一致（长 55、贴弹体端半宽 8），
    //  所以本地值全部 ÷ 0.35 × 0.5（= ×1.428571）：本地 110→157.14、半宽 16→22.86。
    //  只改这里、不动 `zcEffectNodeScaleOf(lightningBullet)`，两边就不会互相打架。
    [ZC_EFFECT_PATHS.lightningBullet]: {
        startX: -57.142857,
        length: 157.142857,
        rootHalfWidth: 22.857143,
        tipHalfWidth: 2.857143,
        slices: 12,
        color: [255, 255, 255],
        alpha: 0.6,
    },
};

/**
 * 光束 prefab 路径 → 发射口 / 可见段 / 粗细 / 按技能追加的倍率。
 *
 * `contentStart/End` 是画布内线条的占比；素材重新归一化后必须同步这两个数。
 */
export const ZC_EFFECT_BEAM_SPECS: Readonly<Record<string, IZCEffectBeamSpec>> = {
    // 镭射飞龙：单位根是脚点，龙眼在 +44；末端补到模型中心 +30。
    [ZC_EFFECT_PATHS.laserAttack]: {
        muzzleForward: 8,
        muzzleLift: 44,
        contentStart: 72 / 700,
        contentEnd: 628 / 700,
        widthScale: 0.8,
        coreWidth: 10,
        tailLift: 30,
        widthMultiplierBySkill: { 30845: 1.3 },
        overShootBySkill: { 30845: 1620 },
    },
};

/** 受击特效的锚点纵向补偿（视图 px），按受击表面而不是 prefab 路径。*/
export const ZC_HIT_FX_SURFACE_LIFT_Y: Readonly<Record<ZCEffectHitSurface, number>> = {
    unit: 0,
    wall: 0,
    building: 15.651,
};

const SPEC_BY_PATH = new Map<string, IZCEffectSpec>();
for (const spec of ZC_EFFECT_SPECS) {
    if (SPEC_BY_PATH.has(spec.prefabPath)) {
        throw new Error(`ZCEffectCatalog: duplicate prefabPath ${spec.prefabPath}`);
    }
    SPEC_BY_PATH.set(spec.prefabPath, spec);
}

const BEHAVIOR_BY_KEY = new Map<string, IZCEffectBehaviorSpec>();
for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
    if (BEHAVIOR_BY_KEY.has(spec.behaviorKey)) {
        throw new Error(`ZCEffectCatalog: duplicate behaviorKey ${spec.behaviorKey}`);
    }
    BEHAVIOR_BY_KEY.set(spec.behaviorKey, spec);
}

/** 按路径取条目；空路径 / 未登记 = `null`。*/
export function zcEffectSpecOfPath(
    effectPrefabPath: string | null | undefined,
): IZCEffectSpec | null {
    if (!effectPrefabPath) return null;
    return SPEC_BY_PATH.get(effectPrefabPath) ?? null;
}

/** 路径 → 宿主节点整体倍率；未登记 / 非法值 = `1`。*/
export function zcEffectNodeScaleOf(
    effectPrefabPath: string | null | undefined,
): number {
    const scale = zcEffectSpecOfPath(effectPrefabPath)?.nodeScale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 1;
    return scale;
}

/** 路径 → 锚点；未登记 = `caster`。*/
export function zcEffectAnchorOf(
    effectPrefabPath: string | null | undefined,
): ZCEffectAnchor {
    return zcEffectSpecOfPath(effectPrefabPath)?.anchor ?? 'caster';
}

/** 路径 → 弹道竖直补偿（视图 px）；未登记 / 非法值 = `0`。*/
export function zcEffectLiftYOf(
    effectPrefabPath: string | null | undefined,
): number {
    const lift = zcEffectSpecOfPath(effectPrefabPath)?.liftY;
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}

/** 路径 → 层级覆盖；未登记 = `null`（调用方回落到事件类型口径）。*/
export function zcEffectLayerOfPath(
    effectPrefabPath: string | null | undefined,
): ZCEffectLayer | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.layer ?? null;
}

/** 路径 → 叠层子节点名；未登记 = `null`。*/
export function zcEffectOverlayChildOf(
    effectPrefabPath: string | null | undefined,
): string | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.overlayChild ?? null;
}

/** 路径 → 飞行配置；未登记 = `null`（不飞）。*/
export function zcEffectFlightOf(
    effectPrefabPath: string | null | undefined,
): IZCEffectFlight | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.flight ?? null;
}

/** 路径 → 朝向偏移（度）；飞行段自带的偏移优先，其次只转身条目，未登记 = `null`。*/
export function zcEffectFacingOffsetOf(
    effectPrefabPath: string | null | undefined,
): number | null {
    const spec = zcEffectSpecOfPath(effectPrefabPath);
    if (!spec) return null;
    if (spec.flight) return spec.flight.facingOffsetDegrees;
    return spec.facingDegrees ?? null;
}

/** 路径 → 消失前淡出秒数；未登记 / 非法值 / 非正数 = `0`。*/
export function zcEffectFadeSecondsOf(
    effectPrefabPath: string | null | undefined,
): number {
    const seconds = zcEffectSpecOfPath(effectPrefabPath)?.fadeSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds;
}

/**
 * 路径 → 事件寿命下限（秒）；未登记 / 非法值 / 非正数 = `0`（调用方沿用原寿命）。
 *
 * 只用于「一次性长演出」：登记了就必须让事件活过整段 clip，
 * 否则 `ZCGameModel` 会在动画播完前把节点摘掉。返回 0 表示「不改」。
 */
export function zcEffectDurationOf(
    effectPrefabPath: string | null | undefined,
): number {
    const seconds = zcEffectSpecOfPath(effectPrefabPath)?.durationSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds;
}

/** 路径 → 乘算叠加色；未登记 / 空路径 / 通道非法 = `null`。*/
export function zcEffectTintOf(
    effectPrefabPath: string | null | undefined,
): ZCEffectTint | null {
    const tint = zcEffectSpecOfPath(effectPrefabPath)?.tint;
    if (!tint) return null;
    for (const channel of tint) {
        if (!Number.isFinite(channel)) return null;
    }
    return tint;
}

/** 单位 → 导弹特效配置；未登记 = `null`（不是导弹，走普通多点打击）。*/
export const ZC_EFFECT_MISSILE_BY_UNIT: Readonly<Record<string, IZCEffectMissileSpec>> = {
    '68010': {
        missilePrefabPath: ZC_EFFECT_PATHS.missileBody,
        impactPrefabPath: ZC_EFFECT_PATHS.missileImpact,
        arcOffset: 36,
        speed: 200,
        count: 3,
    },
};

/** 单位 → 导弹特效配置；未登记 = `null`。*/
export function zcEffectMissileOf(unitId: string): IZCEffectMissileSpec | null {
    return ZC_EFFECT_MISSILE_BY_UNIT[unitId] ?? null;
}

/** 单位 → 导弹弹体 / 爆炸两条路径；未登记 = 空数组。*/
export function zcEffectMissilePathsForUnit(unitId: string): readonly string[] {
    const fx = ZC_EFFECT_MISSILE_BY_UNIT[unitId];
    return fx ? [fx.missilePrefabPath, fx.impactPrefabPath] : [];
}

/** 所有登记过的导弹特效路径（弹体 + 爆炸，去重），供资源清单扫描。*/
export function zcEffectMissilePaths(): readonly string[] {
    const paths = new Set<string>();
    for (const fx of Object.values(ZC_EFFECT_MISSILE_BY_UNIT)) {
        paths.add(fx.missilePrefabPath);
        paths.add(fx.impactPrefabPath);
    }
    return [...paths];
}

/**
 * 行为键（+ 可选单位 id）→ 本组路径；未登记 / 不匹配 = 空数组。
 *
 * 资源计划与模型触发系统共用这一条判据，避免「播不播」和「加不加载」各写一遍。
 */
export function zcEffectPathsForBehavior(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): readonly string[] {
    if (!behaviorKey) return [];
    const spec = BEHAVIOR_BY_KEY.get(behaviorKey);
    if (!spec) return [];
    if (unitId) {
        const override = spec.unitPrefabPaths?.[unitId];
        if (override) return override;
    }
    return spec.prefabPaths;
}

/** 目录中登记的全部特效路径（含表现表、行为组、单位覆盖与导弹），去重。*/
export function zcAllEffectPaths(): readonly string[] {
    const paths = new Set<string>();
    for (const spec of ZC_EFFECT_SPECS) paths.add(spec.prefabPath);
    for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
        for (const path of spec.prefabPaths) paths.add(path);
        for (const unitPaths of Object.values(spec.unitPrefabPaths ?? {})) {
            for (const path of unitPaths) paths.add(path);
        }
    }
    for (const path of zcEffectMissilePaths()) paths.add(path);
    return [...paths];
}

/**
 * 全局开战预热必须携带的代码级路径。
 *
 * 只收 `warmup: true` 的行为组 + 导弹表；不能直接用 `zcAllEffectPaths()`，
 * 否则瞬间移动 / 光环 / 落雷 / 陷阱等按需资源会被全量预载，改变首包体积与加载集合。
 */
export function zcWarmupEffectPaths(): readonly string[] {
    const paths = new Set<string>();
    // 导弹表先收：与旧实现的追加顺序一致（弹体 / 爆炸 → 孢爆 → 爆发 → 突刺 → 冲锋 → 风弹）。
    for (const path of zcEffectMissilePaths()) paths.add(path);
    for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
        if (!spec.warmup) continue;
        for (const path of spec.prefabPaths) paths.add(path);
    }
    return [...paths];
}

/** 受击表面 → 锚点纵向补偿（视图 px）；未知 / 非法值 = 0。*/
export function zcEffectHitFxSurfaceLiftY(
    surface: ZCEffectHitSurface | null | undefined,
): number {
    if (!surface) return 0;
    const lift = ZC_HIT_FX_SURFACE_LIFT_Y[surface];
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}

/** prefab 路径 → 拖尾配置；未登记 / 非法入参 = `null`。*/
export function zcEffectTrailOf(prefabPath: string | null | undefined): IZCEffectTrailSpec | null {
    if (!prefabPath) return null;
    return ZC_EFFECT_TRAIL_SPECS[prefabPath] ?? null;
}

/** 所有登记过拖尾的 prefab 路径（给资源清单 / 测试用）。*/
export function zcEffectTrailPaths(): readonly string[] {
    return Object.keys(ZC_EFFECT_TRAIL_SPECS);
}

/** 特效路径 → 光束配置；未登记 = `null`（走通用弹道）。*/
export function zcEffectBeamOf(effectPrefabPath: string | null | undefined): IZCEffectBeamSpec | null {
    if (!effectPrefabPath) return null;
    return ZC_EFFECT_BEAM_SPECS[effectPrefabPath] ?? null;
}
