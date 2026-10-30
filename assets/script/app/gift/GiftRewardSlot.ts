import { _decorator, Component, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 一个奖励格的图（品质框 + 道具图标）。
 *
 * ⚠️ 必须**逐格**给，不能「一行一个品质框共用」：一行里的几个奖励品质可以不同，
 * 共用一个框会出现「第 3 格的框是第 1 格的品质」这种静默错。
 */
export interface IGiftSlotFrame {
    readonly qualityFrame: SpriteFrame | null;
    /** `null` ⇒ 该格整块隐藏（不是画问号）。 */
    readonly iconFrame: SpriteFrame | null;
}

/**
 * 礼包商品行里的**一个奖励格**（内联在 `Gift.prefab` 的行模板下，84×84）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/超值礼包子页面/组件_礼包_超值礼包_普通礼包item.xml`
 * 里的 `list` → defaultItem（`自定义组件/组件_道具.xml`，80×80）：
 *   本节点挂 `cc.Sprite` 当**品质框**，下面挂 `Icon`（道具图，居中）。
 *
 * ⚠️ 品质框与道具图**都必须由宿主预加载好再传进来**：在这里现加载会先闪一帧上一行的图
 * （`VScrollView` 回收残影同款缺陷）。宿主是 `GiftPage.loadArtFrames()`。
 */
@ccclass('GiftRewardSlot')
export class GiftRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框底图（本节点上的 cc.Sprite）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：道具图标（没有映射图时会被隐藏）' })
    icon: Sprite = null;

    protected onLoad(): void {
        if (!this.frame) {
            const own = this.getComponent(Sprite);
            if (own) this.frame = own;
        }
    }

    /**
     * 铺一个奖励。
     *
     * `qualityFrame` 传 `null` 时**保留** prefab 上的静态框，不把它清成空白
     * （空白看着像「图丢了」，而静态框至少是个正常的品质框）。
     */
    render(qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        if (qualityFrame) this.frame.spriteFrame = qualityFrame;
        if (iconFrame) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = true;
        } else {
            // 没图就整块藏掉 —— 不画问号占位（那更像「图坏了」）
            this.icon.node.active = false;
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
