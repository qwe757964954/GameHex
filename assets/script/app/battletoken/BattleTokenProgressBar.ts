import { _decorator, Component, Label, ProgressBar } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 战令等级经验条（FGUI `组件/进度条/进度条01_公用_数值.xml`，60×24 → 显示 359×24）。
 *
 * ## 两张图
 *
 * | FGUI 源 | 落盘 | 九宫 |
 * |---|---|---|
 * | `公用0/公用_九宫_进度条01底.png` | `bt_bar_bg`（40×24） | **`18,10,7,3`**（漏了 ⇒ 两头的圆角被拉成椭圆） |
 * | `公用0/公用_九宫_进度条02.png` | `bt_bar_fill`（40×24） | **`20,11,2,3`** |
 *
 * ⚠️ 填充图九宫**必须**在 prefab 里写 `_type = 1(SLICED)`：`cc.ProgressBar` 的
 * `HORIZONTAL` 模式会把填充节点的宽度按比例缩放（40 → 最多 359），不切九宫就会
 * **整张横向拉变形**（还不报错）。
 *
 * ⚠️ 满级时 `max` 写死 1000（老端 `VOBattleToken.GetExpMax()`），不是配置里的
 * `levelUpCostEnd`（50）—— 见 `BattleTokenTable.expMaxOf`。
 */
@ccclass('BattleTokenProgressBar')
export class BattleTokenProgressBar extends Component {
    @property({ type: ProgressBar, tooltip: '进度条本体（HORIZONTAL 模式，barSprite = BarFill）' })
    bar: ProgressBar = null!;

    @property({ type: Label, tooltip: '条上的数值文案（FGUI `显示进度文本` 控制器默认显示）' })
    valueLabel: Label = null!;

    /**
     * 设进度。
     *
     * `totalLength` 由 prefab 写死（359）—— **不要在这里按 `UITransform` 现算**：
     * `cc.ProgressBar` 的 `totalLength = 0` 时会退化成用节点宽度，而本组件的节点宽度
     * 在运行时会被 Widget/布局改过，现算会随帧漂移。
     */
    setProgress(value: number, max: number, text: string | null = null): void {
        if (this.bar) {
            this.bar.progress = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
        }
        if (this.valueLabel) this.valueLabel.string = text ?? `${value}`;
    }
}
