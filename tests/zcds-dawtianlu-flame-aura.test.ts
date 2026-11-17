/**
 * 大威天芦（68025）「无尘禁土」102503 的火焰光环：预制体三件套 + 造型接线（2026-11-17）。
 *
 * 口径（用户）：「大威天芦 的无尘禁土 使用【大威天芦_火焰光环】特效，并按照统一的格式制作预制」。
 *
 * 背景：美术只丢了 30 张 864×883 的散图（`245-3-standby_loop_*`），目录里**没有**
 * prefab / anim / pac —— 与麻辣铁锅、磁电菇、雷蕉那几批一模一样的半成品状态。
 * 生成器 = `tools/build_dawtianlu_flame_aura_fx.py`，产出的结构必须与
 * `持续光环伤害效果`（老光柱）逐字同构，否则导入器认不出来。
 *
 * 这一段钉住四类「静默失败」：
 *  ① 散图 meta 必须是 `type: sprite-frame` + `f9941` 子资源 —— 默认导成 texture 时只有
 *     `@6c48a`，`cc.Sprite._spriteFrame` 取不到 ⇒ **不报错、特效永远不出现**；
 *  ② 自动图集三处开关必须是 `false` —— 编辑器没重新 import 过手写 meta，取 true 会把散图
 *     从 bundle 摘掉，运行时贴图与图集两头都取不到；
 *  ③ 尺寸必须与判定对得上：画布宽被生成器钉成**环外径**，所以
 *     `_contentSize.width × _lscale` 必须等于 `auraRadius × 2 × 0.76875` = 307.5 屏上 px；
 *  ④ 路径必须真的被 `buildZCVisualResourcePlan` 收进本局清单 —— 漏收的后果是
 *     技能照常每秒扣血、屏幕上一次都不亮，且一条错都不报。
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZC_SELF_AURA_BEHAVIOR_KEY, zcSelfAuraEffectPath } from '../assets/script/app/zcds/model/ZCSelfAuraFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';

const ROOT = join(__dirname, '..');
const NAME = '大威天芦_火焰光环';
const DIR = join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles', NAME);
const PATH = `units/projectiles/${NAME}/${NAME}`;
const CLIP = `${NAME}-loop`;

/** 项目统一换算（docs §1.11）：屏上 px = 逻辑 px × 0.3 × 2.5625。 */
const LOGIC_TO_SCREEN = 0.3 * 2.5625;
/** 102503 三档的 `auraRadius` 都是 200 逻辑 px。 */
const AURA_RADIUS_LOGIC = 200;
const JUDGE_DIAMETER_SCREEN = AURA_RADIUS_LOGIC * 2 * LOGIC_TO_SCREEN;   // 307.5

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface IParts {
    readonly node: { _lpos: { x: number; y: number }; _lscale: { x: number; y: number } };
    readonly ui: { _contentSize: { width: number; height: number } };
    readonly sprite: { _spriteFrame: { __uuid__: string }; _sizeMode: number };
    readonly anim: { _clips: { __uuid__: string }[]; _defaultClip: { __uuid__: string }; playOnLoad: boolean };
}

function parts(): IParts {
    const doc = readJson<Array<Record<string, any>>>(join(DIR, `${NAME}.prefab`));
    const pick = (type: string): any => {
        const found = doc.find((item) => item.__type__ === type);
        assert.ok(found, `${NAME}.prefab 缺 ${type}`);
        return found;
    };
    return { node: pick('cc.Node'), ui: pick('cc.UITransform'), sprite: pick('cc.Sprite'), anim: pick('cc.Animation') };
}

// ── 一、目录结构 ────────────────────────────────────────────────────────────

test('三件套齐备：prefab / atlas(.pac) / anim 都在统一格式的位置上', () => {
    for (const relative of [`${NAME}.prefab`, `${NAME}.prefab.meta`, 'atlas', 'atlas.meta',
        `atlas/${NAME}.pac`, `atlas/${NAME}.pac.meta`, 'anim', 'anim.meta', `anim/${CLIP}.anim`,
        `anim/${CLIP}.anim.meta`]) {
        assert.ok(existsSync(join(DIR, relative)), `缺 ${NAME}/${relative}`);
    }
    //  源散图必须已经搬出 bundle（留在 bundle 里会被打进包，白占一份体积）
    const stray = readdirSync(DIR).filter((entry) => entry.toLowerCase().endsWith('.png'));
    assert.deepEqual(stray, [], `bundle 里不该再留散图：${stray.join(', ')}`);
});

test('自动图集三处开关都是 false（手写 meta 没被编辑器重导过，取 true 会丢散图）', () => {
    const meta = readJson<any>(join(DIR, 'atlas', `${NAME}.pac.meta`));
    assert.equal(meta.importer, 'auto-atlas');
    assert.equal(meta.userData.filterUnused, false);
    assert.equal(meta.userData.removeTextureInBundle, false);
    assert.equal(meta.userData.removeImageInBundle, false);
});

test('散图 meta 是 sprite-frame + f9941 子资源（缺这一步不报错、特效永不出现）', () => {
    const atlasDir = join(DIR, 'atlas');
    const frames = readdirSync(atlasDir).filter((entry) => entry.toLowerCase().endsWith('.png'));
    assert.equal(frames.length, 30, '30 帧全部进图集');
    for (const frame of frames) {
        const meta = readJson<any>(join(atlasDir, `${frame}.meta`));
        assert.equal(meta.userData.type, 'sprite-frame', `${frame} 的 type 必须是 sprite-frame`);
        assert.equal(meta.userData.redirect, `${meta.uuid}@6c48a`, `${frame} 的 redirect 指向贴图子资源`);
        const sprite = meta.subMetas?.f9941;
        assert.ok(sprite, `${frame} 缺 f9941 子资源（cc.Sprite 会取不到 spriteFrame）`);
        assert.equal(sprite.uuid, `${meta.uuid}@f9941`);
        assert.equal(sprite.importer, 'sprite-frame');
        assert.ok(sprite.userData.width > 0 && sprite.userData.height > 0);
        //  uv / 顶点四边形必须与画布尺寸自洽，否则贴图会画歪或者只显示一条
        assert.equal(sprite.userData.width, sprite.userData.rawWidth);
        assert.equal(sprite.userData.height, sprite.userData.rawHeight);
    }
});

// ── 二、动画 ────────────────────────────────────────────────────────────────

test('动画：30 帧 / sample 12 / Loop / 2.5 秒，每一帧都指向图集里真实存在的 sprite-frame', () => {
    const clip = readJson<any>(join(DIR, 'anim', `${CLIP}.anim`));
    assert.equal(clip.sample, 12, '12fps（与本项目其它序列帧一致）');
    assert.equal(clip.wrapMode, 2, 'Loop —— 102503 持续 4/6/8 秒，一段循环要能反复播');
    assert.ok(Math.abs(clip._duration - 30 / 12) < 1e-6, `时长必须是 30/12 = 2.5s（实际 ${clip._duration}）`);

    const track = clip._tracks[0];
    assert.equal(track._binding.path._paths[0].component, 'cc.Sprite');
    assert.equal(track._binding.path._paths[1], 'spriteFrame', '轨道必须绑 spriteFrame');
    const curve = track._channel._curve;
    assert.equal(curve._times.length, 30, '30 个时间点');
    assert.equal(curve._values.length, 30, '30 个帧引用');

    const known = new Set(readdirSync(join(DIR, 'atlas'))
        .filter((entry) => entry.toLowerCase().endsWith('.png'))
        .map((frame) => readJson<any>(join(DIR, 'atlas', `${frame}.meta`)).uuid + '@f9941'));
    for (const value of curve._values) {
        assert.ok(known.has(value.__uuid__), `帧引用 ${value.__uuid__} 不在图集里（会播成空白）`);
        assert.equal(value.__expectedType__, 'cc.SpriteFrame');
    }
});

// ── 三、尺寸与摆位 ──────────────────────────────────────────────────────────

test('尺寸：画布宽 × 根 _lscale = 判定直径 307.5 屏上 px（画布宽被钉成地面环外径）', () => {
    const { node, ui } = parts();
    assert.equal(node._lscale.x, node._lscale.y, '等比缩放，否则环会变成扁的');
    const screen = ui._contentSize.width * node._lscale.x;
    //  `_lscale` 在 prefab 里只保留 6 位小数 ⇒ 允许 0.01px（0.003%）的取整误差。
    assert.ok(Math.abs(screen - JUDGE_DIAMETER_SCREEN) < 0.01,
        `环屏上宽 ${screen} 必须等于 ${JUDGE_DIAMETER_SCREEN}（画布宽 ${ui._contentSize.width} × ${node._lscale.x}）`);
    //  这条 prefab 只服务 102503，尺寸烘在这里 ⇒ 宿主倍率必须还是 1。
    assert.equal(zcSelfAuraEffectPath(ZC_SELF_AURA_BEHAVIOR_KEY, '68025'), PATH);
});

test('摆位：环中心被钉到节点原点 —— 横向几乎归零、纵向往上补（火焰全在环上方）', () => {
    const { node, ui } = parts();
    //  画布宽 = 环外径 ⇒ 环中心横向本来就落在画布中心 ⇒ `_lpos.x` 只剩取整误差。
    assert.ok(Math.abs(node._lpos.x) < 1,
        `_lpos.x 应是取整误差级（实际 ${node._lpos.x}）；大了说明画布宽不再等于环外径`);
    //  环中心在画布中心**下方**（火焰墙占满画布上半）⇒ 节点要整体往上挪，y 必须为正。
    assert.ok(node._lpos.y > 0, `_lpos.y 必须为正（把画布中心抬到环中心），实际 ${node._lpos.y}`);
    assert.ok(node._lpos.y < ui._contentSize.height * node._lscale.x,
        '_lpos.y 不能超过整张画布的高度，否则环会飞出判定圈');
});

test('prefab 的 Sprite 用的是图集里第一帧，且 `_sizeMode` 是 CUSTOM（不被贴图尺寸反推）', () => {
    const { sprite } = parts();
    assert.equal(sprite._sizeMode, 0, '_sizeMode = CUSTOM，尺寸由 _contentSize 说了算');
    const first = readJson<any>(join(DIR, 'atlas', '245-3-standby_loop_00.png.meta'));
    assert.equal(sprite._spriteFrame.__uuid__, `${first.uuid}@f9941`, '首帧 = 第 1 张散图');
});

// ── 四、接线 ────────────────────────────────────────────────────────────────

test('造型接线：68025 走火焰环，另两家不受影响，兜底光柱不再被任何人使用', () => {
    assert.equal(zcSelfAuraEffectPath('self_aura', '68025'), PATH, '大威天芦 → 火焰光环');
    assert.equal(zcSelfAuraEffectPath('self_aura', '68016'),
        'units/projectiles/雷电冲击/雷电冲击', '磁电菇不受影响');
    assert.equal(zcSelfAuraEffectPath('self_aura', '68026'),
        'units/projectiles/麻辣铁锅_喷射火焰/麻辣铁锅_喷射火焰', '麻辣铁锅不受影响');
    assert.equal(zcSelfAuraEffectPath('self_aura', '68999'),
        'units/projectiles/持续光环伤害效果/持续光环伤害效果', '未知单位仍退回兜底');
    assert.equal(zcSelfAuraEffectPath('bolt_strike', '68025'), null, '不是自身光环就返回 null');
});

test('资源计划：本局带 102503 就必须加载火焰环；不带就不加载', () => {
    const unit = (unitId: string) => ({
        unitId,
        prefabPath: `skel/${unitId}/${unitId}`,
        attackProfile: { effectPrefabPath: `units/projectiles/${unitId}_普攻/${unitId}_普攻` },
    });
    const withAura = buildZCVisualResourcePlan([unit('68025')] as never, {
        skillPlans: [{ enabled: true, unitId: '68025', behaviorKey: 'self_aura' }],
        textOverrides: new Map(),
    } as never);
    assert.ok(withAura.effectPaths.includes(PATH), '漏收 ⇒ 技能照常扣血、屏幕一次都不亮');

    const withoutAura = buildZCVisualResourcePlan([unit('68016')] as never, {
        skillPlans: [{ enabled: true, unitId: '68016', behaviorKey: 'self_aura' }],
        textOverrides: new Map(),
    } as never);
    assert.equal(withoutAura.effectPaths.includes(PATH), false, '别人的局不该吃这份加载');
});
