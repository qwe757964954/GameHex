import { _decorator, Color, Component, Graphics, Label, Node, Sprite, SpriteFrame } from 'cc';
import { bigMapMarkerLayout, type IBigMapMarkerHitArea } from './BigMapWorldLayout';
import { paintMapMarkerBadge } from '../../common/MapMarkerBadge';

const { ccclass, property } = _decorator;

/** 节点和排版由预制体提供，池化实例只更新本次标记的显示数据。 */
@ccclass('BigMapWorldMarker')
export class BigMapWorldMarker extends Component {
    @property({ type: Sprite, group: '图标' }) icon: Sprite = null!;
    @property({ type: Sprite, group: '角标' }) private badge: Sprite = null!;
    @property({ type: Label, group: '角标' }) private label: Label = null!;
    @property({ type: Graphics, group: '角标' }) private badgeBackground: Graphics = null!;
    @property({ type: Node, group: '玩家头像' }) private portraitRoot: Node = null!;
    @property({ type: Sprite, group: '玩家头像' }) private portrait: Sprite = null!;
    @property({ type: Graphics, group: '玩家头像' }) private portraitBackground: Graphics = null!;

    private markerLayout: Omit<IBigMapMarkerHitArea, 'hexId'> = { width: 0, height: 0 };

    get hitArea(): Omit<IBigMapMarkerHitArea, 'hexId'> { return this.markerLayout; }

    render(frame: SpriteFrame | null, title: string, tint: Color, width: number): void {
        const scale = frame ? width / frame.rect.width : 1;
        this.markerLayout = bigMapMarkerLayout(frame ? width : 0, frame ? frame.rect.height * scale : 0);
        this.portraitRoot.active = false;
        this.badge.node.active = true;
        this.icon.spriteFrame = frame;
        this.icon.node.active = !!frame;
        this.icon.color = Color.WHITE;
        this.icon.node.setScale(scale, scale, 1);
        this.icon.node.setPosition(frame ? -frame.offset.x * scale : 0,
            (frame ? -frame.offset.y * scale : 0) + (this.markerLayout.iconY ?? 0), 0);
        this.badge.node.setPosition(0, this.markerLayout.badgeY ?? 0, 0);
        this.badge.enabled = false;
        paintMapMarkerBadge(this.badgeBackground, tint, new Color(49, 31, 26));
        this.label.string = title;
        this.label.color = Color.WHITE;
        this.badge.color = tint;
    }

    setPortrait(frame: SpriteFrame | null): void {
        this.portrait.spriteFrame = frame;
        this.portraitRoot.active = frame !== null;
        this.badge.node.active = frame === null;
        if (!frame) return;
        const y = (this.markerLayout.badgeY ?? 0) + 48;
        this.portraitRoot.setPosition(0, y, 0);
        const g = this.portraitBackground;
        g.clear();
        g.fillColor = new Color(245, 122, 119);
        g.strokeColor = new Color(49, 31, 26);
        g.lineWidth = 3;
        g.roundRect(-48, -48, 96, 96, 10);
        g.fill();
        g.stroke();
        g.moveTo(-12, -47);
        g.lineTo(-12, -60);
        g.lineTo(8, -47);
        g.close();
        g.fill();
        g.stroke();
        this.markerLayout = { ...this.markerLayout, badgeY: y, badgeHeight: 110 };
    }
}
