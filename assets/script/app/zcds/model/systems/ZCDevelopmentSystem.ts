import { cardTypeToBuilding, findCatalogCard, type ZCDeckCard, ZC_RARITY_RANK } from '../ZCCombatCatalog';
import type { ZCMatchConfig, ZCMatchMap } from '../ZCMatchConfig';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCBuildingType, ZCHexState, ZCSnapshot } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import {
    hasNeutralResourceReward, isZCNeutralResourceId, neutralResourceRewardOf,
    type ZCNeutralResourceId, type ZCNeutralResourceReward,
} from '../ZCNeutralResourceReward';
import { drawPvpTile, type ZCPvpTileType } from '../ZCPvpTileRules';
import { tileTypeFromLegacyHex } from '../ZCSnapshotCodec';
import { ZCEconomySystem } from './ZCEconomySystem';
import { ZCArtifactSystem } from './ZCArtifactSystem';

export interface IZCDevelopmentContext {
    readonly rules: Readonly<ZCRuntimeRules>;
    goldOf(owner: ZCOwner): number;
    setGold(owner: ZCOwner, amount: number): void;
    unitCount(owner: ZCOwner): number;
    spawnUnit(owner: ZCOwner, card: ZCDeckCard, tier: number, hexId: number): void;
    /**
     * 中立资源奖励**已入袋**那一拍的表现通知（金币 / 充能 / 产兵任一发生即回调一次）。
     *
     * 通知发生在 `neutralResourceId` 被清空**之前**（`grantNeutralResourceReward` 内部），
     * 快照里那一格还是「带资源的格子」—— 渲染层要靠 hexId + resourceId 播飞行特效，
     * 而领取后的快照里这两个信息都不在了，所以必须在发奖拍补齐。
     */
    onNeutralReward?(hexId: number, resourceId: ZCNeutralResourceId, owner: ZCOwner, reward: ZCNeutralResourceReward): void;
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
        this.grantNeutralResourceReward(state, owner, hex, context);
        const tileType = hex.tileType || tileTypeFromLegacyHex(hex);
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
        onClaim: (hexId: number, resourceId: ZCNeutralResourceId) => void): void {
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
            this.grantNeutralResourceReward(state, claimant, hex, context);
            // Clearing the marker is the single-use guard and hides the resource icon.
            // resourceId 先于清空捕获：回调（模型）要靠它决定表现（金矿的「建筑被开发」）。
            const resourceId = hex.neutralResourceId;
            hex.neutralResourceId = null;
            onClaim(hex.id, resourceId);
        }
    }

    private static grantNeutralResourceReward(state: ZCSnapshot, owner: ZCOwner,
        hex: ZCHexState, context: IZCDevelopmentContext): void {
        const reward = neutralResourceRewardOf(hex.neutralResourceId);
        if (!hasNeutralResourceReward(reward)) return;
        // 表现通知先于「清空标记」发出：`onNeutralReward` 的消费方（模型）要靠 hexId +
        // resourceId 对齐视图，领取后的快照里这两样都不在了。
        const resourceId = hex.neutralResourceId;
        if (resourceId && isZCNeutralResourceId(resourceId)) {
            context.onNeutralReward?.(hex.id, resourceId, owner, reward);
        }
        if (reward.gold > 0) context.setGold(owner, context.goldOf(owner) + reward.gold);
        if (reward.artifactCharge > 0) {
            state.artifactCharge = Math.max(0, state.artifactCharge) + reward.artifactCharge;
            ZCArtifactSystem.normalize(state, context.rules);
        }
        if (!reward.rewardCardId || reward.rewardUnitCount <= 0) return;
        // Reward cards come from the full catalog, not the match's restricted deck.
        const card = findCatalogCard(reward.rewardCardId);
        if (!card?.unitId) return;
        for (let i = 0; i < reward.rewardUnitCount; i += 1) {
            if (context.unitCount(owner) >= context.rules.unitCapPerSide) break;
            context.spawnUnit(owner, card, Math.max(1, ZC_RARITY_RANK[card.rarity]), hex.id);
        }
    }
}
