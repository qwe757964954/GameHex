import { cardTypeToBuilding, findCatalogCard, ZC_RARITY_RANK, type ZCDeckCard } from '../ZCCombatCatalog';
import type { ZCBuildingType, ZCHexState, ZCSnapshot } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCMatchConfig, ZCMatchMap } from '../ZCMatchConfig';
import {
    isZCNeutralResourceBuilding, neutralResourceItemOf,
    type ZCNeutralResourceItem,
} from '../ZCNeutralResourceGroup';
import { drawPvpTile, type ZCPvpTileType } from '../ZCPvpTileRules';
import { tileTypeFromLegacyHex } from '../ZCSnapshotCodec';
import { ZCArtifactSystem } from './ZCArtifactSystem';
import { ZCEconomySystem } from './ZCEconomySystem';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCDevelopmentContext extends Pick<IZCModelServices, 'rules' | 'unitCount' | 'spawnUnit'> {
    goldOf(owner: ZCOwner): number;
    setGold(owner: ZCOwner, amount: number): void;
    /**
     * 中立资源奖励**已入袋**那一拍的表现通知（金币 / 充能 / 产兵 / 建建筑任一发生即回调一次）。
     *
     * 通知发生在 `neutralResourceId` 被清空**之前**（`grantNeutralResourceReward` 内部），
     * 快照里那一格还是「带资源的格子」—— 渲染层要靠 hexId + 资源项播飞行特效，
     * 而领取后的快照里这两个信息都不在了，所以必须在发奖拍补齐。
     */
    onNeutralReward?(hexId: number, itemId: number, owner: ZCOwner, item: ZCNeutralResourceItem): void;
}

export interface IZCDevelopmentResult {
    readonly card: ZCDeckCard | null;
    readonly building: ZCBuildingType | null;
    readonly tier: number;
    readonly tileType: ZCPvpTileType;
    readonly pityTriggered: boolean;
}

/** Resolves paid development and neutral-resource acquisition against one match snapshot. */
export class ZCDevelopmentSystem {
    static develop(state: ZCSnapshot, owner: ZCOwner, hex: ZCHexState, deck: readonly ZCDeckCard[],
        config: ZCMatchConfig, random: () => number, context: IZCDevelopmentContext): IZCDevelopmentResult {
        hex.captureOwner = null;
        hex.captureSeconds = 0;
        // The tile is acquired even when the draw is empty or produces a non-buildable card.
        if (hex.owner === 'neutral') hex.owner = owner;
        // 资源格正常走「相邻自动领取」（`canDevelopFor` 拦住了付费开发），这里只兜住直接调用的路径：
        // 若这格恰好带着「金矿 / 兵营」类资源，领取即把建筑立起来，不再额外抽卡（否则一格两座建筑）。
        const granted = this.grantNeutralResourceReward(state, owner, hex, context);
        if (granted) hex.neutralResourceId = null;
        const tileType = hex.tileType || tileTypeFromLegacyHex(hex);
        if (granted && isZCNeutralResourceBuilding(granted)
            && grantNeutralBuilding(state, owner, hex, granted, context)) {
            hex.developmentResolved = true;
            hex.state = 'developed';
            return { card: null, building: hex.building, tier: hex.tier, tileType, pityTriggered: false };
        }
        const result = drawPvpTile(deck, tileType, state.allRandomNonGoldDraws[owner], random,
            config.tiles, config.goldPity);
        state.allRandomNonGoldDraws[owner] = result.nextAllRandomNonGoldDraws;
        hex.developmentResolved = true;
        hex.wallMaxHp = context.rules.wallMaxHp;
        hex.wallHp = hex.wallMaxHp;
        hex.wallBreachedEdge = null;
        const card = result.card;
        const building = card ? cardTypeToBuilding(card.type) : null;
        if (!card || !building) {
            hex.state = 'developed';
            return { card, building, tier: 0, tileType, pityTriggered: result.pityTriggered };
        }
        const tier = ZC_RARITY_RANK[card.rarity];
        hex.building = building;
        hex.state = 'developed';
        hex.tier = tier;
        hex.cardId = card.id;
        hex.maxHp = Math.round((card.baseHp ?? 0) + tier * (card.cyclePerTierValue ?? 0));
        hex.hp = hex.maxHp;
        hex.constructionTotalSeconds = Math.max(0, card.buildSeconds || 0);
        hex.constructionRemainingSeconds = hex.constructionTotalSeconds;
        state.spawnClocks[ZCEconomySystem.cycleKey(hex)] = 0;
        state.builtTypeCounts[owner][card.type] += 1;
        return { card, building, tier, tileType, pityTriggered: result.pityTriggered };
    }

    static captureEmptyTile(hex: ZCHexState, owner: ZCOwner): { changed: boolean; terrainChanged: boolean } {
        // Walking control transfers the tile without clearing its resource marker or granting the reward.
        if (hex.building !== 'none') return { changed: false, terrainChanged: false };
        const isRuins = hex.state === 'ruins';
        if (hex.owner === owner && !isRuins) return { changed: false, terrainChanged: false };
        const changedOwner = hex.owner !== owner;
        const developmentResolved = hex.developmentResolved;
        hex.owner = owner;
        hex.state = developmentResolved ? 'developed' : 'occupied';
        hex.cardId = null;
        hex.developmentResolved = developmentResolved;
        hex.tier = 0;
        hex.hp = 0;
        hex.maxHp = 0;
        hex.wallHp = 0;
        hex.wallMaxHp = 0;
        hex.wallBreachedEdge = null;
        hex.constructionRemainingSeconds = 0;
        hex.constructionTotalSeconds = 0;
        return { changed: true, terrainChanged: changedOwner || isRuins };
    }

    static claimAdjacentNeutralResources(state: ZCSnapshot, map: ZCMatchMap,
        owners: readonly ZCOwner[], context: IZCDevelopmentContext,
        onClaim: (hexId: number, itemId: number) => void): void {
        for (const hex of state.hexes) {
            if (!hex.neutralResourceId || hex.developmentResolved) continue;
            const config = map.hexes[hex.id];
            if (!config?.playable) continue;
            const claimant = owners.find((owner) => config.neighbors.some((neighborId) => {
                const neighbor = state.hexes[neighborId];
                return neighbor?.owner === owner && neighbor.developmentResolved;
            }));
            if (!claimant) continue;
            hex.owner = claimant;
            hex.developmentResolved = true;
            hex.state = 'developed';
            hex.wallMaxHp = context.rules.wallMaxHp;
            hex.wallHp = hex.wallMaxHp;
            hex.wallBreachedEdge = null;
            const itemId = hex.neutralResourceId;
            const item = this.grantNeutralResourceReward(state, claimant, hex, context);
            // 组合项是「金矿 / 兵营」时，领到即在该格立起那座建筑（属性按领取方养成，未拥有按 1 级）。
            if (item) grantNeutralBuilding(state, claimant, hex, item, context);
            // Clearing the marker is the single-use guard and hides the resource icon.
            hex.neutralResourceId = null;
            onClaim(hex.id, itemId);
        }
    }

    /**
     * 发奖：按**资源项**的类型分派。
     *
     *  · 宝箱（1）→ 金币；神器充能（4）→ 充能点；
     *  · 兵团（3）→ 直接产 N 个该卡的兵（走既有 `spawnUnit` 的 `born` 流程）；
     *  · 金矿（2）/ 兵营（5）→ 不在本方法里建建筑（调用方接着调 `grantNeutralBuilding`），
     *    这里只把「事件通知」发出去，保证建筑激活动画与其它奖励同拍；
     *  · 战斗Buff（6）→ 目前只发通知、不改属性（J 表光环 Buff 的落地规则待策划定稿，
     *    表里这两行的权重为 0，正常配置抽不到；真抽到了也不会静默改数值）。
     *
     * @returns 抽中的资源项（`null` = 这格没有可识别的资源项：未配表 / 已被领走）
     */
    private static grantNeutralResourceReward(state: ZCSnapshot, owner: ZCOwner,
        hex: ZCHexState, context: IZCDevelopmentContext): ZCNeutralResourceItem | null {
        const item = neutralResourceItemOf(hex.neutralResourceId);
        if (!item) return null;
        // 表现通知先于「清空标记」发出：`onNeutralReward` 的消费方（模型）要靠 hexId +
        // 资源项对齐视图，领取后的快照里这两样都不在了。
        context.onNeutralReward?.(hex.id, item.id, owner, item);
        if (item.gold > 0) context.setGold(owner, context.goldOf(owner) + item.gold);
        if (item.artifactCharge > 0) {
            state.artifactCharge = Math.max(0, state.artifactCharge) + item.artifactCharge;
            ZCArtifactSystem.normalize(state, context.rules);
        }
        if (!item.cardId || item.unitCount <= 0) return item;
        // Reward cards come from the full catalog, not the match's restricted deck.
        const card = findCatalogCard(item.cardId);
        if (!card?.unitId) return item;
        for (let i = 0; i < item.unitCount; i += 1) {
            if (context.unitCount(owner) >= context.rules.unitCapPerSide) break;
            context.spawnUnit(owner, card, Math.max(1, ZC_RARITY_RANK[card.rarity]), hex.id);
        }
        return item;
    }
}

/**
 * 把「金矿 / 兵营」组合项原地立成一座建筑。
 *
 *  ⚠️ 品级固定 1 级：资源点不经过抽卡，没有品级概念；表说明「未拥有按 1 级计算」，
 *  拥有养成时由 `ZCUnitGrowth` / 卡牌养成在取属性那侧接管，这里只落基础耐久。
 *  @returns 是否真的立起了建筑（卡被删 / 类型对不上时为 false）
 */
function grantNeutralBuilding(
    state: ZCSnapshot, owner: ZCOwner, hex: ZCHexState, item: ZCNeutralResourceItem, context: IZCDevelopmentContext,
): boolean {
    const card = item.cardId ? findCatalogCard(item.cardId) : null;
    const building = card ? cardTypeToBuilding(card.type) : null;
    if (!card || !building) return false;
    const tier = 1;
    hex.building = building;
    hex.tier = tier;
    hex.cardId = card.id;
    hex.maxHp = Math.round((card.baseHp ?? 0) + tier * (card.cyclePerTierValue ?? 0));
    hex.hp = hex.maxHp;
    hex.constructionTotalSeconds = Math.max(0, card.buildSeconds || 0);
    hex.constructionRemainingSeconds = hex.constructionTotalSeconds;
    hex.wallMaxHp = context.rules.wallMaxHp;
    hex.wallHp = hex.wallMaxHp;
    hex.wallBreachedEdge = null;
    // 产金 / 产兵时钟归零：从领取这一刻开始计时，与抽卡建出来的建筑同口径。
    state.spawnClocks[ZCEconomySystem.cycleKey(hex)] = 0;
    state.builtTypeCounts[owner][card.type] += 1;
    return true;
}
