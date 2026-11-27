import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { RoleEvent } from './RoleEvents';

const { ccclass, property } = _decorator;

export interface IEquipDecomposeItemViewData {
    readonly uniqueId: string;
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
    readonly rankText: string;
    readonly levelText: string;
}

@ccclass('EquipDecomposeItem')
export class EquipDecomposeItem extends Component {
    @property({ type: Sprite, tooltip: '装备品质框' })
    private quality: Sprite = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    private icon: Sprite = null!;

    @property({ type: Label, tooltip: '装备品阶' })
    private rankLabel: Label = null!;

    @property({ type: Label, tooltip: '装备等级' })
    private levelLabel: Label = null!;

    @property({ type: Node, tooltip: '装备勾选标记' })
    private check: Node = null!;

    private itemId = '';
    private defaultQualityFrame: SpriteFrame | null | undefined = undefined;

    get uniqueId(): string {
        return this.itemId;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    protected onDestroy(): void {
        this.node.off(Button.EventType.CLICK, this.onClick, this);
    }

    render(data: IEquipDecomposeItemViewData, selected: boolean): void {
        if (this.defaultQualityFrame === undefined) this.defaultQualityFrame = this.quality.spriteFrame;

        this.itemId = data.uniqueId;
        this.quality.spriteFrame = data.qualityFrame ?? this.defaultQualityFrame;
        this.icon.spriteFrame = data.iconFrame;
        this.icon.node.active = data.iconFrame !== null;
        this.rankLabel.string = data.rankText;
        this.levelLabel.string = data.levelText;
        this.levelLabel.node.active = data.levelText !== '';
        this.renderSelection(selected);
    }

    renderSelection(selected: boolean): void {
        this.check.active = selected;
    }

    private onClick(): void {
        EventMgr.instance.emit(RoleEvent.DecomposeItemClick, this.itemId, this);
    }
}
