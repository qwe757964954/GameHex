import { _decorator, Component, Label, Node, SpriteFrame } from 'cc';
import { Toast } from '../common/Toast';
import { GoodsBox } from '../itemdetail/GoodsBox';
import { ItemDetailPage } from '../itemdetail/ItemDetailPage';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import { loadItemIconArt, loadQualityFrameArt } from '../itemdetail/ItemDetailArtLoader';
import { mainTaskRepository } from './MainTaskRepository';
import type { IHeroTaskSnapshot, IMainTaskRepository } from './MainTaskRepository';
import { GET_HERO_TEXTS } from './MainTaskTexts';
import { GameNet } from '../net/GameNet';

const { ccclass, property } = _decorator;

/**
 * 主界面「10级领取」HUD —— 老端 FGUI `主界面_战斗/组件/组件_主界面_领取武将.xml`（120×120），
 * 装配代码在 `GObjChapterSelect.onMainTaskChange()` 里（挂在「组件_战斗_章节选择」上）。
 *
 * 内容 = 奖励物品框 + 进度文案 `(7/10)` + 可领取红点。
 *
 * ## 数据
 *
 * `taskMain` 表里 `targetType = 99` 那**唯一**一行（`resId 500099`，`param.count = 10`，
 * 奖励 `18014`），进度与领取状态来自服务端缓存 `CmdTask`，领奖发
 * `CmdTakeMainTaskRewardReqMsg`。判定与解析全在 `MainTaskTable`（纯函数、可单测）。
 *
 * ## 点击（老端口径，两路）
 *
 * ```js
 * com_hero.SetClaimable(cb)   // 可领时：点物品框 = 领奖，而不是弹详情
 * com_task_hero.setClick(() => {
 *     if (heroTaskVo.CanBeReward()) { CtrlMainTask.RequestReward(resId) }
 *     // else 分支是空的（注释掉的那段才是"打开物品信息"）
 * })
 * ```
 *
 * ⇒ 可领（`FINISH`）点 → 领奖；否则 `com_goods` 的默认 `onClickItem()` 生效 → 弹该物品详情。
 *
 * ## ⚠️ 显隐归属（别加 `onEnable` 自动刷新）
 *
 * 本组件**自己**写 `node.active`（`applySnapshot` 里无条件写，规则 82/86）。
 * 若在 `onEnable` 里再调 `refresh()`，会与「`applySnapshot` 把 `node.active` 置 false」
 * 形成互相触发，而且**隐藏之后就再也没人把它点亮**（`applySnapshot` 在 inactive 时不执行）。
 *
 * 刷新时机与 `ChatEntryButton` / `HangEntryButton` / `OSRankEntryButton` 同一口径：
 * 宿主 `ArenaRoot`（竞技页）由 `MainTabHost.showPage()` **整页实例化 / 销毁**
 * （`MainTabHost.ts:112`）⇒ 每次切回竞技 tab，`onLoad` 都会重跑一次 `refresh()`，
 * **不需要**再让 `MainPage` 额外调 —— 加宿主调用是多余的第二条刷新链。
 * 唯一残留窗口：首次进主界面时 `CmdTask` 还没到（那时 HUD 会隐藏，切一次 tab 即恢复）。
 *
 * ## prefab 上的两条硬约束
 *
 * · 本节点 `_active` **必须烘 `true`**（规则 86）：`onLoad` 只在激活时跑，
 *   而 `refresh()` 就在 `onLoad` 里 —— 烘 `false` = 永不刷新的死锁，且一条错都不报。
 * · 物品框内的 `Frame` / `Icon` / `Num` 按 100×100 原稿烘，缩放交给宿主节点 `scale`（见 `GoodsBox`）。
 */
@ccclass('GetHeroEntry')
export class GetHeroEntry extends Component {
    @property({ type: GoodsBox, tooltip: 'Goods：奖励物品框（带 `Frame`/`Icon`/`Num` 三件套）' })
    goods: GoodsBox = null;

    @property({ type: Label, tooltip: 'ValueLabel：进度文案 `(7/10)`' })
    valueLabel: Label = null;

    @property({ type: Node, tooltip: 'RedDot：可领取红点（只有 `FINISH` 才亮）' })
    redDot: Node = null;

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
        if (this.goods) {
            this.goods.onClick = () => { void this.onGoodsClick(); };
        }
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

        // 图先 **await 完**再铺（规则 60/73）：`applySnapshot` 是同步的，
        // 在里面现加载会先闪一帧上一份的图；漏项更是**静默留白**（不报错）。
        const [qualityFrame, iconFrame] = await Promise.all([
            loadQualityFrameArt(qualityFrameSuffixOf(snapshot.rewardQuality)),
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
     * ⚠️ 每一处都**无条件写**（规则 82）：本节点 `_active` 烘的是 `true`（规则 86 要求），
     * 「只在翻转时写」会在首次「新值 === 缓存初值」时短路 ⇒ 该藏的时候藏不掉。
     */
    applySnapshot(snapshot: IHeroTaskSnapshot): void {
        this.node.active = snapshot.visible;
        if (this.valueLabel) this.valueLabel.string = snapshot.configured ? snapshot.progressText : '';
        if (this.redDot) this.redDot.active = snapshot.showRedDot;
        // 奖励物品框：老端 `com_hero.UpdateByGoods(good)`，格子里不显示数量。
        this.goods?.render(this.qualityFrame, this.iconFrame, '', false);
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
