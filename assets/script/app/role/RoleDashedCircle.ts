import { _decorator, CCFloat, CCInteger, Color, Component, Graphics } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 空宝石槽位的虚线圆环。
 *
 * 现有美术里没有可直接复用的虚线圆环切图，这里用 `Graphics` 绘制；
 * 不新增图片资源，颜色与半径均可在 Prefab 中调整。
 */
@ccclass('RoleDashedCircle')
export class RoleDashedCircle extends Component {
    @property({ type: CCFloat, tooltip: '圆环半径（像素）' })
    radius = 16;

    @property({ type: CCFloat, tooltip: '线宽（像素）' })
    lineWidth = 2;

    @property({ type: CCInteger, tooltip: '圆周虚线数量' })
    dashCount = 18;

    @property({ type: Color, tooltip: '虚线颜色' })
    color: Color = new Color(58, 35, 19, 130);

    protected onLoad(): void {
        this.redraw();
    }

    protected onEnable(): void {
        this.redraw();
    }

    /** 数据或尺寸变化后重绘；绘制命令不参与序列化，运行时由组件重建。 */
    public redraw(): void {
        const graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        graphics.clear();
        if (this.radius <= 0 || this.dashCount <= 0) return;

        graphics.lineWidth = this.lineWidth;
        graphics.strokeColor = this.color;
        const step = Math.PI * 2 / this.dashCount;
        for (let i = 0; i < this.dashCount; i++) {
            graphics.arc(0, 0, this.radius, i * step, i * step + step * 0.55, false);
        }
        graphics.stroke();
    }
}
