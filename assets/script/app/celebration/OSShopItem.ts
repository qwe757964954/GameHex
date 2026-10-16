import { _decorator, Color, Component, Label, Node, Sprite } from 'cc';
import { osShopVisibility } from './CelebrationViewState';
import { osTint } from './CelebrationArt';
import { OSRewardSlot } from './OSRewardSlot';
import { purchaseStateOf, shopPricingOf, saleTextOf_, limitBuyTextOf_, buyCountOf } from './CelebrationRepository';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationShopRow, ICelebrationSnapshot } from './CelebrationRepository';
import { CL_TEXTS } from './CelebrationTexts';

const { ccclass, property } = _decorator;

/**
 * 限时特惠的**一张商品卡**（prefab `ui/Celebration/OSRankShopItem`，206×303）。
 *
 * ## 两个控制器：`buyType`（`0,rmb / 1,cost`）+ `购买状态`（`0,可购买 / 1,不可购买`）
 *
 * 老端 `renderShopListItem` 里 `if (data.rmb) buyType=rmb else buyType=cost`，
 * 然后 `购买状态 = buyCount >= limit ? 1 : 0`。两个控制器的 gear 落点（逐条对过原稿）：
 *
 * | FGUI 名 | 迁过来 | gear | 语义 |
 * |---|---|---|---|
 * | `lab_price` | `PriceText` | `gearDisplay 购买状态 pages="0"` | **可购买**时才显示现价 |
 * | `lab_old_price` | `OldPriceText` | 无 | **常显**（两个分支老端都写它） |
 * | `n32` | `RmbSign2` | 无 | 原价的 ￥，**常显** |
 * | `n44` | `RmbSign3` | `gearDisplay buyType pages="0"`（rmb）+ `购买状态 pages="0"` | rmb 分支的现价 ￥ |
 * | `icon_cost` | `CostIcon2` | `gearDisplay buyType pages="1"`（cost）+ `购买状态 pages="0"` | cost 分支的货币图标 |
 * | `n41` | `SoldOutText` | `gearDisplay 购买状态 pages="1"` | 售罄 / 达到限购时的「已售罄」 |
 * | `n34` | `StrikeLine` | 无 | 原价删除线，**常显** |
 * | `btn_buy` | `BuyBtn` | `gearLook 购买状态 pages="1"` | 不可购买时按钮**置灰**（**不隐藏、不禁用**） |
 *
 * ### 🔴 `n39`（`RmbSign1`）**恒隐藏** —— 这是有意决定
 *
 * 原稿里 `n39 ￥` 的 gear 是 `gearDisplay buyType pages="0"` + `购买状态 pages="0"`，
 * 位置 `(62,175) size 26×31`；而 `n32 ￥` 位置 `(63,175) size 26×31`、**无 gear**。
 * 两者**像素级重叠**，唯一区别是颜色（`n39 #eae2b6` vs `n32 #f1f2e1`）。
 *
 * 也就是说原稿里 rmb 分支会把 ￥ **画两遍**（叠在同一坐标）。看一眼 `lab_old_price` 的位置
 * `(90,176)` 就能确定：y≈175 那个 ￥ 是配**原价**的，配现价 `lab_price (90,217)` 的是 `n44 (60,216)`。
 * ⇒ `n39` 是美术复制 `n32` 改色后忘了删的残留件。
 *
 * **处置：`RmbSign1` 恒 `active = false`**（与「照抄老端」的原则在这里的例外，理由如上）。
 * 要恢复"双层 ￥"的话把下面那行改掉即可 —— 但先确认那是真的想要。
 *
 * ### ⚠️ 售罄时按钮仍然可点（照老端）
 *
 * 老端只 `gearLook` 置灰，**没有** `interactable = false`，也没早退 —— 点了照样发
 * `CmdCelebrationBuyShopGoodsReqMsg`，由服务端拒。这里照抄（置灰 + 可点），
 * 不去"顺手加个禁用"：那会让客户端和服务端对"能不能买"的口径不一致。
 */

// 显隐口径已抽到零 `cc` 的 `CelebrationViewState`（规则 78：带 `cc` 的文件里的纯函数，
// Node 用例 import 不进来 ⇒ 会永久脱离回归网）。这里 re-export ⇒ 外部 import 路径不变。
export { osShopVisibility } from './CelebrationViewState';
export type { IOsShopVisibility } from './CelebrationViewState';

@ccclass('OSShopItem')
export class OSShopItem extends Component {
    @property({ type: OSRewardSlot, tooltip: 'Goods：奖励格（吃 `rewards[0]`，FGUI `com_goods`）' })
    goods: OSRewardSlot = null!;

    @property({ type: Label, tooltip: 'NameText：商品名（FGUI `lab_name`）' })
    nameText: Label = null!;

    @property({ type: Label, tooltip: 'OldPriceText：原价（FGUI `lab_old_price`，**常显**）' })
    oldPriceText: Label = null!;

    @property({ type: Label, tooltip: 'PriceText：现价（FGUI `lab_price`，**只在可购买时显示**）' })
    priceText: Label = null!;

    @property({ type: Node, tooltip: 'RmbSign2：原价的 ￥（FGUI `n32`，常显）' })
    rmbSignOld: Node = null!;

    @property({ type: Node, tooltip: 'RmbSign3：rmb 分支现价的 ￥（FGUI `n44`）' })
    rmbSignNow: Node = null!;

    @property({ type: Node, tooltip: 'RmbSign1：FGUI `n39`，与 `RmbSign2` 像素级重叠的残留件 ⇒ 恒隐藏（见文件头）' })
    rmbSignRedundant: Node = null!;

    @property({ type: Sprite, tooltip: 'CostIcon2：cost 分支的货币图标（FGUI `icon_cost`，需宿主预加载）' })
    costIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'SoldOutText：已售罄（FGUI `n41`）' })
    soldOutText: Node = null!;

    @property({ type: Label, tooltip: 'LimitText：限购 `限购{n}/{m}`（FGUI `lab_limit_buy`）' })
    limitText: Label = null!;

    @property({ type: Label, tooltip: 'SaleText：折扣 `5折`（FGUI `lab_sale`）' })
    saleText: Label = null!;

    @property({ type: Node, tooltip: 'BuyBtn：购买按钮（FGUI `btn_buy`，售罄时置灰但**仍可点**）' })
    buyBtn: Node = null!;

    @property({ type: Node, tooltip: 'BuyBtn/Plate：按钮底图（置灰对象）' })
    buyPlate: Node = null!;

    @property({ type: Label, tooltip: 'BuyBtn/Title：按钮文案（置灰对象）' })
    buyTitle: Label = null!;

    /** 购买回调 —— **由宿主在每次铺行时重设**（理由同 `OSTargetItem.onClaim`）。 */
    onBuy: (() => void) | null = null;

    protected onLoad(): void {
        this.buyBtn?.on('click', this._emitBuy, this);
    }

    private _emitBuy(): void {
        this.onBuy?.();
    }

    render(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow, frames: CelebrationFrames): void {
        // ---- 奖励格（`rewards[0]`）----
        if (this.goods) {
            const first = row.rewards.length > 0 ? row.rewards[0] : null;
            if (!first) this.goods.hide();
            else this.goods.render(frames.iconOf(snapshot, first.resId), frames.qualityOf(snapshot, first.resId), first.number);
        }

        // ---- 名字 / 折扣 / 限购 ----
        if (this.nameText) this.nameText.string = row.name;
        if (this.saleText) this.saleText.string = saleTextOf_(row);
        if (this.limitText) this.limitText.string = limitBuyTextOf_(snapshot, row);

        // ---- 价格（分支由 `rmb > 0` 决定，价格必须过 `payChannel` 换算）----
        const pricing = shopPricingOf(snapshot, row);
        if (this.oldPriceText) this.oldPriceText.string = pricing.oldPriceText;
        if (this.priceText) this.priceText.string = pricing.priceText;

        // ---- 显隐（无条件写，规则 82）----
        const purchaseState = purchaseStateOf(buyCountOf(snapshot.server, row.subId), row.limit);
        const vis = osShopVisibility(pricing.branch, purchaseState);
        if (this.priceText) this.priceText.node.active = vis.priceVisible;
        if (this.rmbSignNow) this.rmbSignNow.active = vis.rmbSignVisible;
        if (this.costIcon) this.costIcon.node.active = vis.costIconVisible;
        if (this.soldOutText) this.soldOutText.active = vis.soldOutVisible;
        // 原价那两件**常显**（老端两个分支都写 `lab_old_price`）
        if (this.oldPriceText) this.oldPriceText.node.active = true;
        if (this.rmbSignOld) this.rmbSignOld.active = true;
        if (this.rmbSignRedundant) this.rmbSignRedundant.active = false;

        // ---- cost 分支的货币图标（宿主已预加载；没加载到就隐藏，不留上一张）----
        if (this.costIcon) {
            const frame = vis.costIconVisible ? frames.iconOf(snapshot, pricing.costIconResId) : null;
            this.costIcon.spriteFrame = frame;
            this.costIcon.node.active = vis.costIconVisible && !!frame;
        }

        // ---- 售罄时按钮置灰（**不禁用**，见文件头）----
        const tint = new Color(...osTint(vis.buyGrayed), 255);
        for (const sprite of this._buySprites()) sprite.color = tint;
        if (this.buyTitle) this.buyTitle.color = tint;
    }

    /** 按钮上会被置灰的 `cc.Sprite`（底图 + 币图标）。 */
    private _buySprites(): Sprite[] {
        const out: Sprite[] = [];
        if (this.buyPlate) {
            const own = this.buyPlate.getComponent(Sprite);
            if (own) out.push(own);
        }
        return out;
    }

    /** 「买不了」时的提示口径（宿主用）。 */
    static soldOutTip(): string {
        return CL_TEXTS.soldOutTip;
    }
}
