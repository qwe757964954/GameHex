import assert from 'node:assert/strict';
import test from 'node:test';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import { loadTsModule } from './helpers/cc-sandbox';
import * as upgrade from '../assets/script/app/card/CardUpgradeCost';
import * as layout from '../assets/script/app/territory/model/TerritoryChestOpenLayout';

const COORDINATOR_TS = 'assets/script/app/bootstrap/main/MainChestRewardCoordinator.ts';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function createCoordinatorFixture() {
    const events: Array<{ name: string; payload: unknown }> = [];
    const chestPopups: Array<{ userData: unknown; closeCalls: number }> = [];
    const heroOpens: Array<{
        userData: { heroId: string; progressCurrent?: number; progressMax?: number };
        onClose: () => void;
        closeCalls: number;
    }> = [];
    const rewardCalls: unknown[][] = [];
    let heroLevelLoads = 0;
    let counterCalls = 0;

    let openChestGate: (() => void) | null = null;
    const deferChestOpen = () => new Promise<void>(resolve => {
        openChestGate = resolve;
    });
    let chestGatePromise: Promise<void> | null = null;

    const TerritoryUiEvent = {
        ChestRevealed: 'territory:chest-revealed',
        ChestRewardsReady: 'territory:chest-rewards-ready',
        ChestPresentation: 'territory:chest-presentation',
        Disposed: 'territory:view-disposed',
    } as const;
    const CHEST_EVENTS = { REWARDS: 'chest:rewards' } as const;

    const modules: Record<string, unknown> = {
        '/ControllerBase': { ControllerBase },
        '/ResourceScope': { ResourceScope },
        '/EventMgr': {
            EventMgr: {
                instance: {
                    emit: (name: string, payload?: unknown) => {
                        events.push({ name, payload });
                        EventMgr.instance.emit(name, payload);
                    },
                    on: EventMgr.instance.on.bind(EventMgr.instance),
                    offTarget: EventMgr.instance.offTarget.bind(EventMgr.instance),
                },
            },
        },
        '/FW': { FW: { ShowReward: (goods: unknown[]) => { rewardCalls.push(goods); } } },
        '/AudioMgr': { AudioMgr: { instance: { playSound: async () => true } } },
        '/ResConst': { GAME_AUDIO: { goldFragment: 'goldFragment' } },
        '/ChestEvents': { CHEST_EVENTS },
        '/TerritoryEvents': { TerritoryUiEvent },
        '/TerritoryChestOpenPage': {
            TerritoryChestOpenPage: {
                open: async (params: { scope?: ResourceScope; userData: unknown }) => {
                    if (params.scope?.disposed) return null;
                    const record = { userData: params.userData, closeCalls: 0 };
                    chestPopups.push(record);
                    if (chestGatePromise) await chestGatePromise;
                    const popup = {
                        close: () => {
                            record.closeCalls++;
                        },
                    };
                    if (params.scope?.disposed) {
                        popup.close();
                        return null;
                    }
                    params.scope?.defer(() => popup.close());
                    return popup;
                },
            },
        },
        '/TerritoryChestOpenLayout': layout,
        '/HeroObtainPage': {
            HeroObtainPage: {
                open: async (params: { scope?: ResourceScope; userData: any; onClose: () => void }) => {
                    if (params.scope?.disposed) return null;
                    let closed = false;
                    let detach = () => {};
                    const origOnClose = params.onClose;
                    const record = {
                        ...params,
                        closeCalls: 0,
                        onClose: () => {
                            if (closed) return;
                            closed = true;
                            detach();
                            origOnClose();
                        },
                    };
                    heroOpens.push(record);
                    const popup = {
                        close: () => {
                            if (closed) return;
                            closed = true;
                            detach();
                            record.closeCalls++;
                            origOnClose();
                        },
                    };
                    detach = params.scope?.defer(() => popup.close()) ?? (() => {});
                    return popup;
                },
            },
        },
        '/CardLineupDecks': {
            loadCardLevelUpRows: async () => [
                {
                    id: '68001', name: '英雄A', level: 1, costCardID: '18001', costCardNum: 10,
                    costArmyLevelID: '16001', costGeneralLevelID: '16000', costArmyLevelNum: 0,
                },
                {
                    id: '68002', name: '英雄B', level: 1, costCardID: '18002', costCardNum: 10,
                    costArmyLevelID: '16001', costGeneralLevelID: '16000', costArmyLevelNum: 0,
                },
            ],
            loadPvpCardRarities: async () => new Map([['68001', 4], ['68002', 4]]),
        },
        '/CardUpgradeCost': upgrade,
        '/ItemBag': {
            createItemCounter: () => {
                counterCalls++;
                return () => 5;
            },
        },
        '/CardRepository': {
            cardRepository: {
                loadHeroLevelsOnly: async () => {
                    heroLevelLoads++;
                    return new Map([['68001', 0], ['68002', 0]]);
                },
            },
        },
    };

    const loaded = loadTsModule<{
        MainChestRewardCoordinator: new (context: unknown) => { dispose(): void; isDisposed: boolean };
    }>(COORDINATOR_TS, { modules });
    assert.deepEqual(loaded.unresolved, []);
    const coordinator = new loaded.exports.MainChestRewardCoordinator(createControllerContext());
    return {
        coordinator,
        events,
        chestPopups,
        heroOpens,
        rewardCalls,
        TerritoryUiEvent,
        CHEST_EVENTS,
        setChestGate: () => { chestGatePromise = deferChestOpen(); },
        releaseChestGate: () => {
            openChestGate?.();
            openChestGate = null;
            chestGatePromise = null;
        },
        counts: () => ({ heroLevelLoads, counterCalls }),
    };
}

test('非领地页签或开箱页提前关闭时，宝箱奖励与橙卡特写链路不丢失且不挂起', async () => {
    const f = createCoordinatorFixture();
    try {
        f.setChestGate();
        const goods = [{ resId: 18001, number: 1 }];
        EventMgr.instance.emit(f.CHEST_EVENTS.REWARDS, { goods });
        await tick();
        assert.equal(f.chestPopups.length, 1);

        // 即使开箱页未持有句柄或已关闭，ChestRevealed 仍应按顺序展示橙卡英雄特写。
        EventMgr.instance.emit(f.TerritoryUiEvent.ChestRevealed, {
            entries: [{ resId: 18001, number: 1 }],
        });
        await tick();
        assert.equal(f.heroOpens.length, 1);
        assert.equal(f.heroOpens[0].userData.heroId, '68001');

        // 并发再次触发 ChestRevealed：第二批必须等第一批关闭后再打开，绝不撞单实例。
        EventMgr.instance.emit(f.TerritoryUiEvent.ChestRevealed, {
            entries: [{ resId: 18002, number: 1 }],
        });
        await tick();
        assert.equal(f.heroOpens.length, 1);

        f.heroOpens[0].onClose();
        await tick();
        assert.equal(f.heroOpens.length, 2);
        assert.equal(f.heroOpens[1].userData.heroId, '68002');
        f.heroOpens[1].onClose();
        await tick();

        // 在异步打开 TerritoryChestOpenPage 完成前注销协调器，迟到的开箱页会被关闭。
        f.coordinator.dispose();
        f.releaseChestGate();
        await tick();
        assert.equal(f.chestPopups[0].closeCalls, 1);
    } finally {
        f.coordinator.dispose();
    }
});

test('无橙卡碎片时跳过阵容等级查询与背包计数；领地页离开时清空演出窗口', async () => {
    const f = createCoordinatorFixture();
    try {
        EventMgr.instance.emit(f.TerritoryUiEvent.ChestRevealed, {
            entries: [{ resId: 7, number: 100 }],
        });
        await tick();
        assert.deepEqual(f.counts(), { heroLevelLoads: 0, counterCalls: 0 });
        assert.equal(f.heroOpens.length, 0);

        // 触发领地整箱奖励链并中途发出 TerritoryUiEvent.Disposed（切离领地页签）
        EventMgr.instance.emit(f.TerritoryUiEvent.ChestRewardsReady, {
            rewards: [{ resId: 18001, number: 1 }, { resId: 7, number: 50 }],
        });
        await tick();
        assert.equal(f.heroOpens.length, 1);
        EventMgr.instance.emit(f.TerritoryUiEvent.Disposed);
        f.heroOpens[0].onClose();
        await tick();

        assert.equal(f.rewardCalls.length, 0, '离开领地页签后不再弹出统一奖励窗');
        assert.deepEqual(
            f.events
                .filter(one => one.name === f.TerritoryUiEvent.ChestPresentation)
                .map(one => ({ name: one.name, playing: (one.payload as { playing?: boolean })?.playing })),
            [{ name: f.TerritoryUiEvent.ChestPresentation, playing: false }],
        );
    } finally {
        f.coordinator.dispose();
    }
});
