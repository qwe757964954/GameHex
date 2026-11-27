import { _decorator, Button, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import { roleRepository } from './RoleRepository';
import type { IRoleGemEntry, IRoleGemSocket } from './RoleTypes';

const { ccclass, property } = _decorator;

/** 普通孔位行的奶油底；当前查看的那颗宝石用暖金底提亮。 */
const ROW_BG_NORMAL = new Color(255, 255, 255, 255);
const ROW_BG_VIEWED = new Color(255, 242, 220, 255);

/**
 * 宝石详情里的单个孔位行（蓝湖「宝石镶嵌」样式）。
 *
 * 有宝石：品质底 + 宝石图标 + 完整效果文案 + 右侧「镶嵌」按钮；
 * 空槽：金色加号 + 「点击镶嵌宝石」。
 *
 * 行点击交回宿主弹窗：有宝石 = 切查看 / 当前宝石卸下；空槽 = 把当前宝石镶进该部位。
 * 右侧「镶嵌」按钮则直接把当前查看的宝石镶进这一孔（已占用时走替换确认）。
 */
@ccclass('RoleGemSocketTile')
export class RoleGemSocketTile extends Component {
    @property({ type: Sprite, tooltip: '孔位行底色' })
    rowBg: Sprite = null!;

    @property({ type: Sprite, tooltip: '品质底' })
    qualitySprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    gemSprite: Sprite = null!;

    @property({ type: Node, tooltip: '空槽加号图标' })
    addIcon: Node = null!;

    @property({ type: Label, tooltip: '宝石名（新样式不展示，保留兼容）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '宝石效果全文（可换行）' })
    descLabel: Label = null!;

    @property({ type: Label, tooltip: '空槽文案「点击镶嵌宝石」' })
    emptyLabel: Label = null!;

    @property({ type: Button, tooltip: '孔位点击按钮（挂在本节点，NONE 过渡）' })
    socketButton: Button = null!;

    @property({ type: Button, tooltip: '行内「镶嵌」按钮' })
    inlayButton: Button = null!;

    @property({ type: Sprite, tooltip: '行内「镶嵌」按钮底图' })
    inlaySprite: Sprite = null!;

    @property({ type: Label, tooltip: '行内「镶嵌」按钮文字' })
    inlayLabel: Label = null!;

    @property({ type: SpriteFrame, tooltip: '未查看状态的行内按钮（绿色）' })
    inlayGreenFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '当前查看状态的行内按钮（金色）' })
    inlayYellowFrame: SpriteFrame = null!;

    private renderRevision = 0;
    private currentSocket: IRoleGemSocket | null = null;
    private viewed = false;
    private clickCallback?: (socket: IRoleGemSocket) => void;
    private inlayCallback?: (socket: IRoleGemSocket) => void;
    private suppressRowClick = false;

    protected onLoad(): void {
        this.socketButton.node.on(Button.EventType.CLICK, this.onRowClick, this);
        this.inlayButton.node.on(Button.EventType.CLICK, this.onInlayClick, this);
    }

    public setData(
        socket: IRoleGemSocket | null | undefined,
        onSocketClick?: (socket: IRoleGemSocket) => void,
        viewedGemId?: string,
        onInlayClick?: (socket: IRoleGemSocket) => void,
    ): void {
        const revision = ++this.renderRevision;
        this.currentSocket = socket ?? null;
        this.clickCallback = onSocketClick;
        this.inlayCallback = onInlayClick;
        const gem = socket?.gemId ? roleRepository.findGem(socket.gemId) : null;
        this.viewed = !!gem && gem.gemId === viewedGemId;
        this.render(gem);

        if (gem) void this.loadArt(gem, revision);
    }

    /** 仅供测试与外部刷新读取当前渲染的宝石，避免重复查仓库。 */
    public get gem(): IRoleGemEntry | null {
        return this.currentSocket?.gemId ? roleRepository.findGem(this.currentSocket.gemId) : null;
    }

    private render(gem: IRoleGemEntry | null): void {
        const hasGem = !!gem;
        this.socketButton.interactable = !!this.currentSocket;
        if (this.rowBg) this.rowBg.color = this.viewed ? ROW_BG_VIEWED : ROW_BG_NORMAL;
        if (this.qualitySprite) this.qualitySprite.node.active = hasGem;
        if (this.gemSprite) this.gemSprite.node.active = hasGem;
        if (this.addIcon) this.addIcon.active = !hasGem;
        if (this.nameLabel) {
            this.nameLabel.node.active = false;
            this.nameLabel.string = gem?.name ?? '';
        }
        if (this.descLabel) {
            this.descLabel.node.active = hasGem;
            this.descLabel.string = gem ? gem.desc || '属性未知' : '';
        }
        if (this.emptyLabel) {
            this.emptyLabel.node.active = !hasGem;
            this.emptyLabel.string = '点击镶嵌宝石';
        }
        if (this.inlayButton) this.inlayButton.node.active = hasGem;
        if (this.inlaySprite) {
            const frame = this.viewed ? this.inlayYellowFrame : this.inlayGreenFrame;
            if (frame) this.inlaySprite.spriteFrame = frame;
        }
        if (this.inlayLabel) this.inlayLabel.string = '镶嵌';
        if (!hasGem) {
            if (this.qualitySprite) this.qualitySprite.spriteFrame = null;
            if (this.gemSprite) this.gemSprite.spriteFrame = null;
        }
    }

    private onRowClick(): void {
        if (this.suppressRowClick) return;
        const socket = this.currentSocket;
        if (!socket) return;
        this.clickCallback?.(socket);
    }

    private onInlayClick(): void {
        const socket = this.currentSocket;
        if (!socket) return;
        // 行内按钮叠在整行 Button 上，先压住同一次点击的行级处理。
        this.suppressRowClick = true;
        this.scheduleOnce(() => { this.suppressRowClick = false; }, 0.05);
        this.inlayCallback?.(socket);
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
