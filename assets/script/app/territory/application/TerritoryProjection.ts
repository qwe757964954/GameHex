import type { TerritoryMapConfig, TerritorySite } from '../model/TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { TerritoryCampaignStage } from '../model/TerritoryCampaignConfig';
import type { TerritoryProgress } from '../model/TerritoryProgress';
import type { TerritorySaveState } from '../model/TerritorySaveState';
import { TERRITORY_SILVER_RES_ID } from '../model/TerritoryIdleReward';
import {
    TERRITORY_ASYNC_REWARD_SLOTS,
    TERRITORY_ASYNC_SCOUT_STAMINA,
    TERRITORY_LEVEL_DROP_SLOTS,
    TERRITORY_TEXTS,
    TERRITORY_UNBOUND_TYPE_NAMES,
} from './TerritoryTexts';
import type {
    ITerritoryHudRender,
    ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent,
    ITerritoryPlayerStageContent,
} from './TerritoryModel';

export interface ITerritoryHudOptions {
    readonly map: TerritoryMapConfig;
    readonly availableChapters: readonly number[];
    readonly currentChapterId: number;
    readonly completion: { readonly occupied: number; readonly total: number; readonly complete: boolean };
    readonly playerCardCount: number;
    readonly wallet: { readonly silver: number; readonly stamina: number };
    readonly resultNotice: string;
    readonly inventorySummary: string;
}

/** 纯函数：组装主城领地 HUD 展示数据。 */
export function buildTerritoryHud(options: ITerritoryHudOptions): ITerritoryHudRender {
    const { map, availableChapters, currentChapterId, completion, playerCardCount, wallet, resultNotice, inventorySummary } = options;
    const chapterIndex = availableChapters.indexOf(currentChapterId);
    const hasNextChapter = chapterIndex >= 0 && chapterIndex < availableChapters.length - 1;
    const random = map.randomSites;
    const randomHint = random?.candidateCells.length
        ? TERRITORY_TEXTS.randomCostHint(random.triggerSilver, map.defaults.staminaCost)
        : '';
    return {
        chapterText: `${map.name}  ·  已占领 ${completion.occupied}/${completion.total}  ·  已启用 ${playerCardCount} 张卡牌`,
        walletText: `银币 ${wallet.silver}     体力 ${wallet.stamina}` + (resultNotice ? `     ${resultNotice}` : ''),
        walletHighlight: resultNotice !== '',
        inventoryText: `领地库存：${inventorySummary}`,
        hintText: `点击站点查看详情${randomHint}`,
        previousEnabled: chapterIndex > 0,
        nextEnabled: hasNextChapter && completion.complete,
        nextCaption: !hasNextChapter
            ? TERRITORY_TEXTS.finalChapter
            : completion.complete ? TERRITORY_TEXTS.nextChapter : TERRITORY_TEXTS.nextChapterLocked,
    };
}

export interface ITerritoryLevelInfoOptions {
    readonly site: TerritorySite | null;
    readonly stage: TerritoryCampaignStage | null;
    readonly progress: TerritoryProgress | null;
    readonly pendingFixedResourceCells: ReadonlySet<number>;
    readonly startingBattle: boolean;
}

/** 纯函数：组装关卡/首领详情弹窗展示数据。 */
export function buildTerritoryLevelInfo(options: ITerritoryLevelInfoOptions): ITerritoryLevelInfoContent | null {
    const { site, stage, progress, pendingFixedResourceCells, startingBattle } = options;
    if (!site) return null;
    if (site.type !== TERRITORY_SITE_TYPE.stage && site.type !== TERRITORY_SITE_TYPE.boss) return null;

    const title = stage
        ? `${stage.isBoss ? TERRITORY_TEXTS.bossStageTitle : TERRITORY_TEXTS.stageTitle}  ${stage.stage}`
        : TERRITORY_UNBOUND_TYPE_NAMES[site.type];
    let silver: TerritoryCampaignStage['idleRewards'][number] | null = null;
    const drops: { resId: number; amount: number }[] = [];
    if (stage) {
        for (let i = 0; i < stage.idleRewards.length; i++) {
            const reward = stage.idleRewards[i];
            if (reward.probability <= 0 || reward.amount <= 0) continue;
            if (reward.resId === TERRITORY_SILVER_RES_ID) {
                if (!silver) silver = reward;
            } else if (drops.length < TERRITORY_LEVEL_DROP_SLOTS) {
                drops.push({ resId: reward.resId, amount: reward.amount });
            }
        }
    }

    const passed = !!progress && !!site && progress.isAreaPassed(site.cellId);
    const unlocked = !!progress && !!site && (progress.isCellUnlocked(site.cellId) || passed);

    return {
        levelId: stage?.levelId ?? null,
        title,
        hasTip: !!stage && stage.enemies.length > 0,
        objective: TERRITORY_TEXTS.levelObjective,
        occupy: silver ? TERRITORY_TEXTS.levelOccupy(silver.amount, silver.name) : TERRITORY_TEXTS.noReward,
        drops,
        recommend: '',
        fightCaption: unlocked ? TERRITORY_TEXTS.levelFight : TERRITORY_TEXTS.levelUnlock,
        fightEnabled: !pendingFixedResourceCells.has(site.cellId) && !startingBattle,
        staminaCost: stage?.staminaCost ?? 0,
    };
}

/** 纯函数：组装关卡提示弹窗展示数据（敌军阵容与说明）。 */
export function buildTerritoryLevelTip(
    info: ITerritoryLevelInfoContent | null,
    stage: TerritoryCampaignStage | null,
): ITerritoryLevelTipContent | null {
    if (!info) return null;
    const enemies: { headIcon: string; name: string; description: string }[] = [];
    const descParts: string[] = [];
    if (stage) {
        for (let i = 0; i < stage.enemies.length; i++) {
            const enemy = stage.enemies[i];
            const desc = enemy.description ?? '';
            enemies.push({
                headIcon: enemy.headIcon ?? '',
                name: `${enemy.name} Lv.${enemy.level}`,
                description: desc,
            });
            if (desc !== '') descParts.push(desc);
        }
    }
    const description = descParts.join('\n');
    return { title: info.title, enemies, description };
}

export interface ITerritoryPlayerStageOptions {
    readonly site: TerritorySite | null;
    readonly stage: TerritoryCampaignStage | null;
    readonly pendingFixedResourceCells: ReadonlySet<number>;
    readonly startingBattle: boolean;
}

/** 纯函数：组装异步 PVP 关卡详情展示数据。 */
export function buildTerritoryPlayerStage(options: ITerritoryPlayerStageOptions): ITerritoryPlayerStageContent | null {
    const { site, stage, pendingFixedResourceCells, startingBattle } = options;
    if (!site || site.type !== TERRITORY_SITE_TYPE.asyncPvp) return null;
    const rewards: { resId: number; amount: number }[] = [];
    if (stage) {
        for (let i = 0; i < stage.idleRewards.length; i++) {
            const reward = stage.idleRewards[i];
            if (reward.probability > 0 && reward.amount > 0) {
                rewards.push({ resId: reward.resId, amount: reward.amount });
                if (rewards.length >= TERRITORY_ASYNC_REWARD_SLOTS) break;
            }
        }
    }
    return {
        title: TERRITORY_UNBOUND_TYPE_NAMES.asyncPvp,
        chestText: TERRITORY_TEXTS.asyncPlayerChestReward,
        rewards,
        scoutCost: TERRITORY_ASYNC_SCOUT_STAMINA,
        fightCost: stage ? Math.max(0, Math.round(stage.staminaCost)) : 0,
        fightCaption: TERRITORY_TEXTS.asyncPlayerFight,
        fightEnabled: stage !== null && !pendingFixedResourceCells.has(site.cellId) && !startingBattle,
    };
}

/** 纯函数：格式化领地库存汇总文案。 */
export function buildTerritoryInventorySummary(
    saveState: TerritorySaveState | null,
    idleRewardNames: ReadonlyMap<number, string>,
): string {
    if (!saveState) return TERRITORY_TEXTS.emptyInventory;
    const keys = Object.keys(saveState.inventory);
    if (!keys.length) return TERRITORY_TEXTS.emptyInventory;
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const count = saveState.inventory[key];
        const name = idleRewardNames.get(Number(key)) ?? `道具 ${key}`;
        parts.push(`${name}×${count}`);
    }
    return parts.join('  ');
}

/** 纯函数：建立关卡掉落物名称映射字典。 */
export function buildTerritoryIdleRewardNames(
    stages: readonly { readonly stage: TerritoryCampaignStage }[],
): Map<number, string> {
    const names = new Map<number, string>();
    for (const item of stages) {
        for (const reward of item.stage.idleRewards) {
            if (!names.has(reward.resId)) names.set(reward.resId, reward.name);
        }
    }
    return names;
}
