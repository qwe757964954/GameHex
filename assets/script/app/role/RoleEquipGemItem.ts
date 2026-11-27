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
    private actionCallback: (socket: IRoleGemSocket) => void = null!;
    private renderRevision = 0;

    protected onLoad(): void {
        this.actionButton.node.on(Button.EventType.CLICK, this.onActionClick, this);
    }

    public setData(socket: IRoleGemSocket | null | undefined, onAction: (socket: IRoleGemSocket) => void): void {
        const revision = ++this.renderRevision;
        this.currentSocket = socket ?? null;
        this.actionCallback = onAction;
        this.node.active = true;

        const gem = socket?.gemId ? roleRepository.findGem(socket.gemId) : null;
        if (!gem) {
            this.renderEmpty(!!socket);
            return;
        }

        this.renderGem(gem);
        void this.loadGemArt(gem, revision);
    }

    private renderEmpty(showAction: boolean): void {
        this.qualitySprite.node.active = false;
        this.gemSprite.node.active = false;
        this.gemSprite.spriteFrame = null;
        this.emptyRing.active = true;
        this.nameLabel.string = '';
        this.attrLabel.string = '';
        this.actionButton.node.active = showAction;
        this.actionLabel.string = '镶嵌';
    }

    private renderGem(gem: IRoleGemEntry): void {
        this.qualitySprite.node.active = true;
        this.gemSprite.node.active = true;
        this.emptyRing.active = false;
        this.nameLabel.string = gem.name;
        this.attrLabel.string = gem.desc;
        this.actionButton.node.active = true;
        this.actionLabel.string = '替换';
    }

    private async loadGemArt(gem: IRoleGemEntry, revision: number): Promise<void> {
        const [quality, icon] = await Promise.all([
            loadRoleQualityFrame(gem.quality),
            gem.iconKey ? loadRoleBagIconSprite('gem', gem.iconKey) : Promise.resolve(null),
        ]);
        if (!this.isValid || revision !== this.renderRevision) return;
        if (quality) this.qualitySprite.spriteFrame = quality;
        if (icon) this.gemSprite.spriteFrame = icon;
    }

    private onActionClick(): void {
        if (this.currentSocket) {
            this.actionCallback(this.currentSocket);
        }
    }
}
