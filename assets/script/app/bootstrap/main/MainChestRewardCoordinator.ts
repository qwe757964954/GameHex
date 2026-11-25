import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { FW } from '../../../framework/FW';
import { AudioMgr } from '../../../framework/audio/AudioMgr';
import { GAME_AUDIO } from '../../ResConst';
import { CHEST_EVENTS } from '../../main/ChestEvents';
import { TerritoryUiEvent } from '../../territory/application/TerritoryEvents';
import { TerritoryChestOpenPage } from '../../territory/view/TerritoryChestOpenPage';
import { chestLegendHeroesOf } from '../../territory/model/TerritoryChestOpenLayout';
import { HeroObtainPage } from '../../card/view/HeroObtainPage';
import { loadCardLevelUpRows, loadPvpCardRarities } from '../../card/CardLineupDecks';
import { createItemCounter } from '../../card/ItemBag';
import {
    evaluateUpgrade,
    indexCardLevelUpRows,
    parseCardLevelUpRow,
    type ZCCardLevelUpRow,
} from '../../card/CardUpgradeCost';
import { cardRepository } from '../../card/CardRepository';
import type { IShowRewardEntry as IRewardEntry } from '../../common/RewardEntries';

/** 宝箱奖励事件名；单测把 `ChestEvents` 模块桩成空对象时仍能注册监听。 */
const CHEST_REWARDS_EVENT = CHEST_EVENTS?.REWARDS ?? 'chest:rewards';

/**
 * 负责主界面生命周期内的全页签宝箱奖励与橙卡英雄特写串联，避免切换页签后丢失开箱页或英雄展示。
 */
export class MainChestRewardCoordinator extends ControllerBase {
    private heroChain: Promise<void> = Promise.resolve();
    private territoryGeneration = 0;

    constructor(context: IControllerContext) {
        super(context, 'main-chest-rewards');
        if (CHEST_REWARDS_EVENT) this.listen(CHEST_REWARDS_EVENT, this.onTreasureRewards);
        if (TerritoryUiEvent?.ChestRevealed) {
            this.listen(TerritoryUiEvent.ChestRevealed, this.onChestRevealed);
        }
        if (TerritoryUiEvent?.ChestRewardsReady) {
            this.listen(TerritoryUiEvent.ChestRewardsReady, this.onChestRewardsReady);
        }
        if (TerritoryUiEvent?.Disposed) {
            this.listen(TerritoryUiEvent.Disposed, this.onTerritoryDisposed);
        }
    }

    private onTerritoryDisposed(): void {
        this.territoryGeneration++;
    }

    private onTreasureRewards(event: { readonly goods: readonly CmdGoods[] }): void {
        if (!event.goods.length) return;
        void TerritoryChestOpenPage.open({ userData: { goods: event.goods } }).then(popup => {
            if (this.isDisposed) popup?.close();
        }).catch(reportChestRewardFailure);
    }

    private onChestRevealed(event: { readonly entries: readonly IRewardEntry[] }): void {
        // 宝箱开启页（宝箱栏 / 巡逻等入口）内已展示全部奖励，此处按队列补播橙卡英雄特写，不再依赖开箱页句柄存活。
        void this.enqueueHeroPresentation(() => this.presentChestHeroes(event.entries))
            .catch(reportChestRewardFailure);
    }

    private onChestRewardsReady(event: { readonly rewards: readonly IRewardEntry[] }): void {
        const session = this.territoryGeneration;
        void this.runChestRewardChain(event.rewards, () => session !== this.territoryGeneration)
            .catch(reportChestRewardFailure);
    }

    /** 按顺序串联「橙卡英雄特写 → 统一获得奖励窗」，并保证引导演出窗口不悬空。 */
    async runChestRewardChain(
        rewards: readonly IRewardEntry[],
        shouldAbort?: () => boolean,
    ): Promise<void> {
        let popupPlanned = false;
        try {
            await this.enqueueHeroPresentation(() => this.presentChestHeroes(rewards, shouldAbort));
            if (this.isDisposed || shouldAbort?.() || !rewards.length) return;
            popupPlanned = true;
            FW.ShowReward(rewards.map(reward => ({
                resId: reward.resId,
                number: reward.number,
            })) as unknown as CmdGoods[]);
        } finally {
            if (!popupPlanned) {
                EventMgr.instance.emit(TerritoryUiEvent.ChestPresentation, { playing: false });
            }
        }
    }

    private enqueueHeroPresentation(task: () => Promise<void>): Promise<void> {
        const next = (this.heroChain ?? Promise.resolve()).then(task, task);
        this.heroChain = next.catch(() => {});
        return next;
    }

    /** 筛选橙色英雄碎片（pvpCard.rarity === 4）并逐个顺序展示特写页；无橙卡碎片时跳过阵容查询。 */
    async presentChestHeroes(
        entries: readonly { readonly resId: number; readonly number: number }[],
        shouldAbort?: () => boolean,
    ): Promise<void> {
        if (this.isDisposed || shouldAbort?.() || !entries.some(entry => entry.number > 0)) return;
        const [rawRows, rarities] = await Promise.all([
            loadCardLevelUpRows(),
            loadPvpCardRarities(),
        ]);
        if (this.isDisposed || shouldAbort?.()) return;
        const rows: ZCCardLevelUpRow[] = [];
        for (const raw of rawRows) {
            const parsed = parseCardLevelUpRow(raw);
            if (parsed) rows.push(parsed);
        }
        const heroes = chestLegendHeroesOf(entries, rows, cardId => rarities.get(cardId) ?? 0);
        if (!heroes.length) return;
        const heroLevels = await cardRepository.loadHeroLevelsOnly();
        if (this.isDisposed || shouldAbort?.()) return;
        const table = indexCardLevelUpRows(rows);
        const counter = createItemCounter();
        for (const heroId of heroes) {
            if (this.isDisposed || shouldAbort?.()) return;
            const status = evaluateUpgrade(table, heroId, heroLevels.get(heroId) ?? 0, counter);
            const progress = status.requirements.find(item => item.key === 'card');
            await this.openHeroObtainPopup(heroId, progress?.owned, progress?.need, shouldAbort);
        }
    }

    private async openHeroObtainPopup(
        heroId: string,
        progressCurrent?: number,
        progressMax?: number,
        shouldAbort?: () => boolean,
    ): Promise<void> {
        let settled = false;
        let resolveClosed!: () => void;
        const closed = new Promise<void>(resolve => {
            resolveClosed = resolve;
        });
        const finish = (): void => {
            if (settled) return;
            settled = true;
            resolveClosed();
        };
        const unregisterFinish = this.scope.defer(finish);
        let releasePopup: (() => void) | null = null;
        try {
            const popup = await HeroObtainPage.open({
                userData: { heroId, progressCurrent, progressMax },
                onClose: finish,
            });
            if (this.isDisposed || shouldAbort?.()) {
                popup?.close();
                return;
            }
            if (!popup) return;
            void AudioMgr.instance.playSound(GAME_AUDIO.goldFragment, this.scope);
            releasePopup = this.scope.defer(() => {
                popup.close();
            });
            await closed;
        } finally {
            releasePopup?.();
            unregisterFinish();
        }
    }

    dispose(): void {
        if (this.isDisposed) return;
        super.dispose();
    }
}

function reportChestRewardFailure(error: unknown): void {
    console.warn('[MainChestRewardCoordinator]', error);
}
