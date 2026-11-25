import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ControllerBase, type IControllerResources } from '../assets/script/framework/controller/ControllerBase';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { StoreController } from '../assets/script/app/store/StoreController';
import { StoreEvent } from '../assets/script/app/store/StoreEvents';
import { CardLineupController } from '../assets/script/app/card/CardLineupController';
import { CardLineupUiEvent } from '../assets/script/app/card/CardLineupEvents';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
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
        selectBag() {} async showBag() {}
    }
    class LeagueTabPage {}
    class MainPage {}
    class MainTerritoryMap {}
    let purchases = 0, loads = 0, guideDisposes = 0;
    const pendingRoles: Array<(value: object) => void> = [];
    const removedCallers: object[] = [];
    const openedPopups: Array<{ kind: string; userData: unknown; closeCalls: number; open?: boolean }> = [];
    const pendingTips: Array<{
        resolve: (popup: { isPopupOpen: boolean; close(): void } | null) => void;
        onClose?: () => void;
    }> = [];
    const popupStub = (kind: string) => ({
        open: async (params?: { userData?: unknown }) => {
            const record = { kind, userData: params?.userData, closeCalls: 0 };
            openedPopups.push(record);
            await tick();
            return { close: () => { record.closeCalls++; } };
        },
    });
    const exports: Record<string, unknown> = {};
    const imports: Record<string, unknown> = {
        ControllerBase: { ControllerBase },
        EventMgr: { EventMgr },
        ViewLifecycle: { VIEW_LIFECYCLE },
        StorePage: { StorePage }, CardLineupPage: { CardLineupPage }, RolePage: { RolePage },
        LeagueTabPage: { LeagueTabPage }, MainPage: { MainPage }, MainTerritoryMap: { MainTerritoryMap },
        StoreController: { StoreController }, CardLineupController: { CardLineupController },
        RoleController: { RoleController }, LeagueTabController: { LeagueTabController },
        StoreActions: { storeAction: async () => { purchases++; } },
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
                open: (params: { onClose?: () => void }) => new Promise(resolve => {
                    pendingTips.push({ resolve, onClose: params?.onClose });
                }),
            },
        },
        RoleRepository: { roleRepository: { load: () => new Promise(resolve => pendingRoles.push(resolve)) } },
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
    const bind = (view: object, requestOwner?: object) => new Composition(createControllerContext(), {
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
        pendingRoles, removedCallers, openedPopups, pendingTips,
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
        phase(page, 'ready'); phase(page, 'enabled'); phase(page, 'disabled');
        f.pendingRoles.shift()({}); await tick(); assert.equal(page.renders, 0);
        phase(page, 'enabled'); f.pendingRoles.shift()({}); await tick(); assert.equal(page.renders, 1);
        phase(page, 'enabled'); phase(page, 'destroyed'); f.pendingRoles.shift()({});
        await tick(); assert.equal(page.renders, 1); assert.equal(binding.isDisposed, true);
        assert.equal(f.removedCallers.includes(page), true, '角色页销毁时应移除在途网络请求 caller');
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
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { kind: 'edit' });
        assert.equal(f.openedPopups.length, 1);
        binding.dispose();
        binding.dispose();
        assert.equal(f.guideDisposes, 1, '重复 dispose 不重复释放内部组合');
        await tick();
        assert.equal(f.openedPopups[0].closeCalls, 1, '组合已释放时关闭迟到弹窗');
    } finally {
        binding.dispose();
    }
});

test('store controller cleans up fallback caller when requestOwner is omitted', () => {
    const f = fixture();
    const hostOwner = {};
    const storeWithoutOwner = new f.StorePage();
    const storeWithOwner = new f.StorePage();
    const a = f.bind(storeWithoutOwner);
    const b = f.bind(storeWithOwner, hostOwner);
    a.dispose();
    assert.equal(f.removedCallers.length, 1, '未传 requestOwner 时由组合层兜底移除 StoreController caller');
    b.dispose();
    assert.equal(f.removedCallers.length, 1, '已传 requestOwner 时交由外层宿主统一清理');
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
