import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePngRgba } from './helpers/png-alpha';
import * as Bubble from '../assets/script/app/territory/model/TerritoryLevelBubble';
import { territoryChestBubbleLayout } from '../assets/script/app/territory/model/TerritoryChestBubble';
import {
    FakeColor, FakeNode, makeStationView,
    type StationRenderContent,
} from './helpers/territory-station-fixtures';

/**
 * 2026-11-23 用户：「头像图 没有在红色地图居中显示」。
 *
 * 截图（领地紫色城堡上方那颗红气泡）：头像贴着红框下沿 / 小尖角，上方空出一大片红。
 * 静态链路全对 —— 底图是红 `frame_02`、头像是 `icon_hero_head_40018`、
 * 节点是运行时 `LevelBubbleIcon`、尺寸 60×66 / 46 —— 偏的是**两笔几何修正只补了一笔**：
 *
 * 1. `frame_02`（94×45，`SLICED`）的圆角主体只到 raw 行 36，`37..44` 是 8px 小尖角；
 *    上下切边 1:1 ⇒ 主体可见中心恒比**气泡节点中心**高 4px。
 * 2. 头像 `trimType: auto`，204×204 被 trim 到 `(0,27,200,177)`，`offset=(-2,-13.5)`；
 *    `LevelBubbleIcon` 是 `trim=false + CUSTOM` ⇒ 可见中心比节点中心低
 *    `13.5 × 46/204 ≈ 3.04px`。旧常量 `PORTRAIT_Y = 3` 补的正好只有这一笔。
 *
 * ⇒ 旧写法把头像可见中心摆在节点中心 (0)，红框主体中心却在 +4：上留白 ~13px、下留白 ~5px。
 * 现在落点统一由 `territoryPvpBubblePortraitPosition` 按帧几何算，且**从 PNG + meta 反量**。
 */

const RED_PNG = 'assets/bundles/battle/image/spawn-region/frame_02.png';
const HEAD_PNG = 'assets/resources/icons/head/icon_hero_head_40018.png';
const VIEW_SRC = 'assets/script/app/territory/view/TerritoryStationView.ts';
const MODEL_SRC = 'assets/script/app/territory/model/TerritoryLevelBubble.ts';

/** 逐行 `alpha > threshold` 的可见像素数（PNG 行序自上而下）。 */
function rowVisibleCounts(path: string, threshold = 60): number[] {
    const { width, height, pixels } = decodePngRgba(path);
    const rows: number[] = [];
    for (let row = 0; row < height; row += 1) {
        let count = 0;
        for (let x = 0; x < width; x += 1) {
            if (pixels[(row * width + x) * 4 + 3] > threshold) count += 1;
        }
        rows.push(count);
    }
    return rows;
}

function spriteFrameMeta(path: string): Record<string, any> {
    return JSON.parse(readFileSync(`${path}.meta`, 'utf8')).subMetas.f9941.userData;
}

/** 把真 meta 折成视图运行时会拿到的 `SpriteFrame` 几何子集。 */
function headFrame(): {
    readonly originalSize: { readonly width: number; readonly height: number };
    readonly rect: { readonly width: number; readonly height: number };
    readonly offset: { readonly x: number; readonly y: number };
} {
    const meta = spriteFrameMeta(HEAD_PNG);
    return {
        originalSize: { width: meta.rawWidth, height: meta.rawHeight },
        rect: { width: meta.width, height: meta.height },
        offset: { x: meta.offsetX, y: meta.offsetY },
    };
}

// ============================================================
// 一、磁盘真值：两张图的实测几何
// ============================================================

test('★frame_02：圆角主体到 raw 36 行，下面 8 行只剩居中小尖角 ⇒ 主体中心抬升 4px', () => {
    const rows = rowVisibleCounts(RED_PNG);
    const meta = spriteFrameMeta(RED_PNG);
    assert.equal(rows.length, meta.rawHeight, 'PNG 行高必须与 meta rawHeight 一致');
    assert.equal(meta.rawHeight, Bubble.TERRITORY_PVP_BUBBLE_FRAME_HEIGHT);
    const max = Math.max(...rows);
    // 主体每一行都至少占最大宽度的一半；尖角那几行只有 6~16 像素。
    const bodyBottom = rows.reduce((last, count, row) => (count >= max / 2 ? row : last), 0);
    assert.equal(bodyBottom, Bubble.TERRITORY_PVP_BUBBLE_BODY_BOTTOM_ROW);
    assert.equal(rows.length - 1 - bodyBottom, Bubble.TERRITORY_PVP_BUBBLE_TAIL_ROWS);
    assert.ok(rows.slice(bodyBottom + 1).every((count) => count < max / 2),
        '尖角那几行必须明显比主体窄，否则「主体中心」这个判据不成立');
    assert.equal(Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y, 4);
    // 九宫格上下切边是 1:1 渲染的前提：border 都小于节点尺寸，不会被压缩。
    assert.equal(meta.borderTop, 12);
    assert.equal(meta.borderBottom, 16);
    assert.equal(meta.packable, false);
    assert.ok(meta.borderTop + meta.borderBottom < Bubble.TERRITORY_PVP_BUBBLE_HEIGHT);
});

test('★头像 auto trim：meta 的 offset 与 PNG 量出的可见中心逐像素一致', () => {
    const meta = spriteFrameMeta(HEAD_PNG);
    assert.equal(meta.trimType, 'auto');
    assert.equal(meta.rawWidth, Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_CANVAS);
    assert.equal(meta.rawHeight, Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_CANVAS);
    assert.equal(meta.offsetX, Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_X);
    assert.equal(meta.offsetY, Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_OFFSET_Y);
    assert.equal(meta.trimY, 27);
    assert.equal(meta.height, 177);

    const { width, height, pixels } = decodePngRgba(HEAD_PNG);
    let minX = width;
    let maxX = -1;
    let minRow = height;
    let maxRow = -1;
    for (let row = 0; row < height; row += 1) {
        for (let x = 0; x < width; x += 1) {
            if (pixels[(row * width + x) * 4 + 3] === 0) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
        }
    }
    // 左→右：可见中心 100 vs 画布中心 102 ⇒ offsetX = -2。
    assert.equal((minX + maxX + 1) / 2 - width / 2, meta.offsetX);
    // 上→下换成 Y 向上：可见中心 115.5 在画布中心 102 之下 13.5 ⇒ offsetY = -13.5。
    assert.equal(height / 2 - (minRow + maxRow + 1) / 2, meta.offsetY);
});

// ============================================================
// 二、纯函数：两笔修正都在，且真的居中
// ============================================================

test('★真帧落点 = 尖角抬升 4 + trim 补偿 3.04，x 也一起补', () => {
    const frame = headFrame();
    const point = Bubble.territoryPvpBubblePortraitPosition(frame);
    const scale = Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE / frame.originalSize.height;
    assert.ok(Math.abs(point.y - (Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y
        - frame.offset.y * scale)) < 1e-9);
    assert.ok(Math.abs(point.x - (-frame.offset.x * scale)) < 1e-9);
    assert.ok(point.y > 7 && point.y < 7.1, `落点 Y 应约 7.04，实得 ${point.y}`);
    assert.ok(point.x > 0.4 && point.x < 0.5, `落点 X 应约 0.45，实得 ${point.x}`);
    // 减去 trim 偏移后，可见内容中心正好压在红框主体中心。
    const visibleCenterY = point.y + frame.offset.y * scale;
    assert.ok(Math.abs(visibleCenterY - Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y) < 1e-9);
});

test('★居中验收：上下留白相等；旧的固定 +3 上宽下窄正好差一条小尖角', () => {
    const frame = headFrame();
    const size = Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE;
    const scale = size / frame.originalSize.height;
    const visibleHeight = frame.rect.height * scale;
    const nodeHeight = Bubble.TERRITORY_PVP_BUBBLE_HEIGHT;
    // 上下切边 1:1 ⇒ 节点顶 = raw 0；主体底（开区间）= raw 37 ⇒ 节点 y = Nh - H + 37。
    const bodyBottomFromTop = nodeHeight - Bubble.TERRITORY_PVP_BUBBLE_FRAME_HEIGHT
        + (Bubble.TERRITORY_PVP_BUBBLE_BODY_BOTTOM_ROW + 1);
    const bodyTopY = nodeHeight / 2;
    const bodyBottomY = nodeHeight / 2 - bodyBottomFromTop;
    assert.ok(Math.abs((bodyTopY + bodyBottomY) / 2
        - Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y) < 1e-9, '主体中心口径自洽');

    const gaps = (centerY: number) => ({
        top: bodyTopY - (centerY + visibleHeight / 2),
        bottom: (centerY - visibleHeight / 2) - bodyBottomY,
    });
    const point = Bubble.territoryPvpBubblePortraitPosition(frame);
    const now = gaps(point.y + frame.offset.y * scale);
    assert.ok(Math.abs(now.top - now.bottom) < 1e-9,
        `上下留白必须相等，实得 ${now.top.toFixed(2)} / ${now.bottom.toFixed(2)}`);
    assert.ok(now.top > 0 && now.bottom > 0, '头像不许溢出红色主体');

    // 旧口径：常量 3 只补 trim ⇒ 可见中心≈0，比主体中心低 4px。
    const old = gaps(3 + frame.offset.y * scale);
    assert.ok(old.top - old.bottom >= Bubble.TERRITORY_PVP_BUBBLE_TAIL_ROWS - 0.01,
        `旧 +3 的上下留白差应≈8px，实得 ${(old.top - old.bottom).toFixed(2)}`);
    assert.ok(old.bottom < now.bottom, '旧口径下边更贴底');
});

test('★无 trim 的帧只抬尖角那一笔：y = 4、x = 0', () => {
    const point = Bubble.territoryPvpBubblePortraitPosition({
        originalSize: { width: 128, height: 128 }, offset: { x: 0, y: 0 },
    });
    assert.equal(point.y, Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y);
    assert.equal(point.x, 0);
});

test('换头像画布 / 尺寸时落点按帧几何重算，不写死 7', () => {
    const point = Bubble.territoryPvpBubblePortraitPosition(
        { originalSize: { width: 100, height: 200 }, offset: { x: 10, y: -20 } }, 50);
    assert.ok(Math.abs(point.y - (4 + 20 * 50 / 200)) < 1e-9);
    assert.ok(Math.abs(point.x - (-10 * 50 / 100)) < 1e-9);
    const bigger = Bubble.territoryPvpBubblePortraitPosition(headFrame(), 92);
    const base = Bubble.territoryPvpBubblePortraitPosition(headFrame(), 46);
    assert.ok(bigger.y > base.y, '节点变大 ⇒ trim 补偿等比例变大');
});

test('缺帧 / 非法画布 / 非有限 offset 一律兜底，不产出 NaN', () => {
    const fallback = Bubble.territoryPvpBubblePortraitPosition(null);
    assert.ok(Number.isFinite(fallback.x) && Number.isFinite(fallback.y));
    assert.equal(fallback.y, Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_Y);
    for (const frame of [
        {},
        { originalSize: { width: 0, height: 204 } },
        { originalSize: { width: 204, height: Number.NaN } },
        { originalSize: { width: 204, height: 204 }, offset: { x: Number.NaN, y: Infinity } },
    ]) {
        const point = Bubble.territoryPvpBubblePortraitPosition(frame);
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), JSON.stringify(frame));
    }
    const noOffset = Bubble.territoryPvpBubblePortraitPosition(
        { originalSize: { width: 204, height: 204 }, offset: { x: Number.NaN, y: Infinity } });
    assert.equal(noOffset.y, Bubble.TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y);
    assert.equal(noOffset.x, 0);
    assert.equal(Bubble.territoryPvpBubblePortraitPosition(headFrame(), 0).y,
        Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_Y, 'size 非法也退回当前美术');
});

// ============================================================
// 三、视图接线：真 VM 落点与源码守卫
// ============================================================

function renderPortrait(portraitFrame: unknown): {
    readonly portrait: FakeNode;
    readonly badge: FakeNode;
    readonly renderAgain: (next: Record<string, unknown>) => void;
} {
    const { view, badge } = makeStationView();
    // 夹具的 `FakeColor` 没实现 `cc.Color.set`，而宝箱气泡那一支 `themeLevelBubbleLabel`
    // 会整组写回描边色。只在本文件补这个引擎 API，不动共享夹具（避免影响其它 VM 用例）。
    Object.assign(view as unknown as Record<string, unknown>, {
        badgeOutlineTint: { set: () => undefined },
    });
    const content = {
        site: {},
        icon: { originalSize: { width: 128, height: 128 }, rect: { width: 128, height: 128 },
            offset: { x: 0, y: 0 } },
        levelBubble: 'PVP', levelBubbleFrame: {}, levelBubblePortrait: portraitFrame,
        caption: '', badge: '', tint: FakeColor.WHITE, interactive: true,
    };
    view.render(content);
    const portrait = (view as unknown as { levelBubbleIcon: { node: FakeNode } }).levelBubbleIcon.node;
    return {
        portrait, badge,
        // 夹具的 `StationRenderContent` 没列 `levelBubbleIcon`（真接口有），这里按结构断言补传。
        renderAgain: (next) => view.render({ ...content, ...next } as unknown as StationRenderContent),
    };
}

test('★VM 行为对拍：头像节点真的按纯函数落位（x / y 都写）', () => {
    const frame = headFrame();
    const { portrait, badge } = renderPortrait(frame);
    const point = Bubble.territoryPvpBubblePortraitPosition(frame);
    assert.equal(portrait.position.y, point.y);
    assert.equal(portrait.position.x, point.x);
    assert.equal(badge.active, false, 'PVP 头像气泡不显示编号文字');
});

test('★VM 行为对拍：切回宝箱气泡恢复「x=0 + chest.iconY」上下两行，不残留头像偏移', () => {
    const frame = headFrame();
    const { portrait, badge, renderAgain } = renderPortrait(frame);
    const layout = territoryChestBubbleLayout();
    renderAgain({ levelBubblePortrait: null, levelBubbleIcon: { name: 'stamina' } });
    assert.equal(portrait.position.x, 0);
    assert.equal(portrait.position.y, layout.iconY);
    assert.equal(badge.position.y, layout.textY);
    assert.equal(badge.active, true);
});

test('★源码守卫：落点只读 model 纯函数，旧固定 Y 分支已整条删掉', () => {
    const view = readFileSync(VIEW_SRC, 'utf8');
    const model = readFileSync(MODEL_SRC, 'utf8');
    assert.match(view, /territoryPvpBubblePortraitPosition\(iconFrame, iconSize\)/);
    assert.match(view, /icon\.node\.setPosition\(point\.x, point\.y, 0\)/);
    assert.doesNotMatch(view, /isPortrait \? TERRITORY_PVP_BUBBLE_PORTRAIT_Y/);
    assert.match(view, /sprite\.trim = false/, 'LevelBubbleIcon 仍是 trim=false，否则 offset 补偿口径不成立');
    assert.doesNotMatch(model, /from ['"]cc['"]/, '模型层不许依赖 cc');
    assert.match(model, /TERRITORY_PVP_BUBBLE_BODY_CENTER_LIFT_Y/);
    // 🔴 别把 +3 改回硬编码：常量只剩「无帧兜底」一个用途，且必须 > 3。
    assert.ok(Bubble.TERRITORY_PVP_BUBBLE_PORTRAIT_Y > 3);
});
