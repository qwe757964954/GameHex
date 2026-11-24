import { SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { ICON_TABLE, ITEM_TABLE, ROLE_PROPERTY_TABLE } from '../../../core/config/TableNames';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { RESOURCE_ICON_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import { createIconArtResolver, type IconRow } from '../../HeadArtModel';
import { resBarCellOfRefId, resBarIconSpritePath, type IItemRefRow, type IResPropertyRow } from '../../common/ResTypes';
import { itemQualityFramePathOf } from '../../itemdetail/ItemDetailArtLoader';
import { LevelInfoPanel, type ILevelInfoContent } from '../../main/LevelInfoPanel';
import { LevelTipPanel, type ILevelTipContent, type ILevelTipEnemy } from '../../main/LevelTipPanel';
import type {
    ITerritoryDetailState,
    ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent,
    ITerritoryMonsterBoxDetail,
    ITerritoryPlayerStageContent,
} from '../application/TerritoryEvents';
import { BigMapPlayerLevelPanel, type IBigMapPlayerLevelContent, type IBigMapPlayerLevelReward } from '../view/BigMapPlayerLevelPanel';
import { TerritoryMonsterBoxPanel, type ITerritoryMonsterBoxContent } from '../view/TerritoryMonsterBoxPanel';

/**
 * 宿主提供给 DetailCoordinator 的上下文契约。
 */
export interface ITerritoryDetailHost {
    readonly isValid: boolean;
    readonly assets: AssetService;
    readonly staminaIcon: SpriteFrame | null;
    readonly state: { readonly detail: ITerritoryDetailState } | null;
    refRows<T>(table: string): Promise<readonly T[]>;
}

/**
 * 据点详情类弹窗协调器（巡逻宝箱 / 关卡信息 / 玩家关卡 / 关卡提示）。
 *
 * 负责：
 * 1. Model 纯数据快照 → 各面板专属 Content 结构适配；
 * 2. 异步图元（守护怪头像、掉落物图标、品质框）按需拉取与二级缓存；
 * 3. 弹窗互斥调度与生命周期关闭。
 */
export class TerritoryDetailCoordinator {
    /** 巡逻宝箱守护怪头像缓存（key = `monsterCard.headIcon`）。 */
    readonly monsterBoxGuardIcons = new Map<string, SpriteFrame | null>();

    /** 关卡掉落物与玩家关卡奖励图标/品质框缓存（key = resId）。 */
    readonly playerStageIcons = new Map<number, IBigMapPlayerLevelReward>();

    private levelTipRevision = 0;
    private levelTipVisible = false;
    readonly levelTipIcons = new Map<string, SpriteFrame>();

    constructor(private readonly host: ITerritoryDetailHost) {}

    /**
     * 关掉据点详情类弹窗（巡逻宝箱 / 关卡信息 / 玩家关卡），支持排除当前正在打开的一个。
     */
    closeDetailPopups(except?: typeof PopupBase): void {
        if (except !== BigMapPlayerLevelPanel) this.closePopup(BigMapPlayerLevelPanel);
        if (except !== LevelInfoPanel) this.closePopup(LevelInfoPanel);
        if (except !== TerritoryMonsterBoxPanel) this.closePopup(TerritoryMonsterBoxPanel);
    }

    /** 关掉某个 popup（没开就什么都不做；`get` 只查栈，已关的返回 `null`）。 */
    closePopup<T extends PopupBase>(cls: new () => T): void {
        PopupManager.inst.get(cls)?.close();
    }

    /**
     * 已开着就换内容，没开就打开（`userData` 走 `onOpen` 渲染）。
     */
    showPopupContent(cls: typeof PopupBase, userData: unknown): void {
        const opened = PopupManager.inst.get(cls);
        if (opened) {
            (opened as unknown as { applyContent(data: unknown): void }).applyContent(userData);
            return;
        }
        void cls.open({ userData });
    }

    /**
     * 详情分发主入口。
     */
    renderDetail(
        detail: ITerritoryDetailState,
        boxChests: ReadonlyMap<number, SpriteFrame>,
        silverCost: SpriteFrame | null,
        goldCost: SpriteFrame | null,
    ): void {
        if (detail.monsterBox) {
            this.closeDetailPopups(TerritoryMonsterBoxPanel);
            this.renderLevelTip(null);
            this.renderMonsterBox(detail.monsterBox, boxChests, silverCost, goldCost);
            return;
        }
        if (detail.playerStage) {
            this.closeDetailPopups(BigMapPlayerLevelPanel);
            this.renderLevelTip(null);
            this.renderPlayerStage(detail.playerStage);
            return;
        }
        if (detail.levelInfo) {
            this.closeDetailPopups(LevelInfoPanel);
            this.renderLevelInfo(detail.levelInfo);
            this.renderLevelTip(detail.levelTip);
            return;
        }
        this.closeDetailPopups();
        this.renderLevelTip(null);
    }

    // =========================================================================
    // 巡逻宝箱（MonsterBox）
    // =========================================================================

    monsterBoxContentOf(
        detail: ITerritoryMonsterBoxDetail,
        chests: ReadonlyMap<number, SpriteFrame>,
        silverCost: SpriteFrame | null,
        goldCost: SpriteFrame | null,
    ): ITerritoryMonsterBoxContent {
        return {
            cellId: detail.cellId,
            title: detail.title,
            lv: detail.lv,
            maxLv: detail.maxLv,
            chestIcon: chests.get(detail.lv) ?? null,
            guards: detail.guards.map((guard) => ({
                icon: guard.headIcon ? this.monsterBoxGuardIcons.get(guard.headIcon) ?? null : null,
                unlocked: guard.unlocked,
                unlockText: guard.unlockText,
                countText: guard.countText,
            })),
            rewards: detail.rewards.map((reward) => ({
                resId: reward.resId,
                amount: reward.amount,
                amountText: reward.amountText,
                ratePercent: reward.ratePercent,
            })),
            upgradeCost: detail.upgradeCost,
            costIcon: detail.costResId === 10 ? goldCost : silverCost,
            successRate: detail.successRate,
            failCount: detail.failCount,
            failLimit: detail.failLimit,
            battleCaption: detail.battleCaption,
            battleEnabled: detail.battleEnabled,
            upgradeCaption: detail.upgradeCaption,
            footerText: detail.footerText,
            upgrading: detail.upgrading,
            upgradeProgress: detail.upgradeProgress,
            upgradeAttempt: detail.upgradeAttempt,
        };
    }

    renderMonsterBox(
        detail: ITerritoryMonsterBoxDetail,
        chests: ReadonlyMap<number, SpriteFrame>,
        silverCost: SpriteFrame | null,
        goldCost: SpriteFrame | null,
    ): void {
        const opened = PopupManager.inst.get(TerritoryMonsterBoxPanel);
        if (opened) {
            opened.applyContent(this.monsterBoxContentOf(detail, chests, silverCost, goldCost));
            void this.prefillMonsterBoxGuardIcons(detail, chests, silverCost, goldCost);
            return;
        }
        void TerritoryMonsterBoxPanel.open({ userData: this.monsterBoxContentOf(detail, chests, silverCost, goldCost) }).then((panel) => {
            if (!this.host.isValid || !panel?.isPopupOpen) return;
            const latest = this.host.state?.detail.monsterBox;
            if (latest) panel.applyContent(this.monsterBoxContentOf(latest, chests, silverCost, goldCost));
            this.prefillMonsterBoxGuardIcons(latest ?? detail, chests, silverCost, goldCost);
        });
    }

    async prefillMonsterBoxGuardIcons(
        detail: ITerritoryMonsterBoxDetail,
        chests: ReadonlyMap<number, SpriteFrame>,
        silverCost: SpriteFrame | null,
        goldCost: SpriteFrame | null,
    ): Promise<void> {
        const missing = Array.from(new Set(
            detail.guards
                .map((guard) => guard.headIcon)
                .filter((key) => key !== '' && !this.monsterBoxGuardIcons.has(key)),
        ));
        if (missing.length === 0) return;
        const resolver = createIconArtResolver(await this.host.refRows<IconRow>(ICON_TABLE));
        if (!this.host.isValid) return;
        await Promise.all(missing.map(async (key) => {
            const target = resolver.resolve(key);
            if (!target) {
                console.warn(`[TerritoryMonsterBoxPanel] 找不到守护怪头像配置：${key}`);
                this.monsterBoxGuardIcons.set(key, null);
                return;
            }
            try {
                const frame = await this.host.assets.load(spriteFramePath(target.root, target.art), SpriteFrame);
                this.monsterBoxGuardIcons.set(key, frame?.isValid ? frame : null);
            } catch (error) {
                console.warn(`[TerritoryMonsterBoxPanel] 守护怪头像加载失败：${key}`, error);
                this.monsterBoxGuardIcons.set(key, null);
            }
        }));
        if (!this.host.isValid) return;
        const latest = this.host.state?.detail.monsterBox;
        if (!latest) return;
        const opened = PopupManager.inst.get(TerritoryMonsterBoxPanel);
        if (opened) opened.applyContent(this.monsterBoxContentOf(latest, chests, silverCost, goldCost));
    }

    // =========================================================================
    // 关卡信息（LevelInfo）
    // =========================================================================

    levelInfoContentOf(content: ITerritoryLevelInfoContent): ILevelInfoContent {
        return {
            levelId: content.levelId,
            title: content.title,
            hasTip: content.hasTip,
            objective: content.objective,
            occupy: content.occupy,
            drops: content.drops.map((drop) => ({ resId: drop.resId, amount: drop.amount })),
            recommend: content.recommend,
            fightCaption: content.fightCaption,
            fightEnabled: content.fightEnabled,
            staminaCost: content.staminaCost,
            staminaIcon: this.host.staminaIcon,
        };
    }

    renderLevelInfo(content: ITerritoryLevelInfoContent): void {
        this.showPopupContent(LevelInfoPanel, this.levelInfoContentOf(content));
        void this.prefillLevelIcons(content);
    }

    async prefillLevelIcons(content: ITerritoryLevelInfoContent): Promise<void> {
        const missing = content.drops.filter((drop) => !this.playerStageIcons.has(drop.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((drop) => this.loadPlayerStageIcon(drop.resId)));
        if (!this.host.isValid) return;
        if (this.host.state?.detail.levelInfo !== content) return;
        const opened = PopupManager.inst.get(LevelInfoPanel);
        if (!opened) return;
        opened.applyContent(this.levelInfoContentOf(content));
    }

    // =========================================================================
    // 关卡提示（LevelTip）
    // =========================================================================

    levelTipContentOf(content: ITerritoryLevelTipContent): ILevelTipContent {
        return {
            title: content.title,
            enemies: content.enemies.map((enemy): ILevelTipEnemy => ({
                icon: this.levelTipIcons.get(enemy.headIcon) ?? null,
                name: enemy.name,
                description: enemy.description,
            })),
            description: content.description,
        };
    }

    renderLevelTip(content: ITerritoryLevelTipContent | null): void {
        const revision = ++this.levelTipRevision;
        this.levelTipVisible = content !== null;
        if (!content) {
            this.closePopup(LevelTipPanel);
            return;
        }
        const opened = PopupManager.inst.get(LevelTipPanel);
        if (opened) {
            opened.applyContent(this.levelTipContentOf(content));
            void this.prefillLevelTipIcons(content, revision);
            return;
        }
        void LevelTipPanel.open({ userData: this.levelTipContentOf(content) }).then((panel) => {
            if (!this.host.isValid || !panel) return;
            if (revision !== this.levelTipRevision) {
                if (!this.levelTipVisible) panel.close();
                return;
            }
            panel.applyContent(this.levelTipContentOf(content));
            void this.prefillLevelTipIcons(content, revision);
        });
    }

    async prefillLevelTipIcons(content: ITerritoryLevelTipContent, revision = this.levelTipRevision): Promise<void> {
        const missing = content.enemies
            .map((enemy) => enemy.headIcon)
            .filter((path) => path !== '' && !this.levelTipIcons.has(path));
        if (missing.length === 0) return;
        const resolver = createIconArtResolver(await this.host.refRows<IconRow>(ICON_TABLE));
        if (!this.host.isValid || revision !== this.levelTipRevision) return;
        await Promise.all(missing.map(async (path) => {
            const target = resolver.resolve(path);
            if (!target) {
                console.warn(`[LevelTipPanel] 找不到敌军头像配置：${path}`);
                return;
            }
            try {
                const frame = await this.host.assets.load(spriteFramePath(target.root, target.art), SpriteFrame);
                if (this.host.isValid && frame.isValid) this.levelTipIcons.set(path, frame);
            } catch (error) {
                console.warn(`[LevelTipPanel] 敌军头像加载失败：${path}`, error);
            }
        }));
        if (!this.host.isValid || revision !== this.levelTipRevision) return;
        const opened = PopupManager.inst.get(LevelTipPanel);
        if (!opened) return;
        opened.applyContent(this.levelTipContentOf(content), true);
    }

    // =========================================================================
    // 玩家关卡（PlayerStage / BigMapPlayerLevelPanel）
    // =========================================================================

    playerStageContentOf(content: ITerritoryPlayerStageContent): IBigMapPlayerLevelContent {
        return {
            title: content.title,
            chestText: content.chestText,
            rewards: content.rewards.map((reward) => ({ resId: reward.resId, amount: reward.amount })),
            scoutCost: content.scoutCost,
            fightCost: content.fightCost,
            fightCaption: content.fightCaption,
            fightEnabled: content.fightEnabled,
            staminaIcon: this.host.staminaIcon,
        };
    }

    renderPlayerStage(content: ITerritoryPlayerStageContent): void {
        this.showPopupContent(BigMapPlayerLevelPanel, this.playerStageContentOf(content));
        void this.prefillPlayerStageIcons(content);
    }

    async prefillPlayerStageIcons(content: ITerritoryPlayerStageContent): Promise<void> {
        const missing = content.rewards.filter((reward) => !this.playerStageIcons.has(reward.resId));
        if (missing.length === 0) return;
        await Promise.all(missing.map((reward) => this.loadPlayerStageIcon(reward.resId)));
        if (!this.host.isValid) return;
        if (this.host.state?.detail.playerStage !== content) return;
        const opened = PopupManager.inst.get(BigMapPlayerLevelPanel);
        if (!opened) return;
        opened.applyContent(this.playerStageContentOf(content));
    }

    async loadPlayerStageIcon(resId: number): Promise<void> {
        if (this.playerStageIcons.has(resId)) return;
        let icon: SpriteFrame | null = null;
        let frame: SpriteFrame | null = null;
        try {
            const [propRows, itemRows] = await Promise.all([
                this.host.refRows<IResPropertyRow>(ROLE_PROPERTY_TABLE),
                this.host.refRows<IItemRefRow>(ITEM_TABLE),
            ]);
            const path = resBarIconSpritePath(resBarCellOfRefId(resId, propRows, itemRows));
            if (path) icon = await this.host.assets.load(path, SpriteFrame);
            const quality = Number(propRows.find((row) => Number(row.resId) === resId)?.quality);
            if (Number.isFinite(quality) && quality > 0) {
                const framePath = itemQualityFramePathOf(quality);
                frame = await this.host.assets.load(framePath, SpriteFrame).catch(() => null);
            }
        } catch {
            icon = null;
        }
        if (!this.host.isValid) return;
        this.playerStageIcons.set(resId, { frame, icon, amount: 0 });
    }
}
