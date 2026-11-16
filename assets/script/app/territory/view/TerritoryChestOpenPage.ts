/**
 * 「领地宝箱开启」奖励页（蓝湖设计稿 720×1610 → 全屏弹窗）。
 *
 * ## 与既有链路的关系
 *
 * 领地宝箱开箱走 `MainTerritoryMap.presentRewards → playChestThenSettle`：先在**地图里**
 * 播既有那套三档开箱表演（`chest_seq_0..5`），播完才弹这一页。所以本页是**开箱后的奖励展示页**，
 * 不替换世界内表演、也不动银币宝箱（`coinBox`）/ 随机格喷发 / 挂机征收那三条路。
 *
 * ## 展示口径
 *
 *  · **整箱全部奖励**（含银币 / 体力）都由这一页承载 —— 设计稿的卡本身就画了 `+4095` / `+3`，
 *    再走一次 `FW.ShowReward` 会二次弹窗；
 *  · 卡序沿用 `sortRewardEntries`（品质降序、同品质 resId 升序），与设计稿的橙→紫→绿→蓝→蓝一致；
 *  · 数量文案分两类：道具 `X1`、货币 `+N`（判据是 `roleProperty` 表里查得到、且 `item` 表里查不到）。
 *
 * ## 层级 / 显示动画
 *
 *  · `PopupLayer.NORMAL` + `closeOnBlank`：挂到 Canvas 下的 `Popup` 节点（`Root.scene` 里
 *    Camera → Procedure → Popup，弹窗层在最上），不额外插系统层；
 *  · 入场：底图淡入 → 宝箱 backOut 弹入 → 卡片逐张错峰 → 「跳过」淡入后**常驻**
 *    （设计稿静止态就有「跳过>>」）。静止态与设计稿像素一致。
 *  · 「跳过」只跳**入场动画**（不是跳过关卡）：入场期间点它直接落到静止态；已经静止后
 *    再点等同关闭本页。点空白同理（`canCloseOnBlank` 在入场期间先收尾动画，不直接关窗）。
 */
import {
    _decorator,
    Button,
    instantiate,
    Label,
    Node,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
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
    CHEST_OPEN_GRID_W,
    chestOpenBgProgressOf,
    chestOpenCardSlotOf,
    chestOpenCardVisualOf,
    chestOpenChestVisualOf,
    chestOpenCountTextOf,
    chestOpenGridHeightOf,
    chestOpenGridScaleOf,
    chestOpenRevealDoneSecondsOf,
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

    @property({ type: Node, tooltip: '卡片容器（锚点 0.5/1，Widget 顶对齐 432）' })
    cardsRoot: Node = null!;

    @property({ type: Node, tooltip: '卡片模板（保持 inactive，运行时 instantiate）' })
    cardTemplate: Node = null!;

    @property({ type: Node, tooltip: '开启态宝箱（Widget 底对齐 199、hCenter -6.5）' })
    chestNode: Node = null!;

    @property({ type: UIOpacity, tooltip: '宝箱透明度（入场弹入）' })
    chestOpacity: UIOpacity = null!;

    @property({ type: Button, tooltip: '左上「跳过>>」（NONE，target=null）' })
    skipButton: Button = null!;

    @property({ type: UIOpacity, tooltip: '「跳过」透明度（入场结束后淡出）' })
    skipOpacity: UIOpacity = null!;

    @property({ type: Button, tooltip: '底部「点击关闭」（NONE，target=null）' })
    closeButton: Button = null!;

    @property({ type: Label, tooltip: '跳过文案（运营改字改这里；缺省取 TerritoryTexts）' })
    skipLabel: Label = null!;

    @property({ type: Label, tooltip: '关闭文案（运营改字改这里；缺省取 TerritoryTexts）' })
    closeLabel: Label = null!;

    /** 本次铺出来的卡（克隆体），关闭时统一销毁。 */
    private readonly _cards: TerritoryChestOpenCard[] = [];
    /** 入场时钟（`startedAt` 口径：只累加，不回读节点状态）。 */
    private _revealElapsed = 0;
    private _revealPlaying = false;
    private _revealDone = false;

    protected onInit(): void {
        this.skipLabel.string = TERRITORY_TEXTS.chestOpenSkip;
        this.closeLabel.string = TERRITORY_TEXTS.chestOpenClose;
        this.cardTemplate.active = false;
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
     * ⚠️ 不在这里加载资源 / 查表 / 建节点：入场只有 0.6~0.8 秒，每帧 new 数组或查全局配置
     *    都会把这段动画拖成掉帧（见 `docs` 的 render 幂等与 update 纪律）。
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
        const total = entries.length;
        const rootUi = this.node.getComponent(UITransform);
        const gridUi = this.cardsRoot.getComponent(UITransform);
        gridUi.setContentSize(CHEST_OPEN_GRID_W, chestOpenGridHeightOf(total));
        const scale = chestOpenGridScaleOf(total, rootUi.height);
        this.cardsRoot.setScale(scale, scale, 1);

        for (let index = 0; index < total; index++) {
            const node = instantiate(this.cardTemplate);
            node.active = true;
            this.cardsRoot.addChild(node);
            const card = node.getComponent(TerritoryChestOpenCard);
            const entry = entries[index];
            const slot = chestOpenCardSlotOf(index, total);
            card.place(slot.x, slot.y);
            card.render(
                frames.get(chestOpenCardFrameNameOf(entry.quality)) ?? null,
                icons[index],
                chestOpenCountTextOf(entry.number, chestOpenIsCurrency(tables, entry.resId)),
            );
            this._cards.push(card);
        }

        // 模板永远保持 inactive：它是「蓝图」，铺完就藏起来（否则编辑器/预览里会多一张空卡）。
        this.cardTemplate.active = false;
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
        for (const card of this._cards) {
            card.node.removeFromParent();
            card.node.destroy();
        }
        this._cards.length = 0;
        this.cardTemplate.active = false;
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
