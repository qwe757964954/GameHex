import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CardUpgradeController } from '../assets/script/app/card/CardUpgradeController';
import { CardUpgradeModel } from '../assets/script/app/card/CardUpgradeModel';
import { LineupBoardController } from '../assets/script/app/card/LineupBoardController';
import { LineupBoardModel } from '../assets/script/app/card/LineupBoardModel';
import { CardSkillController } from '../assets/script/app/card/CardSkillController';
import { buildArmySkillTable } from '../assets/script/app/card/CardSkillList';
import {
    CardPopupEvent,
    type CardSkillOutput,
    type CardUpgradeOutput,
    type LineupBoardOutput,
} from '../assets/script/app/card/CardPopupEvents';
import { GuideEvent, reportGuideComplete } from '../assets/script/app/guide/application/GuideEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import { cardArtConfig } from './helpers/card-art-config';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type {
    CardSkillListPresentation,
    ICardUpgradeViewState,
    LineupBoardPresentation,
} from '../assets/script/app/card/CardPresentations';
import { PopupSession, type IPopupComposition } from '../assets/script/framework/ui/PopupCompositionHost';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import type { UpgradeHeroResult } from '../assets/script/app/card/CardRepository';

function loadPopupComposition(
    imports: Record<string, object>,
    logger: Pick<Console, 'log' | 'warn' | 'error'> = console,
) {
    const resolvedImports: Record<string, object> = {
        PopupCompositionHost: { PopupSession },
        ...imports,
    };
    const exports: { createCardPopupComposition?: (context: object, view: object) => IPopupComposition | null } = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/card/CardPopupComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console: logger, require: (path: string) => resolvedImports[path.split('/').pop()] ?? {} });
    return exports.createCardPopupComposition;
}

function fixture() {
    const events: string[] = [];
    const loading: (string | null)[] = [];
    const removedCallers: object[] = [];
    let resolveStatus!: () => void;
    const pending = new Promise<void>(resolve => { resolveStatus = resolve; });
    let finishUpgrade!: (result: UpgradeHeroResult) => void;
    const upgrading = new Promise<UpgradeHeroResult>(resolve => { finishUpgrade = resolve; });
    let upgradeCaller: object | undefined;
    const unit = (id: string) => ({ id, name: id }) as ZCDeckCard;
    class CardUpgradePage {
        states: ICardUpgradeViewState[] = [];
        render(state: ICardUpgradeViewState) { this.states.push(state); }
    }
    const view = new CardUpgradePage();
    const repository = {
        loadMaterialIcon: async () => null,
        loadDetailArt: async () => ({ hero: null, diamond: null, classTag: null }),
        loadArtConfig: async () => cardArtConfig,
        loadUpgradeStatus: async (id: string, level: number) => {
            await pending;
            return { cardId: id, level, targetLevel: level + 1, canUpgrade: true,
                configured: true, maxLevel: 50, maxed: false, blockedReason: '', requirements: [],
                generalExpItemId: '', armyExpItemId: '', generalExpOwned: 0, armyExpOwned: 0 };
        },
        loadCardDetail: async () => null,
        loadDetailNavigation: async () => ({ catalog: [unit('68012'), unit('68001')], heroLevels: new Map(), heroListKnown: true }),
        upgradeHero: (_heroId: number, caller: object) => {
            upgradeCaller = caller;
            return upgrading;
        },
    };
    const createComposition = loadPopupComposition({
        CardUpgradePage: { CardUpgradePage }, CardUpgradeModel: { CardUpgradeModel }, CardUpgradeController: { CardUpgradeController },
        CardRepository: { cardRepository: repository }, GuideEvents: { reportGuideComplete },
        CardPopupEvents: { CardPopupEvent }, EventMgr: { EventMgr }, CardLineupTexts: { CARD_LINEUP_TEXTS },
        LineupBoardPage: { LineupBoardPage: class {} }, CardSkillPage: { CardSkillPage: class {} },
        CardUpgradedArt: {
            loadCardUpgradedArt: async () => ({ chrome: { background: null, frame: null }, classIcon: null, heroPrefab: null }),
        },
        LoadingPopup: { LoadingPopup: { show: (text: string) => loading.push(text), hide: () => loading.push(null) } },
    });
    const context = createControllerContext({
        callbackOwners: {
            addCallerCleanup: () => () => {},
            removeCallerListener: caller => { removedCallers.push(caller); },
        },
    });
    const composition = createComposition(context, view);
    EventMgr.instance.on(GuideEvent.Complete, event => {
        if (event.cond === 'cardSelected') {
            assert.equal(view.states.at(-1).phase, 'ready');
            assert.equal(event.arg, view.states.at(-1).cardId);
            events.push(event.arg);
        }
    }, view);
    return { view, events, composition, loading, removedCallers, resolveStatus: () => resolveStatus(), finishUpgrade,
        get upgradeCaller() { return upgradeCaller; },
        open: () => composition.open({ card: unit('68012'), cardId: '68012', level: 1 }),
        next: () => EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { kind: 'next' }),
        submit: () => EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { kind: 'submit' }),
        finish() { composition.dispose(); EventMgr.instance.offTarget(view); },
    };
}

test('选卡只上报详情实际就绪的卡牌，快速连点与异步详情刷新不重复上报', async () => {
    const f = fixture();
    try {
        const opening = f.open();
        f.next(); f.next();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(f.events, []);
        f.resolveStatus(); await opening;
        assert.deepEqual(f.events, ['68012']);
        f.next(); await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(f.events, ['68012', '68001']);
    } finally { f.finish(); }
});

test('升级输出按会话隔离，关闭时释放 Loading 和请求 caller', async () => {
    const f = fixture();
    try {
        f.resolveStatus();
        await f.open();
        const output: CardUpgradeOutput = { kind: 'loading', level: 0 };
        EventMgr.instance.emit(CardPopupEvent.UpgradeOutput, output, {});
        assert.deepEqual(f.loading, []);
        f.submit();
        assert.deepEqual(f.loading, [CARD_LINEUP_TEXTS.upgradeSending]);
        assert.ok(f.upgradeCaller);
        f.composition.dispose();
        f.composition.dispose();
        f.finishUpgrade({ kind: 'success', heroId: 68012, level: 2 });
        await new Promise(resolve => setImmediate(resolve));
        EventMgr.instance.emit(CardPopupEvent.UpgradeOutput, output, f.upgradeCaller);
        assert.deepEqual(f.loading, [CARD_LINEUP_TEXTS.upgradeSending, null]);
        assert.deepEqual(f.removedCallers, [f.upgradeCaller]);
    } finally { f.finish(); }
});

test('详情加载期间退出，迟到的数据不能推进引导', async () => {
    const f = fixture();
    try {
        const opening = f.open();
        await new Promise(resolve => setImmediate(resolve));
        f.composition.dispose();
        f.resolveStatus(); await opening;
        assert.deepEqual(f.events, []);
    } finally { f.finish(); }
});

test('布阵与技能独立会话按各自输出事件驱动视图并清理资源', async () => {
    const toasts: string[] = [];
    const errors: unknown[][] = [];
    const removedCallers: object[] = [];
    let saveCaller: object | undefined;
    let skillCaller: object | undefined;
    class LineupBoardPage {
        presetBar = { children: [{}, {}] };
        defaultPreset = 0;
        autoLoadDecks = true;
        closeAfterSave = true;
        states: LineupBoardPresentation[] = [];
        closes = 0;
        async render(state: LineupBoardPresentation) {
            this.states.push(state);
            if (this.states.length === 1) {
                throw new Error('render art failed');
            }
        }
        close() { this.closes += 1; }
    }
    class CardSkillPage {
        renders: Array<CardSkillListPresentation | null> = [];
        closes = 0;
        render(state: CardSkillListPresentation | null) { this.renders.push(state); }
        close() { this.closes += 1; }
    }
    const repository = {
        loadBoard: async () => ({
            art: cardArtConfig,
            deck: [{ id: '1', name: '1' } as ZCDeckCard],
            pool: [],
            heroLevels: new Map(),
            heroLevelCaps: new Map(),
            formations: [{ formationId: 1, heroIds: [1], selected: true }],
        }),
        saveFormation: async (formationId: number, heroIds: number[], caller: object) => {
            saveCaller = caller;
            return { kind: 'success' as const, formation: { formationId, heroIds, selected: true } };
        },
        selectFormation: async () => true,
        loadSkillList: async () => ({
            table: buildArmySkillTable([
                { id: 100101, skilllevel: 1, unlockarmylevel: 0 },
                { id: 100101, skilllevel: 2, unlockarmylevel: 0 },
            ]),
            skillIds: [100101],
            levels: [{ skillId: 100101, level: 1 }],
            heroLevel: 20,
        }),
        upgradeHeroSkill: async (_heroId: number, _skillId: number, caller: object) => {
            skillCaller = caller;
            return { kind: 'offline' as const };
        },
    };
    const createComposition = loadPopupComposition({
        CardUpgradePage: { CardUpgradePage: class {} },
        CardUpgradeModel: { CardUpgradeModel },
        CardUpgradeController: { CardUpgradeController },
        LineupBoardPage: { LineupBoardPage },
        LineupBoardModel: { LineupBoardModel },
        LineupBoardController: { LineupBoardController },
        CardSkillPage: { CardSkillPage },
        CardSkillController: { CardSkillController },
        CardRepository: { cardRepository: repository },
        GuideEvents: { reportGuideComplete },
        CardPopupEvents: { CardPopupEvent },
        EventMgr: { EventMgr },
        CardLineupTexts: { CARD_LINEUP_TEXTS },
        CardUpgradedPage: { CardUpgradedPage: { open: async () => {} } },
        CardUpgradedArt: { loadCardUpgradedArt: async () => ({}) },
        LoadingPopup: { LoadingPopup: { show() {}, hide() {} } },
        Toast: { Toast: { show: (text: string) => { toasts.push(text); } } },
    }, {
        log() {},
        warn() {},
        error: (...args: unknown[]) => { errors.push(args); },
    });
    const context = createControllerContext({
        callbackOwners: {
            addCallerCleanup: () => () => {},
            removeCallerListener: caller => { removedCallers.push(caller); },
        },
    });
    assert.equal(createComposition(context, {}), null);

    const boardView = new LineupBoardPage();
    const boardSession = createComposition(context, boardView);
    const skillView = new CardSkillPage();
    const skillSession = createComposition(context, skillView);
    assert.ok(boardSession && skillSession);
    try {
        await boardSession.open(undefined);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(boardView.states.length, 1);
        assert.equal(errors.length, 1, '异步 render 异常由会话收口，不产生未处理拒绝');

        const foreignBoardTip: LineupBoardOutput = { kind: 'tip', text: 'foreign-board' };
        EventMgr.instance.emit(CardPopupEvent.BoardOutput, foreignBoardTip, {});
        assert.deepEqual(toasts, []);

        EventMgr.instance.emit(CardPopupEvent.BoardIntent, { kind: 'save' });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(toasts, [CARD_LINEUP_TEXTS.boardSaved]);
        assert.equal(boardView.closes, 1);
        boardSession.dispose();
        boardSession.dispose();
        assert.ok(saveCaller);
        assert.ok(removedCallers.includes(saveCaller));

        toasts.length = 0;
        await skillSession.open({ heroId: 68001, skillId: 100101 });
        assert.equal(skillView.renders.length, 2);
        assert.equal(skillView.renders[0], null);
        assert.ok(skillView.renders[1]);

        const foreignSkillClose: CardSkillOutput = { kind: 'close' };
        EventMgr.instance.emit(CardPopupEvent.SkillOutput, foreignSkillClose, {});
        assert.equal(skillView.closes, 0);

        EventMgr.instance.emit(CardPopupEvent.SkillIntent);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(toasts, [CARD_LINEUP_TEXTS.skillUpgradeOffline]);
        skillSession.dispose();
        assert.ok(skillCaller);
        assert.ok(removedCallers.includes(skillCaller));
        assert.equal(removedCallers.length, 2);

        const renderCount = skillView.renders.length;
        const foreignSkillRender: CardSkillOutput = { kind: 'render', state: null };
        EventMgr.instance.emit(CardPopupEvent.SkillOutput, foreignSkillRender, skillCaller);
        assert.equal(skillView.renders.length, renderCount);
    } finally {
        boardSession.dispose();
        skillSession.dispose();
    }
});
