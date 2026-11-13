import { _decorator, Component, Graphics, Label, Sprite, UITransform } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('BigMapBasePlot')
export class BigMapBasePlot extends Component {
    @property(Graphics) selection: Graphics = null;
    /
     *选中底光（暖金光晕，画在建筑图下面）。
     *
     *为什么用 `Graphics` 而不是贴图：项目里没有现成的椭圆光晕图，贴图方案要多引一张图；
     *这里只需要「亮一点点」的语感，实心椭圆压半透明就够，还少一次合批拆分。
     */
    @property(Graphics) glow: Graphics = null!;
    /
     *建造进度环（画在建筑图上面，沿格子轮廓走）。
     *
     *原先「建造中」只有格子上方那一行 `120s` 小字，二十几格同屏时根本找不到哪几格在施工。
     */
    @property(Graphics) progressRing: Graphics = null!;
    @property(Sprite) icon: Sprite = null;
    @property(Sprite) badge: Sprite = null;
    @property(UITransform) badgeTransform: UITransform = null;
    @property(Label) nameLabel: Label = null;
    @property(Label) status: Label = null;
    @property(Sprite) resource: Sprite = null;
}
