/**
 * 「获得英雄」页的**资源与 prefab 对账**（静默错误的守卫）。
 *
 * | 组 | 盯住什么 | 错了会怎样 |
 * |---|---|---|
 * | A | 7 张切图 ↔ 磁盘 ↔ `.meta`（uuid / 尺寸 / trimType / packable） | prefab 引用不存在的 uuid ⇒ 整块白图 |
 * | B | prefab 节点几何 = `HeroObtainLayout` 纯函数 | 页面元素整体偏一段，肉眼难对齐设计稿 |
 * | C | Widget 对齐口径（根/舞台/底图） | 长屏或窗口 resize 后停在错位置 ⇒「飘」 |
 * | D | 文字规格（字号 / 描边 / overflow / 进度填充锚点） | SHRINK 悄悄缩字号、填充从中间涨 |
 * | E | 脚本 uuid ↔ 压缩 cid、Inspector 引用不为空 | 页面组件整体反序列化成空 |
 */
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { HERO_OBTAIN_ARTS, HERO_OBTAIN_ART_ROOT, heroObtainArtPathOf } from '../assets/script/app/ArtPaths';

const ROOT = process.cwd();
const PREFAB_PATH = `${ROOT}/assets/resources/ui/heroObtain/HeroObtain.prefab`;
const PAGE_SCRIPT = 'assets/script/app/card/view/HeroObtainPage.ts';

const SLICES = {
    bg: { file: 'bg_hero_obtain.png', dir: 'assets/resources/image', size: [720, 1610] as const, packable: false },
    rays: { file: 'hdyx_guang.png', dir: 'assets/resources/image/hero_obtain', size: [690, 690] as const, packable: true },
    title: { file: 'hdyx_title.png', dir: 'assets/resources/image/hero_obtain', size: [326, 54] as const, packable: true },
    plate: { file: 'hdyx_xxk_di.png', dir: 'assets/resources/image/hero_obtain', size: [252, 51] as const, packable: true },
    shard: { file: 'hdyx_icon_suipian.png', dir: 'assets/resources/image/hero_obtain', size: [53, 52] as const, packable: true },
    barBg: { file: 'hdyx_progress_bg.png', dir: 'assets/resources/image/hero_obtain', size: [270, 42] as const, packable: true },
    barFill: { file: 'hdyx_progress_01.png', dir: 'assets/resources/image/hero_obtain', size: [255, 27] as const, packable: true },
};

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function compressUuid(uuid: string): string {
    const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const raw = uuid.replace(/-/g, '');
    const head = raw.slice(0, 5);
    const rest = raw.slice(5);
    let bits = '';
    for (const ch of rest) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 6) out += table[parseInt(bits.slice(i, i + 6), 2)];
    return head + out;
}

function nodeOf(items: any[], name: string): any {
    const node = items.find((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.ok(node, `prefab 缺节点 ${name}`);
    return node;
}

function compOf(items: any[], node: any, type: string): any {
    for (const ref of node._components) {
        const comp = items[ref.__id__];
        if (comp.__type__ === type) return comp;
    }
    return null;
}

test('A. 7 张切图落盘且尺寸与设计稿一致', () => {
    for (const entry of Object.values(SLICES)) {
        const path = `${ROOT}/${entry.dir}/${entry.file}`;
        assert.ok(existsSync(path), `缺切图 ${path}`);
        assert.ok(statSync(path).size > 0, `切图为空 ${path}`);
        const meta = readJson(path + '.meta');
        const frame = meta.subMetas.f9941.userData;
        assert.deepEqual([frame.width, frame.height], [entry.size[0], entry.size[1]], `${entry.file} 尺寸不符`);
        assert.equal(frame.trimType, 'none');
        assert.equal(frame.packable, entry.packable, `${entry.file} packable 口径不符`);
        assert.equal(frame.atlasUuid, '');
    }
});

test('A2. 底图在 image/ 根、其余在 image/hero_obtain/（路径单一真源）', () => {
    assert.equal(heroObtainArtPathOf(HERO_OBTAIN_ARTS.bg), 'image/bg_hero_obtain');
    assert.equal(HERO_OBTAIN_ART_ROOT, 'image/hero_obtain');
    for (const key of Object.keys(HERO_OBTAIN_ARTS) as (keyof typeof HERO_OBTAIN_ARTS)[]) {
        if (key === 'bg') continue;
        assert.equal(heroObtainArtPathOf(HERO_OBTAIN_ARTS[key]), `image/hero_obtain/${HERO_OBTAIN_ARTS[key]}`);
    }
});

test('B. prefab 节点坐标 = 设计稿（prefab 是几何真源）', () => {
    const items = readJson(PREFAB_PATH);
    const cases: [string, number, number][] = [
        ['HeroHost', -14.5, -17],
        ['Rays', 0, -769],
        ['HeroRoot', 0.5, -745],
        ['Title', 9, -310],
        ['Plate', -3, -1038.5],
        ['Badge', -84, -1038],
        ['Name', 17, -1039],
        ['Shard', -125.5, -1227],
        ['BarBg', 11, -1227],
        ['Count', 12.5, -1227],
        ['Hint', -1.5, -1388.5],
    ];
    for (const [name, x, y] of cases) {
        const node = nodeOf(items, name);
        assert.ok(Math.abs(node._lpos.x - x) < 1e-6, `${name}.x ${node._lpos.x} != ${x}`);
        assert.ok(Math.abs(node._lpos.y - y) < 1e-6, `${name}.y ${node._lpos.y} != ${y}`);
    }
});

test('B2. 进度填充左锚点 + 宽度 = 设计稿 255×27', () => {
    const items = readJson(PREFAB_PATH);
    const node = nodeOf(items, 'BarFill');
    assert.deepEqual(node._lpos.x, -117);
    assert.deepEqual(node._lpos.y, -1226.5);
    const ui = compOf(items, node, 'cc.UITransform');
    assert.deepEqual([ui._contentSize.width, ui._contentSize.height], [255, 27]);
    assert.deepEqual([ui._anchorPoint.x, ui._anchorPoint.y], [0, 0.5]);
});

test('C. Widget：根/点击层四边拉伸且 ALWAYS；底图居中不拉伸；舞台上下左右居中且 ALWAYS', () => {
    const items = readJson(PREFAB_PATH);
    const rootWidget = compOf(items, nodeOf(items, 'HeroObtain'), 'cc.Widget');
    assert.equal(rootWidget._alignFlags, 45);
    assert.equal(rootWidget._alignMode, 1, '根节点必须每帧对齐，首次打开才能拿到真实屏高');
    const touchWidget = compOf(items, nodeOf(items, 'Touch'), 'cc.Widget');
    assert.equal(touchWidget._alignFlags, 45);
    assert.equal(touchWidget._alignMode, 1, '点击层必须铺满，不随窗口 resize 停住');
    // 底图只做居中定位，尺寸固定 720×1610；短屏上下对称溢出，不拉扁。
    const bgNode = nodeOf(items, 'Bg');
    const bgWidget = compOf(items, bgNode, 'cc.Widget');
    assert.equal(bgWidget._alignFlags, 18, '底图只保留水平/垂直居中');
    assert.equal(bgWidget._alignMode, 1);
    const bgUi = compOf(items, bgNode, 'cc.UITransform');
    assert.deepEqual([bgUi._contentSize.width, bgUi._contentSize.height], [720, 1610]);
    // 舞台：水平 Center + 垂直 Middle；1280 屏上下各溢出 165，提示落在屏内。
    const stage = nodeOf(items, 'Stage');
    const stageWidget = compOf(items, stage, 'cc.Widget');
    assert.equal(stageWidget._alignFlags, 18, '舞台必须上下左右居中');
    assert.equal(stageWidget._horizontalCenter, 0);
    assert.equal(stageWidget._verticalCenter, 0);
    assert.equal(stageWidget._alignMode, 1, '舞台必须 ALWAYS，否则窗口变化后停在错位置');
    const stageUi = compOf(items, stage, 'cc.UITransform');
    assert.deepEqual([stageUi._anchorPoint.x, stageUi._anchorPoint.y], [0.5, 1]);
    // 位移/缩放的动画节点**不能**挂 Widget（会和纯函数写的位置互相拉扯）。
    for (const name of ['Rays', 'HeroRoot', 'Title', 'Plate', 'Badge', 'Name', 'Hint', 'ProgressRow']) {
        assert.equal(compOf(items, nodeOf(items, name), 'cc.Widget'), null, `${name} 不该挂 Widget`);
    }
});

test('C2. 页面不再写运行时缩放：适配交给 Stage/Bg 的 Widget，立绘偏置交给 prefab', () => {
    const src = readFileSync(`${ROOT}/${PAGE_SCRIPT}`, 'utf8');
    assert.equal(/applyScreenFit|heroObtainStageScaleOf|heroObtainBgCoverScaleOf/.test(src), false,
        '运行时缩放/定位代码应删除，只靠 Widget 居中');
    assert.equal(/HERO_OBTAIN_HERO_ART_OFFSET|heroHost/.test(src), false,
        'HeroHost 位置已写进 prefab，页面不再持引用或 setPosition');
});

test('D. 文字规格：30/28pt、2px 描边、overflow NONE、填充为 FILLED', () => {
    const items = readJson(PREFAB_PATH);
    const name = compOf(items, nodeOf(items, 'Name'), 'cc.Label');
    assert.equal(name._fontSize, 30);
    assert.equal(name._overflow, 0);
    assert.equal(name._enableOutline, true);
    assert.equal(name._outlineWidth, 2);
    assert.equal(name._fontFamily, 'Microsoft YaHei');
    for (const nodeName of ['Count', 'Hint']) {
        const label = compOf(items, nodeOf(items, nodeName), 'cc.Label');
        assert.equal(label._fontSize, 28, `${nodeName} 字号`);
        assert.equal(label._overflow, 0, `${nodeName} overflow`);
        assert.equal(label._outlineWidth, 2, `${nodeName} 描边`);
    }
    const fill = compOf(items, nodeOf(items, 'BarFill'), 'cc.Sprite');
    assert.equal(fill._type, 3, '进度填充必须是 FILLED');
    assert.equal(fill._fillType, 0, '横向填充');
    assert.equal(fill._fillStart, 0);
});

test('E. 脚本 uuid ↔ 压缩 cid、Inspector 引用全绑上', () => {
    const items = readJson(PREFAB_PATH);
    const meta = readJson(`${ROOT}/${PAGE_SCRIPT}.meta`);
    const page = compOf(items, nodeOf(items, 'HeroObtain'), compressUuid(meta.uuid));
    assert.ok(page, '根节点缺 HeroObtainPage 组件（cid 与 meta uuid 对不上）');
    const refs = [
        'stage', 'bgOpacity', 'raysNode', 'raysOpacity', 'titleNode', 'titleOpacity', 'heroRoot', 'heroOpacity',
        'heroSprite', 'plateNode', 'plateOpacity', 'badgeSprite', 'badgeOpacity', 'nameLabel',
        'nameOpacity', 'progressRow', 'progressOpacity', 'barBgSprite', 'barFillSprite', 'barFillOpacity',
        'countLabel', 'countOpacity', 'shardSprite', 'hintOpacity', 'hintLabel', 'touchButton',
    ];
    for (const key of refs) {
        assert.ok(page[key] && typeof page[key].__id__ === 'number', `HeroObtainPage.${key} 未绑定`);
    }
    assert.equal(page.closeOnBlank, false, '整屏点击自己处理，不能再叠空白关闭');
});

test('F. 首帧稳定：onOpen 任何 await 之前已写入 elapsed=0 视觉态（不许先闪一帧全亮）', () => {
    const src = readFileSync(`${ROOT}/${PAGE_SCRIPT}`, 'utf8');
    const openAt = src.indexOf('protected async onOpen');
    assert.ok(openAt > 0, '缺 onOpen');
    const firstAwait = src.indexOf('await', openAt);
    const resetCall = src.indexOf('this.resetState()', openAt);
    assert.ok(firstAwait > openAt && resetCall > openAt && resetCall < firstAwait,
        'resetState() 必须早于任何 await —— 否则加载期间弹窗先露一帧全尺寸静态图，再缩回去重播');
    const resetBody = src.slice(src.indexOf('private resetState()'), src.indexOf('private renderStatic'));
    assert.ok(/this\.applyVisual\(\)/.test(resetBody), 'resetState 要按 elapsed=0 走一遍 applyVisual');
});

test('E2. 切图 uuid 与 prefab 引用一致（meta 是真源）', () => {
    const items = readJson(PREFAB_PATH);
    for (const entry of Object.values(SLICES)) {
        const meta = readJson(`${ROOT}/${entry.dir}/${entry.file}.meta`);
        const frameUuid = `${meta.uuid}@f9941`;
        const sprites = items.filter((item) => item.__type__ === 'cc.Sprite' && item._spriteFrame?.__uuid__ === frameUuid);
        assert.ok(sprites.length >= 1, `prefab 没有引用 ${entry.file}`);
    }
});
