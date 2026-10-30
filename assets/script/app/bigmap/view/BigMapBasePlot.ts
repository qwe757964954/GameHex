import { _decorator, Component, Graphics, Label, Sprite, UITransform } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BigMapBasePlot')
export class BigMapBasePlot extends Component {
    @property(Graphics) selection: Graphics = null;
    @property(Sprite) icon: Sprite = null;
    @property(Sprite) badge: Sprite = null;
    @property(UITransform) badgeTransform: UITransform = null;
    @property(Label) nameLabel: Label = null;
    @property(Label) status: Label = null;
    @property(Sprite) resource: Sprite = null;
}
