import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { HJ_SPRITE_SIMPLE } from './HangArt';

const { ccclass, property } = _decorator;

/**
 * 「快速征收」按钮（FGUI 挂机包 `按钮_快速征收.xml`，150×68）。
 *
 * ## FGUI 的 `免费` 控制器 → 这里的 `renderFree`
 *
 * | FGUI 页 | 语义 | `title` 位置（组件内） | 广告小图标 `n6` |
 * |---|---|---|---|
 * | 0 = 否 | 免费次数**已用完** | `(85,44)` | **显示**（点它能看广告换次数） |
 * | 1 = 是 | 还有免费次数 | `(79,53)` | 隐藏 |
 *
 * 老端 `btn.setSelectedIndex("免费", sweepTimes >= sweepFreeTimes ? 0 : 1)` —— 注意方向：
 * **免费次数用完 → page 0**。别再按「`是` 就是有免费」的顺序写反。
 *
 * ## 花费文案
 *
 * `cost` 的文本 = `x{end × times}`（`end` = 该关单次体力消耗，`times` = 当前倍率）。
 * 服务端按同一口径扣体力，所以这个数字必须跟着倍率走（老端 `refreshBtn` 原注释）。
 *
 * ⚠️ 底图是**实图**（`TY_btn23` → `fd_tab_off`），但文案仍必须另挂 Label 子节点
 * （技能 §10.3：`icon` 与 `title` 在 FGUI 里是两回事，少一个子 Label 就是「空按钮」）。
 */
@ccclass('HangSweepButton')
export class HangSweepButton extends Component {
    @property({ type: Button, tooltip: '整块按钮' })
    button: Button = null!;

    @property({ type: Label, tooltip: '「快速征收」（跟随 `免费` 页换位置）' })
    title: Label = null!;

    @property({ type: Node, tooltip: '看广告小图标（`免费` = 否 时显示）' })
    adIcon: Node = null!;

    @property({ type: Sprite, tooltip: '体力图标（`roleProperty.end = 9` ⇒ `图标_体力`）' })
    costIcon: Sprite = null!;

    @property({ type: Label, tooltip: '`x10` 形态的花费文案' })
    cost: Label = null!;

    @property({ type: Node, tooltip: '红点（FGUI `com_rd`；截图无红点 ⇒ 默认隐藏，留待红点系统接）' })
    redDot: Node = null!;

    /** `title` 在「否」页的位置（组件内相对中心的局部坐标）。 */
    private static readonly TITLE_POS_NOT_FREE = { x: 10, y: -10 };
    /** `title` 在「是」页的位置。 */
    private static readonly TITLE_POS_FREE = { x: 4, y: -19 };

    private _onTap: (() => void) | null = null;

    /** 绑定点击回调（防抖 / 体力校验 / 广告二次确认都在 `HangPage`）。 */
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

    /**
     * 切「免费」页。
     *
     * @param hasFree 还有免费次数吗（= FGUI page 1 = `是`）
     */
    renderFree(hasFree: boolean): void {
        const pos = hasFree ? HangSweepButton.TITLE_POS_FREE : HangSweepButton.TITLE_POS_NOT_FREE;
        if (this.title) this.title.node.setPosition(pos.x, pos.y, 0);
        if (this.adIcon) this.adIcon.active = !hasFree;
    }

    /** 铺花费文案（`x10`）。 */
    renderCost(text: string): void {
        if (this.cost) this.cost.string = text;
    }

    /** 铺体力图标。 */
    renderCostIcon(frame: SpriteFrame | null): void {
        if (!this.costIcon) return;
        this.costIcon.spriteFrame = frame;
        this.costIcon.type = HJ_SPRITE_SIMPLE;
        this.costIcon.node.active = !!frame;
    }

    /** 红点显隐（本轮恒 `false`）。 */
    renderRedDot(visible: boolean): void {
        if (this.redDot) this.redDot.active = visible;
    }
}
