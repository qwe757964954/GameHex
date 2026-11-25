import { _decorator, Button, Color, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { getGemChange } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleGemEntry, IRoleGemGrowth, IRoleGemSocket } from './RoleTypes';
import { RoleGemSocketTile } from './RoleGemSocketTile';

const { ccclass, property } = _decorator;

export interface IRoleGemInfoPopupOpenParams {
    gemId: string;
    onlyShow?: boolean;
}

const QUALITY_NAMES: Readonly<Record<number, string>> = {
    1: '普通',
    2: '精良',
    3: '优秀',
    4: '史诗',
    5: '传说',
    6: '绝世',
    7: '神话',
};

/** 宝石配置的 `equipId` 指向基础装备 resId；优先按部位名定位，避免高阶装备 resId 不同时找不到槽位。 */
const PART_ID_BY_NAME: Readonly<Record<string, number>> = {
    头盔: 1,
    胸甲: 2,
    武器: 3,
    护腿: 4,
    护腕: 5,
    靴子: 6,
};

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

/**
 * 宝石详情弹窗（第四版布局）。
 *
 * 头部品质底 / Chip / 副标题，红色缎带「宝石效果」，效果板，5 槽位预览；
 * 分区文案为「武器宝石 2/5」，槽位不显示 1–5 序号与「已镶嵌 / 空」文字。
 */
@ccclass('RoleGemInfoPopup')
export class RoleGemInfoPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleGemInfoPopup';

    @property({ type: Node, tooltip: '弹窗内容面板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Label, tooltip: '宝石名称' })
    nameLabel: Label = null!;

    @property({ type: Sprite, tooltip: '头部品质底' })
    iconFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '品质 Chip' })
    qualityChipLabel: Label = null!;

    @property({ type: Sprite, tooltip: '品质 Chip 底' })
    qualityChipBg: Sprite = null!;

    @property({ type: Label, tooltip: '适用部位 Chip' })
    partChipLabel: Label = null!;

    @property({ type: Label, tooltip: '镶嵌状态 Chip' })
    statusChipLabel: Label = null!;

    @property({ type: Sprite, tooltip: '镶嵌状态 Chip 底' })
    statusChipBg: Sprite = null!;

    @property({ type: Label, tooltip: '副标题' })
    subLabel: Label = null!;

    @property({ type: Label, tooltip: '宝石效果主文案' })
    effectLabel: Label = null!;

    @property({ type: Label, tooltip: '宝石效果说明' })
    effectHintLabel: Label = null!;

    @property({ type: Label, tooltip: '槽位分区标题（武器宝石 2/5）' })
    sectionLabel: Label = null!;

    @property({ type: [RoleGemSocketTile], tooltip: '5 个槽位预览' })
    socketTiles: RoleGemSocketTile[] = [];

    @property({ type: Button, tooltip: '锁定按钮' })
    btnLock: Button = null!;

    @property({ type: Label, tooltip: '锁定按钮文字' })
    lockLabel: Label = null!;

    @property({ type: Button, tooltip: '洗炼按钮' })
    btnRefine: Button = null!;

    @property({ type: Button, tooltip: '镶嵌按钮' })
    btnOn: Button = null!;

    @property({ type: Node, tooltip: '替换孔位选择面板' })
    replacePanel: Node = null!;

    @property({ type: Node, tooltip: '替换孔位列表根节点' })
    replaceListRoot: Node = null!;

    @property({ type: Node, tooltip: '替换面板遮罩' })
    replaceMask: Node = null!;

    @property({ type: [Button], tooltip: '替换孔位按钮列表（最多5个）' })
    replaceButtons: Button[] = [];

    @property({ type: [Label], tooltip: '替换孔位文字列表（最多5个）' })
    replaceLabels: Label[] = [];

    @property({ type: Button, tooltip: '关闭弹窗按钮' })
    btnClose: Button = null!;

    private currentGemId = '';
    private currentGem: IRoleGemEntry | null = null;
    private currentGrowth: IRoleGemGrowth | null = null;
    private currentPartName = '通用';
    private currentSockets: readonly IRoleGemSocket[] = [];
    private replaceSockets: readonly IRoleGemSocket[] = [];
    private downBusy = false;

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(
        params?: IPopupOpenParams<IRoleGemInfoPopupOpenParams> | IRoleGemInfoPopupOpenParams,
    ): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as
            IRoleGemInfoPopupOpenParams | undefined;
        if (!data?.gemId) {
            this.close();
            return;
        }
        this.currentGemId = data.gemId;

        this.contentNodes = [this.popBg];
        await this.refresh();
    }

    private bindEvents(): void {
        this.btnClose.node.on(Button.EventType.CLICK, () => this.close());
        this.btnLock.node.on(Button.EventType.CLICK, this.onLockClick, this);
        this.btnRefine.node.on(Button.EventType.CLICK, this.onRefineClick, this);
        this.btnOn.node.on(Button.EventType.CLICK, this.onInlayClick, this);

        this.replaceMask.on(Button.EventType.CLICK, () => {
            this.replacePanel.active = false;
        });

        for (let i = 0; i < this.replaceButtons.length; i++) {
            const index = i;
            this.replaceButtons[i].node.on(Button.EventType.CLICK, () => {
                const socket = this.replaceSockets[index];
                if (socket) void this.executeReplace(socket);
            });
        }
    }

    public async refresh(): Promise<void> {
        const gem = roleRepository.findGem(this.currentGemId);
        this.currentGem = gem;
        if (!gem) return;

        const [growth, filters] = await Promise.all([
            roleRepository.gemGrowth(this.currentGemId),
            roleRepository.gemFilters(),
        ]);
        if (!this.isValid) return;

        this.currentGrowth = growth;
        this.currentPartName = filters.find(filter => filter.id === gem.equipId)?.name || '通用';
        const parts = roleRepository.equipParts();
        const partId = PART_ID_BY_NAME[this.currentPartName] ?? 0;
        const part = (partId > 0 ? parts.find(item => item.partId === partId) : undefined)
            ?? parts.find(item => item.sockets.some(socket => socket.equipId === gem.equipId));
        this.currentSockets = part?.sockets ?? [];
        this.renderView();
    }

    private renderView(): void {
        const gem = this.currentGem;
        if (!gem) return;

        const qualityName = QUALITY_NAMES[gem.quality] ?? '普通';
        const filled = this.currentSockets.filter(socket => socket.gemId).length;
        this.nameLabel.string = gem.name;
        this.qualityChipLabel.string = qualityName;
        if (this.qualityChipBg) this.qualityChipBg.color = QUALITY_CHIP_COLORS[gem.quality] ?? CHIP_GRAY;
        this.partChipLabel.string = this.currentPartName;
        this.statusChipLabel.string = gem.equipped ? '已镶嵌' : '未镶嵌';
        if (this.statusChipBg) this.statusChipBg.color = gem.equipped ? CHIP_GREEN : CHIP_PART;
        this.subLabel.string = `适用部位：${this.currentPartName} · 数量 ${gem.count}`;
        this.effectLabel.string = gem.desc || '暂无效果说明';
        const pending = this.currentGrowth?.pendingAttribute;
        this.effectHintLabel.string = pending ? `待保存属性：${pending}` : '镶嵌后属性即时生效';
        this.sectionLabel.string = `${this.currentPartName}宝石 ${filled}/5`;

        for (let i = 0; i < this.socketTiles.length; i++) {
            this.socketTiles[i].setData(this.currentSockets[i] ?? null, socket => this.onSocketClick(socket));
        }

        this.iconFrame.node.active = true;
        this.iconSprite.node.active = true;
        this.iconSprite.spriteFrame = null;
        void loadRoleQualityFrame(gem.quality || 1).then(frame => {
            if (this.isValid && frame) this.iconFrame.spriteFrame = frame;
        });
        if (gem.iconKey) {
            void loadRoleBagIconSprite('gem', gem.iconKey).then(frame => {
                if (this.isValid && frame) this.iconSprite.spriteFrame = frame;
            });
        }

        const isLocked = this.currentGrowth?.lock === 1;
        this.lockLabel.string = isLocked ? ROLE_TEXTS.gemUnlock : ROLE_TEXTS.gemLock;

        this.replacePanel.active = false;
    }

    private async onLockClick(): Promise<void> {
        if (!this.currentGem) return;
        const isLocked = this.currentGrowth?.lock === 1;
        const targetLock = isLocked ? 0 : 1;

        if (isLocked && this.currentGem.equipped) {
            FW.showTip(ROLE_TEXTS.gemUnlockWorn);
        }

        const status = await roleRepository.requestGrowth('CmdGemLockReqMsg', {
            id: this.currentGem.gemId,
            lock: targetLock,
        }, this);

        if (status === 'ok') {
            FW.showTip(targetLock === 1 ? '宝石已锁定' : '宝石已解锁');
            EventMgr.instance.emit(RoleEvent.GemChanged);
            await this.refresh();
        }
    }

    private async onRefineClick(): Promise<void> {
        if (!this.currentGem) return;
        const status = await roleRepository.requestGrowth('CmdGemRefineReqMsg', {
            id: this.currentGem.gemId,
        }, this, response => {
            const rsp = response as any;
            if (rsp?.ret === 0 && rsp?.tlNewAttr && rsp.tlNewAttr.length) {
                FW.showTip(ROLE_TEXTS.gemNewAttr(rsp.tlNewAttr.join(',')));
            }
        });
        if (status === 'ok') {
            EventMgr.instance.emit(RoleEvent.GemChanged);
            await this.refresh();
        }
    }

    private async onInlayClick(): Promise<void> {
        const gem = this.currentGem;
        if (!gem) return;
        if (!this.currentSockets.length) {
            FW.showTip(ROLE_TEXTS.gemUnavailable);
            return;
        }
        if (this.currentSockets.some(socket => socket.gemId === gem.gemId)) {
            FW.showTip('该宝石已镶嵌');
            return;
        }

        const emptySocket = this.currentSockets.find(socket => !socket.gemId);
        if (emptySocket) {
            const change = getGemChange(this.currentSockets, emptySocket, gem);
            if (!change) {
                FW.showTip(ROLE_TEXTS.gemInvalid);
                return;
            }
            const status = await roleRepository.changeGem(change, this);
            if (status === 'ok') {
                FW.showTip(ROLE_TEXTS.gemChanged);
                EventMgr.instance.emit(RoleEvent.GemChanged);
                this.close();
            }
            return;
        }

        this.showReplacePanel(this.currentSockets);
    }

    private showReplacePanel(sockets: readonly IRoleGemSocket[]): void {
        this.replacePanel.active = true;
        this.replaceSockets = sockets;

        for (let i = 0; i < this.replaceButtons.length; i++) {
            const button = this.replaceButtons[i];
            const label = this.replaceLabels[i];
            const socket = sockets[i];
            if (!socket) {
                button.node.active = false;
                continue;
            }
            button.node.active = true;
            const oldGem = socket.gemId ? roleRepository.findGem(socket.gemId) : null;
            if (label) {
                label.string = oldGem ? `${oldGem.name} · ${oldGem.desc}` : '';
            }
        }
    }

    private async executeReplace(socket: IRoleGemSocket): Promise<void> {
        if (!this.currentGem) return;
        const status = await roleRepository.changeGem({
            kind: 'replace',
            payload: {
                equipId: socket.equipId,
                page: socket.page,
                order: socket.order,
                id: this.currentGem.gemId,
            },
        }, this);

        if (status === 'ok') {
            FW.showTip(ROLE_TEXTS.gemChanged);
            EventMgr.instance.emit(RoleEvent.GemChanged);
            this.close();
        }
    }

    /**
     * 点击已镶嵌的槽位 → 二次确认后按 `CmdGemDownReqMsg` 卸下该孔宝石。
     *
     * 空槽的按钮在 {@link RoleGemSocketTile} 里已置为不可交互，点不出来。
     */
    private onSocketClick(socket: IRoleGemSocket): void {
        if (this.downBusy) return;
        const gem = roleRepository.findGem(socket.gemId);
        void CommonTips.open({
            userData: {
                content: ROLE_TEXTS.gemDownConfirm(gem?.name ?? ROLE_TEXTS.gemUnknown(socket.gemId)),
                sureText: ROLE_TEXTS.gemDown,
                onSure: () => { void this.downSocketGem(socket); },
            },
        });
    }

    private async downSocketGem(socket: IRoleGemSocket): Promise<void> {
        this.downBusy = true;
        try {
            const status = await roleRepository.changeGem({
                kind: 'down',
                payload: { equipId: socket.equipId, page: socket.page, order: socket.order },
            }, this);
            if (status !== 'ok') {
                if (this.isValid) {
                    FW.showTip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
                }
                return;
            }
            // 与「装备详情·清空方案」同一口径：先重新解析孔位，再让角色页跟着刷新。
            await roleRepository.load();
            EventMgr.instance.emit(RoleEvent.GemChanged);
            if (!this.isValid || !this.isPopupOpen) return;
            FW.showTip(ROLE_TEXTS.gemChanged);
            await this.refresh();
        } finally {
            this.downBusy = false;
        }
    }
}
