import { cardArtConfig } from './helpers/card-art-config';
import type { ICardDetailArt } from '../assets/script/app/card/CardArtProvider';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CardUpgradeController } from '../assets/script/app/card/CardUpgradeController';
import { CardUpgradeModel } from '../assets/script/app/card/CardUpgradeModel';
import { LineupBoardController } from '../assets/script/app/card/LineupBoardController';
import { LineupBoardModel } from '../assets/script/app/card/LineupBoardModel';
import { CardPopupEvent } from '../assets/script/app/card/CardPopupEvents';
import { CardLineupEvent } from '../assets/script/app/card/CardLineupEvents';
import { CardLineupController } from '../assets/script/app/card/CardLineupController';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { UpgradeHeroResult, LineupBoardData, CardLineupData } from '../assets/script/app/card/CardRepository';
import type { FormationSaveResult } from '../assets/script/app/card/FormationService';
import { buildCardLevelUpTable, evaluateUpgrade, upgradeButtonText } from '../assets/script/app/card/CardUpgradeCost';
const card = (id: string) => ({ id, name: id }) as ZCDeckCard;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function upgradeStatus(level = 0) { return { cardId: '1', level, targetLevel: level + 1, configured: true, maxLevel: 10, maxed: false,
    armyExpItemId: '16003', generalExpItemId: '16000', armyExpOwned: 99, generalExpOwned: 99, requirements: [], canUpgrade: true, blockedReason: '' }; }

test('详情与升级状态独立展示；升级后忽略上一等级迟到的详情', async () => {
    const h = upgradeFixture();
    const oldDetail = deferred<any>();
    const newDetail = { stats: [], chain: [], critDamageGain: 0, milestones: [], powerText: 'new' };
    h.repository.loadCardDetail = async (_id, level) => level === 0 ? oldDetail.promise : newDetail;
    try {
        const opening = h.controller.start(); await tick();
        assert.equal(h.states.at(-1).phase, 'ready', '升级状态无需等待技能详情');
        h.intent();
        h.pending.resolve({ kind: 'success', heroId: 1, level: 1 }); await tick();
        assert.equal(h.states.at(-1).detail, newDetail);
        const count = h.states.length;
        oldDetail.resolve({ ...newDetail, powerText: 'old' }); await opening;
        assert.equal(h.states.length, count);
        assert.equal(h.states.at(-1).detail, newDetail);
    } finally { h.finish(); }
});

test('技能详情先就绪时立即展示，不等待升级配置', async () => {
    const h = upgradeFixture(); const status = deferred<any>();
    h.repository.loadUpgradeStatus = async () => status.promise;
    const detail = { stats: [], chain: [], critDamageGain: 0, milestones: [], powerText: 'ready' };
    h.repository.loadCardDetail = async () => detail;
    try {
        const opening = h.controller.start(); await tick();
        assert.equal(h.states.at(-1).detail, detail);
        assert.equal(h.states.at(-1).status, null);
        status.resolve(upgradeStatus()); await opening;
    } finally { h.finish(); }
});

test('详情左右切卡沿用卡库顺序与真实等级，升级在途禁止跳转', async () => {
    const h = upgradeFixture();
    h.repository.loadDetailNavigation = async () => ({
        catalog: [card('1'), card('2'), card('3')], heroLevels: new Map([['2', 7]]),
        heroListKnown: true,
    });
    try {
        await h.controller.start();
        h.intent('next', {});
        assert.equal(h.states.at(-1).cardId, '1', '其他详情实例的意图不能串入');
        h.intent('next');
        await tick();
        assert.equal(h.states.at(-1).cardId, '2');
        assert.equal(h.states.at(-1).level, 7);
        h.intent('previous');
        await tick();
        assert.equal(h.states.at(-1).cardId, '1');
        assert.equal(h.states.at(-1).level, 0, '未解锁的卡不能借用上一张的等级');
        h.intent('submit');
        h.intent('next'); h.intent('skills');
        assert.equal(h.states.at(-1).cardId, '1');
        assert.equal(h.skills.length, 0);
        h.pending.resolve({ kind: 'failed' });
        await tick();
    } finally { h.finish(); }
});

test('完整卡库为空时不跳到虚构卡牌', async () => {
    const h = upgradeFixture();
    try {
        await h.controller.start();
        h.intent('previous'); h.intent('next');
        await tick();
        assert.equal(h.states.at(-1).cardId, '1');
    } finally { h.finish(); }
});
function upgradeFixture() {
    const owner = {}, states: any[] = [], results: any[] = [], applied: any[] = [], skills: any[] = [];
    const failures: unknown[] = [];
    let calls = 0, loads = 0, releases = 0, loading = 0, removed = 0;
    const pending = deferred<UpgradeHeroResult>();
    const repository = { loadDetailArt: async (_card: ZCDeckCard | null): Promise<ICardDetailArt> => ({ hero: null, diamond: null, classTag: null }), loadUpgradeStatus: async (_id: string, level: number) => { loads++; return upgradeStatus(level); }, loadArtConfig: async () => cardArtConfig,
        loadLineupSnapshot: (): CardLineupData | null => null,
        loadDetailNavigation: async () => ({ catalog: [] as readonly ZCDeckCard[], heroLevels: new Map<string, number>(), heroListKnown: true }),
        loadCardDetail: async (_id: string, _level: number) => ({ stats: [], powerText: '', critDamageGain: 0, chain: [{ skillId: 100101, name: '技能', unlockLevel: 3, unlocked: false, empty: false }], milestones: [] }),
        upgradeHero: async (_id: number, caller: object) => { calls++; assert.equal(caller, controller); return pending.promise; },
        applyHeroLevel: (id: number, level: number) => applied.push({ id, level }) };
    const controller = new CardUpgradeController(createControllerContext(), {
        owner,
        model: new CardUpgradeModel({ card: card('1'), cardId: '1', level: 0 }),
        repository,
        failed: error => failures.push(error),
        view: {
            render: state => { states.push(state); },
        },
        loading: {
            beginLoading: () => { loading++; return () => { releases++; }; }
        },
        requests: {
            removeCaller: () => { removed++; }
        },
        popups: {
            openSkills: value => skills.push(value),
        },
    });
    EventMgr.instance.on(CardLineupEvent.HeroUpgraded, value => results.push(value), owner);
    const intent = (kind = 'submit', eventOwner = owner) => EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { owner: eventOwner, kind, skillId: 100101 });
    return { owner, controller, repository, states, results, applied, skills, pending, intent, failures,
        finish() { controller.dispose(); EventMgr.instance.offTarget(owner); },
        get calls() { return calls; }, get loads() { return loads; }, get releases() { return releases; }, get loading() { return loading; }, get removed() { return removed; } };
}

test('详情切卡等待新美术就绪后连同数据一次提交，期间保留原卡完整画面', async () => {
    const h = upgradeFixture();
    const art = deferred<ICardDetailArt>();
    h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')], heroLevels: new Map(), heroListKnown: true });
    try {
        await h.controller.start();
        const original = h.states.at(-1), count = h.states.length;
        h.repository.loadDetailArt = () => art.promise;
        h.intent('next'); await tick();
        assert.equal(h.states.length, count);
        assert.equal(h.states.at(-1), original);
        const prepared: ICardDetailArt = { hero: null, diamond: null, classTag: null };
        art.resolve(prepared); await tick();
        assert.equal(h.states.length, count + 1);
        assert.equal(h.states.at(-1).cardId, '2');
        assert.equal(h.states.at(-1).art, prepared);
    } finally { h.finish(); }
});

test('切卡美术加载失败保留原卡，可重试；关闭后迟到美术不发布', async () => {
    for (const exit of ['failure', 'dispose']) {
        const h = upgradeFixture();
        const art = deferred<ICardDetailArt>();
        h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')], heroLevels: new Map(), heroListKnown: true });
        try {
            await h.controller.start();
            const original = h.states.at(-1), count = h.states.length;
            const failure = new Error('美术加载失败');
            h.repository.loadDetailArt = () => exit === 'failure' ? Promise.reject(failure) : art.promise;
            h.intent('next'); await tick();
            if (exit === 'dispose') { h.controller.dispose(); art.resolve({ hero: null, diamond: null, classTag: null }); await tick(); }
            assert.equal(h.states.length, count);
            assert.equal(h.states.at(-1), original);
            if (exit === 'failure') {
                assert.equal(h.failures.at(-1), failure);
                h.repository.loadDetailArt = async () => ({ hero: null, diamond: null, classTag: null });
                h.intent('next'); await tick();
                assert.equal(h.states.at(-1).cardId, '2');
            }
        } finally { h.finish(); }
    }
});
test('upgrade isolates intents, gates duplicate submits and publishes confirmed level before refreshing costs', async () => {
    const h = upgradeFixture(); try {
        await h.controller.start(); h.intent('submit', {}); h.intent(); h.intent();
        assert.equal(h.calls, 1); assert.equal(h.loading, 1);
        h.pending.resolve({ kind: 'success', heroId: 1, level: 1 }); await tick();
        assert.equal(h.results.length, 1); assert.equal(h.applied.length, 1); assert.equal(h.loads, 2);
        assert.equal(h.states[h.states.length - 1].level, 1); assert.equal(h.states[h.states.length - 1].phase, 'ready');
        assert.equal(h.releases, 1);
    } finally { h.finish(); }
    assert.equal(h.releases, 1); assert.equal(h.removed, 1);
});
test('upgrade disposal releases loading immediately and ignores late response and cache/event/skill side effects', async () => {
    const h = upgradeFixture(); await h.controller.start(); h.intent(); const count = h.states.length;
    h.controller.dispose(); h.controller.dispose(); assert.equal(h.releases, 1);
    h.pending.resolve({ kind: 'success', heroId: 1, level: 7 }); await tick(); h.intent('skills');
    assert.equal(h.states.length, count); assert.equal(h.results.length, 0); assert.equal(h.applied.length, 0); assert.equal(h.skills.length, 0);
    assert.equal(h.loads, 1); assert.equal(h.removed, 1); h.finish();
});
test('failed upgrade retains level and allows retry; skill navigation comes from controller data', async () => {
    const h = upgradeFixture(); try {
        await h.controller.start(); h.intent(); h.pending.resolve({ kind: 'offline' }); await tick();
        assert.equal(h.states[h.states.length - 1].level, 0); assert.equal(h.states[h.states.length - 1].phase, 'offline');
        h.repository.upgradeHero = async () => { throw new Error('offline'); }; h.intent(); await tick();
        assert.equal(h.states[h.states.length - 1].phase, 'failed'); assert.equal(h.releases, 2);
        h.intent('skills'); assert.deepEqual(h.skills, [{ heroId: 1, skillId: 100101 }]);
    } finally { h.finish(); }
});
const boardData = (): LineupBoardData => ({ art: cardArtConfig, deck: [card('1')], pool: [card('1'), card('2'), card('3')], heroLevels: new Map(), heroLevelCaps: new Map(),
    formations: [{ formationId: 1, heroIds: [1], selected: true }, { formationId: 2, heroIds: [2], selected: false }] });
function boardFixture(closeAfterSave = false) {
    const owner = {}, states: any[] = [], events: any[] = [], submissions: any[] = [], tips: string[] = [];
    const selects: { formationId: number }[] = [];
    let removed = 0, closed = 0;
    const pending = deferred<FormationSaveResult>();
    const repository = { loadBoard: async () => boardData(), saveFormation: async (id: number, heroIds: readonly number[], caller: object) => {
        assert.equal(caller, controller); submissions.push({ id, heroIds }); return pending.promise; },
    selectFormation: async (formationId: number) => { selects.push({ formationId }); return true; } };
    const controller = new LineupBoardController(createControllerContext(), {
        owner,
        model: new LineupBoardModel(2, 0),
        repository,
        autoLoadDecks: true,
        closeAfterSave,
        failed() {},
        view: {
            render: state => { states.push(state); },
            close: () => { closed++; }
        },
        feedback: {
            tip: value => tips.push(value)
        },
        requests: {
            removeCaller: () => { removed++; }
        },
    });
    EventMgr.instance.on(CardLineupEvent.DeckSaved, value => events.push(value), owner);
    const intent = (kind: string, data = {}, eventOwner = owner) => EventMgr.instance.emit(CardPopupEvent.BoardIntent, { owner: eventOwner, kind, ...data });
    return { controller, repository, pending, states, events, submissions, tips, selects, intent,
        finish() { controller.dispose(); EventMgr.instance.offTarget(owner); }, get removed() { return removed; }, get closed() { return closed; } };
}
test('board owns independent preset drafts, toggles and reset; foreign intents are ignored', async () => {
    const h = boardFixture(); try {
        await h.controller.start(); h.intent('toggle', { cardId: '2' }, {}); h.intent('toggle', { cardId: '2' });
        assert.deepEqual(h.states[h.states.length - 1].cards.map((v: ZCDeckCard) => v.id), ['1', '2']);
        h.intent('preset', { index: 1 }); assert.deepEqual(h.states[h.states.length - 1].cards.map((v: ZCDeckCard) => v.id), ['2']);
        h.intent('reset'); h.intent('preset', { index: 0 });
        assert.deepEqual(h.states[h.states.length - 1].cards.map((v: ZCDeckCard) => v.id), ['1', '2']);
        h.intent('toggle', { cardId: 'unknown' }); assert.equal(h.states[h.states.length - 1].cards.length, 2);
    } finally { h.finish(); }
});
/**
 * 8 张、4 个品级齐全的卡组（`isCompleteLineup` 的「完整阵容」口径）。
 * `take` 用来只取前 N 张，构造「差一张」的半成品。
 */
const RARITIES = ['gold', 'purple', 'blue', 'green'] as const;
const fullDeck = (take = 8) => Array.from({ length: take }, (_unused, index) => ({
    id: String(index + 1), name: String(index + 1), rarity: RARITIES[index % RARITIES.length],
}) as ZCDeckCard);
const fullBoardData = (deck = fullDeck(8), target = fullDeck(8)): LineupBoardData => ({
    art: cardArtConfig, deck, pool: fullDeck(8), heroLevels: new Map(), heroLevelCaps: new Map(),
    formations: [
        { formationId: 1, heroIds: deck.map((entry) => Number(entry.id)), selected: true },
        { formationId: 2, heroIds: target.map((entry) => Number(entry.id)), selected: false },
    ],
});
test('切页签：当前方案是「有改动的完整阵容」时先提交最新阵容，成功后才切', async () => {
    const h = boardFixture(); try {
        h.repository.loadBoard = async () => fullBoardData(fullDeck(7));
        await h.controller.start();
        h.intent('toggle', { cardId: '8' });
        assert.equal(h.states[h.states.length - 1].cards.length, 8);
        h.intent('preset', { index: 1 });
        assert.equal(h.submissions.length, 1, '切走前必须先把最新阵容发给服务器');
        assert.equal(h.submissions[0].id, 1);
        assert.deepEqual(h.submissions[0].heroIds, [1, 2, 3, 4, 5, 6, 7, 8]);
        assert.equal(h.states[h.states.length - 1].selectedPreset, 0, '回包前不能切页签');
        h.pending.resolve({ kind: 'success', formation: { formationId: 1, heroIds: [1, 2, 3, 4, 5, 6, 7, 8], selected: true } });
        await tick(); await tick();
        assert.equal(h.states[h.states.length - 1].selectedPreset, 1);
        assert.deepEqual(h.states[h.states.length - 1].cards.map((v: ZCDeckCard) => v.id), fullDeck().map(card => card.id));
        assert.deepEqual(h.events, [
            { formationId: 1, heroIds: [1, 2, 3, 4, 5, 6, 7, 8] },
            { formationId: 2, heroIds: [1, 2, 3, 4, 5, 6, 7, 8] },
        ], '自动提交与切页签各广播一次 DeckSaved');
        assert.deepEqual(h.tips, [], '点的是页签，不该弹「已保存」');
        assert.deepEqual(h.selects, [{ formationId: 2 }], '切过去要把出战阵型同步给服务器（CmdFormationSelectReqMsg）');
    } finally { h.finish(); }
});
test('切页签：完整阵容切到空阵型或半成品，不发送选中请求', async () => {
    for (const target of [fullDeck(0), fullDeck(7)]) {
        for (const dirty of [false, true]) {
            const h = boardFixture();
            try {
                h.repository.loadBoard = async () => fullBoardData(fullDeck(dirty ? 7 : 8), target);
                await h.controller.start();
                if (dirty) h.intent('toggle', { cardId: '8' });
                h.intent('preset', { index: 1 });
                if (dirty) h.pending.resolve({ kind: 'success', formation: {
                    formationId: 1, heroIds: fullDeck().map(card => Number(card.id)), selected: true,
                } });
                await tick(); await tick();
                assert.equal(h.states[h.states.length - 1].selectedPreset, 1);
                assert.equal(h.states[h.states.length - 1].cards.length, target.length);
                assert.equal(h.submissions.length, dirty ? 1 : 0, '原阵型的自动保存不受影响');
                assert.deepEqual(h.selects, [], '目标阵型不完整，不能设为服务端出战阵型');
                assert.deepEqual(h.events.map(event => event.formationId), dirty ? [1] : []);
            } finally { h.finish(); }
        }
    }
});
test('切页签：阵容不满编或品级不全时只做本地切换，不发包', async () => {
    const cases: readonly { deck: readonly ZCDeckCard[]; edits: string[] }[] = [
        // 满编差一张：加一张才满，但这里只在 7 张的基础上再删一张，始终保持不满编
        { deck: fullDeck(7), edits: ['1'] },
        // 满编但清一色 gold：删一张再加回来，仍是 8 张、仍然只有一个品级
        { deck: fullDeck(8).map((entry) => ({ ...entry, rarity: 'gold' as const })), edits: ['1', '1'] },
    ];
    for (const entry of cases) {
        const h = boardFixture(); try {
            h.repository.loadBoard = async () => fullBoardData(entry.deck);
            await h.controller.start();
            for (const cardId of entry.edits) h.intent('toggle', { cardId });
            assert.equal(h.states[h.states.length - 1].dirty, true);
            h.intent('preset', { index: 1 });
            await tick();
            assert.equal(h.submissions.length, 0, '不完整的阵容没有「最新阵容」可提交');
            assert.equal(h.states[h.states.length - 1].selectedPreset, 1);
            assert.deepEqual(h.selects, [], '不满编/品级不全时一个包都不发');
            assert.deepEqual(h.events, [], '没同步就不该广播 DeckSaved');
        } finally { h.finish(); }
    }
});
test('切页签：完整阵容但没改动时只同步选中，不重复提交卡组', async () => {
    const h = boardFixture(); try {
        h.repository.loadBoard = async () => fullBoardData(fullDeck(8));
        await h.controller.start();
        h.intent('preset', { index: 1 });
        await tick();
        assert.equal(h.submissions.length, 0, '没改动不用再存一遍');
        assert.deepEqual(h.selects, [{ formationId: 2 }]);
        assert.equal(h.states[h.states.length - 1].selectedPreset, 1);
        assert.deepEqual(h.events, [{ formationId: 2, heroIds: [1, 2, 3, 4, 5, 6, 7, 8] }]);
    } finally { h.finish(); }
});
test('切页签：自动提交失败时停在原方案，草稿与 dirty 都保留', async () => {
    const h = boardFixture(); try {
        h.repository.loadBoard = async () => fullBoardData(fullDeck(7));
        await h.controller.start();
        h.intent('toggle', { cardId: '8' });
        h.intent('preset', { index: 1 });
        h.pending.resolve({ kind: 'failed' }); await tick(); await tick();
        assert.equal(h.states[h.states.length - 1].selectedPreset, 0, '保存失败不能把页签切走');
        assert.equal(h.states[h.states.length - 1].cards.length, 8);
        assert.equal(h.states[h.states.length - 1].dirty, true);
        assert.deepEqual(h.tips, ['保存失败']);
        assert.deepEqual(h.selects, [], '没切过去就不该动服务端的出战阵型');
    } finally { h.finish(); }
});
test('failed board save preserves dirty draft and restores submission gate', async () => {
    const h = boardFixture(); try {
        await h.controller.start(); h.intent('toggle', { cardId: '2' }); h.intent('save'); h.intent('save');
        assert.equal(h.submissions.length, 1); h.pending.resolve({ kind: 'failed' }); await tick();
        assert.equal(h.states[h.states.length - 1].dirty, true); assert.equal(h.states[h.states.length - 1].canSave, true);
        assert.equal(h.events.length, 0); assert.equal(h.tips.length, 1);
    } finally { h.finish(); }
});
test('successful save publishes submitted snapshot; edits or switching while saving cannot be marked clean', async () => {
    for (const change of ['none', 'toggle', 'preset']) {
        const h = boardFixture(); try {
            await h.controller.start(); h.intent('toggle', { cardId: '2' }); h.intent('save');
            if (change === 'toggle') h.intent('toggle', { cardId: '3' });
            if (change === 'preset') h.intent('preset', { index: 1 });
            h.pending.resolve({ kind: 'success', formation: { formationId: 1, heroIds: [1, 2], selected: true } }); await tick();
            //  这组卡只有 1~2 张，不满足「满 8 张」，切页签不发任何包（含选中），所以只有保存那一条。
            assert.deepEqual(h.events, [{ formationId: 1, heroIds: [1, 2] }]);
            assert.equal(h.states[h.states.length - 1].dirty, change !== 'none');
        } finally { h.finish(); }
    }
});
test('board close during load or save removes caller and rejects late view/result updates', async () => {
    for (const stage of ['load', 'save']) {
        const h = boardFixture(), load = deferred<LineupBoardData>();
        if (stage === 'load') h.repository.loadBoard = () => load.promise;
        const ready = h.controller.start();
        if (stage === 'save') { await ready; h.intent('save'); }
        const count = h.states.length; h.controller.dispose(); h.controller.dispose();
        load.resolve(boardData()); h.pending.resolve({ kind: 'success', formation: { formationId: 1, heroIds: [1], selected: true } });
        await ready; await tick(); assert.equal(h.states.length, count); assert.equal(h.events.length, 0); assert.equal(h.removed, 1); h.finish();
    }
});

test('upgrade and formation results refresh the live lineup controller; disposed lineup stops subscribing', async () => {
    let loads = 0;
    const formationRefreshes: boolean[] = [];
    const lineup = new CardLineupController(createControllerContext(), {
        owner: {},
        autoLoadDecks: true,
        fallbackLevel: 1,
        repository: { loadArtConfig: async () => cardArtConfig, loadLineupSnapshot: () => null, loadLineup: async (_autoLoad, refreshFormations) => {
            loads++;
            formationRefreshes.push(refreshFormations);
            return { art: cardArtConfig, deck: [], catalog: [], heroLevels: new Map(), heroLevelCaps: new Map(), heroListKnown: true,
                formationsKnown: true, bonuses: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                    moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1 } };
        } },
        failed(error) { throw error; },
        popups: {
            openEditor() {},
            openUpgrade() {}
        },
    });
    const upgrade = upgradeFixture(), board = boardFixture();
    try {
        lineup.start(); await tick(); assert.equal(loads, 1);
        await upgrade.controller.start(); upgrade.intent();
        upgrade.pending.resolve({ kind: 'success', heroId: 1, level: 1 }); await tick();
        assert.equal(loads, 2);
        await board.controller.start(); board.intent('save');
        board.pending.resolve({ kind: 'success', formation: { formationId: 1, heroIds: [1], selected: true } }); await tick();
        assert.equal(loads, 3);
        assert.deepEqual(formationRefreshes, [true, false, true], '升级复用阵型，首屏和保存布阵仍刷新阵型');
        lineup.dispose(); EventMgr.instance.emit(CardLineupEvent.DeckSaved, { formationId: 1, heroIds: [] });
        await tick(); assert.equal(loads, 3);
    } finally { lineup.dispose(); upgrade.finish(); board.finish(); }
});

test('upgrade closed during initial cost load cannot publish the late cost result', async () => {
    const h = upgradeFixture(), cost = deferred<ReturnType<typeof upgradeStatus>>();
    h.repository.loadUpgradeStatus = () => cost.promise;
    const ready = h.controller.start();
    const count = h.states.length;
    h.controller.dispose(); cost.resolve(upgradeStatus()); await ready;
    assert.equal(h.states.length, count); assert.equal(h.removed, 1); h.finish();
});

test('upgrade model reuses unlock/material/max-level rules without depending on renumbered live-table IDs', () => {
    const table = buildCardLevelUpTable([1, 2].map(level => ({ id: 1, level, costCardID: 10, costCardNum: level * 2,
        costArmyLevelID: 20, costGeneralLevelID: 30, costArmyLevelNum: level * 5 })));
    const model = new CardUpgradeModel({ card: card('1'), cardId: '1', level: 0 });
    assert.equal(upgradeButtonText(model.snapshot.level, false), '解锁');
    model.setStatus(evaluateUpgrade(table, '1', 0, id => id === '10' ? 2 : 2));
    assert.equal(model.canSubmit, false, '解锁也要足够经验');
    model.setStatus(evaluateUpgrade(table, '1', 0, id => id === '10' ? 2 : 3));
    assert.equal(model.canSubmit, true, '通用与兵种经验合计满足');
    model.setPhase('submitting'); assert.equal(model.canSubmit, false);
    model.confirm(1); assert.equal(upgradeButtonText(model.snapshot.level, false), '升级');
    model.setStatus(evaluateUpgrade(table, '1', 1, id => id === '10' ? 3 : 99));
    assert.equal(model.canSubmit, false, '经验不能代替缺少的卡牌');
    model.confirm(2); model.setStatus(evaluateUpgrade(table, '1', 2, () => 99));
    assert.equal(model.snapshot.status?.maxed, true); assert.equal(model.canSubmit, false);
});

test('saving a different preset retains the previously edited draft as unsaved', async () => {
    const h = boardFixture();
    try {
        await h.controller.start(); h.intent('toggle', { cardId: '2' });
        h.intent('preset', { index: 1 }); h.intent('save');
        h.pending.resolve({ kind: 'success', formation: { formationId: 2, heroIds: [2], selected: true } }); await tick();
        assert.equal(h.states[h.states.length - 1].dirty, true);
        h.intent('preset', { index: 0 });
        assert.deepEqual(h.states[h.states.length - 1].cards.map((entry: ZCDeckCard) => entry.id), ['1', '2']);
    } finally { h.finish(); }
});

test('closeAfterSave only closes an unchanged submitted draft', async () => {
    for (const edit of [false, true]) {
        const h = boardFixture(true);
        try {
            await h.controller.start(); h.intent('save');
            if (edit) h.intent('toggle', { cardId: '2' });
            h.pending.resolve({ kind: 'success', formation: { formationId: 1, heroIds: [1], selected: true } }); await tick();
            assert.equal(h.closed, edit ? 0 : 1);
        } finally { h.finish(); }
    }
});

test('thrown save failure restores the submission gate and retains the draft', async () => {
    const h = boardFixture();
    try {
        h.repository.saveFormation = async () => { throw new Error('request failed'); };
        await h.controller.start(); h.intent('toggle', { cardId: '2' }); h.intent('save'); await tick();
        assert.equal(h.states[h.states.length - 1].dirty, true);
        assert.equal(h.states[h.states.length - 1].canSave, true);
        assert.equal(h.events.length, 0); assert.equal(h.tips.length, 1);
    } finally { h.finish(); }
});


test('详情切卡加载期间拒绝重复切换与升级，关闭后迟到的卡库不打开弹窗', async () => {
    const h = upgradeFixture();
    const pending = deferred<{ catalog: readonly ZCDeckCard[]; heroLevels: Map<string, number>; heroListKnown: boolean }>();
    let loads = 0;
    h.repository.loadDetailNavigation = () => { loads++; return pending.promise; };
    try {
        await h.controller.start();
        h.intent('next'); h.intent('previous'); h.intent('submit');
        assert.equal(loads, 1);
        assert.equal(h.calls, 0);
        h.controller.dispose();
        pending.resolve({ catalog: [card('1'), card('2')], heroLevels: new Map(), heroListKnown: true });
        await tick();
        assert.equal(h.states.at(-1).cardId, '1');
    } finally { h.finish(); }
});

test('切卡失败保留当前详情并允许重试，不依赖首帧阵容快照', async () => {
    const h = upgradeFixture();
    const failure = new Error('catalog unavailable');
    h.repository.loadDetailNavigation = async () => { throw failure; };
    try {
        await h.controller.start(); h.intent('next'); await tick();
        assert.deepEqual(h.failures, [failure]);
        h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')], heroLevels: new Map([['2', 9]]), heroListKnown: true });
        h.intent('next'); await tick();
        assert.equal(h.states.at(-1).cardId, '2');
        assert.equal(h.states.at(-1).level, 9);
    } finally { h.finish(); }
});

test('切卡数据全部就绪后原位提交，等待期间不闪空且关闭后不发布', async () => {
    for (const close of [false, true]) {
        const h = upgradeFixture();
        const status = deferred<ReturnType<typeof upgradeStatus>>();
        const detail = deferred<Awaited<ReturnType<typeof h.repository.loadCardDetail>>>();
        try {
            await h.controller.start();
            h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')],
                heroLevels: new Map([['2', 7]]), heroListKnown: true });
            h.repository.loadUpgradeStatus = () => status.promise;
            h.repository.loadCardDetail = () => detail.promise;
            const count = h.states.length;
            h.intent('next'); await tick();
            assert.equal(h.states.length, count, '备数据期间保留当前完整详情');
            status.resolve({ ...upgradeStatus(7), cardId: '2' }); await tick();
            assert.equal(h.states.length, count, '只到升级状态时不能提前切换标题和卡面');
            if (close) h.controller.dispose();
            detail.resolve({ stats: [], powerText: 'card-2', critDamageGain: 0, chain: [{ skillId: 100101, name: '技能', unlockLevel: 3, unlocked: false, empty: false }], milestones: [] }); await tick();
            assert.equal(h.states.length, count + (close ? 0 : 1));
            if (!close) {
                assert.equal(h.states.at(-1).cardId, '2');
                assert.equal(h.states.at(-1).status.cardId, '2');
                assert.equal(h.states.at(-1).detail.powerText, 'card-2');
                assert.equal(h.states.at(-1).phase, 'ready');
                h.intent('skills');
                assert.deepEqual(h.skills, [{ heroId: 2, skillId: 100101 }]);
            }
        } finally { h.finish(); }
    }
});

test('下一张卡升级状态加载失败时保留旧详情并允许重试', async () => {
    const h = upgradeFixture();
    try {
        await h.controller.start();
        h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')],
            heroLevels: new Map(), heroListKnown: true });
        const failure = new Error('status unavailable');
        h.repository.loadUpgradeStatus = async () => { throw failure; };
        const count = h.states.length;
        h.intent('next'); await tick();
        assert.equal(h.states.length, count);
        assert.deepEqual(h.failures, [failure]);
        h.repository.loadUpgradeStatus = async () => ({ ...upgradeStatus(), cardId: '2' });
        h.intent('next'); await tick();
        assert.equal(h.states.at(-1).cardId, '2');
    } finally { h.finish(); }
});

test('原位切卡后旧卡迟到详情不能覆盖新卡，详情失败仍保留新卡升级功能', async () => {
    const h = upgradeFixture();
    const oldDetail = deferred<Awaited<ReturnType<typeof h.repository.loadCardDetail>>>();
    h.repository.loadCardDetail = async (id?: string) => {
        if (id === '1') return oldDetail.promise;
        throw new Error('detail unavailable');
    };
    h.repository.loadDetailNavigation = async () => ({ catalog: [card('1'), card('2')],
        heroLevels: new Map([['2', 3]]), heroListKnown: true });
    try {
        const opening = h.controller.start(); await tick();
        h.intent('next'); await tick();
        assert.equal(h.states.at(-1).cardId, '2');
        assert.equal(h.states.at(-1).level, 3);
        assert.equal(h.states.at(-1).phase, 'ready');
        assert.equal(h.states.at(-1).detail, null);
        const count = h.states.length;
        oldDetail.resolve({ stats: [], powerText: 'old-card', critDamageGain: 0, chain: [], milestones: [] });
        await opening;
        assert.equal(h.states.length, count);
    } finally { h.finish(); }
});
