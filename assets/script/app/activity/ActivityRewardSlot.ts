import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 每日任务行里的**一个奖励格**（85×85，内联在 `Activity.prefab` 的行模板下）。
 *
 * 结构对齐 FGUI `活动/组件/组件_活动列表_项_奖励Item.xml` → 里面的 `com_goods`：
 *   本节点挂 `cc.Sprite` 当**品质框**，下面挂 `Icon`（道具图，居中）与 `Num`（数量，右下角）。
 *
 *  ⚠️ 品质框与道具图**都必须由宿主预加载好再传进来**：在这里现加载会先闪一帧上一行的图
 *  （`VScrollView` 回收残影同款缺陷）。宿主是 `LayerActivityPage.loadRewardArt()`。
 *
 *  ⚠️ `Num` 的几何（位置 / 尺寸 / 字号）**是 FGUI 物品框 100×100 原稿 × (85/100) 算出来的**，
 *  真源与推导写在 `LayerActivityLayout.ACTIVITY_ROW_REWARD_NUM_*`；
 *  锚点必须是 `(1, 0.5)` + `overflow=NONE` —— 位数变化时右缘钉死、往左溢，
 *  换成居中/左对齐会让「2」和「1000」停在不同位置。
 *
 *  ⚠️ 与 `SevenDayRewardSlot` 是同一份实现的两个副本（两个模块各持一份）。
 *  没有合并成一个公共组件，是因为行模板的复用方式以后可能分叉（活动这边一行最多 5 格、
 *  七日狂欢固定 1 格），共享类会把两边的 `@property` 绑成一个 prefab 契约、不好各自演进。
 */
@ccclass('ActivityRewardSlot')
export class ActivityRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框底图（本节点上的 cc.Sprite）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：道具图标（没有映射图时会被隐藏）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Num：数量 —— **子节点 `Num` 上**的 cc.Label（锚点 (1,0.5) + overflow=NONE；空串时不显示）' })
    num: Label = null;

    protected onLoad(): void {
        if (!this.frame) {
            const own = this.getComponent(Sprite);
            if (own) this.frame = own;
        }
        // 只是提醒，**不抛**：抛了会在虚拟列表 clone 时打断整行渲染（比「少个数字」严重得多）
        if (!this.num) console.warn('[Activity] ActivityRewardSlot 漏绑 num，奖励数量不会显示');
    }

    /**
     * 铺一个奖励。
     *
     * `qualityFrame` 传 `null` 时**保留** prefab 上的静态框，不把它清成空白
     * （空白看着像"图丢了"，而静态框至少是个正常的品质框）。
     *
     * ⚠️ 数量是**无条件写**的：整行会被虚拟列表 clone 复用，
     * 「有值才写」会让「上一行有数量、这一行没数量」的格子把**旧数字**留在界面上，且不报错。
     *
     * @param numberText 数量文案（空串即不显示）；由宿主走 `itemNumberTextOf` 生成（`0 ⇒ ''`）
     */
    render(qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null, numberText: string = ''): void {
        if (qualityFrame) this.frame.spriteFrame = qualityFrame;
        if (iconFrame) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = true;
        } else {
            // 没图就整块藏掉 —— 不画问号占位（那更像"图坏了"）
            this.icon.node.active = false;
        }
        if (this.num) {
            this.num.string = numberText;
            this.num.node.active = numberText.length > 0;
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
