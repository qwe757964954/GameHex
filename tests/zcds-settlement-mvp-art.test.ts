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
import {
    GAME_END_PREFAB_SIZE_LIMIT,
    parseGameEndPrefabSize,
} from '../assets/script/app/zcds/model/ZCPvpTableParser';

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

// ============================================================
// 结算体型上限（`pvpCard.gameEndPrefabSize`）
// ============================================================

/**
 * 立绘位显示高 = 宿主 265 × 1.09 × 系数 = 288.85 × 系数。
 * 1.8 时代是 520px（框只有 265，约 2 倍），收到 1.2 之后是 347px。
 */
const MVP_SLOT_HEIGHT = 265;
const MVP_ART_HEIGHT_RATIO = 1.09;
const slotHeight = (size: number): number => MVP_SLOT_HEIGHT * MVP_ART_HEIGHT_RATIO * size;

test('gameEndPrefabSize：按卡表的上限收敛，留空退回兜底 1.2，0/负数当场抛', () => {
    assert.equal(GAME_END_PREFAB_SIZE_LIMIT, 1.2, '兜底上限就是需求里给的那个 1.2');
    // 超上限的卡被压到上限（磁电菇 1.8 / 雷蕉 1.5）
    assert.equal(parseGameEndPrefabSize(1.2, 1.8, 't'), 1.2);
    assert.equal(parseGameEndPrefabSize(1.2, 1.5, 't'), 1.2);
    // 本来就小的不动（豌豆游侠 0.8 / 水手菇 1）
    assert.equal(parseGameEndPrefabSize(1.2, 0.8, 't'), 0.8);
    assert.equal(parseGameEndPrefabSize(1.2, 1, 't'), 1);
    // 表里留空（老快照 / 还没补列）⇒ 仍然吃兜底上限，不许悄悄退回 prefabSize
    assert.equal(parseGameEndPrefabSize(undefined, 1.8, 't'), 1.2);
    assert.equal(parseGameEndPrefabSize('', 1.8, 't'), 1.2);
    assert.equal(parseGameEndPrefabSize(null, 1.8, 't'), 1.2);
    // 配错了要当场炸，别让模型 scale=0 凭空消失
    assert.throws(() => parseGameEndPrefabSize(0, 1, 't'));
    assert.throws(() => parseGameEndPrefabSize(-1, 1, 't'));
});

test('真表：兵种卡都带上限，最坏情况从 520px 收到 347px', () => {
    const rows = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as Array<Record<string, any>>;
    const units = rows.filter((row) => row.prefabSize !== undefined);
    assert.equal(units.length, 35, '兵种卡应当是 35 张（主城 / 金矿不带模型大小）');
    for (const row of units) {
        const size = parseGameEndPrefabSize(row.gameEndPrefabSize, Number(row.prefabSize), `pvpCard[${row.id}]`);
        assert.ok(size <= GAME_END_PREFAB_SIZE_LIMIT + 1e-9,
            `${String(row.name)} 的结算体型 ${size} 超过上限 ${GAME_END_PREFAB_SIZE_LIMIT}`);
        assert.equal(size, Math.min(Number(row.prefabSize), GAME_END_PREFAB_SIZE_LIMIT),
            `${String(row.name)} 的结算体型不是 min(prefabSize, 上限)`);
    }

    // 就是这一张把结算页画爆的：prefabSize 1.8 是给战场（按 canvas 归一）补的系数，
    // 结算按美术包围盒归一，搬过去就是纯放大 1.8 倍。
    const magdi = units.find((row) => row.id === 68016);
    assert.ok(magdi, '真表里找不到 68016 磁电菇');
    assert.equal(Number(magdi!.prefabSize), 1.8, '战场口径的体型系数保持 1.8 不变（否则战场又变小）');
    const capped = parseGameEndPrefabSize(magdi!.gameEndPrefabSize, 1.8, 'pvpCard[68016]');
    assert.equal(capped, 1.2);
    assert.ok(slotHeight(1.8) > MVP_SLOT_HEIGHT * 1.9, '不收敛的话是 520px，接近框高的 2 倍');
    assert.ok(slotHeight(capped) < MVP_SLOT_HEIGHT * 1.35, '收敛后 347px，仍在设计稿允许的溢出范围内');
});

test('装配：解析层给最终值、定义层带着它、结算只读 gameEndPrefabSize', () => {
    const parser = readFileSync('assets/script/app/zcds/model/ZCPvpTableParser.ts', 'utf8');
    assert.match(parser, /export function parseGameEndPrefabSize\(/);
    assert.match(parser, /gameEndPrefabSize: parseGameEndPrefabSize\(/,
        'parseUnits 必须给兵种定义算好 gameEndPrefabSize');

    const catalog = readFileSync('assets/script/app/zcds/model/ZCCombatCatalog.ts', 'utf8');
    assert.match(catalog, /gameEndPrefabSize: number;/, 'ZCUnitDefinition 必须带上这个字段');

    const controller = readFileSync('assets/script/app/zcds/application/ZCBattleRuntimeController.ts', 'utf8');
    assert.match(controller, /prefabSize: definition\.gameEndPrefabSize,/,
        '结算 MVP 必须取 gameEndPrefabSize —— 取 prefabSize 就是「糊屏」那个 bug');
    assert.doesNotMatch(controller, /prefabSize: definition\.prefabSize,/,
        '出现这一行说明结算又回去吃战场系数了');
});
