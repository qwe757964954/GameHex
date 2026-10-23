/**
 * 开箱表演的**落位与尺寸**（用户 2026-10-22：「动画的节点大小需要与原宝箱静止状态的大小相近
 * （可以轻微的放大），坐标点保持一致不要有明显的偏移」）。
 *
 * 判据分三层，缺一层就会静默错位：
 *
 *  1. **美术口径**（解 PNG）：`TERRITORY_CHEST_ART_METRICS` 的每个数字都要与 `chest_seq_0.png`
 *     的 alpha 包围盒逐项相等；六帧必须同画布、同底边（否则开盖时箱体上下跳）。
 *  2. **换算**（纯函数）：目标可见宽 84 ⇒ 缩放 `84/138`、纵向补偿 `21×scale`。
 *  3. **视图**（源码守卫）：归一必须走「可见宽」而不是「画布高」；位置必须带补偿；
 *     曾经的「可见高 132」不得回流。
 *
 * ⚠️ 第 1 层为什么必须读真图：`.meta` 对补帧图（`trimType: "none"`）给的是整块画布，
 *   运行时 `frame.rect` 也是整块画布 —— 透明留白只存在于像素里，代码里看不见。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORY_CHEST_ART_METRICS,
    TERRITORY_CHEST_OPEN_FRAMES,
    territoryChestPlacement,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { readPngAlphaBox } from './helpers/png-alpha';

const CHEST_DIR = 'assets/resources/image/territory/chest';
const FRAME_FILES = Array.from({ length: TERRITORY_CHEST_OPEN_FRAMES }, (_, i) => `${CHEST_DIR}/chest_seq_${i}.png`);
/** 地图上静止宝箱用的那张图（`fixedResource` 据点）。 */
const STATIC_CHEST_FILE = 'assets/resources/image/territory/buildings/territory_fixed_resource_v1.png';

const VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryChestView.ts', 'utf8');
const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');

/** 去掉注释后的视图源码（源码守卫统一在它上面跑，免得注释里的字样误判）。 */
function stripped(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ============================================================
// 1. 美术口径 ↔ 真实 PNG
// ============================================================

test('指标表与 chest_seq_0.png 的 alpha 包围盒逐项相等（换图必须重测）', () => {
    const box = readPngAlphaBox(`${CHEST_DIR}/chest_seq_0.png`);
    assert.equal(box.width, TERRITORY_CHEST_ART_METRICS.canvasWidth, '画布宽');
    assert.equal(box.height, TERRITORY_CHEST_ART_METRICS.canvasHeight, '画布高');
    assert.equal(box.left, TERRITORY_CHEST_ART_METRICS.closedLeft, '可见区左边界');
    assert.equal(box.bottom, TERRITORY_CHEST_ART_METRICS.closedBottom, '可见区下边界');
    assert.equal(box.right - box.left, TERRITORY_CHEST_ART_METRICS.closedWidth, '可见区宽');
    assert.equal(box.top - box.bottom, TERRITORY_CHEST_ART_METRICS.closedHeight, '可见区高');
});

test('六帧同画布、同底边：底边不动，只有箱盖向上长（否则换帧时箱体会上下跳）', () => {
    const boxes = FRAME_FILES.map((file) => ({ file, box: readPngAlphaBox(file) }));
    const first = boxes[0].box;
    for (const { file, box } of boxes) {
        assert.equal(box.width, first.width, `${file} 画布宽必须与第 0 帧一致`);
        assert.equal(box.height, first.height, `${file} 画布高必须与第 0 帧一致`);
        assert.equal(box.left, first.left, `${file} 可见区左边界必须与第 0 帧一致`);
        assert.equal(box.right, first.right, `${file} 可见区右边界必须与第 0 帧一致`);
        assert.equal(box.bottom, first.bottom, `${file} 可见区底边必须与第 0 帧一致`);
    }
    // 箱盖确实是「往上长」：末帧可见区比第 0 帧高。
    const last = boxes[boxes.length - 1].box;
    assert.ok(last.top > first.top, '全开帧的可见区上沿必须高于闭合帧');
});

// ============================================================
// 2. 换算：可见宽归一 + 视觉中心补偿
// ============================================================

test('目标可见宽 84 ⇒ 缩放 84/138，横向补偿 0，纵向补偿 21×scale', () => {
    const placement = territoryChestPlacement(
        TERRITORY_CHEST_ART_METRICS,
        TARGET_WIDTH,
        TERRITORY_CHEST_ART_METRICS.canvasWidth,
        TERRITORY_CHEST_ART_METRICS.canvasHeight,
    );
    const scale = TARGET_WIDTH / TERRITORY_CHEST_ART_METRICS.closedWidth;
    assert.ok(Math.abs(placement.scale - scale) < 1e-12, `缩放应为 ${scale}`);
    assert.ok(Math.abs(placement.offsetX) < 1e-12, '闭合态可见区在水平方向本来就居中，横向补偿应为 0');
    // 画布中心 (78) 比闭合箱视觉中心 (2+55=57) 高 21px ⇒ 节点必须往上提 21×scale。
    assert.ok(Math.abs(placement.offsetY - 21 * scale) < 1e-9, `纵向补偿应为 ${21 * scale}，实得 ${placement.offsetY}`);
});

test('补偿把「可见区中心」拉回原点（不是把画布中心拉到原点）', () => {
    const metrics = TERRITORY_CHEST_ART_METRICS;
    const placement = territoryChestPlacement(metrics, TARGET_WIDTH, metrics.canvasWidth, metrics.canvasHeight);
    // 节点中心 = 原点 + 补偿；可见区中心在节点局部里还要再偏 (画布中心 - 视觉中心)×scale。
    const visibleCenterX = placement.offsetX
        + (metrics.closedLeft + metrics.closedWidth / 2 - metrics.canvasWidth / 2) * placement.scale;
    const visibleCenterY = placement.offsetY
        + (metrics.closedBottom + metrics.closedHeight / 2 - metrics.canvasHeight / 2) * placement.scale;
    assert.ok(Math.abs(visibleCenterX) < 1e-9, `可见区中心 x 应落在原点，实得 ${visibleCenterX}`);
    assert.ok(Math.abs(visibleCenterY) < 1e-9, `可见区中心 y 应落在原点，实得 ${visibleCenterY}`);
});

test('归一后的可见尺寸 = 84 × 67，与地图上那只静止宝箱（84 × 66.4）几乎重合', () => {
    const metrics = TERRITORY_CHEST_ART_METRICS;
    const placement = territoryChestPlacement(metrics, TARGET_WIDTH, metrics.canvasWidth, metrics.canvasHeight);
    const animatedWidth = metrics.closedWidth * placement.scale;
    const animatedHeight = metrics.closedHeight * placement.scale;
    assert.ok(Math.abs(animatedWidth - TARGET_WIDTH) < 1e-9, '闭合态可见宽必须等于目标宽');

    const statics = staticChestVisibleSize();
    assert.ok(Math.abs(animatedWidth - statics.width) < 0.01, `宽度要与静止态一致（静止 ${statics.width}）`);
    // 高度由美术本身的宽高比决定，两边美术不同 ⇒ 只要求「差不到 2px」。
    assert.ok(Math.abs(animatedHeight - statics.height) < 2,
        `高度差超过 2px：动画 ${animatedHeight.toFixed(2)} vs 静止 ${statics.height.toFixed(2)}`);
    // 反向护栏：不能再回到「比建筑大一圈」。
    assert.ok(animatedWidth < statics.width * 1.02, '不允许比静止态明显更大（用户只允许「轻微放大」）');
});

test('目标宽非法时退化成 1:1，不产出 NaN / 负数', () => {
    const metrics = TERRITORY_CHEST_ART_METRICS;
    for (const bad of [0, -10, Number.NaN]) {
        const placement = territoryChestPlacement(metrics, bad, metrics.canvasWidth, metrics.canvasHeight);
        assert.equal(placement.scale, 1);
        assert.ok(Number.isFinite(placement.offsetX) && Number.isFinite(placement.offsetY));
    }
});

// ============================================================
// 3. 视图源码守卫
// ============================================================

test('归一走「可见宽」而不是「画布高」：旧的 CHEST_VISIBLE_HEIGHT(132) 不得回流', () => {
    const body = stripped(VIEW_SRC);
    assert.doesNotMatch(body, /CHEST_VISIBLE_HEIGHT/, '「按画布高归一」已被废弃（会把箱子算大 1.4 倍）');
    assert.match(body, /const CHEST_VISIBLE_WIDTH = BUILDING_VISIBLE_WIDTH/, '目标宽必须复用建筑归一宽（唯一真源）');
    assert.match(body, /territoryChestPlacement\(TERRITORY_CHEST_ART_METRICS, CHEST_VISIBLE_WIDTH/, '缩放与补偿必须来自 model');
});

test('位置写入带补偿（横向/纵向、且按当前缩放乘一次）', () => {
    const body = stripped(VIEW_SRC);
    // 必须按 fx.scale 乘补偿：不乘的话弹出/蓄力期间可见区中心会相对原点滑动。
    assert.match(body, /this\.origin\.x \+ this\.chestAnchorX \* fx\.scale/, '横向补偿');
    assert.match(body, /this\.origin\.y \+ this\.chestAnchorY \* fx\.scale/, '纵向补偿');
    // 反向守卫：不能再回到「直接摆在 origin 上」。
    assert.doesNotMatch(body, /this\.chest\.setPosition\(this\.origin\.x, this\.origin\.y/, '宝箱不能直接摆在 origin（会与静止态错位）');
});

test('基准缩放写在 ChestArt、动画缩放写在 Chest（两层不互相覆盖）', () => {
    const body = stripped(VIEW_SRC);
    assert.match(body, /this\.chestArt\.setScale\(placement\.scale, placement\.scale, 1\)/);
    assert.match(body, /this\.chest\.setScale\(fx\.scale, fx\.scale \* fx\.scaleY, 1\)/);
});

test('缺图时补偿归零（旧的锚点不能残留到下一章）', () => {
    const body = stripped(VIEW_SRC);
    const at = body.indexOf('this.chestSprite.enabled = false;');
    assert.ok(at > 0, '缺图分支要禁用 Sprite');
    const tail = body.slice(at, at + 220);
    assert.match(tail, /this\.chestAnchorX = 0/, '缺图分支要清横向补偿');
    assert.match(tail, /this\.chestAnchorY = 0/, '缺图分支要清纵向补偿');
});

// ============================================================
// 辅助：地图上那只静止宝箱的可见尺寸（按站点的归一公式算）
// ============================================================

/** 站点 `Icon` 节点的出厂尺寸（`TerritoryStation.prefab` 的 128×128，`sizeMode = CUSTOM`）。 */
const STATION_ICON_NODE_SIZE = 128;
/** 站点的目标可见宽（`TerritoryStationView.BUILDING_VISIBLE_WIDTH`）。 */
const TARGET_WIDTH = readStationVisibleWidth();

function readStationVisibleWidth(): number {
    const match = STATION_SRC.match(/export const BUILDING_VISIBLE_WIDTH = (\d+(?:\.\d+)?);/)
        ?? STATION_SRC.match(/const BUILDING_VISIBLE_WIDTH = (\d+(?:\.\d+)?);/);
    assert.ok(match, 'TerritoryStationView 要有 BUILDING_VISIBLE_WIDTH 常量');
    const value = Number(match[1]);
    assert.ok(value > 0, 'BUILDING_VISIBLE_WIDTH 必须为正');
    return value;
}

/**
 * 静止宝箱的可见尺寸 —— 复刻 `TerritoryStationView.applyIconPlacement` 的公式：
 *
 * ```
 * canvasScale = 节点尺寸 / 画布尺寸
 * 可见宽 = rect.width × canvasScale
 * k = BUILDING_VISIBLE_WIDTH / 可见宽
 * 最终可见 = 可见尺寸 × k
 * ```
 *
 * `rect` 直接用 alpha 包围盒（这张图是自动裁边导入的，`rect` 就是可见区）。
 */
function staticChestVisibleSize(): { width: number; height: number } {
    const box = readPngAlphaBox(STATIC_CHEST_FILE);
    const visibleWidth = (box.right - box.left) * (STATION_ICON_NODE_SIZE / box.width);
    const visibleHeight = (box.top - box.bottom) * (STATION_ICON_NODE_SIZE / box.height);
    const k = TARGET_WIDTH / visibleWidth;
    return { width: visibleWidth * k, height: visibleHeight * k };
}
