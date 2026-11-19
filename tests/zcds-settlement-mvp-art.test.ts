/**
 * 结算 MVP 立绘尺寸口径：
 *  - 骨架 canvas 可能远大于角色实际美术（磁电菇 canvas 高 1798），setup pose 还会把
 *    `sg*` 闪光件算进包围盒（1772）；必须按 idle 首帧的可见附件归一（实测 772×980）。
 *  - 骨架原点不一定在脚底（影子/裙摆可能压到 0 以下），只把原点贴到宿主底边会让角色悬空或下沉。
 *
 * 这里用假骨架验证纯函数 `measureSpineArtBounds`，再用源码守卫确认 `ZCSettlementMvpActor`
 * 真的摆到 idle 首帧、把包围盒高度与 minY 用在缩放/脚点计算里。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { measureSpineArtBounds, type ISpineArtSkeleton } from '../assets/script/app/zcds/view/ZCSpineArtBounds';

function regionAttachment(width: number, height: number, vertices: readonly number[]) {
    return {
        width, height,
        computeWorldVertices(_bone: unknown, out: Float32Array, offset: number, stride: number): void {
            vertices.forEach((value, index) => {
                out[offset + Math.floor(index / 2) * stride + (index % 2)] = value;
            });
        },
    };
}

function meshAttachment(length: number, vertices: readonly number[]) {
    return {
        worldVerticesLength: length,
        computeWorldVertices(_slot: unknown, _start: number, _count: number, out: Float32Array, offset: number, stride: number): void {
            vertices.forEach((value, index) => {
                out[offset + Math.floor(index / 2) * stride + (index % 2)] = value;
            });
        },
    };
}

function skeletonOf(...attachments: ReturnType<typeof regionAttachment>[]): ISpineArtSkeleton {
    return {
        slots: attachments.map(attachment => ({
            bone: {},
            getAttachment: () => attachment,
        })),
    };
}

test('measureSpineArtBounds：区域附件按四角算高度与脚点', () => {
    // 角色 900 高、脚底在 -30（影子压到原点下方），canvas 另有 800+ 空白。
    const bounds = measureSpineArtBounds(skeletonOf(
        regionAttachment(200, 900, [-100, 870, 100, 870, 100, -30, -100, -30]),
    ));
    assert.ok(bounds);
    assert.equal(bounds.height, 900);
    assert.equal(bounds.minY, -30);
    assert.equal(bounds.maxY, 870);
});

test('measureSpineArtBounds：mesh 附件同样参与包围盒，忽略空槽', () => {
    const bounds = measureSpineArtBounds({
        slots: [
            { getAttachment: () => null },
            {
                bone: {},
                getAttachment: () => meshAttachment(8, [-50, 100, 50, 100, 50, -200, -50, -200]),
            },
        ],
    });
    assert.ok(bounds);
    assert.equal(bounds.height, 300);
    assert.equal(bounds.minY, -200);
});

test('measureSpineArtBounds：idle 藏掉的全透明槽、裁剪/路径附件不参与', () => {
    const bounds = measureSpineArtBounds({
        slots: [
            // 闪光件：几何很大，但 idle 首帧 alpha=0 ⇒ 不占画面。
            {
                bone: {},
                color: { a: 0 },
                getAttachment: () => regionAttachment(1800, 1800, [-900, 900, 900, 900, 900, -900, -900, -900]),
            },
            // 裁剪形状不是可见美术。
            {
                bone: {},
                getAttachment: () => ({ endSlot: {}, computeWorldVertices: () => undefined }),
            },
            // 角色本体。
            {
                bone: {},
                getAttachment: () => regionAttachment(200, 900, [-100, 870, 100, 870, 100, -30, -100, -30]),
            },
        ],
    });
    assert.ok(bounds);
    assert.equal(bounds.height, 900);
    assert.equal(bounds.minY, -30);
});

test('measureSpineArtBounds：没有可用附件时返回 null（调用方退画布口径）', () => {
    assert.equal(measureSpineArtBounds({ slots: [{ getAttachment: () => null }] }), null);
    assert.equal(measureSpineArtBounds(skeletonOf(regionAttachment(0, 0, []))), null);
});

test('ZCSettlementMvpActor：摆到 idle 首帧按包围盒归一 + 用 minY 校正脚点', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCSettlementMvpActor.ts', 'utf8');
    assert.match(source, /measureSpineArtBounds\(/, '必须调用包围盒测量');
    assert.match(source, /instance\.setAnimation\(0, UNIT_IDLE_ANIMATION, true\)/, '必须摆到 idle 首帧再量');
    assert.match(source, /instance\.updateAnimation\(0\)/, '必须应用 idle 第 0 帧');
    assert.match(source, /MVP_ART_HEIGHT_RATIO/, '设计稿立绘略高于宿主（265 宿 vs 288 实际）');
    assert.match(source, /this\.artMinY/, '脚点必须按包围盒 minY 校正');
    assert.match(source, /footY - this\.artMinY/, '脚点公式：宿主底边 − minY × 缩放');
    assert.doesNotMatch(source, /sourceHeight = runtime\.height;/, '不能再拿 canvas 高当角色高');
});
