import { _decorator, Component, Label, Node, SpriteFrame } from 'cc';
import { Toast } from '../common/Toast';
import { GoodsBox } from '../itemdetail/GoodsBox';
import { ItemDetailPage } from '../itemdetail/ItemDetailPage';
import { loadItemIconArt, loadItemQualityFrame } from '../itemdetail/ItemDetailArtLoader';
import { mainTaskRepository } from './MainTaskRepository';
import type { IHeroTaskSnapshot, IMainTaskRepository } from './MainTaskRepository';
import { GET_HERO_TEXTS } from './MainTaskTexts';
import { GameNet } from '../net/GameNet';

const { ccclass, property } = _decorator;

/**
 * 主界面「10级领取」HUD。节点烘 true，显隐由 applySnapshot 绝对赋值。
 * 图标先加载完再铺，避免异步回来时节点已销毁。
 */
@ccclass('GetHeroEntry')
export class GetHeroEntry extends Component {
    @property({ type: GoodsBox, tooltip: 'Goods：奖励物品框（带 `Frame`/`Icon`/`Num` 三件套）' })
    goods: GoodsBox = null!;

    @property({ type: Label, tooltip: 'ValueLabel：进度文案 `(7/10)`' })
    valueLabel: Label = null!;

    @property({ type: Node, tooltip: 'RedDot：可领取红点（只有 `FINISH` 才亮）' })
    redDot: Node = null!;

    /** 数据端口；测试可替换。 */
    private repo: IMainTaskRepository = mainTaskRepository;
    /** 当前快照。 */
    private snapshot: IHeroTaskSnapshot | null = null;
    /** 预加载好的两张图（`applySnapshot` 是同步的，不能在里面现加载）。 */
    private qualityFrame: SpriteFrame | null = null;
    private iconFrame: SpriteFrame | null = null;
    /** 每次 refresh 递增，用来丢弃过期的异步结果。 */
    private revision = 0;
    /** 领奖请求进行中（防连点）。 */
    private busy = false;

    protected onDestroy(): void {
        this.revision += 1;
        GameNet.instance.removeCaller(this);
    }

    protected onLoad(): void {
        this.goods.onClick = () => { void this.onGoodsClick(); };
        void this.refresh();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IMainTaskRepository): void {
        this.repo = repository;
    }

    /** 读表 + 读缓存 + 预加载图 → 铺 HUD。宿主在切到本页时调。 */
    async refresh(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repo.load();
        if (!this.isAlive() || revision !== this.revision) return;

        // 图先 **await 完**再铺：`applySnapshot` 是同步的，
        // 在里面现加载会先闪一帧上一份的图；漏项更是**静默留白**（不报错）。
        const [qualityFrame, iconFrame] = await Promise.all([
            loadItemQualityFrame(snapshot.rewardQuality),
            loadItemIconArt(snapshot.rewardIcon),
        ]);
        if (!this.isAlive() || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.qualityFrame = qualityFrame;
        this.iconFrame = iconFrame;
        this.applySnapshot(snapshot);
    }

    /**
     * 把快照铺到 HUD 上。
     *
     * 每一处都**无条件写**：本节点 `_active` 烘的是 `true`，
     * 「只在翻转时写」会在首次「新值 === 缓存初值」时短路 ⇒ 该藏的时候藏不掉。
     */
    applySnapshot(snapshot: IHeroTaskSnapshot): void {
        this.node.active = snapshot.visible;
        this.valueLabel.string = snapshot.configured ? snapshot.progressText : '';
        this.redDot.active = snapshot.showRedDot;
        // 奖励物品框：老端 `com_hero.UpdateByGoods(good)`，格子里不显示数量。
        this.goods.render(this.qualityFrame, this.iconFrame, '', false);
    }

    private isAlive(): boolean {
        return !!this.node && this.node.isValid;
    }

    private async onGoodsClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot || !snapshot.configured) return;
        if (snapshot.canClaim) {
            await this.claim();
            return;
        }
        // 不能领（未完成 / 已领取）：老端 `com_task_hero.setClick` 的 else 分支是空的，
        // 但 `com_goods` 的默认 `onClickItem()` 仍会打开该物品详情 —— 照做。
        if (snapshot.rewardResId > 0) {
            await ItemDetailPage.open({
                userData: { resId: snapshot.rewardResId, number: snapshot.rewardNumber },
            });
        }
    }

    private async claim(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot || this.busy) return;
        const texts = GET_HERO_TEXTS;
        this.busy = true;
        try {
            const result = await this.repo.claim(snapshot.resId, this);
            if (!this.isAlive()) return;
            if (result === 'ok') {
                Toast.show(texts.claimed);
                await this.refresh();
                return;
            }
            // 'offline' 与 'failed' 分开提示：前者一个包都没发（`GameNet.isConnected === false`），
            // 说「领取失败」会让人以为服务端拒了。
            Toast.show(result === 'offline' ? texts.offlineWarn : texts.claimFailed);
        } finally {
            this.busy = false;
        }
    }
}
