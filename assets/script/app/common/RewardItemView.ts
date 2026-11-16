import { _decorator, Button, Component, Label, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { REWARD_ITEM_DETAIL_INTENT } from './RewardItemEvents';
import { ComponentController } from '../../framework/controller/ComponentController';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import { RefUtil } from '../../framework/ref/RefUtil';
import { spriteFramePathOf } from '../ArtPaths';
import { itemQualityFrameRelPath } from '../itemdetail/ItemDetailArtLoader';
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
 * 一格奖励要展示什么：物品 id + 数量。
 * 图标、品质框、品质档位都由组件自己解析，宿主不要再去 loadIcon / loadQualityFrame。
 */
export interface IRewardItemData {
    readonly resId: number;
    readonly amount: number;
    /** 概率（百分比，`70` ⇒ 70%）；`0` / 省略 = 不显示（只有宝箱详情用）。 */
    readonly ratePercent?: number;
}

/**
 * 公共奖励格（`ui/common/RewardItem.prefab`）：品质框 + 图标 + 数量，可选概率。
 * 宿主只喂 `{ resId, amount }`，表查询与帧加载都在这里，资源跟随格子生命周期。
 */
@ccclass('RewardItemView')
export class RewardItemView extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（按物品品质自动换帧）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：物品图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Num：数量（`0` ⇒ 空串）' })
    num: Label = null!;

    @property({ type: Label, tooltip: 'Rate：概率（`0` ⇒ 整行隐藏，只有宝箱详情用）' })
    rate: Label = null!;

    // 表数据只读共享；动态帧由每个格子的控制器持有。
    private static propRows: readonly IResPropertyRow[] = [];
    private static itemRows: readonly IItemRefRow[] = [];
    private static tablesLoading: Promise<void> | null = null;

    private readonly controller = new ComponentController('ui:reward-item');
    private readonly frameCache = new Map<string, Promise<SpriteFrame | null>>();
    /** 本格当前的 resId（异步加载回来时确认没被复用成别的物品）。 */
    private currentResId = 0;

    private get resourceScope(): ResourceScope {
        return this.controller.scope;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    protected onDestroy(): void {
        this.controller.dispose();
        this.frameCache.clear();
    }

    private onClick(): void {
        if (!Number.isSafeInteger(this.currentResId) || this.currentResId <= 0) return;
        EventMgr.instance.emit(REWARD_ITEM_DETAIL_INTENT, { resId: this.currentResId });
    }

    private static async loadTables(): Promise<void> {
        const [props, items] = await Promise.all([
            RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE).catch(() => null),
            RefUtil.instance.getRefAllAsync(ITEM_TABLE).catch(() => null),
        ]);
        RewardItemView.propRows = (props ?? []) as IResPropertyRow[];
        RewardItemView.itemRows = (items ?? []) as IItemRefRow[];
    }

    private static qualityOf(resId: number): number {
        const prop = RewardItemView.propRows.find((row) => Number(row.resId) === resId);
        const item = RewardItemView.itemRows.find((row) => Number(row.resId) === resId);
        const quality = Number(prop?.quality ?? item?.quality);
        return Number.isFinite(quality) && quality >= 1 ? Math.floor(quality) : 1;
    }

    private loadFrame(path: string): Promise<SpriteFrame | null> {
        if (!path || this.resourceScope.disposed) return Promise.resolve(null);
        const cached = this.frameCache.get(path);
        if (cached) return cached;
        const assets = this.controller.resources.assets;
        // JS Map 不持有 Cocos 引用；显式租约避免切对局时共用帧被释放成 uv=null。
        const task = assets.load(spriteFramePathOf(path), SpriteFrame, { scope: this.resourceScope })
            .then((frame) => !this.resourceScope.disposed && frame.isValid ? frame : null, (err) => {
                // 加载失败必须出声：静默吞掉会让奖励格渲染成空框、零报错（结算页看着像「没奖励」）。
                // 失败结果同样留在缓存里，避免同一格每次 render 重复请求、重复报警。
                console.warn(`[RewardItemView] 奖励格资源加载失败：${path}`, err);
                return null;
            });
        this.frameCache.set(path, task);
        return task;
    }

    /**
     * 铺一格（幂等）。数量 / 概率同步写，图标与品质框异步填（命中缓存就是同帧）。
     * 先清空上一趟的帧，避免回收复用瞬间串图。
     */
    render(data: IRewardItemData): void {
        this.currentResId = data.resId;
        this.node.active = true;

        const amount = Math.floor(data.amount);
        this.num.string = Number.isFinite(data.amount) && amount > 0 ? String(amount) : '';

        const rate = Number(data.ratePercent);
        const hasRate = Number.isFinite(rate) && rate > 0;
        // 传进来的是百分比（70 ⇒ 70%），不要再除 100
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
            this.loadFrame(itemQualityFrameRelPath(quality)),
            this.loadFrame(iconPath),
        ]);
        // 加载期间格子可能已被复用成别的物品，以最后一次 render 为准。
        if (!this.isValid || this.resourceScope.disposed || this.currentResId !== resId) return;
        this.frame.spriteFrame = qualityFrame;
        this.icon.spriteFrame = iconFrame;
        this.icon.node.active = iconFrame !== null;
    }
}
