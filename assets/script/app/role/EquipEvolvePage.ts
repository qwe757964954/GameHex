import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { AudioMgr } from '../../framework/audio/AudioMgr';
import { RedDot } from '../common/RedDot';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { GAME_AUDIO } from '../ResConst';
import { UiUpgradeFx } from '../common/UiUpgradeFx';
import { UI_UPGRADE_ANIMATION, type UiUpgradeAnimation } from '../common/UiUpgradeFxTable';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite } from './RoleArtLoader';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { EquipEvolveTab, type IRoleEquipCostFact, type IRoleEquipGrowth } from './RoleTypes';
import { EquipWashPopup } from './EquipWashPopup';
import { EquipEvolveAttrItem } from './EquipEvolveAttrItem';
import { EquipEvolveCostItem } from './EquipEvolveCostItem';
import { EquipEvolveSlotItem } from './EquipEvolveSlotItem';

const { ccclass, property } = _decorator;

/**
 * 百分比数值 → 文案：传入的 `hpPercent` / `nextHpPercent` 已是百分数（105 = 105%），
 * 这里只抹掉浮点尾巴，**不再 ×100**（否则 105 会显示成 10500）。
 */
function percentText(value: number): string {
    return String(Math.round(value * 100) / 100);
}

export interface IEquipEvolveOpenParams {
    partId?: number;
    tab?: EquipEvolveTab;
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

    @property({ type: Label, tooltip: '中间大图左上等级徽章（「N级」）' })
    goodsLevelLabel: Label = null!;

    @property({ type: Label, tooltip: '中间大图右下品阶（「Lv.N」）' })
    goodsRankLabel: Label = null!;

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

    @property({ type: RedDot, tooltip: '强化页签红点' })
    tabHeroRedDot: RedDot = null!;

    @property({ type: Node, tooltip: '升品页签选中态底图' })
    tabForgeOn: Node = null!;

    @property({ type: Node, tooltip: '升品页签未选中态底图' })
    tabForgeOff: Node = null!;

    @property({ type: Node, tooltip: '升品页签选中态文字图标' })
    tabForgeIconOn: Node = null!;

    @property({ type: Node, tooltip: '升品页签未选中态文字图标' })
    tabForgeIconOff: Node = null!;

    @property({ type: RedDot, tooltip: '升品页签红点' })
    tabForgeRedDot: RedDot = null!;

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

    @property({ type: RedDot, tooltip: '强化按钮红点' })
    buildBtnRedDot: RedDot = null!;

    @property({ type: RedDot, tooltip: '一键强化按钮红点' })
    buildAllBtnRedDot: RedDot = null!;

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

    @property({ type: RedDot, tooltip: '升品按钮红点' })
    upBtnRedDot: RedDot = null!;

    @property({ type: RedDot, tooltip: '洗炼按钮红点' })
    washBtnRedDot: RedDot = null!;

    @property({ type: Button, tooltip: '规则说明帮助按钮' })
    helpBtn: Button = null!;

    private currentPartId = 1;
    private currentTab: EquipEvolveTab = EquipEvolveTab.Strengthen;
    private currentGrowth: IRoleEquipGrowth | null = null;
    private sessionRevision = 0;
    /** 红点异步结果序号：装备切换 / 页签切换时丢弃过期结果。 */
    private redDotRevision = 0;
    private readonly equipIconCache = new Map<string, SpriteFrame>();
    private readonly costIconCache = new Map<string, SpriteFrame>();

    /**
     * 升级播放 `shengji`，强化播放 `shengjie`。两者共用升级成功音效。
     * 特效资源和节点归本次弹窗的资源作用域，每次打开时重新初始化。
     */
    private upgradeFx: UiUpgradeFx | null = null;

    protected onInit(): void {
        this.upgradeFx = new UiUpgradeFx(this.node);
        this.bindEvents();
        EventMgr.instance.on(RoleEvent.WashConfirmed, this.onWashConfirmed, this);
    }

    /**
     * 逐帧只推「字特效到点收起来」：`loop = false` 的骨架会停在最后一帧，
     * 不收就一直糊在屏幕中间。
     */
    public update(): void {
        this.upgradeFx?.step();
    }

    public onDestroy(): void {
        EventMgr.instance.off(RoleEvent.WashConfirmed, this.onWashConfirmed, this);
        this.upgradeFx?.reset();
        this.upgradeFx = null;
        super.onDestroy();
    }

    /** 弹窗交还（销毁 / 进池）时资源作用域要 dispose：字特效节点必须同一拍销毁。 */
    public _internalReleaseResources(): void {
        this.upgradeFx?.reset();
        super._internalReleaseResources();
    }

    private onWashConfirmed(): void {
        EventMgr.instance.emit(RoleEvent.EquipChanged);
        void this.refreshCurrentPart();
    }

    protected async onOpen(params?: IPopupOpenParams<IEquipEvolveOpenParams> | IEquipEvolveOpenParams): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as IEquipEvolveOpenParams | undefined;
        this.currentPartId = data?.partId && data.partId >= 1 && data.partId <= 6 ? data.partId : 1;
        this.currentTab = data?.tab === EquipEvolveTab.Upgrade ? EquipEvolveTab.Upgrade : EquipEvolveTab.Strengthen;
        // 每次 open 都是新的资源作用域：上一趟的预制与节点已经跟着 dispose 走了，
        // 不复位就永远只有第一次点「强化 / 升级」有字特效。
        this.upgradeFx?.reset();
        this.upgradeFx?.load(this.assets);
        this.updateTabDisplay();
        await this.refreshCurrentPart();
    }

    private bindEvents(): void {
        this.backBtn.node.on(Button.EventType.CLICK, () => this.close());
        this.tabHero.node.on(Button.EventType.CLICK, () => this.switchTab(EquipEvolveTab.Strengthen));
        this.tabForge.node.on(Button.EventType.CLICK, () => this.switchTab(EquipEvolveTab.Upgrade));

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

    private switchTab(tab: EquipEvolveTab): void {
        if (this.currentTab === tab) return;
        this.currentTab = tab;
        this.updateTabDisplay();
        this.renderGrowthData();
        void this.updateRedDots();
    }

    private updateTabDisplay(): void {
        const isStrengthen = this.currentTab === EquipEvolveTab.Strengthen;
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
        // 蓝湖设计稿：规则说明角标只出现在升级页。
        this.helpBtn.node.active = !isStrengthen;
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
                            slotItem.setData(sf, (i + 1) === this.currentPartId,
                                slotItem.hasRedDot, partData.level, partData.entry?.rank ?? 0);
                        }
                    });
                }
            }
            slotItem.setData(iconSf, selected, slotItem.hasRedDot, partData.level, partData.entry?.rank ?? 0);
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

    /** 中间大图等级徽章：底图与文字同属徽章节点（文字为子节点），隐藏徽章父节点即整体隐藏。 */
    private setGoodsLevel(level: number): void {
        const badge = this.goodsLevelLabel.node.parent;
        if (badge) badge.active = level > 0;
        else this.goodsLevelLabel.node.active = level > 0;
        this.goodsLevelLabel.string = `${level}级`;
    }

    private renderGrowthData(): void {
        const growth = this.currentGrowth;
        if (!growth) {
            this.setGoodsLevel(0);
            this.goodsRankLabel.node.active = false;
            return;
        }

        // 中间大图徽章（等级 + 品阶）与页签无关，两个分页共用；等级文字在徽章子节点里，整体随徽章隐藏。
        this.setGoodsLevel(growth.level);
        this.goodsRankLabel.node.active = growth.rank > 0;
        this.goodsRankLabel.string = `Lv.${growth.rank}`;

        if (this.currentTab === EquipEvolveTab.Strengthen) {
            const isMax = growth.level >= 100;
            this.maxLvLabel.node.active = isMax;
            this.curLvLabel.node.active = !isMax;
            this.nextLvLabel.node.active = !isMax;
            this.buildBtn.node.active = !isMax;
            this.buildAllBtn.node.active = !isMax;

            if (!isMax) {
                this.curLvLabel.string = `${growth.level}级`;
                this.nextLvLabel.string = `${growth.level + 1}级`;
            }

            // 蓝湖版式：左列「名称：当前值」，右列下一级；攻击力带 `+`，生命按百分比口径。
            // 数值全部取 `RoleRepository.equipmentGrowth`：`hpPercent` / `nextHpPercent` 已是百分数
            // （105 = 105%），页面只拼文案，不再 ×100，也不再自己编「×1.05」的下一级。
            const nextAtk = isMax ? undefined : growth.nextAttack;
            const nextHp = isMax ? undefined : growth.nextHpPercent;
            const rows = [
                { name: '全队攻击力：', cur: `+${growth.attack}`, next: nextAtk === undefined ? undefined : `+${nextAtk}` },
                { name: '生命百分比：', cur: `${percentText(growth.hpPercent)}`, next: nextHp === undefined ? undefined : `${percentText(nextHp)}%` },
            ];
            for (let i = 0; i < this.strengthenAttrItems.length; i++) {
                const item = this.strengthenAttrItems[i];
                const row = rows[i];
                if (!row) {
                    item.node.active = false;
                    continue;
                }
                item.setData(row.name, row.cur, row.next);
            }

            for (let i = 0; i < this.strengthenCostItems.length; i++) {
                this.renderCostItem(this.strengthenCostItems[i], isMax ? null : growth.levelCostFacts[i] ?? null);
            }
        } else {
            const isMaxQuality = !growth.qualityCostFact;
            this.qualityNowLabel.node.active = !isMaxQuality;
            this.qualityNowLabel.string = growth.rarityName;
            this.qualityNextLabel.node.active = !isMaxQuality;
            this.qualityNextLabel.string = growth.nextRarityName ?? growth.rarityName;
            this.qualityArrowNode.active = !isMaxQuality;
            this.qualityMaxLabel.node.active = isMaxQuality;
            this.qualityMaxLabel.string = growth.rarityName;

            for (let i = 0; i < this.upgradeAttrItems.length; i++) {
                const item = this.upgradeAttrItems[i];
                const row = growth.effectRows[i];
                if (!row) {
                    item.node.active = false;
                    continue;
                }
                item.setData(row.name, row.cur, isMaxQuality ? undefined : row.next);
            }

            this.renderCostItem(this.upgradeCostItems[0], growth.qualityCostFact);
            this.renderCostItem(this.washCostItems[0], growth.washCostFact);

            // 有洗炼时两颗 218×90 按钮按蓝湖按钮行对齐（102 / 399），无洗炼时升级按钮居中；
            // 消耗项跟随按钮左缘（升级单按钮态按蓝湖 318），坐标相对底部操作组（BottomGroup）。
            const showWash = !!growth.washCostFact;
            this.washBtn.node.active = showWash;
            this.upBtn.node.setPosition(showWash ? 102 : 251, -34, 0);
            const upCostItem = this.upgradeCostItems[0];
            if (upCostItem) upCostItem.node.setPosition(showWash ? 135 : 318, 0, 0);
            const washCostItem = this.washCostItems[0];
            if (washCostItem) washCostItem.node.setPosition(462, 0, 0);
        }
    }

    /** 消耗项：先上「持有/需求」与配色，再异步补图标；同一路径只取一次。 */
    private renderCostItem(item: EquipEvolveCostItem | undefined, fact: IRoleEquipCostFact | null): void {
        if (!item) return;
        if (!fact) {
            item.node.active = false;
            return;
        }
        const cached = this.costIconCache.get(fact.iconPath);
        item.setCost(fact, cached ?? null);
        if (cached || !fact.iconPath) return;
        void loadItemIconArt(fact.iconPath).then(sf => {
            if (!this.isValid || !sf) return;
            this.costIconCache.set(fact.iconPath, sf);
            if (item.node.active) item.setCost(fact, sf);
        });
    }

    // --- 红点计算与更新（与角色页共用 `RoleRepository.equipRedDots()`，口径见 RoleEquipRedDotTable） ---

    private async updateRedDots(): Promise<void> {
        const revision = ++this.redDotRevision;
        const dots = await roleRepository.equipRedDots();
        if (!this.isValid || revision !== this.redDotRevision) return;

        // 页签 / 按钮：强化与升品各自汇总；洗炼在升品页内，并入升品页签红点。
        this.tabHeroRedDot.setRedDot(dots.strengthen);
        this.tabForgeRedDot.setRedDot(dots.upgrade || dots.wash);
        this.buildAllBtnRedDot.setRedDot(dots.strengthen);

        const current = dots.parts[this.currentPartId - 1];
        this.buildBtnRedDot.setRedDot(current.strengthen);
        this.upBtnRedDot.setRedDot(current.upgrade);
        this.washBtnRedDot.setRedDot(current.wash);

        // 底部槽位红点跟随当前页签的可操作项（升品页把洗炼也算进来）。
        for (let i = 0; i < this.slotItems.length && i < dots.parts.length; i += 1) {
            const slot = this.slotItems[i];
            const part = dots.parts[i];
            slot.setRedDot(this.currentTab === EquipEvolveTab.Strengthen
                ? part.strengthen
                : part.upgrade || part.wash);
        }
    }

    private async onBuildClick(): Promise<void> {
        if (!this.currentGrowth) return;
        const status = await roleRepository.requestGrowth('CmdEquipUpLevelReqMsg', {
            id: this.currentGrowth.baseId,
            type: 0,
        }, this);
        if (status === 'ok') {
            this.playGrowthSuccess(UI_UPGRADE_ANIMATION.rankUp);
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
            EventMgr.instance.emit(RoleEvent.EquipChanged);
            EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 2 });
        }
    }

    private async onBuildAllClick(): Promise<void> {
        const status = await roleRepository.requestGrowth('CmdEquipUpLevelAllReqMsg', {}, this);
        if (status === 'ok') {
            // 一键强化与单件强化是同一件事，反馈必须一致
            this.playGrowthSuccess(UI_UPGRADE_ANIMATION.rankUp);
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
            EventMgr.instance.emit(RoleEvent.EquipChanged);
            EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 2 });
        }
    }

    private async onUpClick(): Promise<void> {
        if (!this.currentGrowth) return;
        const status = await roleRepository.requestGrowth('CmdEquipUpQualityReqMsg', {
            equipId: this.currentGrowth.baseId,
        }, this);
        if (status === 'ok') {
            // 「升级」（升品页签）⇒ 字特效用「升级成功」
            this.playGrowthSuccess(UI_UPGRADE_ANIMATION.levelUp);
            FW.showTip(ROLE_TEXTS.equipChanged);
            await this.refreshCurrentPart();
            EventMgr.instance.emit(RoleEvent.EquipChanged);
        }
    }

    /**
     * 装备养成成功的统一反馈：通用音效 + 屏正中的字特效。
     *
     * 两个都「拿不到就静默跳过」（音效表缺行 / 预制没进包）：设备静音或资源没到时，
     * 界面上的等级、品阶、消耗仍然是成功的 —— 反馈是加菜，不是成功判据。
     */
    private playGrowthSuccess(animation: UiUpgradeAnimation): void {
        void AudioMgr.instance.playSound(GAME_AUDIO.upgradeSuccess, this.resourceScope);
        this.upgradeFx?.play(animation);
    }

    private async onWashClick(): Promise<void> {
        const growth = this.currentGrowth;
        const context = this.popupOpenContext;
        if (!growth || !context) return;
        const status = await roleRepository.requestGrowth('CmdEquipWashReqMsg', {
            equipId: growth.baseId,
        }, this, response => {
            const newEffectIds = response.tlLibs ?? [];
            if (!newEffectIds.length || (response.equipId != null && response.equipId !== growth.baseId)) {
                FW.showTip(ROLE_TEXTS.failed);
                return;
            }
            void EquipWashPopup.open({
                userData: {
                    equipId: growth.baseId,
                    name: growth.name,
                    rank: growth.rank,
                    level: growth.level,
                    oldEffects: growth.effects,
                    washValues: growth.washValues,
                    newEffectIds,
                },
            });
        });
        if (context.cancelled) return;
        if (status === 'ok') {
            EventMgr.instance.emit(RoleEvent.EquipChanged);
        } else {
            FW.showTip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
        }
    }

    private onHelpClick(): void {
        FW.showTip('装备强化可提升基础属性，升品可提升品阶并解锁更多附加洗炼词条');
    }
}
