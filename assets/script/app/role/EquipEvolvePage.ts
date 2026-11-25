import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { CacheMgr } from '../net/CacheMgr';
import { RefUtil } from '../../framework/ref/RefUtil';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite } from './RoleArtLoader';
import type { IRoleEquipGrowth } from './RoleTypes';
import { equipLevelOf } from './RoleTable';
import { EquipWashPopup } from './EquipWashPopup';
import { EquipEvolveAttrItem } from './EquipEvolveAttrItem';
import { EquipEvolveCostItem } from './EquipEvolveCostItem';
import { EquipEvolveSlotItem } from './EquipEvolveSlotItem';

const { ccclass, property } = _decorator;

export interface IEquipEvolveOpenParams {
    partId?: number;
    tab?: 'strengthen' | 'upgrade';
}

/**
 * 装备锻造全屏界面（对齐 FGUI `组件_装备锻造_主界面.xml`、`强化分页.xml`、`升品分页.xml` 及老端 `LayerRoleEquipEvolve`）。
 *
 * 遵循组件属性绑定规范：所有节点与组件均通过 `@property` 声明并在 Prefab 中直接序列化绑定，
 * 严禁使用动态 `getChildByName` / `getComponent` 查找。
 */
@ccclass('EquipEvolvePage')
export class EquipEvolvePage extends PopupBase {
    static prefabPath = 'ui/Role/EquipEvolve';

    @property({ type: Sprite, tooltip: '全屏熔炉背景图' })
    bgSprite: Sprite = null!;

    @property({ type: Node, tooltip: '强化分页根节点' })
    pageStrengthen: Node = null!;

    @property({ type: Node, tooltip: '升品分页根节点' })
    pageUpgrade: Node = null!;

    @property({ type: Label, tooltip: '当前装备名称' })
    equipName: Label = null!;

    @property({ type: Node, tooltip: '中间大图展示节点' })
    goodsBox: Node = null!;

    @property({ type: Sprite, tooltip: '中间大图装备图标' })
    goodsIcon: Sprite = null!;

    @property({ type: Button, tooltip: '返回按钮' })
    backBtn: Button = null!;

    // --- Tab 按钮与高亮显隐 ---
    @property({ type: Button, tooltip: '强化页签按钮' })
    tabHero: Button = null!;

    @property({ type: Button, tooltip: '升品页签按钮' })
    tabForge: Button = null!;

    @property({ type: Node, tooltip: '强化页签选中态底图' })
    tabHeroOn: Node = null!;

    @property({ type: Node, tooltip: '强化页签未选中态底图' })
    tabHeroOff: Node = null!;

    @property({ type: Node, tooltip: '强化页签选中态文字图标' })
    tabHeroIconOn: Node = null!;

    @property({ type: Node, tooltip: '强化页签未选中态文字图标' })
    tabHeroIconOff: Node = null!;

    @property({ type: Node, tooltip: '强化页签红点' })
    tabHeroRedDot: Node = null!;

    @property({ type: Node, tooltip: '升品页签选中态底图' })
    tabForgeOn: Node = null!;

    @property({ type: Node, tooltip: '升品页签未选中态底图' })
    tabForgeOff: Node = null!;

    @property({ type: Node, tooltip: '升品页签选中态文字图标' })
    tabForgeIconOn: Node = null!;

    @property({ type: Node, tooltip: '升品页签未选中态文字图标' })
    tabForgeIconOff: Node = null!;

    @property({ type: Node, tooltip: '升品页签红点' })
    tabForgeRedDot: Node = null!;

    // --- 底部 6 格装备槽位组件列表 ---
    @property({ type: [EquipEvolveSlotItem], tooltip: '底部6个装备槽位组件' })
    slotItems: EquipEvolveSlotItem[] = [];

    // --- 强化分页子组件 ---
    @property({ type: Label, tooltip: '强化当前等级文字' })
    curLvLabel: Label = null!;

    @property({ type: Label, tooltip: '强化下一等级文字' })
    nextLvLabel: Label = null!;

    @property({ type: Label, tooltip: '强化满级文字（满级时显示，平时隐藏）' })
    maxLvLabel: Label = null!;

    @property({ type: [EquipEvolveAttrItem], tooltip: '强化属性项组件列表' })
    strengthenAttrItems: EquipEvolveAttrItem[] = [];

    @property({ type: [EquipEvolveCostItem], tooltip: '强化消耗项组件列表' })
    strengthenCostItems: EquipEvolveCostItem[] = [];

    @property({ type: Button, tooltip: '强化按钮' })
    buildBtn: Button = null!;

    @property({ type: Button, tooltip: '一键强化按钮' })
    buildAllBtn: Button = null!;

    @property({ type: Node, tooltip: '强化按钮红点' })
    buildBtnRedDot: Node = null!;

    @property({ type: Node, tooltip: '一键强化按钮红点' })
    buildAllBtnRedDot: Node = null!;

    // --- 升品/洗练分页子组件 ---
    @property({ type: Label, tooltip: '当前品阶文字' })
    qualityNowLabel: Label = null!;

    @property({ type: Label, tooltip: '下一品阶文字' })
    qualityNextLabel: Label = null!;

    @property({ type: Label, tooltip: '满品阶文字' })
    qualityMaxLabel: Label = null!;

    @property({ type: Node, tooltip: '品阶提升箭头' })
    qualityArrowNode: Node = null!;

    @property({ type: [EquipEvolveAttrItem], tooltip: '升品附加属性项组件列表' })
    upgradeAttrItems: EquipEvolveAttrItem[] = [];

    @property({ type: [EquipEvolveCostItem], tooltip: '升品消耗项组件列表' })
    upgradeCostItems: EquipEvolveCostItem[] = [];

    @property({ type: [EquipEvolveCostItem], tooltip: '洗练消耗项组件列表' })
    washCostItems: EquipEvolveCostItem[] = [];

    @property({ type: Button, tooltip: '升品按钮' })
    upBtn: Button = null!;

    @property({ type: Button, tooltip: '洗练按钮' })
    washBtn: Button = null!;

    @property({ type: Node, tooltip: '升品按钮红点' })
    upBtnRedDot: Node = null!;

    @property({ type: Button, tooltip: '规则说明帮助按钮' })
    helpBtn: Button = null!;

    private currentPartId = 1;
    private currentTab: 'strengthen' | 'upgrade' = 'strengthen';
    private currentGrowth: IRoleEquipGrowth | null = null;
    private sessionRevision = 0;
    private readonly equipIconCache = new Map<string, SpriteFrame>();

    protected onInit(): void {
        this.bindEvents();
        EventMgr.instance.on(RoleEvent.WashConfirmed, this.onWashConfirmed, this);
    }

    public onDestroy(): void {
        EventMgr.instance.off(RoleEvent.WashConfirmed, this.onWashConfirmed, this);
        super.onDestroy();
    }

    private onWashConfirmed(): void {
        void this.refreshCurrentPart();
    }

    protected async onOpen(params?: IPopupOpenParams<IEquipEvolveOpenParams> | IEquipEvolveOpenParams): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as IEquipEvolveOpenParams | undefined;
        this.currentPartId = data?.partId && data.partId >= 1 && data.partId <= 6 ? data.partId : 1;
        this.currentTab = data?.tab === 'upgrade' ? 'upgrade' : 'strengthen';
        this.updateTabDisplay();
        await this.refreshCurrentPart();
    }

    private bindEvents(): void {
        this.backBtn.node.on(Button.EventType.CLICK, () => this.close());
        this.tabHero.node.on(Button.EventType.CLICK, () => this.switchTab('strengthen'));
        this.tabForge.node.on(Button.EventType.CLICK, () => this.switchTab('upgrade'));

        this.buildBtn.node.on(Button.EventType.CLICK, this.onBuildClick, this);
        this.buildAllBtn.node.on(Button.EventType.CLICK, this.onBuildAllClick, this);
        this.upBtn.node.on(Button.EventType.CLICK, this.onUpClick, this);
        this.washBtn.node.on(Button.EventType.CLICK, this.onWashClick, this);
        this.helpBtn.node.on(Button.EventType.CLICK, this.onHelpClick, this);

        // 底部 6 格装备槽位点击
        for (let i = 0; i < this.slotItems.length; i++) {
            const partId = i + 1;
            const slot = this.slotItems[i];
            if (slot.button) {
                slot.button.node.on(Button.EventType.CLICK, () => this.selectPart(partId));
            } else {
                slot.node.on(Button.EventType.CLICK, () => this.selectPart(partId));
            }
        }
    }

    private switchTab(tab: 'strengthen' | 'upgrade'): void {
        if (this.currentTab === tab) return;
        this.currentTab = tab;
        this.updateTabDisplay();
        this.renderGrowthData();
        void this.updateRedDots();
    }

    private updateTabDisplay(): void {
        const isStrengthen = this.currentTab === 'strengthen';
        this.pageStrengthen.active = isStrengthen;
        this.pageUpgrade.active = !isStrengthen;

        // 彻底解决页签文字双层重叠：背景与文字图标严格同步高亮切换
        this.tabHeroOn.active = isStrengthen;
        this.tabHeroOff.active = !isStrengthen;
        this.tabHeroIconOn.active = isStrengthen;
        this.tabHeroIconOff.active = !isStrengthen;

        this.tabForgeOn.active = !isStrengthen;
        this.tabForgeOff.active = isStrengthen;
        this.tabForgeIconOn.active = !isStrengthen;
        this.tabForgeIconOff.active = isStrengthen;
    }

    private async selectPart(partId: number): Promise<void> {
        if (this.currentPartId === partId) return;
        this.currentPartId = partId;
        await this.refreshCurrentPart();
    }

    private async refreshCurrentPart(): Promise<void> {
        const revision = ++this.sessionRevision;
        const growth = await roleRepository.equipmentGrowth(null, this.currentPartId);
        if (!this.isValid || revision !== this.sessionRevision) return;
        this.currentGrowth = growth;
        this.renderAll();
        void this.updateRedDots();
    }

    private renderAll(): void {
        this.renderEquipList();
        this.renderCenterIcon();
        this.renderGrowthData();
    }

    private renderEquipList(): void {
        const parts = roleRepository.equipParts();
        for (let i = 0; i < this.slotItems.length && i < parts.length; i++) {
            const slotItem = this.slotItems[i];
            const partData = parts[i];
            const selected = (i + 1) === this.currentPartId;

            let iconSf: SpriteFrame | null = null;
            if (partData.entry?.iconKey) {
                iconSf = this.equipIconCache.get(partData.entry.iconKey) ?? null;
                if (!iconSf) {
                    void loadRoleBagIconSprite('equip', partData.entry.iconKey).then(sf => {
                        if (this.isValid && sf && partData.entry?.iconKey) {
                            this.equipIconCache.set(partData.entry.iconKey, sf);
                            slotItem.setData(sf, (i + 1) === this.currentPartId, slotItem.redDotNode?.active ?? false);
                        }
                    });
                }
            }
            slotItem.setData(iconSf, selected, slotItem.redDotNode?.active ?? false);
        }
    }

    private renderCenterIcon(): void {
        if (!this.currentGrowth) {
            this.equipName.string = ROLE_TEXTS.equipEmpty;
            return;
        }
        this.equipName.string = this.currentGrowth.name || `部位 ${this.currentPartId}`;

        const parts = roleRepository.equipParts();
        const curPart = parts.find(p => p.partId === this.currentPartId);
        if (curPart?.entry?.iconKey) {
            const cachedSf = this.equipIconCache.get(curPart.entry.iconKey);
            if (cachedSf) {
                this.goodsIcon.spriteFrame = cachedSf;
            } else {
                void loadRoleBagIconSprite('equip', curPart.entry.iconKey).then(sf => {
                    if (this.isValid && sf && curPart?.entry?.iconKey) {
                        this.equipIconCache.set(curPart.entry.iconKey, sf);
                        this.goodsIcon.spriteFrame = sf;
                    }
                });
            }
        }
    }

    private renderGrowthData(): void {
        const growth = this.currentGrowth;
        if (!growth) return;

        if (this.currentTab === 'strengthen') {
            const isMax = growth.level >= 100;
            this.maxLvLabel.node.active = isMax;
            this.curLvLabel.node.active = !isMax;
            this.nextLvLabel.node.active = !isMax;
            this.buildBtn.node.active = !isMax;
            this.buildAllBtn.node.active = !isMax;

            if (!isMax) {
                this.curLvLabel.string = growth.level > 0 ? `Lv.${growth.level}` : 'Lv.0';
                this.nextLvLabel.string = `Lv.${growth.level + 1}`;
            }

            // 属性列表渲染（纯组件直接赋值，无 getChildByName）
            const nextAtk = growth.nextAttack ?? Math.round(growth.attack * 1.05) + 5;
            const nextHp = growth.nextHpPercent ?? (growth.hpPercent + 0.05);
            const stats = [
                { name: '攻击力', cur: growth.attack, next: nextAtk },
                { name: '全队生命', cur: `${Math.round(growth.hpPercent * 100)}%`, next: `${Math.round(nextHp * 100)}%` },
            ];

            for (let i = 0; i < this.strengthenAttrItems.length; i++) {
                const item = this.strengthenAttrItems[i];
                if (i < stats.length) {
                    const s = stats[i];
                    item.setData(s.name, s.cur, s.next, isMax);
                } else {
                    item.node.active = false;
                }
            }

            // 消耗材料渲染
            for (let i = 0; i < this.strengthenCostItems.length; i++) {
                const item = this.strengthenCostItems[i];
                if (i < growth.levelCost.length && !isMax) {
                    item.setData(growth.levelCost[i]);
                } else {
                    item.node.active = false;
                }
            }
        } else {
            // 升品与洗练
            const isMaxQuality = !growth.qualityCost;
            const rankText = `${growth.rank || 1}阶`;
            const nextRankText = `${(growth.rank || 1) + 1}阶`;
            if (this.qualityNowLabel) {
                this.qualityNowLabel.node.active = !isMaxQuality;
                this.qualityNowLabel.string = rankText;
            }
            if (this.qualityNextLabel) {
                this.qualityNextLabel.node.active = !isMaxQuality;
                this.qualityNextLabel.string = nextRankText;
            }
            if (this.qualityArrowNode) {
                this.qualityArrowNode.active = !isMaxQuality;
            }
            if (this.qualityMaxLabel) {
                this.qualityMaxLabel.node.active = isMaxQuality;
                this.qualityMaxLabel.string = rankText;
            }

            for (let i = 0; i < this.upgradeAttrItems.length; i++) {
                const item = this.upgradeAttrItems[i];
                if (i < growth.effects.length) {
                    item.setData('附加属性', growth.effects[i]);
                } else {
                    item.node.active = false;
                }
            }

            if (this.upgradeCostItems[0]) {
                if (growth.qualityCost) {
                    this.upgradeCostItems[0].setData(growth.qualityCost);
                } else {
                    this.upgradeCostItems[0].node.active = false;
                }
            }

            const showWash = !!growth.washCost;
            this.washBtn.node.active = showWash;
            this.upBtn.node.setPosition(showWash ? 68 : 205, -341, 0);

            if (this.washCostItems[0]) {
                if (growth.washCost) {
                    this.washCostItems[0].setData(growth.washCost);
                } else {
                    this.washCostItems[0].node.active = false;
                }
            }
        }
    }

    // --- 红点计算与更新（对齐老端 VOEquipPage 及 ModelEquip） ---

    private async checkCanStrengthen(partId: number): Promise<boolean> {
        const cache = CacheMgr.instance;
        const part = cache.getCmdEquipPart(partId);
        if (!part?.equip) return false;
        const page = cache.getTlCmdRole()[0]?.selectEquipPage;
        const selected = page == null ? null : cache.getCmdEquipPage(page);
        // 分页行的 equipId 是装备 resId；part.equip.baseId 是初始部位 1..6，不能拿来比。
        const level = equipLevelOf(selected?.tlCmdEquip, part.equip.resId);
        if (level >= 100) return false;

        const ref = RefUtil.instance;
        const [item, nextLevel] = await Promise.all([
            ref.getRefAsync('equip', 'resId', part.equip.resId),
            ref.getRefAsync('equipLevel', 'equipLevel', level + 1),
        ]) as [Record<string, unknown> | undefined, Record<string, unknown> | undefined];

        if (!item || !nextLevel) return false;
        const userGold = Number(cache.getTlCmdRole()[0]?.gold ?? 0);
        const userDrawings = Number(cache.getCmdItem(Number(item.consumeId))?.number ?? 0);
        const needGold = Number(nextLevel.gold ?? 0);
        const needDrawings = Number(nextLevel.drawings ?? 0);

        return userGold >= needGold && userDrawings >= needDrawings;
    }

    private async checkCanUpgrade(partId: number): Promise<boolean> {
        const cache = CacheMgr.instance;
        const part = cache.getCmdEquipPart(partId);
        if (!part?.equip) return false;

        const ref = RefUtil.instance;
        const [nextRank, costConfig] = await Promise.all([
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], part.equip.rank, part.equip.curQuality + 1),
            ref.getRefAsync('gameConfig', 'key', 'equipAddQualityCostId'),
        ]) as [Record<string, unknown> | undefined, Record<string, unknown> | undefined];

        if (!nextRank || !costConfig) return false;
        const costResId = Number(costConfig.value ?? 0);
        const userMaterial = Number(cache.getCmdItem(costResId)?.number ?? 0);
        const needMaterial = Number(nextRank.cost ?? 0);

        return userMaterial >= needMaterial;
    }

    private async updateRedDots(): Promise<void> {
        const parts = roleRepository.equipParts();
        let anyCanStrengthen = false;
        let anyCanUpgrade = false;

        for (let i = 0; i < parts.length && i < this.slotItems.length; i++) {
            const p = parts[i];
            const canSt = await this.checkCanStrengthen(p.partId);
            const canUp = await this.checkCanUpgrade(p.partId);
            if (canSt) anyCanStrengthen = true;
            if (canUp) anyCanUpgrade = true;

            const hasRd = this.currentTab === 'strengthen' ? canSt : canUp;
            if (this.slotItems[i]?.redDotNode) {
                this.slotItems[i].redDotNode.active = hasRd;
            }
        }

        if (this.tabHeroRedDot) this.tabHeroRedDot.active = anyCanStrengthen;
        if (this.tabForgeRedDot) this.tabForgeRedDot.active = anyCanUpgrade;
        if (this.buildAllBtnRedDot) this.buildAllBtnRedDot.active = anyCanStrengthen;

        const curCanSt = await this.checkCanStrengthen(this.currentPartId);
        const curCanUp = await this.checkCanUpgrade(this.currentPartId);
        if (this.buildBtnRedDot) this.buildBtnRedDot.active = curCanSt;
        if (this.upBtnRedDot) this.upBtnRedDot.active = curCanUp;
    }

    private async onBuildClick(): Promise<void> {
        if (!this.currentGrowth) return;
        const status = await roleRepository.requestGrowth('CmdEquipUpLevelReqMsg', {
            id: this.currentGrowth.baseId,
            type: 0,
        }, this);
        if (status === 'ok') {
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
            EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 2 });
        }
    }

    private async onBuildAllClick(): Promise<void> {
        const status = await roleRepository.requestGrowth('CmdEquipUpLevelAllReqMsg', {}, this);
        if (status === 'ok') {
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
            EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 2 });
        }
    }

    private async onUpClick(): Promise<void> {
        if (!this.currentGrowth) return;
        const status = await roleRepository.requestGrowth('CmdEquipUpQualityReqMsg', {
            equipId: this.currentGrowth.baseId,
        }, this);
        if (status === 'ok') {
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
        }
    }

    private async onWashClick(): Promise<void> {
        if (!this.currentGrowth) return;
        const status = await roleRepository.requestGrowth('CmdEquipWashReqMsg', {
            equipId: this.currentGrowth.baseId,
        }, this, response => {
            const rsp = response as any;
            const newEffects: number[] = rsp?.tlLibs ?? rsp?.tlCurEffects ?? [];
            if (newEffects.length) {
                void EquipWashPopup.open({
                    userData: {
                        equipId: this.currentGrowth!.baseId,
                        name: this.currentGrowth!.name,
                        rank: this.currentGrowth!.rank,
                        level: this.currentGrowth!.level,
                        oldEffects: this.currentGrowth!.effects,
                        newEffectIds: newEffects,
                    }
                });
            }
        });
        if (status === 'ok') {
            FW.showTip(ROLE_TEXTS.equipWash);
        }
    }

    private onHelpClick(): void {
        FW.showTip('装备强化可提升基础属性，升品可提升品阶并解锁更多附加洗炼词条');
    }
}
