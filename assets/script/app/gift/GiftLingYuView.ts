import { _decorator, Component, Label, Node, SpriteFrame } from 'cc';
import { GiftLingYuCard } from './GiftLingYuCard';

const { ccclass, property } = _decorator;

/** 一张灵玉档位卡的视图模型（由宿主组装）。 */
export interface IGiftLingYuCardView {
    /** `payChannel.id` —— 点按钮时回传给宿主的身份。 */
    readonly id: number;
    /** 档位名（`payChannel.name`，如「少量元宝」）。 */
    readonly title: string;
    /** 到账数量（`payChannel.coin`）。 */
    readonly coin: string;
    /** 价格文案（`¥6`）。 */
    readonly price: string;
    /** 首充双倍还没用掉（`CmdRole.tlExtraId` 里没有本档位）。 */
    readonly firstBuy: boolean;
    readonly iconFrame: SpriteFrame | null;
    readonly buttonFrame: SpriteFrame | null;
}

/** 一次刷新要的全部展示数据。 */
export interface IGiftLingYuPresentData {
    readonly cards: readonly IGiftLingYuCardView[];
    /** 顶部条文案（如「灵玉直冲」）。 */
    readonly bannerText: string;
}

/**
 * 「灵玉直冲」页 —— 6 张档位卡的静态网格。
 *
 * 版面照 FGUI `礼包/组件/子页面/组件_礼包_灵玉礼包.xml`（`item` = `组件_礼包_灵玉礼包item.xml`，230×330）：
 *   三列 × 两行（`layout="flow_hz" lineItemCount="3" colGap="-7" lineGap="10"`），
 *   卡中心在页面上是 `(138/361/584, 505/845)`（FGUI `list xy=(23,340)`，列步长 223、行步长 340）。
 *
 * ⚠️ **有意不用虚拟列表**：全表 `isShow === 1` 只有 6 档（2 行 × 3 列，正好铺满不用滚），
 *   而 `VirtualScrollView` 只支持**主轴单列/单行**（`gridCount` 是同方向的列数，不是网格），
 *   表达不了「3 列自动换行」。硬套会得到「一行一张卡」的错误排版。
 *   所以这里预摆 6 个卡节点 + 按需 `active` —— 6 个静态节点比虚拟化更省也更好读。
 *   真要开更多档位（表里以后加 `isShow`）时，先扩到 6 以上再回来换实现。
 */
@ccclass('GiftLingYuView')
export class GiftLingYuView extends Component {
    @property({ type: Node, tooltip: 'CardBar：档位卡容器（预摆 6 个 GiftLingYuCard）' })
    cardBar: Node = null;

    @property({ type: Label, tooltip: 'Banner：顶部条文案（FGUI 复用了超值礼包页签那张条）' })
    bannerLabel: Label = null;

    /**
     * 点了某张卡的购买按钮（回传 `payChannel.id`）。
     *
     * ⚠️ **本页不发业务请求**：老端走 `SDKMgr.pay(ref.id, "common", 0)`（真实支付），
     *  Demo3.8 没有支付 SDK ⇒ 宿主只弹提示（范式同首充 / 月卡礼包：真实支付那一步留注释）。
     */
    onPay: ((id: number) => void) | null = null;

    private cardViews: IGiftLingYuCardView[] = [];

    protected onLoad(): void {
        const cards = this.cards;
        for (let index = 0; index < cards.length; index++) {
            cards[index].bind(index, (clicked) => this.emitPay(clicked));
        }
    }

    /** 铺一次页面。数据不足时多出来的卡整块隐藏（不是留着空壳）。 */
    present(data: IGiftLingYuPresentData): void {
        this.cardViews = Array.from(data.cards);
        this.bannerLabel.string = data.bannerText;

        const cards = this.cards;
        for (let index = 0; index < cards.length; index++) {
            const view = this.cardViews[index];
            if (!view) {
                cards[index].node.active = false;
                continue;
            }
            cards[index].node.active = true;
            cards[index].render(
                view.title,
                view.coin,
                view.price,
                view.firstBuy,
                view.iconFrame,
                view.buttonFrame,
            );
        }
    }

    private emitPay(index: number): void {
        const view = this.cardViews[index];
        if (!view) return;
        this.onPay?.(view.id);
    }

    /** 档位卡（按**行优先**从左到右、从上到下 —— 与 FGUI `flow_hz` 的铺法一致）。 */
    private get cards(): GiftLingYuCard[] {
        return this.cardBar.getComponentsInChildren(GiftLingYuCard)
            .slice()
            .sort((a, b) => (b.node.position.y - a.node.position.y) || (a.node.position.x - b.node.position.x));
    }
}
