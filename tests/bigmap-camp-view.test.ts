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
import * as BigMapCampMove from '../assets/script/app/bigmap/model/BigMapCampMove';
import { BIGMAP_CAMP_REFRESH_SECONDS } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { createControllerResources } from './helpers/controller-context';

function loadModule(path: string, require: (name: string) => unknown, globals: object = {}) {
    const source = readFileSync(path, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require, ...globals });
    return exports;
}

test('玩家详情展示全部身份字段及头像，循环索引不越界，迁城确认保留原始格ID', () => {
    const exports = loadModule('assets/script/app/bigmap/view/BigMapPage.ts', (name) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} };
        if (name.endsWith('/BigMapCampRoleInfo')) return BigMapCampRoleInfo;
        if (name.endsWith('/BigMapCampMove')) return BigMapCampMove;
        return {};
    });
    interface IContent { title: string; body: string; icon: unknown; primary: { enabled: boolean }; secondary: { enabled: boolean } }
    interface IPage {
        mode: string; selectedCityId: number; baseActionPending: boolean;
        rolePortraits: Map<string, unknown>;
        closeCityPopup(): void; closeInfoPopup(): void; showInfoPopup(content: IContent): void;
        refreshInfoContent(data: object): void; buildInfoPopupContent(data: object): IContent;
    }
    const Page = exports.BigMapPage as new () => IPage;
    const page = new Page();
    page.mode = 'world'; page.selectedCityId = 101;
    page.closeCityPopup = () => {}; page.closeInfoPopup = () => {};
    let content: IContent;
    page.showInfoPopup = (value) => { content = value; };
    const frame = {};
    page.rolePortraits.set('1001', frame);
    const city = { name: '营地', campRolesStatus: 'ready', campRoles: [
        { roleId: '9007199254740993', serverId: '9007199254740995', roleName: '玩家甲',
            avatarId: '1001', pos: 0, defenseHp: 0, buildLevel: 12 },
        { roleId: '2', serverId: '3', roleName: '乙', avatarId: '', pos: 7, defenseHp: 100 },
    ] };
    const data = { ui: { campRolesVisible: true, campRoleIndex: 8, pendingCampMoveId: 0, selectedBaseHexId: -1 },
        cities: new Map([[101, city]]) };
    page.refreshInfoContent(data);
    assert.match(content.title, /1\/2/);
    for (const text of ['玩家甲', '9007199254740993', '9007199254740995', '建筑等级：12', 'HP：0', '所在格：0']) assert.ok(content.body.includes(text));
    assert.equal(content.icon, frame);
    assert.equal(content.secondary.enabled, true);
    data.ui.campRoleIndex = 1;
    page.refreshInfoContent(data);
    assert.ok(content.body.includes('乙'));
    assert.equal(content.icon, null, '下一位无头像时不能留上一个玩家头像');
    page.baseActionPending = true;
    const confirmation = page.buildInfoPopupContent({ ...data, ui: { pendingCampMoveId: 101, selectedBaseHexId: 0 } });
    assert.ok(confirmation.body.includes('目标格：0'));
    assert.equal(confirmation.primary.enabled, false);
    assert.equal(confirmation.secondary.enabled, false);
});

test('玩家头像按ID合并加载，资源域释放后迟到结果不回填地图或弹窗', async () => {
    const pending: ((frame: object) => void)[] = [];
    const exports = loadModule('assets/script/app/bigmap/view/BigMapPage.ts', (name) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} };
        if (name.endsWith('/HeadArt')) return { HeadArt: { loadHeadFrame: () => new Promise((resolve) => pending.push(resolve)) } };
        return {};
    });
    interface IPage {
        isValid: boolean; controllerResources: ReturnType<typeof createControllerResources>;
        worldView: { setRolePortrait(id: string, frame: object): void };
        rolePortraits: Map<string, object | null>; loadRolePortraits(data: object): void;
    }
    const Page = exports.BigMapPage as new () => IPage;
    const page = new Page();
    page.isValid = true;
    const resources = createControllerResources();
    page.controllerResources = resources;
    let written = 0;
    page.worldView = { setRolePortrait: () => { written++; } };
    const data = { ui: { campRolesVisible: false }, cities: new Map([[101, {
        rankEntries: [{ rank: 1, avatarId: '1001' }, { rank: 2, avatarId: '1002' }],
        campRoles: [{ avatarId: '1003' }, { avatarId: '1004' }],
    }]]) };
    page.loadRolePortraits(data);
    page.loadRolePortraits(data);
    assert.equal(pending.length, 1);
    const frame = {};
    pending[0](frame);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(written, 1, '榜首头像加载后交给地图');
    assert.equal(page.rolePortraits.get('1001'), frame);
    data.cities.get(101).rankEntries = [{ rank: 1, avatarId: '1005' }];
    page.loadRolePortraits(data);
    assert.equal(pending.length, 2, '换榜首后加载新头像，不预载驻守名单');
    resources.scope.dispose();
    pending[1]({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(written, 1);
    assert.equal(page.rolePortraits.get('1005'), null);
});

test('真实 GameNet 适配器发送两种请求及 campIds，无连接与发送失败均返回空', async () => {
    class RequestMsg {
        constructor(public cmdReqMsg: object, public caller: unknown, public fCallback: (rsp: unknown) => void) {}
    }
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', () => ({ RequestMsg }));
    const sent: { name: string; ids: number[]; loading: boolean }[] = [];
    const net = { isConnected: true, ok: true,
        async send(request: RequestMsg & { getReqMsgProtoName(): string }, loading: boolean) {
            sent.push({ name: request.getReqMsgProtoName(), ids: Array.from((request.cmdReqMsg as { campIds: number[] }).campIds), loading });
            request.fCallback({ infos: [{ campId: 101, opType: 1 }] });
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
    interface IMarker { kind: string; id: number; node: { active: boolean; position: { x: number; y: number }; setPosition(x: number, y: number, z: number): void }; icon: object;
        view: { hitArea: { badgeY: number; badgeHeight: number; iconY?: number; height?: number }; setPortrait?(frame: unknown): void } }
    interface IView extends Component {
        data: object; viewportTransform: object; content: object; markers: IMarker[];
        art: { background: { originalSize: { width: number; height: number } } };
        backgroundTransform: { setContentSize(w: number, h: number): void };
        background: { node: { setScale(x: number, y: number, z: number): void; setPosition(x: number, y: number, z: number): void } };
        syncBackground(): void;
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
        { kind: 'city', id: 101, node: { active: true, position: { x: 0, y: 0 }, setPosition(x: number, y: number) { this.position = { x, y }; } }, icon: {}, view: markerView },
        { kind: 'city', id: 102, node: { active: true, position: { x: 2000, y: 0 }, setPosition(x: number, y: number) { this.position = { x, y }; } }, icon: {}, view: markerView },
        { kind: 'monster', id: 7, node: { active: true, position: { x: 0, y: 0 }, setPosition(x: number, y: number) { this.position = { x, y }; } }, icon: {}, view: markerView },
    ];
    return { view, timers, colors, flush: () => {
        const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((callback) => callback());
    } };
}

test('整图背景在视口尺寸更新后重新等比铺满，不沿用模板尺寸的缩放', () => {
    const { view } = makeWorldView();
    view.art = { background: { originalSize: { width: 1024, height: 1024 } } };
    let scale = 0;
    let size: number[] = [];
    view.backgroundTransform = { setContentSize: (w, h) => { size = [w, h]; } };
    view.background = { node: { setScale: (x) => { scale = x; }, setPosition() {} } };
    for (const [width, height] of [[696, 1168], [696, 1400], [1200, 600]]) {
        view.viewportTransform = { width, height };
        view.syncBackground();
        assert.deepEqual(size, [1024, 1024]);
        assert.equal(scale, Math.max(width, height) / 1024);
        assert.ok(size[0] * scale >= width && size[1] * scale >= height);
    }
});

test('相机变化合并查询，只传实际可见据点；停用地图取消定时刷新', () => {
    const h = makeWorldView();
    const calls: number[][] = [];
    h.view.data = { ui: {}, world: {} };
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
    h.view.data = { ui: {}, world: {}, refreshVisibleCamps: () => undefined };
    const marker = h.view.markers[0];
    marker.node.position.y = -380;
    // 名条已挪到建筑下方（2026-11-02 蓝湖「大地图3」），裁剪余量改由
    // 「建筑顶 + 头像」(`iconY + height/2`) 与「名条底」(`badgeY - badgeHeight/2`) 共同决定。
    marker.view = { hitArea: { iconY: 330, height: 340, badgeY: -44, badgeHeight: 56 } };
    h.view.applyCamera(1, 0, 0);
    assert.equal(marker.node.active, true);
    h.view.applyCamera(1, 0, -1000);
    assert.equal(marker.node.active, false);
    h.view.onDisable();
});

test('据点名条兜底色按 opType 红黄显示，opType 未变时不重绘', () => {
    const h = makeWorldView();
    let opType = 0;
    const tints: unknown[] = [];
    h.view.markers = [h.view.markers[0]];
    h.view.markers[0].view.setPortrait = () => undefined;
    h.view.data = { ui: {}, world: { monsters: [] }, playerBaseHexId: -1, territories: [],
        get cities() { return new Map([[101, { cityId: 101, name: '营地', state: 'open', level: 1, isServerCamp: true,
            campInfo: { campId: 101, opType, occupyRoleId: '', occupyRoleName: '', detailed: false } }]]); },
    };
    h.view.markerLayer = { clear() {} };
    // 名条换成整条贴图后，`tint` 只喂**手画兜底角标**（美术缺图时），所以仍按 opType 算。
    h.view.applyMarker = (_marker, view) => { tints.push(view.tint); };
    h.view.refresh();
    assert.equal(tints[0], h.colors.campUnoccupied);
    h.view.refresh();
    assert.equal(tints.length, 1);
    opType = 1;
    h.view.refresh();
    assert.equal(tints[1], h.colors.campOccupied, '协议只表达有没有人占，角标也只看 opType');
});

test('点击据点打开城池弹窗（PopupBase），占领者进弹窗，并自动聚焦一次替代旧「定位」按钮', () => {
    class Component {}
    // 2026-11-02：城池详情从「文字面板」改成 `PopupBase` 栈式弹窗，这条用例跟着改口径：
    // 不再断言 `infoBody` 的文案，而是断言**弹窗拿到的数据** + **自动聚焦意图**。
    const popupContents: Record<string, unknown>[] = [];
    const rendered: Record<string, any>[] = [];
    let popupAlive = false;
    const popupInstance = { render(content: Record<string, any>) { rendered.push(content); } };
    const popupStub = {
        async open(params: Record<string, any>) {
            const userData = params.userData as Record<string, any>;
            popupContents.push(userData);
            popupAlive = true;
            popupInstance.render(userData);
            return popupInstance;
        },
    };
    const exports = loadModule('assets/script/app/bigmap/view/BigMapPage.ts', (name) => {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component };
        if (name.endsWith('/ResourceScope')) return { ResourceScope: class {} };
        if (name.endsWith('/BigMapCampInfo')) return campModel;
        // 详情面板的角色段走这个纯函数 —— 桩成 `{}` 会炸 `formatBigMapCampRoleLines is not a function`。
        if (name.endsWith('/BigMapCampRoleInfo')) return BigMapCampRoleInfo;
        if (name.endsWith('/BigMapCityPopup')) return { BigMapCityPopup: popupStub };
        if (name.endsWith('/BigMapInfoPopup')) return { BigMapInfoPopup: class {} };
        if (name.endsWith('/PopupManager')) {
            return { PopupManager: { inst: { get: (cls: unknown) => (cls === popupStub && popupAlive ? popupInstance : null),
                closeByClass: (cls: unknown) => { if (cls === popupStub) popupAlive = false; } } } };
        }
        if (name.endsWith('/PopupDef')) return { PopupCloseReason: { Manual: 0, Force: 1 } };
        if (name.endsWith('/BigMapPresentationText')) return {
            BIGMAP_PRESENTATION_TEXT: { buffTitle: '增益效果', attack: '进攻', cannotAttack: '不可进攻' },
            formatBigMapPlotDetail: () => '', formatBigMapMonsterDetail: () => '',
        };
        return {};
    });
    interface IPage {
        data: object; worldView: object; infoThumbnail: object; infoBody: { string: string };
        infoTitle: object; primaryButton: { node: { active: boolean }; setText(value: string): void; setEnabled(value: boolean): void }; secondaryButton: object;
        setInfoVisible(value: boolean): void; refreshInfo(data: unknown): void; onWorldTap(hexId: number): void;
    }
    const Page = exports.BigMapPage as new () => IPage;
    const page = new Page();
    Object.defineProperty(page, 'size', { value: { width: 500, height: 1000 } });
    const calls: number[] = [];
    let canAttack = false;
    let campInfo: { campId: number; opType: number; occupyRoleId: string; occupyRoleName: string; detailed: boolean } | null =
        { campId: 101, opType: 1, occupyRoleId: '9007199254740993', occupyRoleName: '甲玩家', detailed: true };
    let campDetailStatus = 'ready';
    let campRoles: { roleId: string; serverId: string; roleName: string; avatarId: string; defenseHp: number; pos: number }[] = [];
    let campRolesStatus = 'ready';
    page.data = { ui: {}, get cities() { return new Map([[101, { name: '营地', level: 1, desc: '简介', isServerCamp: true, canAttack, staminaCost: 20,
        campInfo, campDetailStatus, attackReason: '', campRoles, campRolesStatus, rankEntries: [
            { roleId: '9007199254740993', rank: 1, name: '甲玩家', avatarId: '1001', warScore: 1512916 },
            { roleId: 'other', rank: 2, name: '乙玩家', avatarId: '1002', warScore: 1000000 },
        ] }]]); },
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
    page.refreshInfo(page.data);
    EventMgr.instance.offTarget(page);
    // ① 点据点的 worldTap 意图照旧
    assert.deepEqual(calls, [1]);
    // ② 城池详情走弹窗：占领者进弹窗数据（旧文字面板不再被写）
    assert.equal(popupContents.length, 1, '选中据点应当打开城池弹窗');
    assert.equal(popupContents[0].lordName, '甲玩家');
    assert.equal(popupContents[0].lordAvatarId, '1001');
    assert.equal(popupContents[0].lordScore, '1512916');
    assert.deepEqual(Array.from(popupContents[0].ranks as { rank: number }[], (row) => row.rank), [2],
        '城主单独展示，榜单保留其他玩家真实名次');
    assert.equal(page.infoBody.string, '', '城池不再走文字面板');
    // 攻打能力由弹窗的进攻按钮承载（旧的 primaryButton 已不参与城池详情）。
    assert.equal(popupContents[0].fightEnabled, false);
    canAttack = true;
    page.refreshInfo(page.data);
    assert.equal(popupContents.length, 1, '再次刷新不该重复压栈');
    assert.equal(rendered[rendered.length - 1].fightEnabled, true, '可攻打的据点，弹窗按钮必须可点');
    campInfo = null;
    campDetailStatus = 'failed';
    page.refreshInfo(page.data);
    assert.equal(rendered[rendered.length - 1].fightEnabled, true, '详情包失败但可攻打时按钮仍要可点');
    // 角色段 / 失败态文案不再进弹窗（弹窗只展示占领者 + 增益 + 榜单），
    // 这两段的数据契约由 `bigmap-camp-role*` 的用例守。
    assert.equal(page.infoBody.string, '');
});
