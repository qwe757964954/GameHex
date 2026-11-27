/** 战斗特效资源与表现参数目录 */

import { ZC_EFFECT_TUNING } from './ZCEffectTuning';
import type { IZCBulletWobble } from './ZCBulletWobble';

/** 特效锚点：`caster` = 出手方（既有口径）、`midpoint` = 攻击者与受击目标的连线中点、
 *  `target` = 受击方（「一定落在目标坐标」的重击类）。*/
export type ZCEffectAnchor = 'caster' | 'midpoint' | 'target';

/** 特效层级：`ground` = 铺在地上（棋盘之上、动态对象之下）；`top` = 动态对象最上层。*/
export type ZCEffectLayer = 'ground' | 'top';
export type ZCEffectTint = readonly [number, number, number];
export type ZCEffectHitSurface = 'unit' | 'wall' | 'building';

export interface IZCEffectFlight {
    readonly speed: number;               // 世界坐标 px/s
    readonly minSeconds: number;
    readonly maxSeconds: number;
    readonly facingOffsetDegrees: number; // 美术正前方与飞行方向夹角，逆时针为正
}

export interface IZCEffectMissileSpec {
    readonly missilePrefabPath: string;
    readonly impactPrefabPath: string;
    readonly arcOffset: number;           // 弧线中段最大横向偏移（世界坐标）
    readonly speed?: number;              // 缺省复用技能 projectileSpeed
    readonly count?: number;              // 缺省取配表 strikeCount
    /**
     * 是否进「开战预热」（首包预下载）。缺省 `true` = 进（既有镭射飞龙的状态）。
     *
     * 置 `false` 的场合：素材体积大、且只属于少数单位 —— 这类靠
     * `ZCVisualResourcePlan` 按本局阵容收（第 97 行 `zcEffectMissilePathsForUnit`），
     * 有那位单位才加载，不该让每一局都白下几 MB。
     */
    readonly warmup?: boolean;
}

export interface IZCEffectSpec {
    readonly prefabPath: string;
    readonly nodeScale?: number;
    readonly anchor?: ZCEffectAnchor;
    readonly liftY?: number;              // 视图 px，加在 mapToViewY 后
    readonly layer?: ZCEffectLayer;
    readonly overlayChild?: string;
    readonly flight?: IZCEffectFlight;
    readonly facingDegrees?: number;
    readonly fadeSeconds?: number;
    /** 一次性长演出下限寿命（秒）；近战/区域默认 0.32s，长动画需配置以防播到一半被摘除 */
    readonly durationSeconds?: number;
    readonly tint?: ZCEffectTint;         // [r, g, b], 0~255
    /**
     * 飞行途中的「挤压式抖动」（2026-11-26 第 57 批）。
     *
     * 只对**有飞行段**的弹体有意义：视图按事件已活时间算倍率，乘在 prefab 的 `body`
     * 子节点上（结构见 `tools/build_card_bullet_fx.py`）。不登记 = 不抖，
     * 存量弹体一次都不碰。算法与四个关键帧见 `ZCBulletWobble`。
     */
    readonly wobble?: IZCBulletWobble;
    readonly notes?: string;
}

export interface IZCEffectBehaviorSpec {
    readonly behaviorKey: string;
    readonly prefabPaths: readonly string[];
    readonly unitPrefabPaths?: Readonly<Record<string, readonly string[]>>;
    /** 为 true 时进全局开战预热，否则随对局资源计划按需加载 */
    readonly warmup?: boolean;
    readonly notes?: string;
}

export interface IZCEffectTrailSpec {
    readonly startX: number;              // 本地 px
    readonly length: number;              // 本地 px，沿 -X
    readonly rootHalfWidth: number;
    readonly tipHalfWidth: number;
    readonly slices: number;
    readonly color: readonly [number, number, number];
    readonly alpha: number;
}

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

export const ZC_EFFECT_PATHS = {
    stormEgg: 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风',
    missileImpact: 'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中',
    missileBody: 'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能',
    windHurricane: 'units/projectiles/风法师_龙卷风/风法师_龙卷风',
    deerGuard: 'units/projectiles/鹿神守护/鹿神守护',
    bigFist: 'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效',
    sustainedAura: 'units/projectiles/持续光环伤害效果/持续光环伤害效果',
    lightningBullet: 'units/projectiles/雷弹攻击/雷弹攻击',
    thunderBulletImpact: 'units/projectiles/雷弹命中/雷弹命中',
    // 独立美术（贴图已按屏上尺寸重烘，倍率 1），勿与 thunderBulletImpact 合并
    cidianBulletImpact: 'units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中',
    // 与落雷 bolt（端头亮团+细丝）区分，链路各段需首尾相接
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
    // prefab/anim 由 tools/build_fission_spawn_fx.py 生成，勿手工改动；
    // 尺寸烘在画布 156×156 里（爆发 120 px），prefab 与目录都没有倍率
    fissionSpawn: 'units/projectiles/分裂菇_生成分身/分裂菇_生成分身',
    // prefab/anim 由 tools/build_xiantao_quake_fx.py 生成；地面裂纹半径 = 54 逻辑 px
    quakeStrike: 'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能',
    // 仙桃行者普攻刀光，走默认 caster / melee 兜底，不登记 spec
    spearSlash: 'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光',
    // 复用灼热地带素材，文明之火走事件级 tint 染蓝，保留原色给火焰树妖
    hotZone: 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能',
    iceCone: 'units/projectiles/冰法师_冰锥/冰法师_冰锥',
    // 机甲菇 101503「武器绞杀」的扇形挥击（2026-11-25 第 45 批）。
    // prefab/anim 由 `tools/build_jiajigu_fan_fx.py` 生成：前伸 = 判定半径 150 逻辑 px = 115.31 屏上 px，
    // 锚点在内容**左端**（施法者脚下），美术尖端朝 +X ⇒ 由 `facingDegrees: 0` 转到目标方向。
    jiajiguFan: 'units/projectiles/机甲菇_武器绞杀/机甲菇_武器绞杀',
    // 技能范围指示「白环」（戈壁狂箭 / 冰山陨落 / 篮球火 共用，2026-11-25 第 45 批）。
    // 由 `tools/build_range_ring_fx.py` 生成：scale 1 时横向半径 256 屏上 px、纵向 214
    // （地面透视 0.8361），内部白色填充不透明度 35%。尺寸只走事件级 `effectScale`。
    skillRangeRing: 'units/projectiles/技能范围_白环/技能范围_白环',
    // 运动霸 68033「天外飞石」30853 的砸落演出（2026-11-25 第 46 批）。
    // prefab/anim 由 `tools/build_yundongba_meteor_fx.py` 生成：触地爆点（34 帧实际像素宽 286）
    // ↔ 判定圆直径 areaRadius 80 逻辑 px = 123 屏上 px，锚点落在冲击环椭圆圆心。
    yundongbaMeteor: 'units/projectiles/运动霸_砸落技能/运动霸_砸落技能',
    // 战士通用剑气（2026-11-25 第 49 批）：菌盾冲锋 101204 / 冲锋 102303 / 尖刺冲锋 102703
    // 三条冲锋车道原本都播 `轻骑兵_冲锋` 那张骑兵残影，本批统一换成这张剑气。
    // prefab/图集由 `tools/build_warrior_qi_fx.py` 生成（飞行定格帧 = `070-1-Skill_1_24`，1 帧）。
    // 🔴 美术凸面朝 **−X**，飞行朝向偏移 180° 登记在 spec 的 `flight` 里（漏了就是「剑气横着飞」）。
    warriorQi: 'units/projectiles/战士通用剑气/战士通用剑气',
    // 冰法师通用子弹（2026-11-25 第 51 批）：急冻瓜 68024 的【急冻光线】（弹体）与
    // 【冰山陨落】（落地那一击）共用同一颗子弹。prefab / anim 由
    // `tools/build_ice_mage_bullet_fx.py` 生成（两级节点 + 循环序列帧，与剑气同构）。
    iceMageBullet: 'units/projectiles/冰法师通用子弹/冰法师通用子弹',
    /** 上面那颗的命中爆炸（13 帧一次性 1.083s）。*/
    iceMageBulletImpact: 'units/projectiles/冰法师通用子弹命中/冰法师通用子弹命中',
    // 通用治疗特效（2026-11-25 第 47 批）：Spine 素材 `eff_cost_01`，动画 `eff_buff_heal`。
    // 预制体手写（参照 `鹿神守护.prefab` 的两级结构：根 Node + 子 Node `spine`），
    // 与素材同目录。**所有治疗共用一个 prefab**，所以不留 `overlayChild`、不染 `tint`：
    // 一旦按路径查表染色/叠层，任何一处改表都会把全部治疗一起改掉。
    healAura: 'units/projectiles/通用治疗特效/通用治疗特效',
    // ── 卡牌常用子弹（2026-11-26 第 57 批）─────────────────────────────────────
    // 用户口径：「给卡牌常用的子弹制作统一格式的预制体」——七张卡（豌豆游侠 / 毒箭菇 /
    // 杰克藕 / 大嘴花 / 仙桃行者 / 玉林好汉 / 诅咒菇）统一成「一张主体图 + 白色三角形拖尾」。
    //
    // 🔴 prefab 由 `tools/build_card_bullet_fx.py` 从同目录碎图**批量生成**，不要手改：
    //   结构固定为「根 + `body`」（`body` 承载缩放与抖动），七份逐字同构。
    //   要调大小改脚本顶部的 `TARGET_EQUIV_DIAMETER` / `MAX_LONG_EDGE` 后重跑。
    // 🔴 拖尾**不在 prefab 里**：它登记在下面的 `ZC_EFFECT_TRAIL_SPECS`，视图用 `Graphics`
    //   画在宿主节点上。所以这七条 spec 一律不写 `nodeScale`（宿主 scale = 1 ⇒
    //   拖尾数值的「本地 px」就是「屏上 px」，七张卡才能共用同一组数字）。
    cardBulletPea: 'units/projectiles/卡牌常用子弹物件/豌豆游侠_子弹',
    cardBulletDujuan: 'units/projectiles/卡牌常用子弹物件/毒箭菇_子弹',
    cardBulletJack: 'units/projectiles/卡牌常用子弹物件/杰克藕_子弹',
    cardBulletMouth: 'units/projectiles/卡牌常用子弹物件/大嘴花_子弹',
    cardBulletPeach: 'units/projectiles/卡牌常用子弹物件/仙桃行者_子弹',
    cardBulletYulin: 'units/projectiles/卡牌常用子弹物件/玉林好汉_子弹',
    cardBulletCurse: 'units/projectiles/卡牌常用子弹物件/诅咒菇_子弹',
    //  破阵术（投枪）的**缺省**弹体：没登记专属美术的卡仍用这把通用箭矢。
    //  2026-11-26 第 57 批从 `ZCAttackResolutionSystem` 的字面量挪进目录 ——
    //  `tests/zcds-effect-path-parity.test.ts` 的守卫要求「`*Fx.ts` 里不许出现路径字面量」，
    //  而投枪弹体表已经迁到 `ZCLanceFx.ts`（资源计划要能按阵容收它）。
    lanceArrow: 'units/projectiles/子弹_新怪物/通用箭矢',
} as const;

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
    /** 无独立 prefab，命中播 quakeStrike（路径随 unitPrefabPaths['68009'] 收取） */
    dashChain: 'dash_chain',
    /** 追踪打击（群星坠落 / 戈壁箭雨），弹体走 `zcMissileFxOf`，本身没有 castXxx 回调 */
    randomStrike: 'random_strike',
    summonUnit: 'summon_unit',
    /** 纯数据参数袋车道，按单位覆盖补收个别表现资源 */
    skillParams: 'skill_params',
    /** 按单位覆盖群体治疗的护盾表现，避免无护盾的同车道技能预载 */
    selfCast: 'self_cast',
    /** 通用治疗光环：不在任何技能车道上，靠预热常驻（治疗来自吸血 / 群体治疗等多条路） */
    healAura: 'heal_aura',
} as const;

/** wind_bolt / missile_barrage 合收四件套，防止双主动卡只加载一半资源 */
export const ZC_EFFECT_BEHAVIOR_SPECS: readonly IZCEffectBehaviorSpec[] = [
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.blinkStrike,
        prefabPaths: [ZC_EFFECT_PATHS.blink],
        notes: '施法瞬间闪现',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfAura,
        prefabPaths: [ZC_EFFECT_PATHS.sustainedAura],
        unitPrefabPaths: {
            '68025': [ZC_EFFECT_PATHS.selfAuraFlame],
            '68016': [ZC_EFFECT_PATHS.lightningImpact],
            '68026': [ZC_EFFECT_PATHS.selfAuraFire],
        },
        notes: '默认光柱；按单位覆盖，改半径需同步 auraRadius',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.boltStrike,
        prefabPaths: [ZC_EFFECT_PATHS.bolt],
        notes: '五雷轰顶落雷',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.chainDamage,
        prefabPaths: [ZC_EFFECT_PATHS.chainArc],
        notes: '首尾相接的水墨电弧，与落雷分开',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.trapPlace,
        prefabPaths: [
            ZC_EFFECT_PATHS.trapSpawn,
            ZC_EFFECT_PATHS.trapIdle,
            ZC_EFFECT_PATHS.trapExpire,
            // 蘑菇爆炸 101704 按 skillId 切用 burstImpact
            ZC_EFFECT_PATHS.burstImpact,
        ],
        notes: '生成/常驻/爆炸；101704 爆炸切用 burstImpact',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.splashShot,
        prefabPaths: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '弹体 + 爆点；与 spore_burst 共用',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst,
        prefabPaths: [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '弹体 + 爆点；与 splash_shot 共用',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.burstAura,
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '自身圆心爆点',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.burstKnockback,
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        warmup: true,
        notes: '自身圆心爆点',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.fanSlow,
        //  2026-11-25 第 45 批：扇形甩击不再「在扇形里铺 3 发爆点」，改成整条扇形挥击特效
        //  （`tools/build_jiajigu_fan_fx.py`）。爆点那条路径仍在 `burst_aura` / `splash_*` 组里预热，
        //  这里不再重复登记 —— 一组一条，别让「3 发爆点」的旧口径藏在清单里。
        prefabPaths: [ZC_EFFECT_PATHS.jiajiguFan],
        notes: '扇形挥击单条特效，尺寸 = fanRadius，锚点在施法者、尖端朝目标',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.singleStrike,
        prefabPaths: [ZC_EFFECT_PATHS.singleStrike],
        warmup: true,
        notes: '贴目标播放撕裂',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.chargeShield,
        //  2026-11-25 第 49 批：残影 → 【战士通用剑气】。`chargeDash`（轻骑兵_冲锋）不再由
        //  任何车道推送 —— 它还留着，是因为配表 30191「轻骑兵普攻」的 `effectPrefabPath`
        //  仍按字面量取那张图（那条路不经过目录，也不预热），目录里的 spec 只为它保留口径。
        prefabPaths: [ZC_EFFECT_PATHS.warriorQi, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '剑气飞行 + 落地护盾',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.legacyDash,
        prefabPaths: [ZC_EFFECT_PATHS.warriorQi, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '剑气飞行 + 落地护盾；与 charge_shield 共用',
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
        notes: '风弹/飓风/导弹/命中四件套；与 missile_barrage 共组',
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
        notes: '风弹/飓风/导弹/命中四件套；与 wind_bolt 共组',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.stormZone,
        prefabPaths: [ZC_EFFECT_PATHS.windHurricane],
        notes: '移动飓风；预热由 wind_bolt 组覆盖',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.rayBeam,
        // 用镭射飞龙同图保持红色光束（青底素材无法靠乘法染色提纯红），半长同步 ZCEffectTuning.rayBeamReferenceHalfLength
        prefabPaths: [ZC_EFFECT_PATHS.laserAttack],
        notes: '矩形光束，共用镭射飞龙红图',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.fireZone,
        // 蓝色由事件级 tint 提供，目录不写死
        prefabPaths: [ZC_EFFECT_PATHS.hotZone],
        notes: '复用灼热地带素材，事件级 tint 染蓝',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.summonUnit,
        prefabPaths: [
            ZC_EFFECT_PATHS.fissionSpawn,
            // 舞王脚底光环复用 sustainedAura，仅在有该车道时按需加载
            ZC_EFFECT_PATHS.sustainedAura,
        ],
        notes: '分身生成爆点 + 舞王脚底光环（仅 68014 / 68031 按需加载）',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.skillParams,
        prefabPaths: [],
        unitPrefabPaths: {
            '68002': [ZC_EFFECT_PATHS.dashGuard],
            '68009': [ZC_EFFECT_PATHS.quakeStrike],
        },
        // 仅补对局资源清单；不设 warmup（dashGuard 已有冲锋组预热，公共路径置空防泛载）
        notes: '按单位补收：68002 护盾 / 68009 重击柱',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfCast,
        prefabPaths: [],
        unitPrefabPaths: { '68006': [ZC_EFFECT_PATHS.dashGuard] },
        notes: '按单位补收：68006 群体治疗附带护盾',
    },
    {
        //  2026-11-25 第 47 批：治疗光环。**没有一个技能车道认领它** —— 治疗来自吸血 / 吃口菠萝 /
        //  群体治疗 / 贯穿滋养四条完全不同的路，都在 `healUnit` 汇成一次 `presentHeal`。
        //  所以按车道收集必然漏，只能整体预热（`warmup: true` ⇒ 进 `zcWarmupEffectPaths`）。
        //  代价是一张 174KB 的图集常驻；漏收的代价是「治疗了但没特效」，两害取轻。
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.healAura,
        prefabPaths: [ZC_EFFECT_PATHS.healAura],
        warmup: true,
        notes: '通用治疗光环：跨四条治疗路径共用，只能预热；时长见 ZCEffectTuning.healAuraSeconds',
    },
];

export const ZC_EFFECT_SPECS: readonly IZCEffectSpec[] = [
    {
        prefabPath: ZC_EFFECT_PATHS.stormEgg,
        nodeScale: 0.7,
        notes: '30831 暴风：改倍率需同步 pvpSkill.areaRadius',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.missileImpact,
        nodeScale: 123 / 202,
        notes: 'strikeSplashRadius 80 逻辑；分母取可见宽 202（非画布 225）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.missileBody,
        nodeScale: 0.8,
        notes: '与爆炸 0.609 配套',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.windHurricane,
        nodeScale: 0.5,
        tint: [96, 255, 128],
        notes: '36251 飓风：areaRadius 60->30 需同步；同路径用于 101303 区域',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.deerGuard,
        nodeScale: 100 / 685,
        layer: 'top',
        overlayChild: 'fx_火船',
        notes: '画布高 685->100px；层序按 area 置顶',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.bigFist,
        nodeScale: 2.5,
        notes: '仅视觉',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.sustainedAura,
        //  2026-11-26：贴图已裁掉画布空边、按屏上尺寸重烘（画布 215×90，可见环 184×72），
        //  prefab 两级 `_lscale` 都是 1 ⇒ 这里不再登记 nodeScale（之前是 307.5 / (256 * 0.58) = 2.070986）。
        //  可见环 184 匹配 68021/68024 的 120 半径；200 半径（舞王）走事件 effectScale（ZC_SUMMON_AURA_COVER_SCALE）。
        notes: '贴图即屏上尺寸（画布 215×90，环 184×72）；改大小走事件 effectScale',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.lightningBullet,
        nodeScale: 0.35,
        notes: '雷蕉电弹；与拖尾宽度配套调整',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.chargeDash,
        nodeScale: 0.4,
        anchor: 'midpoint',
        //  2026-11-25 第 49 批起**没有代码引用这条**：三条冲锋车道改播 `warriorQi`。
        //  它还在是因为配表 30191「轻骑兵普攻」的 `effectPrefabPath` 按字面量取这张图，
        //  那条路不查目录、也不进预热 ⇒ 这里的锚点 / 倍率只为它保口径。别顺手删。
        notes: '线段中点残影（仅 30191 配表路径在用，已不在冲锋车道上）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.dashGuard,
        nodeScale: 0.55,
        notes: '落地护盾缩放',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.nutAttack,
        anchor: 'midpoint',
        notes: '30802/30803 播在出手与受击中点',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.yulinDart,
        liftY: 20,
        notes: '脚点到身体中心补偿 20 视图 px',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.yulinDartEmpowered,
        liftY: 20,
        notes: '与普攻高度一致',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.clownDart,
        liftY: 30,
        notes: '脚点到身体中心补偿 30 视图 px',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.axeBlade,
        flight: {
            speed: 420,
            minSeconds: 0.14,
            maxSeconds: 0.6,
            facingOffsetDegrees: 0,
        },
        notes: '30271；美术正面 +X',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.boxerStrike,
        facingDegrees: 180,
        notes: '30713/30852；美术正面 -X',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.laserAttack,
        fadeSeconds: 0.18,
        notes: '30719/30845 命中后定格 0.18s',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.thunderBulletImpact,
        nodeScale: 0.5,
        // 仅影响视觉，不改 areaRadius 判定；同图与雷弹攻击共享资产，勿直接改 prefab
        notes: '30231 命中爆点（烘焙 0.7 * 0.5 = 0.35）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cidianBulletImpact,
        //  2026-11-26：旧值是下载 0.4 × 宿主 0.5 = 屏上 0.2，两层倍率都去掉 —— 贴图已按屏上尺寸
        //  重烘（458×495 裁到内容 308×401 再缩成 62×80），这里不再挂 nodeScale。
        notes: '30717 命中爆点（贴图即屏上尺寸 62×80，prefab 与目录倍率都是 1）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.quakeStrike,
        anchor: 'target',
        // area 默认压地面，重击柱需置顶
        layer: 'top',
        // 尺寸已烘焙在画布（144×321，prefab 与目录都没有倍率），改判定需同步
        // tools/build_xiantao_quake_fx.py 与 skillParamJson.quakeRadius
        notes: '68009 重击；地面裂纹匹配判定圆',
        durationSeconds: ZC_EFFECT_TUNING.quakeStrikeSeconds,
    },
    {
        //  2026-11-25 第 45 批：机甲菇 101503「武器绞杀」的扇形挥击。
        //  🔴 `facingDegrees: 0` 是**必须登记的**：不登记就退回「美术朝哪边就朝哪边」，
        //  敌人站在左/上/下时整条挥击都朝着右边甩（与第 42 批长枪兵刀光同一个坑）。
        //  尖端在 +X ⇒ 偏移 0，转角度 = 施法者→落点方向。
        prefabPath: ZC_EFFECT_PATHS.jiajiguFan,
        facingDegrees: 0,
        layer: 'top',
        // 一次性 19 帧 = 0.792s，与 `ZC_FAN_SWEEP_SECONDS` 同源（见 ZCFanSweepFx）。
        durationSeconds: ZC_EFFECT_TUNING.fanSweepSeconds,
        notes: '扇形挥击：前伸 = fanRadius（150 逻辑 = 115.31 屏上 px）',
    },
    {
        //  2026-11-25 第 45 批：范围指示白环。地面层、不跟随单位、尺寸只走事件级 effectScale
        //  （`area` 类从不按 `event.radius` 缩放，同 §43 的口径）。
        prefabPath: ZC_EFFECT_PATHS.skillRangeRing,
        layer: 'ground',
        notes: '技能范围圈：scale 1 = 横向半径 256 屏上 px，纵向 214（透视 0.8361）',
    },
    {
        //  2026-11-25 第 46 批：运动霸 68033「天外飞石」30853。
        //  🔴 这条路径**只在 `pvpSkill.effectPrefabPath` 里配**（与第 42 批重骑兵 36241
        //  「只换图」同一条路），模型侧没有任何代码引用它 —— 别去 `castXxx` 里加推事件。
        //  `area` 事件默认压地面层，但这一份是「货盘从天上砸下来 + 火焰＋尘柱往上冒」：
        //  压在地面层会被站在落点上的角色挡住，读不出「砸在他们头上」，故置顶（同重击柱）。
        //  层是 `area`，尺寸已烘焙进 prefab（`_lscale = 0.6367`）—— `area` 类从不按
        //  `event.radius` 缩放（§43），改 `areaRadius` 需同步生成脚本重跑。
        prefabPath: ZC_EFFECT_PATHS.yundongbaMeteor,
        layer: 'top',
        //  33 帧一次性演出 = 1.375s。区域那一路的事件寿命默认取 `zone.waveInterval`
        //  （天外飞石 durationSeconds = 0 ⇒ 0 秒，一帧就没了），靠这一格抬到 clip 长度。
        durationSeconds: ZC_EFFECT_TUNING.meteorSlamSeconds,
        notes: '天外飞石：爆点外沿 = 判定圆（areaRadius 80 → 123 屏上 px）',
    },
    {
        //  2026-11-25 第 47 批：通用治疗特效（Spine）。
        //  · `layer: 'top'` —— 治疗光环比角色小一圈、要压在角色身上才读得出「回血了」，
        //    压地面层会被站在圈里的角色挡住。`area` 事件默认 `ground`，所以必须显式登记。
        //  · `nodeScale: 0.5` —— 素材是 `eff_cost_01`，中枢光斑 `heal_c` 在骨架坐标里就是
        //    93×83 px，与兵种视觉画布 98 同量级 ⇒ 1.0 时核心正好盖住一个角色。
        //    2026-11-25 用户实机看完口径「治疗特效缩小成 50%」⇒ **1.0 → 0.5**（核心 ≈46×41，
        //    约半个角色）。要再整体放大/缩小**只改这一格**（全局基准，事件级 `effectScale` 在其上再乘）。
        //    🔴 宿主缩放不参与 `visualLiftPx`：抬升 49 是屏幕竖直偏移，缩小只是「绕同一点变小」，
        //    光环中心仍在身体中线，别跟着把 lift 也乘 0.5（那样会沉到脚下）。
        //  · Spine 的取景尺寸不走 `UITransform`（骨架自己带坐标），所以 `_contentSize` 只是编辑器
        //    里的把手；改大小写 `nodeScale` 或事件级 `effectScale`，别去改 prefab 的 `_lscale`，
        //    那一层会被 `ZCCombatEffectView.render` 的 `setScale` 直接覆盖掉。
        prefabPath: ZC_EFFECT_PATHS.healAura,
        nodeScale: 0.5,
        layer: 'top',
        durationSeconds: ZC_EFFECT_TUNING.healAuraSeconds,
        notes: '通用治疗光环：动画 eff_buff_heal（一次性 1.0s），基准 0.5 × 体型半程跟随',
    },
    {
        //  2026-11-25 第 49 批：战士通用剑气（冲锋三卡共用的一张）。
        //  · `flight` 而不是 `facingDegrees` —— 这一条是**子弹**：位置按 `from → to` 逐帧插值，
        //    转角走飞行分支。不登记 `flight` 的话视图会落到「贴锚点播一次」那条路，
        //    `facingDegrees` 也能转对，但**不会动**，读不出「剑气劈出去」。
        //  · `facingOffsetDegrees: 180`：素材是 C 形月牙、凸面朝 **−X**（示例图红箭头 = 飞行方向
        //    也正是凸面指向）⇒ 转角 = 弹道方向 + 180。🔴 漏掉它 = 剑气横着飞，且不报错。
        //  · 尺寸**烘在画布**（123×141 就是屏上尺寸，prefab 两级 `_lscale` 都是 1），所以这里
        //    不写 `nodeScale`；要改大小重跑 `tools/build_warrior_qi_fx.py` 的 `CANVAS_H`。
        //  · 寿命不在这里给：冲锋事件自带 `ZCEffectTuning.dashSeconds`（0.3s），
        //    单帧素材没有「播完」的概念，别拿 clip 时长去顶事件寿命。
        prefabPath: ZC_EFFECT_PATHS.warriorQi,
        layer: 'top',
        flight: {
            speed: 420,
            minSeconds: 0.14,
            maxSeconds: 0.6,
            facingOffsetDegrees: 180,
        },
        notes: '冲锋三卡共用；飞行定格帧 skill_1_24，凸面朝 -X',
    },
    {
        //  2026-11-25 第 51 批：急冻瓜 68024 两颗子弹共用的【冰法师通用子弹】。
        //  用户在两条技能上都要它：【急冻光线】102404（`random_strike` 的 missile 分支，水平飞）
        //  与【冰山陨落】102403（`self_aura` 的落地一击，垂直砸）。
        //  · `flight` 而不是 `facingDegrees`：急冻光线走的是 `pushProjectile` 的**弹道**，
        //    转角在 `ZCCombatEffectView` 的 projectile 分支算（那里按 `flight.facingOffsetDegrees`
        //    补偏移）。只登记 `facingDegrees` 的话弹道那条读不到，冰爆会横着飞且不报错。
        //  · 🔴 `facingOffsetDegrees: -90`：素材**正前方是 +Y**（逐帧量 alpha>8 的框可证：第 0 帧
        //    是 200×200 的冰爆贴上方，之后内容只往下长到 y=581 ⇒ 冰爆头在上、尾迹在下）。
        //    转角 = 弹道方向 − 90，冰爆头才朝着目标。
        //    垂直下落那条（冰山陨落）走**事件级** `angleDegrees`（见 `ZCSelfAuraFx` 的 180°），
        //    同一个 −90 也正好等价：−90 + (−90) = −180 ⇒ 箭头朝下直线落。
        //  · 尺寸烘焙在 prefab（`offset._lscale = 0.3` ⇒ 屏上 37×77），这里不写 `nodeScale`；
        //    要改大小重跑生成脚本的 `scale`。🔴 **不许按弹道距离 / 判定半径拉伸**
        //    —— 用户口径「急冻光线不用拉长，直接当场急冻子弹使用」。
        prefabPath: ZC_EFFECT_PATHS.iceMageBullet,
        layer: 'top',
        flight: {
            speed: 420,
            minSeconds: 0.12,
            maxSeconds: 0.55,
            facingOffsetDegrees: -90,
        },
        notes: '急冻光线弹体 / 冰山陨落落地一击；素材正前方 +Y，循环序列帧 7 帧 @24',
    },
    {
        //  命中爆炸与弹体同一个 prefab 家族（13 帧一次性 1.083s @12）。
        //  不给 `flight`：命中是原地播的一次性演出，没有"飞行方向"可言。
        prefabPath: ZC_EFFECT_PATHS.iceMageBulletImpact,
        layer: 'top',
        notes: '冰法师通用子弹命中；13 帧一次性，尺寸烘焙在 prefab（0.5 ⇒ 屏上 88×128）',
    },
    // ── 卡牌常用子弹：七颗统一格式的弹体（2026-11-26 第 57 批）───────────────────
    //  七条都不写 `nodeScale`（缩放烘在 prefab 的 `body._lscale`）⇒ 宿主 scale = 1
    //  ⇒ 下面 `ZC_EFFECT_TRAIL_SPECS` 里的「本地 px」就是「屏上 px」，七张卡共用同一组拖尾数字。
    //  也都不写 `flight`：素材一律朝 +X（用户给的示意里灰色三角拖尾都在素材左侧、红箭头朝右），
    //  朝向偏移缺省 0 就是对的。改朝向该改这里，**不要**回头转 prefab（脚本会覆盖）。
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletPea,
        layer: 'top',
        notes: '豌豆游侠子弹：绿球，屏上 48×48；普攻 30701 + 机关枪连发共用',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletDujuan,
        layer: 'top',
        //  用户口径「做 scale 的 Y 轴缩放模仿抖动 1-1.05-0.95-1」：扔出去的蘑菇上下挤。
        wobble: { axis: 'y', amount: 0.05, periodSeconds: 0.28 },
        notes: '毒箭菇子弹：蘑菇，屏上 48×48；蘑菇爆炸 101704 的**飞行段**（落地仍播陷阱）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletJack,
        layer: 'top',
        notes: '杰克藕子弹：橙子弹头，屏上 63×37；普攻 30717 + 戈壁箭雨弹道雨共用',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletMouth,
        layer: 'top',
        //  用户口径「做 scale 的 X 轴缩放模仿抖动」：蛇身横向一伸一缩，像在扭。
        wobble: { axis: 'x', amount: 0.05, periodSeconds: 0.28 },
        notes: '大嘴花子弹：蛇形藤，屏上 79×29；破阵术 100701 的投枪弹体',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletPeach,
        layer: 'top',
        notes: '仙桃行者子弹：红金箭，屏上 96×21；破阵术 100901 的投枪弹体',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletYulin,
        layer: 'top',
        notes: '玉林好汉子弹：玉米粒，屏上 59×39；普攻 30716',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.cardBulletCurse,
        layer: 'top',
        notes: '诅咒菇子弹：弯刀，屏上 84×28；破阵术 101802 的投枪弹体（拖尾染紫）',
    },
];

/** 未登记的弹体不画拖尾；数值为宿主本地 px */
export const ZC_EFFECT_TRAIL_SPECS: Readonly<Record<string, IZCEffectTrailSpec>> = {
    [ZC_EFFECT_PATHS.missileBody]: {
        startX: -26,
        length: 100,
        rootHalfWidth: 20,
        tipHalfWidth: 2,
        slices: 12,
        color: [255, 255, 255],
        alpha: 0.62,
    },
    // 按宿主 0.35 缩放反算本地尺寸，维持屏上长 55、根半宽 8
    [ZC_EFFECT_PATHS.lightningBullet]: {
        startX: -57.142857,
        length: 157.142857,
        rootHalfWidth: 22.857143,
        tipHalfWidth: 2.857143,
        slices: 12,
        color: [255, 255, 255],
        alpha: 0.6,
    },
    // ── 卡牌常用子弹的「白色三角形拖尾」（2026-11-26 第 57 批）───────────────────
    //  🔴 这七条 spec 都**没写 `nodeScale`** ⇒ 宿主 scale = 1 ⇒ 下面的数字就是**屏上 px**，
    //    与上面两条（按宿主 0.35 缩放反算）的口径不同，别把两套数字混着抄。
    //  几何来源：`tools/build_card_bullet_fx.py` 的输出（`startX` = 主体后半段，
    //  `length` = 2 倍等效直径，`rootHalfWidth` ≈ 主体半高 × 0.75）。
    //  七条共用同一组长度/收缩曲线，只有「从哪儿开始」和「根部多宽」随主体走 ——
    //  这就是「统一格式」：看上去是同一套拖尾贴在不同子弹屁股上。
    [ZC_EFFECT_PATHS.cardBulletPea]: {
        startX: -14.3, length: 67.2, rootHalfWidth: 9.8, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    [ZC_EFFECT_PATHS.cardBulletDujuan]: {
        startX: -14.3, length: 67.2, rootHalfWidth: 9.8, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    [ZC_EFFECT_PATHS.cardBulletJack]: {
        startX: -18.8, length: 67.2, rootHalfWidth: 9.1, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    [ZC_EFFECT_PATHS.cardBulletMouth]: {
        startX: -23.5, length: 67.2, rootHalfWidth: 7.7, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    [ZC_EFFECT_PATHS.cardBulletPeach]: {
        startX: -28.5, length: 67.2, rootHalfWidth: 5.6, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    [ZC_EFFECT_PATHS.cardBulletYulin]: {
        startX: -17.5, length: 67.2, rootHalfWidth: 9.8, tipHalfWidth: 1.05, slices: 12,
        color: [255, 255, 255], alpha: 0.55,
    },
    //  用户口径「诅咒菇的拖尾是紫色的」：唯一一条非白拖尾。改色只改这一行。
    [ZC_EFFECT_PATHS.cardBulletCurse]: {
        startX: -24.8, length: 67.2, rootHalfWidth: 7, tipHalfWidth: 1.05, slices: 12,
        color: [186, 140, 255], alpha: 0.6,
    },
};

export const ZC_EFFECT_BEAM_SPECS: Readonly<Record<string, IZCEffectBeamSpec>> = {
    // 单位根在脚点，龙眼在 +44，末端补到模型中心 +30
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

export function zcEffectSpecOfPath(
    effectPrefabPath: string | null | undefined,
): IZCEffectSpec | null {
    if (!effectPrefabPath) return null;
    return SPEC_BY_PATH.get(effectPrefabPath) ?? null;
}

export function zcEffectNodeScaleOf(
    effectPrefabPath: string | null | undefined,
): number {
    const scale = zcEffectSpecOfPath(effectPrefabPath)?.nodeScale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 1;
    return scale;
}

export function zcEffectAnchorOf(
    effectPrefabPath: string | null | undefined,
): ZCEffectAnchor {
    return zcEffectSpecOfPath(effectPrefabPath)?.anchor ?? 'caster';
}

export function zcEffectLiftYOf(
    effectPrefabPath: string | null | undefined,
): number {
    const lift = zcEffectSpecOfPath(effectPrefabPath)?.liftY;
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}

/** 未登记返回 null，由调用方按事件类型回落 */
export function zcEffectLayerOfPath(
    effectPrefabPath: string | null | undefined,
): ZCEffectLayer | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.layer ?? null;
}

export function zcEffectOverlayChildOf(
    effectPrefabPath: string | null | undefined,
): string | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.overlayChild ?? null;
}

export function zcEffectFlightOf(
    effectPrefabPath: string | null | undefined,
): IZCEffectFlight | null {
    return zcEffectSpecOfPath(effectPrefabPath)?.flight ?? null;
}

/** 飞行段偏移优先于静态朝向偏移 */
export function zcEffectFacingOffsetOf(
    effectPrefabPath: string | null | undefined,
): number | null {
    const spec = zcEffectSpecOfPath(effectPrefabPath);
    if (!spec) return null;
    if (spec.flight) return spec.flight.facingOffsetDegrees;
    return spec.facingDegrees ?? null;
}

export function zcEffectFadeSecondsOf(
    effectPrefabPath: string | null | undefined,
): number {
    const seconds = zcEffectSpecOfPath(effectPrefabPath)?.fadeSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds;
}

/** 一次性长演出寿命下限（秒）；0 表示沿用事件默认寿命 */
export function zcEffectDurationOf(
    effectPrefabPath: string | null | undefined,
): number {
    const seconds = zcEffectSpecOfPath(effectPrefabPath)?.durationSeconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds;
}

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

/**
 * 弹体的飞行抖动配置；未登记 / 形态非法 ⇒ `null`（不抖）。
 *
 * 三处逐字段校验而不是直接把对象扔给视图：`amount` / `periodSeconds` 写错一个
 * （0 / 负数 / 字符串）在视图侧会变成 `Infinity` 或 `NaN` 写进 `setScale`，
 * 整颗子弹从屏幕上消失且**不报错** —— 这类「美术突然没了」最难查。
 */
export function zcEffectWobbleOf(
    effectPrefabPath: string | null | undefined,
): IZCBulletWobble | null {
    const wobble = zcEffectSpecOfPath(effectPrefabPath)?.wobble;
    if (!wobble) return null;
    if (wobble.axis !== 'x' && wobble.axis !== 'y') return null;
    if (!Number.isFinite(wobble.amount) || wobble.amount <= 0) return null;
    if (!Number.isFinite(wobble.periodSeconds) || wobble.periodSeconds <= 0) return null;
    return wobble;
}

export const ZC_EFFECT_MISSILE_BY_UNIT: Readonly<Record<string, IZCEffectMissileSpec>> = {
    '68010': {
        missilePrefabPath: ZC_EFFECT_PATHS.missileBody,
        impactPrefabPath: ZC_EFFECT_PATHS.missileImpact,
        arcOffset: 36,
        speed: 200,
        count: 3,
    },
    //  2026-11-25 第 51 批：急冻瓜 68024「急冻光线」102404。
    //  它原来是**没有弹体**的 —— `applyRandomStrike` 拿不到 missile spec 就走 else 分支
    //  「目标身上原地闪一下 + 立刻结算」。用户要「普通子弹飞行时箭头方向朝向目标」⇒
    //  必须真的飞，于是登记成 missile：`pushProjectile` 生成弹道，命中时结算伤害 + 麻痹。
    //  · `arcOffset: 0`：直线飞（弧线是镭射飞龙 68010 的口径，冰弹不需要）。
    //  · **不登记 `count`**：`strikeCount = 3` 要「三个目标各一发」，登记了 count 反而会
    //    从候选里重复取、把 3 发都砸在同几个人身上（见 `ZCSkillResolutionSystem` 的 volley）。
    //  · 不给 `speed`：复用 `attackProfile.projectileSpeed`，与普攻弹速一致。
    //  · `warmup: false`：两颗 prefab 合计 ~8MB 美术（13 帧命中帧每张 300~600KB），
    //    只服务急冻瓜一张卡 ⇒ 按阵容收（`zcEffectMissilePathsForUnit`），不进首包预热。
    '68024': {
        missilePrefabPath: ZC_EFFECT_PATHS.iceMageBullet,
        impactPrefabPath: ZC_EFFECT_PATHS.iceMageBulletImpact,
        arcOffset: 0,
        warmup: false,
    },
};

export function zcEffectMissileOf(unitId: string): IZCEffectMissileSpec | null {
    return ZC_EFFECT_MISSILE_BY_UNIT[unitId] ?? null;
}

export function zcEffectMissilePathsForUnit(unitId: string): readonly string[] {
    const fx = ZC_EFFECT_MISSILE_BY_UNIT[unitId];
    return fx ? [fx.missilePrefabPath, fx.impactPrefabPath] : [];
}

export function zcEffectMissilePaths(): readonly string[] {
    const paths = new Set<string>();
    for (const fx of Object.values(ZC_EFFECT_MISSILE_BY_UNIT)) {
        paths.add(fx.missilePrefabPath);
        paths.add(fx.impactPrefabPath);
    }
    return [...paths];
}

/** 与资源计划共用行为组路径查找（优先单位覆盖） */
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

/** 仅收集开战预热所需的导弹与 warmup 行为组，按需资源不入首包 */
export function zcWarmupEffectPaths(): readonly string[] {
    const paths = new Set<string>();
    // 导弹优先，保持与既有预热序列一致；`warmup: false` 的按阵容收（见 `IZCEffectMissileSpec.warmup`）
    for (const fx of Object.values(ZC_EFFECT_MISSILE_BY_UNIT)) {
        if (fx.warmup === false) continue;
        paths.add(fx.missilePrefabPath);
        paths.add(fx.impactPrefabPath);
    }
    for (const spec of ZC_EFFECT_BEHAVIOR_SPECS) {
        if (!spec.warmup) continue;
        for (const path of spec.prefabPaths) paths.add(path);
    }
    return [...paths];
}

export function zcEffectHitFxSurfaceLiftY(
    surface: ZCEffectHitSurface | null | undefined,
): number {
    if (!surface) return 0;
    const lift = ZC_HIT_FX_SURFACE_LIFT_Y[surface];
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}

export function zcEffectTrailOf(prefabPath: string | null | undefined): IZCEffectTrailSpec | null {
    if (!prefabPath) return null;
    return ZC_EFFECT_TRAIL_SPECS[prefabPath] ?? null;
}

export function zcEffectTrailPaths(): readonly string[] {
    return Object.keys(ZC_EFFECT_TRAIL_SPECS);
}

export function zcEffectBeamOf(effectPrefabPath: string | null | undefined): IZCEffectBeamSpec | null {
    if (!effectPrefabPath) return null;
    return ZC_EFFECT_BEAM_SPECS[effectPrefabPath] ?? null;
}

const SELF_AURA_LANDING_FX_BY_UNIT: Readonly<Record<string, string>> = {
    '68024': ZC_EFFECT_PATHS.iceMageBullet,
};

/** 自身光环技能的落地一次性表现路径；未登记单位返回 null。*/
export function zcSelfAuraLandingPath(
    behaviorKey: string | null | undefined,
    unitId?: string | null,
): string | null {
    if (behaviorKey !== ZC_EFFECT_BEHAVIOR_KEYS.selfAura) return null;
    return (unitId ? SELF_AURA_LANDING_FX_BY_UNIT[unitId] : undefined) ?? null;
}

export const ZC_SKILL_RANGE_RING_UNITS: readonly string[] = ['68008', '68024', '68030'];

/** 单位是否启用技能范围指示白环。*/
export function zcRangeRingEnabledForUnit(unitId: string | null | undefined): boolean {
    return unitId != null && ZC_SKILL_RANGE_RING_UNITS.includes(unitId);
}

/** 单位所需预加载的技能范围环路径清单。*/
export function zcRangeRingPathsForUnit(unitId: string): readonly string[] {
    return zcRangeRingEnabledForUnit(unitId) ? [ZC_EFFECT_PATHS.skillRangeRing] : [];
}
