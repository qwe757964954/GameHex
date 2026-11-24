/**
 * 宝箱格**计时区排版基准**回归网（2026-11-23 用户）。
 *
 * 用户原话：*「当出现时间进度条时，时钟 icon 移动到进度条的左侧，进度上展示具体的时间倒计时」*，
 * 附的截图里：时钟压在深色进度条**中间**，进度条上**一个字都没有**。
 *
 * 真因不是 prefab（`ChestSlot.prefab` 的几何是对的，`tests/chest-bar.test.ts` C7b 一直绿），
 * 而是**抓基准的时机**：`ChestBar` 在 `ArenaRoot.prefab` 上 `active=false`，宿主
 * `MainPage.start()` 会先 `renderChests(空槽)` 走一遍 `ChestSlotView.render()` ——
 * 那一帧槽位还没激活、`onLoad` 没跑，基准全是 0；而这一帧又把
 *  · 时钟 / 文字摆到 `x = 0`（压在进度条中间），
 *  · 文本 `UITransform` 改成 `0×0`（`Label` SHRINK 到零宽 ⇒ 一个字都画不出来）。
 * 等 `onLoad` 真正执行时读到的已经是**被自己改坏的值** ⇒ `clockBaseX = 0` 永久生效，
 * 每秒重绘也救不回来。
 *
 * 这里在 VM 沙箱里**故意只调 `render()`、不调 `onLoad()`**（= 主城 start 那一帧），
 * 断言时钟仍在 prefab 原位、文本仍是 99×24、倒计时文案已写上。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as chestTypes from '../assets/script/app/main/ChestTypes';
import { CHEST_EVENTS } from '../assets/script/app/main/ChestEvents';

const SLOT_VIEW = 'assets/script/app/main/ChestSlotView.ts';

// ============================================================
// 一、VM 沙箱：把一个 `cc.Component` 子类装起来
// ============================================================

interface IFakeNode {
    position: { x: number; y: number };
    active: boolean;
    on: () => void;
    setPosition: (x: number, y: number, z?: number) => void;
    getComponent: (type: unknown) => unknown;
}

function fakeNode(x = 0, y = 0): IFakeNode {
    return {
        position: { x, y },
        active: true,
        on: () => undefined,
        setPosition(nx: number, ny: number) { this.position.x = nx; this.position.y = ny; },
        getComponent: () => null,
    };
}

function fakeTransform(width: number, height: number) {
    return {
        width,
        height,
        setContentSize(nextWidth: number, nextHeight: number) {
            this.width = nextWidth;
            this.height = nextHeight;
        },
    };
}

/** 一颗带 `node` 的渲染组件桩（Sprite / Label 共形）。 */
function fakeVisual(node = fakeNode()) {
    return { node, string: '', spriteFrame: null as unknown, fillRange: 0, isBold: false, spacingX: 0, fontSize: 28 };
}

interface IView {
    node: IFakeNode;
    card: ReturnType<typeof fakeVisual>;
    timer: IFakeNode;
    timeBg: IFakeNode;
    clock: IFakeNode;
    timeFill: ReturnType<typeof fakeVisual>;
    timeText: ReturnType<typeof fakeVisual> & { overflow: number; updateRenderData: () => void };
    timeTextTransform: ReturnType<typeof fakeTransform>;
    box: ReturnType<typeof fakeVisual>;
    nameLabel: ReturnType<typeof fakeVisual>;
    emptyLabel: ReturnType<typeof fakeVisual>;
    cost: IFakeNode;
    costLabel: ReturnType<typeof fakeVisual>;
    btn: ReturnType<typeof fakeVisual>;
    btnLabel: ReturnType<typeof fakeVisual>;
    speedUpIcon: IFakeNode;
    render: (data: chestTypes.IChestSlotData, showBattleEntry?: boolean, dataIndex?: number) => void;
    onLoad: () => void;
}

function loadChestSlotView(): new () => IView {
    const module = { exports: {} as Record<string, unknown> };
    const code = ts.transpileModule(readFileSync(SLOT_VIEW, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, {
        exports: module.exports,
        console,
        require: (name: string) => {
            if (name === 'cc') {
                return {
                    _decorator: { ccclass: () => (target: unknown) => target, property: () => () => undefined },
                    Component: class { node = fakeNode(); },
                    Node: class {},
                    Button: class { static EventType = { CLICK: 'click' }; },
                    Label: class { static Overflow = { NONE: 0, SHRINK: 2 }; },
                    Sprite: class { static SizeMode = { CUSTOM: 0, TRIMMED: 1 }; },
                    UITransform: class {},
                };
            }
            if (name === '../../framework/event/EventMgr') {
                return { EventMgr: { instance: { emit: () => undefined } } };
            }
            if (name === './ChestEvents') return { CHEST_EVENTS };
            if (name === './ChestTypes') return chestTypes;
            throw new Error(`未桩化的依赖：${name}`);
        },
    });
    return (module.exports as { ChestSlotView: new () => IView }).ChestSlotView;
}

/**
 * 装一颗「prefab 初始态」的格子：时钟在 `x=-62.5`、文本 99×24 在 `x=15`
 * （与 `ChestSlot.prefab` 一致，C7b 另有一组关系断言）。
 */
function createSlot() {
    const View = loadChestSlotView();
    const slot = new View();
    slot.node = fakeNode();
    slot.card = fakeVisual();
    slot.timer = fakeNode();
    slot.timeBg = fakeNode();
    slot.clock = fakeNode(-62.5, 0);
    slot.clock.getComponent = () => fakeTransform(26, 32);
    slot.timeFill = fakeVisual();
    slot.timeText = Object.assign(fakeVisual(fakeNode(15, 0)), {
        overflow: 0,
        updateRenderData: () => undefined,
    });
    slot.timeTextTransform = Object.assign(fakeTransform(99, 24), {});
    slot.box = fakeVisual();
    slot.nameLabel = fakeVisual();
    slot.emptyLabel = fakeVisual();
    slot.cost = fakeNode();
    slot.costLabel = fakeVisual();
    slot.btn = fakeVisual();
    slot.btnLabel = fakeVisual();
    slot.btnLabel.node.getComponent = () => fakeTransform(94, 34);
    slot.speedUpIcon = fakeNode(-43, 0);
    slot.speedUpIcon.getComponent = () => fakeTransform(28, 29);
    return slot;
}

const counting = (remainSeconds = 100): chestTypes.IChestSlotData => ({
    index: 1,
    state: chestTypes.ChestSlotState.Counting,
    name: '铁角补给箱',
    remainSeconds,
    totalSeconds: 300,
    action: chestTypes.ChestSlotAction.SpeedUp,
    canActivate: false,
    cost: 0,
});

const waiting = (): chestTypes.IChestSlotData => ({
    index: 2,
    state: chestTypes.ChestSlotState.Ready,
    name: '铁角配给箱',
    remainSeconds: 300,
    totalSeconds: 300,
    action: chestTypes.ChestSlotAction.Activate,
    canActivate: true,
    cost: 0,
});

// ============================================================
// 二、行为：`render()` 早于 `onLoad()` 也必须按 prefab 排版
// ============================================================

test('C7c 主城 start 那一帧（只有 render、没有 onLoad）就要按 prefab 排版', () => {
    const slot = createSlot();
    slot.render(counting(), true, 0);

    assert.equal(slot.clock.position.x, -62.5,
        '时钟必须回到 prefab 的 -62.5（进度条左侧）；退化成 0 就是压在进度条中间');
    assert.equal(slot.timeText.node.position.x, 15, '倒计时文字要落在进度条中心');
    assert.equal(slot.timeTextTransform.width, 99,
        '文本 UITransform 被写成 0 宽 ⇒ Label SHRINK 到零宽，进度条上一个字都没有');
    assert.equal(slot.timeTextTransform.height, 24);
    assert.equal(slot.timeText.string, '00:01:40', '进度条上要展示具体倒计时');
    assert.equal(slot.timeBg.active, true, '倒计时态才显示进度条');
    assert.ok(slot.timeFill.fillRange > 0.6 && slot.timeFill.fillRange < 0.7,
        `进度 = 1 - 100/300 ≈ 0.667，实测 ${slot.timeFill.fillRange}`);
});

test('C7c 基准只抓一次：连续重绘（含等待态来回切）不许把基准读成被改过的值', () => {
    const slot = createSlot();
    slot.render(counting(), true, 0);
    // 等待态会把时钟 / 文字挪到「整组居中」，随后再切回倒计时态。
    slot.render(waiting(), true, 1);
    assert.ok(slot.clock.position.x > -62.5, '等待态是「时钟 + 时长」整组居中，不该还在最左');
    slot.render(counting(30), true, 0);

    assert.equal(slot.clock.position.x, -62.5, '切回倒计时态必须回到 prefab 基准');
    assert.equal(slot.timeText.node.position.x, 15);
    assert.equal(slot.timeTextTransform.width, 99, '等待态改过的文本宽度不许污染倒计时态');
    assert.equal(slot.timeText.string, '00:00:30');
});

test('C7c 先 onLoad 再 render（已激活后才拿到数据）同样是 prefab 基准', () => {
    const slot = createSlot();
    slot.onLoad();
    slot.render(counting(), true, 0);
    assert.equal(slot.clock.position.x, -62.5);
    assert.equal(slot.timeTextTransform.width, 99);
});

// ============================================================
// 三、源码守卫：抓基准必须在第一次 `setPosition` 之前
// ============================================================

test('C7c 守卫：`render` 第一行就抓基准，且抓取有一次性闩、不覆盖已抓值', () => {
    const source = readFileSync(SLOT_VIEW, 'utf8');
    const renderAt = source.indexOf('render(data: IChestSlotData');
    assert.ok(renderAt > 0, '找不到 render 方法');
    const nextMethod = source.indexOf('\n    private ', renderAt);
    const head = source.slice(renderAt, nextMethod > renderAt ? nextMethod : renderAt + 3000);
    assert.match(head, /this\.captureLayoutBaseline\(\);/,
        'render 调用了布局写入却没先抓基准 —— 主城 start 那一帧会把 prefab 基准改成 0');
    const captureCall = head.indexOf('this.captureLayoutBaseline();');
    const firstWrite = head.search(/\.setPosition\(|\.setContentSize\(/);
    assert.ok(firstWrite > captureCall,
        `抓基准必须排在第一次 setPosition / setContentSize 之前，否则抓到的是被自己改坏的值`
        + `（capture=${captureCall} / firstWrite=${firstWrite}）`);

    assert.match(source, /private layoutCaptured = false;/);
    assert.match(source, /private captureLayoutBaseline\(\): void \{\s*if \(this\.layoutCaptured\) return;/,
        '抓取必须一次性：每次 render 重抓会把当前（可能已被改动的）位置当成基准');
    assert.match(source, /onLoad\(\): void \{\s*this\.captureLayoutBaseline\(\);/,
        'onLoad 也要抓一次（render 还没跑过的宿主）');
});
