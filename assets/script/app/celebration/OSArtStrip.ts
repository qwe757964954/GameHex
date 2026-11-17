import { _decorator, Component, instantiate, Node, Prefab, UITransform } from 'cc';
import { OSRewardSlot } from './OSRewardSlot';
import type { CelebrationFrames } from './CelebrationFrames';
import type { ICelebrationReward, ICelebrationSnapshot } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 横向奖励条，挂在 `OSRankTargetItem/RewardList` 与 `OSRankRankItem/RewardList` 上。
 *
 * 老端这两个 `list` 是 FGUI 的 `overflow="scroll" scroll="horizontal"`，但条目数固定：
 * 庆典目标项 304×86 最多 5 个 84×85、列距 7；庆典排名项 231×86 最多 4 个、列距 6.02。
 * 一排永远放得下，所以这里不用 `VScrollView`：那样要多一个 `content`、
 * 还得先等它的 `start()` 才能 `setTotalCount`，否则条数静默无效。
 *
 * 节点上只有 `cc.Mask`（承载 FGUI 的裁剪）和本组件，没有 `content`，条目直接挂在 `Mask` 下。
 *
 * 缩放加在条目节点上，不加在 `RewardList` 上：生成器把 FGUI 列表的 `scale=0.86` 烘进了节点尺寸
 * （304→198.66、86→73.96），节点自身仍是 1。直接改 `RewardList` 的 scale 会让 `Mask` 的裁剪矩形
 * 跟着缩，最后一格被切掉。
 */

/** 奖励条的原生条目尺寸（`OSRankRewardItem` 的 84×85），prefab 里烘的值要与它一致。 */
export const OS_REWARD_NATIVE_W = 84;
export const OS_REWARD_NATIVE_H = 85;

@ccclass('OSArtStrip')
export class OSArtStrip extends Component {
    @property({
        type: Prefab,
        tooltip: '条目预制体（ui/Celebration/OSRankRewardItem），必须烘成 cc.Prefab 引用；'
            + '填字符串不会报错，只会退化成空条。',
    })
    itemPrefab: Prefab = null!;

    @property({ tooltip: '条目显示宽（庆典目标 84 / 庆典排名 72.24 = 84×0.86）' })
    itemWidth: number = OS_REWARD_NATIVE_W;

    @property({ tooltip: '条目原生高（只对齐设计稿 84×85，排布用节点 UITransform 高度）' })
    itemHeight: number = OS_REWARD_NATIVE_H;

    @property({ tooltip: '列距（FGUI colGap：庆典目标 7 / 庆典排名 6.02 = 7×0.86）' })
    gap: number = 7;

    /** 节点池（下标 = 第几个奖励）。只增不减，一档的奖励数是常量，池子天然有界。 */
    private readonly _pool: Node[] = [];

    /** 铺一条；`rewards` 为空时整条隐藏，不留上一行的残留。 */
    render(snapshot: ICelebrationSnapshot, rewards: readonly ICelebrationReward[], frames: CelebrationFrames): void {
        const count = rewards.length;
        if (count === 0) {
            this.hide();
            return;
        }
        this.node.active = true;

        this._ensurePool(count);

        // 锚点是 (0,1)（左上），子节点中心的 y = -列表高 / 2；x = 左内边距 + 第 i 格中心。
        const listH = this.getComponent(UITransform).height;
        const centerY = -listH / 2;
        const scale = this.itemWidth / OS_REWARD_NATIVE_W;

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

    /** 池子扩到至少 `count` 个；只增不减。 */
    private _ensurePool(count: number): void {
        while (this._pool.length < count) {
            const node = instantiate(this.itemPrefab);
            node.name = `Reward${this._pool.length}`;
            node.setParent(this.node);
            this._pool.push(node);
        }
    }
}
