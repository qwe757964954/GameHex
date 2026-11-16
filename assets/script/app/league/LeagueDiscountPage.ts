import { EventMgr } from '../../framework/event/EventMgr';
import { LeagueRewardEvent, type ILeagueRewardIntent, type ILeagueRewardCompletion } from './LeagueRewardEvents';
/**
 * 每日砍价弹窗。没有 `popBg`、也没有关闭按钮，整屏内容点空白关闭。
 * 有意偏离老端：砍价和购买共用状态三页显隐；打开时串行拉活动列表和联盟详情。
 */

import { _decorator, Button, Color, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import { FW } from '../../framework/FW';
import { CommonTips } from '../common/CommonTips';
import { RedDot } from '../common/RedDot';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { LEAGUE_ART_BARGAIN_STRIKE_COLOR, LEAGUE_TINT_GRAY, LEAGUE_TINT_NORMAL } from './LeagueArt';
import { LeagueDiscountRow } from './LeagueDiscountRow';
import {
    leagueRepository,
    LeagueACT_TYPE,
    type ILeagueDiscountSnapshot,
    type ILeagueRepository,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import {
    formatLeagueCountdown,
    LEAGUE_COIN_RES_ID,
    LEAGUE_DISCOUNT_RESET_DAY_SECONDS,
    type ILeagueDiscountRowView,
    type ILeagueDiscountView,
    type ILeagueReward,
} from './LeagueTable';
import {
    fillLeagueText,
    LEAGUE_DISCOUNT_TIME_TEMPLATE,
    LEAGUE_TIP_BUY_TIMES_LIMIT,
    LEAGUE_TIP_DISCOUNT_DONE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_DISCOUNT_BUY_CONFIRM,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/**
 * `状态` controller 的三页下标（FGUI `pages="0,砍价,1,购买,2,已购买"`）。
 *
 * 导出是为了让单测把「`LeagueTable.leagueDiscountPageIndex` 的输出」与这里的页码钉在一起
 * （页名改了 / 页序变了，两处会同时红）。
 */
export const LEAGUE_DISCOUNT_PAGE = { bargain: 0, buy: 1, bought: 2 } as const;

/** 置灰 / 正常两档（模块级建一次，别放进热路径）。 */
const GRAY_TINT = new Color(...LEAGUE_TINT_GRAY);
const NORMAL_TINT = new Color(...LEAGUE_TINT_NORMAL);

/** `n53` 删除线的原始尺寸（FGUI `size="100,3"`）—— prefab 没给尺寸时的兜底。 */
const STRIKE_FALLBACK_W = 100;
const STRIKE_FALLBACK_H = 3;

/** 倒计时刷新间隔（老端 `toolSet.addTimer(1000, …)`）。 */
const TICK_SECONDS = 1;

@ccclass('LeagueDiscountPage')
export class LeagueDiscountPage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
     */
    static prefabPath = 'ui/League/LeagueDiscount';

    @property({ type: VirtualScrollView, tooltip: 'DiscountListView：砍价参与列表（虚拟列表 + Mask）' })
    discountList: VirtualScrollView = null;

    @property({ type: LeagueRewardSlot, tooltip: 'RewardA：rewards[0]（左格）' })
    rewardA: LeagueRewardSlot = null;

    @property({ type: LeagueRewardSlot, tooltip: 'RewardB：rewards[1]（右格）' })
    rewardB: LeagueRewardSlot = null;

    @property({ type: Sprite, tooltip: 'PriceIcon：金币图标（老端 itemIcon，`roleProperty.coin`）' })
    priceIcon: Sprite = null;

    @property({ type: Label, tooltip: 'LabPrice：原价（上面压着 Strike 删除线）' })
    priceLabel: Label = null;

    @property({ type: Label, tooltip: 'LabPriceNow：现价' })
    priceNowLabel: Label = null;

    @property({ type: Label, tooltip: 'LabUserCount：当前累计N人砍价' })
    userCountLabel: Label = null;

    @property({ type: Label, tooltip: 'LabEndTime：剩余时间（每秒刷）' })
    endTimeLabel: Label = null;

    @property({ type: Node, tooltip: 'BtnSale：砍价按钮（仅「砍价」页可见）' })
    saleButton: Node = null;

    /**
     * `BtnSale/RedDot`：砍价红点（= `canBargain`；「砍价」页之外恒关）。
     *
     * 这里刻意声明成 **`Node`** 而不是 `RedDot`：
     * `BtnSale/RedDot` 是 `ui/common/RedDot.prefab` 的**嵌套实例**，它内部的 `RedDot` 组件
     * 存在**被引用 prefab 的文件里**，不在 `LeagueDiscount.prefab` 里 ⇒ 「外层脚本 → 实例内部组件」
     * 的引用**过不了序列化**（实测：绑 `RedDot` 类型后用 MCP 存盘，盘上落成 `null`，
     * 编辑器不报错、静默失效）。而实例的**根节点**是序列化在本文件里的 shell ⇒ 绑节点可行。
     * 运行时实例已展开，`getComponent(RedDot)` 拿得到。
     * （同口径：`LeagueStoreRow.redDot` / `LeagueAdButton.redDot` 都是 `Node`。）
     */
    @property({ type: Node, tooltip: 'BtnSale/RedDot：砍价红点（= canBargain；「砍价」页之外恒关）' })
    saleRedDot: Node = null;

    @property({ type: Node, tooltip: 'BtnBuy：购买按钮（「购买」「已购买」页可见）' })
    buyButton: Node = null;

    @property({ type: Sprite, tooltip: 'BtnBuy 的底图（「已购买」页要染灰 —— FGUI gearLook 的 grayed）' })
    buyButtonBg: Sprite = null;

    @property({ type: Graphics, tooltip: 'Strike：原价删除线（FGUI n53，100×3）' })
    strike: Graphics = null;

    /** 本趟快照（`onBuy` 要拿 `canBuy` / 货币名）。 */
    private snapshot: ILeagueDiscountSnapshot | null = null;

    /** 本趟的奖励图帧（品质框 + 图标），`present()` 之前一定已就绪。 */
    private art: ILeagueRewardArt | null = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueDiscountRowView[] = [];

    /** 本轮截止时刻（**秒**）—— `0` = 没有（表空 / 缓存没推回来），倒计时显示 `00:00:00`。 */
    private deadlineSec = 0;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // 生命周期

    protected onInit(): void {
        EventMgr.instance.on(LeagueRewardEvent.Completed, this.onRewardCompleted, this);
        if (this.discountList) this.discountList.renderItemFn = (node, index) => this.renderRow(node, index);
        this.bindClick(this.saleButton, () => void this.onSale(), 'BtnSale');
        this.bindClick(this.buyButton, () => void this.onBuy(), 'BtnBuy');
        // 删除线与数据无关（原价永远被划掉），建一次即可
        this.drawStrikeThrough();
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.busy = false;
        this.revision += 1;
        this.stopCountdown();
    }

    onDestroy(): void {
        EventMgr.instance.offTarget(this);
        this.revision += 1;
        // 不用手动 off() 事件（节点销毁时引擎会清），但定时器必须自己停：
        // 销毁期 `unschedule` 只碰调度器、不碰已销毁节点，是安全的。
        this.stopCountdown();
        super.onDestroy();
    }

    // 取数

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 拉活动列表 + 详情 → 读一次砍价缓存 → 预取图 → 铺界面（见类头第 1 条）。
     *
     * `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     * ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const act = await this.repository.requestActList(LeagueACT_TYPE.DISCOUNT, this);
        if (!this.alive || revision !== this.revision) return;

        await this.repository.requestDetail(this);
        if (!this.alive || revision !== this.revision) return;

        const snapshot = await this.repository.loadDiscount();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.rows = snapshot.rows.slice();
        this.art = await this.loadArtFrames(snapshot);
        if (!this.alive || revision !== this.revision) return;

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present(snapshot);

        // 拉活动列表失败仍然把缓存里的东西铺出来（离线时界面不该是空的），另给一条提示
        if (act !== 'ok') FW.showTip(act === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    /**
     * 预取本趟要用到的图：两件奖励 + 金币图标（`roleProperty.coin`）。
     *
     * 品质框由 `loadLeagueRewardArt` 内部固定取 4 张。
     */
    private loadArtFrames(snapshot: ILeagueDiscountSnapshot): Promise<ILeagueRewardArt> {
        const resIds = new Set<number>([LEAGUE_COIN_RES_ID]);
        for (const reward of [snapshot.view?.rewardA, snapshot.view?.rewardB]) {
            if (reward) resIds.add(reward.resId);
        }
        return loadLeagueRewardArt(resIds, snapshot.items, snapshot.resources);
    }

    /**
     * 铺界面 —— 老端 `updateView()` 逐句对照。
     *
     * `view` 为 `null`（`unionDiscount` 表空 / 活动还没推回来）时走**降级**分支：
     * 两格奖励藏起来、价格清零、两颗按钮都藏（老端这里会直接抛，本端不抛）。
     */
    private present(snapshot: ILeagueDiscountSnapshot): void {
        const view = snapshot.view;
        const art = this.art;

        if (this.userCountLabel) this.userCountLabel.string = snapshot.countText;

        // 两件奖励（`rewards[0]` → 左格 `com_goods`、`rewards[1]` → 右格 `com_goods1`）
        this.presentReward(this.rewardA, view?.rewardA ?? null, art);
        this.presentReward(this.rewardB, view?.rewardB ?? null, art);

        // 金币图标（老端 `itemIcon` = `GetGoodsIconKeyByRefId(roleProperty.coin)`）
        if (this.priceIcon) {
            const frame = art ? art.iconFrameOf(LEAGUE_COIN_RES_ID) : null;
            if (frame) this.priceIcon.spriteFrame = frame;
        }

        // 价格
        if (this.priceLabel) this.priceLabel.string = view ? String(view.price) : '';
        if (this.priceNowLabel) this.priceNowLabel.string = view ? String(view.priceNow) : '';

        this.applyPage(view);

        // 参与列表
        if (this.discountList) {
            this.discountList.refreshList(this.rows);
            this.discountList.scrollToTop(false);
        }

        // 倒计时（`view` 缺失时归零 ⇒ 显示 00:00:00）
        this.deadlineSec = view && view.resetTimeSec > 0
            ? view.resetTimeSec + LEAGUE_DISCOUNT_RESET_DAY_SECONDS
            : 0;
        this.startCountdown();
    }

    /** 一格奖励：`null` 就整格藏起来（老端取 `rewards[1]` 越界会抛，本端不抛）。 */
    private presentReward(slot: LeagueRewardSlot | null, reward: ILeagueReward | null, art: ILeagueRewardArt | null): void {
        if (!slot) return;
        if (!reward) {
            slot.hide();
            return;
        }
        slot.node.active = true;
        const frames = art ? art.framesOf(reward.resId) : { frame: null, icon: null };
        slot.render(frames.frame, frames.icon, reward.number, true);
    }

    /**
     * `状态` controller 的三条：两颗按钮的显隐 + 购买按钮的灰态 + 砍价红点。
     *
     * `view` 为 `null` 时两颗按钮都藏（`pageIndex` 落 `-1`，与三页都不相等）。
     */
    private applyPage(view: ILeagueDiscountView | null): void {
        const page = view ? view.pageIndex : -1;
        if (this.saleButton) this.saleButton.active = page === LEAGUE_DISCOUNT_PAGE.bargain;
        if (this.buyButton) {
            this.buyButton.active = page === LEAGUE_DISCOUNT_PAGE.buy || page === LEAGUE_DISCOUNT_PAGE.bought;
        }
        // FGUI `gearLook pages="2" values="1,0,1,1"` ⇒ 只有「已购买」页 `grayed`
        if (this.buyButtonBg) {
            this.buyButtonBg.color = page === LEAGUE_DISCOUNT_PAGE.bought ? GRAY_TINT : NORMAL_TINT;
        }
        // 老端 `(com.tm("btn_sale.组件_红点") as GObjRD).OnRDUpdate(canBeSale() ? 1 : 0)`
        // —— 走共用红点组件（`ui/common/RedDot.prefab`，普通红点 = spine「红点闪闪」）。
        // 红点只在「砍价」页那颗按钮上，`canBargain` 一变就整块收起（`setRedDot(0)` 会 `active=false`）。
        // 绑的是实例**根节点**（见 `saleRedDot` 的注释），组件运行时取。
        const rd = this.saleRedDot?.getComponent(RedDot);
        if (rd) rd.setRedDot(view && this.snapshot?.canBargain ? 1 : 0);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueDiscountRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        // 行内 `icon` 是货币图标（老端 `render` 里同样是 `roleProperty.coin` 那张）
        row.render(view, this.art ? this.art.iconFrameOf(LEAGUE_COIN_RES_ID) : null);
    }

    // 倒计时

    /**
     * 每秒刷新 —— 老端 `updateTime()`：
     *
     * ```ts
     * let lerp = (this.resetTime - this.timeUtil.nowMillisecond()) / 1000;
     * lab_end_time.setText(Client_RemainTime.replace("{0}", lerp <= 0 ? "00:00:00" : timeSec2HMSStr2(lerp)));
     * ```
     *
     * 用**箭头字段**：`schedule/unschedule` 靠「同一函数引用」配对，写成方法再传
     * `this.onSecondTick` 每次取值都会重新绑定（老端那个「越刷越多」的坑同源）。
     */
    private readonly onSecondTick = (): void => {
        this.updateTime();
    };

    /** 幂等启动（`schedule` 前先 `unschedule` —— 见类头的「有意偏离」）。 */
    private startCountdown(): void {
        this.stopCountdown();
        this.updateTime(); // 先立刻刷一次，别让面板停顿 1 秒才出数
        this.schedule(this.onSecondTick, TICK_SECONDS);
    }

    private stopCountdown(): void {
        this.unschedule(this.onSecondTick);
    }

    private updateTime(): void {
        if (!this.endTimeLabel) return;
        const remain = this.deadlineSec - Math.floor(Date.now() / 1000);
        // `formatLeagueCountdown` 对 `<= 0` 输出 `00:00:00`（老端那个显式分支）
        this.endTimeLabel.string = fillLeagueText(LEAGUE_DISCOUNT_TIME_TEMPLATE, formatLeagueCountdown(remain));
    }

    // 砍价 / 购买

    /**
     * 点「砍价」—— 老端 `onSale()`：**无守卫**，直接 `RequestUnionBargain(false)`。
     *
     * 本端补的那道 `canBargain` 守卫是**防御性**的：按钮只在「砍价」页可见（`active=false`
     * 时点不到），真点到了也不该白发一次包。提示借用老端同一句 `LEAGUE_BUY_TIMES_LIMIT`。
     */
    private async onSale(): Promise<void> {
        if (!this.snapshot?.canBargain) {
            FW.showTip(LEAGUE_TIP_DISCOUNT_DONE);
            return;
        }
        await this.sendBargain(false);
    }

    /**
     * 点「购买」—— 老端 `onBuy()` 三道关逐句对照：
     *
     * ```ts
     * if (!this.canBuy()) { FW.showTip(LEAGUE_BUY_TIMES_LIMIT); return; }
     * let cost = { resId: roleProperty.coin, number: this.priceNow };
     * if (CheckHaveEnoughCostAndOpenAlert([cost])) { 弹 PanelDialog，确定后 RequestUnionBargain(true) }
     * ```
     */
    private async onBuy(): Promise<void> {
        const snapshot = this.snapshot;
        const view = snapshot?.view;
        if (!snapshot || !view) return;

        // ① 购买次数用完
        if (!snapshot.canBuy) {
            FW.showTip(LEAGUE_TIP_BUY_TIMES_LIMIT);
            return;
        }
        // ② 钱不够（老端 `CheckHaveEnoughCostAndOpenAlert` 走 tip，不弹详情面板）
        if (!snapshot.enough) {
            FW.showTip(fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, this.coinNameText()));
            return;
        }
        // ③ 二次确认 ——  文案里填的是**现价**（`priceNow`），不是原价
        const content = fillLeagueText(LEAGUE_DISCOUNT_BUY_CONFIRM, view.priceNow);
        void CommonTips.open({
            userData: {
                content,
                onSure: () => void this.sendBargain(true),
            },
        });
    }

    /** 发一次砍价（`buy=false`）或购买（`buy=true`）。 */
    private async sendBargain(buy: boolean): Promise<void> {
        if (!this.beginWrite()) return;
        EventMgr.instance.emit(LeagueRewardEvent.Intent, { owner: this, action: { kind: 'bargain', buy } } satisfies ILeagueRewardIntent);
    }

    /** 「金币」—— 从 `roleProperty` 表取 `resId=10` 那行的 `name`，取不到退回空串。 */
    private coinNameText(): string {
        return this.snapshot?.resources.get(LEAGUE_COIN_RES_ID)?.name ?? '';
    }

    // 杂项

    /**
     * 画原价上的删除线 —— FGUI `n53`（`<graph type="rect">`，100×3）的 Cocos 版。
     *
     * `cc.Graphics` 的坐标是**节点局部空间且原点在锚点**（本节点锚点 (0.5,0.5)）
     * ⇒ 从 `(-w/2, -h/2)` 起画一个 `w×h` 的实心矩形。尺寸优先取节点自己的 `UITransform`
     * （prefab 里已按 FGUI 落了 100×3），取不到才用兜底常量。
     */
    private drawStrikeThrough(): void {
        const graphics = this.strike;
        if (!graphics) return;
        const size = graphics.node.getComponent(UITransform)?.contentSize;
        const w = size && size.width > 0 ? size.width : STRIKE_FALLBACK_W;
        const h = size && size.height > 0 ? size.height : STRIKE_FALLBACK_H;
        const [r, g, b] = LEAGUE_ART_BARGAIN_STRIKE_COLOR;
        graphics.clear();
        graphics.fillColor = new Color(r, g, b, 255);
        graphics.rect(-w / 2, -h / 2, w, h);
        graphics.fill();
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    private readonly onRewardCompleted = async (event: ILeagueRewardCompletion): Promise<void> => {
        if (event.owner !== this) return;
        try {
            await this.afterWrite(event.status);
        } finally {
            this.busy = false;
        }
    };

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    /** 按节点绑按钮（节点上有 `cc.Button` 就走 CLICK；缺则 warn 并退到 TOUCH_END）。 */
    private bindClick(node: Node | null, handler: () => void, what: string): void {
        if (!node) {
            console.warn(`[LeagueDiscount] ${what} 缺失，点击不会生效`);
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
