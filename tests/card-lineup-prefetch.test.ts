import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { MainTabController } from '../assets/script/app/main/MainTabController';
import { MainTab } from '../assets/script/app/main/MainTabModel';
import { MainTabEvent } from '../assets/script/app/main/MainTabEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { visibleIconTallies, visibleLineupCards } from '../assets/script/app/card/CardLineupTypes';
import { cardArtConfig } from './helpers/card-art-config';
import { ZCCardType, type ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { createControllerContext } from './helpers/controller-context';

function fixture(hasSnapshot = true, cachedHeroes: unknown = null, artConfig: Promise<unknown> = Promise.resolve(cardArtConfig)) {
    const requested: string[] = [];
    const afterDraw = new Set<() => void>();
    const deck = [
        { id: 'a', type: ZCCardType.Barracks, traits: { attack: '战士', camp: '花果' } },
        { id: 'mine', type: ZCCardType.Mine },
    ] as ZCDeckCard[];
    const imports: Record<string, unknown> = {
        ControllerBase: { ControllerBase }, MainTabController: { MainTabController }, MainTabHost: { MainTab },
        MainTabEvents: { MainTabEvent }, ViewLifecycle: { VIEW_LIFECYCLE: 'test:prefetch-lifecycle' },
        FormationService: { fetchFormations: () => { requested.push('formations'); return Promise.resolve([]); } },
        PvpHeroService: {
            getCachedPvpHeroInfos: () => cachedHeroes,
            fetchPvpHeroInfos: () => { requested.push('heroes'); return Promise.resolve([]); },
        },
        CardRepository: { cardRepository: { loadArtConfig: () => artConfig, loadLineupSnapshot: () => hasSnapshot ? { deck } : null } },
        CardLineupTypes: { visibleIconTallies, visibleLineupCards },
        CardArtProvider: { cardArtProvider: {
            loadLineupSlot: async (card: ZCDeckCard) => { requested.push(`slot:${card.id}`); },
            loadTallyFrames: async (item: { kind: string; key: string }) => { requested.push(`icon:${item.kind}:${item.key}`); },
        } },
        BigMapEntry: { BigMapEntry: { shared: () => ({ isOpen: false, close() {} }) } },
        GameNet: { GameNet: { instance: { removeCaller() {} } } },
    };
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/main/MainTabsComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
        exports: moduleExports, console,
        require: (path: string) => path === 'cc' ? { Prefab: class {}, Director: { EVENT_AFTER_DRAW: 'draw' }, director: {
            once(_event: string, callback: () => void) { afterDraw.add(callback); },
            off(_event: string, callback: () => void) { afterDraw.delete(callback); },
        } }
            : imports[path.split('/').pop()] ?? {},
    });
    const context = createControllerContext();
    context.sessionAssets.warmup = async () => { requested.push('bundle-warmup'); };
    context.assets.load = () => { requested.push('page'); return new Promise(() => {}); };
    const Composition = moduleExports.MainTabsComposition as new (context: unknown, host: object) => {
        tabs: MainTabController<unknown>; dispose(): void;
    };
    const owner = {};
    const composition = new Composition(context, owner);
    const warmup = () => EventMgr.instance.emit(MainTabEvent.Warmup, { owner });
    const draw = () => { for (const callback of Array.from(afterDraw)) { afterDraw.delete(callback); callback(); } };
    return { composition, requested, deck, warmup, draw };
}

test('点击英雄页签即并行预取阵型、英雄列表和快照静态图片，不等页面 prefab', async () => {
    const f = fixture();
    try {
        void f.composition.tabs.switchTab(MainTab.Hero);
        await new Promise(resolve => setImmediate(resolve));
        const pageIndex = f.requested.indexOf('page');
        assert.ok(pageIndex >= 0);
        for (const request of ['formations', 'heroes', 'slot:a',
            ...visibleIconTallies(visibleLineupCards(f.deck), cardArtConfig.lineup).map(item => `icon:${item.kind}:${item.key}`)]) {
            const index = f.requested.indexOf(request);
            assert.ok(index >= 0, `${request} 应在页面加载期间预取`);
        }
        assert.equal(f.requested.includes('slot:mine'), false);
    } finally { f.composition.dispose(); }
});

test('主界面首帧后的静默预热提前准备快照图片，尚未点击时不拉取业务数据', async () => {
    const f = fixture();
    try {
        f.warmup();
        assert.deepEqual(f.requested, [], '主界面未绘制时不得抢占首屏资源');
        f.draw();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.requested.includes('slot:a'), true);
        assert.equal(f.requested.includes('bundle-warmup'), true);
        assert.equal(f.requested.includes('heroes'), false);
        assert.equal(f.requested.includes('formations'), false);
        assert.equal(f.requested.includes('page'), false);
    } finally { f.composition.dispose(); }
});

test('切页或退出主界面，取消尚未执行的图片静默预热', () => {
    for (const exit of ['switch', 'dispose']) {
        const f = fixture();
        try {
            f.warmup();
            if (exit === 'switch') void f.composition.tabs.switchTab(MainTab.Shop);
            else f.composition.dispose();
            f.draw();
            assert.equal(f.requested.some(value => value.startsWith('slot:')), false);
        } finally { f.composition.dispose(); }
    }
});

test('无快照仍提前请求数据，已有英雄缓存不强制重复刷新', () => {
    for (const cachedHeroes of [null, []]) {
        const f = fixture(false, cachedHeroes);
        try {
            void f.composition.tabs.switchTab(MainTab.Hero);
            assert.equal(f.requested.includes('formations'), true);
            assert.equal(f.requested.includes('heroes'), cachedHeroes === null);
            assert.equal(f.requested.some(value => value.startsWith('slot:')), false);
            assert.equal(f.requested.includes('page'), true);
        } finally { f.composition.dispose(); }
    }
});

test('美术配置尚在加载时切页或退出，不再开始预热图片', async () => {
    for (const exit of ['switch', 'dispose']) {
        let ready: (art: object) => void = () => {};
        const art = new Promise<object>(resolve => { ready = resolve; });
        const f = fixture(true, null, art);
        try {
            void f.composition.tabs.switchTab(MainTab.Hero);
            if (exit === 'switch') void f.composition.tabs.switchTab(MainTab.Shop);
            else f.composition.dispose();
            ready({}); await new Promise(resolve => setImmediate(resolve));
            assert.equal(f.requested.some(value => value.startsWith('slot:')), false);
        } finally { f.composition.dispose(); }
    }
});
