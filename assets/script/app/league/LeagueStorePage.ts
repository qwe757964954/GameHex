import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueRewardEvent, type ILeagueRewardIntent, type ILeagueRewardCompletion } from './LeagueRewardEvents';
/**
 * 联盟商店弹窗。打开读缓存，购买成功后重读；售罄和货币不足在点击分支提示。
 * 列表行宽 556 与视口 550 的 6px 差是 FGUI 原稿，不要改行宽。
 * 有意增补：busy 防连点，避免写请求在 5s 超时内重复发包。
 */

import { _decorator, Button, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import {
    leagueRepository,
    type ILeagueRepository,
    type ILeagueStoreSnapshot,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { settleLeagueWrite } from './LeagueWriteFlow';
import { LeagueStoreRow } from './LeagueStoreRow';
import { type ILeagueStoreRowView } from './LeagueTable';
import {
    fillLeagueText,
    LEAGUE_STORE_SOLD_OUT,
    LEAGUE_STORE_TITLE,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueStorePage')
export class LeagueStorePage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueStore';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'StoreListView：商品列表（虚拟列表 + Mask）' })
    storeList: VirtualScrollView = null!;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueStoreRowView[] = [];

    /** 本趟的奖励图帧（品质框 + 图标），`present()` 之前一定已就绪。 */
    private art: ILeagueRewardArt | null = null;

    /** 本趟快照（`onBuy` 要拿货币名拼「不足」提示）。 */
    private snapshot: ILeagueStoreSnapshot | null = null;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 取数趟次；同一打开期内「首轮取数」与「写后刷新」可能重叠，只认最后一趟。 */
    private revision = 0;

    // 生命周期

    protected onInit(): void {
        EventMgr.instance.on(LeagueRewardEvent.Completed, this.onRewardCompleted, this);
        const button = this.closeButton.getComponent(Button);
        button.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        this.storeList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.busy = false;
    }

    onDestroy(): void {
        EventMgr.instance.offTarget(this);
        super.onDestroy();
    }

    // 取数

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_STORE_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 读一次商店（缓存 + 表），再把本趟要用到的图全取好，最后铺行。
     *
     * `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     * ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repository.loadStore();
        if (!this.alive || revision !== this.revision) return;

        const art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.rows = snapshot.rows.slice();
        this.art = art;
        this.present();
    }

    /**
     * 预取本趟所有要用到的图：奖励图标（`rewardResId`）+ 按钮货币图标（`priceType`）。
     *
     * 品质框由 `loadLeagueRewardArt` 内部固定取 4 张。
     */
    private async loadArtFrames(snapshot: ILeagueStoreSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>();
        for (const row of snapshot.rows) {
            resIds.add(row.rewardResId);
            resIds.add(row.priceType);
        }
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    private present(): void {
        this.storeList.refreshList(this.rows);
        this.storeList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueStoreRow);
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        const art = this.art;
        const reward = art ? art.framesOf(view.rewardResId) : { frame: null, icon: null };
        row.render(view, reward.frame, reward.icon, art ? art.iconFrameOf(view.priceType) : null);
        // 行自己的按钮回调：读取「点击那一刻」这一槽位上的数据（槽位复用到哪行就是哪行）
        row.onBuy = (current) => void this.buy(current);
    }

    // 购买

    /**
     * 点「购买」—— 老端 click 的三支分支（见类头）。
     *
     * 1. 卖完 ⇒ `LEAGUE_STORE_SOLD_OUT`（「已售罄」），**不发包**；
     * 2. 钱不够 ⇒ `{货币名}不足`，**不发包**；
     * 3. 都 OK ⇒ `buyStoreGoods(id)`，成功后重读一次缓存。
     */
    private async buy(view: ILeagueStoreRowView): Promise<void> {
        if (view.soldOut) {
            FW.showTip(LEAGUE_STORE_SOLD_OUT);
            return;
        }
        if (!view.enough) {
            FW.showTip(this.notEnoughTip(view.priceType));
            return;
        }
        if (!this.beginWrite()) return;
        EventMgr.instance.emit(LeagueRewardEvent.Intent, { action: { kind: 'store', id: view.id } } satisfies ILeagueRewardIntent, this);
    }

    /**
     * 「{货币名}不足」—— 货币名取 `roleProperty` 表的 `name`（老端 `GetGoodsNameByRefId`）。
     *
     * 查不到（表还没下来）时退回空串，拼出来是「不足」两个字 —— 不静默、也不编一个假名字。
     */
    private notEnoughTip(priceType: number): string {
        const info = this.snapshot?.resources.get(priceType);
        return fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, info?.name ?? '');
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    private readonly onRewardCompleted = async (event: ILeagueRewardCompletion, source: object): Promise<void> => {
        if (source !== this) return;
        try {
            await this.afterWrite(event.status);
        } finally {
            this.busy = false;
        }
    };

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        await settleLeagueWrite(result, this.alive, () => this.reload());
    }

    // 杂项

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}
