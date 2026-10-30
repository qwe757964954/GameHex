import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { ComponentController } from '../../framework/controller/ComponentController';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { RefUtil } from '../../framework/ref/RefUtil';
import { spriteFramePathOf } from '../ArtPaths';
import { qualityFrameArtPath } from '../itemdetail/ItemDetailArt';
import { qualityFrameSuffixOf } from '../itemdetail/ItemDetailTable';
import {
    ITEM_TABLE,
    ROLE_PROPERTY_TABLE,
    resBarCellOfRefId,
    resBarIconSpritePath,
    type IItemRefRow,
    type IResPropertyRow,
} from '../common/ResTypes';

const { ccclass, property } = _decorator;

/**
 * 一格奖励要展示什么 —— **只要「物品 id + 数量」**。
 *
 * 图标、品质框、品质档位全部由组件自己解析（读表 + 加载帧），
 * 宿主不该再各自去 `loadIcon` / `loadQualityFrame` —— 三处弹窗各写一遍就是冗余。
 */
export interface IRewardItemData {
    readonly resId: number;
    readonly amount: number;
    /** 概率（**百分比**，`70` ⇒ 70%）；`0`/省略 = 不显示（只有宝箱详情用）。 */
    readonly ratePercent?: number;
}

/**
 * **公共奖励格**（`ui/common/RewardItem.prefab`）—— 品质框 + 图标 + 数量，可选概率。
 *
 * 领地页四个弹窗原先各自带一份「Frame + Icon + Num」的格子，字段一模一样、只是尺寸和有没有概率不同，
 * 而且**每处都要自己把 resId 解析成帧**（关卡的 `prefillLevelIcons`、宝箱的 `loadChestFrame`…）。
 * 现在统一成：宿主只喂 `{ resId, amount }`，解析与加载都在这里，资源跟随格子生命周期。
 *
 * 用法：
 * ```ts
 * view.render({ resId: 16014, amount: 8 });  // 图标/品质框自己搞定
 * ```
 */
@ccclass('RewardItemView')
export class RewardItemView extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（按物品品质自动换帧）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：物品图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Num：数量（`0` ⇒ 空串）' })
    num: Label = null;

    @property({ type: Label, tooltip: 'Rate：概率（`0` ⇒ 整行隐藏，只有宝箱详情用）' })
    rate: Label = null;

    // ============================================================
    // 只读表数据共享；动态图帧由每个格子的控制器持有。
    // ============================================================
    private static propRows: readonly IResPropertyRow[] = [];
    private static itemRows: readonly IItemRefRow[] = [];
    private static tablesLoading: Promise<void> | null = null;
    private readonly controller = new ComponentController('ui:reward-item');
    private get resourceScope(): ResourceScope { return this.controller.scope; }
    private readonly frameCache = new Map<string, Promise<SpriteFrame | null>>();

    private static async loadTables(): Promise<void> {
        const [props, items] = await Promise.all([
            RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE).catch(() => null),
            RefUtil.instance.getRefAllAsync(ITEM_TABLE).catch(() => null),
        ]);
        RewardItemView.propRows = (props ?? []) as IResPropertyRow[];
        RewardItemView.itemRows = (items ?? []) as IItemRefRow[];
    }

    private loadFrame(path: string): Promise<SpriteFrame | null> {
        if (!path || this.resourceScope.disposed) return Promise.resolve(null);
        const cached = this.frameCache.get(path);
        if (cached) return cached;
        const assets = this.controller.resources.assets;
        // JS Map 不持有 Cocos 引用；显式租约避免切对局时共用帧被释放成 uv=null。
        const task = assets.load(spriteFramePathOf(path), SpriteFrame, { scope: this.resourceScope })
            .then((frame) => !this.resourceScope.disposed && frame.isValid ? frame : null, (err) => {
                // 🔴 加载失败**必须出声**：静默吞掉 ⇒ 奖励格渲染成空框、零报错（结算页看着"没奖励"）。
                //    失败结果**不入缓存**，下一趟 render 会重试（虚拟列表回收复用时会再填一次）。
                console.warn(`[RewardItemView] 奖励格资源加载失败：${path}`, err);
                return null;
            });
        this.frameCache.set(path, task);
        return task;
    }

    protected onDestroy(): void {
        this.controller.dispose();
        this.frameCache.clear();
    }

    private static qualityOf(resId: number): number {
        const prop = RewardItemView.propRows.find((row) => Number(row.resId) === resId);
        const item = RewardItemView.itemRows.find((row) => Number(row.resId) === resId) as { quality?: unknown } | undefined;
        const quality = Number(prop?.quality ?? item?.quality);
        return Number.isFinite(quality) && quality >= 1 ? Math.floor(quality) : 1;
    }

    /** 本格当前的 resId（异步加载回来时确认没被复用成别的物品）。 */
    private currentResId = 0;

    /**
     * 铺一格（幂等）。
     *
     * 数量/概率同步写；图标与品质框异步填（命中缓存就是同帧）。
     * 先清空上一趟的帧，避免回收复用瞬间「串图」。
     */
    render(data: IRewardItemData): void {
        this.currentResId = data.resId;
        this.node.active = true;

        this.num.string = Number.isFinite(data.amount) && Math.floor(data.amount) > 0
            ? String(Math.floor(data.amount)) : '';
        const rate = Number(data.ratePercent);
        const hasRate = Number.isFinite(rate) && rate > 0;
        // 传进来的是**百分比**（70 ⇒ 70%），别再除一次 100
        this.rate.string = hasRate ? `${Math.round(rate)}%` : '';
        this.rate.node.active = hasRate;

        this.frame.spriteFrame = null;
        this.icon.spriteFrame = null;
        void this.applyFrames(data.resId);
    }


    private async applyFrames(resId: number): Promise<void> {
        await (RewardItemView.tablesLoading ??= RewardItemView.loadTables());
        if (!this.isValid || this.resourceScope.disposed || this.currentResId !== resId) return;
        const quality = RewardItemView.qualityOf(resId);
        const iconPath = resBarIconSpritePath(resBarCellOfRefId(resId, RewardItemView.propRows, RewardItemView.itemRows));
        const [qualityFrame, iconFrame] = await Promise.all([
            // ⚠️ `qualityFrameArtPath` 返回的是**相对 `image/` 的路径**（`common/cu_quality_xx`），前缀不能漏
            this.loadFrame(`image/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`),
            this.loadFrame(iconPath),
        ]);
        // 加载期间格子可能已被复用成别的物品（虚拟列表回收）⇒ 以最后一次 render 为准
        if (!this.isValid || this.resourceScope.disposed || this.currentResId !== resId) return;
        this.frame.spriteFrame = qualityFrame;
        this.icon.spriteFrame = iconFrame;
        this.icon.node.active = iconFrame !== null;
    }
}
