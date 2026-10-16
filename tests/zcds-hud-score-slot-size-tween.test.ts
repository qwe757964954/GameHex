import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

/**
 * ZCGameHudScoreSlot 领先状态切换的尺寸补间 + 变化反馈行为断言（2026-10-13 / 2026-10-14）。
 *
 * 不依赖 cc：用可手动步进的 tween 桩记录补间，验证：
 * · 首次 render 直接落位、不起补间；
 * · leading false→true 放大（backOut / 0.25s），true→false 缩小（quadInOut / 0.2s）；
 * · 动画中途反向从当前尺寸起步，无缝衔接；
 * · 相同状态重复 render 不重起尺寸补间；
 * · onDisable / onDestroy 停掉补间；
 * · **新领先者登场** ⇒ 整格弹跳（scale 1 → 1.2 → 1，两段）；失去领先不弹；
 * · **数字增减、领先状态不变** ⇒ 只有数字（Value 节点）跳，整格（Score 根节点）不动；
 * · 领先格数字加大加粗（32/44 + isBold），失去领先还原 28/39。
 */

type TweenStep =
    | { kind: 'to'; duration: number; props: Record<string, unknown>; opts: { easing?: string; onUpdate?: (t: unknown, ratio: number) => void } }
    | { kind: 'call'; fn: () => void };

interface ITweenRecord {
    target: unknown;
    steps: TweenStep[];
}

function createTweenHarness() {
    const active: ITweenRecord[] = [];
    const tween = (target: unknown) => {
        const record: ITweenRecord = { target, steps: [] };
        const chain = {
            to(duration: number, props: Record<string, unknown>, opts: {
                easing?: string;
                onUpdate?: (t: unknown, ratio: number) => void;
            }) {
                record.steps.push({ kind: 'to', duration, props, opts });
                return chain;
            },
            call(fn: () => void) { record.steps.push({ kind: 'call', fn }); return chain; },
            start() { active.push(record); return chain; },
            stop() {
                const index = active.indexOf(record);
                if (index >= 0) active.splice(index, 1);
                return chain;
            },
        };
        return chain;
    };
    /** 把所有在跑的补间推进到 ratio；ratio>=1 时触发 call，否则保留在 active。 */
    const step = (ratio: number) => {
        const pending = active.splice(0);
        for (const record of pending) {
            for (const item of record.steps) {
                // 弹跳补间走 `props`（scale），没有 onUpdate —— 不能假定每个 to 都带 onUpdate。
                if (item.kind === 'to') item.opts.onUpdate?.(record.target, ratio);
                else if (ratio >= 1) item.fn();
            }
            if (ratio < 1) active.push(record);
        }
    };
    return { tween, active, step };
}

const SLOT_SRC = 'assets/script/app/zcds/view/ZCGameHudScoreSlot.ts';

type THarness = ReturnType<typeof createTweenHarness>;

/** 尺寸补间 = 1 个 to 步 + 1 个 call（2 步）；弹跳 = 2 个 to 步 + 1 个 call（3 步）。 */
function sizeRecords(harness: THarness, node: unknown) {
    return harness.active.filter((record) => record.target === node && record.steps.length === 2);
}
function pulseRecords(harness: THarness, node: unknown) {
    return harness.active.filter((record) => record.target === node && record.steps.length === 3);
}

function createSlot() {
    const harness = createTweenHarness();
    const source = readFileSync(SLOT_SRC, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const loaded = { exports: {} as Record<string, any> };
    class UITransformStub {}
    class Vec3 { constructor(public x = 1, public y = 1, public z = 1) {} }
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        assert.equal(name, 'cc');
        return {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, Label: class {}, Sprite: class {}, UITransform: UITransformStub, Vec3,
            tween: harness.tween,
        };
    }, loaded, loaded.exports);
    const slot = new loaded.exports.ZCGameHudScoreSlot();
    const rect = {
        width: 94, height: 66,
        setContentSize(width: number, height: number) { this.width = width; this.height = height; },
    };
    const node = {
        scale: { x: 1, y: 1, z: 1 },
        setScale(x: number, y?: number, z?: number) { this.scale = { x, y: y ?? x, z: z ?? 1 }; },
        getComponent: (c: unknown) => (c === UITransformStub ? rect : null),
    };
    // 数字节点（Value）独立于 Score 根节点 —— 数字弹跳只动它，不碰整格。
    const valueNode = {
        scale: { x: 1, y: 1, z: 1 },
        setScale(x: number, y?: number, z?: number) { this.scale = { x, y: y ?? x, z: z ?? 1 }; },
    };
    (slot as unknown as { node: unknown }).node = node;
    // 字号 / 行高 / isBold 与 prefab 出厂值一致：首帧（普通格）不该有任何字样写入。
    slot.value = { enabled: true, string: '', fontSize: 28, lineHeight: 39, isBold: false, node: valueNode };
    slot.cross = { enabled: false };
    return { slot, rect, node, valueNode, harness };
}

/** 取出在跑尺寸补间的 to 步骤（带类型收窄）。 */
function firstTo(harness: THarness, node: unknown) {
    const step = sizeRecords(harness, node)[0].steps[0];
    assert.equal(step.kind, 'to');
    return step as Extract<TweenStep, { kind: 'to' }>;
}

test('首次 render 直接落位，不播放尺寸补间（开局不演）', () => {
    const normal = createSlot();
    normal.slot.render({ value: 3, finished: false, leading: false });
    assert.deepEqual([normal.rect.width, normal.rect.height], [94, 66]);
    assert.equal(normal.harness.active.length, 0);

    const leader = createSlot();
    leader.slot.render({ value: 5, finished: false, leading: true });
    assert.deepEqual([leader.rect.width, leader.rect.height], [110, 77]);
    assert.equal(leader.harness.active.length, 0);
});

test('失败方变领先：放大补间 0.25s / backOut + 整格弹跳，逐帧插值到 110×77', () => {
    const { slot, rect, node, valueNode, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    slot.render({ value: 5, finished: false, leading: true });
    assert.equal(sizeRecords(harness, node).length, 1);
    assert.equal(pulseRecords(harness, node).length, 1, '新领先者登场要整格弹');
    assert.equal(pulseRecords(harness, valueNode).length, 0, '大小切换时数字不单独跳（整格带着动）');
    const to = firstTo(harness, node);
    assert.equal(to.duration, 0.25);
    assert.equal(to.opts.easing, 'backOut');
    harness.step(0);
    assert.deepEqual([rect.width, rect.height], [94, 66]);
    harness.step(0.5);
    assert.deepEqual([rect.width, rect.height], [102, 71.5]);
    harness.step(1);
    assert.deepEqual([rect.width, rect.height], [110, 77]);
    // call 落位后补间清空。
    assert.equal(harness.active.length, 0);
});

test('领先方变失败：缩小补间 0.2s / quadInOut，缩回那格不弹跳', () => {
    const { slot, rect, node, valueNode, harness } = createSlot();
    slot.render({ value: 5, finished: false, leading: true });
    slot.render({ value: 2, finished: false, leading: false });
    const to = firstTo(harness, node);
    assert.equal(to.duration, 0.2);
    assert.equal(to.opts.easing, 'quadInOut');
    assert.equal(pulseRecords(harness, node).length, 0, '失去领先不弹');
    assert.equal(pulseRecords(harness, valueNode).length, 0, '大小切换时数字也不单独跳');
    harness.step(0.5);
    assert.deepEqual([rect.width, rect.height], [102, 71.5]);
    harness.step(1);
    assert.deepEqual([rect.width, rect.height], [94, 66]);
    assert.equal(harness.active.length, 0);
});

test('数字增减、领先状态不变：只有数字跳，方块不动', () => {
    const { slot, node, valueNode, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    slot.render({ value: 4, finished: false, leading: false });
    assert.equal(pulseRecords(harness, valueNode).length, 1, '数字变了 → 数字跳');
    assert.equal(pulseRecords(harness, node).length, 0, '方块大小没切换 → 整格不跳');
    assert.equal(sizeRecords(harness, node).length, 0);
});

test('数字弹跳：Value 节点 scale 1 → 1.2 → 1，先 sineOut 后 backOut', () => {
    const { slot, valueNode, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    assert.equal(harness.active.length, 0, '首帧不弹');
    slot.render({ value: 4, finished: false, leading: false });
    const pulses = pulseRecords(harness, valueNode);
    assert.equal(pulses.length, 1);
    const [up, down] = pulses[0].steps as [
        Extract<TweenStep, { kind: 'to' }>,
        Extract<TweenStep, { kind: 'to' }>,
    ];
    // scale 目标是模块里的 Vec3 实例（另一个 realm 的类），逐字段比对。
    assert.deepEqual([up.props.scale.x, up.props.scale.y, up.props.scale.z], [1.2, 1.2, 1]);
    assert.deepEqual([down.props.scale.x, down.props.scale.y, down.props.scale.z], [1, 1, 1]);
    assert.deepEqual([up.duration, down.duration], [0.1, 0.18]);
    assert.deepEqual([up.opts.easing, down.opts.easing], ['sineOut', 'backOut']);
    harness.step(1);
    assert.equal(harness.active.length, 0, '弹完清空');
});

test('数字没变不弹；结束态（finished）不弹', () => {
    const { slot, valueNode, harness } = createSlot();
    slot.render({ value: 8, finished: false, leading: false });
    slot.render({ value: 9, finished: false, leading: false });
    assert.equal(pulseRecords(harness, valueNode).length, 1);
    harness.step(1);
    slot.render({ value: 9, finished: false, leading: false });
    assert.equal(pulseRecords(harness, valueNode).length, 0, '数字没变不弹');
    slot.render({ value: 0, finished: true, leading: false });
    assert.equal(pulseRecords(harness, valueNode).length, 0, '结束态显示红 X，数字不弹');
});

test('领先格数字加大加粗，失去领先还原；数值不变不重复写字样', () => {
    const { slot, harness } = createSlot();
    const value = slot.value as { fontSize: number; lineHeight: number; isBold: boolean };
    slot.render({ value: 3, finished: false, leading: false });
    assert.deepEqual([value.fontSize, value.lineHeight, value.isBold], [28, 39, false], '普通格保持出厂字样');
    slot.render({ value: 3, finished: false, leading: true });
    assert.deepEqual([value.fontSize, value.lineHeight, value.isBold], [32, 44, true], '领先格加大加粗');
    slot.render({ value: 3, finished: false, leading: true });
    assert.deepEqual([value.fontSize, value.lineHeight, value.isBold], [32, 44, true], '状态不变不重写');
    harness.step(1);
    slot.render({ value: 2, finished: false, leading: false });
    assert.deepEqual([value.fontSize, value.lineHeight, value.isBold], [28, 39, false], '失去领先还原');
});

test('动画中途领先状态翻转：从当前尺寸反向起步，不跳变', () => {
    const { slot, rect, node, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    slot.render({ value: 9, finished: false, leading: true });
    harness.step(0.5);
    assert.deepEqual([rect.width, rect.height], [102, 71.5]);
    slot.render({ value: 2, finished: false, leading: false });
    // 旧尺寸补间被 stop 移除；中途那记整格弹跳还在跑（对运行无害，自然播完）。
    assert.equal(sizeRecords(harness, node).length, 1);
    harness.step(0);
    assert.deepEqual([rect.width, rect.height], [102, 71.5], '新补间起点是当前尺寸，不跳回 94');
    harness.step(1);
    assert.deepEqual([rect.width, rect.height], [94, 66]);
});

test('onDisable 停掉补间并归位缩放；重新激活后同状态 render 直接落位', () => {
    const { slot, rect, node, valueNode, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    slot.render({ value: 9, finished: false, leading: true });
    harness.step(0.5);
    slot.onDisable();
    harness.step(1);
    assert.deepEqual([rect.width, rect.height], [102, 71.5]);
    assert.equal(harness.active.length, 0, '尺寸补间与整格弹跳都要停');
    assert.deepEqual([node.scale.x, node.scale.y], [1, 1], '半路的整格弹跳要归位');
    assert.deepEqual([valueNode.scale.x, valueNode.scale.y], [1, 1], '半路的数字弹跳要归位');
    slot.render({ value: 9, finished: false, leading: true });
    assert.deepEqual([rect.width, rect.height], [110, 77]);
});

test('onDestroy 停掉补间', () => {
    const { slot, harness } = createSlot();
    slot.render({ value: 3, finished: false, leading: false });
    slot.render({ value: 9, finished: false, leading: true });
    assert.equal(harness.active.length, 2);
    slot.onDestroy();
    assert.equal(harness.active.length, 0);
});
