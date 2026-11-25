/** 战斗特效资源与表现参数目录 */

import { ZC_EFFECT_TUNING } from './ZCEffectTuning';

export type ZCEffectAnchor = 'caster' | 'midpoint' | 'target';
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
    // 独立美术（烘焙 0.4），勿与 thunderBulletImpact 合并
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
    // prefab/anim 由 tools/build_fission_spawn_fx.py 生成，勿手工改动
    fissionSpawn: 'units/projectiles/分裂菇_生成分身/分裂菇_生成分身',
    // prefab/anim 由 tools/build_xiantao_quake_fx.py 生成；地面裂纹半径 = 54 逻辑 px
    quakeStrike: 'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能',
    // 仙桃行者普攻刀光，走默认 caster / melee 兜底，不登记 spec
    spearSlash: 'units/projectiles/长枪兵普攻_刀光/长枪兵普攻_刀光',
    // 复用灼热地带素材，文明之火走事件级 tint 染蓝，保留原色给火焰树妖
    hotZone: 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能',
    iceCone: 'units/projectiles/冰法师_冰锥/冰法师_冰锥',
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
    summonUnit: 'summon_unit',
    /** 纯数据参数袋车道，按单位覆盖补收个别表现资源 */
    skillParams: 'skill_params',
    /** 按单位覆盖群体治疗的护盾表现，避免无护盾的同车道技能预载 */
    selfCast: 'self_cast',
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
        prefabPaths: [ZC_EFFECT_PATHS.burstImpact],
        notes: '扇形多发爆点；预热由 burst/splash 组覆盖',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.singleStrike,
        prefabPaths: [ZC_EFFECT_PATHS.singleStrike],
        warmup: true,
        notes: '贴目标播放撕裂',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.chargeShield,
        prefabPaths: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '残影 + 落地护盾',
    },
    {
        behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.legacyDash,
        prefabPaths: [ZC_EFFECT_PATHS.chargeDash, ZC_EFFECT_PATHS.dashGuard],
        warmup: true,
        notes: '残影 + 落地护盾；与 charge_shield 共用',
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
        nodeScale: 307.5 / (256 * 0.58),
        // 分母为画布宽 256（可见环 153），nodeScale=1 时可见环 184 屏上 px，匹配 68021/68024 的 120 半径；更大范围走事件 effectScale
        notes: '画布 307.5 / 可见环 184；改大走事件 effectScale',
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
        notes: '线段中点残影',
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
        nodeScale: 0.5,
        notes: '30717 命中爆点（烘焙 0.4 * 0.5 = 0.2）',
    },
    {
        prefabPath: ZC_EFFECT_PATHS.quakeStrike,
        anchor: 'target',
        // area 默认压地面，重击柱需置顶
        layer: 'top',
        // 尺寸已烘焙在 prefab（_lscale = 0.56），改判定需同步 tools/build_xiantao_quake_fx.py 与 skillParamJson.quakeRadius
        notes: '68009 重击；地面裂纹匹配判定圆',
        durationSeconds: ZC_EFFECT_TUNING.quakeStrikeSeconds,
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

export const ZC_EFFECT_MISSILE_BY_UNIT: Readonly<Record<string, IZCEffectMissileSpec>> = {
    '68010': {
        missilePrefabPath: ZC_EFFECT_PATHS.missileBody,
        impactPrefabPath: ZC_EFFECT_PATHS.missileImpact,
        arcOffset: 36,
        speed: 200,
        count: 3,
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
    // 导弹优先，保持与既有预热序列一致
    for (const path of zcEffectMissilePaths()) paths.add(path);
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
