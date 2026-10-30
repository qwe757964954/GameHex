import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「联盟」P4 三个面板共用的**奖励格** —— 品质框 + 道具图标 + 数量。
 *
 * ## 为什么自建，而不是复用 FGUI 的「物品框」
 *
 * FGUI `共用组件/组件/物品框/物品框.xml` 里**只有一个 loader**（`ui看效果用的`，`fill="scale"`）
 * 加一个 `扫光` 过渡 —— 看着像「一个空盒子」。真正的 `icon` / `text_number` / `星级` / `icon_frame`
 * 是运行时由 `GObjGoods` 挂上 behavior（`ItemBehavior2` 等）后**动态查子节点**才出现的：
 *
 * ```ts
 * this.com.tm("text_number").setText(number);   // ItemBehavior2.onNumberUpdate
 * ```
 *
 * 也就是说「物品框长什么样」在**组件 XML 里根本看不到**，它取决于挂的是哪个 behavior
 * （道具 / 装备 / 宝石 / 武将 / 灵宠 / 头像框 …共 10 个模板，见 `物品框/` 目录）。
 * 联盟这三处挂的都是 `roleProperty` / `item` 的**普通道具** ⇒ 唯一对应的模板是
 * `共用组件/组件/物品框/组件_公用_道具.xml`：
 *
 * | FGUI 节点 | 尺寸 / 位置 | 本端 |
 * |---|---|---|
 * | `icon_frame`（品质框，`gearIcon` 按 `品质` 换 8 张） | 100×100 铺满 | 本节点自己的 `cc.Sprite` |
 * | `icon`（道具图，`fill=scale`、`scale=0.8`） | 100×100 居中、显示 80×80 | `Icon` 子节点 |
 * | `text_number`（数量，richtext） | (86,66) 13×34、24px `#ffffff`、右对齐、中间垂直 | `Count` 子节点 |
 * | `星级` | 只在装备/武将上有 | **不建**（普通道具恒 `visible=false`） |
 *
 * ⚠️ 品质框那 8 张图的引用 id（`rc091yxnala` … `kctl1yxnanw`）是公用包的，
 *    本工程**已经有一份迁移版本**：`image/frame/common_img_pzk_0N`（活动 / 七日 / 礼包都在用，
 *    见 `LayerActivityArt.QUALITY_FRAME_NAMES`）。⇒ 直接复用那一套，不再拷 8 张新图。
 *
 * ## 与 `ActivityRewardSlot` 的关系
 *
 * 结构几乎一样，但**有意不合并**：本格多一个数量 `Count`（活动那个格子的数量写在行的
 * `labProgress` 里），两者的 prefab 契约不同。同 `SevenDayRewardSlot` / `ActivityRewardSlot`
 * 当初「两个副本」的处置口径。
 *
 * ## 数据必须由宿主**预加载好**再传进来
 *
 * `render()` 是**同步**的：图在这里现加载会先闪一帧上一行的图（`VScrollView` 回收残影同款缺陷）。
 * 宿主（三个 Page）负责先把本趟要用到的帧全 preload 进 `Map<resId, SpriteFrame>`
 * （见 `LeagueStorePage.loadArt` 等）。
 */
@ccclass('LeagueRewardSlot')
export class LeagueRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：道具图标（没有映射图时整节点隐藏）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Count：数量（showCount=false 或数量<=0 时隐藏）' })
    countLabel: Label = null;

    /** 品质框（本节点上的 `cc.Sprite`；`onLoad` 兜底自取）。 */
    private frame: Sprite | null = null;

    protected onLoad(): void {
        this.frame = this.getComponent(Sprite);
    }

    /** 品质框 Sprite（供宿主 / 探针取用）。 */
    get frameSprite(): Sprite | null {
        return this.frame;
    }

    /**
     * 铺一个奖励。
     *
     * @param qualityFrame 品质框（`null` ⇒ **保留** prefab 上的静态框，不清成空白）
     * @param iconFrame    道具图标（`null` ⇒ 隐藏 `Icon`，不画问号占位）
     * @param count        数量（`showCount=false` 或 `<= 0` 时隐藏 `Count`）
     * @param showCount    是否显示数量（默认显示）
     */
    render(
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        count: number,
        showCount = true,
    ): void {
        if (qualityFrame && this.frame) this.frame.spriteFrame = qualityFrame;
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = !!iconFrame;
        }
        this.setCount(count, showCount);
    }

    /** 只改数量（宿主复用同一格时用；绝对赋值 —— 槽位复用不留上一行的残影）。 */
    setCount(count: number, showCount = true): void {
        if (!this.countLabel) return;
        const n = Number.isFinite(count) ? Math.trunc(count) : 0;
        const show = showCount && n > 0;
        this.countLabel.node.active = show;
        if (show) this.countLabel.string = String(n);
    }

    /** 空格子（解析不出奖励 / 该面板这一格本来就没有）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
