import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ControllerBase, type IControllerResources } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { StoreController } from '../assets/script/app/store/StoreController';
import { StoreEvent } from '../assets/script/app/store/StoreEvents';
import { CardLineupController } from '../assets/script/app/card/CardLineupController';
import { CardLineupUiEvent } from '../assets/script/app/card/CardLineupEvents';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
import { LeagueTabEvent } from '../assets/script/app/league/LeagueTabEvents';
import { LeagueJoinController } from '../assets/script/app/league/LeagueJoinController';
import { LeagueJoinEvent } from '../assets/script/app/league/LeagueJoinEvents';
import { createControllerContext } from './helpers/controller-context';

const tick = () => new Promise(resolve => setImmediate(resolve));
const phase = (owner: object, phase: string) => EventMgr.instance.emit(VIEW_LIFECYCLE, { phase }, owner);

function fixture() {
    class StorePage { isValid = true; }
    class CardLineupPage {
        resources: IControllerResources | null = null;
        autoLoadDecks = true; fallbackLevel = 3;
        initialize(resources: IControllerResources) { this.resources = resources; }
    }
    class RolePage {
        renders = 0;
        async renderSnapshot() { this.renders++; }
        selectBag() {} async showBag() {} async finishDecompose() {}
    }
    class LeagueTabPage {}
    class MainPage {}
    class MainTerritoryMap {}
    let purchases = 0, loads = 0, guideDisposes = 0;
    const pendingRoles: Array<(value: object) => void> = [];
    const removedCallers: object[] = [];
    const storeCallers: object[] = [];
    const roleCallers: object[] = [];
    const contextRemovedCallers: object[] = [];
    const openedPopups: Array<{ kind: string; userData: unknown; closeCalls: number; open?: boolean }> = [];
    const pendingTips: Array<{
        resolve: (popup: { isPopupOpen: boolean; close(): void } | null) => void;
        onClose?: () => void;
    }> = [];
    const openWithScope = async (
        params: { scope?: ResourceScope } | undefined,
        factory: () => Promise<{ isPopupOpen?: boolean; close(): void } | null>,
    ) => {
        const scope = params?.scope;
        if (scope?.disposed) return null;
        const popup = await factory();
        if (!popup) return null;
        if (scope?.disposed) {
            popup.close();
            return null;
        }
        if (scope) {
            const rawClose = popup.close.bind(popup);
            let closed = false;
            let detach = () => {};
            popup.close = () => {
                if (closed) return;
                closed = true;
                detach();
                rawClose();
            };
            detach = scope.defer(() => {
                if (popup.isPopupOpen !== false) popup.close();
            });
        }
        return popup;
    };
    const popupStub = (kind: string) => ({
        open: (params?: { scope?: ResourceScope; userData?: unknown }) => openWithScope(params, async () => {
            const record = { kind, userData: params?.userData, closeCalls: 0 };
            openedPopups.push(record);
            await tick();
            return {
                close: () => {
                    record.closeCalls++;
                },
            };
        }),
    });
    const exports: Record<string, unknown> = {};
    const imports: Record<string, unknown> = {
        ControllerBase: { ControllerBase },
        ResourceScope: { ResourceScope },
        EventMgr: { EventMgr },
        ViewLifecycle: { VIEW_LIFECYCLE },
        StorePage: { StorePage }, CardLineupPage: { CardLineupPage }, RolePage: { RolePage },
        LeagueTabPage: { LeagueTabPage }, MainPage: { MainPage }, MainTerritoryMap: { MainTerritoryMap },
        StoreController: { StoreController }, CardLineupController: { CardLineupController },
        RoleController: { RoleController }, LeagueTabController: { LeagueTabController },
        LeagueJoinController: { LeagueJoinController },
        StoreEvents: { StoreEvent }, CardLineupEvents: { CardLineupUiEvent },
        RoleEvents: { RoleEvent }, LeagueTabEvents: { LeagueTabEvent }, LeagueJoinEvents: { LeagueJoinEvent },
        StoreActions: { storeAction: async (_k: unknown, _c: unknown, req?: { caller: object }) => { purchases++; if (req) storeCallers.push(req.caller); } },
        CardRepository: {
            cardRepository: {
                loadArtConfig: async () => ({}),
                loadLineupSnapshot: () => null,
                loadLineup: async () => { loads++; return { heroLevels: new Map() }; },
            },
        },
        LineupBoardPage: { LineupBoardPage: popupStub('LineupBoardPage') },
        CardUpgradePage: { CardUpgradePage: popupStub('CardUpgradePage') },
        MilitiaTalentPage: { MilitiaTalentPage: popupStub('MilitiaTalentPage') },
        EquipEvolvePage: { EquipEvolvePage: popupStub('EquipEvolvePage') },
        RoleEquipInfoPopup: { RoleEquipInfoPopup: popupStub('RoleEquipInfoPopup') },
        RoleGemInfoPopup: { RoleGemInfoPopup: popupStub('RoleGemInfoPopup') },
        RoleGongMingPopup: { RoleGongMingPopup: popupStub('RoleGongMingPopup') },
        LeagueCreatePage: { LeagueCreatePage: popupStub('LeagueCreatePage') },
        LeagueInfoPage: { LeagueInfoPage: popupStub('LeagueInfoPage') },
        CommonTips: {
            CommonTips: {
                open: (params: { scope?: ResourceScope; onClose?: () => void }) => openWithScope(
                    params,
                    () => new Promise(resolve => {
                        pendingTips.push({ resolve, onClose: params?.onClose });
                    }),
                ),
            },
        },
        RoleRepository: { roleRepository: {
            load: () => new Promise(resolve => pendingRoles.push(resolve)),
            decomposeEquips: async (_ids: readonly string[], caller: object) => {
                roleCallers.push(caller);
                return { status: 'ok', removedIds: [], rewards: [] };
            },
        } },
        FW: { FW: { showTip() {}, ShowReward() {} } },
        GameNet: { GameNet: { instance: { removeCaller: (caller: object) => removedCallers.push(caller) } } },
        GuideComposition: { GuideComposition: class { dispose() { guideDisposes++; } } },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/main/MainPageComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, Promise, require: (path: string) => imports[path.split('/').pop()!] ?? {} });
    const Composition = exports.MainPageComposition as new (
        context: unknown, root: unknown, presented: () => void, requestOwner?: object,
    ) => ControllerBase;
    const bind = (view: object, requestOwner?: object) => new Composition(createControllerContext({
        callbackOwners: {
            addCallerCleanup: () => () => {},
            removeCallerListener: caller => contextRemovedCallers.push(caller),
        },
    }), {
        getComponent: (type: new () => object) => view instanceof type ? view : null,
        getComponentInChildren: () => null,
    }, () => {}, requestOwner);
    const failAfterCard = (card: CardLineupPage) => new Composition(createControllerContext(), {
        getComponent: (type: unknown) => {
            if (type === CardLineupPage) return card;
            if (type === RolePage) throw new Error('invalid page binding');
            return null;
        },
    }, () => {});
    return {
        bind, failAfterCard, StorePage, CardLineupPage, RolePage,
        pendingRoles, removedCallers, contextRemovedCallers, storeCallers, roleCallers, openedPopups, pendingTips,
        get purchases() { return purchases; },
        get loads() { return loads; },
        get guideDisposes() { return guideDisposes; },
    };
}

test('external composition binds before mount, starts only the ready owner and releases only that page', async () => {
    const f = fixture(), first = new f.StorePage(), second = new f.StorePage();
    const a = f.bind(first), b = f.bind(second);
    const buy = (owner: object) => EventMgr.instance.emit(StoreEvent.Action, { kind: 'buyGoods', context: { section: 'goods', rowId: 1 } }, owner);
    try {
        buy(first); assert.equal(f.purchases, 0);
        phase({}, 'ready'); buy(first); assert.equal(f.purchases, 0);
        phase(first, 'ready'); phase(first, 'ready'); buy(first); await tick();
        assert.equal(f.purchases, 1, 'duplicate ready must not duplicate subscriptions');
        phase(second, 'ready'); phase(first, 'destroyed');
        assert.equal(a.isDisposed, true); assert.equal(a.scope.disposed, true);
        assert.equal(b.isDisposed, false);
        buy(first); buy(second); await tick(); assert.equal(f.purchases, 2);
    } finally { a.dispose(); b.dispose(); }
});

test('hero view receives only presentation resources and ready data after its render subscriber exists', async () => {
    const f = fixture(), page = new f.CardLineupPage(), binding = f.bind(page);
    let renders = 0;
    const listener = {};
    EventMgr.instance.on(CardLineupUiEvent.Render, () => { renders++; }, listener);
    try {
        assert.ok(page.resources); assert.equal(f.loads, 0);
        phase(page, 'ready'); await tick(); assert.equal(f.loads, 1); assert.equal(renders, 1);
        phase(page, 'destroyed');
        assert.equal(page.resources.scope.disposed, true);
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { kind: 'refresh' });
        await tick(); assert.equal(f.loads, 1);
    } finally { EventMgr.instance.offTarget(listener); binding.dispose(); }
});

test('role disable and destruction cancel late data while a later enable can refresh', async () => {
    const f = fixture(), page = new f.RolePage(), binding = f.bind(page);
    try {
        phase(page, 'ready'); phase(page, 'enabled');
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'decompose', ids: ['11'] });
        await tick();
        assert.equal(f.roleCallers.length, 1);
        assert.equal(f.roleCallers[0] instanceof RoleController, true, 'RoleController 自身充当网络请求 caller');
        phase(page, 'disabled');
        assert.equal(f.contextRemovedCallers.includes(f.roleCallers[0]), true, '页签失活取消 RoleController 自身请求归属');
        f.pendingRoles.shift()({}); await tick(); assert.equal(page.renders, 0);
        phase(page, 'enabled'); f.pendingRoles.shift()({}); await tick(); assert.equal(page.renders, 1);
        phase(page, 'enabled'); phase(page, 'destroyed'); f.pendingRoles.shift()({});
        await tick(); assert.equal(page.renders, 1); assert.equal(binding.isDisposed, true);
        assert.equal(f.removedCallers.includes(page), false, 'RolePage 视图不再充当网络请求 caller');
        assert.equal(f.removedCallers.length, 0, '不冗余对 RoleController 调用 GameNet.removeCaller');
        assert.equal(f.contextRemovedCallers.filter(caller => caller === f.roleCallers[0]).length, 2, '失活与销毁均由基类移除 RoleController caller');
    } finally { binding.dispose(); }
});

test('composition construction failure releases already injected resources and lifecycle listeners', async () => {
    const f = fixture(), page = new f.CardLineupPage();
    assert.throws(() => f.failAfterCard(page), /invalid page binding/);
    assert.ok(page.resources);
    assert.equal(page.resources.scope.disposed, true);
    phase(page, 'ready'); await tick();
    assert.equal(f.loads, 0, 'failed construction must not leave a ready listener behind');
});

test('scoped popups close when resolved after disposal and dispose is idempotent', async () => {
    const f = fixture(), page = new f.CardLineupPage(), binding = f.bind(page);
    try {
        phase(page, 'ready');
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { kind: 'openUpgrade', card: { id: 'c1' }, level: 1 });
        await tick();
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { kind: 'edit' });
        assert.equal(f.openedPopups.length, 2);
        binding.dispose();
        binding.dispose();
        assert.equal(f.guideDisposes, 1, '重复 dispose 不重复释放内部组合');
        assert.equal(f.openedPopups[0].closeCalls, 1, '已挂载弹窗随作用域同步关闭');
        await tick();
        assert.equal(f.openedPopups[1].closeCalls, 1, '组合已释放时关闭迟到弹窗');
    } finally {
        binding.dispose();
    }
});

test('store controller cleans up fallback caller when requestOwner is omitted', async () => {
    const f = fixture();
    const hostOwner = {};
    const storeWithoutOwner = new f.StorePage();
    const storeWithOwner = new f.StorePage();
    const a = f.bind(storeWithoutOwner);
    const b = f.bind(storeWithOwner, hostOwner);
    phase(storeWithoutOwner, 'ready');
    phase(storeWithOwner, 'ready');
    EventMgr.instance.emit(StoreEvent.Action, { kind: 'buyGoods', context: { section: 'goods', rowId: 1 } }, storeWithoutOwner);
    EventMgr.instance.emit(StoreEvent.Action, { kind: 'buyGoods', context: { section: 'goods', rowId: 2 } }, storeWithOwner);
    await tick();
    assert.equal(f.storeCallers.length, 2);
    const [withoutOwnerCaller, withOwnerCaller] = f.storeCallers;
    assert.equal(withOwnerCaller, hostOwner, '已传 requestOwner 时请求归属外层宿主');
    assert.notEqual(withoutOwnerCaller, storeWithoutOwner, 'StorePage 视图不充当网络 caller');
    a.dispose();
    assert.equal(f.contextRemovedCallers.includes(withoutOwnerCaller), true, '未传 requestOwner 时由 StoreController 自动释放自身 caller');
    b.dispose();
    assert.equal(f.removedCallers.length, 0, '不冗余对 StoreController 重复调用 GameNet.removeCaller');
});

test('role popups no longer receive callback closures and role gem dialog cancel is idempotent', async () => {
    const f = fixture(), role = new f.RolePage(), binding = f.bind(role);
    try {
        phase(role, 'ready');
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equipPart', partId: 3 });
        assert.equal(f.openedPopups.length, 1);
        assert.equal(f.openedPopups[0].kind, 'RoleEquipInfoPopup');
        assert.deepEqual({ ...(f.openedPopups[0].userData as object) }, { partId: 3, bagUniqueId: undefined });
        const dialog = (binding as unknown as {
            createRoleGemDialog(): { open(d: object): Promise<string | null>; cancel(): void };
        }).createRoleGemDialog();
        let closedOnLateOpen = 0;
        const promise = dialog.open({ title: 'T', content: 'C', sureText: 'OK' });
        dialog.cancel();
        dialog.cancel();
        f.pendingTips[0].resolve({ isPopupOpen: true, close: () => { closedOnLateOpen++; f.pendingTips[0].onClose?.(); } });
        const res = await promise;
        await tick();
        assert.equal(closedOnLateOpen, 1, '取消后迟到的 CommonTips 应被关闭');
        assert.equal(res, null);
    } finally {
        binding.dispose();
    }
});
