import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as MatchTypes from '../assets/script/app/matching/MatchTypes';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { createControllerContext } from './helpers/controller-context';
import { loadMatchIcons } from './helpers/sprite-frame-cache';

test('matching page destruction emits lifecycle without accessing destroyed child nodes', () => {
    const exports: Record<string, any> = {}, events: unknown[] = [];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchingPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { Component: class {}, _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } };
        if (name.endsWith('/EventMgr')) return { EventMgr: { instance: { emit: (_name: string, event: unknown) => events.push(event) } } };
        if (name.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE: 'lifecycle' };
        return {};
    } });
    const page = new exports.MatchingPage();
    page.waveNodes = [{ node: { set active(_v: boolean) { throw new Error('destroyed'); } } }];
    assert.doesNotThrow(() => page.onDestroy());
    assert.equal(page.waveNodes.length, 0); assert.equal(events.length, 1);
});

function playerFixture(waitForAsset?: (path: string) => boolean) {
    let complete!: () => void;
    let loading!: () => void;
    const ready = new Promise<void>(resolve => { complete = resolve; });
    const started = new Promise<void>(resolve => { loading = resolve; });
    const scope = new ResourceScope('matching');
    const paths: string[] = [];
    const context = createControllerContext();
    const { MatchIcons } = loadMatchIcons();
    const icons = new MatchIcons({ ...context.assets,
        async load(path, Type, options) {
            assert.equal(options?.scope, scope);
            paths.push(path);
            loading();
            if (waitForAsset?.(path)) await ready;
            const frame = new Type();
            Object.assign(frame as object, { assetPath: path });
            return frame;
        },
    }, scope);
    function load(file: 'MatchPlayerItem' | 'MatchCardSlot') {
        const exports: Record<string, any> = {};
        runInNewContext(ts.transpileModule(readFileSync(`assets/script/app/matching/${file}.ts`, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
        }).outputText, { exports, require(name: string) {
            if (name === 'cc') return { Component: class { isValid = true; node = { active: true }; }, Vec3: class { set() {} },
                _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } };
            if (name.endsWith('/ArtPaths')) return {
                ICON_ART_ROOT: 'icons', MATCH_ART_ROOT: 'matching', MATCH_SLOT_BARS: ['bar'],
                MATCH_SLOT_PILLS: ['pill'], MATCH_CARD_FRAME_ART: { blue: 'frame' },
            };
            if (name === './MatchTypes') return MatchTypes;
            return {};
        } });
        return exports[file];
    }
    const PlayerItem = load('MatchPlayerItem');
    const item = new PlayerItem();
    let writes = 0;
    const sprite = { set spriteFrame(_value: unknown) { writes++; } };
    const cardList = { count: 0, renderItemFn: (_node: unknown, _index: number) => {},
        refreshList(count: number) { this.count = count; }, scrollToTop() {} };
    Object.assign(item, { barFrame: sprite, powerBg: sprite, trophyBg: sprite, avatar: sprite,
        nameLabel: {}, trophyLabel: {}, powerValueLabel: {}, searchIcon: { node: { position: {} } }, cardList });
    item.initialize(icons);
    item.onLoad();
    return { item, cardList, load, complete, started, scope, paths, icons, get writes() { return writes; } };
}

test('信息条销毁使配色和内容加载失效，迟到图标不再写组件', async () => {
    const h = playerFixture(() => true);
    const slot = h.item.applySlot(0);
    const content = h.item.refresh({ name: '我方', trophy: 0, power: 0, avatarIcon: 'avatar', cards: [] });
    await h.started;
    h.item.isValid = false;
    h.item.onDestroy();
    assert.equal(h.scope.disposed, false);
    h.complete();
    await Promise.all([slot, content]);
    assert.equal(h.writes, 0);
    assert.equal(h.cardList.count, 0);
    h.scope.dispose();
});

test('信息条仍存活时正常应用异步图标', async () => {
    const h = playerFixture();
    await h.item.applySlot(0);
    assert.equal(h.writes, 3);
});

test('信息条把八张卡牌交给虚拟列表，滚到末尾时同一个条目可重绘', async () => {
    const h = playerFixture();
    const cards = Array.from({ length: 8 }, (_, index) => ({ rarity: 'blue', headRoot: 'heads', headIcon: `hero-${index}` }));
    await h.item.refresh({ name: '我方', trophy: 0, power: 0, avatarIcon: 'avatar', cards });
    assert.equal(h.writes, 1);
    assert.equal(h.cardList.count, 8);
    assert.deepEqual(h.paths, ['matching/avatar/spriteFrame']);
    const heroes: unknown[] = [];
    const cardSlot = { render(card: MatchTypes.MatchCardData, icons: unknown) {
        assert.equal(icons, h.icons);
        heroes.push(card.headIcon);
    } };
    const node = { getComponent() { return cardSlot; } };
    h.cardList.renderItemFn(node, 0);
    h.cardList.renderItemFn(node, 7);
    assert.deepEqual(heroes, ['hero-0', 'hero-7']);
    h.item.clear();
    assert.equal(h.cardList.count, 0);
});

test('卡牌格复用时先清空图标，并与信息条共用加载器', async () => {
    const h = playerFixture();
    const CardSlot = h.load('MatchCardSlot');
    const slot = new CardSlot();
    slot.hero = { spriteFrame: null };
    slot.frame = { spriteFrame: null };
    slot.badge = { spriteFrame: null, node: { active: false } };

    await Promise.all([
        slot.render({ id: 'current', rarity: 'blue', headRoot: 'heads', headIcon: 'current', roleIcon: 'role' }, h.icons),
        h.item.refresh({ name: '我方', trophy: 0, power: 0, avatarRoot: 'heads', avatarIcon: 'current', cards: [] }),
    ]);
    assert.equal(h.paths.filter(path => path === 'heads/current/spriteFrame').length, 1);
    assert.equal(slot.hero.spriteFrame.assetPath, 'heads/current/spriteFrame');
    assert.equal(slot.frame.spriteFrame.assetPath, 'matching/frame/spriteFrame');
    assert.equal(slot.badge.spriteFrame.assetPath, 'icons/role/spriteFrame');
    assert.equal(slot.badge.node.active, true);
    const last = slot.render({ id: 'last', rarity: 'blue', headRoot: 'heads', headIcon: 'last', roleIcon: '' }, h.icons);
    assert.equal(slot.hero.spriteFrame, null);
    assert.equal(slot.frame.spriteFrame, null);
    assert.equal(slot.badge.spriteFrame, null);
    assert.equal(slot.badge.node.active, false);
    await last;
    assert.equal(slot.hero.spriteFrame.assetPath, 'heads/last/spriteFrame');
    assert.equal(slot.badge.spriteFrame, null);
    assert.equal(slot.badge.node.active, false);
    h.scope.dispose();
});

test('旧匹配的迟到图标和释放动作不影响新一轮匹配', async () => {
    const { MatchIcons } = loadMatchIcons();
    const { assets } = createControllerContext();
    const oldScope = new ResourceScope('old-matching');
    const nextScope = new ResourceScope('next-matching');
    const nextIcons = new MatchIcons(assets, nextScope);
    const frame = await nextIcons.load('avatar', 'matching');
    assert.ok(frame);
    let finishOld!: () => void;
    const waitForOld = new Promise<void>(resolve => { finishOld = resolve; });
    const oldIcons = new MatchIcons({ ...assets, async load(_path, Type) {
        await waitForOld;
        return new Type();
    } }, oldScope);
    const old = oldIcons.load('avatar', 'matching');
    await Promise.resolve();
    oldScope.dispose();
    finishOld();
    assert.equal(await old, null);
    assert.equal(await nextIcons.load('avatar', 'matching'), frame);
    nextScope.dispose();
    assert.equal(await nextIcons.load('avatar', 'matching'), null);
});

test('虚拟列表复用卡牌格后，旧图标晚到不能覆盖新卡牌', async () => {
    const h = playerFixture(path => path === 'heads/old/spriteFrame');
    const CardSlot = h.load('MatchCardSlot');
    const slot = new CardSlot();
    slot.hero = { spriteFrame: null };
    slot.frame = { spriteFrame: null };
    slot.badge = { spriteFrame: null, node: { active: false } };
    const card = { id: 'old', rarity: 'blue', headRoot: 'heads', headIcon: 'old', roleIcon: '' };
    const old = slot.render(card, h.icons);
    await h.started;
    await slot.render({ ...card, id: 'next', headIcon: 'next' }, h.icons);
    h.complete();
    await old;
    assert.equal(slot.hero.spriteFrame.assetPath, 'heads/next/spriteFrame');
    h.scope.dispose();
});

test('匹配信息条预制体绑定带裁剪的横向虚拟列表和卡牌模板', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/matching/MatchPlayerItem.prefab', 'utf8'));
    const item = prefab.find((entry: object) => 'contentRoot' in entry && 'searchIcon' in entry);
    assert.ok(item);
    const list = prefab[item.cardList.__id__];
    assert.equal(list.useVirtualList, true);
    assert.equal(list.direction, 1);
    const viewport = prefab[list.node.__id__];
    assert.ok(viewport._components.some((ref: { __id__: number }) => prefab[ref.__id__].__type__ === 'cc.Mask'));
    const content = prefab[list.content.__id__];
    assert.equal(content._children.length, 1);
    const root = prefab[content._children[0].__id__];
    const slot = root._components.map((ref: { __id__: number }) => prefab[ref.__id__])
        .find((component: object) => 'hero' in component && 'frame' in component && 'badge' in component);
    assert.ok(slot);
    for (const [key, name] of [['hero', 'Hero'], ['frame', 'Frame'], ['badge', 'Badge']]) {
        const sprite = prefab[slot[key].__id__];
        assert.equal(sprite.__type__, 'cc.Sprite');
        const node = prefab[sprite.node.__id__];
        assert.equal(node._name, name);
        const parent = prefab[node._parent.__id__];
        assert.equal(key === 'hero' ? prefab[parent._parent.__id__] : parent, root);
    }
});

test('matching ready is emitted from start after child onLoad, never from parent onLoad', () => {
    const code = readFileSync('assets/script/app/matching/MatchingPage.ts', 'utf8');
    const onLoad = code.slice(code.indexOf('protected onLoad()'), code.indexOf('protected start()'));
    assert.doesNotMatch(onLoad, /phase: 'ready'|\.setSearching\(/);
    assert.match(code, /protected start\(\): void \{ EventMgr\.instance\.emit\(VIEW_LIFECYCLE, \{ phase: 'ready' \}, this\)/);
});
