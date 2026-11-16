import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 灵玉直冲页的一张档位卡。
 *
 * 本页尚未接入支付：点击只回调宿主，不发送请求。
 */
@ccclass('GiftLingYuCard')
export class GiftLingYuCard extends Component {
    @property({ type: Label, tooltip: 'Title：档位名（如「少量元宝」）' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: 'Coin：到账数量' })
    coinLabel: Label = null!;

    @property({ type: Label, tooltip: 'Price：按钮上的价格文案' })
    priceLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'Icon：货币图标（统一用 gf_icon_stone）' })
    icon: Sprite = null!;

    @property({ type: Node, tooltip: 'DoubleTag：首充翻倍角标（firstBuy 时才显示）' })
    doubleTag: Node = null!;

    @property({ type: Sprite, tooltip: 'BtnBg：购买按钮底图' })
    btnBg: Sprite = null!;

    @property({ type: Button, tooltip: 'Button：购买按钮' })
    button: Button = null!;

    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
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
