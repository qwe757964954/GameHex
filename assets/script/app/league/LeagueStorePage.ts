/**
 * 「联盟商店」弹窗（老端 `play/LayerLeagueStore`，`ui/League/LeagueStore`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/商店/组件_联盟_商店.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「联盟商店」） | (44,173) **640×820** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `list`（`overflow=scroll`、`lineGap=10`、9 项） | (80,226) **550×715** | `StoreListView`（虚拟列表） |
 * | `defaultItem` = `组件_联盟_商店Item`（556×142） | — | `StoreListView/content/StoreRow` |
 *
 * `popBg` 那组的 relation 是 `center-center,middle-middle` ⇒ 弹窗**恒居中**
 * （FGUI 的 xy 是设计态坐标；本端照抄 `LeagueApplyList` 的「popBg 半高 = 353，标题骨架按
 * 距顶边常数 12.5 / 10 / 10 折算」口径）。底板图见 `LeagueArt.LEAGUE_ART_POPUP_BOARD`。
 *
 * ⚠️ 列表视口 **550**、行 **556** —— FGUI 原稿就是差 6px（行比视口宽）。
 *    本端照抄：`VScrollView` 的槽位在 content 里居中，左右各被 Mask 裁掉 3px，
 *    落在行底框 `frame_Zhikuang01` 的九宫格边框里（左 38 / 右 76），肉眼不可辨。
 *    （不把行改成 550：那会让行内所有子节点的坐标跟着挪位，与 FGUI 对不上账。）
 *
 * ## 老端行为（`LayerLeagueStoreUI`）与移植取舍
 *
 * 1. **数据靠推送刷新**：老端 `init()` 挂 `VOShopBag` 的 `OnChanged → updateView`，
 *    自己**不发**列表请求。本端 `CacheMgr` 只读取值、不发变更事件 ⇒
 *    `onOpen` 主动读一次缓存（`loadStore`），**买成功后自己再读一次**（见 `afterWrite`）。
 * 2. **购买的三支分支**（老端 click 里）：
 *    ```
 *    buyTimes < ref.limit ? (CheckHaveEnoughCostAndOpenAlert([cost]) ? requestBuy : 无)
 *                         : showTip("SOLD_OUT")
 *    ```
 *    ⇒ 本端在 `onBuy` 里按 `view.soldOut` / `view.enough` 分三支；提示文案分别取
 *    `LEAGUE_STORE_SOLD_OUT`（「已售罄」）与 `{货币名}不足`（`ModelGoods_1`）。
 *    ⚠️ **不是**靠按钮 `interactable = false` 挡 —— FGUI 的 `grayed` 点得动，
 *    老端靠 click 内的分支做反馈；见 `LeagueStoreRow` 的类头。
 * 3. **不加二次确认**：老端商店是直接 `requestBuy`（只有砍价 / 捐献才 `PanelDialog`）。
 * 4. **`StoreType.League = 8`**：`CmdShopBuyReqMsg.cmdShopType`，见 `LEAGUE_SHOP_TYPE_UNION`。
 *
 * ## 本端有意增补
 *
 * - `busy` 防连点（老端没有）：`buyStoreGoods` 是写请求、走 5s 超时，连点会重复发包
 *   （同 `LeagueApplyListPage.beginWrite()`；与 P3 那段「`creating` 守卫被 `await` 穿透」的教训同源）。
 * - 奖励图标**先取完再刷列表**（`loadLeagueRewardArt`），否则虚拟列表槽位复用会闪上一行的图。
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
import { LeagueStoreRow } from './LeagueStoreRow';
import { type ILeagueStoreRowView } from './LeagueTable';
import {
    fillLeagueText,
    LEAGUE_STORE_SOLD_OUT,
    LEAGUE_STORE_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueStorePage')
export class LeagueStorePage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueStore';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'StoreListView：商品列表（虚拟列表 + Mask）' })
    storeList: VirtualScrollView = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueStoreRowView[] = [];

    /** 本趟的奖励图帧（品质框 + 图标），`present()` 之前一定已就绪。 */
    private art: ILeagueRewardArt | null = null;

    /** 本趟快照（`onBuy` 要拿货币名拼「不足」提示）。 */
    private snapshot: ILeagueStoreSnapshot | null = null;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const button = this.closeButton?.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueStore] CloseBtn 上没有 cc.Button，点击不会生效');

        if (this.storeList) this.storeList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数
    // ============================================================

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
     * ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     *    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const snapshot = await this.repository.loadStore();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.rows = snapshot.rows.slice();
        this.art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

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
        if (this.storeList) {
            this.storeList.refreshList(this.rows);
            this.storeList.scrollToTop(false);
        }
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueStoreRow);
        if (!row) return;
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

    // ============================================================
    // 购买
    // ============================================================

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
        try {
            const result = await this.repository.buyStoreGoods(view.id, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
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

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 杂项
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
