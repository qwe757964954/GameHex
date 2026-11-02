import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_LOGICAL_COLUMN_STEP,
    HEX_GRID_LOGICAL_ROW_STEP,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../assets/script/core/hex/HexGridLayout';
import { assetExists, assetPath } from './helpers/asset-paths';
import { decodePngRgba, readPngAlphaBox } from './helpers/png-alpha';

/**
 * 火焰树妖「灼热地带」的序列帧特效（需求 2026-10-30，两轮）。
 *
 *  第一轮：做成与 `火焰树妖_普攻/` 同构的三件套（`atlas/` + `anim/` + `.prefab`），
 *         尺寸按**技能范围**反算，配置表两处镜像同步。
 *  第二轮：用**多簇火焰**填满范围圈（每簇缩放不同），两套火焰都染成火焰树妖的紫。
 *
 * 要点全在这里：
 *  1. 14 张帧图必须有 `f9941` spriteFrame 子资源 —— 少了它 Sprite 引用不到，
 *     表现是「不报错、特效永远不出现」。
 *  2. 尺寸由 `areaRadius × combatDistanceScale` 反算，**不按画布大小**。
 *  3. 多簇火焰的**并集**要等于范围圈；底座压在圈下沿（火焰站在地上）。
 *  4. 颜色要是树妖紫（`#4C2B68` / `#CB37F5` / `#EA91F4` 那一族），不是原来的橙黄。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const SKILL_ID = 30811;
const COMMANDER_SKILL_ID = 36181; // 火法师武将技：仍然借火船，不能被顺手改掉
const OLD_PREFAB_PATH = 'units/projectiles/火法师_火船/火法师_火船';
const EFFECT_PATH = 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能';
const EFFECT_DIR = 'units/projectiles/火焰树妖_灼热地带技能';
const NORMAL_ATTACK_DIR = 'units/projectiles/火焰树妖_普攻';
const PREFAB_NAME = '火焰树妖_灼热地带技能.prefab';
const CLIP_NAME = '火焰树妖_灼热地带技能-loop.anim';

const FRAME_COUNT = 14;
const FRAME_WIDTH = 400;
const FRAME_HEIGHT = 451;
const HOT_FRAMES = ['046_00', '046_02', '046_04', '046_06', '046_08', '046_13', '046_14',
    '046_15', '046_17', '046_18', '046_20', '046_22', '046_23', '046_24'];
/** 可见内容（`alpha >= 8` 的 14 帧并集），纹理坐标 —— 用例会用 PNG 自己量一遍再比。 */
const CONTENT = { left: 93, right: 265, top: 99, bottom: 345 };
/**
 * `readPngAlphaBox` 的判据是 `alpha > threshold`，要表达"`alpha >= 8` 才算可见"就得传 7。
 * 别传 8：火焰边缘有一圈 `alpha === 8` 的弱像素（`046_00` 的 x=93 就是），差 1 会一直红。
 */
const VISIBLE_ALPHA = 8 - 1;

const effectFile = (suffix: string): string => `${EFFECT_DIR}/${suffix}`;
const readJson = (relative: string): any => JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));

/** `assets/remoteRef/*.json` 是列存 `{k, v}`（`pvpGlobal` 之外还有行数组形态，两种都认）。 */
function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(read(`assets/remoteRef/${name}.json`)) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

/** `doc/塔防数据配置/json/client/*.json`（导表中间产物，行数组）。 */
function readDocRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

const rowOf = (rows: Array<Record<string, unknown>>, skillId: number): Record<string, unknown> => {
    const hit = rows.find((row) => row.skillId === skillId);
    assert.ok(hit, `pvpSkill 缺少技能行 ${skillId}`);
    return hit!;
};

/** 屏上范围椭圆的两轴直径（`ZCAttackResolutionSystem` 与 `mapToView` 的同一口径）。 */
function aoePixelSize(): { width: number; height: number; worldRadius: number } {
    const skill = rowOf(readPvpRows('pvpSkill'), SKILL_ID);
    const global = readPvpRows('pvpGlobal');
    const distanceScale = Number(global.find((row) => row.key === 'combatDistanceScale')?.value);
    const worldRadius = Number(skill.areaRadius) * distanceScale;
    return {
        worldRadius,
        width: worldRadius * 2 * (HEX_GRID_VIEW_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP),
        height: worldRadius * 2 * (HEX_GRID_VIEW_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP),
    };
}

interface IFlameNode { name: string; scaleX: number; scaleY: number; x: number; y: number; }

function flameNodes(): IFlameNode[] {
    const prefab = readJson(assetPath(effectFile(PREFAB_NAME))) as Array<Record<string, any>>;
    return prefab
        .filter((entry) => entry.__type__ === 'cc.Node' && String(entry._name ?? '').startsWith('flame_'))
        .map((entry) => ({
            name: entry._name,
            // x / y 分开取：只取 `_lscale.x` 等于**假定等比**，非等比压扁就测不出来。
            scaleX: entry._lscale.x,
            scaleY: entry._lscale.y,
            x: entry._lpos.x,
            y: entry._lpos.y,
        }));
}

/** 一簇火焰的可见矩形（以格心为原点，屏上像素）：纹理包围盒按节点缩放 + 摆位。 */
function flameBox(flame: IFlameNode): { left: number; right: number; bottom: number; top: number } {
    const sx = flame.scaleX;
    const sy = flame.scaleY;
    return {
        left: flame.x + (CONTENT.left - FRAME_WIDTH / 2) * sx,
        right: flame.x + (CONTENT.right - FRAME_WIDTH / 2) * sx,
        bottom: flame.y + (FRAME_HEIGHT / 2 - CONTENT.bottom) * sy,
        top: flame.y + (FRAME_HEIGHT / 2 - CONTENT.top) * sy,
    };
}

function unionBox(flames: IFlameNode[]): { left: number; right: number; bottom: number; top: number } {
    const boxes = flames.map(flameBox);
    return {
        left: Math.min(...boxes.map((box) => box.left)),
        right: Math.max(...boxes.map((box) => box.right)),
        bottom: Math.min(...boxes.map((box) => box.bottom)),
        top: Math.max(...boxes.map((box) => box.top)),
    };
}

test('① 配置表：30811 指向新 prefab，两处镜像一致，火法师武将技不受影响', () => {
    const ref = rowOf(readPvpRows('pvpSkill'), SKILL_ID);
    const doc = rowOf(readDocRows('pvpSkill'), SKILL_ID);
    assert.equal(ref.effectPrefabPath, EFFECT_PATH, 'assets/remoteRef/pvpSkill.json');
    assert.equal(doc.effectPrefabPath, EFFECT_PATH, 'doc/…/client/pvpSkill.json（两处必须同改，测试逐格互校）');
    // 借用的火船（697px）是这次要换掉的原因，别再退回去。
    assert.notEqual(ref.effectPrefabPath, OLD_PREFAB_PATH);
    // 火法师武将技 36181 也借火船，那是它自己的美术，不能被顺手改掉。
    assert.equal(rowOf(readPvpRows('pvpSkill'), COMMANDER_SKILL_ID).effectPrefabPath, OLD_PREFAB_PATH);
});

test('② 预加载链路：30811 挂在 30711 的 empoweredSkillId 上，loader 才收得到这条路径', () => {
    const attack = rowOf(readPvpRows('pvpSkill'), 30711);
    assert.equal(attack.empoweredSkillId, SKILL_ID);
    // `ZCGameLoader` 收的是 `attackProfile.effectPrefabPath` + `empoweredProfile.effectPrefabPath`；
    // 强化那一击取技能行的路径（`ZCAttackResolutionSystem` 的 `empowered && …effectPrefabPath`）。
    // 于是「路径写错/资源没导入」的表现是静默回落通用特效，不会报错 —— 这里直接查磁盘。
    assert.ok(existsSync(join(ROOT, assetPath(effectFile(PREFAB_NAME)))),
        `${EFFECT_DIR}/${PREFAB_NAME} 必须真实存在`);
    assert.ok(assetExists(effectFile('anim/' + CLIP_NAME)), 'anim 目录缺序列帧');
    assert.ok(assetExists(effectFile('atlas/火焰树妖_灼热地带技能.pac')), 'atlas 目录缺图集');
});

test('③ 尺寸：多簇火焰的并集 = 技能范围圈', () => {
    const aoe = aoePixelSize();
    assert.equal(aoe.worldRadius, 18, 'areaRadius 60 × combatDistanceScale 0.3');
    assert.equal(Number(aoe.width.toFixed(2)), 92.25);
    assert.equal(Number(aoe.height.toFixed(2)), 77.14);

    // 先用 PNG 自己量一遍「可见内容」，避免用例里的常数悄悄和美术脱节。
    const measured = HOT_FRAMES.reduce((acc, frame) => {
        const box = readPngAlphaBox(join(ROOT, assetPath(effectFile(`atlas/${frame}.png`))), VISIBLE_ALPHA);
        return {
            left: Math.min(acc.left, box.left),
            right: Math.max(acc.right, box.right),
            // `readPngAlphaBox` 的 y 已翻成自下而上，这里换回自上而下的纹理坐标。
            top: Math.min(acc.top, box.height - box.top),
            bottom: Math.max(acc.bottom, box.height - box.bottom),
        };
    }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    assert.deepEqual(measured, CONTENT, '14 帧并集包围盒变了 ⇒ 下面的布局常数要一起重算');
    assert.equal(measured.right - measured.left, 172);
    assert.equal(measured.bottom - measured.top, 246);

    const flames = flameNodes();
    assert.ok(flames.length >= 3, `要「复制多个火焰」填满圈，实际只有 ${flames.length} 簇`);
    // 「调节大小」：至少 3 种不同缩放，否则就是同一张图平移了 5 份。
    const sizes = flames.map((flame) => `${flame.scaleX.toFixed(3)}x${flame.scaleY.toFixed(3)}`);
    assert.ok(new Set(sizes).size >= 3, `火焰缩放应各不相同，实得 ${[...new Set(sizes)].join(' / ')}`);

    const union = unionBox(flames);
    assert.ok(Math.abs((union.right - union.left) - aoe.width) < 0.6,
        `并集宽 ${(union.right - union.left).toFixed(2)} 应等于范围宽 ${aoe.width.toFixed(2)}`);
    // 高度是**竖直**口径（火焰从地面往上冒），和「地面上的范围纵深」不是同一件事：
    // 宽度必须像素级对上（地面覆盖），高度给 95%~120% 的带宽 ——
    // 低了看着没填满（或某簇被非等比压扁），高了会糊到隔壁格；但不必死磕等于 77.14
    // （差 0.15px 就红属于误伤；而 0.9 倍的下限太松，压扁一簇仍能漏过）。
    const unionHeight = union.top - union.bottom;
    assert.ok(unionHeight >= aoe.height * 0.95 && unionHeight <= aoe.height * 1.2,
        `并集高 ${unionHeight.toFixed(2)} 应落在范围高 ${aoe.height.toFixed(2)} 的 95%~120% 之间`);
    // 并集要**罩住整个椭圆**：四个方向都到了边上，而不是挤在下半部。
    // （改版前 5 簇全是「底边贴地」，上半圈是空的 —— 用户反馈「让火焰在整个圆圈相对均匀的分布」。）
    const halfW = aoe.width / 2;
    const halfH = aoe.height / 2;
    assert.ok(union.right >= halfW - 2 && union.left <= -halfW + 2,
        `并集横向没铺满：${union.left.toFixed(1)} ~ ${union.right.toFixed(1)}，范围是 ±${halfW.toFixed(1)}`);
    assert.ok(union.top >= halfH * 0.95 && union.bottom <= -halfH * 0.95,
        `并集纵向没铺满：${union.bottom.toFixed(1)} ~ ${union.top.toFixed(1)}，范围是 ±${halfH.toFixed(1)}`);
    // 垂直居中：不再"站在地上"（贴底会让上半圈空着），而是散在整片区域里。
    assert.ok(Math.abs((union.top + union.bottom) / 2) < 1.5,
        `并集垂直中心 ${((union.top + union.bottom) / 2).toFixed(2)} 应落在椭圆中心 0 上`);
    // 上下两半都要有**多簇**，否则就是「一排站地上」换个说法而已。
    const boxes = flames.map(flameBox);
    const upper = boxes.filter((box) => box.top > 10).length;
    const lower = boxes.filter((box) => box.bottom < -10).length;
    assert.ok(upper >= 2 && lower >= 2,
        `上半圈 ${upper} 簇、下半圈 ${lower} 簇 —— 两边都要 ≥2 才算「散在整个圈里」`);

    // 一格顶面 123px ⇒ 0.75 格：和「范围就一格不到」这个事实对齐（老的火船是 5.7 格）。
    assert.ok((union.right - union.left) / HEX_GRID_FACE_WIDTH < 1.0);

    // `offset` 是整体缩放旋钮，保持 1；每簇的尺寸写在自己身上。
    const prefab = readJson(assetPath(effectFile(PREFAB_NAME))) as Array<Record<string, any>>;
    const offset = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'offset')!;
    assert.deepEqual([offset._lscale.x, offset._lscale.y, offset._lscale.z], [1, 1, 1]);
    assert.deepEqual([offset._lpos.x, offset._lpos.y, offset._lpos.z], [0, 0, 0]);
});

test('④ 动画：14 帧 loop，一整个循环时长 = 区域每波的间隔；每簇共享同一份 clip', () => {
    const clip = readJson(assetPath(effectFile('anim/' + CLIP_NAME)));
    const skill = rowOf(readPvpRows('pvpSkill'), SKILL_ID);
    assert.equal(clip.__type__, 'cc.AnimationClip');
    assert.equal(clip.sample, FRAME_COUNT);
    assert.equal(clip.wrapMode, 2, '2 = Loop（区域持续 5 秒，循环播）');

    // 区域系统每 `durationSeconds / waves` 秒落一波（`ZCGroundZoneSystem` 的 waveInterval），
    // 每条波次事件活一个间隔 ⇒ 一个循环正好一个间隔，换波时不会切在半帧上。
    const waveInterval = Number(skill.durationSeconds) / Number(skill.waves);
    assert.equal(waveInterval, 1);
    assert.ok(Math.abs(clip._duration - waveInterval) < 1e-6,
        `clip 时长 ${clip._duration} 应等于每波间隔 ${waveInterval}`);

    const tracks = clip._tracks as Array<Record<string, any>>;
    assert.equal(tracks.length, 1, '一个 Sprite 一条轨道（多轨道 + 节点路径在本项目无先例，别开这个头）');
    const paths = tracks[0]._binding.path._paths;
    assert.equal(paths.length, 2);
    assert.equal(paths[0].__type__, 'cc.animation.ComponentPath');
    assert.equal(paths[0].component, 'cc.Sprite');
    assert.equal(paths[1], 'spriteFrame', '序列帧必须切 spriteFrame');

    const times = tracks[0]._channel._curve._times as number[];
    const values = tracks[0]._channel._curve._values as Array<{ __uuid__: string }>;
    assert.equal(times.length, FRAME_COUNT);
    assert.equal(values.length, FRAME_COUNT);
    assert.equal(new Set(values.map((value) => value.__uuid__)).size, FRAME_COUNT, '14 帧必须各不相同');
    for (let index = 1; index < times.length; index += 1) {
        assert.ok(times[index] > times[index - 1], '关键帧时间必须升序');
    }
});

test('⑤ 帧图：14 张都在 atlas/，每张都有可用的 spriteFrame 子资源（trimType: none）', () => {
    for (const frame of HOT_FRAMES) {
        const meta = readJson(assetPath(effectFile(`atlas/${frame}.png.meta`)));
        assert.equal(meta.userData.type, 'sprite-frame', `${frame}.png 导入类型必须能出 SpriteFrame`);
        const spriteFrame = meta.subMetas.f9941;
        assert.ok(spriteFrame, `${frame}.png 缺 f9941 子资源 ⇒ Sprite 引用不到（特效静默不显示）`);
        assert.equal(spriteFrame.uuid, `${meta.uuid}@f9941`);
        // 14 帧画布逐像素同尺寸：auto-trim 会让每帧的 offset 不同 ⇒ 播放时抖。
        assert.equal(spriteFrame.userData.trimType, 'none');
        assert.deepEqual([spriteFrame.userData.width, spriteFrame.userData.height], [FRAME_WIDTH, FRAME_HEIGHT]);
        assert.deepEqual([spriteFrame.userData.rawWidth, spriteFrame.userData.rawHeight], [FRAME_WIDTH, FRAME_HEIGHT]);
    }
});

test('⑥ 预制体结构：根无组件 + offset 无组件 + 每簇火焰自带 Sprite / Animation', () => {
    const prefab = readJson(assetPath(effectFile(PREFAB_NAME))) as Array<Record<string, any>>;
    const root = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._parent === null)!;
    assert.equal(root._components.length, 0, '根节点不放组件（`ZCCombatEffectView` 用 getComponentInChildren 找）');
    // 根恒 ONE：宿主的 `setScale(Vec3.ONE)` 是「容器归一」，尺寸唯一真源是各簇火焰的 `_lscale`。
    assert.deepEqual([root._lscale.x, root._lscale.y, root._lscale.z], [1, 1, 1]);
    assert.deepEqual([root._lpos.x, root._lpos.y, root._lpos.z], [0, 0, 0]);
    assert.equal(root._children.length, 1);

    const typeOf = (reference: { __id__: number }): string => prefab[reference.__id__].__type__;
    const childNodes = prefab.filter((entry) => entry.__type__ === 'cc.Node' && entry._parent !== null);
    // 中间层 `offset` 只是整体缩放 / 摆位的旋钮，**故意不带组件**：多簇结构下
    // 「谁负责多大」只能写在每簇身上，否则外层一改就把已经对齐的范围圈又搞乱了。
    const offset = childNodes.find((node) => node._name === 'offset')!;
    assert.ok(offset, '缺少 offset 中间层');
    assert.equal(offset._components.length, 0, 'offset 不放组件');
    assert.ok(offset._children.length >= 3, `offset 下面挂的是各簇火焰，实际 ${offset._children.length} 个`);

    const flameNodeEntries = childNodes.filter((node) => String(node._name).startsWith('flame_'));
    assert.ok(flameNodeEntries.length >= 3, `火焰簇至少 3 个，实际 ${flameNodeEntries.length}`);
    for (const node of flameNodeEntries) {
        const components = (node._components as Array<{ __id__: number }>).map(typeOf).sort();
        assert.deepEqual(components, ['cc.Animation', 'cc.Sprite', 'cc.UITransform'],
            `${node._name} 必须是「自己带 Sprite + Animation」的一簇火焰`);
    }

    const sprites = prefab.filter((entry) => entry.__type__ === 'cc.Sprite');
    assert.equal(sprites.length, flameNodeEntries.length);
    const firstFrameUuid = readJson(assetPath(effectFile('atlas/046_00.png.meta'))).uuid;
    for (const sprite of sprites) {
        assert.equal(sprite._sizeMode, 0, 'CUSTOM：尺寸由 contentSize × _lscale 定，不跟贴图走');
        // 首帧也要是真实帧图，否则 instantiate 到播起来之间会闪一帧空。
        assert.equal(sprite._spriteFrame.__uuid__, `${firstFrameUuid}@f9941`);
    }

    const clipUuid = readJson(assetPath(effectFile('anim/' + CLIP_NAME + '.meta'))).uuid;
    const animations = prefab.filter((entry) => entry.__type__ === 'cc.Animation');
    assert.equal(animations.length, flameNodeEntries.length);
    for (const animation of animations) {
        assert.equal(animation._defaultClip.__uuid__, clipUuid);
        assert.equal(animation._clips.length, 1);
        // 只有层级里的第一个 Animation 会被 `ZCCombatEffectView.initialize` 显式 play，
        // 其余几簇必须靠 `playOnLoad` 起播 —— 关掉它就是「只有一簇在动、其余定格」。
        assert.equal(animation.playOnLoad, true, '非首簇的火焰靠 playOnLoad 起播，不能关');
    }
});

test('⑦ 颜色：两套火焰都是树妖紫（#4C2B68 / #CB37F5 / #EA91F4 那一族）', () => {
    /** 采样不透明像素，返回落在紫色色环（240°~330°）里的比例。 */
    const purpleShare = (file: string): number => {
        const { pixels } = decodePngRgba(join(ROOT, assetPath(file)));
        let sampled = 0;
        let purple = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 128) continue;
            const r = pixels[index] / 255;
            const g = pixels[index + 1] / 255;
            const b = pixels[index + 2] / 255;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            sampled += 1;
            if (max === min) continue; // 灰/白不算
            let hue: number;
            if (max === r) hue = ((g - b) / (max - min)) % 6;
            else if (max === g) hue = (b - r) / (max - min) + 2;
            else hue = (r - g) / (max - min) + 4;
            hue *= 60;
            if (hue < 0) hue += 360;
            // 蓝紫（240°~270°）也算 —— 火焰的暗部会偏蓝，只要不是橙黄（0°~60°）就算染上了。
            if (hue >= 240 && hue <= 330) purple += 1;
        }
        return sampled === 0 ? 0 : purple / sampled;
    };

    // 灼热地带（区域）与普攻（投射物）两套都要紫。
    for (const file of [effectFile('atlas/046_00.png'), effectFile('atlas/046_20.png')]) {
        const share = purpleShare(file);
        assert.ok(share > 0.95, `${file} 紫色像素占比只有 ${(share * 100).toFixed(1)}%（应 ≈100%）`);
    }
    // 2026-10-31 起普攻不再是自己那套火焰，改成**魔术师（`魔法师_普攻`）的帧序列染浅紫**
    // （需求「火焰树妖使用魔术师的攻击效果，改成类似的浅紫色即可」）
    // ⇒ 帧名从 `130_0..7` 变成 `049_00..15`，校验点跟着换。
    for (const frame of ['049_00', '049_08', '049_15']) {
        const share = purpleShare(`${NORMAL_ATTACK_DIR}/atlas/${frame}.png`);
        assert.ok(share > 0.95, `${NORMAL_ATTACK_DIR}/atlas/${frame}.png 紫色像素占比只有 ${(share * 100).toFixed(1)}%`);
    }
});
