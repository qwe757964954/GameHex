import { _decorator, Color, Component, Graphics, UITransform } from 'cc';
import { drawBigMapCardPanel } from './BigMapSkin';
import { drawPanel } from './BigMapTheme';

const { ccclass, property, executeInEditMode } = _decorator;

/** 编辑器和运行时共用的底板样式；节点与 Graphics 均由 Prefab 提供。 */
@ccclass('BigMapPanel')
@executeInEditMode
export class BigMapPanel extends Component {
    @property(Graphics) graphics: Graphics = null;
    @property(UITransform) transform: UITransform = null;
    @property card = true;
    @property radius = 12;
    @property(Color) fill = new Color(72, 73, 83, 232);
    @property(Color) border = new Color(176, 138, 78);
    @property hasBorder = true;

    protected onEnable(): void {
        this.node.on(NodeSizeChanged, this.redraw, this);
        this.redraw();
    }
    protected onDisable(): void { this.node.off(NodeSizeChanged, this.redraw, this); }
    protected onValidate(): void { if (this.graphics && this.transform) this.redraw(); }

    redraw(): void {
        const { width, height } = this.transform;
        if (this.card) drawBigMapCardPanel(this.graphics, width, height, this.radius, this.fill);
        else drawPanel(this.graphics, width, height, this.fill, this.hasBorder ? this.border : null, this.radius);
    }
}

const NodeSizeChanged = 'size-changed';
