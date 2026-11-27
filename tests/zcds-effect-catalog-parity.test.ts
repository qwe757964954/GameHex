import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_EFFECT_MISSILE_BY_UNIT,
    ZC_EFFECT_SPECS,
    zcEffectAnchorOf,
    zcEffectFadeSecondsOf,
    zcEffectFacingOffsetOf,
    zcEffectFlightOf,
    zcEffectLayerOfPath,
    zcEffectLiftYOf,
    zcEffectMissileOf,
    zcEffectMissilePaths,
    zcEffectNodeScaleOf,
    zcEffectOverlayChildOf,
    zcEffectTintOf,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import {
    zcCombatEffectFadeSecondsOf,
    zcCombatEffectFacingOffsetOf,
    zcCombatEffectFlightOf,
    zcMissileFxOf,
    zcMissileFxPaths,
} from '../assets/script/app/zcds/model/ZCCombatEffectFlight';
import {
    zcCombatEffectAnchorOf,
    zcCombatEffectLayerOfPath,
    zcCombatEffectLiftY,
    zcCombatEffectOverlayChild,
} from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { zcCombatEffectTintOf } from '../assets/script/app/zcds/view/ZCCombatEffectTint';

/**
 * P1 迁移 parity：目录必须与改造前四张表逐键相等。
 *
 * 基线来自移动前逐字抄下的表值（`tests/fixtures/zc-effect-catalog-baseline.json`）。
 * 这条用例只回答「有没有搬错 / 搬漏」，不替代各模块原有的行为测试。
 */

interface IFlightBaseline {
    speed: number;
    minSeconds: number;
    maxSeconds: number;
    facingOffsetDegrees: number;
}

interface IMissileBaseline {
    missilePrefabPath: string;
    impactPrefabPath: string;
    arcOffset: number;
    speed?: number;
    count?: number;
    warmup?: boolean;
}

interface IBaseline {
    nodeScale: Record<string, number>;
    anchor: Record<string, 'caster' | 'midpoint' | 'target'>;
    liftY: Record<string, number>;
    layer: Record<string, 'ground' | 'top'>;
    overlayChild: Record<string, string>;
    flight: Record<string, IFlightBaseline>;
    facing: Record<string, number>;
    fade: Record<string, number>;
    tint: Record<string, [number, number, number]>;
    missile: Record<string, IMissileBaseline>;
}

const BASELINE = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'zc-effect-catalog-baseline.json'), 'utf8'),
) as IBaseline;

/**
 * 迁移**之后**新登记进目录的路径。
 *
 * 基线文件是「P1 改造那一刻的逐字快照」，不再往里面追加 —— 否则 parity 就失去意义。
 * 每个新需求带来的增量列在这里，锚点 / 层级同样要过 ② 那套函数（不是写死在目录里没人校验）。
 *
 * 2026-11-23 第 42 批：仙桃行者 68009「重击」落地柱（大地之力 100904 首目标 + 武将技 36241）。
 * 它落在**受击目标坐标**上（`target`），并且是打在空中的一下（`top`，不能被 `area` 默认压回地面）。
 *
 * 🔴 同一批续的「普攻造型」**不在这里**：用户把口径从「长枪兵武将技（地面枪阵）」纠回
 * 「旧值 长枪兵普攻_刀光」，而刀光 64×42 就是贴在本体出手点的一下挥击 —— 锚点 `caster`、
 * 层按事件类型（`melee ⇒ top`）、尺寸 1、寿命 `defaultAttackTravelSeconds` 全是兜底默认值，
 * 与长枪兵行 30171 自己的播法逐字一致 ⇒ 目录**不登记**它，也就不用进这份增量清单。
 */
const POST_MIGRATION_PATHS: Readonly<Record<string, {
    anchor: 'caster' | 'midpoint' | 'target';
    layer: 'ground' | 'top';
}>> = {
    // 2026-11-23 第 42 批：仙桃行者重击柱。
    'units/projectiles/仙桃行者_重击技能/仙桃行者_重击技能': { anchor: 'target', layer: 'top' },
    // 2026-11-25 第 45 批：机甲菇 68015「武器绞杀」的扇形挥击。锚点在施法者（`caster`），
    // 方向靠 `facingDegrees: 0` 转到目标；层置顶才不会被站在扇形里的角色挡住。
    'units/projectiles/机甲菇_武器绞杀/机甲菇_武器绞杀': { anchor: 'caster', layer: 'top' },
    // 2026-11-25 第 45 批：技能范围白环（戈壁狂箭 / 冰山陨落 / 篮球火共用）。
    // 它是画在地上的圈 ⇒ 保持 `ground`。尺寸只走事件级 `effectScale`。
    'units/projectiles/技能范围_白环/技能范围_白环': { anchor: 'caster', layer: 'ground' },
    // 2026-11-25 第 46 批：运动霸 68033「天外飞石」砸落。落点是判定圆心，锚点走默认 `caster`
    // （事件 `from == to`，锚点取哪个都一样）；置顶才读得出「砸在他们头上」。
    'units/projectiles/运动霸_砸落技能/运动霸_砸落技能': { anchor: 'caster', layer: 'top' },
    // 2026-11-25 第 47 批：通用治疗光环（Spine `eff_buff_heal`）。锚在被治疗者身上（`area` 原地播）。
    // 置顶：光环比角色小一圈，压地面层会被站在圈里的角色挡住。
    'units/projectiles/通用治疗特效/通用治疗特效': { anchor: 'caster', layer: 'top' },
    // 2026-11-25 第 49 批：战士通用剑气（冲锋三卡共用）。走 `flight` 通道 ⇒ 位置按 from→to
    // 插值，`anchor` 不参与（回落默认 `caster`，别当成「贴在施法者身上」）；
    // 层显式 `top`：剑气从角色身前掠过时要压在角色之上（与 melee 的默认层一致）。
    'units/projectiles/战士通用剑气/战士通用剑气': { anchor: 'caster', layer: 'top' },
    // 2026-11-25 第 51 批：冰法师通用子弹（急冻瓜 68024 的【急冻光线】弹体 / 【冰山陨落】落地一击）。
    // 走 `flight` 通道 ⇒ `anchor` 不参与（回落 `caster`，别理解成「贴在施法者身上」）；
    // 置顶才不会被站在弹道上飞过的角色挡住。
    'units/projectiles/冰法师通用子弹/冰法师通用子弹': { anchor: 'caster', layer: 'top' },
    // 同批的命中爆炸：原地一次性播（13 帧 1.083s），同样置顶。
    'units/projectiles/冰法师通用子弹命中/冰法师通用子弹命中': { anchor: 'caster', layer: 'top' },
    // 2026-11-26 第 57 批：卡牌常用子弹（七张卡各一颗，统一格式）。
    // 全部走 `projectile` / `area` 的飞行通道 ⇒ `anchor` 不参与（回落 `caster`，
    // 别理解成「贴在施法者身上」）；层置顶才不会被站在弹道上的角色挡住。
    // 🔴 这七条都**不写 nodeScale**（缩放烘在 prefab 的 `body`），所以也不在下面的尺寸基线里。
    'units/projectiles/卡牌常用子弹物件/豌豆游侠_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/毒箭菇_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/杰克藕_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/大嘴花_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/仙桃行者_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/玉林好汉_子弹': { anchor: 'caster', layer: 'top' },
    'units/projectiles/卡牌常用子弹物件/诅咒菇_子弹': { anchor: 'caster', layer: 'top' },
};

/**
 * 迁移**之后**新登记进「导弹表」的条目（与 `POST_MIGRATION_PATHS` 同口径，不进基线文件）。
 *
 * 基线快照不再追加，增量只列在这里；④ 会把「基线 + 增量」与目录逐键比。
 */
const POST_MIGRATION_MISSILES: Readonly<Record<string, IMissileBaseline>> = {
    // 2026-11-25 第 51 批：急冻瓜 68024 的「急冻光线」。
    // 它原来**没有弹体**（`applyRandomStrike` 拿不到 spec 就走「目标原地闪一下 + 立刻结算」），
    // 本批要求「普通子弹飞行时箭头方向朝向目标」⇒ 真的飞，才登记成 missile。
    // · `arcOffset: 0` 直线飞；· 不给 `count`（`strikeCount = 3` 要三个目标各一发）；
    // · `warmup: false` —— 两颗 prefab 合计 ~8MB 只服务一张卡，按阵容收，不进首包预热。
    '68024': {
        missilePrefabPath: 'units/projectiles/冰法师通用子弹/冰法师通用子弹',
        impactPrefabPath: 'units/projectiles/冰法师通用子弹命中/冰法师通用子弹命中',
        arcOffset: 0,
        warmup: false,
    },
};

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const close = (actual: number, expected: number): boolean => Math.abs(actual - expected) < 1e-12;

test('① 目录条目集合 = 基线路径并集 + 迁移后新增，且路径唯一', () => {
    const expectedPaths = new Set<string>([
        ...Object.keys(BASELINE.nodeScale),
        ...Object.keys(BASELINE.anchor),
        ...Object.keys(BASELINE.liftY),
        ...Object.keys(BASELINE.layer),
        ...Object.keys(BASELINE.overlayChild),
        ...Object.keys(BASELINE.flight),
        ...Object.keys(BASELINE.facing),
        ...Object.keys(BASELINE.fade),
        ...Object.keys(BASELINE.tint),
        ...Object.keys(POST_MIGRATION_PATHS),
    ]);
    const actualPaths = ZC_EFFECT_SPECS.map((spec) => spec.prefabPath);
    assert.equal(new Set(actualPaths).size, actualPaths.length, '目录不允许重复路径');
    assert.deepEqual([...actualPaths].sort(), [...expectedPaths].sort());
    //  增量条目同样要真的在目录里生效（不是只加进这份清单）。
    for (const [path, expected] of Object.entries(POST_MIGRATION_PATHS)) {
        assert.equal(zcEffectAnchorOf(path), expected.anchor, `增量锚点 ${path}`);
        assert.equal(zcCombatEffectAnchorOf(path), expected.anchor, `增量锚点 facade ${path}`);
        assert.equal(zcEffectLayerOfPath(path), expected.layer, `增量层级 ${path}`);
    }
});

test('② 尺寸 / 锚点 / 抬升 / 层级 / 叠层逐键 parity', () => {
    for (const [path, expected] of Object.entries(BASELINE.nodeScale)) {
        assert.ok(close(zcEffectNodeScaleOf(path), expected), `目录尺寸 ${path}: ${zcEffectNodeScaleOf(path)} != ${expected}`);
        assert.ok(close(zcCombatEffectNodeScaleOf(path), expected), `facade 尺寸 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.anchor)) {
        assert.equal(zcEffectAnchorOf(path), expected, `目录锚点 ${path}`);
        assert.equal(zcCombatEffectAnchorOf(path), expected, `facade 锚点 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.liftY)) {
        assert.equal(zcEffectLiftYOf(path), expected, `目录抬升 ${path}`);
        assert.equal(zcCombatEffectLiftY(path), expected, `facade 抬升 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.layer)) {
        assert.equal(zcEffectLayerOfPath(path), expected, `目录层级 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.overlayChild)) {
        assert.equal(zcEffectOverlayChildOf(path), expected, `目录叠层 ${path}`);
        assert.equal(zcCombatEffectOverlayChild(path), expected, `facade 叠层 ${path}`);
    }
});

test('③ 飞行 / 朝向 / 淡出 / 染色逐键 parity', () => {
    for (const [path, expected] of Object.entries(BASELINE.flight)) {
        assert.deepEqual(zcEffectFlightOf(path), expected, `目录飞行 ${path}`);
        assert.deepEqual(zcCombatEffectFlightOf(path), expected, `facade 飞行 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.facing)) {
        assert.equal(zcEffectFacingOffsetOf(path), expected, `目录朝向 ${path}`);
        assert.equal(zcCombatEffectFacingOffsetOf(path), expected, `facade 朝向 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.fade)) {
        assert.equal(zcEffectFadeSecondsOf(path), expected, `目录淡出 ${path}`);
        assert.equal(zcCombatEffectFadeSecondsOf(path), expected, `facade 淡出 ${path}`);
    }
    for (const [path, expected] of Object.entries(BASELINE.tint)) {
        assert.deepEqual(zcEffectTintOf(path), expected, `目录染色 ${path}`);
        assert.deepEqual(zcCombatEffectTintOf(path), expected, `facade 染色 ${path}`);
    }
});

test('④ 导弹表与资源路径逐键 parity', () => {
    const expectedMissiles = { ...BASELINE.missile, ...POST_MIGRATION_MISSILES };
    assert.deepEqual(ZC_EFFECT_MISSILE_BY_UNIT, expectedMissiles);
    for (const [unitId, expected] of Object.entries(expectedMissiles)) {
        assert.deepEqual(zcEffectMissileOf(unitId), expected, `目录导弹 ${unitId}`);
        assert.deepEqual(zcMissileFxOf(unitId), expected, `facade 导弹 ${unitId}`);
    }
    const expectedPaths = [...new Set(Object.values(expectedMissiles).flatMap((fx) => [
        fx.missilePrefabPath,
        fx.impactPrefabPath,
    ]))].sort();
    assert.deepEqual([...zcEffectMissilePaths()].sort(), expectedPaths);
    assert.deepEqual([...zcMissileFxPaths()].sort(), expectedPaths);
});

test('⑤ 未登记路径的兜底与改造前逐字一致', () => {
    const unknown = 'units/projectiles/未登记/未登记';
    assert.equal(zcEffectNodeScaleOf(null), 1);
    assert.equal(zcEffectNodeScaleOf(''), 1);
    assert.equal(zcEffectNodeScaleOf(unknown), 1);
    assert.equal(zcCombatEffectNodeScaleOf(undefined), 1);
    assert.equal(zcEffectAnchorOf(unknown), 'caster');
    assert.equal(zcCombatEffectAnchorOf(null), 'caster');
    assert.equal(zcEffectLiftYOf(unknown), 0);
    assert.equal(zcEffectLayerOfPath(unknown), null);
    assert.equal(zcEffectOverlayChildOf(unknown), null);
    assert.equal(zcEffectFlightOf(unknown), null);
    assert.equal(zcEffectFacingOffsetOf(unknown), null);
    assert.equal(zcEffectFadeSecondsOf(unknown), 0);
    assert.equal(zcEffectTintOf(unknown), null);
    assert.equal(zcMissileFxOf('99999'), null);
    // 层级 facade 仍按事件类型回落：area 铺地，其余置顶。
    assert.equal(zcCombatEffectLayerOfPath(ZCCombatEventType.Area, unknown), 'ground');
    assert.equal(zcCombatEffectLayerOfPath(ZCCombatEventType.Melee, unknown), 'top');
    assert.equal(
        zcCombatEffectLayerOfPath(ZCCombatEventType.Area, 'units/projectiles/鹿神守护/鹿神守护'),
        'top',
    );
});

test('⑥ 旧模块不再各自保留路径表（迁移后只允许目录出现路径字面量）', () => {
    const facades = [
        'assets/script/app/zcds/view/ZCCombatEffectScale.ts',
        'assets/script/app/zcds/view/ZCCombatEffectTint.ts',
        'assets/script/app/zcds/view/ZCCombatEffectPlacement.ts',
        'assets/script/app/zcds/model/ZCCombatEffectFlight.ts',
    ];
    for (const relative of facades) {
        assert.doesNotMatch(read(relative), /'units\/projectiles\//, `${relative} 仍持有路径表`);
    }
    const catalog = read('assets/script/app/zcds/model/ZCEffectCatalog.ts');
    assert.match(catalog, /'units\/projectiles\/斧盾兵_反击气刃\/斧盾兵_反击气刃'/, '目录应持有飞行条目');
    assert.match(catalog, /'68010'/, '目录应持有导弹条目');
});
