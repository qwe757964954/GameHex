import { _decorator, BlockInputEvents, Button, Color, Component, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';

const { ccclass, property } = _decorator;

export interface IBigMapTargetPanelContent {
    readonly title: string;
    readonly headings: readonly string[];
    readonly sections: readonly string[];
    readonly tip: string;
    readonly primaryCaption: string;
    readonly primaryEnabled: boolean;
    readonly staminaCost: number;
    readonly staminaIcon: SpriteFrame | null;
}

/** 复用设计稿弹窗节点；只接收展示数据，开战资格与网络请求仍由 Presenter 决定。 */
@ccclass('BigMapTargetPanel')
export class BigMapTargetPanel extends Component {
    @property(UITransform) private rootTransform: UITransform = null!;
    @property(UITransform) private panelTransform: UITransform = null!;
    @property(UITransform) private dimTransform: UITransform = null!;
    @property(Label) private title: Label = null!;
    @property([Label]) private headings: Label[] = [];
    @property([Label]) private sections: Label[] = [];
    @property(Label) private tip: Label | null = null;
    @property(Button) private primary: Button = null!;
    @property(Label) private primaryLabel: Label = null!;
    @property(Sprite) private primaryBackground: Sprite = null!;
    @property(Label) private cost: Label = null!;
    @property(Sprite) private costIcon: Sprite = null!;
    @property(Node) private costBackground: Node = null!;
    @property(Button) private secondary: Button = null!;
    @property(Label) private secondaryLabel: Label = null!;
    @property(Button) private close: Button = null!;

    private onPrimary: (() => void) | null = null;
    private onSecondary: (() => void) | null = null;
    private onClose: (() => void) | null = null;

    initialize(width: number, height: number, primary: () => void, secondary: () => void, close: () => void): void {
        this.onPrimary = primary;
        this.onSecondary = secondary;
        this.onClose = close;
        this.rootTransform.setContentSize(width, height);
        this.dimTransform.setContentSize(width, height);
        this.node.setPosition(0, 0, 0);
        const scale = Math.min(1, (width - 32) / this.panelTransform.width, (height - 64) / this.panelTransform.height);
        this.panelTransform.node.setPosition(0, 0, 0);
        this.panelTransform.node.setScale(scale, scale, 1);
        if (!this.dimTransform.node.getComponent(BlockInputEvents)) this.dimTransform.node.addComponent(BlockInputEvents);
        if (!this.panelTransform.node.getComponent(BlockInputEvents)) this.panelTransform.node.addComponent(BlockInputEvents);
        this.primary.node.on(Button.EventType.CLICK, this.handlePrimary, this);
        this.secondary.node.on(Button.EventType.CLICK, this.handleSecondary, this);
        this.close.node.on(Button.EventType.CLICK, this.handleClose, this);
        this.dimTransform.node.on(Node.EventType.TOUCH_END, this.handleClose, this);
        this.node.active = false;
    }

    render(content: IBigMapTargetPanelContent): void {
        this.title.string = content.title;
        this.headings.forEach((label, index) => { label.string = content.headings[index] ?? ''; });
        this.sections.forEach((label, index) => { label.string = content.sections[index] ?? ''; });
        if (this.tip) this.tip.string = content.tip;
        this.primaryLabel.string = content.primaryCaption;
        this.primary.interactable = content.primaryEnabled;
        this.primaryBackground.color = content.primaryEnabled ? Color.WHITE : new Color(155, 155, 155);
        this.secondaryLabel.string = '定位';
        this.secondary.interactable = true;
        const hasCost = content.staminaCost > 0;
        this.cost.string = hasCost ? String(content.staminaCost) : '';
        this.cost.node.active = hasCost;
        this.costBackground.active = hasCost;
        this.costIcon.spriteFrame = content.staminaIcon;
        this.costIcon.node.active = hasCost && content.staminaIcon !== null;
        this.node.active = true;
        this.node.setSiblingIndex(this.node.parent ? this.node.parent.children.length - 1 : 0);
    }

    hide(): void { this.node.active = false; }

    private handlePrimary(): void { if (this.primary.interactable) this.onPrimary?.(); }
    private handleSecondary(): void { this.onSecondary?.(); }
    private handleClose(): void { this.onClose?.(); }

    onDestroy(): void {
        this.onPrimary = null;
        this.onSecondary = null;
        this.onClose = null;
    }
}
