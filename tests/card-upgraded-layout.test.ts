/**
 * 升级成功 / 预览页（`ui/card/CardUpgraded.prefab`）的三处对齐纪律。
 *
 * 用户 2026-11-20 对着效果图提的三条，全部是「prefab 数值错一格、跑起来只是难看、零报错」那类：
 *
 *  1. **进度填充与底槽对齐**：底槽 `ProgressBg` 442 宽、居中在 x=-3 ⇒ 内沿 [-224, 218]，
 *     按四周内缩 3px 应是 [-221, 215]。填充原来从 -218 起、宽度由代码写 `436 * ratio`
 *     ⇒ 左端多留 6px、右端顶死（满条时右端正好压在底槽边线上，左侧却露一条深色缝）。
 *     这里把「3px 对称内缩」钉死，并核运行时仍然按 436 算宽度（两侧各 3 = 442-6）。
 *
 *  2. **属性数字不许被字号限制**：四个属性数字的 Label 原来是 `_overflow: SHRINK` +
 *     `_lineHeight`/框高只有 21/23，而字号是 26/28 —— 行盒比字号还小，笔画只能被压着渲染，
 *     边缘发灰；同一份设置里 2px 黑描边在 26px 的字上又会把白芯吃掉。⇒ 行高 ≥ 字号、
 *     框高留 6px 余量、描边收到 1px。
 *
 *  3. **战斗力增益两行同字号同粗细**：标题 `BonusTitle` 是 Label（`_isBold: true`、字号 24），
 *     被 SHRINK 压成 `_actualFontSize = 18`（框高 24 < 行高 31，24 × 24/31 ≈ 18）；
 *     描述 `BonusDesc` 是 RichText 22px 常规。于是「标题看着比描述小、还更糊」。
 *     ⇒ 两边都 22、标题取消 bold。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prefab = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/card/CardUpgraded.prefab', 'utf8'),
) as Array<Record<string, any>>;
const pageSource = readFileSync('assets/script/app/card/CardUpgradedPage.ts', 'utf8');

const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
const nodeNamed = (name: string): Record<string, any> => {
    const found = nodes.find((node) => node._name === name);
    assert.ok(found, `CardUpgraded.prefab 里找不到节点 ${name}（改名了？）`);
    return found!;
};
const componentOf = (node: Record<string, any>, type: string): Record<string, any> => {
    const found = (node._components ?? [])
        .map((ref: { __id__: number }) => prefab[ref.__id__])
        .find((component: Record<string, any>) => component?.__type__ === type);
    assert.ok(found, `${String(node._name)} 上找不到 ${type}`);
    return found!;
};

/** 运行时把填充宽度写成 `436 * ratio`；底槽内宽 = 442 - 两侧各 3。 */
const FILL_TRACK_WIDTH = 436;
const TRACK_INSET = 3;

test('进度填充与底槽左右对称内缩，运行时宽度基准与底槽内宽一致', () => {
    const track = nodeNamed('ProgressBg');
    const fill = nodeNamed('ProgressFill');
    const trackTransform = componentOf(track, 'cc.UITransform');
    const trackHalf = Number(trackTransform._contentSize.width) / 2;
    const trackLeft = Number(track._lpos.x) - trackHalf;
    const trackRight = Number(track._lpos.x) + trackHalf;

    const fillLeft = Number(fill._lpos.x);
    assert.equal(fillLeft, trackLeft + TRACK_INSET,
        `填充左端应比底槽内沿缩进 ${TRACK_INSET}px（底槽 ${fillLeft} ⇒ 应为 ${trackLeft + TRACK_INSET}）`);
    assert.equal(fillLeft + FILL_TRACK_WIDTH, trackRight - TRACK_INSET,
        '满条时填充右端也要留同样的内缩，不能顶死在底槽边线上');
    //  竖直方向同一条纪律：填充居中，上下各留 3px（内缩值三处一致才好对图）。
    const fillTransform = componentOf(fill, 'cc.UITransform');
    const gap = (Number(trackTransform._contentSize.height) - Number(fillTransform._contentSize.height)) / 2;
    assert.equal(gap, TRACK_INSET, '填充上下也要各留 3px');

    // 2026-11-20 起宽度基准收敛成 `FILL_TRACK_WIDTH` 常量（表现时序要按比例退格，同一个数只能有一处）。
    assert.match(pageSource, /const FILL_TRACK_WIDTH = 436;/,
        '运行时宽度基准必须是 436（= 底槽 442 减去两侧各 3），改了这里要同步 prefab 的 x');
    assert.match(pageSource, /FILL_TRACK_WIDTH \* (ratio|progressRatioAt\()/,
        '填充宽度必须由 FILL_TRACK_WIDTH 乘比例得出，不许另写一条基准');
});

test('属性数字的行高与框高按字号给足，描边收到 1px（不再被压着渲染）', () => {
    for (const name of ['LeftHpValue', 'LeftHpGain', 'RightAttackValue', 'RightAttackGain']) {
        const node = nodeNamed(name);
        const label = componentOf(node, 'cc.Label');
        const size = Number(componentOf(node, 'cc.UITransform')._contentSize.height);
        const fontSize = Number(label._fontSize);
        const lineHeight = Number(label._lineHeight);
        assert.ok(lineHeight >= fontSize,
            `${name}：行高 ${lineHeight} 小于字号 ${fontSize}，笔画会被行盒压着渲染（边缘发虚）`);
        assert.ok(size >= lineHeight,
            `${name}：框高 ${size} 小于行高 ${lineHeight}，SHRINK 会介入缩放`);
        assert.ok(Number(label._outlineWidth) <= 1,
            `${name}：${fontSize}px 的字配 ${String(label._outlineWidth)}px 描边，白芯会被描边吃掉`);
        assert.equal(Number(label._actualFontSize), fontSize,
            `${name}：_actualFontSize 与 _fontSize 不一致说明编辑器里正被缩放（SHRINK 触发中）`);
    }
});

test('战斗力增益两行同字号同粗细（标题不再被 SHRINK 压成小一号粗体）', () => {
    const title = componentOf(nodeNamed('BonusTitle'), 'cc.Label');
    const desc = componentOf(nodeNamed('BonusDesc'), 'cc.RichText');

    assert.equal(Number(title._fontSize), Number(desc._fontSize),
        `标题 ${String(title._fontSize)}px 与描述 ${String(desc._fontSize)}px 必须同号`);
    assert.equal(title._isBold, false, '描述是 RichText 常规粗细，标题也要取消 bold 才能一致');

    const box = Number(componentOf(nodeNamed('BonusTitle'), 'cc.UITransform')._contentSize.height);
    assert.ok(box >= Number(title._lineHeight),
        `标题框高 ${box} 小于行高 ${String(title._lineHeight)}：SHRINK 会把 24px 压成 18px`);
    assert.equal(Number(title._actualFontSize), Number(title._fontSize),
        '标题的 _actualFontSize 必须等于字号，否则说明仍被压缩渲染');
});
