import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGuidePortrait, formatGuideContent, guideDialogBottom, guideHintMotion } from '../assets/script/app/guide/model/GuidePresentation';

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

test('立绘尺寸：瘦高图按目标高度，胖图（骨骼）被宽度上限钳住且不拉伸', () => {
    // 埃莉斯静图 500×800、目标高 460 ⇒ 287.5 宽，正好贴着 720 屏宽的上限（288）。
    assert.deepEqual(fitGuidePortrait(500, 800, 460, 720), { width: 287.5, height: 460 });
    // 窄图不受钳制。
    assert.deepEqual(fitGuidePortrait(300, 800, 460, 720), { width: 172.5, height: 460 });
    // 豌豆骨骼 654×916 ⇒ 宽 328 > 288，按宽度钳，高度跟着降到 403.4（比例不变）。
    const bone = fitGuidePortrait(654, 916, 460, 720);
    assert.equal(bone.width, 288);
    assert.ok(Math.abs(bone.height - 288 * (916 / 654)) < 1e-9);
    assert.ok(Math.abs(bone.width / bone.height - 654 / 916) < 1e-12, '等比缩放，绝不拉伸');
    // 非法入参 ⇒ 0 尺寸（调用方据此不显示空白框）。
    assert.deepEqual(fitGuidePortrait(0, 916, 460, 720), { width: 0, height: 0 });
    assert.deepEqual(fitGuidePortrait(654, 0, 460, 720), { width: 0, height: 0 });
    assert.deepEqual(fitGuidePortrait(654, 916, 0, 720), { width: 0, height: 0 });
});
