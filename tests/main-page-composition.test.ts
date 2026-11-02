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
import { LeagueTabController } from '../assets/script/app/league/LeagueTabController';
import { createControllerContext } from './helpers/controller-context';

const tick = () => new Promise(resolve => setImmediate(resolve));
const phase = (owner: object, phase: string) => EventMgr.instance.emit(VIEW_LIFECYCLE, { owner, phase });

function fixture() {
    class StorePage {}
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
    let purchases = 0, loads = 0;
    const pendingRoles: Array<(value: object) => void> = [];
    const exports: Record<string, unknown> = {};
    const imports: Record<string, unknown> = {
        ControllerBase: { ControllerBase }, ViewLifecycle: { VIEW_LIFECYCLE },
        StorePage: { StorePage }, CardLineupPage: { CardLineupPage }, RolePage: { RolePage },
        LeagueTabPage: { LeagueTabPage }, MainPage: { MainPage }, MainTerritoryMap: { MainTerritoryMap },
        StoreController: { StoreController }, CardLineupController: { CardLineupController },
        RoleController: { RoleController }, LeagueTabController: { LeagueTabController },
        StoreActions: { storeAction: async () => { purchases++; } },
        CardRepository: { cardRepository: { loadLineupSnapshot: () => null, loadLineup: async () => { loads++; return { heroLevels: new Map() }; } } },
        RoleRepository: { roleRepository: { load: () => new Promise(resolve => pendingRoles.push(resolve)) } },
        FW: { FW: { showTip() {} } },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/main/MainPageComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require: (path: string) => imports[path.split('/').pop()] ?? {} });
    const Composition = exports.MainPageComposition as new (context: unknown, root: unknown, presented: () => void) => ControllerBase;
    const bind = (view: object) => new Composition(createControllerContext(), {
        getComponent: (type: new () => object) => view instanceof type ? view : null,
        getComponentInChildren: () => null,
    }, () => {});
    const failAfterCard = (card: CardLineupPage) => new Composition(createControllerContext(), {
        getComponent: (type: unknown) => {
            if (type === CardLineupPage) return card;
            if (type === RolePage) throw new Error('invalid page binding');
            return null;
        },
    }, () => {});
    return { bind, failAfterCard, StorePage, CardLineupPage, RolePage, pendingRoles, get purchases() { return purchases; }, get loads() { return loads; } };
}

test('external composition binds before mount, starts only the ready owner and releases only that page', async () => {
    const f = fixture(), first = new f.StorePage(), second = new f.StorePage();
    const a = f.bind(first), b = f.bind(second);
    const buy = (owner: object) => EventMgr.instance.emit(StoreEvent.Action, { owner, kind: 'buyGoods', context: { section: 'goods', rowId: 1 } });
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
    EventMgr.instance.on(CardLineupUiEvent.Render, event => { if (event.owner === page) renders++; }, listener);
    try {
        assert.ok(page.resources); assert.equal(f.loads, 0);
        phase(page, 'ready'); await tick(); assert.equal(f.loads, 1); assert.equal(renders, 1);
        phase(page, 'destroyed');
        assert.equal(page.resources.scope.disposed, true);
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: page, kind: 'refresh' });
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
