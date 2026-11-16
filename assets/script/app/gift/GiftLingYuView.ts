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
 * 「灵玉直冲」页：固定 6 张档位卡。
 *
 * 该页在 prefab 中保留，但当前未接入大页签，因此没有生产调用方。
 * 6 个卡节点直接预摆，不使用虚拟列表：虚拟列表不支持三列自动换行。
 */
@ccclass('GiftLingYuView')
export class GiftLingYuView extends Component {
    @property({ type: Node, tooltip: 'CardBar：档位卡容器（预摆 6 个 GiftLingYuCard）' })
    cardBar: Node = null!;

    @property({ type: Label, tooltip: 'Banner：顶部条文案' })
    bannerLabel: Label = null!;

    /** 点了某张卡的购买按钮（回传 `payChannel.id`）。本页不发业务请求。 */
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

    /** 档位卡按行优先排序，与 prefab 中 `flow_hz` 的铺法一致。 */
    private get cards(): GiftLingYuCard[] {
        return this.cardBar.getComponentsInChildren(GiftLingYuCard)
            .sort((a, b) => (b.node.position.y - a.node.position.y)
                || (a.node.position.x - b.node.position.x));
    }
}
