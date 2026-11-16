import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGuideContent, guideDialogBottom, guideHintMotion } from '../assets/script/app/guide/model/GuidePresentation';

test('提示与手指使用绝对时间，在接触点起止且不会随帧率积累偏移', () => {
    assert.deepEqual(guideHintMotion(1000, 1000), { hintScale: 1, handLift: 0 });
    assert.deepEqual(guideHintMotion(1000, 900), { hintScale: 1, handLift: 0 });
    assert.deepEqual(guideHintMotion(1000, 1600), { hintScale: 1.025, handLift: 7 });
    assert.deepEqual(guideHintMotion(1000, 2200), { hintScale: 1, handLift: 0 });
    const expected = guideHintMotion(1000, 1700);
    for (let now = 1000; now < 1700; now += 16) guideHintMotion(1000, now);
    assert.deepEqual(guideHintMotion(1000, 1700), expected);
});

test('底部按钮被对话条覆盖时，对话条移到提示条上方并留出完整点击范围', () => {
    for (const height of [1280, 1558, 1920]) {
        const focusY = -height / 2 + 243;
        const bottom = guideDialogBottom(height, 154, 115, focusY, 49);
        assert.ok(bottom - height / 2 > focusY + 49 + 220);
        assert.ok(bottom + 154 <= height - 16);
    }
    assert.equal(guideDialogBottom(1280, 154, 115, 100, 50), 115);
    // 焦点离开底部后回到 prefab 基准位置，不累积上一步的位移。
    assert.equal(guideDialogBottom(1280, 154, 115, 0, 50), 115);
});

test('短屏上方空间不够时，对话条改到焦点下方', () => {
    const bottom = guideDialogBottom(600, 154, 115, -70, 45);
    assert.ok(bottom + 154 < 300 - 70 - 45);
});

test('台词保持原文，仅强调点它，文本中的富文本标签不能注入', () => {
    assert.equal(formatGuideContent('看到土包没？\n点它——敲脑门。'), '看到土包没？\n<color=#FFD129>点它</color>——敲脑门。');
    assert.equal(formatGuideContent('<img src="x"/> &'), '&lt;img src="x"/&gt; &amp;');
});
