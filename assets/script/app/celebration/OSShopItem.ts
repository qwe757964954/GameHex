import { _decorator, Button, Color, Component, Label, Node, Sprite } from 'cc';
import { osShopVisibility } from './CelebrationViewState';
import { osTint } from './CelebrationArt';
import { OSRewardSlot } from './OSRewardSlot';
import { buyCountOf, purchaseStateOf, shopLimitTextOf, shopPricingOf, shopSaleTextOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationShopRow, ICelebrationSnapshot } from './CelebrationRepository';

const { ccclass, property } = _decorator;

// 显隐口径放在零 cc 的 CelebrationViewState（带 cc 的文件的纯函数进不了 Node 用例）。
// 这里 re-export，外部 import 路径不变。
export { osShopVisibility } from './CelebrationViewState';
export type { IOsShopVisibility } from './CelebrationViewState';

/**
 * 限时特惠的一张商品卡（prefab `ui/Celebration/OSRankShopItem`，206×303）。
 *
 * 老端 `renderShopListItem`：`rmb ? buyType=rmb : buyType=cost`，
 * 购买状态 `buyCount >= limit`。两个控制器驱动这些挂点：
 * `lab_price` 仅可购买时显示；`lab_old_price`、删除线 `n34`、原价 ￥ `n32` 常显；
 * `n44` 是 rmb 分支现价 ￥，cost 分支的 `icon_cost` 是可购买时的货币图标；
 * `n41` 在不可购买时显示「已售罄」；`btn_buy` 只置灰，不隐藏、不 disable。
 *
 * `n39`（`RmbSign1`）恒隐藏：与 `n32` 像素级重叠（同为 `(62,175) 26×31`，只差颜色），
 * 显示会把 ￥ 画两遍。按 `lab_old_price (90,176)` 看，y≈175 的 ￥ 配原价，
 * 配现价的是 `n44 (60,216)`，所以 `n39` 是美术复制残留。要恢复双层 ￥ 改那行 `active` 即可。
 *
 * 售罄时按钮仍可点：老端只置灰、没有 `interactable = false`，点了照样发请求由服务端拒。
 * 不要在客户端补禁用，否则两端对「能不能买」的口径会不一致。
 */
@ccclass('OSShopItem')
export class OSShopItem extends Component {
    @property({ type: OSRewardSlot, tooltip: 'Goods：奖励格（吃 rewards[0]，FGUI com_goods）' })
    goods: OSRewardSlot = null!;

    @property({ type: Label, tooltip: 'NameText：商品名（FGUI lab_name）' })
    nameText: Label = null!;

    @property({ type: Label, tooltip: 'OldPriceText：原价（FGUI lab_old_price，常显）' })
    oldPriceText: Label = null!;

    @property({ type: Label, tooltip: 'PriceText：现价（FGUI lab_price，只在可购买时显示）' })
    priceText: Label = null!;

    @property({ type: Node, tooltip: 'RmbSign2：原价的 ￥（FGUI n32，常显）' })
    rmbSignOld: Node = null!;

    @property({ type: Node, tooltip: 'RmbSign3：rmb 分支现价的 ￥（FGUI n44）' })
    rmbSignNow: Node = null!;

    @property({ type: Node, tooltip: 'RmbSign1：FGUI n39，与 RmbSign2 重叠的残留件，恒隐藏（见文件头）' })
    rmbSignRedundant: Node = null!;

    @property({ type: Sprite, tooltip: 'CostIcon2：cost 分支的货币图标（FGUI icon_cost，需宿主预加载）' })
    costIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'SoldOutText：已售罄（FGUI n41）' })
    soldOutText: Node = null!;

    @property({ type: Label, tooltip: 'LimitText：限购 限购{n}/{m}（FGUI lab_limit_buy）' })
    limitText: Label = null!;

    @property({ type: Label, tooltip: 'SaleText：折扣 5折（FGUI lab_sale）' })
    saleText: Label = null!;

    @property({ type: Node, tooltip: 'BuyBtn：购买按钮（FGUI btn_buy，售罄时置灰但仍可点）' })
    buyBtn: Node = null!;

    @property({ type: Node, tooltip: 'BuyBtn/Plate：按钮底图（置灰对象）' })
    buyPlate: Node = null!;

    @property({ type: Label, tooltip: 'BuyBtn/Title：按钮文案（置灰对象）' })
    buyTitle: Label = null!;

    /** 购买回调，由宿主在每次铺行时重设（理由同 `OSTargetItem.onClaim`）。 */
    onBuy: () => void = null!;

    protected onLoad(): void {
        this.buyBtn.on(Button.EventType.CLICK, this._emitBuy, this);
    }

    private _emitBuy(): void {
        this.onBuy();
    }

    render(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow, frames: CelebrationFrames): void {
        const first = row.rewards.length > 0 ? row.rewards[0] : null;
        if (!first) {
            this.goods.hide();
        } else {
            this.goods.render(
                frames.iconOf(snapshot, first.resId),
                frames.qualityOf(snapshot, first.resId),
                first.number,
            );
        }

        this.nameText.string = row.name;
        this.saleText.string = shopSaleTextOf(row);
        this.limitText.string = shopLimitTextOf(snapshot, row);

        // 分支由 rmb > 0 决定，价格必须过 payChannel 换算。
        const pricing = shopPricingOf(snapshot, row);
        this.oldPriceText.string = pricing.oldPriceText;
        this.priceText.string = pricing.priceText;

        const purchaseState = purchaseStateOf(buyCountOf(snapshot.server, row.subId), row.limit);
        const vis = osShopVisibility(pricing.branch, purchaseState);
        this.priceText.node.active = vis.priceVisible;
        this.rmbSignNow.active = vis.rmbSignVisible;
        this.soldOutText.active = vis.soldOutVisible;
        // 原价那两件常显：老端两个分支都会写 lab_old_price。
        this.oldPriceText.node.active = true;
        this.rmbSignOld.active = true;
        this.rmbSignRedundant.active = false;

        // cost 分支的货币图标：宿主已预加载，没加载到就隐藏，不留上一张。
        const frame = vis.costIconVisible ? frames.iconOf(snapshot, pricing.costIconResId) : null;
        this.costIcon.spriteFrame = frame;
        this.costIcon.node.active = !!frame;

        // 售罄时置灰但不禁用，见文件头。
        const tint = new Color(...osTint(vis.buyGrayed), 255);
        const plate = this.buyPlate.getComponent(Sprite);
        plate.color = tint;
        this.buyTitle.color = tint;
    }
}
