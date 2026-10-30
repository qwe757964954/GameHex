import { _decorator, Button, Color, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { FW } from '../../framework/FW';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { limitTimeActRepository } from './LimitTimeActRepository';
import type { ILimitTimeActRepository, LimitTimeRequestResult } from './LimitTimeActRepository';
import {
    goodsPhaseOf,
    goodsRemainOf,
    sortGoodsForDisplay,
    sortTasksForDisplay,
    taskPhaseOf,
    taskProgressText,
} from './LimitTimeActTable';
import type {
    ILimitTimeActSnapshot,
    ILimitTimeGoodsRow,
    ILimitTimeTaskRow,
} from './LimitTimeActTypes';
import { LimitTimeTab } from './LimitTimeActTypes';
import { LIMIT_TIME_TEXTS } from './LimitTimeActTexts';
import { LimitTimeActItem } from './LimitTimeActItem';

const { ccclass, property } = _decorator;
const TAB_LABEL_COLOR_ON = new Color(48, 38, 24, 255);
const TAB_LABEL_COLOR_OFF = new Color(255, 255, 255, 255);

/** 页签节点名 → tab id（prefab 既有节点名 = 真源）。 */
const TAB_NODES: ReadonlyArray<readonly [string, LimitTimeTab]> = [
    ['TabTask', LimitTimeTab.Task],
    ['TabDayGift', LimitTimeTab.DayGift],
    ['TabLimitBuy', LimitTimeTab.LimitBuy],
];

/**
 * 「限时活动」三页签弹窗（每日任务 / 每日礼包 / 限购）。
 *
 * 老端 `LayerLimitTimeAct`（`ui://限时活动/限时活动_元旦_主界面`）。Demo3.8 无 FGUI，
 * 版式照老端结构重排：顶部标题 + 倒计时 + 页签栏 + 页签描述 + 一条虚拟列表 + 关闭。
 *
 * 数据链路（与 `LayerActivityPage` 不同 —— 这套的**配置是服务端下发**的）：
 *   打开 → `refresh()` 拉 `reqActivityJson`（配置）+ `reqActivityLimitTimeInfo`（状态）
 *         → `load()` 组装快照 → 铺列表。
 *   领取 / 购买 → `reqActivityLimitTimeTake` → 用响应里的新状态原地覆盖 → 重铺。
 *
 * 三页签共用一条 `VirtualScrollView`：`renderItemFn` 按 `activeTab` 分支渲染任务行 / 礼包行。
 */
@ccclass('LimitTimeActPage')
export class LimitTimeActPage extends PopupBase {
    static prefabPath = 'ui/LimitTimeAct/LimitTimeAct';

    @property({ type: Label, tooltip: 'TitleLabel：标题（服务端 limitTimeConfig.title 下发，兜底「限时活动」）' })
    titleLabel: Label = null;

    @property({ type: Label, tooltip: 'TimeLabel：倒计时' })
    timeLabel: Label = null;

    @property({ type: Label, tooltip: 'DescLabel：页签描述' })
    descLabel: Label = null;

    @property({ type: VirtualScrollView, tooltip: 'List：三页签共用的虚拟列表' })
    list: VirtualScrollView = null;

    @property({ type: Button, tooltip: 'CloseBtn：关闭按钮' })
    closeBtn: Button = null;

    @property({ type: Label, tooltip: 'HintLabel：提示行（未开 / 离线 / 失败）' })
    hintLabel: Label = null;

    @property({ type: SpriteFrame, tooltip: '页签选中底板（主页同款 city/nav_sel）' })
    selectedTabFrame: SpriteFrame = null;

    /** 数据端口；测试可替换。 */
    private repo: ILimitTimeActRepository = limitTimeActRepository;

    private snapshot: ILimitTimeActSnapshot | null = null;
    private activeTab: LimitTimeTab = LimitTimeTab.Task;
    private busy = false;

    /** 当前页签的列表数据（`renderItemFn` 按 index 取）。 */
    private rows: readonly (ILimitTimeTaskRow | ILimitTimeGoodsRow)[] = [];
    /** `renderItemFn` 只需绑一次。 */
    private rendererBound = false;

    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private loadRevision = 0;

    protected onInit(): void {
        for (const [name, tab] of TAB_NODES) {
            const node = this.node.getChildByName(name);
            const button = node?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => this.onClickTab(tab), this);
        }
        this.closeBtn?.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.activeTab = LimitTimeTab.Task;
        this.renderTabSelection();
        this.setHint('');
        this.titleLabel.string = '限时活动';
        this.updateTime();
        // 倒计时每秒刷新一次（Cocos 的 schedule 随节点销毁自动清理）。
        this.schedule(this.updateTime, 1);
        await this.refreshAndPresent();
    }

    protected onClose(): void {
        this.unschedule(this.updateTime);
        this.snapshot = null;
        this.rows = [];
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: ILimitTimeActRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    /** 拉一次配置 + 数据，再组装渲染当前页签。 */
    private async refreshAndPresent(): Promise<void> {
        this.busy = true;
        const ok = await this.repo.refresh();
        if (!this.aliveCheck()) return;
        if (!ok) {
            this.busy = false;
            this.setHint(LIMIT_TIME_TEXTS.notOpen);
            return;
        }
        const snapshot = this.repo.load();
        if (!snapshot) {
            this.busy = false;
            this.setHint(LIMIT_TIME_TEXTS.notOpen);
            return;
        }
        this.snapshot = snapshot;
        this.titleLabel.string = snapshot.meta.title || '限时活动';
        this.busy = false;
        await this.presentTab();
    }

    /** 领奖 / 购买后的重铺：直接从当前快照（响应已覆盖进 repo）重取。 */
    private async reloadAndPresent(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = this.repo.load();
        if (!this.aliveCheck() || revision !== this.loadRevision) return;
        this.snapshot = snapshot;
        await this.presentTab();
    }

    /** 按当前页签渲染列表。 */
    private async presentTab(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const revision = ++this.loadRevision;

        if (this.activeTab === LimitTimeTab.Task) {
            this.rows = sortTasksForDisplay(snapshot.config.tasks, snapshot.data.tasks);
        } else {
            const states = this.activeTab === LimitTimeTab.DayGift ? snapshot.data.dayGifts : snapshot.data.limitBuys;
            const rows = this.activeTab === LimitTimeTab.DayGift ? snapshot.config.dayGifts : snapshot.config.limitBuys;
            this.rows = sortGoodsForDisplay(rows, states);
        }
        this.descLabel.string = this.tabDescOf(this.activeTab);

        if (!this.aliveCheck() || revision !== this.loadRevision) return;

        const list = this.list;
        if (!list) return;
        if (!this.rendererBound) {
            this.rendererBound = true;
            list.renderItemFn = (node, index) => this.renderItem(node, index);
            list.onItemClickFn = (node, index) => this.onItemClick(index);
        }
        list.refreshList(this.rows.length);
    }

    /** 渲染一行（任务 / 礼包分支）。 */
    private renderItem(node: Node, index: number): void {
        const row = this.rows[index];
        const item = node.getComponent(LimitTimeActItem);
        const snapshot = this.snapshot;
        if (!row || !item || !snapshot) return;

        if (this.activeTab === LimitTimeTab.Task) {
            const task = row as ILimitTimeTaskRow;
            item.renderTask({
                title: taskProgressText(task, snapshot.data.tasks),
                phase: taskPhaseOf(task, snapshot.data.tasks),
                rewards: [], // 奖励格图标后续补（数据链路优先）
            });
        } else {
            const goods = row as ILimitTimeGoodsRow;
            const states = this.activeTab === LimitTimeTab.DayGift ? snapshot.data.dayGifts : snapshot.data.limitBuys;
            const remain = goodsRemainOf(goods, states);
            const soldout = goodsPhaseOf(goods, states) === 'soldout';
            item.renderGoods({
                title: goods.title,
                priceText: String(goods.cost),
                limitText: LIMIT_TIME_TEXTS.limitSale.replace('{0}', String(remain)).replace('{1}', String(goods.count)),
                discountText: goods.discount > 0 ? LIMIT_TIME_TEXTS.discount.replace('{0}', String(goods.discount)) : '',
                soldout,
                rewards: [],
            });
        }
    }

    /** 点一行：任务 → 前往 / 领取；礼包 → 购买。 */
    private onItemClick(index: number): void {
        const snapshot = this.snapshot;
        const row = this.rows[index];
        if (!snapshot || !row || this.busy) return;

        if (this.activeTab === LimitTimeTab.Task) {
            void this.onTaskClick(row as ILimitTimeTaskRow, snapshot);
        } else {
            void this.onGoodsClick(row as ILimitTimeGoodsRow);
        }
    }

    private async onTaskClick(task: ILimitTimeTaskRow, snapshot: ILimitTimeActSnapshot): Promise<void> {
        const phase = taskPhaseOf(task, snapshot.data.tasks);
        if (phase === 'taken') return;
        if (phase === 'goto') {
            // 老端 `ModelTask.TaskGoto(targetType)` 跳对应系统；Demo3.8 跳转链路未接，先提示。
            FW.showTip(LIMIT_TIME_TEXTS.gotoMissing);
            return;
        }
        if (phase === 'claimable') {
            await this.doClaim(() => this.repo.claimTask(task.resId));
        }
    }

    private async onGoodsClick(goods: ILimitTimeGoodsRow): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const states = this.activeTab === LimitTimeTab.DayGift ? snapshot.data.dayGifts : snapshot.data.limitBuys;
        if (goodsPhaseOf(goods, states) === 'soldout') return;
        const type = this.activeTab === LimitTimeTab.DayGift ? 2 : 3;
        await this.doClaim(() => this.repo.buyGoods(type, goods.resId));
    }

    /** 领取 / 购买公共壳：发请求 → 按结果提示 + 重铺。 */
    private async doClaim(action: () => Promise<LimitTimeRequestResult>): Promise<void> {
        this.busy = true;
        const result = await action();
        this.busy = false;
        if (!this.aliveCheck()) return;
        if (result === 'offline') {
            this.setHint(LIMIT_TIME_TEXTS.offline);
            return;
        }
        if (result === 'failed') {
            this.setHint(LIMIT_TIME_TEXTS.failed);
            return;
        }
        this.setHint('');
        await this.reloadAndPresent();
    }

    // ============================================================
    // 页签 + 倒计时
    // ============================================================

    private onClickTab(tab: LimitTimeTab): void {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.renderTabSelection();
        void this.presentTab();
    }

    /** 页签只显示主页同款金色选中底板，未选中态保持透明。 */
    private renderTabSelection(): void {
        for (const [name, tab] of TAB_NODES) {
            const node = this.node.getChildByName(name);
            if (!node) continue;
            const selected = tab === this.activeTab;
            const background = node.getComponent(Sprite);
            if (background) background.spriteFrame = selected ? this.selectedTabFrame : null;
            for (const label of node.getComponentsInChildren(Label)) {
                label.color = selected ? TAB_LABEL_COLOR_ON : TAB_LABEL_COLOR_OFF;
            }
        }
    }

    private tabDescOf(tab: LimitTimeTab): string {
        if (tab === LimitTimeTab.DayGift) return LIMIT_TIME_TEXTS.tabDayGiftDesc;
        if (tab === LimitTimeTab.LimitBuy) return LIMIT_TIME_TEXTS.tabLimitBuyDesc;
        return LIMIT_TIME_TEXTS.tabTaskDesc;
    }

    /** 刷新倒计时文案。 */
    private updateTime = (): void => {
        const meta = this.snapshot?.meta;
        if (!meta || !this.timeLabel) return;
        const remain = Math.floor((meta.endTime - Date.now()) / 1000);
        if (remain <= 0) {
            this.timeLabel.string = LIMIT_TIME_TEXTS.actEnd;
            return;
        }
        this.timeLabel.string = LIMIT_TIME_TEXTS.remainTime.replace('{0}', formatHms(remain));
    };

    private setHint(text: string): void {
        if (this.hintLabel) this.hintLabel.string = text;
    }

    private aliveCheck(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }
}

/** 秒 → `HH:MM:SS`（老端 `timeSec2HMSStr2` 的口径）。 */
function formatHms(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
