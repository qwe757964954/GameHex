import { _decorator, Button, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { FW } from '../../framework/FW';
import { roleRepository } from './RoleRepository';
import { getGemChange } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import { loadRoleBagIconSprite } from './RoleArtLoader';
import type { IRoleGemEntry, IRoleGemGrowth, IRoleGemSocket } from './RoleTypes';

const { ccclass, property } = _decorator;

export interface IRoleGemInfoPopupOpenParams {
    gemId: string;
    onlyShow?: boolean;
    onChanged?: () => void;
}

/**
 * 宝石详情弹窗（对齐 FGUI `弹窗_宝石_详情.xml` & `弹窗_宝石_详情_内容.xml` 及老端 `LayerGemInfo`）。
 *
 * 点击宝石背包条目或装备宝石孔位时调起。
 * 包含：
 *   - 宝石图标、品质与适用部位；
 *   - 宝石技能属性描述；
 *   - 锁定/解锁状态切换（已镶嵌解锁二次确认）；
 *   - 洗练与直接镶嵌/替换孔位面板；
 *   - 点击背景深色遮罩或关闭按钮安全退出。
 */
@ccclass('RoleGemInfoPopup')
export class RoleGemInfoPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleGemInfoPopup';

    @property({ type: Node, tooltip: '弹窗主背景板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Label, tooltip: '宝石名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '所属部位' })
    partLabel: Label = null!;

    @property({ type: Label, tooltip: '属性描述' })
    descLabel: Label = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    iconSprite: Sprite = null!;

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
    private onChangedCallback: (() => void) | null = null;
    private replaceSockets: readonly IRoleGemSocket[] = [];

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(params?: IPopupOpenParams<IRoleGemInfoPopupOpenParams> | IRoleGemInfoPopupOpenParams): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as IRoleGemInfoPopupOpenParams | undefined;
        if (!data || !data.gemId) return;
        this.currentGemId = data.gemId;
        this.onChangedCallback = data.onChanged ?? null;

        this.contentNodes = [this.popBg];
        await this.refresh();
    }

    private bindEvents(): void {
        this.btnClose.node.on(Button.EventType.CLICK, () => this.close(), this);
        this.btnLock.node.on(Button.EventType.CLICK, this.onLockClick, this);
        this.btnRefine.node.on(Button.EventType.CLICK, this.onRefineClick, this);
        this.btnOn.node.on(Button.EventType.CLICK, this.onInlayClick, this);

        this.replaceMask.on(Button.EventType.CLICK, () => {
            this.replacePanel.active = false;
        }, this);

        for (let i = 0; i < this.replaceButtons.length; i++) {
            const index = i;
            this.replaceButtons[i].node.on(Button.EventType.CLICK, () => {
                const socket = this.replaceSockets[index];
                if (socket) void this.executeReplace(socket);
            }, this);
        }
    }

    public async refresh(): Promise<void> {
        const gem = roleRepository.findGem(this.currentGemId);
        this.currentGem = gem;
        const [growth, filters] = await Promise.all([
            roleRepository.gemGrowth(this.currentGemId),
            roleRepository.gemFilters(),
        ]);
        if (!this.isValid) return;
        this.currentGrowth = growth;
        this.currentPartName = (gem && filters.find(f => f.id === gem.equipId)?.name) || '通用';
        this.renderView();
    }

    private renderView(): void {
        const gem = this.currentGem;
        if (!gem) return;

        this.nameLabel.string = gem.name;
        this.partLabel.string = `适用部位: ${this.currentPartName}`;
        this.descLabel.string = gem.desc;

        if (gem.iconKey) {
            void loadRoleBagIconSprite('gem', gem.iconKey).then(sf => {
                if (this.isValid && sf) {
                    this.iconSprite.spriteFrame = sf;
                }
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
            this.onChangedCallback?.();
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
            this.onChangedCallback?.();
            await this.refresh();
        }
    }

    private async onInlayClick(): Promise<void> {
        const gem = this.currentGem;
        if (!gem) return;

        const slots = roleRepository.equipParts();
        const partData = slots.find(s => s.sockets.some(sock => sock.equipId === gem.equipId));
        if (!partData || !partData.sockets.length) {
            FW.showTip(ROLE_TEXTS.gemUnavailable);
            return;
        }

        if (partData.sockets.some(s => s.gemId === gem.gemId)) {
            FW.showTip('该宝石已镶嵌');
            return;
        }

        // 寻找空孔位
        const emptySocket = partData.sockets.find(s => !s.gemId);
        if (emptySocket) {
            const change = getGemChange(partData.sockets, emptySocket, gem);
            if (!change) {
                FW.showTip(ROLE_TEXTS.gemInvalid);
                return;
            }
            const status = await roleRepository.changeGem(change, this);
            if (status === 'ok') {
                FW.showTip(ROLE_TEXTS.gemChanged);
                this.onChangedCallback?.();
                this.close();
            }
            return;
        }

        // 无空孔位，唤起替换孔位选择面板
        this.showReplacePanel(partData.sockets);
    }

    private showReplacePanel(sockets: readonly IRoleGemSocket[]): void {
        this.replacePanel.active = true;
        this.replaceSockets = sockets;

        for (let i = 0; i < this.replaceButtons.length; i++) {
            const btn = this.replaceButtons[i];
            const label = this.replaceLabels[i];
            const sock = sockets[i];
            if (sock) {
                btn.node.active = true;
                const oldGem = sock.gemId ? roleRepository.findGem(sock.gemId) : null;
                if (label) {
                    label.string = oldGem
                        ? `孔 ${sock.order}: ${oldGem.name}（${oldGem.desc}）`
                        : `孔 ${sock.order}: 空`;
                }
            } else {
                btn.node.active = false;
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
            this.onChangedCallback?.();
            this.close();
        }
    }
}
