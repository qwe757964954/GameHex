import { _decorator, Component, instantiate, Node, Prefab, UITransform } from 'cc';
import { OSRewardSlot } from './OSRewardSlot';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationReward, ICelebrationSnapshot } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 庆典里的**横向奖励条** —— 挂在 `OSRankTargetItem/RewardList` 与 `OSRankRankItem/RewardList` 上。
 *
 * ## 为什么它不是 `VScrollView`
 *
 * FGUI 原稿这两个 `list` 都是 `overflow="scroll" scroll="horizontal"`：
 *
 * | 出处 | 几何 | 条目 | 列距 | 缩放 |
 * |---|---|---|---|---|
 * | `组件_开服冲榜_item1.xml` 的 `list`（庆典目标项） | 304×86，`layout=row` `vAlign=middle` | 奖励项 84×85 | 7 | 1 |
 * | `组件_开服冲榜_item2.xml` 的 `list`（庆典排名项） | 231×86（节点 `scale=0.86` 后 198.66×73.96） | 同上 | 7（→6.02） | 0.86 |
 *
 * 它是**一行的静态横排**：一档目标最多 5 个奖励、一档排名最多 4 个，**永远不超一屏**，
 * 老端却照样 `initVirtualList` —— 那是 FGUI 的惯性写法。迁过来**不套 `VScrollView`**
 * （虚拟列表在这里只有坏处：多一个 `content` 节点、要用 `setTotalCount` 驱动、
 * 而 `VScrollView.start()` 不跑时 `setTotalCount` 会**静默无效**，规则 86）。
 *
 * prefab 里这个节点只有 `cc.Mask`（承载 FGUI 的 `overflow=scroll` 裁剪）+ 本组件，
 * **没有 `content` 子节点** —— 条目由本组件按池子直接挂在 `Mask` 下。
 *
 * ## ⚠️ 缩放不是改节点 `scale`，是改**条目节点**的 `scale`
 *
 * 生成器把 FGUI 列表的 `scale=0.86` **烘进了节点尺寸**（304→198.66、86→73.96），
 * 节点自身 `_lscale` 仍是 `(1,1,1)`。所以排名项那条的条目要**按 `itemWidth / 原生宽`**
 * 单独缩放 —— 直接改 `RewardList` 的 `scale` 会让 `Mask` 的裁剪矩形也跟着缩
 * （裁剪区按节点矩形走），把最后一格切掉。
 */

/** 奖励条的原生条目尺寸（`OSRankRewardItem` 的 84×85）。prefab 里烘的值必须与它一致。 */
export const OS_REWARD_NATIVE_W = 84;
export const OS_REWARD_NATIVE_H = 85;

@ccclass('OSArtStrip')
export class OSArtStrip extends Component {
    @property({
        type: Prefab,
        tooltip: '条目预制体（`ui/Celebration/OSRankRewardItem`）。**必须烘成 cc.Prefab 引用**，'
            + '填字符串（prefab 名）不会报错，只会退化成空条 —— 与 `itemPrefab` 那个坑同一个。',
    })
    itemPrefab: Prefab = null!;

    @property({ tooltip: '条目显示宽（庆典目标 84 / 庆典排名 72.24 = 84×0.86）' })
    itemWidth: number = OS_REWARD_NATIVE_W;

    @property({ tooltip: '条目显示高（只用于断言 / 垂直居中，不参与横向排布）' })
    itemHeight: number = OS_REWARD_NATIVE_H;

    @property({ tooltip: '列距（FGUI `colGap`：庆典目标 7 / 庆典排名 6.02 = 7×0.86）' })
    gap: number = 7;

    /** 节点池（下标 = 第几个奖励）。只增不减 —— 一档的奖励数是常量，池子天然有界。 */
    private readonly _pool: Node[] = [];

    /**
     * 铺一条。
     *
     * @param rewards 这一档的奖励（空数组 ⇒ 整条隐藏，不留上一行的残留）
     */
    render(snapshot: ICelebrationSnapshot, rewards: readonly ICelebrationReward[], frames: CelebrationFrames): void {
        const count = rewards.length;
        if (count === 0) {
            for (const node of this._pool) node.active = false;
            this.node.active = false;
            return;
        }
        this.node.active = true;

        this._ensurePool(count);

        const host = this.getComponent(UITransform);
        const listH = host ? host.height : this.itemHeight;
        const scale = this.itemWidth / OS_REWARD_NATIVE_W;
        // 锚点是 (0,1)（左上）⇒ 子节点中心的 y = −列表高 / 2；x = 左内边距 + 第 i 格中心。
        const centerY = -listH / 2;

        for (let i = 0; i < this._pool.length; i++) {
            const node = this._pool[i];
            const reward = i < count ? rewards[i] : null;
            if (!reward) {
                node.active = false;
                continue;
            }
            node.setScale(scale, scale, 1);
            node.setPosition(i * (this.itemWidth + this.gap) + this.itemWidth / 2, centerY, 0);
            const slot = node.getComponent(OSRewardSlot);
            if (!slot) {
                // 与「节点上没有 cc.Button」同一个处置：只说一声、不静默。
                console.error('[Celebration] 奖励条条目上没有 OSRewardSlot，这一格不会显示');
                node.active = false;
                continue;
            }
            slot.render(
                frames.iconOf(snapshot, reward.resId),
                frames.qualityOf(snapshot, reward.resId),
                reward.number,
            );
        }
    }

    /** 隐藏整条（没有奖励 / 页面切走）。 */
    hide(): void {
        for (const node of this._pool) node.active = false;
        this.node.active = false;
    }

    /** 池子扩到至少 `count` 个（**只增不减**：条目数是一档的常量，反复增删没有收益）。 */
    private _ensurePool(count: number): void {
        if (!this.itemPrefab) {
            console.error(`[Celebration] ${this.node.name} 的 itemPrefab 没绑 —— 奖励条永远是空的`);
            return;
        }
        while (this._pool.length < count) {
            const node = instantiate(this.itemPrefab);
            node.name = `Reward${this._pool.length}`;
            node.setParent(this.node);
            this._pool.push(node);
        }
    }
}
