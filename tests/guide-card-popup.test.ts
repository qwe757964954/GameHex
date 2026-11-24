import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CardUpgradeController } from '../assets/script/app/card/CardUpgradeController';
import { CardUpgradeModel } from '../assets/script/app/card/CardUpgradeModel';
import { CardPopupEvent } from '../assets/script/app/card/CardPopupEvents';
import { GuideEvent, reportGuideComplete } from '../assets/script/app/guide/application/GuideEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import { cardArtConfig } from './helpers/card-art-config';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ICardUpgradeViewState } from '../assets/script/app/card/CardPresentations';
import type { IPopupComposition } from '../assets/script/framework/ui/PopupCompositionHost';

function fixture() {
    const events: string[] = [];
    let resolveStatus!: () => void;
    const pending = new Promise<void>(resolve => { resolveStatus = resolve; });
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
    };
    const imports: Record<string, object> = {
        CardUpgradePage: { CardUpgradePage }, CardUpgradeModel: { CardUpgradeModel }, CardUpgradeController: { CardUpgradeController },
        CardRepository: { cardRepository: repository }, GuideEvents: { reportGuideComplete },
        LineupBoardPage: { LineupBoardPage: class {} }, CardSkillPage: { CardSkillPage: class {} },
        GameNet: { GameNet: { instance: { removeCaller() {} } } },
    };
    const exports: { createCardPopupComposition?: (context: object, view: object) => IPopupComposition } = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bootstrap/card/CardPopupComposition.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require: (path: string) => imports[path.split('/').pop()] ?? {} });
    const composition = exports.createCardPopupComposition(createControllerContext(), view);
    EventMgr.instance.on(GuideEvent.Complete, event => {
        if (event.cond === 'cardSelected') {
            assert.equal(view.states.at(-1).phase, 'ready');
            assert.equal(event.arg, view.states.at(-1).cardId);
            events.push(event.arg);
        }
    }, view);
    return { view, events, composition, resolveStatus: () => resolveStatus(),
        open: () => composition.open({ card: unit('68012'), cardId: '68012', level: 1 }),
        next: () => EventMgr.instance.emit(CardPopupEvent.UpgradeIntent, { kind: 'next' }, view),
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
