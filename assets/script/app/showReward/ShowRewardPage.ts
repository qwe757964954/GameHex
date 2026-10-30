import { _decorator, Label, Node, tween, Vec3 } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { FW } from '../../framework/FW';
import { ItemDetailPage } from '../itemdetail/ItemDetailPage';
import { itemNumberTextOf } from '../itemdetail/ItemDetailTable';
import { ShowRewardGrid } from './ShowRewardGrid';
import { ShowRewardItem } from './ShowRewardItem';
import { SHOW_REWARD_TEXTS, showRewardSoundKey } from './ShowRewardTexts';
// 「CmdGoods → 帧」的换算与对局结算页**共用一份**（`RewardFrames`），别在这儿再抄一遍。
import { loadRewardFrames, loadRewardGoodsTables } from './RewardFrames';
import type { IRewardFrames } from './RewardFrames';
import {
    framesToSeconds,
    parseCmdGoodsList,
    rewardEntryOf,
    sortRewardEntries,
    staggerSecondsOf,
} from './ShowRewardTable';
import type { ICmdGoodsLike, IRewardEntry } from './ShowRewardTable';

const { ccclass, property } = _decorator;

/** 打开参数。 */
export interface IShowRewardParams {
    /** 奖励明细（CmdGoods[] 口径，number 为 uint64 可能是 Long）；空 / 全解析不出 ⇒ 直接关窗。 */
    readonly goods?: readonly unknown[];
    /** 铜钱 / 金币奖励 ⇒ 换音效（老端 isGold）。 */
    readonly isGold?: boolean;
}

/**
 * 「获得奖励」弹窗（老端 LayerShowReward）：底框 + 标题 + 4×3 网格 + 底部提示。
 * 奖励明细由调用方经 userData.goods 传入，本类不发请求，查 item / roleProperty 两张表换展示数据。
 * 空奖励直接关窗（老端 log+unload；空弹窗比不弹糟）。
 * 有意偏离：不做关闭时「奖励飞向背包」动画，本工程无该全局系统，待统一补。
 */
@ccclass('ShowRewardPage')
export class ShowRewardPage extends PopupBase {
    /**
     * 预制体 resources 路径；目录名须与磁盘一致（热更新 zip 大小写敏感，写错真机才 load 失败）。
     */
    static prefabPath = 'ui/ShowReward/ShowReward';

    @property({ type: Node, tooltip: 'PanelBg：弹窗底（FGUI n1，入场纵向弹入）' })
    panelBg: Node = null;

    @property({ type: Node, tooltip: 'TitleImage：标题图（FGUI n2，延迟 3 帧弹入）' })
    titleImage: Node = null;

    @property({ type: ShowRewardGrid, tooltip: 'RewardGrid：奖励网格（FGUI list，视口 468×330）' })
    grid: ShowRewardGrid = null;

    @property({ type: Node, tooltip: 'HintBg：底部提示条底（FGUI n10，延迟 4 帧显示）' })
    hintBg: Node = null;

    @property({ type: Label, tooltip: 'HintLabel：底部提示文案（FGUI n11）' })
    hintLabel: Label = null;

    /** 本次奖励（已排序）。 */
    private entries: IRewardEntry[] = [];
    /** 与 entries 同序的图。 */
    private frames: IRewardFrames[] = [];
    /** 是否铜钱奖励（决定音效）。 */
    private isGold = false;
    /** 每次取数 / 铺界面递增，用于丢弃过期异步结果。 */
    private loadRevision = 0;

    /** 已播过动画的数据下标：滚动复用槽位，不记账会重播；每次打开清空。 */
    private readonly playedAni = new Set<number>();

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        // Grid 回调只在这里绑一次，回调体按 dataIndex 现取 entries（捕获入参会永远显示第一屏）。
        if (this.grid) {
            this.grid.renderItem = (node: Node, dataIndex: number) => this.renderItem(node, dataIndex);
            this.grid.onItemClick = (dataIndex: number) => this.onItemClick(dataIndex);
        }
    }

    protected async onOpen(userData?: IShowRewardParams): Promise<void> {
        this.entries = [];
        this.frames = [];
        this.playedAni.clear();
        this.isGold = !!userData?.isGold;

        const goods = parseCmdGoodsList(userData?.goods);
        if (goods.length === 0) {
            // 没有奖励可展示 ⇒ 直接收掉，不留空弹窗。
            this.close(PopupCloseReason.Manual);
            return;
        }

        const revision = (this.loadRevision += 1);

        const entries = await this.resolveEntries(goods);
        if (!this.alive || revision !== this.loadRevision) return;
        // 排序在加载图之前：frames 与 entries 须同序。
        const sorted = sortRewardEntries(entries);

        // 图先 await 完再铺：renderItem 同步，现加载会闪一帧旧图，漏项还会静默留白。
        const frames = await loadRewardFrames(sorted);
        if (!this.alive || revision !== this.loadRevision) return;

        this.entries = sorted;
        this.frames = frames;
        this.present();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 作废在途 load（醒来时页面已关）。
        this.loadRevision += 1;
        this.entries = [];
        this.frames = [];
        this.playedAni.clear();
        this.isGold = false;
        // 不做「奖励飞向背包」收尾动画，见类注释。
    }

    // ============================================================
    // 取数
    // ============================================================

    /**
     * CmdGoods[] → 展示数据。item（道具）与 roleProperty（货币）两支都要读，
     * 漏一支货币格只剩品质框、无图标（静默降级）。
     */
    private async resolveEntries(goods: readonly ICmdGoodsLike[]): Promise<IRewardEntry[]> {
        const tables = await loadRewardGoodsTables();
        return goods.map((one) => rewardEntryOf(one, tables.items, tables.resources));
    }

    // ============================================================
    // 铺界面
    // ============================================================

    private present(): void {
        // 无条件写：实例会被复用。
        if (this.hintLabel) this.hintLabel.string = SHOW_REWARD_TEXTS.hint;

        // refreshList 内部 bindSlots ⇒ 逐格回调 renderItem。
        if (this.grid) this.grid.refreshList(this.entries.length);

        this.playEnterAnimation();

        // 音效（老端 init() 时播，不是 enter()）；未接线时静默丢弃。
        FW.playSound(showRewardSoundKey(this.isGold));
    }

    /**
     * 铺一格：render 铺数据；动画只播一次（playedAni 账本），已播过则直接摆到终态。
     */
    private renderItem(node: Node, dataIndex: number): void {
        const item = node.getComponent(ShowRewardItem);
        if (!item) return;
        item.dataIndex = dataIndex;

        const entry = this.entries[dataIndex];
        const frame = this.frames[dataIndex];
        if (!entry) {
            item.resetAppear();
            node.active = false;
            return;
        }

        // 参数无条件写，避免残留上一格品质颜色。
        item.render(
            frame?.qualityFrame ?? null,
            frame?.iconFrame ?? null,
            itemNumberTextOf(entry.number),
            entry.number > 0,
        );

        if (this.playedAni.has(dataIndex)) {
            // 已播过：摆到终态。
            item.stopAnim();
            item.node.setScale(1, 1, 1);
            return;
        }

        item.resetAppear();
        // 错峰 100×(index+1) ms（老端 toolSet.addDelay）；用 scheduleOnce，节点停 / 毁时会被取消。
        this.scheduleOnce(() => {
            if (!this.alive) return;
            // 错峰期间槽位可能已被复用 ⇒ 核身份。
            if (item.dataIndex !== dataIndex) return;
            if (this.playedAni.has(dataIndex)) return;
            this.playedAni.add(dataIndex);
            item.appear();
        }, staggerSecondsOf(dataIndex));
    }

    /** 点一格 ⇒ 弹物品详情（传 resId + number、allowMultiple）。 */
    private onItemClick(dataIndex: number): void {
        const entry = this.entries[dataIndex];
        if (!entry || !(entry.resId > 0)) return;
        void ItemDetailPage.open({
            userData: { resId: entry.resId, number: entry.number },
            allowMultiple: true,
        });
    }

    /**
     * 入场动画（FGUI t0，帧/60fps）：底框 0 帧 scale(1,0.3)、5 帧弹入；
     * 标题 3 帧、提示条 4 帧出现。
     * 引擎坑：inactive 节点首次起 tween 会被 ActionManager 永久 paused，而激活动作写在
     * 同一 tween 的 call 里 ⇒ 死锁。正解：延迟用 scheduleOnce，先 active=true 再起 tween。
     */
    private playEnterAnimation(): void {
        if (this.panelBg) {
            this.panelBg.setScale(1, 0.3, 1);
            tween(this.panelBg)
                .to(framesToSeconds(5), { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
                .start();
        }

        // 隐藏 + 延迟不能写成同一 tween 的 delay+call（见上方引擎坑）；scheduleOnce 到点先激活再起 tween。
        if (this.titleImage) {
            this.titleImage.active = false;
            this.titleImage.setScale(1, 0.46, 1);
            this.scheduleOnce(() => {
                if (!this.alive || !this.titleImage) return;
                this.titleImage.active = true;
                tween(this.titleImage)
                    .to(framesToSeconds(5), { scale: new Vec3(1, 1, 1) }, { easing: 'quadOut' })
                    .start();
            }, framesToSeconds(3));
        }

        // n10 / n11 在 time=4 仅显示（无缩放），同样用 scheduleOnce。
        const late = [this.hintBg, this.hintLabel?.node ?? null];
        for (const node of late) {
            if (!node) continue;
            node.active = false;
            this.scheduleOnce(() => {
                if (this.alive && node.isValid) node.active = true;
            }, framesToSeconds(4));
        }
    }

    // ============================================================
    // 只读状态（探针 / 单测用）
    // ============================================================

    /** 本次奖励条数。 */
    get rewardCount(): number {
        return this.entries.length;
    }

    /** 本次是否铜钱奖励。 */
    get goldReward(): boolean {
        return this.isGold;
    }

    /** 已播动画的奖励位个数（探针验「只播一次」）。 */
    get playedAnimationCount(): number {
        return this.playedAni.size;
    }

    /** 第 index 条奖励（探针核品质 / 图标）。 */
    entryAt(index: number): IRewardEntry | null {
        return this.entries[index] ?? null;
    }

    private get alive(): boolean {
        return this.isPopupOpen && !!this.node && this.node.isValid;
    }
}
