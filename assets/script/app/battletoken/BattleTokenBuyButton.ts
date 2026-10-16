import { _decorator, Button, CCInteger, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 购买按钮（FGUI `按钮_购买.xml` / `按钮_购买_免费.xml`，193×74）。
 *
 * ## 三种配色（FGUI `颜色` 控制器 `pages="0,黄,1,红"`）
 *
 * | kind | 底图 | 文案 | 谁用 |
 * |---|---|---|---|
 * | `free` | `bt_btn_free` | 固定「今日福利」 | 方案 1（免费档） |
 * | `rmb` | `bt_btn_yellow`（方案 1/2）/ `bt_btn_red`（`颜色=1`，方案 2） | `￥<金额>` | 付费档位 |
 * | `item` | `bt_btn_yellow` | `<数量>` + 左侧道具图标 | **过关令方案 2**（680 金币） |
 *
 * ## ⚠️ 图标与文案是行内横排的，宽度不是固定的
 *
 * FGUI 里 `icon`（pivot `1,0.5`）与 `title`（pivot `0,0.5`）放在 `n22` 这个
 * `layout="hz" colGap="2" excludeInvisibles="true"` 的**横向布局组**里 ——
 * 也就是「图标 + 文案」整体在按钮上**居中**，而 `icon` 可能在需要时隐藏（`visible=false`，
 * 老端 `refreshBtn` 里 `rmb > 0` 时把 `costIcon.visible = false`）。
 *
 * 移植时不做自动布局，按**两种固定摆法**切换：
 *   - 有图标（道具支付）：图标在左、文案在右（相对按钮中心对称）
 *   - 无图标（人民币）：只有文案，居中
 *
 * ⚠️ **纯色底图必须另加 Label 子节点**（规则 9）—— 漏了不报错、只是空按钮。
 */
@ccclass('BattleTokenBuyButton')
export class BattleTokenBuyButton extends Component {
    @property({ type: Sprite, tooltip: '底图（bt_btn_yellow / bt_btn_red / bt_btn_free）' })
    bg: Sprite = null!;

    @property({ type: Sprite, tooltip: '货币 / 道具小图标（无图标时整节点隐藏）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: '金额（￥6）或数量（680）' })
    title: Label = null!;

    @property({ type: Button, tooltip: '按钮本体' })
    button: Button = null!;

    @property({ type: Node, tooltip: '已开通的对勾（FGUI n21，挂 `gearDisplay controller="解锁" pages="1"`）' })
    checkMark: Node = null!;

    @property({ type: SpriteFrame, tooltip: '黄底（生成器写入）' })
    yellowFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '红底（生成器写入）' })
    redFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '免费档底图（生成器写入）' })
    freeFrame: SpriteFrame = null!;

    /**
     * 图标有 / 无时，**文字节点左边缘**相对按钮中心的 `x`（生成器按 FGUI 的 `hz` 组算出）。
     *
     * ⚠️ 文字节点是 `anchor (0, 0.5)` + `align LEFT` ⇒ 这两个值指的是**左边缘**、不是中心。
     * FGUI 的 `n22`（`layout="hz" colGap=2 excludeInvisibles`）会把「图标 32 + 间隙 2 + 文字 52」
     * 作为一个整体居中：
     *   - 有图标：组宽 86 ⇒ 组左边缘 96.5−43 = 53.5 ⇒ 图标 53.5..85.5、文字左边缘 87.5 → **−9**
     *   - 无图标：组宽 52 ⇒ 文字左边缘 70.5 → **−26**
     */
    @property({ type: CCInteger, tooltip: '有图标时文字左边缘的 x' })
    titleXWithIcon = 0;

    @property({ type: CCInteger, tooltip: '无图标时文字左边缘的 x' })
    titleXNoIcon = 0;

    /** 有图标时图标的 `x`（图标锚点是中心；FGUI 组左边缘 53.5 + 16 = 69.5 → 相对按钮中心 **−27**）。 */
    @property({ type: CCInteger, tooltip: '有图标时图标的 x' })
    iconX = 0;

    private _onBuy: (() => void) | null = null;

    bindBuy(handler: (() => void) | null): void {
        this._onBuy = handler;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this._handleClick, this);
    }

    protected onDestroy(): void {
        if (this.node && this.node.isValid) this.node.off(Button.EventType.CLICK, this._handleClick, this);
    }

    private _handleClick(): void {
        if (this._onBuy) this._onBuy();
    }

    /**
     * 铺一次状态（全部**绝对赋值**，规则 10）。
     *
     * @param kind       `free` / `rmb` / `item`
     * @param text       文案（`￥6` 或 `680`）
     * @param iconFrame  图标帧（`null` ⇒ 隐藏图标并把文案移回居中位）
     * @param unlocked   该档位已开通（显示对勾；不改变按钮可点性，由页面控制）
     * @param red        是否为「红底」（方案 2 用红）
     */
    render(
        kind: 'free' | 'rmb' | 'item',
        text: string,
        iconFrame: SpriteFrame | null,
        unlocked: boolean,
        red: boolean,
    ): void {
        if (this.bg) {
            const frame = kind === 'free' ? this.freeFrame : (red ? this.redFrame : this.yellowFrame);
            if (frame) this.bg.spriteFrame = frame;
        }
        if (this.title) {
            this.title.string = text;
            const pos = this.title.node.position;
            this.title.node.setPosition(iconFrame ? this.titleXWithIcon : this.titleXNoIcon, pos.y, pos.z);
        }
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = !!iconFrame;
            if (iconFrame) {
                const pos = this.icon.node.position;
                this.icon.node.setPosition(this.iconX, pos.y, pos.z);
            }
        }
        // 对勾：已开通 = 显示（对应 FGUI `解锁` page「是」）
        if (this.checkMark) this.checkMark.active = unlocked;
    }
}
