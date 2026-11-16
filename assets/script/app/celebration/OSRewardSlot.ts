import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { OS_SPRITE_SIMPLE } from './CelebrationArt';

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
        // 品质框走绝对赋值：格子会被虚拟列表复用，不能留下上一格的图。
        this.frame.spriteFrame = qualityFrame;
        this.frame.type = OS_SPRITE_SIMPLE;
        this.frame.node.active = !!qualityFrame;

        this.icon.spriteFrame = iconFrame;
        this.icon.type = OS_SPRITE_SIMPLE;
        this.icon.node.active = !!iconFrame;

        this.num.string = osNumberTextOf(number);
        this.node.active = true;
    }

    /** 空格子（`rewards` 不够 / `resId` 解析不出）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
