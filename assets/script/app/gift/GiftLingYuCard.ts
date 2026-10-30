import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 灵玉直冲页的**一张档位卡**（230×330）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/组件_礼包_灵玉礼包item.xml`：
 *   - 底卡 + 标题条 + 方框（三张图叠出来）
 *   - 中间是道具图（`com_goods`）
 *   - 底部购买按钮（`按钮_灵玉.xml`，157×48）
 *   - 右上「首充翻倍」角标（`首次购买` 控制器控制显隐）
 *
 * ⚠️ **灵玉页不发业务请求**：老端点按钮走 `SDKMgr.pay(ref.id, "common", 0)`，
 * Demo3.8 没有支付 SDK，所以这里只回调给页面提示（范式同首充 / 月卡礼包：
 * 真实支付那一步留注释、不实现）。
 */
@ccclass('GiftLingYuCard')
export class GiftLingYuCard extends Component {
    @property({ type: Label, tooltip: 'Title：档位名（如「少量元宝」）' })
    titleLabel: Label = null;

    @property({ type: Label, tooltip: 'Coin：到账数量' })
    coinLabel: Label = null;

    @property({ type: Label, tooltip: 'Price：按钮上的价格文案' })
    priceLabel: Label = null;

    @property({ type: Sprite, tooltip: 'Icon：货币图标（统一用 gf_icon_stone）' })
    icon: Sprite = null;

    @property({ type: Node, tooltip: 'DoubleTag：首充翻倍角标（firstBuy 时才显示）' })
    doubleTag: Node = null;

    @property({ type: Sprite, tooltip: 'BtnBg：购买按钮底图' })
    btnBg: Sprite = null;

    @property({ type: Button, tooltip: 'Button：购买按钮' })
    button: Button = null;

    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        // 按钮是 prefab 里**已绑好**的引用（规则：已绑 @property 不判空），直接监听。
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /** 铺一张卡。`title` / `coin` / `price` 为空时保留上一帧（避免串档）。 */
    render(
        title: string,
        coin: string,
        price: string,
        firstBuy: boolean,
        iconFrame: SpriteFrame | null,
        btnFrame: SpriteFrame | null,
    ): void {
        if (title) this.titleLabel.string = title;
        if (coin) this.coinLabel.string = coin;
        if (price) this.priceLabel.string = price;
        this.doubleTag.active = firstBuy;
        if (iconFrame) this.icon.spriteFrame = iconFrame;
        if (btnFrame) this.btnBg.spriteFrame = btnFrame;
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}
