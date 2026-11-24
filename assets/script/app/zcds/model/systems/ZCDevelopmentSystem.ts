import { cardTypeToBuilding, findCatalogCard, rarityRank, type ZCDeckCard } from '../ZCCombatCatalog';
import type { ZCBuildingType, ZCHexState, ZCSnapshot } from '../ZCGameTypes';
import type { ZCOwner } from '../ZCMapConfig';
import type { ZCMatchConfig, ZCMatchMap } from '../ZCMatchConfig';
import {
    isZCNeutralResourceBuilding, neutralResourceItemOf, ZCNeutralResourceType,
    type ZCNeutralResourceItem,
} from '../ZCNeutralResourceGroup';
import { drawPvpTile, tileTypeFromLegacyHex, type ZCPvpSeatDrawRules, type ZCPvpTileType } from '../ZCPvpTileRules';
import { ZCArtifactSystem } from './ZCArtifactSystem';
import { ZCEconomySystem } from './ZCEconomySystem';
import type { IZCModelServices } from './ZCModelServices';

export interface IZCDevelopmentContext extends Pick<IZCModelServices, 'rules' | 'unitCount' | 'spawnUnit'> {
    goldOf(owner: ZCOwner): number;
    setGold(owner: ZCOwner, amount: number): void;
    /**
     * 中立资源奖励入袋当拍的通知（金币/充能/产兵/建建筑任一发生回调一次）。
     * 必须在 `neutralResourceId` 清空前发出：渲染层要靠 hexId + 资源项播飞行特效。
    */
    onNeutralReward?(hexId: number, itemId: number, owner: ZCOwner, item: ZCNeutralResourceItem): void;
    /** 该席位翻地块的抽卡规则；缺省或返回 `null` 时用原表权重并保留金色保底。*/
    drawRulesOf?(owner: ZCOwner): ZCPvpSeatDrawRules | null;
}

export interface IZCDevelopmentResult {
    readonly card: ZCDeckCard | null;
    readonly building: ZCBuildingType | null;
    readonly tier: number;
    readonly tileType: ZCPvpTileType;
    readonly pityTriggered: boolean;
}

/** 付费开发与中立资源领取的结算。*/
export class ZCDevelopmentSystem {
    static develop(state: ZCSnapshot, owner: ZCOwner, hex: ZCHexState, deck: readonly ZCDeckCard[],
        config: ZCMatchConfig, random: () => number, context: IZCDevelopmentContext,
        forcedCard: ZCDeckCard | null = null): IZCDevelopmentResult {
        hex.captureOwner = null;
        hex.captureSeconds = 0;
        // 抽卡为空或抽到不可建造的卡时，地块仍然归开发方。
        if (hex.owner === 'neutral') hex.owner = owner;
        // 资源格正常走「相邻自动领取」，这里只兜直接调用的路径：领到金矿/兵营就直接立建筑，不再抽卡。
        const granted = this.grantNeutralResourceReward(state, owner, hex, context);
        if (granted) hex.neutralResourceId = null;
        const tileType = hex.tileType || tileTypeFromLegacyHex(hex);
        if (granted && isZCNeutralResourceBuilding(granted)
            && grantNeutralBuilding(state, owner, hex, granted, context)) {
            hex.developmentResolved = true;
            hex.state = 'developed';
            return { card: null, building: hex.building, tier: hex.tier, tileType, pityTriggered: false };
        }
        const result = forcedCard
            ? { card: forcedCard, pityTriggered: false, nextAllRandomNonGoldDraws: state.allRandomNonGoldDraws[owner] }
            : drawPvpTile(deck, tileType, state.allRandomNonGoldDraws[owner], random, config.tiles, config.goldPity,
                context.drawRulesOf?.(owner) ?? null);
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
        const tier = rarityRank(card.rarity);
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
        // 走位占领只换归属，不清资源标记、不发奖励。
        if (hex.building !== 'none') return { changed: false, terrainChanged: false };
        const isRuins = hex.state === 'ruins';
        if (hex.owner === owner && !isRuins) return { changed: false, terrainChanged: false };
        const changedOwner = hex.owner !== owner;
        const developmentResolved = hex.developmentResolved;
        hex.owner = owner;
        hex.state = developmentResolved ? 'developed' : 'occupied';
        // 出生格的生命值仍由中立野怪战斗结算持有。
        if (neutralResourceItemOf(hex.neutralResourceId)?.resourceType === ZCNeutralResourceType.Monster) {
            return { changed: true, terrainChanged: changedOwner || isRuins };
        }
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
            if (neutralResourceItemOf(hex.neutralResourceId)?.feature) continue;
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
            // 清空标记同时充当一次性守卫，并让资源图标消失。
            hex.neutralResourceId = null;
            onClaim(hex.id, itemId);
        }
    }

    /**
     * 发奖：宝箱给金币、神器充能给充能点、兵团直接产兵；金矿/兵营只发通知，建筑由调用方接着立。
     * 战斗 Buff 暂不改属性（表里权重为 0，抽不到；真抽到也不静默改数值）。
     *
     * @returns 抽中的资源项；`null` 表示这格没有可识别的资源项。
    */
    private static grantNeutralResourceReward(state: ZCSnapshot, owner: ZCOwner,
        hex: ZCHexState, context: IZCDevelopmentContext): ZCNeutralResourceItem | null {
        const item = neutralResourceItemOf(hex.neutralResourceId);
        if (!item) return null;
        // 表现通知先于「清空标记」发出：消费方要靠 hexId + 资源项对齐视图。
        context.onNeutralReward?.(hex.id, item.id, owner, item);
        if (item.gold > 0) context.setGold(owner, context.goldOf(owner) + item.gold);
        if (item.artifactCharge > 0) {
            state.artifactCharge = Math.max(0, state.artifactCharge) + item.artifactCharge;
            ZCArtifactSystem.normalize(state, context.rules);
        }
        if (!item.cardId || item.unitCount <= 0) return item;
        // 奖励卡从完整卡表取，不受本局卡组限制。
        const card = findCatalogCard(item.cardId);
        if (!card?.unitId) return item;
        for (let i = 0; i < item.unitCount; i += 1) {
            if (context.unitCount(owner) >= context.rules.unitCapPerSide) break;
            context.spawnUnit(owner, card, Math.max(1, rarityRank(card.rarity)), hex.id);
        }
        return item;
    }
}

/**
 * 把「金矿 / 兵营」组合项原地立成建筑。资源点不经过抽卡，品级固定 1 级。
 * @returns 是否真的立起（卡被删或类型对不上时为 false）
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
