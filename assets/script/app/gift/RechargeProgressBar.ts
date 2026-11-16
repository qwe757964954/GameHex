import { _decorator, Component, Label, Node, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 礼包活动页公用进度条。
 *
 * 不使用 `cc.ProgressBar`：这里只需按底条满宽和比例设置填充条宽度，
 * 避免 `cc.ProgressBar` 在槽位复用时保留上一帧进度。
 * `Bar` 锚点必须为 `(0, 0.5)`。
 */
@ccclass('RechargeProgressBar')
export class RechargeProgressBar extends Component {
    @property({ type: Node, tooltip: 'Bg：底条（满宽，用来取宽度上限）' })
    bg: Node = null!;

    @property({ type: Node, tooltip: 'Bar：填充条（锚点必须 (0,0.5)）' })
    bar: Node = null!;

    /** 累计页顶部没有文本，因此该引用可为空。 */
    @property({ type: Label, tooltip: 'Value：进度文本（有些进度条没有文本，留空即可）' })
    valueLabel: Label | null = null;

    /**
     * 铺进度。
     *
     * @param value 当前值
     * @param max   满值（`<= 0` 时按 0 处理，避免除零）
     * @param text  进度文本；传 `null` 时保留 prefab 上的静态文本（`valueLabel` 为空则忽略）
     */
    render(value: number, max: number, text: string | null = null): void {
        const full = this.bg.getComponent(UITransform).contentSize.width;
        const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

        const barTrans = this.bar.getComponent(UITransform);
        barTrans.setContentSize(full * ratio, barTrans.contentSize.height);
        this.bar.setPosition(-full / 2, this.bar.position.y, 0);

        if (this.valueLabel && text !== null) this.valueLabel.string = text;
    }
}
