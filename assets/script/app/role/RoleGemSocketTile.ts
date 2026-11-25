import { _decorator, Button, Component, Node, Sprite } from 'cc';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import { roleRepository } from './RoleRepository';
import type { IRoleGemEntry, IRoleGemSocket } from './RoleTypes';

const { ccclass, property } = _decorator;

/**
 * 宝石详情里的单个槽位预览。
 *
 * 有宝石时显示品质底 + 宝石图标；空槽只显示虚线圆环。
 * 不显示 1–5 序号，也不显示「已镶嵌 / 空」文字。
 *
 * 已镶嵌的槽位可点击（`cc.Button` 挂在本节点），点击意图交回宿主弹窗做卸下确认；
 * 空槽把按钮置为不可交互，点它没有反应。
 */
@ccclass('RoleGemSocketTile')
export class RoleGemSocketTile extends Component {
    @property({ type: Sprite, tooltip: '品质底' })
    qualitySprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    gemSprite: Sprite = null!;

    @property({ type: Node, tooltip: '空槽虚线圆环' })
    emptyRing: Node = null!;

    private renderRevision = 0;
    private currentSocket: IRoleGemSocket | null = null;
    private socketButton: Button | null = null;
    private clickCallback?: (socket: IRoleGemSocket) => void;

    protected onLoad(): void {
        this.socketButton = this.node.getComponent(Button);
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    public setData(socket: IRoleGemSocket | null | undefined, onSocketClick?: (socket: IRoleGemSocket) => void): void {
        const revision = ++this.renderRevision;
        this.currentSocket = socket ?? null;
        this.clickCallback = onSocketClick;
        const gem = socket?.gemId ? roleRepository.findGem(socket.gemId) : null;
        this.render(gem);

        if (gem) void this.loadArt(gem, revision);
    }

    private render(gem: IRoleGemEntry | null): void {
        const hasGem = !!gem;
        if (this.socketButton) this.socketButton.interactable = hasGem;
        if (this.qualitySprite) this.qualitySprite.node.active = hasGem;
        if (this.gemSprite) this.gemSprite.node.active = hasGem;
        if (this.emptyRing) this.emptyRing.active = !hasGem;
        if (!hasGem) {
            if (this.qualitySprite) this.qualitySprite.spriteFrame = null;
            if (this.gemSprite) this.gemSprite.spriteFrame = null;
        }
    }

    private onClick(): void {
        const socket = this.currentSocket;
        if (!socket || !socket.gemId) return;
        this.clickCallback?.(socket);
    }

    private async loadArt(gem: IRoleGemEntry, revision: number): Promise<void> {
        const [quality, icon] = await Promise.all([
            loadRoleQualityFrame(gem.quality || 1),
            gem.iconKey ? loadRoleBagIconSprite('gem', gem.iconKey) : Promise.resolve(null),
        ]);
        if (!this.isValid || revision !== this.renderRevision) return;
        if (this.qualitySprite && quality) this.qualitySprite.spriteFrame = quality;
        if (this.gemSprite && icon) this.gemSprite.spriteFrame = icon;
    }
}
