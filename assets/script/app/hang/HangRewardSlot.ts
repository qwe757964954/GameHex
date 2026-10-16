import { _decorator, Component, Sprite, SpriteFrame } from 'cc';
import { HJ_SPRITE_SIMPLE } from './HangArt';

const { ccclass, property } = _decorator;

/**
 * 征收「产出奖励」网格里的**一格**（FGUI 挂机包 `组件_挂机奖励_项.xml`，102×102）。
 *
 * ## 为什么这里比 FGUI 原稿多一个品质框
 *
 * FGUI 原稿这一格只有一个 `com_goods`（`共用组件/组件/物品框/物品框.xml`），而那份「物品框」
 * 是**设计期残件** —— 它唯一的子节点叫 `ui看效果用的`，是个裸 loader，既没有底板也没有品质框。
 * 真正的运行时格子由**老端代码画**：
 *
 * ```ts
 * // 老端 LayerHang.renderListItem
 * comGoods.UpdateByGoods(data);
 * comGoods.GetBehavior().onNumberVisible(false);   // ← 数字恒隐藏
 * ```
 *
 * 所以这一格 = **品质框 + 图标**，**没有数量文字**（`onNumberVisible(false)`）。设计图
 * `税-标注.jpg` 里四个奖励格外面那圈蓝框就是品质框（`quality 3` ⇒ `common_img_pzk_02`）。
 *
 * ⚠️ 只有 `frame` 需要 `_type = 1`（若它落到九宫名单里）；图标恒 `SIMPLE`。
 */
@ccclass('HangRewardSlot')
export class HangRewardSlot extends Component {
    @property({ type: Sprite, tooltip: '品质框（`image/frame/common_img_pzk_0N`）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: '道具图标（`item` / `roleProperty` 两支分流解析）' })
    icon: Sprite = null!;

    /**
     * 铺一格。
     *
     * 两个参数都是**绝对赋值**（规则 10）：格子会被复用，`null` 一律当「没有、要清掉」，
     * 绝不能「`null` 就保留上一趟的图」。
     */
    render(frame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        if (this.frame) {
            this.frame.spriteFrame = frame;
            this.frame.type = HJ_SPRITE_SIMPLE;
        }
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.type = HJ_SPRITE_SIMPLE;
            this.icon.node.active = !!iconFrame;
        }
        this.node.active = true;
    }

    /** 空格子（本关产出不够 6 条 / `resId` 解析不出）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
