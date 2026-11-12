import { buildCardLevelUpTable, evaluateUpgrade, type ZCCardLevelUpTable } from '../../card/CardUpgradeCost';
import { loadCardLevelUpRows } from '../../card/CardLineupDecks';
import { sortLineupCards, visibleLineupCards } from '../../card/CardLineupTypes';
import type { ICardArtConfig } from '../../card/CardArtConfig';
import { cardRepository } from '../../card/CardRepository';
import { createItemCounter } from '../../card/ItemBag';
import type { ZCDeckCard } from '../../zcds/model/ZCCombatCatalog';
import {
    detectTerritoryHeroBadges,
    type ITerritoryHeroBadgeItem,
    type ITerritoryHeroProgressSource,
    type ITerritoryHeroUpgradeState,
    type ITerritoryRewardDelta,
} from '../../territory/model/TerritoryHeroReward';

/**
 * 「本次领奖让哪些英雄新达成可升级」的**组合层适配器**（2026-11-10 需求 ③）。
 *
 * ## 为什么放在 bootstrap
 *
 * 领地页（`app/territory` / `app/main/MainTerritoryMap`）不该反向 import `app/card`。
 * 这里实现领地 model 声明的 {@link ITerritoryHeroProgressSource}，由 `MainPageComposition`
 * 注入给页面 —— 页面只认接口，卡库表 / 背包 / 排序权重都留在本层。
 *
 * ## 「新达成」怎么算（用户 2026-11-10 选的口径）
 *
 * ```
 * before = evaluateUpgrade(升级表, cardId, 等级, 当前背包)
 * after  = evaluateUpgrade(升级表, cardId, 等级, 当前背包 + 本次奖励增量)
 * 入队   ⇔ !before.canUpgrade && after.canUpgrade
 * ```
 *
 * 🔴 **用「预测叠加」而不是「领奖前后各读一次背包」**：服务端奖励回包到达时
 *    `CacheMgr` 的 CmdItem 缓存可能还没刷新，两次读会是同一个值 ⇒ 永远检测不到新达成。
 *    把本次 `resId → amount` 直接叠进 `countOf` 是纯函数、可复现、不依赖刷新时机。
 *
 * `canUpgrade = 碎片够 && 经验够`（`CardUpgradeCost.evaluateUpgrade` 的真源），
 * 正好就是用户说的「卡牌碎片累计满且种族经验也累计满」。
 *
 * ## 排序优先级
 *
 * 复用卡库唯一真源 `sortLineupCards`（已上阵 > 已解锁 > 解锁中 > 未获得；
 * 同组比品质 / 等级 / 职业），把它的**下标**当 `priority`，多个英雄逐个播放的顺序
 * 与玩家在卡库里看到的顺序一致，不另造一套权重。
 *
 * ## 降级
 *
 * 卡库 / 升级表任一读取失败 ⇒ 返回空数组。徽标是**纯表现**，绝不阻断领奖；
 * 首次读取前的领奖会等一次 `Promise`（后续命中缓存，同步开销可忽略）。
 */

interface ILineupSnapshot {
    readonly cards: readonly ZCDeckCard[];
    readonly deck: readonly ZCDeckCard[];
    readonly heroLevels: ReadonlyMap<string, number>;
    readonly art: ICardArtConfig | null;
}

const EMPTY_LINEUP: ILineupSnapshot = {
    cards: [],
    deck: [],
    heroLevels: new Map<string, number>(),
    art: null,
};

export class TerritoryHeroProgressSource implements ITerritoryHeroProgressSource {
    private lineupTask: Promise<ILineupSnapshot> | null = null;
    private tableTask: Promise<ZCCardLevelUpTable> | null = null;

    async newlyReady(rewards: readonly ITerritoryRewardDelta[]): Promise<readonly ITerritoryHeroBadgeItem[]> {
        if (!rewards.length) return [];
        const [lineup, table] = await Promise.all([this.lineup(), this.table()]);
        if (!lineup.cards.length || !lineup.art || table.size === 0) return [];

        // 本次增量按 resId 累加（同一批里同种资源可能来自多条奖励）。
        const deltas = new Map<string, number>();
        for (const reward of rewards) {
            const id = String(reward?.resId ?? '');
            const amount = Number(reward?.amount);
            if (!id || !Number.isFinite(amount) || amount <= 0) continue;
            deltas.set(id, (deltas.get(id) ?? 0) + Math.floor(amount));
        }
        if (!deltas.size) return [];

        const counter = createItemCounter();
        const afterCounter = (itemId: string): number =>
            (counter(itemId) || 0) + (deltas.get(String(itemId)) ?? 0);

        // 先全量算 before：碎片 owned 是 `sortLineupCards` 的分组依据，必须先取好。
        const fragments = new Map<string, { readonly owned: number }>();
        const beforeList = lineup.cards.map((card) => {
            const level = lineup.heroLevels.get(card.id) ?? 0;
            const before = evaluateUpgrade(table, card.id, level, counter);
            const cardReq = before.requirements.find((item) => item.key === 'card');
            fragments.set(card.id, { owned: cardReq?.owned ?? 0 });
            return { card, level, before, cardReq };
        });

        const deployedIds = new Set(lineup.deck.map((card) => card.id));
        const sorted = sortLineupCards(
            lineup.cards, deployedIds, lineup.heroLevels, fragments, lineup.art.lineup);
        const priority = new Map<string, number>();
        sorted.forEach((card, index) => priority.set(card.id, index));

        const states: ITerritoryHeroUpgradeState[] = beforeList.map((entry) => {
            const after = evaluateUpgrade(table, entry.card.id, entry.level, afterCounter);
            return {
                cardId: entry.card.id,
                priority: priority.get(entry.card.id) ?? Number.MAX_SAFE_INTEGER,
                cardOwned: Number(entry.cardReq?.owned ?? 0),
                cardNeed: Number(entry.cardReq?.need ?? 0),
                iconResId: Number(entry.cardReq?.itemId ?? 0) || 0,
                canUpgradeBefore: entry.before.canUpgrade,
                canUpgradeAfter: after.canUpgrade,
                maxedOrUnconfigured: !entry.before.configured || entry.before.maxed,
            };
        });
        // 判定（仅本次新达成 / 进度起点 / 排序）全在 model 纯函数里，便于行为测试；
        // 适配器只负责「把表、背包、卡库搬成 states」。
        return detectTerritoryHeroBadges(states);
    }

    /** 卡库 + 英雄等级 + 排序权重：会话内只取一次（等级变化时由卡库缓存覆盖）。 */
    private lineup(): Promise<ILineupSnapshot> {
        if (!this.lineupTask) {
            this.lineupTask = cardRepository.loadLineup(false).then((data) => ({
                cards: visibleLineupCards(data.catalog),
                deck: data.deck,
                heroLevels: data.heroLevels,
                art: data.art,
            }), () => EMPTY_LINEUP);
        }
        return this.lineupTask;
    }

    /** 升级表（1785 行）只解析一次，与 `CardRepository.levelUpTableOf` 同一理由。 */
    private table(): Promise<ZCCardLevelUpTable> {
        if (!this.tableTask) {
            this.tableTask = loadCardLevelUpRows().then(
                (rows) => buildCardLevelUpTable(rows),
                () => new Map(),
            );
        }
        return this.tableTask;
    }
}
