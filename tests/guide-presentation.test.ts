import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGuidePortrait, formatGuideContent, guideDialogBottom, guideHintMotion, PORTRAIT_BOX_WIDTH_RATIO } from '../assets/script/app/guide/model/GuidePresentation';

test('对话条避开底栏焦点；无重叠保持原位，顶部空间不足时放在焦点下方', () => {
    for (const height of [1280, 1560]) {
        assert.equal(guideDialogBottom(height, 184, 168, -height / 2 + 76, 80), 392);
        assert.equal(guideDialogBottom(height, 184, 168, 0, 40), 168);
    }
    const bottom = guideDialogBottom(1280, 184, 168, 0, 300);
    assert.equal(bottom, 116);
    assert.ok(bottom + 184 < 640 - 300 - 24);
});

test('提示与手指使用绝对时间，在接触点起止且不会随帧率积累偏移', () => {
    assert.deepEqual(guideHintMotion(1000, 1000), { hintScale: 1, handLift: 0 });
    assert.deepEqual(guideHintMotion(1000, 900), { hintScale: 1, handLift: 0 });
    assert.deepEqual(guideHintMotion(1000, 1600), { hintScale: 1.025, handLift: 7 });
    assert.deepEqual(guideHintMotion(1000, 2200), { hintScale: 1, handLift: 0 });
    const expected = guideHintMotion(1000, 1700);
    for (let now = 1000; now < 1700; now += 16) guideHintMotion(1000, now);
    assert.deepEqual(guideHintMotion(1000, 1700), expected);
});

test('台词保持原文，仅强调点它，文本中的富文本标签不能注入', () => {
    assert.equal(formatGuideContent('看到土包没？\n点它——敲脑门。'), '看到土包没？\n<color=#FFD129>点它</color>——敲脑门。');
    assert.equal(formatGuideContent('<img src="x"/> &'), '&lt;img src="x"/&gt; &amp;');
});

test('立绘尺寸：整张图 contain 进绿框（720 屏宽下 149×233），两种立绘都不得越框', () => {
    const boxWidth = 720 * PORTRAIT_BOX_WIDTH_RATIO;   // ≈149
    // 埃莉斯静图 500×800：高度顶满盒子，宽度 145.6 < 149。
    const still = fitGuidePortrait(500, 800, boxWidth, 233);
    assert.ok(Math.abs(still.height - 233) < 1e-9);
    assert.ok(Math.abs(still.width - 500 * (233 / 800)) < 1e-9);
    // 豌豆骨骼 654×916（更胖）：先顶到盒宽，高度跟着降到 208.6。
    const bone = fitGuidePortrait(654, 916, boxWidth, 233);
    assert.ok(Math.abs(bone.width - boxWidth) < 1e-9, '胖图由盒宽决定');
    assert.ok(Math.abs(bone.height - boxWidth * (916 / 654)) < 1e-9);
    assert.ok(bone.height < 233);
    // 两种都在框内，且比例不变。
    for (const size of [still, bone]) {
        assert.ok(size.width <= boxWidth + 1e-9 && size.height <= 233 + 1e-9, '必须在绿框内');
        const ratio = size.width / size.height;
        assert.ok(Math.abs(ratio - (size === still ? 500 / 800 : 654 / 916)) < 1e-12, '等比缩放，绝不拉伸');
    }
    // 矮胖图由盒高决定。
    assert.deepEqual(fitGuidePortrait(400, 100, boxWidth, 233), { width: boxWidth, height: boxWidth / 4 });
    // 非法入参 ⇒ 0 尺寸（调用方据此不显示空白框）。
    assert.deepEqual(fitGuidePortrait(0, 916, boxWidth, 233), { width: 0, height: 0 });
    assert.deepEqual(fitGuidePortrait(654, 0, boxWidth, 233), { width: 0, height: 0 });
    assert.deepEqual(fitGuidePortrait(654, 916, 0, 233), { width: 0, height: 0 });
    assert.deepEqual(fitGuidePortrait(654, 916, boxWidth, 0), { width: 0, height: 0 });
});
