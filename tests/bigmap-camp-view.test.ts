import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';
import * as campModel from '../assets/script/app/bigmap/model/BigMapCampInfo';
import * as BigMapCampRoleInfo from '../assets/script/app/bigmap/model/BigMapCampRoleInfo';
import { BIGMAP_CAMP_REFRESH_SECONDS } from '../assets/script/app/bigmap/application/BigMapCampRepository';

function loadModule(path: string, require: (name: string) => unknown, globals: object = {}) {
    const source = readFileSync(path, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require, ...globals });
    return exports;
}

test('真实 GameNet 适配器发送两种请求及 campIds，无连接与发送失败均返回空', async () => {
    class RequestMsg {
        constructor(public cmdReqMsg: object, public caller: unknown, public fCallback: (rsp: unknown) => void) {}
    }
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', () => ({ RequestMsg }));
    const sent: { name: string; ids: number[]; loading: boolean }[] = [];
    const net = { isConnected: true, ok: true,
        async send(request: RequestMsg & { getReqMsgProtoName(): string }, loading: boolean) {
            sent.push({ name: request.getReqMsgProtoName(), ids: Array.from((request.cmdReqMsg as { campIds: number[] }).campIds), loading });
            request.fCallback({ infos: [{ campId: 101, opType: 1, state: 2 }] });
            return this.ok;
        },
    };
    const exports = loadModule('assets/script/app/bigmap/application/GameNetBigMapCampGateway.ts', (name) =>
        name.endsWith('/GameNet') ? { GameNet: { instance: net } } : requests);
    const Gateway = exports.GameNetBigMapCampGateway as new () => {
        fetchSimple(ids: number[]): Promise<unknown>; fetchDetail(ids: number[]): Promise<unknown>;
    };
    const gateway = new Gateway();
    assert.ok(await gateway.fetchSimple([101, 102]));
    assert.ok(await gateway.fetchDetail([101]));
    assert.deepEqual(sent, [
        { name: 'CmdSlgCampSimpleInfoReqMsg', ids: [101, 102], loading: false },
        { name: 'CmdSlgCampInfoReqMsg', ids: [101], loading: false },
    ]);
    net.isConnected = false;
    assert.equal(await gateway.fetchSimple([101]), null);
    assert.equal(await gateway.fetchDetail([101]), null);
    assert.equal(sent.length, 2);
    net.isConnected = true;
    net.ok = false;
    assert.equal(await gateway.fetchDetail([101]), null);
});

function makeWorldView() {
    const timers = new Map<number, () => void>();
    let timerId = 0;
    const colors = { campOccupied: { color: 'red' }, campUnoccupied: { color: 'yellow' }, locked: { color: 'gray' } };
    class Color {}
    class Component {
        isValid = true;
        node = { activeInHierarchy: true };
        scheduled: (() => void) | null = null;
        schedule(callback: () => void) { this.scheduled = callback; }
        unschedule() { this.scheduled = null; }
    }
    const exports = loadModule('assets/script/app/bigmap/view/BigMapWorldView.ts', (name) => {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined }, Color, Component };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === './BigMapWorldLayout') return geometry;
        if (name === './BigMapTheme') return { BIGMAP_COLORS: colors };
        if (name.endsWith('/BigMapCampRepository')) return { BIGMAP_CAMP_REFRESH_SECONDS };
        return {};
    }, {
        setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: (id: number) => timers.delete(id),
    });
    interface IMarker { kind: string; id: number; node: { active: boolean; position: { x: number; y: number } }; icon: object;
        view: { hitArea: { badgeY: number; badgeHeight: number } } }
    interface IView extends Component {
        data: object; viewportTransform: object; content: object; markers: IMarker[];
        markerLayer: object; applyMarker: (...args: unknown[]) => void;
        applyCamera(scale: number, x: number, y: number): void; refresh(): void;
        onEnable(): void; onDisable(): void; onDestroy(): void;
    }
    const View = exports.BigMapWorldView as new () => IView;
    const view = new View();
    view.viewportTransform = { width: 200, height: 200 };
    view.content = { position: { x: 0, y: 0 }, setScale() {}, setPosition(x: number, y: number) { this.position = { x, y }; } };
    const markerView = { hitArea: { badgeY: 70, badgeHeight: 30 } };
    view.markers = [
        { kind: 'city', id: 101, node: { active: true, position: { x: 0, y: 0 } }, icon: {}, view: markerView },
        { kind: 'city', id: 102, node: { active: true, position: { x: 2000, y: 0 } }, icon: {}, view: markerView },
        { kind: 'monster', id: 7, node: { active: true, position: { x: 0, y: 0 } }, icon: {}, view: markerView },
    ];
    return { view, timers, colors, flush: () => {
        const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback());
    } };
}

test('相机变化合并查询，只传实际可见据点；停用地图取消定时刷新', () => {
    const h = makeWorldView();
    const calls: number[][] = [];
    h.view.data = { world: {} };
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        if (event.intent.kind === 'visibleCamps') calls.push(Array.from(event.intent.campIds));
    }, h.view);
    h.view.onEnable();
    h.view.applyCamera(1, 0, 0);
    h.view.applyCamera(1, 1, 0);
    assert.equal(h.timers.size, 1);
    h.flush();
    assert.deepEqual(calls, [[101]]);
    h.view.applyCamera(1, -2000, 0);
    h.flush();
    assert.deepEqual(calls, [[101], [102]]);
    h.view.applyCamera(1, 0, 0);
    h.view.onDisable();
    assert.equal(h.timers.size, 0);
    assert.equal(h.view.scheduled, null);
    EventMgr.instance.offTarget(h.view);
    h.view.onDestroy();
});

test('建筑根已离开视口但主城头像仍在屏内时保留标记，完全离屏后才隐藏', () => {
    const h = makeWorldView();
    h.view.data = { world: {}, refreshVisibleCamps: () => undefined };
    const marker = h.view.markers[0];
    marker.node.position.y = -380;
    marker.view = { hitArea: { badgeY: 270, badgeHeight: 110 } };
    h.view.applyCamera(1, 0, 0);
    assert.equal(marker.node.active, true);
    h.view.applyCamera(1, 0, -1000);
    assert.equal(marker.node.active, false);
    h.view.onDisable();
});

test('据点角标按 opType 红黄显示，状态相同时变更占领仍会重绘', () => {
    const h = makeWorldView();
    let opType = 0;
    let state = 1;
    const tints: unknown[] = [];
    h.view.markers = [h.view.markers[0]];
    h.view.data = { world: { monsters: [] }, playerBaseHexId: -1, territories: [],
        get cities() { return new Map([[101, { cityId: 101, name: '营地', state: 'open', level: 1, isServerCamp: true,
            campInfo: { campId: 101, opType, state } }]]); },
    };
    h.view.markerLayer = { clear() {} };
    h.view.applyMarker = (_marker, _frame, _title, tint) => { tints.push(tint); };
    h.view.refresh();
    assert.equal(tints[0], h.colors.campUnoccupied);
    h.view.refresh();
    assert.equal(tints.length, 1);
    opType = 1;
    h.view.refresh();
    assert.equal(tints[1], h.colors.campOccupied);
    state = 3;
    h.view.refresh();
    assert.equal(tints[2], h.colors.campOccupied, '结算中不改变占领颜色');
});

test('点击据点调用详情入口，弹窗显示两种独立状态，保留定位操作', () => {
    class Component {}
    const exports = loadModule('assets/script/app/bigmap/view/BigMapPage.ts', (name) => {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component };
        if (name.endsWith('/ResourceScope')) return { ResourceScope: class {} };
        if (name.endsWith('/BigMapCampInfo')) return campModel;
        // 详情面板的角色段走这个纯函数 —— 桩成 `{}` 会炸 `formatBigMapCampRoleLines is not a function`。
        if (name.endsWith('/BigMapCampRoleInfo')) return BigMapCampRoleInfo;
        return {};
    });
    interface IPage {
        data: object; worldView: object; infoThumbnail: object; infoBody: { string: string };
        infoTitle: object; primaryButton: { node: { active: boolean }; setText(value: string): void; setEnabled(value: boolean): void }; secondaryButton: object;
        setInfoVisible(value: boolean): void; refreshInfo(): void; onWorldTap(hexId: number): void;
    }
    const Page = exports.BigMapPage as new () => IPage;
    const page = new Page();
    Object.defineProperty(page, 'size', { value: { width: 500, height: 1000 } });
    const calls: number[] = [];
    let canAttack = false;
    let campInfo: { campId: number; opType: number; state: number } | null = { campId: 101, opType: 1, state: 3 };
    let campDetailStatus = 'ready';
    let campRoles: { roleId: string; serverId: string; roleName: string; avatarId: string; defenseHp: number; pos: number }[] = [];
    let campRolesStatus = 'ready';
    page.data = { get cities() { return new Map([[101, { name: '营地', level: 1, desc: '简介', isServerCamp: true, canAttack, staminaCost: 20,
        campInfo, campDetailStatus, attackReason: '', campRoles, campRolesStatus }]]); },
    };
    page.worldView = { occupantAt: () => ({ kind: 'city', cityId: 101 }) };
    page.infoThumbnail = { node: { active: false } };
    page.infoTitle = {};
    page.infoBody = { string: '' };
    let enabled = false;
    page.primaryButton = { node: { active: true }, setText() {}, setEnabled(value) { enabled = value; } };
    page.secondaryButton = { node: { active: true }, setText() {} };
    page.setInfoVisible = () => undefined;
    (page as any).ready = true;
    (page as any).selectedCityId = 101;
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        if (event.intent.kind === 'worldTap') calls.push(event.intent.hexId);
    }, page);
    page.onWorldTap(1);
    page.refreshInfo();
    assert.deepEqual(calls, [1]);
    EventMgr.instance.offTarget(page);
    assert.match(page.infoBody.string, /占领状态：已占领/);
    assert.match(page.infoBody.string, /据点状态：结算中/);
    assert.equal(page.primaryButton.node.active, true);
    assert.equal(enabled, false);
    canAttack = true;
    page.refreshInfo();
    assert.equal(enabled, true, '服务端开放的据点必须能从主按钮进入战斗');
    campInfo = null;
    campDetailStatus = 'failed';
    page.refreshInfo();
    assert.equal(enabled, true);
    assert.match(page.infoBody.string, /可尝试攻打/);
    assert.doesNotMatch(page.infoBody.string, /加载中|重新选择/);

    // 据点是空的时候也不能漏掉角色段（两条协议各自独立，失败态只影响自己那一段）。
    campRoles = [{ roleId: '9007199254740993', serverId: '3002', roleName: '山猫', avatarId: '2001', defenseHp: 120, pos: 12 }];
    campRolesStatus = 'ready';
    page.refreshInfo();
    assert.match(page.infoBody.string, /据点角色：1 人/);
    assert.match(page.infoBody.string, /山猫/);
    campRolesStatus = 'failed';
    page.refreshInfo();
    assert.match(page.infoBody.string, /山猫/, '★角色查询失败但有旧数据时继续显示旧数据');
});
