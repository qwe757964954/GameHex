import { runtimeFixture, deferred, flush as flushRuntime } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import type { IZCBattlePopup } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import type { IZCDamageStatsPopup } from '../assets/script/app/zcds/application/ZCBattleRuntimeContract';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function load(file: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as any, console, require: (name: string) => {
        if (name.endsWith('/ZCBattleEvents')) return { ZC_BATTLE_EVENTS };
        assert.ok(name in dependencies, name); return dependencies[name];
    } };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, context); return context.exports;
}
const decorator = { ccclass: () => (value: unknown) => value, property: () => () => {} };
const { ZCGameUiEvent } = load('assets/script/app/zcds/view/ZCGameHudEvents.ts', {});

/**
 * 弹窗替身：`open` 挂起（由用例手动兑现）。总线在**控制器自己**身上（`uiEvents`），订阅也在
 * `bindUiEvents` 里注册 —— 所以这里只要一个能 `close` 的壳，事件由用例直接往 `game.uiEvents` 派发。
 */
function popupStub(closed: number[] = []) {
    return { close: (reason: number) => closed.push(reason) };
}

test('结算按钮显示、空白关闭被拦截，返回只调用一次，复用时恢复统计预览', () => {
    class Base {
        enabledInHierarchy = true; isPopupOpen = true;
        close() { this.onClose(); } onClose() {} closeByButton() {}
    }
    const events: string[] = [];
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Label: class {}, Node: class {}, UITransform: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: Base },
        '../../../framework/ui/PopupDef': { PopupCloseReason: { CloseButton: 2 } },
        // 返回按钮只派发 `ZCGameUiEvent.ReturnToMain`（视图不碰流程，回主界面由控制器决定）。
        '../../../framework/event/EventMgr': { EventMgr: { instance: { emit: (event: string) => events.push(event) } } },
        '../view/ZCGameHudEvents': { ZCGameUiEvent },
        './RunAwayPlayerItem': { RunAwayPlayerItem: class {} },
        '../../HeadArt': {}, '../../common/SpriteFrameCache': {},
    });
    const popup = new GameRunAway();
    const listeners: Array<{ fn: Function; target: unknown }> = [];
    popup.returnButton = { node: { active: false, on: (_event: string, fn: Function, target: unknown) => listeners.push({ fn, target }) }, interactable: true };
    popup.titleLabel = { string: '' };
    popup.panelTransform = { width: 650, setContentSize() {} };
    popup.backgroundTransform = { width: 646, setContentSize() {} };
    popup.header = { setPosition() {} };
    popup.footerLabel = { node: { setPosition() {} } };
    popup.returnButton.node.setPosition = () => {};
    // 按钮监听在 `onInit` 里绑（`PopupBase` 首次打开前调一次），夹具不走完整打开流程 ⇒ 手动调。
    popup.onInit();
    // `showReturn` 才是「有没有返回按钮」的开关（原先靠有没有 `summary` 推断，那个字段已随
    // 两行数据（`mine`/`enemy`）改版一起下线）。
    popup.onOpen({ title: '胜利', showReturn: true });
    assert.equal(popup.titleLabel.string, '胜利');
    assert.equal(popup.returnButton.node.active, true);
    assert.equal(popup.canCloseOnBlank(), false, '返回模式不许点空白关');
    const listener = listeners[0]; listener.fn.call(listener.target); listener.fn.call(listener.target);
    assert.deepEqual(events, [ZCGameUiEvent.ReturnToMain], '连点两下只派发一次（第二次 showReturn 已落）');
    assert.equal(popup.returnButton.interactable, false);
    popup.onOpen();
    assert.equal(popup.titleLabel.string, '伤害统计'); assert.equal(popup.returnButton.node.active, false);
    assert.equal(popup.canCloseOnBlank(), true);
    assert.equal(listeners.length, 1, '复用不重复绑定');
});

test('神器结果弹吐司，模型与意图在运行控制器内处理', () => {
    const h = runtimeFixture();
    try {
        h.runtime.currentModel.useArtifact = () => ({ ok: true, message: '神器结果' });
        EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
        assert.ok(h.calls.includes('tip:神器结果'));
        const count = h.calls.filter(call => call.startsWith('tip:')).length;
        EventMgr.instance.emit(ZCGameUiEvent.HexClick, -1);
        assert.equal(h.calls.filter(call => call.startsWith('tip:')).length, count);
    } finally { h.dispose(); }
});

test('统计面板四人共用量尺、自己标记，切回双人收起多余行并缩短面板', () => {
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: {}, Label: class {}, Node: class {}, UITransform: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: class {} },
        '../../../framework/ui/PopupDef': {}, '../../../framework/event/EventMgr': {},
        '../view/ZCGameHudEvents': {}, './RunAwayPlayerItem': { RunAwayPlayerItem: class {} },
        '../../HeadArt': {}, '../../common/SpriteFrameCache': {},
    });
    const panel = new GameRunAway();
    const node = () => ({ active: true, y: 0, setPosition(_x: number, y: number) { this.y = y; } });
    panel.panelTransform = { width: 650, height: 0, setContentSize(_w: number, h: number) { this.height = h; } };
    panel.backgroundTransform = { width: 646, setContentSize() {} };
    panel.header = node(); panel.footerLabel = { node: node() }; panel.returnButton = { node: node() };
    const values: any[] = [];
    panel.items = Array.from({ length: 4 }, (_, i) => ({ node: node(), refresh: (value: unknown) => { values[i] = value; } }));
    const players = [ZCOwner.Player, ZCOwner.Enemy, ZCOwner.Enemy2, ZCOwner.Enemy3].map((owner, i) => ({ owner, name: `${i}`, headKey: '', damage: (i + 1) * 100, damageTaken: 400 - i * 100 }));
    panel.refresh(players);
    const fourHeight = panel.panelTransform.height;
    assert.ok(panel.items.every((item: any) => item.node.active));
    assert.ok(values.every(value => value.maxDamage === 400 && value.maxDamageTaken === 400));
    assert.deepEqual(values.map(value => value.owner), players.map(player => player.owner));
    for (const item of panel.items) assert.ok(Math.abs(item.node.y) + 56 < fourHeight / 2);
    panel.refresh(players.slice(0, 2));
    assert.equal(panel.panelTransform.height, fourHeight - 2 * 116);
    assert.deepEqual(Array.from(panel.items, (item: any) => item.node.active), [true, true, false, false]);
    assert.equal(values[0].maxDamage, 200);
});
test('胜负和平局自动结算一次，返回使用组合层导航端口', async () => {
    for (const status of ['victory', 'defeat', 'draw'] as const) {
        const h = runtimeFixture();
        try {
            h.forceStatus(status);
            for (let i = 0; i < 3; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
            await flushRuntime();
            assert.equal(h.requests.length, 1);
            assert.equal((h.pages[0] as { victory: boolean }).victory, status === 'victory');
            EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
            assert.ok(h.calls.includes('navigate'));
        } finally { h.dispose(); }
    }
});
test('确定先关页再导航，重复点击不重复导航，切流取消原样重开', async () => {
    const h = runtimeFixture();
    try {
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flushRuntime();
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
        assert.ok(h.calls.indexOf('close') < h.calls.indexOf('navigate'));
        assert.equal(h.calls.filter(call => call === 'navigate').length, 1);
        h.settleSwitch(false); await flushRuntime();
        assert.equal(h.pages.length, 2); assert.equal(h.pages[0], h.pages[1]);
        assert.equal(h.requests.length, 1);
    } finally { h.dispose(); }
});
test('主动撤退冻结业务，退出统一关闭统计和指南', async () => {
    const h = runtimeFixture();
    EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); await flushRuntime();
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    let develops = 0;
    h.runtime.currentModel.developHex = () => { develops++; return { ok: true, message: '' }; };
    EventMgr.instance.emit(ZCGameUiEvent.HexClick, 1);
    assert.equal(develops, 0);
    h.dispose();
    assert.ok(h.calls.includes('damageClose')); assert.ok(h.calls.includes('guideClose'));
});
test('退出后迟到的统计和指南窗口立即关闭，旧意图不再导航', async () => {
    for (const event of [ZCGameUiEvent.OpenDamageStats, ZCGameUiEvent.OpenGuide]) {
        const pending = deferred<IZCDamageStatsPopup | null>(); let closed = 0;
        const h = runtimeFixture({}, false, undefined, { openDamage: () => pending.promise, openGuide: () => pending.promise });
        EventMgr.instance.emit(event); await flushRuntime(); h.dispose();
        pending.resolve({ isOpen: true, refresh() {}, close: () => closed++ }); await flushRuntime();
        EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
        assert.equal(closed, 1); assert.equal(h.calls.includes('navigate'), false);
    }
});

test('结算 Prefab 按钮与说明绑定完整，复用现有按钮贴图且位于面板内', () => {
    const prefab = JSON.parse(readFileSync('assets/bundles/battle/ui/game/GameRunAway.prefab', 'utf8'));
    for (const object of prefab) {
        JSON.stringify(object, (key, value) => { if (key === '__id__') assert.ok(value >= 0 && value < prefab.length); return value; });
    }
    const script = prefab.find((x: any) => x.returnButton && x.titleLabel);
    const button = prefab[script.returnButton.__id__]; assert.equal(button.__type__, 'cc.Button');
    const node = prefab[button.node.__id__]; assert.equal(node._active, false);
    const sprite = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.Sprite');
    const meta = JSON.parse(readFileSync(assetPath('image/common/anniu_01.png.meta'), 'utf8'));
    assert.equal(sprite._spriteFrame.__uuid__, meta.subMetas.f9941.uuid);
    const transform = node._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    const panel = prefab[node._parent.__id__];
    const panelTransform = panel._components.map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === 'cc.UITransform');
    assert.ok(Math.abs(node._lpos.y) + transform._contentSize.height / 2 < panelTransform._contentSize.height / 2);
    // 原先断言的是 `summaryLabel`（一行说明文字）—— 两行数据（`mine`/`enemy`）改版后那个属性
    // 已从 `GameRunAway` 下线，现在必填的文本引用只剩标题 `titleLabel`。
    assert.equal(prefab[script.titleLabel.__id__].__type__, 'cc.Label');
});
