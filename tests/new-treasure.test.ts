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
        if (name === '../common/ResTypes') return { ITEM_TABLE: 'item', ROLE_PROPERTY_TABLE: 'roleProperty',
            resBarCellOfRefId: () => null, resBarIconSpritePath: () => '' };
        if (name === '../net/RequestGuard') return requestGuard;
        if (name === '../../framework/FW') return { FW: {} };
        if (name === '../../framework/net/RequestMsg') return { RequestMsg: RequestStub };
        if (name === '../../framework/ref/RefUtil') return { RefUtil: { instance: {
            getRefAllAsync: async (table: string) => {
                if (['item', 'roleProperty', 'itemBoxPro'].includes(table)) return [];
                assert.equal(table, 'newTreasureBoxConfig');
                return [
                    { cardBoxID: 19001, cardBoxOpenTime: 10, cardBoxName: '幼苗初级箱' },
                    { cardBoxID: 19002, cardBoxOpenTime: 30, cardBoxName: '幼苗中级箱' },
                    // 19003 故意不填 cardBoxName：守「表里缺名称时回落到 宝箱{id}」
                    { cardBoxID: 19003, cardBoxOpenTime: 10 },
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
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { emit() {} } } };
        if (name === './ChestEvents') return { CHEST_EVENTS: {} };
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
    // 按钮文案：`fontSize` 用来估字宽（视图按「字数 × 字号」摆「图标 + 文字」那组）。
    const btnLabelTransform = { width: 94 };
    const btnLabel = {
        string: '', isBold: false, spacingX: 0, overflow: 2, fontSize: 24,
        node: {
            position: { x: 0, y: 0 },
            setPosition(x: number, y: number) { this.position = { x, y }; },
            getComponent: () => btnLabelTransform,
        },
        updateRenderData() { btnLabelTransform.width = this.string.length * this.fontSize; },
    };
    const speedUpIcon = {
        active: false,
        position: { x: -43 },
        setPosition(x: number, _y: number) { this.position = { x }; },
    };
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
        btnLabel,
        speedUpIcon,
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
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { emit() {} } } };
        if (name === './ChestEvents') return { CHEST_EVENTS: {} };
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

test('宝箱名取配置表 cardBoxName（详情与宝箱栏同一份），表里缺名称才回落到 宝箱{id}', async () => {
    const { repository } = await loadTreasure([
        { cardBoxID: 19001, openTime: 0, index: 1 },
        { cardBoxID: 19003, openTime: 0, index: 2 },
    ], 1792495000);
    assert.equal(repository.slots[0].name, '幼苗初级箱');
    assert.equal(repository.detailOf(1)?.name, '幼苗初级箱');
    assert.equal(repository.slots[1].name, '宝箱19003');
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
        bar.render(data);
        assert.deepEqual(views.map((view) => view.btn.node.active), expectedButtons);
        assert.deepEqual(views.map((view) => view.cost.active), expectedCosts);
        views.forEach((view, index) => {
            assert.equal(view.emptyLabel.node.active, data[index].state === chestTypes.ChestSlotState.Empty);
            assert.equal(Reflect.get(view, 'actionEnabled'), expectedButtons[index]);
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

/**
 * 🔴 2026-11-09 用户：「点击整个宝箱都会打开宝箱详情弹窗」。
 *
 * 以前只有那颗 Btn 能点（卡面 / 宝箱图 / 名字都不响应）。现在根节点也挂一颗 `cc.Button`
 * （`transition = NONE`、`target = null`），视图在 `onLoad` 里**同时**把 CLICK 绑到根节点与按钮上。
 *
 * 两件事必须一起成立，缺一半就是"看着能点、其实没反应"：
 *  · prefab 根节点上真有那颗 Button（没挂 ⇒ 根节点根本收不到点击）；
 *  · 视图真绑了根节点的 CLICK（没绑 ⇒ 白挂）。
 */
test('★★★点整格也能开详情：根节点挂 cc.Button（无按压反馈），视图把 CLICK 同时绑到根节点与按钮', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/main/ChestSlot.prefab', 'utf8')) as {
        __type__?: string; node?: { __id__?: number }; _parent?: unknown; _components?: { __id__: number }[];
        _transition?: number; _target?: unknown;
    }[];
    const root = prefab.find((item) => item?.__type__ === 'cc.Node' && item._parent === null);
    assert.ok(root, 'prefab 必须有根节点');
    const rootIndex = prefab.indexOf(root);
    const rootButtons = prefab.filter((item) => item?.__type__ === 'cc.Button' && item.node?.__id__ === rootIndex);
    assert.equal(rootButtons.length, 1, '根节点上挂一颗 cc.Button（挂了才收得到点击；多挂会重复派发）');
    assert.equal(rootButtons[0]._transition, 0, '整卡不许有按压反馈（缩放/换色都很怪），用 NONE');
    assert.equal(rootButtons[0]._target ?? null, null, 'target 留空：不需要第二个被反馈的节点');

    // 视图侧：CLICK 必须两处都绑（同一个 handleAction，同一颗按钮的行为）。
    const view = createChestSlotView();
    const bound: string[] = [];
    const selfNode = { on: (type: string) => bound.push(`self:${type}`) };
    const btnNode = { active: true, on: (type: string) => bound.push(`btn:${type}`) };
    Object.assign(view, { node: selfNode, btn: { spriteFrame: null, node: btnNode } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (view as any).onLoad();
    assert.deepEqual(bound.sort(), ['btn:click', 'self:click'],
        '根节点与 Btn 都要绑 CLICK（同一次点击不会触发两遍：Button 会停冒泡）');
});

/**
 * 🔴 2026-11-09 用户：「战斗宝箱需要等待时间解锁时按钮的名称为【解锁】而不是开启，
 * 等待时间结束，点击可以开启时，按钮是绿色的」。
 *
 * 以前的映射把 `Activate`（还没开始等）和 `Open`（等完了）都落到「开启」+ 金色底：
 * 截图上三格都在倒计时（卡上写着 `30s` / `15s` / `10s`，还没启动）却一律写着「开启」，
 * 玩家分不清"现在点会不会真开到箱子"。
 */
test('★★★还没开始等 ⇒ 金色「解锁」；等完了 ⇒ 绿色「开启」（两种状态不许再共用一套）', () => {
    const view = createChestSlotView();
    const base = {
        index: 1, state: chestTypes.ChestSlotState.Ready, name: '宝箱',
        remainSeconds: 30, totalSeconds: 30, cost: 0,
    };
    const frameOf = () => String((view.btn.spriteFrame as { name?: string } | null)?.name ?? '');

    // 未激活：卡上显示"要等多久"（formatRemain 口径），按钮是**解锁**。
    view.render({ ...base, action: chestTypes.ChestSlotAction.Activate });
    assert.equal(view.btnLabel.string, '解锁', '等待解锁的宝箱不许写「开启」');
    assert.equal(frameOf(), 'gold-button', '「解锁」仍是金色底（绿色留给"可以开启"）');

    // 到点：可以开了 ⇒ 绿色 + 「开启」。
    view.render({ ...base, remainSeconds: 0, action: chestTypes.ChestSlotAction.Open });
    assert.equal(view.btnLabel.string, '开启');
    assert.equal(frameOf(), 'green-button', '可以开启时按钮必须是绿色的');

    // 另外两态不受影响：空槽蓝「开始战斗」、等待中绿「加速」。
    view.render({ ...base, state: chestTypes.ChestSlotState.Empty, action: chestTypes.ChestSlotAction.Battle });
    assert.equal(view.btnLabel.string, '开始战斗');
    assert.equal(frameOf(), 'blue-button');
    view.render({ ...base, state: chestTypes.ChestSlotState.Counting, remainSeconds: 8,
        action: chestTypes.ChestSlotAction.SpeedUp });
    assert.equal(view.btnLabel.string, '加速', '正在等的那格按钮写「加速」（不是「-30分钟」也不是「解锁」）');
    assert.equal(frameOf(), 'green-button');
    // 图标与文字要拼成**一组整体居中**：文案从 5 字缩到 2 字后，老口径（文字钉 x=16、图标钉 -43）
    // 会空出 20 多像素的缝。判据 = 组的左边缘与右边缘关于 0 对称。
    const icon = view.speedUpIcon as unknown as { position: { x: number } };
    const labelNode = (view.btnLabel as unknown as { node: { position: { x: number } } }).node;
    const textWidth = view.btnLabel.string.length * 24 + 2;
    const left = icon.position.x - 28 / 2;
    const right = labelNode.position.x + textWidth / 2;
    assert.ok(Math.abs(left + right) < 1e-6, `图标 + 文字必须整体居中（左 ${left} / 右 ${right}）`);
    assert.ok(left < -10 && right > 10, '这一组是横向铺开的，不是挤在一点上');
});
