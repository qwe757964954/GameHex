import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as chestTypes from '../assets/script/app/main/ChestTypes';
import type { ChestSlotView } from '../assets/script/app/main/ChestSlotView';
import type { ChestBar } from '../assets/script/app/main/ChestBar';
import type { NewTreasureRepository } from '../assets/script/app/main/NewTreasureRepository';
import * as requestGuard from '../assets/script/app/net/RequestGuard';

interface ITreasureInfo {
    cardBoxID: number;
    openTime: number;
    index: number;
}

// 仓库经 FW/GameNet 引入引擎；只替换 I/O 边界，执行真实仓库的加载和状态推导。
async function loadTreasure(infos: readonly ITreasureInfo[], nowSeconds: number) {
    let nowMs = nowSeconds * 1000;
    let latestInfos = infos;
    let onBroadcast: ((message: unknown) => void) | null = null;
    class RequestStub {
        constructor(
            readonly cmdReqMsg: unknown,
            readonly caller?: unknown,
            readonly fCallback?: (rsp: { infos: readonly ITreasureInfo[] }) => void,
        ) {}
    }
    const exports: { NewTreasureRepository?: new () => NewTreasureRepository } = {};
    const source = readFileSync('assets/script/app/main/NewTreasureRepository.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    runInNewContext(code, { exports, console, Date: { now: () => nowMs }, require: (name: string) => {
        if (name === './ChestTypes') return chestTypes;
        if (name === '../net/RequestGuard') return requestGuard;
        if (name === '../../framework/FW') return { FW: {} };
        if (name === '../../framework/net/RequestMsg') return { RequestMsg: RequestStub };
        if (name === '../../framework/ref/RefUtil') return { RefUtil: { instance: {
            getRefAllAsync: async (table: string) => {
                if (table === 'item') return [];
                assert.equal(table, 'newTreasureBoxConfig');
                return [
                    { cardBoxID: 19001, cardBoxOpenTime: 10 },
                    { cardBoxID: 19002, cardBoxOpenTime: 30 },
                ];
            },
        } } };
        if (name === '../net/GameNet') return { GameNet: { instance: {
            isConnected: true,
            addEvent(_name: string, _caller: unknown, listener: (message: unknown) => void) { onBroadcast = listener; },
            removeCallerEvent() { onBroadcast = null; },
            send: async (request: RequestStub) => {
                request.fCallback?.({ infos: latestInfos });
                return true;
            },
        } } };
        throw new Error(`Unexpected import: ${name}`);
    } });
    assert.ok(exports.NewTreasureRepository);
    const repository = new exports.NewTreasureRepository();
    assert.equal(await repository.load({}, () => {}), 'ok');
    return {
        repository,
        setNow: (seconds: number) => { nowMs = seconds * 1000; },
        setInfos: (value: readonly ITreasureInfo[]) => { latestInfos = value; },
        broadcastInfo: (info: ITreasureInfo) => { onBroadcast?.({ info }); },
    };
}

function createChestSlotView() {
    const exports: { ChestSlotView?: typeof ChestSlotView } = {};
    const source = readFileSync('assets/script/app/main/ChestSlotView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    class ComponentStub {}
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return {
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
            Button: { EventType: { CLICK: 'click' } },
            Label: { Overflow: { NONE: 0, SHRINK: 2 } },
            Component: ComponentStub,
        };
        if (name === './ChestTypes') return chestTypes;
        throw new Error(`Unexpected import: ${name}`);
    } });
    assert.ok(exports.ChestSlotView);
    const view = new exports.ChestSlotView() as ChestSlotView & Record<string, unknown>;
    const blue = { name: 'blue' };
    const gold = { name: 'gold' };
    const timerNode = () => ({ active: false, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 },
        setPosition(x: number, y: number) { this.position = { x, y }; },
        setScale(x: number, y: number) { this.scale = { x, y }; },
    });
    const timeTextTransform = { width: 74, setContentSize(width: number, _height: number) { this.width = width; } };
    const timeText = { string: '', overflow: 0, node: timerNode(), updateRenderData() {
        timeTextTransform.width = this.string.length * 9;
    } };
    Object.assign(view, {
        card: { spriteFrame: null },
        timer: { active: false },
        timeBg: timerNode(),
        clock: timerNode(),
        timeTextTransform,
        timeFill: { fillRange: 0 },
        timeText,
        box: { node: { active: false } },
        nameLabel: { node: { active: false }, string: '' },
        emptyLabel: { node: { active: false } },
        cost: { active: false },
        costLabel: { string: '' },
        btn: { spriteFrame: null, node: { active: true } },
        btnLabel: { string: '', isBold: false, spacingX: 0, node: { setPosition() {} } },
        speedUpIcon: { active: false },
    });
    exports.ChestSlotView.setArt(
        { blue, gold, empty: { name: 'empty' } } as never,
        { gold: { name: 'gold-button' }, blue: { name: 'blue-button' }, green: { name: 'green-button' } } as never,
    );
    return view;
}

function createChestBar(views: ChestSlotView[]): ChestBar {
    const exports: { ChestBar?: new () => ChestBar } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/ChestBar.ts', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return {
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
            Component: class {},
        };
        if (name === './ChestSlotView') return { ChestSlotView: views[0].constructor };
        if (name === './ChestTypes') return chestTypes;
        if (name === './MainHudMotion') return {};
        throw new Error(`Unexpected import: ${name}`);
    } });
    assert.ok(exports.ChestBar);
    const bar = new exports.ChestBar();
    Object.assign(bar, { list: { getComponentsInChildren: () => [...views].reverse() } });
    return bar;
}

test('openTime 为零的宝箱必须先激活，即使当前时间已远超配置等待秒数', async () => {
    const { repository } = await loadTreasure([{ cardBoxID: 19001, openTime: 0, index: 2 }], 1792495000);
    const slot = repository.slots[1];
    assert.equal(slot.action, chestTypes.ChestSlotAction.Activate);
    assert.equal(slot.state, chestTypes.ChestSlotState.Ready);
    assert.equal(slot.remainSeconds, 10);
    assert.equal(slot.totalSeconds, 10);
});

for (const { cardBoxID, duration } of [{ cardBoxID: 19001, duration: 10 }, { cardBoxID: 19002, duration: 30 }]) {
    test(`${cardBoxID} 按秒计时，到期前一秒可加速，到期当秒可开启`, async () => {
        const { repository, setNow } = await loadTreasure([
            { cardBoxID, openTime: 1792494968, index: 1 },
        ], 1792494968 + duration - 1);
        assert.equal(repository.slots[0].state, chestTypes.ChestSlotState.Counting);
        assert.equal(repository.slots[0].action, chestTypes.ChestSlotAction.SpeedUp);
        assert.equal(repository.slots[0].remainSeconds, 1);
        assert.equal(repository.slots[0].totalSeconds, duration);
        setNow(1792494968 + duration);
        assert.equal(repository.slots[0].state, chestTypes.ChestSlotState.Ready);
        assert.equal(repository.slots[0].action, chestTypes.ChestSlotAction.Open);
        assert.equal(repository.slots[0].remainSeconds, 0);
    });
}

test('三条服务端记录按槽位独立推导：已到期、未激活、未激活、空槽', async () => {
    const { repository } = await loadTreasure([
        { cardBoxID: 19002, openTime: 1792494968, index: 1 },
        { cardBoxID: 19001, openTime: 0, index: 2 },
        { cardBoxID: 19002, openTime: 0, index: 3 },
    ], 1792495000);
    assert.deepEqual(Array.from(repository.slots, (slot) => slot.action), [
        chestTypes.ChestSlotAction.Open, chestTypes.ChestSlotAction.Activate,
        chestTypes.ChestSlotAction.Activate, chestTypes.ChestSlotAction.Battle,
    ]);
    assert.equal(repository.slots[0].remainSeconds, 0);
    assert.equal(repository.slots[1].remainSeconds, 10);
    assert.equal(repository.slots[2].remainSeconds, 30);
    assert.equal(repository.slots[3].state, chestTypes.ChestSlotState.Empty);
});

test('倒计时采用紧凑英文 h m s 格式并省略零单位', () => {
    const view = createChestSlotView();
    const formatter = view.constructor as { formatRemain(seconds: number): string };
    assert.equal(formatter.formatRemain(10), '10s');
    assert.equal(formatter.formatRemain(60), '1m');
    assert.equal(formatter.formatRemain(90), '1m 30s');
    assert.equal(formatter.formatRemain(3661), '1h 1m 1s');
    assert.equal(formatter.formatRemain(86400), '24h');
    assert.equal(formatter.formatRemain(0), '0s');
});

test('再次加载读取最新宝箱列表，增减广播都会通知数量变化', async () => {
    const h = await loadTreasure([{ index: 2, cardBoxID: 19001, openTime: 0 }], 1792495000);
    h.setInfos([
        { index: 1, cardBoxID: 19002, openTime: 0 },
        { index: 2, cardBoxID: 19001, openTime: 0 },
        { index: 4, cardBoxID: 19002, openTime: 0 },
    ]);
    const counts: number[] = [];
    assert.equal(await h.repository.load({}, (slots) => {
        counts.push(slots.filter((slot) => slot.state !== chestTypes.ChestSlotState.Empty).length);
    }), 'ok');
    h.broadcastInfo({ index: 2, cardBoxID: 0, openTime: 0 });
    h.broadcastInfo({ index: 3, cardBoxID: 19001, openTime: 0 });
    assert.deepEqual(counts, [3, 2, 3]);
    h.repository.dispose();
});

test('多个空槽只保留最左侧战斗入口，空槽变化后按钮和体力显隐恢复', async () => {
    const views = Array.from({ length: 4 }, (_, index) => {
        const view = createChestSlotView();
        Object.assign(view, { node: { active: true, position: { x: index * 163 } } });
        return view;
    });
    const bar = createChestBar(views);
    const { repository } = await loadTreasure([
        { cardBoxID: 19001, openTime: 0, index: 2 },
        { cardBoxID: 19002, openTime: 0, index: 3 },
    ], 1792495000);
    const slots = repository.slots;
    const render = (data: readonly chestTypes.IChestSlotData[], expectedButtons: boolean[], expectedCosts: boolean[]) => {
        bar.render(data, () => {});
        assert.deepEqual(views.map((view) => view.btn.node.active), expectedButtons);
        assert.deepEqual(views.map((view) => view.cost.active), expectedCosts);
        views.forEach((view, index) => {
            assert.equal(view.emptyLabel.node.active, data[index].state === chestTypes.ChestSlotState.Empty);
            assert.equal(typeof view.onAction === 'function', expectedButtons[index]);
        });
    };
    render(slots, [true, true, true, false], [true, false, false, false]);
    const full = slots.map((slot) => ({ ...slots[1], index: slot.index }));
    render(full, [true, true, true, true], [false, false, false, false]);
    render([full[0], full[1], full[2], slots[3]], [true, true, true, true], [false, false, false, true]);
    render(slots, [true, true, true, false], [true, false, false, false]);
    const empty = slots.map((slot) => ({ ...slots[0], index: slot.index }));
    render(empty, [true, false, false, false], [true, false, false, false]);
});

test('卡面区分未激活、倒计时中、到期可开三种状态', () => {
    const view = createChestSlotView();
    const unactivated = {
        index: 1, state: chestTypes.ChestSlotState.Ready, name: '宝箱19001',
        remainSeconds: 10, totalSeconds: 10, action: chestTypes.ChestSlotAction.Activate, cost: 0,
    };
    view.render(unactivated);
    assert.equal((view.card as { spriteFrame: { name: string } }).spriteFrame.name, 'blue');
    assert.equal((view.timer as { active: boolean }).active, true);
    assert.equal((view.timeText as { string: string }).string, '10s');
    assert.equal((view.speedUpIcon as { active: boolean }).active, false);

    const ready = {
        ...unactivated, remainSeconds: 0, action: chestTypes.ChestSlotAction.Open,
    };
    view.render(ready);
    assert.equal((view.card as { spriteFrame: { name: string } }).spriteFrame.name, 'gold');
    assert.equal((view.timer as { active: boolean }).active, false);

    const counting = {
        ...unactivated, state: chestTypes.ChestSlotState.Counting, remainSeconds: 8,
        action: chestTypes.ChestSlotAction.SpeedUp,
    };
    view.render(counting);
    assert.equal((view.card as { spriteFrame: { name: string } }).spriteFrame.name, 'blue');
    assert.equal((view.timer as { active: boolean }).active, true);
    assert.equal((view.timeText as { string: string }).string, '00:00:08');
    assert.equal((view.speedUpIcon as { active: boolean }).active, true);
    assert.equal((view.btn as { spriteFrame: { name: string } }).spriteFrame.name, 'green-button');
});

test('未激活时隐藏进度并居中闹钟时长，激活后切换时分秒及左侧闹钟，复用时恢复', () => {
    const view = createChestSlotView();
    const waiting = {
        index: 1, state: chestTypes.ChestSlotState.Ready, name: '宝箱',
        remainSeconds: 30, totalSeconds: 30, action: chestTypes.ChestSlotAction.Activate, cost: 0,
    };
    const clock = view.clock as unknown as { position: { x: number } };
    const timeBg = view.timeBg as unknown as { active: boolean; position: { x: number }; scale: { x: number } };
    const text = view.timeText as unknown as { string: string; node: { position: { x: number } } };
    const width = view.timeTextTransform as unknown as { width: number };
    const assertWaiting = (seconds: number, expected: string) => {
        view.render({ ...waiting, remainSeconds: seconds, totalSeconds: seconds });
        assert.equal(timeBg.active, false);
        assert.equal(text.string, expected);
        // 图标宽 26：组合的左、右边缘关于卡片中心对称。
        assert.equal(clock.position.x - 13, -(text.node.position.x + width.width / 2));
    };
    assertWaiting(30, '30s');
    view.render({ ...waiting, state: chestTypes.ChestSlotState.Counting,
        action: chestTypes.ChestSlotAction.SpeedUp, remainSeconds: 8 });
    assert.equal(timeBg.active, true);
    assert.equal(text.string, '00:00:08');
    assert.ok(clock.position.x + 13 < timeBg.position.x - 137 * timeBg.scale.x / 2);
    assert.ok(Math.abs(view.timeFill.fillRange - 22 / 30) < 0.00001);
    assertWaiting(86400, '24h');
    assertWaiting(90, '1m 30s');
    view.render({ ...waiting, remainSeconds: 0, action: chestTypes.ChestSlotAction.Open });
    assert.equal(view.timer.active, false);
    assert.equal(timeBg.active, false);
});

test('激活倒计时固定两位时分秒，超过一天累计小时', () => {
    const formatter = createChestSlotView().constructor as { formatCountdown(seconds: number): string };
    for (const [seconds, expected] of [[0, '00:00:00'], [60, '00:01:00'], [3661, '01:01:01'],
        [90061, '25:01:01'], [-1, '00:00:00'], [NaN, '00:00:00']] as const) {
        assert.equal(formatter.formatCountdown(seconds), expected);
    }
});

test('开启与开始战斗使用相同加粗字形，槽位状态切换后不退回细字重描边', () => {
    const view = createChestSlotView();
    const slot = {
        index: 1, state: chestTypes.ChestSlotState.Ready, name: '宝箱',
        remainSeconds: 0, totalSeconds: 30, action: chestTypes.ChestSlotAction.Open, cost: 0,
    };
    for (const action of [chestTypes.ChestSlotAction.Battle, chestTypes.ChestSlotAction.Open,
        chestTypes.ChestSlotAction.SpeedUp, chestTypes.ChestSlotAction.Activate]) {
        view.render({ ...slot, action });
        assert.equal(view.btnLabel.isBold, true, `${action} 应保持与开始战斗一致的加粗字形`);
    }
});
