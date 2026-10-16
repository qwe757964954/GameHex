import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CardLineupPresenter,
    CardUpgradePresenter,
} from '../assets/script/app/card/CardPresenters';
import { LineupDraftStore } from '../assets/script/app/card/LineupDraftStore';

const card = (id: string) => ({ id, name: id, rarity: '绿' }) as any;

const status = (cardId: string, level: number) => ({
    cardId,
    configured: true,
    level,
    targetLevel: level + 1,
    maxLevel: 10,
    maxed: false,
    armyExpItemId: '16003',
    generalExpItemId: '16000',
    armyExpOwned: 99,
    generalExpOwned: 99,
    requirements: [],
    canUpgrade: true,
    blockedReason: '',
});

test('LineupDraftStore 按方案隔离草稿，保存值不再从节点名反查', () => {
    const first = card('1');
    const second = card('2');
    const store = new LineupDraftStore([first, second, first], 8, 2, 0);

    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['1', '2']);
    assert.equal(store.snapshot().dirty, false);
    store.reset();
    assert.deepEqual(store.snapshot().cards, []);
    assert.equal(store.snapshot().dirty, true);

    store.selectPreset(1);
    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['1', '2']);
    store.put(card('3'), 1);
    assert.deepEqual(store.commit(), ['1', '3', '2']);
    assert.equal(store.snapshot().dirty, false);
});

test('CardLineupPresenter 丢弃先发后到的旧刷新结果', async () => {
    const resolvers: Array<(value: any) => void> = [];
    const repository = {
        loadLineup: () => new Promise((resolve) => resolvers.push(resolve)),
    } as any;
    const presenter = new CardLineupPresenter(repository);
    const presented: string[] = [];
    const view = {
        isAlive: () => true,
        presentLineup: (data: any) => { presented.push(data.deck[0].id); },
    };

    const first = presenter.refresh(true, view);
    const second = presenter.refresh(true, view);
    resolvers[1]({ deck: [card('new')], catalog: [], heroLevels: new Map(), heroLevelCaps: new Map() });
    await second;
    resolvers[0]({ deck: [card('old')], catalog: [], heroLevels: new Map(), heroLevelCaps: new Map() });
    await first;
    assert.deepEqual(presented, ['new']);
});

test('CardUpgradePresenter 用显式阶段串起加载、提交与成功刷新', async () => {
    const applied: Array<[number, number]> = [];
    const repository = {
        loadUpgradeStatus: async (cardId: string, level: number) => status(cardId, level),
        upgradeHero: async () => ({ kind: 'success', heroId: 68001, level: 2 }),
        applyHeroLevel: (heroId: number, level: number) => applied.push([heroId, level]),
    } as any;
    const presenter = new CardUpgradePresenter(repository);
    const phases: string[] = [];
    let callbackLevel = 0;
    const view = {
        isAlive: () => true,
        presentUpgrade: (data: any) => phases.push(data.phase),
    };

    await presenter.open({
        card: card('68001'),
        cardId: '68001',
        level: 1,
        onUpgraded: (_heroId, level) => { callbackLevel = level; },
    }, view);
    await presenter.submit({}, view);

    assert.deepEqual(phases, ['loading', 'ready', 'submitting', 'ready']);
    assert.deepEqual(applied, [[68001, 2]]);
    assert.equal(callbackLevel, 2);
});
