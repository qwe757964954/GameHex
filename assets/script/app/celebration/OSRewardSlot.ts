import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { OS_SPRITE_SIMPLE, osSpriteType } from './CelebrationArt';

const { ccclass, property } = _decorator;

/**
 * 庆典里的**一个奖励格**（prefab `ui/Celebration/OSRankRewardItem`，84×85）。
 *
 * ## 结构从哪来（⚠️ FGUI 原稿里这块是「设计期残件」）
 *
 * 老端 `组件_开服冲榜_奖励项.xml` 里**只有一个 `com_goods`**，而它指向的
 * `共用组件/组件/物品框/物品框.xml` 全文正文是：
 *
 * ```xml
 * <component size="120,120">
 *   <displayList>
 *     <loader name="ui看效果用的" xy="0,0" size="120,120" fill="scale"/>
 *   </displayList>
 * </component>
 * ```
 *
 * —— 一个裸 loader，**没有底板、没有品质框、没有数量文字**。真正的格子由**老端代码画**：
 *
 * | 老端 | 干了什么 |
 * |---|---|
 * | `ItemBehavior2.onUpdateByGoods` | `onFrameUpdate(goods.GetQuality())` + `SetUrlByIcon(GetIconKey())` + `onNumberUpdate(GetNumberStr())` |
 * | `Goods.GetNumberStr()` | `number === 0 ? '' : String(number)` —— **纯整数、不缩写、0 显示空串** |
 *
 * 所以迁过来的 prefab **必须比 FGUI 原稿多两样**（走编辑器 MCP 加，别手改 JSON）：
 *   · `Goods/Frame`（cc.Sprite，品质框，**排在 `Icon` 之前** ⇒ 压在图标下面）
 *   · `Goods/Num`（cc.Label，数量）
 *
 * 三者的兄弟序 = `[Frame, Icon, Num]` —— 写反**不报错**，只是框把图标盖住。
 *
 * ## ⚠️ 绝对赋值（规则 10）
 *
 * 格子会被虚拟列表 clone 复用：同一份节点会在几帧内先后表示不同的奖励。
 * 所以 `render()` 三个字段**一律无条件写**，`null` 一律当「没有、要清掉」——
 * 绝不能「`null` 就保留上一趟的图」。
 *
 * ⚠️ 图**必须由宿主预加载好再传进来**（`CelebrationFrames`）：
 * 在 `render()` 里现 `resources.load` 会让图落到已经复用成别的行的节点上
 * —— 界面不报错，只是**图串行**。
 */

/** 数量文案（老端 `Goods.GetNumberStr()`：0 显示空串，其余纯整数）。 */
export function osNumberTextOf(number: number): string {
    if (!Number.isFinite(number) || Math.floor(number) === 0) return '';
    return String(Math.floor(number));
}

@ccclass('OSRewardSlot')
export class OSRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（`image/frame/common_img_pzk_0N`）。必须排在 Icon 之前。' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：道具 / 货币图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Num：数量（0 时为空串，老端 `GetNumberStr`）' })
    num: Label = null!;

    /**
     * 铺一格。
     *
     * 两个帧参数都由**宿主预加载**好再传（见文件头）。
     *
     * @param iconFrame 奖励图标；`null` ⇒ 隐藏 `Icon`（**不留上一趟的图**）
     * @param qualityFrame 品质框；`null` ⇒ 隐藏 `Frame`（同样不留上一趟的图）
     * @param number 数量；`0` ⇒ 文案为空串
     */
    render(iconFrame: SpriteFrame | null, qualityFrame: SpriteFrame | null, number: number): void {
        if (this.frame) {
            // ⚠️ 品质框**走绝对赋值**（与 activity / monthcard 的「null 就保留静态框」不同）：
            //    那两个模块的格子总是有品质框，保留静态框是兜底；庆典的奖励格会被
            //    虚拟列表复用到「空槽」上，留着上一格的框比空着更像"图坏了"。
            this.frame.spriteFrame = qualityFrame;
            this.frame.type = OS_SPRITE_SIMPLE;
            this.frame.node.active = !!qualityFrame;
        }
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.type = OS_SPRITE_SIMPLE;
            this.icon.node.active = !!iconFrame;
        }
        if (this.num) this.num.string = osNumberTextOf(number);
        this.node.active = true;
    }

    /**
     * 套一层 `frame` 的九宫类型（品质框默认 `SIMPLE`，这里给「框也要拉伸」的场合留口子）。
     *
     * 目前**没有调用点** —— 品质框是固定 90×90 的正方图，`SIMPLE` 就够。
     * 留着是为了下一个模块别再去 `CelebrationArt` 里翻九宫名单。
     */
    setFrameSliced(sliced: boolean): void {
        if (!this.frame) return;
        this.frame.type = sliced ? osSpriteType('itemBg') : OS_SPRITE_SIMPLE;
    }

    /** 空格子（`rewards` 不够 / `resId` 解析不出）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
