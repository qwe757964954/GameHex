import { _decorator, Button, Component, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 倍率切换角标（FGUI 挂机包 `按钮_切换.xml`，源 115×62，界面里 `scale=0.8`）。
 *
 * 结构 = 底图（`公用0/图片/装饰_texture/zhek_1.png`）+ `times_text`（`x5`）+ 内嵌的
 * `按钮_公共_通用`（那个小箭头）。**整体可点**（FGUI `extention="Button"`）。
 *
 * ## 关键口径（老端 `refreshGearBtn` / `onClickChangeGear`）
 *
 * - 角标文案 = `x{当前倍率}`，倍率档位 `[1, 5, 10, 20, 50]`。
 * - **对所有玩家可见**（策划 2026-09-17 改需求）；但只有福利月卡（特权 type 4
 *   「无限次快速扫荡」）玩家点得动，非月卡玩家点了只弹「激活月卡后解锁功能」。
 * - ⚠️ 非月卡时**必须把档位复位到 1 倍** —— 否则「刚点成 50 倍、月卡就到期」的玩家
 *   下一次快速征收会按 50 倍扣体力（老端注释原话）。
 *
 * 本组件**不做业务判断**：切档/拦截的决策都在 `HangPage`，这里只负责转发点击 + 显示文案。
 */
@ccclass('HangGearSwitch')
export class HangGearSwitch extends Component {
    @property({ type: Label, tooltip: '`x5` 角标（FGUI `times_text`）' })
    timesText: Label = null;

    @property({ type: Button, tooltip: '整块按钮（FGUI `extention="Button"`）' })
    button: Button = null;

    @property({ type: Node, tooltip: '内嵌 `按钮_公共_通用` 的小箭头（FGUI `change_btn`）' })
    arrow: Node = null;

    private _onTap: (() => void) | null = null;

    /** 绑定点击回调（切档决策在 `HangPage`）。 */
    bindTap(handler: (() => void) | null): void {
        this._onTap = handler;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this._handleClick, this);
    }

    protected onDestroy(): void {
        // ⚠️ 判 `isValid` 后再摘监听（规则 60 的同类问题）
        if (this.node && this.node.isValid) this.node.off(Button.EventType.CLICK, this._handleClick, this);
    }

    private _handleClick(): void {
        if (this._onTap) this._onTap();
    }

    /** 铺一次角标文案（`x1` / `x5` / …）。 */
    render(timesLabel: string): void {
        if (this.timesText) this.timesText.string = timesLabel;
    }
}
