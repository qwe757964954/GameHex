import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * 结算弹窗「资源部分」（通关奖励）的结构事实（2026-11-18 蓝湖「结算-MVP」稿口径）：
 *
 *  ① **底框是独立切图** `settlement/frame.png`（598×327），不再拿 `bg_02` 九宫格拉成 327 高——
 *     新稿的框自带 5 个道具格的内凹，1:1 摆上去就行；
 *  ② 底框**顶边与滚动视窗顶边齐平**、水平方向按稿左偏 3.5px（框中心设计 x=359，视窗 362.5）；
 *  ③ 「变强途径」整组随新稿下线，资源区只剩一个标题。
 *
 * 全部按**结构事实**断言（不依赖 `cc`），能在 Node 里直接跑。
 */
const ROOT = join(__dirname, '..');
const PREFAB = join(ROOT, 'assets/bundles/battle/ui/game/ZCSettlement.prefab');
const FRAME_META = join(ROOT, 'assets/bundles/battle/image/settlement/frame.png.meta');
const FRAME_PNG = join(ROOT, 'assets/bundles/battle/image/settlement/frame.png');

type TObj = Record<string, any>;
const raw = JSON.parse(readFileSync(PREFAB, 'utf8')) as TObj[];
const nodes = raw.filter((o) => o && o.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((n) => n._name === name);
const mustNode = (name: string) => {
    const node = nodeNamed(name);
    assert.ok(node, `${name} 必须存在`);
    return node!;
};
const compsOf = (n: TObj) => (n._components ?? []).map((c: TObj) => raw[c.__id__]).filter(Boolean);
const compOf = (n: TObj, type: string) => compsOf(n).find((c: TObj) => c.__type__ === type);
const childNames = (n: TObj) => (n._children ?? []).map((c: TObj) => (raw[c.__id__] as TObj)._name);
const sizeOf = (n: TObj) => compOf(n, 'cc.UITransform')._contentSize;
const labelOf = (n: TObj) => compOf(n, 'cc.Label');
const spriteOf = (n: TObj) => compOf(n, 'cc.Sprite');

/** 设计稿口径（dp / sp），下面所有断言都由它派生，改口径改这一处。 */
const DESIGN = {
    fontSizeSp: 13,
    lineHeightDp: 15.5,
    color: [255, 254, 250],   // #FFFEFA
    artScale: 2,              // 美术 2×
} as const;

const px = (value: number) => value * DESIGN.artScale;

// ============================================================
// 一、底框：道具格外面那块深色圆角底板
// ============================================================

test('资源区有底框：RewardBg 是 RewardSection 的**第一个**子节点（必须垫在列表下面）', () => {
    const names = childNames(mustNode('RewardSection'));
    assert.ok(names.includes('RewardBg'), `资源区缺底框节点（现有子节点：${names.join(' / ')}）`);
    assert.equal(names[0], 'RewardBg', '底框必须是第一个子节点 —— 子节点序 = 渲染顺序，排在列表后面就被盖住了');
    assert.ok(names.includes('RewardScroll'));
});

test('底框顶边与滚动视窗齐平，宽度按稿比视窗窄 25px（框中心左偏 3.5）', () => {
    const bg = mustNode('RewardBg');
    const scroll = mustNode('RewardScroll');
    const bgSize = sizeOf(bg);
    const scrollSize = sizeOf(scroll);

    // 视窗锚点 (0.5,1) 在 y=144.5 ⇒ 顶边 144.5；底框锚点 (0.5,0.5) 在 y=-19 ⇒ 顶边 -19+327/2。
    const scrollTop = scroll._lpos.y;
    const bgTop = bg._lpos.y + bgSize.height / 2;
    assert.equal(bgTop, scrollTop, '底框顶边必须与列表视窗顶边齐平（设计稿两者同一根线）');
    assert.equal(bgSize.width, 598, '框宽按切图原生 598（视窗 623 宽）');
    assert.equal(scrollSize.width - bgSize.width, 25, '左右各留 12.5 的可点空白');
    assert.equal(bgSize.height, scrollSize.height, '底框高度包住整个视窗：327');
});

test('底框用 settlement/frame.png 原尺寸 1:1（SIMPLE，不切片也不拉伸）', () => {
    const sprite = spriteOf(mustNode('RewardBg'));
    assert.ok(sprite, '底框要有 cc.Sprite');
    const meta = JSON.parse(readFileSync(FRAME_META, 'utf8')) as TObj;
    assert.equal(sprite._spriteFrame.__uuid__, meta.subMetas.f9941.uuid, '底框指向新切图 frame.png');
    assert.equal(sprite._type, 0, 'cc.Sprite.Type.SIMPLE：图就是 598×327，拉伸会糊掉内凹');
    assert.equal(sprite._sizeMode, 0, '尺寸由节点（CUSTOM）决定');
});

test('frame.png 的 meta 尺寸与 PNG 像素一致，且节点尺寸 == 原生尺寸（没有缩放）', () => {
    const meta = JSON.parse(readFileSync(FRAME_META, 'utf8')) as TObj;
    const frame = meta.subMetas.f9941.userData;
    const png = readFileSync(FRAME_PNG);
    assert.equal(png.readUInt32BE(16), frame.width, 'meta 里的 width 要和 PNG 一致');
    assert.equal(png.readUInt32BE(20), frame.height, 'meta 里的 height 要和 PNG 一致');
    assert.deepEqual([frame.width, frame.height], [598, 327]);
    const size = sizeOf(mustNode('RewardBg'));
    assert.deepEqual([size.width, size.height], [frame.width, frame.height], '1:1 摆放，节点尺寸必须等于原图');
});

// ============================================================
// 二、字体：字号 / 行高 / 颜色 / 字重 / 描边 / 与框的间距
// ============================================================

test('「通关奖励」标题按美术稿：13sp / 15.5dp / #FFFEFA / 不加粗', () => {
    const label = labelOf(mustNode('RewardTitle'));
    assert.ok(label, 'RewardTitle 必须是 cc.Label');
    assert.equal(label._fontSize, px(DESIGN.fontSizeSp), '字号 = 13sp × 2');
    assert.equal(label._lineHeight, px(DESIGN.lineHeightDp), '行高 = 15.5dp × 2');
    assert.deepEqual([label._color.r, label._color.g, label._color.b], DESIGN.color, '颜色 #FFFEFA（不是纯白）');
    assert.equal(label._color.a, 255, '不透明');
    assert.equal(label._isBold, false, '字重 Regular');
    assert.equal(label._isItalic, false, '字重 Regular');
    assert.equal(label._spacingX, 0, '字间距取默认（设计稿「100」= 1.00 倍）');
});

test('描边：黑描边 3px 保留（美术稿的白字是靠这层黑边立起来的）', () => {
    const label = labelOf(mustNode('RewardTitle'));
    assert.equal(label._enableOutline, true, '标题要描边');
    assert.deepEqual([label._outlineColor.r, label._outlineColor.g, label._outlineColor.b], [0, 0, 0]);
    assert.ok(label._outlineWidth >= 2, '描边太细在深色底上会发糊');
});

test('🔴 字号不许被 SHRINK 偷偷缩小：Label 高度 ≥ 行高（MVP 卡与标题一起查）', () => {
    for (const name of [
        'RewardTitle', 'MvpLevel', 'MvpName', 'MvpDealtLabel', 'MvpDealtRate', 'MvpDealtValue',
        'MvpTakenLabel', 'MvpTakenRate', 'MvpTakenValue', 'TeamLabel',
    ]) {
        const node = mustNode(name);
        const label = labelOf(node);
        const box = sizeOf(node);
        // `_overflow: 2` = SHRINK：塞不下就按比例缩字号。判据是「行数 × 行高」对框高。
        assert.equal(label._overflow, 2, `${name} 仍是 SHRINK（这条用例的前提）`);
        assert.ok(box.height >= label._lineHeight,
            `${name} 框高 ${box.height} < 行高 ${label._lineHeight}：SHRINK 会把 ${label._fontSize}px 缩到 `
            + `${(label._fontSize * box.height / label._lineHeight).toFixed(1)}px，屏上比美术稿小一圈`);
        assert.equal(label._actualFontSize, label._fontSize,
            `${name} 的 _actualFontSize 必须是全尺寸（留着旧值会让首帧按缩小后的字号排版）`);
    }
    const title = labelOf(mustNode('RewardTitle'));
    assert.ok(sizeOf(mustNode('RewardTitle')).width >= title._fontSize * 4, '框宽要放得下 4 个全角字，否则也会触发 SHRINK');
});

test('「变强途径」整组已按新稿下线（标题 / 底框 / 节点都不在）', () => {
    for (const name of ['GrowGroup', 'GrowTitle', 'GrowBg']) {
        assert.equal(nodeNamed(name), undefined, `${name} 不该再出现在 prefab 里`);
    }
    const panelNames = childNames(mustNode('Panel'));
    assert.deepEqual(panelNames, ['TitlePlate', 'MvpBlock', 'RankRow', 'RewardSection'], '面板只剩四块');
});

test('字与框的间距：标题墨迹下沿到框顶 ≈ 13px（美术稿 13.7px）', () => {
    const title = mustNode('RewardTitle');
    const bg = mustNode('RewardBg');
    const label = labelOf(title);
    const box = sizeOf(title);
    const bgTop = bg._lpos.y + sizeOf(bg).height / 2;

    // 中文字形墨迹高 ≈ 0.9 em（CJK 方块字上下留白很小）；标题垂直居中。
    const inkBottom = title._lpos.y - label._fontSize * 0.9 / 2;
    const gap = inkBottom - bgTop;
    assert.ok(gap >= 8 && gap <= 18, `标题到框顶的间距 ${gap.toFixed(1)}px 偏离美术稿（目标 ≈13px）`);
    // 间距靠**位置**控制，不靠改框高：框高由列表视窗决定。
    assert.equal(box.height, label._lineHeight, '标题框高 = 行高，多出来的高度会挤掉间距');
});
