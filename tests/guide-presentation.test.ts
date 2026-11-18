import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGuidePortrait, formatGuideContent, guideDialogBottom, guideHintMotion, PORTRAIT_BOX_WIDTH_RATIO, unionGuideFocusRects } from '../assets/script/app/guide/model/GuidePresentation';

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
    // 描边不透明度跟同一拍呼吸（第 16 条 ③）：谷底 0.55、波峰 1，乘到 `RING_ALPHA_MAX` 上。
    assert.deepEqual(guideHintMotion(1000, 1000), { hintScale: 1, handLift: 0, ringAlpha: 0.55 });
    assert.deepEqual(guideHintMotion(1000, 900), { hintScale: 1, handLift: 0, ringAlpha: 0.55 });
    assert.deepEqual(guideHintMotion(1000, 1600), { hintScale: 1.025, handLift: 7, ringAlpha: 1 });
    assert.deepEqual(guideHintMotion(1000, 2200), { hintScale: 1, handLift: 0, ringAlpha: 0.55 });
    for (let now = 1000; now <= 2200; now += 16) {
        const { ringAlpha } = guideHintMotion(1000, now);
        assert.ok(ringAlpha >= 0.55 && ringAlpha <= 1, '不透明度永远收敛在 0.55~1，不会越呼吸越淡');
    }
    const expected = guideHintMotion(1000, 1700);
    for (let now = 1000; now < 1700; now += 16) guideHintMotion(1000, now);
    assert.deepEqual(guideHintMotion(1000, 1700), expected);
});

test('焦点矩形并集：关卡地块 + 编号气泡 一起圈住，非法输入返回 null', () => {
    const tile = { x: 0, y: 0, halfWidth: 61.5, halfHeight: 45 };
    // 气泡抬在地块上方（`mapMarkerBadgeY`：可见顶 + 半高 + 3）。
    const bubble = { x: 0, y: 82, halfWidth: 47, halfHeight: 22.5 };
    // 地块 y ∈ [-45, 45]、气泡 y ∈ [59.5, 104.5] ⇒ 中心 29.75、半高 74.75；宽度不变。
    assert.deepEqual(unionGuideFocusRects([tile, bubble]),
        { x: 0, y: 29.75, halfWidth: 61.5, halfHeight: 74.75 });
    // 只有一块 ⇒ 值与入参一致。
    assert.deepEqual(unionGuideFocusRects([tile]), tile);
    // 空集 / 全是 0 尺寸 ⇒ null（调用方按「没有孔」处理，别画出 0×0 的圈）。
    assert.equal(unionGuideFocusRects([]), null);
    assert.equal(unionGuideFocusRects([{ x: 0, y: 0, halfWidth: 0, halfHeight: 0 }]), null);
    // 横向并集：气泡伸到右边 ⇒ 宽度变大、中心跟着右移。
    assert.deepEqual(unionGuideFocusRects([tile, { x: 90, y: 0, halfWidth: 20, halfHeight: 10 }]),
        { x: 24.25, y: 0, halfWidth: 85.75, halfHeight: 45 });
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
