import { _decorator, Button, Color, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { GAME_AUDIO } from '../ResConst';
import { CommonTips } from '../common/CommonTips';
import { roleRepository } from './RoleRepository';
import { RoleEvent } from './RoleEvents';
import { getGemChange } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite, loadRoleQualityFrame, loadGemDetailHeader, hasGemDetailHeader } from './RoleArtLoader';
import type { IRoleGemEntry, IRoleGemGrowth, IRoleGemSocket, RoleGemChange } from './RoleTypes';
import { RoleGemSocketTile } from './RoleGemSocketTile';
import { RoleGemReplacePanel } from './RoleGemReplacePanel';

const { ccclass, property } = _decorator;

export interface IRoleGemInfoPopupOpenParams {
    gemId: string;
    onlyShow?: boolean;
}

/** 宝石配置的 `equipId` 指向基础装备 resId；优先按部位名定位，避免高阶装备 resId 不同时找不到槽位。 */
const PART_ID_BY_NAME: Readonly<Record<string, number>> = {
    头盔: 1,
    胸甲: 2,
    武器: 3,
    护腿: 4,
    护腕: 5,
    靴子: 6,
};

const LOCKED_TINT = new Color(255, 210, 120, 255);
const UNLOCKED_TINT = new Color(255, 255, 255, 255);

/**
 * 宝石详情弹窗（蓝湖「宝石镶嵌」版）。
 *
 * 左侧 316×475 道具信息卡：品质色头部（白品质不铺色板）放品质底 + 宝石图标 + 名称 / 数量，
 * 正文「宝石效果」，底部单颗金色「镶嵌」；右上角锁形按钮。
 * 右侧 322×460 孔位列表：有宝石显示图标 + 效果 + 行内「镶嵌」，空槽显示加号 + 「点击镶嵌宝石」。
 *
 * 行点击：非当前宝石 → 切换查看；当前宝石 → 卸下确认；空槽 → 把当前宝石镶入。
 * 行内「镶嵌」：把当前宝石镶进该孔，已有宝石时二次确认替换。
 */
@ccclass('RoleGemInfoPopup')
export class RoleGemInfoPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleGemInfoPopup';

    @property({ type: Node, tooltip: '弹窗内容面板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Label, tooltip: '宝石名称' })
    nameLabel: Label = null!;

    @property({ type: Sprite, tooltip: '头部品质底板（按宝石品质换色）' })
    qualityHeaderSprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '头部品质底' })
    iconFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '「宝石效果」标题' })
    effectTitleLabel: Label = null!;

    @property({ type: Label, tooltip: '数量' })
    subLabel: Label = null!;

    @property({ type: Label, tooltip: '宝石效果主文案' })
    effectLabel: Label = null!;

    @property({ type: [RoleGemSocketTile], tooltip: '5 个孔位行' })
    socketTiles: RoleGemSocketTile[] = [];

    @property({ type: Button, tooltip: '锁定按钮（右上角锁形图标）' })
    btnLock: Button = null!;

    @property({ type: Sprite, tooltip: '锁定图标' })
    lockIconSprite: Sprite = null!;

    @property({ type: Button, tooltip: '镶嵌按钮' })
    btnOn: Button = null!;

    @property({ type: Label, tooltip: '镶嵌按钮文字' })
    btnOnLabel: Label = null!;

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

    private currentGemId = '';
    private currentGem: IRoleGemEntry | null = null;
    private currentGrowth: IRoleGemGrowth | null = null;
    private currentPartName = '通用';
    private currentSkillName = '';
    private currentSockets: readonly IRoleGemSocket[] = [];
    private replaceSockets: readonly IRoleGemSocket[] = [];
    private downBusy = false;
    private refreshRevision = 0;

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
        this.btnLock.node.on(Button.EventType.CLICK, this.onLockClick, this);
        this.btnOn.node.on(Button.EventType.CLICK, this.onInlayClick, this);

        this.replaceMask.on(Button.EventType.CLICK, () => {
            this.hideReplacePanel();
        });
    }

    public async refresh(): Promise<void> {
        const context = this.popupOpenContext;
        if (!context) return;
        const revision = ++this.refreshRevision;
        let gem = roleRepository.findGem(this.currentGemId);
        if (!gem) {
            // 奖励格 / 邮件等入口可能早于角色页首屏：`describeGem` 要等一次快照加载才就绪，
            // 直接渲染会停在空白。补一次快照（幂等）后再解析；仍失败就关窗，不留白板。
            try {
                await roleRepository.load();
            } catch (error) {
                console.warn('[RoleGemInfoPopup] 宝石数据加载失败', error);
            }
            if (context.cancelled || revision !== this.refreshRevision) return;
            gem = roleRepository.findGem(this.currentGemId);
        }
        this.currentGem = gem;
        if (!gem) {
            FW.showTip(ROLE_TEXTS.gemDataLoading);
            this.close();
            return;
        }

        const skillId = gem.skillId ?? 0;
        const [growth, filters, skillName] = await Promise.all([
            roleRepository.gemGrowth(this.currentGemId),
            roleRepository.gemFilters(),
            skillId > 0
                ? roleRepository.gemSkillName(skillId).catch(() => '')
                : Promise.resolve(''),
        ]);
        if (context.cancelled || revision !== this.refreshRevision) return;

        this.currentGrowth = growth;
        this.currentSkillName = skillName;
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

        this.nameLabel.string = gem.name;
        this.subLabel.string = `数量：${gem.count}`;
        this.effectTitleLabel.string = '宝石效果';

        const lines = [gem.desc || '暂无效果说明'];
        if (this.currentSkillName) lines.push(ROLE_TEXTS.gemSkill(this.currentSkillName));
        const pending = this.currentGrowth?.pendingAttribute;
        if (pending) lines.push(`待保存属性：${pending}`);
        this.effectLabel.string = lines.join('\n');

        for (let i = 0; i < this.socketTiles.length; i++) {
            this.socketTiles[i].setData(
                this.currentSockets[i] ?? null,
                socket => this.onSocketClick(socket),
                gem.gemId,
                socket => this.onSocketInlayClick(socket),
            );
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

        const hasHeader = hasGemDetailHeader(gem.quality);
        if (this.qualityHeaderSprite) {
            this.qualityHeaderSprite.node.active = hasHeader;
            this.qualityHeaderSprite.spriteFrame = null;
            if (hasHeader) {
                const headerGemId = gem.gemId;
                void loadGemDetailHeader(gem.quality).then(frame => {
                    if (this.isValid && frame && this.currentGem?.gemId === headerGemId) {
                        this.qualityHeaderSprite.spriteFrame = frame;
                    }
                });
            }
        }

        const isLocked = this.currentGrowth?.lock === 1;
        if (this.lockIconSprite) this.lockIconSprite.color = isLocked ? LOCKED_TINT : UNLOCKED_TINT;
        if (this.btnOnLabel) this.btnOnLabel.string = gem.equipped ? '已镶嵌' : '镶嵌';
        if (this.btnOn) this.btnOn.interactable = !gem.equipped;

        this.hideReplacePanel();
    }

    /** 成功镶嵌和替换共用升级成功音效。 */
    private playInlaidSound(): void {
        FW.playSound(GAME_AUDIO.upgradeSuccess);
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

    private async onInlayClick(): Promise<void> {
        const gem = this.currentGem;
        if (!gem || gem.equipped || this.downBusy) return;
        if (!this.currentSockets.length) {
            FW.showTip(ROLE_TEXTS.gemUnavailable);
            return;
        }

        const emptySocket = this.currentSockets.find(socket => !socket.gemId);
        if (emptySocket) {
            await this.inlayInto(emptySocket);
            return;
        }

        void this.showReplacePanel(this.currentSockets);
    }

    /** 空槽点击 / 行内镶嵌共用：把当前查看的宝石镶进指定孔位（空槽由服务端落到第一个空位）。 */
    private async inlayInto(socket: IRoleGemSocket): Promise<void> {
        const gem = this.currentGem;
        if (!gem || this.downBusy) return;
        if (gem.equipped) {
            FW.showTip('该宝石已镶嵌');
            return;
        }
        const change = getGemChange(this.currentSockets, socket, gem);
        if (!change) {
            FW.showTip(ROLE_TEXTS.gemInvalid);
            return;
        }
        this.downBusy = true;
        try {
            const status = await roleRepository.changeGem(change, this);
            if (status !== 'ok') {
                if (this.isValid) FW.showTip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
                return;
            }
            FW.showTip(ROLE_TEXTS.gemChanged);
            this.playInlaidSound();
            EventMgr.instance.emit(RoleEvent.GemChanged);
            this.close();
        } finally {
            this.downBusy = false;
        }
    }

    /** 行内「镶嵌」：这一孔已有别的宝石时先确认替换。 */
    private onSocketInlayClick(socket: IRoleGemSocket): void {
        const gem = this.currentGem;
        if (!gem || this.downBusy) return;
        if (socket.gemId === gem.gemId) {
            FW.showTip('该宝石已镶嵌');
            return;
        }
        if (!socket.gemId) {
            void this.inlayInto(socket);
            return;
        }
        const old = roleRepository.findGem(socket.gemId);
        void CommonTips.open({
            userData: {
                title: '替换宝石',
                content: `第 ${socket.order} 孔已有「${old?.name ?? '宝石'}」，确定用「${gem.name}」替换？`,
                sureText: '替换',
                onSure: () => { void this.replaceSocket(socket); },
            },
        });
    }

    private async replaceSocket(socket: IRoleGemSocket): Promise<void> {
        const gem = this.currentGem;
        if (!gem || this.downBusy) return;
        this.downBusy = true;
        try {
            const status = await roleRepository.changeGem({
                kind: 'replace',
                payload: {
                    equipId: socket.equipId,
                    page: socket.page,
                    order: socket.order,
                    id: gem.gemId,
                },
            }, this);
            if (status !== 'ok') {
                if (this.isValid) FW.showTip(status === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
                return;
            }
            FW.showTip(ROLE_TEXTS.gemChanged);
            this.playInlaidSound();
            EventMgr.instance.emit(RoleEvent.GemChanged);
            this.close();
        } finally {
            this.downBusy = false;
        }
    }

    /**
     * 替换时左侧选择已有宝石的孔位，右侧对比当前与替换后的效果。
     * `RoleGemReplacePanel` 创建实际内容，prefab 内为兼容而保留的替换列表节点保持隐藏。
     */
    private async showReplacePanel(sockets: readonly IRoleGemSocket[]): Promise<void> {
        const gem = this.currentGem;
        const host = this.replacePanel.parent;
        if (!gem || !host) {
            FW.showTip(ROLE_TEXTS.gemInvalid);
            return;
        }
        this.replaceSockets = sockets;
        this.replacePanel.active = false;
        if (this.replaceListRoot) this.replaceListRoot.active = false;
        host.active = true;

        await RoleGemReplacePanel.open(host, {
            options: sockets.map((socket, index) => ({
                socket,
                gem: socket.gemId ? roleRepository.findGem(socket.gemId) : null,
                slot: index + 1,
            })),
            incoming: gem,
            partName: this.currentPartName,
            onConfirm: socket => { void this.executeReplace(socket); },
            onClose: () => this.hideReplacePanel(),
        });
    }

    /** 关掉整层（遮罩 + 面板）；面板内部状态留在 `RoleGemReplacePanel` 里复用。 */
    private hideReplacePanel(): void {
        this.replacePanel.active = false;
        if (this.replaceListRoot) this.replaceListRoot.active = false;
        const host = this.replacePanel.parent;
        if (host) host.active = false;
    }

    private async executeReplace(socket: IRoleGemSocket): Promise<void> {
        if (!this.currentGem || this.downBusy) return;
        this.downBusy = true;
        try {
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
                this.playInlaidSound();
                EventMgr.instance.emit(RoleEvent.GemChanged);
                this.close();
            } else if (this.isValid) {
                // 失败（离线 / 校验不过）：把面板重刷一遍，按钮恢复可点，别停在一个按不动的确认键上
                void this.showReplacePanel(this.replaceSockets);
            }
        } finally {
            this.downBusy = false;
        }
    }

    /**
     * 点击孔位行：
     * - 空槽 → 把当前查看的宝石镶进该部位；
     * - 非当前查看的宝石 → 切成查看对象（左栏详情跟随，右栏该行暖金高亮）；
     * - 当前查看的宝石 → 二次确认后按 `CmdGemDownReqMsg` 卸下。
     *
     * 镶嵌 / 卸下请求进行中不接切换，避免请求回来时详情已被换掉。
     */
    private onSocketClick(socket: IRoleGemSocket): void {
        if (this.downBusy) return;
        if (!socket.gemId) {
            void this.inlayInto(socket);
            return;
        }
        if (socket.gemId !== this.currentGemId) {
            this.currentGemId = socket.gemId;
            this.hideReplacePanel();
            void this.refresh();
            return;
        }
        // 用统一入口生成卸下参数：槽位若已被刷新掉（换页/换装），这里直接判无效，不发请求。
        const change = getGemChange(this.currentSockets, socket, null);
        if (!change) {
            FW.showTip(ROLE_TEXTS.gemInvalid);
            return;
        }
        const gem = roleRepository.findGem(socket.gemId);
        const gemName = gem ? gem.name : ROLE_TEXTS.gemUnknown(socket.gemId);
        void CommonTips.open({
            userData: {
                title: gemName,
                content: [gem ? gem.desc : '', ROLE_TEXTS.gemDownPrompt].filter(Boolean).join('\n'),
                sureText: ROLE_TEXTS.gemDown,
                onSure: () => { void this.downSocketGem(change); },
            },
        });
    }

    private async downSocketGem(change: RoleGemChange): Promise<void> {
        this.downBusy = true;
        try {
            const status = await roleRepository.changeGem(change, this);
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
