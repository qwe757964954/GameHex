import { _decorator, Component, Label, Node, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 礼包活动页的**公用进度条**（内联在 `Gift.prefab` 的 `DailyPage` / `RechargeTotalPage` 下）。
 *
 * 结构照 FGUI `共用组件/组件/进度条/进度条01_公用_数值.xml`：
 *   `Bg`（`公用_九宫_进度条01底.png`，SLICED）+ `Bar`（`公用_九宫_进度条02.png`，SLICED）+ `Value`（文本）。
 *
 * ⚠️ **不用 `cc.ProgressBar`**，改「按宽度拉伸的 Sprite」，理由照 `SevenDayPointBox`：
 *   `cc.ProgressBar` 要另引一个填充 Sprite、`totalLength`/`progress` 两个 setter 都是
 *   「值没变就早退」，槽位复用时会把宽度停在上一行的值上；而这条链只需要
 *   「按底条满宽 × ratio 改一次宽度」，一个属性、无隐藏状态。
 *
 * ⚠️ `Bar` 的锚点必须是 **(0, 0.5)**：宽度变化时左端不动，靠 `position.x = -满宽/2` 对齐底条左缘。
 */
@ccclass('RechargeProgressBar')
export class RechargeProgressBar extends Component {
    @property({ type: Node, tooltip: 'Bg：底条（满宽，用来取宽度上限）' })
    bg: Node = null!;

    @property({ type: Node, tooltip: 'Bar：填充条（锚点必须 (0,0.5)）' })
    bar: Node = null!;

    /** 累计页顶部的 `ProgressBar1` 没有文本 ⇒ 这个引用允许为空，代码里判一次。 */
    @property({ type: Label, tooltip: 'Value：进度文本（有些进度条没有文本，留空即可）' })
    valueLabel: Label = null!;

    /**
     * 铺进度。
     *
     * @param value 当前值
     * @param max   满值（`<= 0` 时按 0 处理，避免除零）
     * @param text  进度文本；传 `null` 时保留 prefab 上的静态文本（`valueLabel` 为空则忽略）
     */
    render(value: number, max: number, text: string | null = null): void {
        const full = this.bg.getComponent(UITransform)!.contentSize.width;
        const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

        const barTrans = this.bar.getComponent(UITransform)!;
        barTrans.setContentSize(full * ratio, barTrans.contentSize.height);
        this.bar.setPosition(-full / 2, this.bar.position.y, 0);

        if (this.valueLabel && text !== null) this.valueLabel.string = text;
    }
}
