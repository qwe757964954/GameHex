import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';
import { decodePngRgba } from './helpers/png-alpha';

/**
 * 火焰树妖普攻 = **魔术师的攻击效果 + 浅紫**（2026-10-31）
 *
 * 用户原话：「火焰树妖使用魔术师的攻击效果，改成类似的浅紫色的即可」。
 *
 * 落地方式（`tools/build_treant_purple_attack_fx.py`）：
 *  - 把 `魔法师_普攻`（魔术师，68034 / 技能 30710）的 16 帧搬进 **`火焰树妖_普攻` 自己的目录**；
 *  - 按亮度重映射成浅紫（`tools/art/tint_effect_purple.py --stops ...`）；
 *  - **路径不变** ⇒ `pvpSkill` 30711 一行都不用改，也碰不到魔术师自己那份
 *    （它还挂着 30854 帽子戏法 / 30855 空间置换）。
 *
 * 为什么要用例守着「浅」：色阶是可调的，改深一档不会报错、跑起来也不崩，
 * 但需求要的是「浅紫」。这里用**平均亮度比**把它钉住 ——
 * 同一只树的区域技能（灼热地带）用的是深紫，两者必须有量级差。
 */

const ROOT = join(__dirname, '..');
const DIR = 'units/projectiles/火焰树妖_普攻';
const SRC_DIR = 'units/projectiles/魔法师_普攻';
const HOT_DIR = 'units/projectiles/火焰树妖_灼热地带技能';

const FRAME_COUNT = 16;
const CANVAS = { width: 256, height: 133 };
const SAMPLE = 12;
/** 法师普攻统一 70% 之后的 `offset._lscale`（`tests/zcds-mage-normal-attack-size.test.ts` 也守着）。 */
const OFFSET_SCALE = 0.35;

const readJson = (relative: string): any => JSON.parse(readFileSync(join(ROOT, assetPath(relative)), 'utf8'));

const frames = (): string[] => Array.from({ length: FRAME_COUNT }, (_, index) => `049_${String(index).padStart(2, '0')}`);

function readPvpRows(name: string): Array<Record<string, any>> {
    const source = JSON.parse(readFileSync(join(ROOT, `assets/remoteRef/${name}.json`), 'utf8')) as
        | Array<Record<string, any>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('① 配置表没动：30711 仍指向火焰树妖自己的 prefab（换的是目录里的美术）', () => {
    const skills = readPvpRows('pvpSkill');
    const row = skills.find((item) => item.skillId === 30711)!;
    assert.equal(row.name, '火焰树妖普攻');
    assert.equal(row.effectPrefabPath, `${DIR}/火焰树妖_普攻`,
        '路径必须留在火焰树妖自己的包里 —— 改成魔术师那份就等于把魔术师的普攻也染紫了');
    // 魔术师自己那条也不能被改（它和帽子戏法 / 空间置换共用一份 prefab）。
    const magician = skills.find((item) => item.skillId === 30710)!;
    assert.equal(magician.effectPrefabPath, `${SRC_DIR}/魔法师_普攻`);
});

test('② 图集：16 帧、画布与魔术师一致、且**逐帧不裁剪**（否则换图会忽大忽小）', () => {
    for (const name of frames()) {
        const file = `${DIR}/atlas/${name}.png`;
        const meta = readJson(file + '.meta');
        // 帧图 meta 必须有 f9941（spriteFrame）—— 漏了就是静默空白（AGENTS.md §1.11）。
        assert.ok(meta.subMetas?.f9941, `${name}.meta 缺 f9941`);
        const { width, height } = decodePngRgba(join(ROOT, assetPath(file)));
        assert.deepEqual([width, height], [CANVAS.width, CANVAS.height], `${name}.png 画布变了`);
        // ⚠️ 魔术师那份的 meta 是**逐帧 trim 过**的（049_00 记成 249×126、trimX 7），
        // 直接搬过来当帧序列会「一帧一个包围盒」⇒ 播放时忽大忽小地抖。
        // 我们统一写 trimType none + 整帧画布，和 §1.1 的投射物特效同一口径。
        assert.equal(meta.subMetas.f9941.userData.trimType, 'none', `${name} 必须不裁剪`);
        assert.equal(meta.subMetas.f9941.userData.width, CANVAS.width);
        assert.equal(meta.subMetas.f9941.userData.height, CANVAS.height);
    }
    const source = decodePngRgba(join(ROOT, assetPath(`${SRC_DIR}/atlas/049_00.png`)));
    assert.deepEqual([source.width, source.height], [CANVAS.width, CANVAS.height],
        '画布要和魔术师那份的 PNG 尺寸一致（美术是同一批帧）');
});

test('③ 动画：16 帧 / sample 12 / 一个循环 1.3333s，帧顺序 = 文件名顺序', () => {
    const clip = readJson(`${DIR}/anim/火焰树妖_普攻-loop.anim`);
    assert.equal(clip.sample, SAMPLE);
    assert.equal(clip.wrapMode, 2, 'wrapMode 必须是 loop（2），否则播一遍就定格');
    const curve = clip._tracks[0]._channel._curve;
    assert.equal(curve._values.length, FRAME_COUNT);
    assert.equal(curve._times.length, FRAME_COUNT);
    assert.ok(Math.abs(clip._duration - FRAME_COUNT / SAMPLE) < 1e-6,
        `时长 ${clip._duration} 应等于 ${FRAME_COUNT}/${SAMPLE} = ${(FRAME_COUNT / SAMPLE).toFixed(4)}`);

    const expected = frames().map((name) => {
        const meta = readJson(`${DIR}/atlas/${name}.png.meta`);
        return `${meta.uuid}@f9941`;
    });
    assert.deepEqual(curve._values.map((value: any) => value.__uuid__), expected,
        '动画帧顺序必须与 049_00..049_15 一致，否则播放乱序');
});

test('④ prefab：画布 256×133、Sprite 是首帧、offset 仍是 0.35（法师 70% 不能被刷掉）', () => {
    const prefab = readJson(`${DIR}/火焰树妖_普攻.prefab`) as Array<Record<string, any>>;
    const sprite = prefab.find((entry) => entry.__type__ === 'cc.Sprite')!;
    const firstFrame = readJson(`${DIR}/atlas/049_00.png.meta`);
    assert.equal(sprite._spriteFrame.__uuid__, `${firstFrame.uuid}@f9941`);
    assert.equal(sprite._sizeMode, 0, 'sizeMode 必须是 CUSTOM(0)，否则逐帧换图会跟着新图变形');
    assert.equal(sprite._isTrimmedMode, false, '关掉 trim，避免各帧包围盒不同导致忽大忽小');

    const transform = prefab.find((entry) => entry.__type__ === 'cc.UITransform')!;
    assert.deepEqual([transform._contentSize.width, transform._contentSize.height], [CANVAS.width, CANVAS.height]);

    const offset = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'offset')!;
    assert.equal(offset._lscale.x, OFFSET_SCALE);
    assert.equal(offset._lscale.y, OFFSET_SCALE);
    const root = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === '火焰树妖_普攻')!;
    assert.deepEqual([root._lscale.x, root._lscale.y], [1, 1], '尺寸只认 offset，根恒 1');

    const clipUuid = readJson(`${DIR}/anim/火焰树妖_普攻-loop.anim.meta`).uuid;
    const animation = prefab.find((entry) => entry.__type__ === 'cc.Animation')!;
    assert.equal(animation._defaultClip.__uuid__, clipUuid, 'prefab 的默认 clip 必须指向本目录这份动画');
});

/** 不透明像素里落在「紫色色环」的比例，以及平均亮度（0~255）。 */
function palette(file: string): { purpleShare: number; luma: number } {
    const { pixels } = decodePngRgba(join(ROOT, assetPath(file)));
    let sampled = 0;
    let purple = 0;
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 128) continue;
        const r = pixels[index] / 255;
        const g = pixels[index + 1] / 255;
        const b = pixels[index + 2] / 255;
        sampled += 1;
        total += (299 * r + 587 * g + 114 * b) / 1000 * 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max === min) continue; // 灰 / 白不算
        let hue: number;
        if (max === r) hue = ((g - b) / (max - min)) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
        hue *= 60;
        if (hue < 0) hue += 360;
        if (hue >= 240 && hue <= 330) purple += 1;
    }
    return { purpleShare: sampled === 0 ? 0 : purple / sampled, luma: sampled === 0 ? 0 : total / sampled };
}

test('⑤ 颜色：16 帧都是紫的，而且比灼热地带那套**明显更浅**', () => {
    let attackLuma = 0;
    for (const name of frames()) {
        const { purpleShare, luma } = palette(`${DIR}/atlas/${name}.png`);
        assert.ok(purpleShare > 0.95, `${name}.png 紫色像素只有 ${(purpleShare * 100).toFixed(1)}%`);
        attackLuma += luma;
    }
    attackLuma /= FRAME_COUNT;

    // 区域技能（灼热地带）是深紫 —— 同一只树的两套特效应该一深一浅，别染成同一个色阶。
    let hotLuma = 0;
    const hotFrames = ['046_00', '046_02', '046_04', '046_06', '046_08', '046_13', '046_14',
        '046_15', '046_17', '046_18', '046_20', '046_22', '046_23', '046_24'];
    for (const name of hotFrames) hotLuma += palette(`${HOT_DIR}/atlas/${name}.png`).luma;
    hotLuma /= hotFrames.length;

    assert.ok(attackLuma > hotLuma * 1.15,
        `普攻平均亮度 ${attackLuma.toFixed(1)} 应比灼热地带的 ${hotLuma.toFixed(1)} 亮 15% 以上（需求要「浅」紫）`);
    // 也不能浅到发白 —— 那样读成「白光」而不是「浅紫」。
    assert.ok(attackLuma < 200, `平均亮度 ${attackLuma.toFixed(1)} 过高，容易读成白光`);
});

test('⑥ 源美术没被连带改：魔术师那份仍是蓝的', () => {
    const { purpleShare } = palette(`${SRC_DIR}/atlas/049_00.png`);
    assert.ok(purpleShare < 0.2,
        `魔术师普攻的紫色占比 ${(purpleShare * 100).toFixed(1)}% —— 说明染色染到了源美术（魔术师的特效会跟着变紫）`);
});
