import { _decorator, Color, Component, Sprite } from 'cc';

const { ccclass, property, executeInEditMode } = _decorator;

/** 编辑器和运行时共用的白图底板；Sprite 与尺寸由 Prefab 提供。 */
@ccclass('BigMapPanel')
@executeInEditMode
export class BigMapPanel extends Component {
    @property(Sprite) background: Sprite = null!;
    @property(Color) fill = new Color(72, 73, 83, 232);

    protected onEnable(): void {
        this.redraw();
    }
    protected onValidate(): void { if (this.background) this.redraw(); }

    redraw(): void {
        this.background.color = this.fill;
    }
}
