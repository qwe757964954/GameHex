/**
 * 「每日砍价」参与列表里的一行 —— **390×34**
 * （`ui/League/LeagueDiscount.prefab` 的 `DiscountListView/content/DiscountRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/商店/组件_联盟_砍价Item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `lab_who`（24px `#3a240d` 左对齐、`vAlign=middle`） | `Who` | 砍价的成员名 |
 * | `n43`（24px `#3a240d`、`vAlign=middle`，静态 `text="砍价"`） | `Action` | ⚠️ **静态文本**，老端从没赋值过 |
 * | `icon`（34×34、`fill=scaleFree`） | `Icon` | 货币图标（金币 `图标_幻灵玉`） |
 * | `lab_price`（24px `#3a240d`、`vAlign=middle`） | `Price` | 这个人砍掉的额度 |
 *
 * ⚠️ **`n43` 与按钮上的「砍价」同字不同源**：老端 `render()` 只覆盖 `lab_who` / `lab_price`，
 *    `n43` 从头到尾没被赋过值 ⇒ 它是设计稿的静态文本。本行也照抄（`LEAGUE_DISCOUNT_ROW_ACTION`
 *    与 `LEAGUE_DISCOUNT_BTN_SALE` 两个常量**故意不合并**，各自跟随自己的来源）。
 *
 * ⚠️ **查不到成员的整条会被宿主丢掉**（老端 `if (member) listCmds.push(item)`），
 *    所以行组件永远不会拿到一个「名字为空」的条目去渲染
 *    —— 过滤在 `LeaderTable.buildLeagueDiscountRows`，行只负责上屏。
 *
 * ## 没有按钮
 *
 * 这一行**不可点**（老端 `render` 里没挂任何 click）⇒ 本组件只有 `render()`，没有绑定。
 * 但仍要**绝对赋值**四个字段：虚拟列表复用槽位，漏赋值会保留上一行的名字 / 数字。
 */

import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ILeagueDiscountRowView } from './LeagueTable';
import { LEAGUE_DISCOUNT_ROW_ACTION } from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueDiscountRow')
export class LeagueDiscountRow extends Component {
    @property({ type: Label, tooltip: 'lab_who：砍价的成员名（24px）' })
    whoLabel: Label = null;

    @property({ type: Label, tooltip: 'n43：「砍价」二字（⚠️ 静态文本，老端从没赋值）' })
    actionLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_price：该成员砍掉的额度（24px）' })
    priceLabel: Label = null;

    @property({ type: Sprite, tooltip: 'icon：货币图标（金币 `图标_幻灵玉`）' })
    icon: Sprite = null;

    /** 当前铺在这一行上的数据（`null` = 空槽）。 */
    private current: ILeagueDiscountRowView | null = null;

    /** 当前行数据（供宿主在回调外用）。 */
    get view(): ILeagueDiscountRowView | null {
        return this.current;
    }

    /**
     * 铺一行（四个字段**绝对赋值**）。
     *
     * @param view     行数据（`null` ⇒ 藏掉整行）
     * @param iconFrame 货币图标帧（`null` ⇒ 保留静态图）
     */
    render(view: ILeagueDiscountRowView | null, iconFrame: SpriteFrame | null): void {
        this.current = view;

        if (!view) {
            this.hide();
            return;
        }

        if (this.whoLabel) this.whoLabel.string = view.name;
        if (this.priceLabel) this.priceLabel.string = String(view.value);
        // ⚠️ `n43` 是静态文本 ⇒ 每次复用都写回常量，防止别处改过它之后串到下一行
        if (this.actionLabel) this.actionLabel.string = LEAGUE_DISCOUNT_ROW_ACTION;
        if (this.icon && iconFrame) this.icon.spriteFrame = iconFrame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }
}
