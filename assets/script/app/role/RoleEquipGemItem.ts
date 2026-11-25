import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import { roleRepository } from './RoleRepository';
import type { IRoleGemEntry, IRoleGemSocket } from './RoleTypes';

const { ccclass, property } = _decorator;

/**
 * 装备详情「宝石镶嵌」页的单行槽位。
 *
 * 空槽只保留空槽视觉与「镶嵌」按钮，不显示「暂未镶嵌宝石」；
 * 已镶嵌行显示品质底、宝石名、属性摘要与「替换」按钮。
 * 点击按钮不直接改数据，而是把孔位意图交回宿主弹窗，由角色控制器统一处理。
 */
@ccclass('RoleEquipGemItem')
export class RoleEquipGemItem extends Component {
    @property({ type: Sprite, tooltip: '品质底' })
    qualitySprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    gemSprite: Sprite = null!;

    @property({ type: Node, tooltip: '空槽虚线圆环' })
    emptyRing: Node = null!;

    @property({ type: Label, tooltip: '宝石名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '属性摘要' })
    attrLabel: Label = null!;

    @property({ type: Button, tooltip: '镶嵌 / 替换按钮' })
    actionButton: Button = null!;

    @property({ type: Label, tooltip: '镶嵌 / 替换按钮文字' })
    actionLabel: Label = null!;

    private currentSocket: IRoleGemSocket | null = null;
    private actionCallback?: (socket: IRoleGemSocket) => void;
    private renderRevision = 0;

    protected onLoad(): void {
        this.actionButton?.node.on(Button.EventType.CLICK, this.onActionClick, this);
    }

    public setData(socket: IRoleGemSocket | null | undefined, onAction?: (socket: IRoleGemSocket) => void): void {
        const revision = ++this.renderRevision;
        this.currentSocket = socket ?? null;
        this.actionCallback = onAction;
        this.node.active = true;

        if (!socket) {
            this.renderEmpty(false);
            return;
        }

        const gem = socket.gemId ? roleRepository.findGem(socket.gemId) : null;
        if (!gem) {
            this.renderEmpty(true);
            return;
        }

        this.renderGem(gem);
        void this.loadGemArt(gem, revision);
    }

    private renderEmpty(showAction: boolean): void {
        if (this.qualitySprite) this.qualitySprite.node.active = false;
        if (this.gemSprite) {
            this.gemSprite.node.active = false;
            this.gemSprite.spriteFrame = null;
        }
        if (this.emptyRing) this.emptyRing.active = true;
        if (this.nameLabel) this.nameLabel.string = '';
        if (this.attrLabel) this.attrLabel.string = '';
        if (this.actionButton) this.actionButton.node.active = showAction;
        if (this.actionLabel) this.actionLabel.string = '镶嵌';
    }

    private renderGem(gem: IRoleGemEntry): void {
        if (this.qualitySprite) this.qualitySprite.node.active = true;
        if (this.gemSprite) this.gemSprite.node.active = true;
        if (this.emptyRing) this.emptyRing.active = false;
        if (this.nameLabel) this.nameLabel.string = gem.name;
        if (this.attrLabel) this.attrLabel.string = gem.desc;
        if (this.actionButton) this.actionButton.node.active = true;
        if (this.actionLabel) this.actionLabel.string = '替换';
    }

    private async loadGemArt(gem: IRoleGemEntry, revision: number): Promise<void> {
        const [quality, icon] = await Promise.all([
            loadRoleQualityFrame(gem.quality || 1),
            gem.iconKey ? loadRoleBagIconSprite('gem', gem.iconKey) : Promise.resolve(null),
        ]);
        if (!this.isValid || revision !== this.renderRevision) return;
        if (this.qualitySprite && quality) this.qualitySprite.spriteFrame = quality;
        if (this.gemSprite && icon) this.gemSprite.spriteFrame = icon;
    }

    private onActionClick(): void {
        if (this.currentSocket && this.actionCallback) {
            this.actionCallback(this.currentSocket);
        }
    }
}
