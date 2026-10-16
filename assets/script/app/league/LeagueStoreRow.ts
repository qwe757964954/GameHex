/**
 * 「联盟商店」列表里的一行 —— **556×142**
 * （`ui/League/LeagueStore.prefab` 的 `StoreListView/content/StoreRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_商店Item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n0` 行底框 `frame_Zhikuang01`（155×113 九宫格 `38,28,76,56`，显示 **556×142**） | 本节点自己的 `cc.Sprite` | 九宫格 |
 * | `n1` 标题衬底 `BB_img03`（488×32、`alpha=0.5`） | `TitleBar` | 静态 |
 * | `labName`（26px `#e7d9be` 居中 + 描边`#291b12`/2 + bold） | `Name` | 商品名 |
 * | `com_goods`（FGUI 物品框，显示 62×62 × scale 1.2 = 74.4） | `Reward`（`LeagueRewardSlot`） | 奖励图标 + 数量 |
 * | `labCount`（18px `#2a2333` **右对齐**） | `Count` | 限购进度 |
 * | `btnBuy`（`按钮_商店_购买`，显示 **121×42**，底图 `TY_btn20`） | `BuyBtn` | 单价 + 货币图标 |
 * | `btnBuy.priceIcon`（40×40） | `BuyBtn/PriceIcon` | 货币图标 |
 * | `btnBuy.title`（18px，实例覆盖 `titleColor=#efe3bf`） | `BuyBtn/Label` | 单价数字 |
 * | `btnBuy.com_rd` | `BuyBtn/RedDot` | ⚠️ **恒隐藏**（见下） |
 *
 * ## 三处**必须与 FGUI 一致**的细节
 *
 * 1. **`labCount` 是「剩余/上限」**，不是「已购/上限」—— 老端
 *    `item.tm("labCount").setText(\`${ref.limitDesc}:${ref.limit - buyTimes}/${ref.limit}\`)`。
 *    视图模型的 `limitText` 已经拼好（见 `LeagueTable.buildLeagueStoreRowViews`）。
 * 2. **按钮的 `grayed` 反义**：老端 `btn_buy.grayed = !canbuy` ⇒ 本端 `interactable = canBuy`
 *    **并且**按「置灰」口径把 Sprite 染暗（FGUI `grayed` 是灰度滤镜，Cocos 只能自己染色）。
 * 3. **红色 dot 恒隐藏**：FGUI 的 `btnBuy.com_rd` 存在（`(130,0)` 30×30，
 *    注意它**超出**了 121 宽的按钮框 —— FGUI 里 `com_rd` 没有 relation，缩放实例不会挪它），
 *    但老端 `LayerLeagueStore.initList()` 里那两行是**注释掉的**：
 *    ```ts
 *    // let rd = canbuy ? 1 : 0;
 *    // (btn_buy.tm("com_rd") as GObjRD).OnRDUpdate(rd);
 *    ```
 *    ⇒ 本端照抄「不点亮」，节点建出来但保持隐藏（免得将来要接时又得重建 prefab）。
 *    ⚠️ 商店的**入口红点**同理（`TabLeagueMain.updateRD` 里 `btn_shop.com_rd` 也被注释）——
 *    见 `LeaguePage` 的 `shopRedDot`。
 *
 * ## 为什么按钮的点击由**行脚本自己**接
 *
 * 整行会被虚拟列表 clone 复用（`VScrollView` 的槽位池），宿主要在 `renderItemFn` 里
 * **每帧现取**数据、**不能**按 index 捕获回调。行脚本在 `onLoad` 里绑一次自己的按钮，
 * 点击时读 `this.current` —— 槽位复用到哪一行就读哪一行，天然不会串
 * （与 `LeagueApplyRow` / `LeagueOpsBar` 同一套口径）。
 */

import { _decorator, Button, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { LEAGUE_TINT_GRAY, LEAGUE_TINT_NORMAL } from './LeagueArt';
import type { ILeagueStoreRowView } from './LeagueTable';
import { LeagueRewardSlot } from './LeagueRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 置灰时 `cc.Sprite.color` 的灰度（FGUI `grayed` 滤镜的近似：压暗 + 去饱和）。
 *
 * ⚠️ 必须建成 `cc.Color`：`sprite.color` 的 setter 走 `Color.set()`，塞普通对象
 *    `{r,g,b,a}` 在**运行期**能跑通、但 TS 里是错的（`Color` 还带方法）⇒ 编译器直接报
 *    `Type '{readonly r: …}' is not assignable to type 'Readonly<Color>'`。
 *    模块级 `const` 只建一次，别放进 `render()`（每帧渲染都要用，别在热路径 new 对象）。
 */
const GRAY_TINT = new Color(...LEAGUE_TINT_GRAY);
/** 正常态（不染色）。 */
const NORMAL_TINT = new Color(...LEAGUE_TINT_NORMAL);

@ccclass('LeagueStoreRow')
export class LeagueStoreRow extends Component {
    @property({ type: Label, tooltip: 'labName：商品名（26px 居中）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'labCount：限购进度「剩余/上限」（18px 右对齐）' })
    countLabel: Label = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'com_goods：奖励格（图标 + 数量）' })
    rewardSlot: LeagueRewardSlot = null!;

    @property({ type: Node, tooltip: 'btnBuy：购买按钮' })
    buyButton: Node = null!;

    @property({ type: Label, tooltip: 'btnBuy/title：单价数字（18px）' })
    costLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'btnBuy/priceIcon：货币图标（按 priceType 换帧）' })
    priceIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'btnBuy/com_rd：红点（⚠️ 恒隐藏 —— 老端那两行是注释掉的）' })
    redDot: Node = null!;

    /** 点「购买」的回调（`view` 是**点击那一刻**这一槽位上的行数据）。 */
    onBuy: ((view: ILeagueStoreRowView) => void) | null = null;

    /** 当前铺在这一行上的商品（`null` = 空槽）。 */
    private current: ILeagueStoreRowView | null = null;
    private bound = false;
    /** 本行按钮的底图 Sprite（`grayed` 要染它，不是染整个节点）。 */
    private buttonSprite: Sprite | null = null;

    protected onLoad(): void {
        this.buttonSprite = this.buyButton ? this.buyButton.getComponent(Sprite) : null;
        this.bind();
    }

    protected onDestroy(): void {
        // ⚠️ 判 `isValid` 后再摘：宿主销毁时子节点可能已先被拆
        if (this.buyButton && this.buyButton.isValid) {
            const button = this.buyButton.getComponent(Button);
            if (button) button.node.off(Button.EventType.CLICK, this.onBuyClick, this);
        }
    }

    /** 当前行的商品 id（没铺数据时 = 0）。 */
    get goodsId(): number {
        return this.current?.id ?? 0;
    }

    /**
     * 铺一行（所有状态**绝对赋值**）。
     *
     * @param view         行视图（`null` ⇒ 藏掉整行）
     * @param qualityFrame 奖励格品质框（`null` ⇒ 保留静态框）
     * @param iconFrame    奖励格图标（`null` ⇒ 隐藏图标）
     * @param priceFrame   货币图标（`null` ⇒ 保留静态图）
     */
    render(
        view: ILeagueStoreRowView | null,
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        priceFrame: SpriteFrame | null,
    ): void {
        this.current = view;

        if (!view) {
            this.hide();
            return;
        }

        if (this.nameLabel) this.nameLabel.string = view.desc;
        if (this.countLabel) this.countLabel.string = view.limitText;

        if (this.rewardSlot) {
            this.rewardSlot.node.active = true;
            this.rewardSlot.render(qualityFrame, iconFrame, view.rewardNumber, true);
        }

        if (this.costLabel) this.costLabel.string = String(view.cost);
        if (this.priceIcon && priceFrame) this.priceIcon.spriteFrame = priceFrame;

        // ⚠️ **不把 `interactable` 关掉**（虽然老端的按钮是「灰」的）：
        //    FGUI 的 `grayed` 只影响渲染，**点得动** —— 所以老端在 click 里自己分了三支：
        //    「卖完 ⇒ 提示已售罄 / 钱不够 ⇒ 提示不足 / 都 OK ⇒ 发包」（见类头）。
        //    本端若在这里 `interactable = false`，那两条提示就永远出不来（表现成「点了没反应」，
        //    比老端少了反馈）。⇒ 只染灰，点击交给宿主 `onBuy` 分三支。
        if (this.buttonSprite) this.buttonSprite.color = view.canBuy ? NORMAL_TINT : GRAY_TINT;

        // 红点恒关（老端那两行是注释掉的，见类头）
        if (this.redDot) this.redDot.active = false;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }

    /** 按钮只绑一次（克隆体各绑自己的，`bound` 保证只绑一次）。 */
    private bind(): void {
        if (this.bound) return;
        this.bound = true;
        if (!this.buyButton) {
            console.warn('[LeagueStoreRow] BuyBtn 缺失，购买点击不会生效');
            return;
        }
        const button = this.buyButton.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onBuyClick, this);
        else this.buyButton.on(Node.EventType.TOUCH_END, this.onBuyClick, this);
    }

    /** 只有一个出口：空槽（`current === null`）时点一次不发。 */
    private onBuyClick(): void {
        const view = this.current;
        if (!view) return;
        if (this.onBuy) this.onBuy(view);
    }
}
