import {
    _decorator, Button, Color, Label, Node, Sprite,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason, type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleEquipGrowth, IRoleGemSocket } from './RoleTypes';
import { RoleEquipGemItem } from './RoleEquipGemItem';
import { RoleStatRow, splitStatLine, type RoleStatTone } from './RoleStatRow';

const { ccclass, property } = _decorator;

export interface IRoleEquipInfoPopupOpenParams {
    partId: number;
    bagUniqueId?: string;
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

const CREAM = new Color(255, 243, 218, 255);
const INK = new Color(58, 35, 19, 255);
const CHIP_PART = new Color(231, 217, 201, 255);
const CHIP_GREEN = new Color(169, 195, 154, 255);
const CHIP_GRAY = new Color(183, 176, 163, 255);
const QUALITY_CHIP_COLORS: Readonly<Record<number, Color>> = {
    1: new Color(183, 176, 163, 255),
    2: new Color(143, 191, 122, 255),
    3: new Color(111, 168, 214, 255),
    4: new Color(185, 137, 201, 255),
    5: new Color(230, 161, 92, 255),
    6: new Color(217, 122, 108, 255),
    7: new Color(217, 180, 94, 255),
};

type EquipDetailTab = 'equip' | 'gem';

/**
 * 装备详情卡片弹窗（第四版布局）。
 *
 * 复用巡逻宝箱同源切图：米纸面板、木牌标题、红圆关闭、内衬板、行式属性、蓝/橙按钮。
 * 顶部两页签使用角色页现有灰轨与橙色选中态；等级使用卡牌升级的蓝色盾牌。
 */
@ccclass('RoleEquipInfoPopup')
export class RoleEquipInfoPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleEquipInfoPopup';

    @property({ type: Node, tooltip: '弹窗内容面板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Label, tooltip: '木牌标题（部位名）' })
    titleLabel: Label = null!;

    @property({ type: Sprite, tooltip: '头部品质底' })
    iconFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '装备名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '品质 Chip' })
    qualityChipLabel: Label = null!;

    @property({ type: Sprite, tooltip: '品质 Chip 底' })
    qualityChipBg: Sprite = null!;

    @property({ type: Label, tooltip: '部位 Chip' })
    partChipLabel: Label = null!;

    @property({ type: Label, tooltip: '装备状态 Chip' })
    statusChipLabel: Label = null!;

    @property({ type: Sprite, tooltip: '装备状态 Chip 底' })
    statusChipBg: Sprite = null!;

    @property({ type: Label, tooltip: '副标题' })
    subLabel: Label = null!;

    @property({ type: Node, tooltip: '蓝色等级盾牌' })
    levelBadge: Node = null!;

    @property({ type: Label, tooltip: '等级数值' })
    levelValueLabel: Label = null!;

    @property({ type: Button, tooltip: '装备属性页签' })
    tabEquipBtn: Button = null!;

    @property({ type: Button, tooltip: '宝石镶嵌页签' })
    tabGemBtn: Button = null!;

    @property({ type: Node, tooltip: '装备页签橙色选中底' })
    tabEquipActive: Node = null!;

    @property({ type: Node, tooltip: '宝石页签橙色选中底' })
    tabGemActive: Node = null!;

    @property({ type: Label, tooltip: '装备页签文字' })
    tabEquipLabel: Label = null!;

    @property({ type: Label, tooltip: '宝石页签文字' })
    tabGemLabel: Label = null!;

    @property({ type: Label, tooltip: '装备页签描边' })
    tabEquipOutline: Label = null!;

    @property({ type: Label, tooltip: '宝石页签描边' })
    tabGemOutline: Label = null!;

    @property({ type: Node, tooltip: '装备属性面板容器' })
    equipViewRoot: Node = null!;

    @property({ type: Node, tooltip: '属性行容器（无装备时隐藏）' })
    attrContentRoot: Node = null!;

    @property({ type: Node, tooltip: '无装备提示' })
    emptyTip: Node = null!;

    @property({ type: [RoleStatRow], tooltip: '基础属性行（3 行）' })
    baseRows: RoleStatRow[] = [];

    @property({ type: [RoleStatRow], tooltip: '附加属性行（4 行）' })
    extraRows: RoleStatRow[] = [];

    @property({ type: Node, tooltip: '宝石镶嵌面板容器' })
    gemViewRoot: Node = null!;

    @property({ type: [RoleEquipGemItem], tooltip: '宝石槽位行（5 行）' })
    gemItems: RoleEquipGemItem[] = [];

    @property({ type: Button, tooltip: '装备锻造 / 前往锻造按钮' })
    btnForge: Button = null!;

    @property({ type: Label, tooltip: '装备锻造按钮文字' })
    btnForgeTitle: Label = null!;

    @property({ type: Button, tooltip: '宝石方案清空按钮' })
    btnDestroyGems: Button = null!;

    @property({ type: Label, tooltip: '宝石方案清空按钮文字' })
    btnDestroyGemsTitle: Label = null!;

    @property({ type: Button, tooltip: '关闭弹窗按钮' })
    btnClose: Button = null!;

    private currentPartId = 1;
    private currentBagId: string | null = null;
    private currentGrowth: IRoleEquipGrowth | null = null;
    private currentTab: EquipDetailTab = 'equip';
    private sessionRevision = 0;

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(
        params?: IPopupOpenParams<IRoleEquipInfoPopupOpenParams> | IRoleEquipInfoPopupOpenParams,
    ): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as
            IRoleEquipInfoPopupOpenParams | undefined;
        this.currentPartId = data?.partId && data.partId >= 1 && data.partId <= 6 ? data.partId : 1;
        this.currentBagId = data?.bagUniqueId ?? null;
        this.currentTab = 'equip';

        this.contentNodes = [this.popBg];
        await this.refresh();
    }

    private bindEvents(): void {
        this.btnClose.node.on(Button.EventType.CLICK, () => this.close(PopupCloseReason.CloseButton));
        this.btnForge.node.on(Button.EventType.CLICK, this.onForgeClick, this);
        this.btnDestroyGems.node.on(Button.EventType.CLICK, this.onDestroyOrDownClick, this);
        this.tabEquipBtn.node.on(Button.EventType.CLICK, () => this.switchTab('equip'));
        this.tabGemBtn.node.on(Button.EventType.CLICK, () => this.switchTab('gem'));
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

        this.tabEquipActive.active = isEquip;
        this.tabGemActive.active = !isEquip;
        this.tabEquipLabel.color = isEquip ? CREAM : INK;
        this.tabGemLabel.color = isEquip ? INK : CREAM;
        if (this.tabEquipOutline) this.tabEquipOutline.enableOutline = isEquip;
        if (this.tabGemOutline) this.tabGemOutline.enableOutline = !isEquip;

        this.btnDestroyGems.node.active = !isEquip;
        this.btnDestroyGemsTitle.string = '清空方案';

        this.btnForge.node.active = true;
        if (isEquip) {
            this.btnForge.node.setPosition(-161, -250, 0);
            this.btnForgeTitle.string = '装备锻造';
        } else {
            this.btnDestroyGems.node.setPosition(-280, -250, 0);
            this.btnForge.node.setPosition(-41, -250, 0);
            this.btnForgeTitle.string = '前往锻造';
        }
    }

    public async refresh(): Promise<void> {
        const revision = ++this.sessionRevision;
        const growth = await roleRepository.equipmentGrowth(
            this.currentBagId,
            this.currentBagId ? null : this.currentPartId,
        );
        if (!this.isValid || revision !== this.sessionRevision) return;
        this.currentGrowth = growth;
        if (growth?.baseId && growth.baseId >= 1 && growth.baseId <= 6) {
            this.currentPartId = growth.baseId;
        }
        this.renderView();
    }

    private renderView(): void {
        const growth = this.currentGrowth;
        const partName = PART_NAMES[this.currentPartId] || '装备';

        this.titleLabel.string = partName;

        if (!growth) {
            this.nameLabel.string = ROLE_TEXTS.equipEmpty;
            this.qualityChipLabel.string = '—';
            if (this.qualityChipBg) this.qualityChipBg.color = CHIP_GRAY;
            this.partChipLabel.string = partName;
            this.statusChipLabel.string = '';
            if (this.statusChipBg) this.statusChipBg.color = CHIP_PART;
            this.subLabel.string = `部位：${partName}`;
            this.levelBadge.active = false;
            this.attrContentRoot.active = false;
            this.emptyTip.active = true;
            this.iconFrame.node.active = false;
            this.iconSprite.node.active = false;
            this.iconSprite.spriteFrame = null;
            this.clearRows();
            this.renderGems();
            this.updateTabDisplay();
            return;
        }

        let iconKey: string | null = null;
        let quality = growth.rank || 1;
        if (this.currentBagId) {
            const bagEntry = roleRepository.findBagEntry('equip', this.currentBagId);
            iconKey = bagEntry?.iconKey ?? null;
            if (bagEntry?.quality) quality = bagEntry.quality;
        }
        if (!iconKey) {
            const part = roleRepository.equipParts().find(item => item.partId === this.currentPartId);
            iconKey = part?.entry?.iconKey ?? null;
            if (part?.entry?.quality) quality = part.entry.quality;
        }

        const qualityName = QUALITY_NAMES[quality] ?? '普通';
        const equipName = growth.name || partName;
        this.nameLabel.string = equipName;
        this.qualityChipLabel.string = qualityName;
        if (this.qualityChipBg) this.qualityChipBg.color = QUALITY_CHIP_COLORS[quality] ?? CHIP_GRAY;
        this.partChipLabel.string = partName;
        this.statusChipLabel.string = growth.worn ? '已装备' : '背包中';
        if (this.statusChipBg) this.statusChipBg.color = growth.worn ? CHIP_GREEN : CHIP_PART;
        this.subLabel.string = `装备等级 ${growth.level || 0}`;

        this.levelBadge.active = growth.level > 0;
        this.levelValueLabel.string = `${growth.level || 0}`;

        this.iconFrame.node.active = true;
        this.iconSprite.node.active = !!iconKey;
        this.iconSprite.spriteFrame = null;
        void loadRoleQualityFrame(quality).then(frame => {
            if (this.isValid && frame) this.iconFrame.spriteFrame = frame;
        });
        if (iconKey) {
            void loadRoleBagIconSprite('equip', iconKey).then(frame => {
                if (this.isValid && frame && this.iconSprite.node.active) {
                    this.iconSprite.spriteFrame = frame;
                }
            });
        }

        this.attrContentRoot.active = true;
        this.emptyTip.active = false;
        this.renderBaseRows(growth);
        this.renderExtraRows(growth);
        this.renderGems();
        this.updateTabDisplay();
    }

    private renderBaseRows(growth: IRoleEquipGrowth): void {
        const attack = growth.attack > 0 ? `+${growth.attack}` : '—';
        const life = growth.hpPercent > 0 ? `+${growth.hpPercent}%` : '—';
        const upgrade = growth.level > 0 ? `+${growth.level * 10}` : '—';
        this.baseRows[0]?.setData('全队攻击', attack, 'attack');
        this.baseRows[1]?.setData('全队生命', life, 'life');
        this.baseRows[2]?.setData('强化', upgrade, 'defense');
    }

    private renderExtraRows(growth: IRoleEquipGrowth): void {
        const lines = [...growth.effects, ...growth.gemEffects];
        const effectCount = growth.effects.length;
        let index = 0;
        for (; index < this.extraRows.length && index < lines.length; index++) {
            const parsed = splitStatLine(lines[index]);
            const tone: RoleStatTone = this.toneOf(parsed.key);
            const tag = index >= effectCount && growth.gemEffects.length > 0 ? '宝石' : undefined;
            this.extraRows[index].setLine(lines[index], tone, tag);
        }
        for (; index < this.extraRows.length; index++) {
            this.extraRows[index].clear();
        }
    }

    private toneOf(key: string): RoleStatTone {
        if (/攻击/.test(key)) return 'attack';
        if (/生命|血量/.test(key)) return 'life';
        if (/防御|减伤|护甲/.test(key)) return 'defense';
        return 'normal';
    }

    private clearRows(): void {
        for (const row of this.baseRows) row.clear();
        for (const row of this.extraRows) row.clear();
    }

    private renderGems(): void {
        const part = roleRepository.equipParts().find(item => item.partId === this.currentPartId);
        const sockets = part?.sockets ?? [];
        for (let i = 0; i < this.gemItems.length; i++) {
            this.gemItems[i].setData(sockets[i], socket => this.handleGemAction(socket));
        }
    }

    /** 交给角色控制器统一处理：空槽进入选宝石，已镶嵌进入卸下/替换选择。 */
    private handleGemAction(socket: IRoleGemSocket): void {
        this.close(PopupCloseReason.Manual);
        EventMgr.instance.emit(RoleEvent.Intent, {
            kind: 'socket',
            partId: this.currentPartId,
            order: socket.order,
        });
    }

    private onForgeClick(): void {
        const targetPart = this.currentPartId;
        this.close(PopupCloseReason.Manual);
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'forge', partId: targetPart });
    }

    private async onDestroyOrDownClick(): Promise<void> {
        if (this.currentTab !== 'gem') return;

        const part = roleRepository.equipParts().find(item => item.partId === this.currentPartId);
        for (const socket of part?.sockets ?? []) {
            if (!socket.gemId) continue;
            await roleRepository.changeGem({
                kind: 'down',
                payload: { equipId: socket.equipId, page: socket.page, order: socket.order },
            }, this);
        }
        await roleRepository.load();
        EventMgr.instance.emit(RoleEvent.GemChanged);
        FW.showTip('已清空宝石方案');
        await this.refresh();
    }
}
