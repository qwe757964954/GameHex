import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    MAP_MARKER_BADGE_BOLD,
    MAP_MARKER_BADGE_FONT_SIZE,
    MAP_MARKER_BADGE_HEIGHT,
    MAP_MARKER_BADGE_LINE_HEIGHT,
    MAP_MARKER_BADGE_SPACING_X,
    MAP_MARKER_BADGE_TEXT_Y,
} from '../assets/script/app/common/MapMarkerBadge';

/**
 * 关卡编号气泡（`1-1`）的文字样式，2026-10-28 按美术效果图对齐。
 *
 * 美术稿和当时线上实拍差在两处，**都不是字号**：
 *   ① 笔画：美术稿笔画约占字高 25%，常规体只有 14% ⇒ 必须 `isBold`；
 *   ② 字距：美术稿是 `1-1` 三字紧贴，线上是 `1 - 1`（字符串里塞了空格）。
 * 字号（`MAP_MARKER_BADGE_FONT_SIZE = 15`）实测比例是够的（字高/气泡高 0.50 vs 美术 0.53），
 * 所以这里**故意不钉字号**，只钉字重、字距、以及「间距不许写进字符串」。
 */

const stationView = (): string =>
    readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const mapView = (): string =>
    readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');

test('编号气泡必须加粗：美术稿笔画约占字高 25%，常规体只有 14%', () => {
    assert.equal(MAP_MARKER_BADGE_BOLD, true, '`1-1` 在美术稿上是超粗体，不加粗怎么调字号都不像');
    assert.match(stationView(), /this\.badgeLabel\.isBold = MAP_MARKER_BADGE_BOLD;/);
    // 反向：不能再有写死的 `isBold = false`
    assert.doesNotMatch(stationView(), /this\.badgeLabel\.isBold = false/,
        'prefab 的 12/16/常规体是旧角标口径，气泡必须整组覆盖');
});

test('字距走 spacingX，不许靠字符串里的空格凑', () => {
    assert.ok(MAP_MARKER_BADGE_SPACING_X < 0,
        'Arial 数字侧边距偏大，`1-1` 会显得松，要用负字距收紧');
    const source = mapView();
    assert.ok(source.includes('`${stage.chapterId}-${stage.stage}`'),
        '美术稿是 `1-1`，连字符两侧不留空格');
    assert.ok(!source.includes('`${stage.chapterId} - ${stage.stage}`'),
        '⛔ 空格宽度跟字号绑定，塞进字符串后换字号 / 换字体就会漂 —— 间距只能交给 spacingX');
});

test('renderLevelBubble 必须把字重 / 字距 / 行高 / 抬升真的写进 Label', () => {
    const source = stationView();
    assert.match(source, /this\.badgeLabel\.spacingX = MAP_MARKER_BADGE_SPACING_X;/);
    assert.match(source, /this\.badgeLabel\.lineHeight = MAP_MARKER_BADGE_LINE_HEIGHT;/);
    assert.match(source, /this\.badgeLabel\.node\.setPosition\(0, MAP_MARKER_BADGE_TEXT_Y, 0\);/);
    // 只剩字号一处硬编码是允许的，但要经常量出口
    assert.match(source, /this\.badgeLabel\.fontSize = MAP_MARKER_BADGE_FONT_SIZE;/);
});

test('行高要装得进文字节点，否则 SHRINK 会把刚调好的字号又缩回去', () => {
    assert.ok(MAP_MARKER_BADGE_LINE_HEIGHT >= MAP_MARKER_BADGE_FONT_SIZE,
        '行高小于字号会把字裁掉');
    assert.ok(MAP_MARKER_BADGE_HEIGHT >= MAP_MARKER_BADGE_LINE_HEIGHT,
        '文字节点只有 30 高，行高再大就会触发 Overflow.SHRINK 反缩字号');
});

test('文字抬升不能把自己顶出气泡框', () => {
    assert.ok(MAP_MARKER_BADGE_TEXT_Y > 0, '气泡底部有小尾巴，居中会被尾巴吃掉一截');
    assert.ok(MAP_MARKER_BADGE_TEXT_Y < MAP_MARKER_BADGE_HEIGHT / 2,
        '抬太多文字会顶到框上沿');
});
