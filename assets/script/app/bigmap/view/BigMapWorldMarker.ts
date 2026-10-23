import { _decorator, Color, Component, Label, Sprite, SpriteFrame } from 'cc';
import { BIGMAP_MARKER_ICON_LIFT } from './BigMapWorldLayout';

const { ccclass, property } = _decorator;

/** 节点和排版由预制体提供，池化实例只更新本次标记的显示数据。 */
@ccclass('BigMapWorldMarker')
export class BigMapWorldMarker extends Component {
    @property({ type: Sprite, group: '图标' }) icon: Sprite = null!;
    @property({ type: Sprite, group: '角标' }) private badge: Sprite = null!;
    @property({ type: Label, group: '角标' }) private label: Label = null!;

    render(frame: SpriteFrame | null, title: string, tint: Color, width: number): void {
        const scale = frame ? width / frame.rect.width : 1;
        this.icon.spriteFrame = frame;
        this.icon.node.active = !!frame;
        this.icon.color = Color.WHITE;
        this.icon.node.setScale(scale, scale, 1);
        this.icon.node.setPosition(frame ? -frame.offset.x * scale : 0,
            (frame ? -frame.offset.y * scale : 0) + BIGMAP_MARKER_ICON_LIFT, 0);
        this.label.string = title;
        this.label.color = Color.WHITE;
        this.badge.color = tint;
    }
}
