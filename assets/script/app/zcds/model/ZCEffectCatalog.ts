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

export type ZCEffectAnchor = 'caster' | 'midpoint';
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
        prefabPaths: [ZC_EFFECT_PATHS.lightningImpact],
        notes: '矩形光束；复用雷电冲击，预热不单收（首战由本局清单加载）',
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
        notes: 'auraRadius 200；分母 = 256×0.58，改半径需同步倍率',
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
