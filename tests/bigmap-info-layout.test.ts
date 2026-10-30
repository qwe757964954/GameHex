/**
 * 世界页「目标详情」弹窗的**居中竖排**（用户 2026-10-22：「弹窗内的 icon 和描述以及标题
 * 需要统一居中对齐」）。
 *
 * 判据钉四件事：
 *
 *  1. **一条中线**：标题 / 图标 / 正文 / 单颗按钮的 x 全是 0（老排法里三者各偏一边）；
 *  2. **图标与正文不重叠**，且正文不越过按钮；
 *  3. **不截字**：正文是 `CLAMP`，高度给少了是"静默截断"，必须按行数算够；
 *  4. **图标让位**：空间不够时先缩再隐藏，文字优先。
 *
 * 外加源码反向守卫：不许再出现「用视口宽算卡片坐标」那种写法
 * （`-this.size.width / 2 + 80` —— 就是把图标推到卡片左边缘、压在正文上的那行）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    BIGMAP_INFO_MIN_ICON_HEIGHT,
    bigMapInfoLayout,
    type IBigMapInfoLayoutInput,
} from '../assets/script/app/bigmap/model/BigMapInfoLayout';

const PAGE_SRC = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');

function stripped(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 720×1280 设计稿上，弹窗卡片就是 560×400（见 `buildInfoPanel` 的 clamp）。 */
const PANEL_W = 560;
const PANEL_H = 400;

function input(patch: Partial<IBigMapInfoLayoutInput> = {}): IBigMapInfoLayoutInput {
    return {
        panelWidth: PANEL_W,
        panelHeight: PANEL_H,
        lines: 3,
        lineHeight: 19,
        hasPrimary: false,
        hasSecondary: true,
        iconHeight: 100,
        ...patch,
    };
}

// ============================================================
// 1. 一条中线
// ============================================================

test('标题 / 正文 / 单颗按钮都落在同一条中线上（x = 0）', () => {
    const layout = bigMapInfoLayout(input());
    assert.equal(layout.centerX, 0, '中线必须是 0');
    assert.equal(layout.secondaryX, 0, '只剩「定位」时它要摆正中间');
    assert.equal(layout.primaryX, 0, '「攻打」不可见时位置也必须归零（否则下次出现会残留在右边）');
});

test('两颗按钮都在时并排 ±76（与领地页弹窗同一排法）', () => {
    const layout = bigMapInfoLayout(input({ hasPrimary: true, hasSecondary: true }));
    assert.equal(layout.secondaryX, -76);
    assert.equal(layout.primaryX, 76);
    // 并排时整体仍然居中（左右对称）。
    assert.equal(layout.secondaryX + layout.primaryX, 0);
});

test('icon 的水平位置由视图写 `centerX`，模型只给尺寸（可断言"居中"）', () => {
    const body = stripped(PAGE_SRC);
    assert.match(body, /this\.infoTitle\.node\.setPosition\(layout\.centerX, layout\.titleY, 0\)/,
        '标题要摆在 model 给的中线上');
    assert.match(body, /this\.infoBody\.node\.setPosition\(layout\.centerX, layout\.bodyY, 0\)/,
        '正文要摆在同一条中线上');
    assert.match(body, /this\.placeInfoIcon\(layout\.iconSize, layout\.iconY\)/, '图标也走同一套结果');
    // 图标水平居中 = 减掉 trim 偏移（不补偿就会左右偏几像素）。
    assert.match(body, /node\.setPosition\(-frame\.offset\.x \* scale, centerY - frame\.offset\.y \* scale, 0\)/);
});

test('正文恒居中（不许回退成左对齐）', () => {
    const body = stripped(PAGE_SRC);
    const prefab = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    const bindings = prefab.find((item: object) => 'infoBody' in item && 'resourceLabels' in item);
    assert.equal(prefab[bindings.infoBody.__id__]._horizontalAlign, 1);
    assert.equal(prefab[bindings.infoBody.__id__]._verticalAlign, 1);
    assert.doesNotMatch(body, /hasThumbnail \? Label\.HorizontalAlign\.LEFT/, '老的「有图标就左对齐」已废弃');
});

// ============================================================
// 2. 不重叠 / 不越界
// ============================================================

test('图标与正文不重叠，正文不越过按钮', () => {
    const layout = bigMapInfoLayout(input({ iconHeight: 100 }));
    assert.equal(layout.iconVisible, true);
    const iconBottom = layout.iconY - layout.iconSize / 2;
    const bodyTop = layout.bodyY + layout.bodyHeight / 2;
    assert.ok(iconBottom > bodyTop, `图标下沿 ${iconBottom} 必须高于正文上沿 ${bodyTop}`);
    const bodyBottomEdge = layout.bodyY - layout.bodyHeight / 2;
    assert.ok(bodyBottomEdge > layout.actionY + 26,
        `正文下沿 ${bodyBottomEdge} 必须高于按钮上沿 ${layout.actionY + 26}（按钮 52 高）`);
});

test('标题在正文上方，且不与图标打架', () => {
    const layout = bigMapInfoLayout(input());
    assert.ok(layout.titleY > layout.iconY + layout.iconSize / 2, '标题要在图标上方');
    assert.ok(layout.iconY > layout.bodyY, '图标要在正文上方');
    assert.ok(layout.bodyY > layout.actionY, '正文要在按钮上方');
});

// ============================================================
// 3. 不截字
// ============================================================

test('3 行（截图那种据点）不截字，且图标正常显示', () => {
    const layout = bigMapInfoLayout(input({ lines: 3 }));
    assert.equal(layout.bodyClipped, false, '正文高度必须容得下 3 行');
    assert.equal(layout.iconVisible, true, '3 行的卡片放得下图标');
    assert.ok(layout.bodyHeight >= 3 * 19, `正文高度 ${layout.bodyHeight} 必须 ≥ 3 行`);
    // 截图那种场景：内容整块应当偏上（图标在标题下、按钮在底部），不是糊在中间。
    assert.ok(layout.iconY > layout.actionY, '图标要在按钮上方');
});

test('10 行（城池详情）仍不截字；图标要么缩小、要么让位，但绝不压字', () => {
    const layout = bigMapInfoLayout(input({ lines: 10, hasPrimary: true, hasSecondary: true }));
    assert.equal(layout.bodyClipped, false, '10 行也要放得下（城池详情最多也就这个量级）');
    assert.ok(layout.bodyHeight >= 10 * 19, `正文高度 ${layout.bodyHeight} 必须 ≥ 10 行`);
    if (layout.iconVisible) {
        const iconBottom = layout.iconY - layout.iconSize / 2;
        assert.ok(iconBottom > layout.bodyY + layout.bodyHeight / 2, '图标不能压到正文');
    }
});

test('行数越多正文越高（单调），且不会超过标题下方到按钮上方那块空间', () => {
    let previous = 0;
    for (const lines of [1, 3, 6, 10, 14]) {
        const layout = bigMapInfoLayout(input({ lines, hasPrimary: true, hasSecondary: true }));
        assert.ok(layout.bodyHeight >= previous, `行数 ${lines} 的正文高度不该变小`);
        previous = layout.bodyHeight;
        const bodyTop = layout.bodyY + layout.bodyHeight / 2;
        assert.ok(bodyTop <= layout.titleY - 34 + 0.001, '正文上沿不能顶进标题');
    }
});

// ============================================================
// 4. 图标让位
// ============================================================

test('空间不够时先等比缩小、缩到下限以下就整块不显示（文字优先）', () => {
    // 行数多 + 图标很大 ⇒ 余量不足 ⇒ 隐藏
    const tight = bigMapInfoLayout(input({ lines: 12, hasPrimary: true, hasSecondary: true, iconHeight: 240 }));
    if (!tight.iconVisible) {
        assert.equal(tight.iconSize, 0);
        // 隐藏图标后，正文必须顶到标题下方（把那块空间吃回来）
        assert.equal(tight.bodyY + tight.bodyHeight / 2, tight.titleY - 34);
    } else {
        assert.ok(tight.iconSize <= tight.bodyY + tight.bodyHeight / 2 - tight.iconY, '缩过的图标不得压字');
        assert.ok(tight.iconSize < 240, '必须真的缩小了');
    }
    // 极端：肯定放不下
    const impossible = bigMapInfoLayout(input({ lines: 20, hasPrimary: true, hasSecondary: true, iconHeight: 240 }));
    assert.equal(impossible.iconVisible, false, '完全放不下时必须让位');
});

test('图标高度永远不会超过可用余量，也永远不会低于下限还硬显示', () => {
    for (const iconHeight of [60, 100, 140, 200]) {
        for (const lines of [1, 4, 8, 12]) {
            const layout = bigMapInfoLayout(input({ iconHeight, lines, hasPrimary: true, hasSecondary: true }));
            if (layout.iconVisible) {
                assert.ok(layout.iconSize >= BIGMAP_INFO_MIN_ICON_HEIGHT, '显示了就不能小于下限');
                assert.ok(layout.iconSize <= iconHeight, '不能放大到超过自然尺寸');
            } else {
                assert.equal(layout.iconSize, 0);
            }
        }
    }
});

test('没有图标 / 没有按钮时也给出合法布局', () => {
    const noIcon = bigMapInfoLayout(input({ iconHeight: 0 }));
    assert.equal(noIcon.iconVisible, false);
    assert.equal(noIcon.bodyY + noIcon.bodyHeight / 2, noIcon.titleY - 34);
    const noActions = bigMapInfoLayout(input({ hasPrimary: false, hasSecondary: false }));
    assert.ok(noActions.bodyY - noActions.bodyHeight / 2 < noActions.actionY + 26, '没有按钮时正文可以更往下');
});

test('脏输入不产出 NaN', () => {
    const layout = bigMapInfoLayout({
        panelWidth: 0, panelHeight: 0, lines: 0, lineHeight: 0,
        hasPrimary: false, hasSecondary: false, iconHeight: 0,
    });
    for (const value of [layout.titleY, layout.iconY, layout.bodyY, layout.bodyHeight, layout.actionY]) {
        assert.ok(Number.isFinite(value), `排版数值出现 ${value}`);
    }
});

// ============================================================
// 5. 源码反向守卫
// ============================================================

test('不许再用「视口宽」算卡片内坐标（图标被推出卡片的原因）', () => {
    const body = stripped(PAGE_SRC);
    assert.doesNotMatch(body, /this\.size\.width \/ 2 \+ 80/,
        '卡片子节点必须用卡片局部坐标；用 this.size.width 会把图标推到卡片左边缘');
    assert.doesNotMatch(body, /fitBigMapSprite\(this\.infoThumbnail/,
        '详情的图标走 setInfoIcon + applyInfoLayout，不再直接 fit（fit 只管资源图标那种固定位置）');
});

test('每一轮 refreshInfo 都必须重排（内容方法里有 6 个提前 return）', () => {
    const body = stripped(PAGE_SRC);
    const start = body.indexOf('private refreshInfo(): void {');
    assert.ok(start > 0, '找不到 refreshInfo');
    const end = body.indexOf('private refreshInfoContent', start);
    const refreshInfo = body.slice(start, end > start ? end : undefined);

    // 内容分支可以提前返回，外层仍须统一排版。
    assert.match(refreshInfo,
        /this\.refreshInfoContent\(\);[\s\S]*this\.applyInfoLayout\(\);/,
        '排版要放在外层包装里，否则某个分支提前 return 就会留下上一轮的图标 / 按钮位置');

    // 2) 「正在进入战斗」的守卫可以早退（那时页面马上随流程销毁、详情内容不必刷），
    //    但早退**之前也必须排一次版** —— 否则上一轮的图标 / 按钮位置会留下来。
    const guardEnd = refreshInfo.indexOf('this.refreshInfoContent()');
    if (refreshInfo.includes('this.enteringBattle') && guardEnd > 0) {
        const guard = refreshInfo.slice(0, guardEnd);
        if (guard.includes('return;')) {
            assert.match(guard, /this\.applyInfoLayout\(\);/,
                '遮罩守卫可以提前 return，但早退前必须 applyInfoLayout');
        }
    }
});
