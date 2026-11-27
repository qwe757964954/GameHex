import { _decorator, Button, Component, Label, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { REWARD_GEM_DETAIL_INTENT, REWARD_ITEM_DETAIL_INTENT } from './RewardItemEvents';
import { ComponentController } from '../../framework/controller/ComponentController';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import { RefUtil } from '../../framework/ref/RefUtil';
import { spriteFramePathOf } from '../ArtPaths';
import { itemQualityFrameRelPath } from '../itemdetail/ItemDetailArtLoader';
import { cardItemIdsOf, itemFrameQualityOf } from '../itemdetail/ItemDetailTable';
import {
    GEM_QUALITY_TABLE,
    GEM_TABLE,
    gemRewardOf,
    parseGemQualityRows,
    parseGemRows,
    type IGemTables,
} from './GemReward';
import { CARD_LEVEL_UP_TABLE, ITEM_TABLE, ROLE_PROPERTY_TABLE } from '../../core/config/TableNames';
import {
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
    /**
     * 品质覆盖（宝石必须靠它）：`item` / `roleProperty` 两张表里没有宝石，
     * 宝石的品质要么由服务端 `CmdGoods.quality` 给，要么按实例 id 末四位推。
     * 普通道具 / 货币不传，仍按表解析。
     */
    readonly quality?: number;
    /** 图标路径覆盖：宿主已经解析过（如「获得奖励」的 `IShowRewardEntry.iconPath`）就直通，省一次查表。 */
    readonly iconPath?: string;
    /** 概率（百分比，`70` ⇒ 70%）；`0` / 省略 = 不显示（只有宝箱详情用）。 */
    readonly ratePercent?: number;
    /**
     * 数量文案覆盖，用于「5~10」这类**区间**。
     *
     * 缺省 = 按 `amount` 显示整数（既有行为，不受影响）；配表给的是区间时传它，
     * 但 `amount` 仍要填一个代表值 —— 图标解析与条目排序都用它。
     */
    readonly amountText?: string;
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
    /**
     * 「品质填的是卡牌品阶」的道具（碎片 + 民兵/金矿），见 `ItemDetailTable.cardItemIdsOf`。
     *
     * 这批道具的 `item.quality` 是 1..4 的卡牌品阶，不是道具品质档（1..8），
     * 底框要先抬一档才是卡牌的真实颜色。
     */
    private static cardItemIds: ReadonlySet<number> = new Set<number>();
    /** `gem`（部位 resId）+ `gemQuality`（品质图标）：宝石奖励的图标与品质真源。 */
    private static gemTables: IGemTables = { gems: new Map(), qualities: new Map() };
    private static tablesLoading: Promise<void> | null = null;

    private readonly controller = new ComponentController('ui:reward-item');
    private readonly frameCache = new Map<string, Promise<SpriteFrame | null>>();
    /** 本格当前的 resId（异步加载回来时确认没被复用成别的物品）。 */
    private currentResId = 0;
    /** 本格当前的品质覆盖 + 图标覆盖（同上，异步回来时确认没被复用）。 */
    private currentQuality = 0;
    private currentIconPath = '';
    /** 本格当前是否是宝石（`resId` 是 gemId）：点击走宝石详情，不进物品详情。 */
    private currentIsGem = false;

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
        if (this.currentIsGem) {
            // 宝石的 resId 是实例 id（gemId）：物品详情两张表都查不到，会落到「未知物品」。
            EventMgr.instance.emit(REWARD_GEM_DETAIL_INTENT, { gemId: String(this.currentResId) });
            return;
        }
        EventMgr.instance.emit(REWARD_ITEM_DETAIL_INTENT, { resId: this.currentResId });
    }

    private static async loadTables(): Promise<void> {
        const [props, items, levelUp, gems, gemQualities] = await Promise.all([
            RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE).catch(() => null),
            RefUtil.instance.getRefAllAsync(ITEM_TABLE).catch(() => null),
            //  读不到就空集：底框退回道具品质口径（颜色可能低一档），但**不能**让奖励格整片不显示。
            RefUtil.instance.getRefAllAsync(CARD_LEVEL_UP_TABLE).catch(() => null),
            //  宝石同理：表缺只影响宝石格，不影响其它奖励。
            RefUtil.instance.getRefAllAsync(GEM_TABLE).catch(() => null),
            RefUtil.instance.getRefAllAsync(GEM_QUALITY_TABLE).catch(() => null),
        ]);
        RewardItemView.propRows = (props ?? []) as IResPropertyRow[];
        RewardItemView.itemRows = (items ?? []) as IItemRefRow[];
        RewardItemView.cardItemIds = cardItemIdsOf(levelUp as readonly { readonly costCardID?: unknown }[] | null);
        RewardItemView.gemTables = {
            gems: parseGemRows(gems as readonly unknown[] | null),
            qualities: parseGemQualityRows(gemQualities as readonly unknown[] | null),
        };
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
        this.currentQuality = Number(data.quality) > 0 ? Math.floor(Number(data.quality)) : 0;
        this.currentIconPath = data.iconPath ?? '';
        // 表已加载过的话先同步判一次，避免第一帧点击落在「还没 await 回来」的空档；
        // 首次加载完成前 `gemTables` 为空，`applyFrames` 会再按真实表值刷新这个标记。
        this.currentIsGem = gemRewardOf(data.resId, this.currentQuality, RewardItemView.gemTables) !== null;
        this.node.active = true;

        const amount = Math.floor(data.amount);
        this.num.string = data.amountText
            ?? (Number.isFinite(data.amount) && amount > 0 ? String(amount) : '');

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
        const qualityOverride = this.currentQuality;
        const iconOverride = this.currentIconPath;
        await (RewardItemView.tablesLoading ??= RewardItemView.loadTables());
        if (!this.isValid || this.resourceScope.disposed
            || this.currentResId !== resId) return;
        if (this.currentQuality !== qualityOverride) return;
        //  宝石不是道具：`resId` 是宝石实例 id（gemId），品质 / 图标走 `gem` + `gemQuality`。
        const gem = gemRewardOf(resId, qualityOverride, RewardItemView.gemTables);
        this.currentIsGem = gem !== null;
        const quality = gem ? gem.quality : RewardItemView.qualityOf(resId);
        //  卡牌道具（碎片 / 民兵 / 金矿）的品质是「卡牌品阶」，底框要抬一档才是卡牌本身的颜色（绿/蓝/紫/金）。
        const frameQuality = itemFrameQualityOf(quality, !gem && RewardItemView.cardItemIds.has(resId));
        const iconPath = gem?.iconPath || iconOverride
            || resBarIconSpritePath(resBarCellOfRefId(resId, RewardItemView.propRows, RewardItemView.itemRows));
        const [qualityFrame, iconFrame] = await Promise.all([
            this.loadFrame(itemQualityFrameRelPath(frameQuality)),
            this.loadFrame(iconPath),
        ]);
        // 加载期间格子可能已被复用成别的物品，以最后一次 render 为准。
        if (!this.isValid || this.resourceScope.disposed
            || this.currentResId !== resId) return;
        this.frame.spriteFrame = qualityFrame;
        this.icon.spriteFrame = iconFrame;
        this.icon.node.active = iconFrame !== null;
    }
}
