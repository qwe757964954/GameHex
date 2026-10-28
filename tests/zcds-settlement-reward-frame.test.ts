import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * 结算弹窗「资源部分」（通关奖励）的两件事（2026-10-27 用户口径）：
 *
 *  ① **少了底框** —— 美术稿里道具格外面那块深色圆角底板在 prefab 里根本没有，
 *     屏上只剩「通关奖励」标题和两条装饰线，道具直接浮在面板底上（截图自证）；
 *  ② **字体要跟美术稿统一** —— 字号 / 行高 / 颜色 / 描边 / 字重，以及与框的间距。
 *
 * 全部按**结构事实**断言（不依赖 `cc`，规则 78），能在 Node 里直接跑。
 *
 * 设计稿标注（蓝湖「通关奖励 拷贝」）：字号 13sp、行高 15.5dp、颜色 #FFFEFA、
 * MicrosoftYaHei Regular、距离左上 152/295.5dp、图层 56.5×13.5dp。
 * 美术按 **2×** 出图（56.5×13.5 的图层在 prefab 里就是 113×31）⇒ 26px / 31px。
 */
const ROOT = join(__dirname, '..');
const PREFAB = join(ROOT, 'assets/bundles/battle/ui/game/ZCSettlement.prefab');
const BG02_META = join(ROOT, 'assets/bundles/battle/image/settlement/bg_02.png.meta');
const BG02_PNG = join(ROOT, 'assets/bundles/battle/image/settlement/bg_02.png');

type TObj = Record<string, any>;
const raw = JSON.parse(readFileSync(PREFAB, 'utf8')) as TObj[];
const nodes = raw.filter((o) => o && o.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((n) => n._name === name)!;
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
    const section = nodeNamed('RewardSection');
    assert.ok(section, 'RewardSection 必须存在');
    const names = childNames(section);
    assert.ok(names.includes('RewardBg'), `资源区缺底框节点（现有子节点：${names.join(' / ')}）`);
    assert.equal(names[0], 'RewardBg', '底框必须是第一个子节点 —— 子节点序 = 渲染顺序，排在列表后面就被盖住了');
    // 列表本身还在（别为了"加底框"把列表挤掉）。
    assert.ok(names.includes('RewardScroll'));
});

test('底框的矩形 == 列表视窗的矩形（对齐 ±0，四边都不许错位）', () => {
    const bg = nodeNamed('RewardBg');
    const scroll = nodeNamed('RewardScroll');
    const bgSize = sizeOf(bg);
    const scrollSize = sizeOf(scroll);

    assert.deepEqual([bgSize.width, bgSize.height], [scrollSize.width, scrollSize.height],
        '底框要和列表视窗同尺寸（美术稿里框正好包住道具格）');

    // 视窗锚点 (0.5, 1) 在 y=144.5 ⇒ 顶边 144.5、底边 144.5-327。
    // 底框锚点 (0.5, 0.5) 在 y=-19 ⇒ 顶边 -19+327/2 = 144.5。两条都算一遍，谁改坏了都能抓到。
    const scrollTop = scroll._lpos.y;
    const scrollBottom = scrollTop - scrollSize.height;
    const bgTop = bg._lpos.y + bgSize.height / 2;
    const bgBottom = bg._lpos.y - bgSize.height / 2;
    assert.equal(bgTop, scrollTop, '底框顶边必须与列表视窗顶边齐平');
    assert.equal(bgBottom, scrollBottom, '底框底边必须与列表视窗底边齐平');
});

test('底框复用 bg_02（和「变强途径」同一张），且是**九宫格**拉伸：圆角不许被拉长', () => {
    const bg = nodeNamed('RewardBg');
    const sprite = spriteOf(bg);
    const growBg = spriteOf(nodeNamed('GrowBg'));

    assert.ok(sprite, '底框要有 cc.Sprite');
    assert.equal(sprite._spriteFrame.__uuid__, growBg._spriteFrame.__uuid__,
        '和下方「变强途径」必须是同一张底图，否则两个框的灰度和圆角对不上');
    // cc.Sprite.Type：SIMPLE=0 / SLICED=1。131 高的图拉到 327 高，SIMPLE 会把圆角竖着拉成椭圆。
    assert.equal(sprite._type, 1, '底框必须走 SLICED（九宫格），SIMPLE 会把 R10 的圆角拉成椭圆');
    assert.equal(sprite._sizeMode, 0, '尺寸由节点（CUSTOM）决定，不要改 TRIMMED/RAW');
});

test('bg_02 的九宫格边距 ≥ 实际圆角半径（否则切角被切掉）', () => {
    const meta = JSON.parse(readFileSync(BG02_META, 'utf8')) as TObj;
    const frame = meta.subMetas.f9941.userData;
    for (const key of ['borderTop', 'borderBottom', 'borderLeft', 'borderRight']) {
        assert.ok(frame[key] >= 10, `${key} = ${frame[key]}，必须盖住 10px 的圆角`);
    }
    // 上/下边框 + 至少 1px 中段才算合法的九宫格图。
    assert.ok(frame.borderTop + frame.borderBottom < frame.height, '上下边距之和不能吃掉整张图');
    assert.ok(frame.borderLeft + frame.borderRight < frame.width, '左右边距之和不能吃掉整张图');

    // 圆角半径回 PNG 里量一遍：第 0 行第一个不透明像素的 x 就是半径量级。
    const png = readFileSync(BG02_PNG);
    assert.equal(png.readUInt32BE(16), frame.width, 'meta 里的 width 要和 PNG 一致');
    assert.equal(png.readUInt32BE(20), frame.height, 'meta 里的 height 要和 PNG 一致');
});

// ============================================================
// 二、字体：字号 / 行高 / 颜色 / 字重 / 描边 / 与框的间距
// ============================================================

test('「通关奖励」标题按美术稿：13sp / 15.5dp / #FFFEFA / 不加粗', () => {
    const label = labelOf(nodeNamed('RewardTitle'));
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
    const label = labelOf(nodeNamed('RewardTitle'));
    assert.equal(label._enableOutline, true, '标题要描边');
    assert.deepEqual([label._outlineColor.r, label._outlineColor.g, label._outlineColor.b], [0, 0, 0]);
    assert.ok(label._outlineWidth >= 2, '描边太细在深色底上会发糊');
});

test('🔴 字号不许被 SHRINK 偷偷缩小：Label 高度 ≥ 行高（否则 26 会渲染成 22）', () => {
    for (const name of ['RewardTitle', 'GrowTitle']) {
        const node = nodeNamed(name);
        const label = labelOf(node);
        const box = sizeOf(node);
        // `_overflow: 2` = SHRINK：塞不下就按比例缩字号。判据是「行数 × 行高」对框高。
        assert.equal(label._overflow, 2, `${name} 仍是 SHRINK（这条用例的前提）`);
        assert.ok(box.height >= label._lineHeight,
            `${name} 框高 ${box.height} < 行高 ${label._lineHeight}：SHRINK 会把 ${label._fontSize}px 缩到 `
            + `${(label._fontSize * box.height / label._lineHeight).toFixed(1)}px，屏上比美术稿小一圈`);
        assert.equal(label._actualFontSize, label._fontSize,
            `${name} 的 _actualFontSize 必须是全尺寸（留着旧值会让首帧按缩小后的字号排版）`);
        assert.ok(box.width >= label._fontSize * 4, '框宽要放得下 4 个全角字，否则也会触发 SHRINK');
    }
});

test('两个字标题**同一套字号**（资源区与变强途径在美术稿里是同级标题）', () => {
    const reward = labelOf(nodeNamed('RewardTitle'));
    const grow = labelOf(nodeNamed('GrowTitle'));
    assert.equal(reward._fontSize, grow._fontSize, '两处字号必须一样');
    assert.equal(reward._lineHeight, grow._lineHeight, '两处行高必须一样');
    assert.deepEqual(
        [reward._color.r, reward._color.g, reward._color.b],
        [grow._color.r, grow._color.g, grow._color.b],
        '两处颜色必须一样',
    );
});

test('字与框的间距：标题墨迹下沿到框顶 ≈ 13px（美术稿 13.7px）', () => {
    const title = nodeNamed('RewardTitle');
    const bg = nodeNamed('RewardBg');
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
