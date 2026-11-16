/**
 * 领地宝箱开启奖励页（设计稿 720×1610，全屏弹窗）。
 *
 * 由 MainTerritoryMap.presentChestRewards 进入，承载整箱全部奖励，
 * 卡序沿用 sortRewardEntries，货币显示 +N、道具显示 X1。
 * 页面挂在 Popup 普通层，入场为底图淡入、宝箱弹入、卡片错峰，跳过只收尾入场动画。
 */
import {
    _decorator,
    Button,
    CCFloat,
    CCInteger,
    instantiate,
    Label,
    Layout,
    Node,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Widget,
} from 'cc';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import { PopupBase } from '../../../framework/ui/PopupBase';
import type { PopupOpenContext } from '../../../framework/ui/PopupBase';
import { spriteFramePathOf } from '../../ArtPaths';
import { loadRewardGoodsTables } from '../../showReward/RewardFrames';
import type { IRewardGoodsTables } from '../../showReward/RewardFrames';
import { parseCmdGoodsList, rewardEntryOf, sortRewardEntries } from '../../showReward/ShowRewardTable';
import type { IRewardEntry } from '../../showReward/ShowRewardTable';
import { TERRITORY_TEXTS } from '../application/TerritoryTexts';
import {
    chestOpenBgProgressOf,
    chestOpenCardVisualOf,
    chestOpenChestVisualOf,
    chestOpenCountTextOf,
    chestOpenGridScaleOf,
    chestOpenRevealDoneSecondsOf,
    chestOpenRowsOf,
    chestOpenSkipAlphaOf,
} from '../model/TerritoryChestOpenLayout';
import { TerritoryChestOpenCard } from './TerritoryChestOpenCard';
import { chestOpenArtPathOf, chestOpenCardFrameNameOf } from './TerritoryChestOpenArt';

const { ccclass, property } = _decorator;

/** 打开参数：`{ goods: [{resId, number}] }`（与 `CmdGoods` 同形，`parseCmdGoodsList` 会归一化）。 */
export interface ITerritoryChestOpenUserData {
    readonly goods?: readonly unknown[];
}

@ccclass('TerritoryChestOpenPage')
export class TerritoryChestOpenPage extends PopupBase {
    static prefabPath = 'ui/territory/TerritoryChestOpen';

    @property({ type: UIOpacity, tooltip: '全屏底图（入场淡入）' })
    bgOpacity: UIOpacity = null!;

    @property({ type: Node, tooltip: '卡片容器（锚点 0.5/1，Widget 定边距，Layout 纵向排列）' })
    cardsRoot: Node = null!;

    @property({ type: Node, tooltip: '卡片行模板（保持 inactive；横向 Layout 排卡片）' })
    rowTemplate: Node = null!;

    @property({ type: Node, tooltip: '卡片模板（保持 inactive，运行时 instantiate）' })
    cardTemplate: Node = null!;

    @property({ type: CCInteger, tooltip: '每行卡数（prefab 栅格列数）' })
    gridColumns = 0;

    @property({ type: CCFloat, tooltip: '卡片区缩放下限（prefab 配置，避免继续压到宝箱）' })
    gridMinScale = 0;

    @property({ type: CCFloat, tooltip: '卡片区底与宝箱顶的留白（prefab 配置）' })
    gridBottomGap = 0;

    @property({ type: Node, tooltip: '开启态宝箱（Widget 贴底对齐）' })
    chestNode: Node = null!;

    @property({ type: UIOpacity, tooltip: '宝箱透明度（入场弹入）' })
    chestOpacity: UIOpacity = null!;

    @property({ type: Button, tooltip: '左上「跳过>>」（NONE，target=null）' })
    skipButton: Button = null!;

    @property({ type: UIOpacity, tooltip: '「跳过」透明度（入场淡入后常驻）' })
    skipOpacity: UIOpacity = null!;

    @property({ type: Button, tooltip: '底部「点击关闭」（NONE，target=null）' })
    closeButton: Button = null!;

    @property({ type: Label, tooltip: '跳过文案（运营改字改这里；缺省取 TerritoryTexts）' })
    skipLabel: Label = null!;

    @property({ type: Label, tooltip: '关闭文案（运营改字改这里；缺省取 TerritoryTexts）' })
    closeLabel: Label = null!;

    /** 本次铺出来的卡（克隆体），关闭时统一销毁。 */
    private readonly _cards: TerritoryChestOpenCard[] = [];
    /** 本次铺出来的行（克隆体），销毁行时连带销毁卡。 */
    private readonly _rows: Node[] = [];
    /** 入场时钟（`startedAt` 口径：只累加，不回读节点状态）。 */
    private _revealElapsed = 0;
    private _revealPlaying = false;
    private _revealDone = false;

    protected onInit(): void {
        this.skipLabel.string = TERRITORY_TEXTS.chestOpenSkip;
        this.closeLabel.string = TERRITORY_TEXTS.chestOpenClose;
        this.cardTemplate.active = false;
        this.rowTemplate.active = false;
        this.skipButton.node.on(Button.EventType.CLICK, this.onSkipClick, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
    }

    protected async onOpen(userData?: any, context?: PopupOpenContext): Promise<void> {
        this.clearCards();
        this.resetRevealState();

        const goods = parseCmdGoodsList((userData as ITerritoryChestOpenUserData | undefined)?.goods);
        if (!goods.length) {
            this.close();
            return;
        }

        const tables = await loadRewardGoodsTables(this.configs);
        if (!context || context.cancelled) return;
        const entries = sortRewardEntries(goods.map((one) => rewardEntryOf(one, tables.items, tables.resources)));
        const frames = await this.loadCardFrames(entries);
        const icons = await Promise.all(entries.map((entry) => this.loadIcon(entry)));
        if (!context || context.cancelled) return;
        // 等一帧让根节点的 cc.Widget 生效，卡片区缩放兜底要用到真实屏高。
        if (!(await this.nextPopupFrame())) return;

        this.presentCards(entries, icons, frames, tables);
        this.startReveal();
    }

    protected onClose(): void {
        this._revealPlaying = false;
        this._revealDone = true;
        this.clearCards();
    }

    /** 入场期间点空白 = 跳过动画（而不是把窗关掉）；入场结束后才允许关。 */
    protected canCloseOnBlank(): boolean {
        if (!this._revealDone) {
            this.finishReveal();
            return false;
        }
        return true;
    }

    /**
     * 只写节点、不做业务。
     *
     * 不在这里加载资源 / 查表 / 建节点：入场只有 0.6~0.8 秒，每帧 new 数组或查全局配置
     * 都会把这段动画拖成掉帧（见 `docs` 的 render 幂等与 update 纪律）。
     */
    protected update(dt: number): void {
        if (!this._revealPlaying || this.isCovered) return;
        this._revealElapsed += dt;
        this.applyReveal();
        if (this._revealElapsed >= chestOpenRevealDoneSecondsOf(this._cards.length)) this.finishReveal();
    }

    // ============================================================
    // 数据 → 卡片
    // ============================================================

    /** 品质卡框按品质去重后各加载一次（4 档最多 4 次）。 */
    private async loadCardFrames(entries: readonly IRewardEntry[]): Promise<Map<string, SpriteFrame | null>> {
        const names = new Set<string>();
        for (const entry of entries) names.add(chestOpenCardFrameNameOf(entry.quality));
        const frames = new Map<string, SpriteFrame | null>();
        await Promise.all(Array.from(names, async (name) => {
            const path = chestOpenArtPathOf(name);
            frames.set(name, await this.loadFrame(path));
        }));
        return frames;
    }

    private loadFrame(path: string): Promise<SpriteFrame | null> {
        return this.assets.load(path, SpriteFrame)
            .catch((error: unknown) => {
                console.warn('[TerritoryChestOpenPage] 卡框加载失败：' + path, error);
                return null;
            });
    }

    private loadIcon(entry: IRewardEntry): Promise<SpriteFrame | null> {
        const path = entry.iconPath;
        if (!path) return Promise.resolve(null);
        return this.assets.load(spriteFramePathOf(path), SpriteFrame, { bundle: bundleForPath(path) })
            .catch((error: unknown) => {
                console.warn('[TerritoryChestOpenPage] 奖励图标加载失败：' + path, error);
                return null;
            });
    }

    private presentCards(
        entries: readonly IRewardEntry[],
        icons: readonly (SpriteFrame | null)[],
        frames: ReadonlyMap<string, SpriteFrame | null>,
        tables: IRewardGoodsTables,
    ): void {
        const columns = Math.max(1, this.gridColumns);
        const rows = chestOpenRowsOf(entries.length, columns);
        const gridUi = this.cardsRoot.getComponent(UITransform);
        const cardsLayout = this.cardsRoot.getComponent(Layout);
        this.cardsRoot.setScale(1, 1, 1);

        for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
            const row = instantiate(this.rowTemplate);
            row.active = true;
            this.cardsRoot.addChild(row);
            this._rows.push(row);

            const rowStart = rowIndex * columns;
            const rowEnd = Math.min(entries.length, rowStart + columns);
            for (let index = rowStart; index < rowEnd; index++) {
                const node = instantiate(this.cardTemplate);
                node.active = true;
                row.addChild(node);
                const card = node.getComponent(TerritoryChestOpenCard);
                const entry = entries[index];
                card.render(
                    frames.get(chestOpenCardFrameNameOf(entry.quality)) ?? null,
                    icons[index],
                    chestOpenCountTextOf(entry.number, chestOpenIsCurrency(tables, entry.resId)),
                );
                this._cards.push(card);
            }

            // 行内卡片数决定本行宽度：横向 Layout 会按子节点重排，并让不足一行的卡居中。
            row.getComponent(Layout).updateLayout();
        }

        // 行数决定卡片区高度：纵向 Layout 会按行节点重排。
        cardsLayout.updateLayout();

        // Layout 排完再取动画基准：节点位置是 prefab 的最终位置，运行时只叠加临时偏移。
        for (const card of this._cards) card.captureBase();

        // 短屏兜底：可用高度来自 prefab 的 Widget 边距与宝箱尺寸，不再写死 432/199/277。
        const rootUi = this.node.getComponent(UITransform);
        const minScale = this.gridMinScale > 0 ? this.gridMinScale : 1;
        const scale = chestOpenGridScaleOf(gridUi.height, this.availableGridHeight(rootUi.height), minScale);
        this.cardsRoot.setScale(scale, scale, 1);

        // 模板永远保持 inactive：它是「蓝图」，铺完就藏起来（否则编辑器/预览里会多一张空卡）。
        this.cardTemplate.active = false;
        this.rowTemplate.active = false;
    }

    /** 卡片区底到宝箱顶之间可用于排卡的高度（全部来自 prefab 的 Widget/尺寸）。 */
    private availableGridHeight(rootHeight: number): number {
        const cardsWidget = this.cardsRoot.getComponent(Widget);
        const chestWidget = this.chestNode.getComponent(Widget);
        const chestUi = this.chestNode.getComponent(UITransform);
        return rootHeight - cardsWidget.top - chestWidget.bottom - chestUi.height - this.gridBottomGap;
    }

    // ============================================================
    // 入场动画
    // ============================================================

    private resetRevealState(): void {
        this._revealElapsed = 0;
        this._revealPlaying = false;
        this._revealDone = false;
        this.bgOpacity.opacity = 0;
        this.chestNode.active = false;
        this.chestOpacity.opacity = 0;
        this.skipOpacity.opacity = 0;
        this.skipButton.node.active = false;
        this.closeButton.node.active = false;
    }

    private startReveal(): void {
        this.chestNode.active = true;
        this.skipButton.node.active = true;
        this.closeButton.node.active = true;
        this._revealElapsed = 0;
        this._revealDone = false;
        this._revealPlaying = true;
        this.applyReveal();
    }

    /** 按当前时钟把所有节点写到对应状态（幂等；`elapsed = 0` 也走这里，避免闪一帧静止态）。 */
    private applyReveal(): void {
        const elapsed = this._revealElapsed;
        this.bgOpacity.opacity = Math.round(255 * chestOpenBgProgressOf(elapsed));

        const chest = chestOpenChestVisualOf(elapsed);
        this.chestNode.setScale(chest.scale, chest.scale, 1);
        this.chestOpacity.opacity = chest.opacity;

        for (let index = 0; index < this._cards.length; index++) {
            this._cards[index].applyReveal(chestOpenCardVisualOf(elapsed, index));
        }

        this.skipOpacity.opacity = Math.round(255 * chestOpenSkipAlphaOf(elapsed));
    }

    /** 收起动画并落到设计稿静止态（跳过 / 点空白都走这里）。「跳过」保持可见。 */
    private finishReveal(): void {
        if (this._revealDone) return;
        this._revealDone = true;
        this._revealPlaying = false;
        this._revealElapsed = chestOpenRevealDoneSecondsOf(this._cards.length);
        this.bgOpacity.opacity = 255;
        this.chestNode.setScale(1, 1, 1);
        this.chestOpacity.opacity = 255;
        for (const card of this._cards) card.settle();
        this.skipButton.node.active = true;
        this.skipOpacity.opacity = 255;
    }

    /** 入场期间 = 直接落静止态；已静止 = 等同于关闭（按钮不留死状态）。 */
    private onSkipClick(): void {
        if (this._revealDone) {
            this.closeByButton();
            return;
        }
        this.finishReveal();
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private clearCards(): void {
        for (const row of this._rows) {
            row.removeFromParent();
            row.destroy();
        }
        this._rows.length = 0;
        this._cards.length = 0;
        this.cardsRoot.setScale(1, 1, 1);
        this.cardTemplate.active = false;
        this.rowTemplate.active = false;
    }
}

/**
 * 这条奖励是不是「货币」——决定数量写 `+N` 还是 `XN`。
 *
 * `roleProperty`（resId 1~17）与 `item`（resId 10xxx）id 段不重叠，所以「货币表查得到、
 * 道具表查不到」就足够；两边都命中时按 `item`（`rewardEntryOf` 也是 item 优先）。
 */
function chestOpenIsCurrency(
    tables: IRewardGoodsTables,
    resId: number,
): boolean {
    return tables.resources.has(resId) && !tables.items.has(resId);
}
