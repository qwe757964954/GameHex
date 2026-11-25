import { _decorator, Button, Color, Component, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason, type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleEquipGrowth, IRoleGemEntry, IRoleGemSocket } from './RoleTypes';
import { EquipEvolvePage } from './EquipEvolvePage';
import { RoleEquipGemItem } from './RoleEquipGemItem';

const { ccclass, property } = _decorator;

export interface IRoleEquipInfoPopupOpenParams {
    partId: number;
    bagUniqueId?: string;
    onForgeClick?: (partId: number) => void;
    onChanged?: () => void;
}

const PART_NAMES: Readonly<Record<number, string>> = {
    1: '头盔',
    2: '胸甲',
    3: '武器',
    4: '护腿',
    5: '护腕',
    6: '靴子',
};

const QUALITY_NAMES: Readonly<Record<number, string>> = {
    1: '普通',
    2: '精良',
    3: '优秀',
    4: '史诗',
    5: '传说',
    6: '绝世',
    7: '神话',
};

type EquipDetailTab = 'equip' | 'gem';

/**
 * 装备详情卡片弹窗（对齐 FGUI `组件_共用弹窗_操作装备.xml` 及老端 `LayerEquipInfoByRole`）。
 *
 * 点击角色穿戴槽位或背包装备时调起。
 * 包含：
 *   - 装备图标、品阶与品质名称（如 传说.手套）；
 *   - 基础属性与附加属性分栏；
 *   - 左右箭头快速切换 1..6 部位；
 *   - 装备属性 / 宝石镶嵌分页切换；
 *   - 底部「装备锻造」按钮（点击直接打开全屏锻造界面）；
 *   - 点击背景深色遮罩或关闭按钮安全退出。
 */
@ccclass('RoleEquipInfoPopup')
export class RoleEquipInfoPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleEquipInfoPopup';

    @property({ type: Node, tooltip: '弹窗主背景板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Label, tooltip: '标题文本（如 手套 / 装备详情）' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: '装备名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '品阶标识（如 5阶）' })
    rankLabel: Label = null!;

    @property({ type: Label, tooltip: '等级文字（如 Lv.8）' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: '部位文字（如 部位：手套）' })
    partLabel: Label = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    iconSprite: Sprite = null!;

    @property({ type: Node, tooltip: '装备属性面板容器' })
    equipViewRoot: Node = null!;

    @property({ type: Label, tooltip: '基础属性展示文本' })
    baseAttrLabel: Label = null!;

    @property({ type: Label, tooltip: '附加属性展示文本' })
    extraAttrLabel: Label = null!;

    @property({ type: Node, tooltip: '宝石镶嵌面板容器' })
    gemViewRoot: Node = null!;

    @property({ type: Node, tooltip: '镶嵌宝石列表根节点' })
    gemListRoot: Node = null!;

    @property({ type: [RoleEquipGemItem], tooltip: '镶嵌宝石槽位项组件列表' })
    gemItems: RoleEquipGemItem[] = [];

    @property({ type: Button, tooltip: '装备属性页签' })
    tabEquipBtn: Button = null!;

    @property({ type: Button, tooltip: '宝石镶嵌页签' })
    tabGemBtn: Button = null!;

    @property({ type: Button, tooltip: '装备锻造主按钮' })
    btnForge: Button = null!;

    @property({ type: Label, tooltip: '装备锻造按钮文本' })
    btnForgeTitle: Label = null!;

    @property({ type: Button, tooltip: '卸下 / 方案清空按钮' })
    btnDestroyGems: Button = null!;

    @property({ type: Label, tooltip: '卸下按钮文本' })
    btnDestroyGemsTitle: Label = null!;

    @property({ type: Button, tooltip: '左切换部位箭头' })
    btnLeft: Button = null!;

    @property({ type: Button, tooltip: '右切换部位箭头' })
    btnRight: Button = null!;

    @property({ type: Button, tooltip: '关闭弹窗按钮' })
    btnClose: Button = null!;

    private currentPartId = 1;
    private currentBagId: string | null = null;
    private currentGrowth: IRoleEquipGrowth | null = null;
    private currentTab: EquipDetailTab = 'equip';
    private sessionRevision = 0;
    private onForgeCallback?: (partId: number) => void;
    private onChangedCallback?: () => void;

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(params?: IPopupOpenParams<IRoleEquipInfoPopupOpenParams> | IRoleEquipInfoPopupOpenParams): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as IRoleEquipInfoPopupOpenParams | undefined;
        this.currentPartId = data?.partId && data.partId >= 1 && data.partId <= 6 ? data.partId : 1;
        this.currentBagId = data?.bagUniqueId ?? null;
        this.onForgeCallback = data?.onForgeClick;
        this.onChangedCallback = data?.onChanged;
        this.currentTab = 'equip';

        this.contentNodes = [this.popBg];
        await this.refresh();
    }

    private bindEvents(): void {
        this.btnClose.node.on(Button.EventType.CLICK, () => this.close(PopupCloseReason.CloseButton), this);
        this.btnForge.node.on(Button.EventType.CLICK, this.onForgeClick, this);
        this.btnDestroyGems.node.on(Button.EventType.CLICK, this.onDestroyOrDownClick, this);
        this.btnLeft.node.on(Button.EventType.CLICK, () => this.switchPart(-1), this);
        this.btnRight.node.on(Button.EventType.CLICK, () => this.switchPart(1), this);
        this.tabEquipBtn.node.on(Button.EventType.CLICK, () => this.switchTab('equip'), this);
        this.tabGemBtn.node.on(Button.EventType.CLICK, () => this.switchTab('gem'), this);
    }

    private switchTab(tab: EquipDetailTab): void {
        if (this.currentTab === tab) return;
        this.currentTab = tab;
        this.updateTabDisplay();
    }

    private updateTabDisplay(): void {
        const isEquip = this.currentTab === 'equip';
        this.equipViewRoot.active = isEquip;
        this.gemViewRoot.active = !isEquip;

        this.btnDestroyGems.node.active = !isEquip;
        if (!isEquip) {
            this.btnDestroyGems.node.setPosition(-120, -370, 0);
            this.btnDestroyGemsTitle.string = '宝石方案清空';
        }

        this.btnForge.node.active = true;
        this.btnForge.node.setPosition(isEquip ? 0 : 120, -370, 0);
        this.btnForgeTitle.string = isEquip ? '装备锻造' : '前往锻造';
    }

    private async switchPart(delta: number): Promise<void> {
        let next = this.currentPartId + delta;
        if (next < 1) next = 6;
        if (next > 6) next = 1;
        this.currentPartId = next;
        this.currentBagId = null;
        await this.refresh();
    }

    public async refresh(): Promise<void> {
        const revision = ++this.sessionRevision;
        const growth = await roleRepository.equipmentGrowth(this.currentBagId, this.currentBagId ? null : this.currentPartId);
        if (!this.isValid || revision !== this.sessionRevision) return;
        this.currentGrowth = growth;
        if (growth?.baseId && growth.baseId >= 1 && growth.baseId <= 6) {
            this.currentPartId = growth.baseId;
        }
        this.renderView();
    }

    private renderView(): void {
        const growth = this.currentGrowth;
        const equipName = growth?.name || PART_NAMES[this.currentPartId] || '装备';
        const partName = PART_NAMES[this.currentPartId] ?? equipName;

        this.titleLabel.string = equipName;

        if (!growth) {
            this.nameLabel.string = ROLE_TEXTS.equipEmpty;
            this.rankLabel.string = '';
            this.levelLabel.string = '';
            this.partLabel.string = `部位：${partName}`;
            this.baseAttrLabel.string = '暂无装备';
            this.extraAttrLabel.string = '暂无附加属性';
            this.updateTabDisplay();
            return;
        }

        const qualityName = QUALITY_NAMES[growth.rank] ?? '普通';
        this.nameLabel.string = `${qualityName}.${equipName}`;
        this.rankLabel.string = `品阶：${growth.rank}阶`;
        this.levelLabel.string = `等级：${growth.level}`;
        this.partLabel.string = `部位：${partName}`;

        // 图标与品质底框加载（区分背包指定物品与部位穿戴物品）
        let iconKey: string | null = null;
        let quality = growth.rank || 1;
        if (this.currentBagId) {
            const bagEntry = roleRepository.findBagEntry('equip', this.currentBagId);
            iconKey = bagEntry?.iconKey ?? null;
            if (bagEntry?.quality) quality = bagEntry.quality;
        }
        if (!iconKey) {
            const parts = roleRepository.equipParts();
            const curPart = parts.find(p => p.partId === this.currentPartId);
            iconKey = curPart?.entry?.iconKey ?? null;
            if (curPart?.entry?.quality) quality = curPart.entry.quality;
        }
        if (iconKey) {
            void loadRoleBagIconSprite('equip', iconKey).then(sf => {
                if (this.isValid && sf) {
                    this.iconSprite.spriteFrame = sf;
                }
            });
        }
        const cardFrame = this.iconSprite.node.parent?.getComponent(Sprite);
        if (cardFrame) {
            void loadRoleQualityFrame(quality).then(sf => {
                if (this.isValid && sf) {
                    cardFrame.spriteFrame = sf;
                }
            });
        }

        // 基础属性与附加属性
        const lines: string[] = [];
        if (growth.attack > 0) lines.push(`全队攻击  +${growth.attack}`);
        if (growth.hpPercent > 0) lines.push(`全队生命  +${growth.hpPercent}%`);
        if (lines.length === 0) lines.push(`全队生命  +${195 + (growth.level || 0) * 10}`);
        if (growth.level > 0) lines.push(`强化  +${growth.level * 10}`);
        this.baseAttrLabel.string = lines.join('\n');

        // 附加属性 = 装备洗练属性（`effects`）+ 已镶嵌宝石属性（`gemEffects`）；
        // 宝石不参与 `washValues` 下标，两者在数据层就分列（见 IRoleEquipGrowth）。
        const extraLines = [...growth.effects, ...growth.gemEffects];
        this.extraAttrLabel.string = extraLines.length > 0 ? extraLines.join('\n') : '暂无附加属性';

        // 渲染宝石孔位
        this.renderGems();
        this.updateTabDisplay();
    }

    private renderGems(): void {
        const partSlot = roleRepository.equipParts().find(p => p.partId === this.currentPartId);
        const sockets = partSlot?.sockets ?? [];
        for (let i = 0; i < this.gemItems.length; i++) {
            this.gemItems[i].setData(sockets[i], socket => this.handleGemDown(socket));
        }
    }

    private async handleGemDown(socket: IRoleGemSocket): Promise<void> {
        const status = await roleRepository.changeGem({
            kind: 'down',
            payload: { equipId: socket.equipId, page: socket.page, order: socket.order },
        }, this);
        if (status === 'ok') {
            await roleRepository.load();
            this.onChangedCallback?.();
        }
        await this.refresh();
    }

    private onForgeClick(): void {
        const targetPart = this.currentPartId;
        this.close(PopupCloseReason.Manual);
        if (this.onForgeCallback) {
            this.onForgeCallback(targetPart);
        } else {
            void EquipEvolvePage.open({
                userData: {
                    partId: targetPart,
                }
            });
        }
    }

    private async onDestroyOrDownClick(): Promise<void> {
        if (this.currentTab === 'gem') {
            const partSlot = roleRepository.equipParts().find(p => p.partId === this.currentPartId);
            for (const socket of partSlot?.sockets ?? []) {
                if (socket.gemId) {
                    await roleRepository.changeGem({
                        kind: 'down',
                        payload: { equipId: socket.equipId, page: socket.page, order: socket.order },
                    }, this);
                }
            }
            await roleRepository.load();
            this.onChangedCallback?.();
            FW.showTip('已清空宝石方案');
            await this.refresh();
        }
    }
}
