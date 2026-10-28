import { _decorator, Button, Color, Label, Node, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadFrameArt, loadIconByArtPath } from '../card/CardLineupIcons';
import { RedDot } from '../common/RedDot';
import { CacheMgr } from '../net/CacheMgr';
import { QUALITY_FRAME_NAMES } from './FirstRechargeArt';
import type { IFirstRechargeItemInfo } from './FirstRechargeArt';
import { FirstRechargeDayRow } from './FirstRechargeDayRow';
import { dayPlateOffsets } from './FirstRechargeLayout';
import {
    firstRechargeRepository,
} from './FirstRechargeRepository';
import type { IFirstRechargeRepository, IFirstRechargeSnapshot } from './FirstRechargeRepository';
import { FirstRechargeTierTab } from './FirstRechargeTierTab';
import {
    buttonStateOf,
    claimableDayOf,
    dayStateOf,
    tierRedDotOf,
    visibleTierIndexes,
} from './FirstRechargeTable';
import type { IFirstRechargeReward, IFirstRechargeTier } from './FirstRechargeTable';
import { FIRST_RECHARGE_TEXTS } from './FirstRechargeTexts';

const { ccclass, property } = _decorator;

/**
 * 「首充礼包」（新首充）弹窗（`assets/resources/ui/FirstRecharge/FirstRecharge.prefab`）。
 *
 * 版面照搬 FGUI 包「新首充」（`zarts/.../assets/新首充/组件/组件_新首充.xml`），
 * 效果图基准 = 同目录 `设计图/首充标注.jpg`：
 *   - 顶部标题美术字 + 主美术（兵种立绘），压名牌上是兵种名；
 *   - 中间大底板里横排三块「第N天」，每块一天的奖励格（牌宽随奖励条数变）；
 *   - 底板下沿一排档位页签（`¥6` / `¥30` / `¥98` / `¥198`），选中态 + 每档红点；
 *   - 底部大按钮在「未购买（显示价格）/ 可领取 / 已领取」三态间切换。
 *
 *  **分层**（与 `CardUpgradePage` 同一套）：
 *    数据与判定  `FirstRechargeTable`（纯函数）+ `FirstRechargeRepository`（表 / 缓存 / 请求）
 *    版面公式    `FirstRechargeLayout`（纯函数 —— 横排可变宽，`cc.Layout` 表达不了）
 *    子视图      `FirstRechargeTierTab`（一档）、`FirstRechargeDayRow`（一天，内含 `FirstRechargeSlot`）
 *    本类        只做「取数 → 铺到子视图」和「点击 → 发请求 → 重新取数」
 *
 *  项目约定：**样式与布局全在 prefab 的 Inspector 上**（含全部美术引用，不再运行时 `resources.load`）；
 *  只有「随数据变化的尺寸」才在代码里算 —— 也就是 `FirstRechargeLayout` 那三条公式。
 */
@ccclass('FirstRechargePage')
export class FirstRechargePage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/FirstRecharge/`，F 与 R 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/firstRecharge/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/FirstRecharge/FirstRecharge';

    @property({ type: Label, tooltip: 'UnitName：压名牌上的兵种名（如「兽人民兵」）' })
    unitNameLabel: Label = null!;

    @property({ type: Node, tooltip: 'CloseBtn：右上角关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Node, tooltip: 'TierBar：档位栏（下面挂 4 个 FirstRechargeTierTab）' })
    tierBar: Node = null!;

    @property({ type: Node, tooltip: 'DayList：天数列表（下面挂 3 个 FirstRechargeDayRow）' })
    dayList: Node = null!;

    @property({ type: Node, tooltip: 'BtnBuy：底部按钮（挂 cc.Button）' })
    buyButton: Node = null!;

    @property({ type: Label, tooltip: 'BtnBuy/Label：按钮文案' })
    buyLabel: Label = null!;

    @property({ type: RedDot, tooltip: 'BtnBuy/RedDot：可领取红点（默认隐藏）' })
    buyRedDot: RedDot = null!;

    @property({ type: Label, tooltip: 'Hint：底板里的副标题，异常时被离线 / 失败提示顶掉' })
    hintLabel: Label = null!;

    @property({ type: Color, tooltip: '提示文字：正常态颜色' })
    hintIdleColor: Color = new Color(176, 168, 150, 255);

    @property({ type: Color, tooltip: '提示文字：异常态颜色' })
    hintErrorColor: Color = new Color(226, 88, 74, 255);

    /** 数据端口；测试可替换（`repository` 只读，用 `setRepository` 换）。 */
    private repo: IFirstRechargeRepository = firstRechargeRepository;

    private closeAction: Button = null!;
    private buyAction: Button = null!;

    /** 当前快照（表 + 服务器状态 + 道具表）。 */
    private snapshot: IFirstRechargeSnapshot | null = null;
    /** 当前选中的档位 **id**（不是下标 —— 与老客户端 `_selectIndex` 同口径）。 */
    private selectedTierId = 0;
    /** 正在发请求，期间按钮不可点。 */
    private busy = false;
    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果（连点档位会并发）。 */
    private presentRevision = 0;
    private loadRevision = 0;
    /** 品质框（4 档固定图）的加载结果，首次用到后缓存。 */
    private qualityFrames: Map<string, SpriteFrame> | null = null;

    /** 副标题（`Hint`）的**正常态文案**：由当前档位的兵种名拼出来，见 `presentHeadline()`。 */
    private subtitle = '';

    protected onInit(): void {
        //  Hint 是「副标题 + 错误提示」两用的：先把 prefab 上的静态文案记下来当正常态，
        //  `setHint('')` 就是"恢复副标题"。数据到位后 `presentHeadline()` 会换成真实兵种名。
        this.subtitle = this.hintLabel.string;

        //  CLICK 挂在**节点**上（Button 自身没有 on）—— 与 `CardUpgradePage` 同一写法。
        this.closeAction = this.closeButton.getComponent(Button)!;
        this.buyAction = this.buyButton.getComponent(Button)!;
        this.closeAction.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.buyAction.node.on(Button.EventType.CLICK, this.onBuyClick, this);

        for (const tab of this.tierTabs) {
            tab.node.on(Button.EventType.CLICK, () => this.onTierClick(tab), this);
        }
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.selectedTierId = 0;
        this.setHint('');
        // 对齐老端 VOFirstRechargeNewBag.OnChanged：支付完成/领奖后服务端更新缓存时自动重绘。
        // 支付是异步链路，不能只依赖点击购买后的那次立即 reload（那时通常还没发货）。
        CacheMgr.instance.setEventUpdate(
            'CmdFirstRechargeNew',
            this,
            this.onFirstRechargeCacheUpdate,
        );
        // 打开时向服务端要一次最新状态；连不上就跳过（继续用缓存渲染，不弹错）。
        await this.repo.refreshFromServer(this);
        if (!this.alive) return;
        await this.reload();
    }

    protected onClose(): void {
        CacheMgr.instance.removeEventUpdate(
            'CmdFirstRechargeNew',
            this,
            this.onFirstRechargeCacheUpdate,
        );
        // 作废尚未完成的读表/贴图任务，避免缓存复用后旧结果覆盖下一次打开。
        this.loadRevision += 1;
        this.presentRevision += 1;
        this.busy = false;
    }

    private readonly onFirstRechargeCacheUpdate = (): void => {
        if (!this.alive) return;
        void this.reload();
    };

    /** 供测试注入替身 Repository（`@property` 不暴露它 —— 它不是策划配置）。 */
    setRepository(repository: IFirstRechargeRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = await this.repo.load();
        if (!this.alive || revision !== this.loadRevision) return;
        this.snapshot = snapshot;

        const tiers = snapshot.tiers;
        if (tiers.length === 0) {
            this.presentEmpty();
            return;
        }
        // 选中档在被隐藏的档位里（或首次打开）时，回落到第一个可见档。
        const visible = visibleTierIndexes(tiers, snapshot.states);
        const selectedVisible = visible.some((index) => tiers[index].id === this.selectedTierId);
        if (!selectedVisible) {
            this.selectedTierId = visible.length > 0 ? tiers[visible[0]].id : tiers[0].id;
        }
        await this.present();
    }

    private async present(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const tiers = snapshot.tiers;
        const revision = ++this.presentRevision;

        this.presentTabs(tiers, snapshot);

        const tier = this.selectedTier(tiers);
        if (!tier) {
            this.presentEmpty();
            return;
        }

        //  图标与品质框必须先 **await 完**再铺界面：`FirstRechargeSlot.render` 是同步的，
        // 在里面现加载会在切档时先闪一帧上一档的图（`VScrollView` 回收残影同款缺陷）。
        const [qualityFrames, frames] = await Promise.all([
            this.loadQualityFrames(),
            this.loadIconFrames(tier, snapshot.items),
        ]);
        if (!this.alive || revision !== this.presentRevision) return;

        const state = snapshot.states.get(tier.id);
        const rows = this.dayRows;
        //  三天**横排**，牌宽随「当天几条奖励」变（3 条 269 / 2 条 186），整排再居中。
        //  老客户端是 FairyGUI `list_item` 的 `autoItemSize` 自动排；Cocos 的 `cc.Layout`
        //  只支持等宽格子，所以公式收在 `FirstRechargeLayout`（纯函数、有单测）。
        const offsets = dayPlateOffsets(rows.map((_row, index) => (tier.days[index] ?? []).length));
        for (let index = 0; index < rows.length; index++) {
            const day = index + 1;
            const rewards = tier.days[index] ?? [];
            if (rewards.length === 0) {
                rows[index].hide();
                continue;
            }
            rows[index].node.active = true;
            rows[index].node.setPosition(offsets[index], rows[index].node.position.y, 0);
            rows[index].render({
                day,
                state: dayStateOf(state, day, snapshot.now),
                rewards,
                items: snapshot.items,
                iconFrames: frames,
                qualityFrames,
            });
        }

        this.presentHeadline(tier, snapshot);
        this.presentBuyButton(tier, snapshot);
    }

    /**
     * 顶部「兵种名 + 副标题」。
     *
     * 取**当前档位第 1 天第 1 条奖励**的道具名 —— 设计图 `首充标注.jpg` 上那两处文案
     * （`兽人民兵` 与 `获得限定皮肤：兽人民兵并且连续3天解锁额外奖励`）就是它，
     * 对应 `item.json` 的 `10401 → 兽人民兵`。
     *
     * 查不到名字（表没读到 / `resId` 不在 `item.json`）时**保留 prefab 上的静态文案**，
     * 不清空 —— 空白比"上一档的名字"更安全（切档时不会闪一下旧档的兵种名）。
     */
    private presentHeadline(tier: IFirstRechargeTier, snapshot: IFirstRechargeSnapshot): void {
        const resId = tier.days[0]?.[0]?.resId;
        const name = resId === undefined ? '' : snapshot.items.get(resId)?.name ?? '';
        if (name.length === 0) return;
        this.unitNameLabel.string = name;
        const texts = FIRST_RECHARGE_TEXTS;
        this.subtitle = `${texts.gainPrefix}${name}${texts.gainSuffix}`;
        this.setHint('');
    }

    private presentTabs(tiers: readonly IFirstRechargeTier[], snapshot: IFirstRechargeSnapshot): void {
        const visible = visibleTierIndexes(tiers, snapshot.states);
        const tabs = this.tierTabs;
        for (let index = 0; index < tabs.length; index++) {
            const tier = tiers[index];
            if (!tier || visible.indexOf(index) < 0) {
                tabs[index].hide();
                continue;
            }
            tabs[index].node.active = true;
            tabs[index].render(
                this.priceText(tier),
                tier.id === this.selectedTierId,
                // 选中档位的红点已经由底部按钮表达，不再重复画一个
                tier.id === this.selectedTierId ? 0 : tierRedDotOf(snapshot.states.get(tier.id), snapshot.now),
            );
        }
    }

    private presentBuyButton(tier: IFirstRechargeTier, snapshot: IFirstRechargeSnapshot): void {
        const texts = FIRST_RECHARGE_TEXTS;
        const state = buttonStateOf(snapshot.states.get(tier.id), snapshot.now);
        if (state === 'buy') {
            this.buyLabel.string = `${texts.buyPrefix}${tier.price}`;
        } else {
            this.buyLabel.string = state === 'claim' ? texts.claim : texts.taken;
        }
        this.buyRedDot.setRedDot(state === 'claim');
        // 「已领取」不可点；发请求途中也不可点（防连点重复下单）。
        this.buyAction.interactable = state !== 'taken' && !this.busy;
    }

    /** 一档都没有（表没读到）时的样子：全部隐藏 + 提示。 */
    private presentEmpty(): void {
        for (const tab of this.tierTabs) tab.hide();
        for (const row of this.dayRows) row.hide();
        this.buyRedDot.setRedDot(0);
        this.buyAction.interactable = false;
        this.buyLabel.string = FIRST_RECHARGE_TEXTS.buyPrefix;
        this.setHint(FIRST_RECHARGE_TEXTS.empty, true);
    }

    // ============================================================
    // 交互
    // ============================================================

    private onTierClick(tab: FirstRechargeTierTab): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const index = this.tierTabs.indexOf(tab);
        const tier = snapshot.tiers[index];
        if (!tier || tier.id === this.selectedTierId) return;
        this.selectedTierId = tier.id;
        void this.present();
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private async onBuyClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (this.busy || !snapshot) return;
        const tier = this.selectedTier(snapshot.tiers);
        if (!tier) return;

        const state = snapshot.states.get(tier.id);
        const texts = FIRST_RECHARGE_TEXTS;

        if (buttonStateOf(state, snapshot.now) === 'taken') {
            // 老客户端这里也是直接提示，不发请求。
            this.setHint(texts.taken);
            return;
        }

        this.busy = true;
        this.presentBuyButton(tier, snapshot);
        this.setHint('');

        const claimDay = claimableDayOf(state, snapshot.now);
        //  买入用 `tier.rmb`（支付渠道 id），领奖用 `tier.id`（档位 id）—— 口径不同，别统一。
        const result = claimDay > 0
            ? await this.repo.claim(tier.id, claimDay, this)
            : await this.repo.buy(tier.rmb, this);

        this.busy = false;
        if (!this.alive) return;

        if (result === 'offline') {
            this.setHint(texts.offline, true);
            this.presentBuyButton(tier, snapshot);
            return;
        }
        if (result === 'failed') {
            this.setHint(FIRST_RECHARGE_TEXTS.failed, true);
            this.presentBuyButton(tier, snapshot);
            return;
        }
        // 成功后重新取数：服务端会把新的 `CmdFirstRechargeNew` 推进缓存。
        await this.reload();
    }

    // ============================================================
    // 工具
    // ============================================================

    /** 底部按钮当前处于哪一态（`onBuyClick` 用它决定发哪个请求）。 */
    private selectedTier(tiers: readonly IFirstRechargeTier[]): IFirstRechargeTier | undefined {
        return tiers.find((tier) => tier.id === this.selectedTierId) ?? tiers[0];
    }

    private priceText(tier: IFirstRechargeTier): string {
        return `${FIRST_RECHARGE_TEXTS.buyPrefix}${tier.price}`;
    }

    /**
     * 档位 tab，**按 x 从左到右**排序（`_children` 顺序 ≠ 视觉顺序）。
     *
     *  ⚠️ 必须 `getComponentsInChildren`：引擎 `Node.getComponents` 只查**本节点自己**
     *  （"all components of given type in the node"），而 `TierBar` 身上没有 tab 组件，
     *  用错会返回 `[]` —— 表现为「界面全空但一条报错都没有」。`DayList` / `SlotBar` 同理。
     */
    private get tierTabs(): FirstRechargeTierTab[] {
        return this.tierBar.getComponentsInChildren(FirstRechargeTierTab)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    /** 天数行，**按 x 从左到右**排序（第一天在最左边；`_children` 顺序 ≠ 视觉顺序）。 */
    private get dayRows(): FirstRechargeDayRow[] {
        return this.dayList.getComponentsInChildren(FirstRechargeDayRow)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    /** 预加载本档全部奖励图标：直接用物品表 icon 路径（icons/ 开头）加载。 */
    private async loadIconFrames(
        tier: IFirstRechargeTier,
        items: ReadonlyMap<number, IFirstRechargeItemInfo>,
    ): Promise<Map<number, SpriteFrame>> {
        const frames = new Map<number, SpriteFrame>();
        const wanted = new Map<number, string>();
        for (const rewards of tier.days) {
            for (const reward of rewards as readonly IFirstRechargeReward[]) {
                if (wanted.has(reward.resId)) continue;
                const iconPath = items.get(reward.resId)?.icon;
                if (iconPath) wanted.set(reward.resId, iconPath);
            }
        }

        await Promise.all(Array.from(wanted.entries()).map(async ([resId, iconPath]) => {
            const frame = await loadIconByArtPath(iconPath);
            if (frame) frames.set(resId, frame);
        }));
        return frames;
    }

    /**
     * 品质框（`image/frame/common_img_pzk_01..04`，只有 4 张固定图）。
     *
     *  和图标不同，品质框**与具体档位无关**，所以第一次加载后缓存在实例上，
     *  之后切档只走一次 Map 重建（底层 `loadArt` 另有全局缓存，不会重复读盘）。
     */
    private async loadQualityFrames(): Promise<Map<string, SpriteFrame>> {
        const cached = this.qualityFrames;
        if (cached) return cached;
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(QUALITY_FRAME_NAMES.map(async (name) => {
            const frame = await loadFrameArt(name);
            if (frame) frames.set(name, frame);
        }));
        this.qualityFrames = frames;
        return frames;
    }

    /**
     * 写底部提示。`text` 传空串 = **恢复副标题**（`presentHeadline()` 拼出来的那句），
     * 而不是把这一行清空 —— 清空会让弹窗底部缺一大块。
     */
    private setHint(text: string, error: boolean = false): void {
        this.hintLabel.string = text.length > 0 ? text : this.subtitle;
        this.hintLabel.color = error ? this.hintErrorColor : this.hintIdleColor;
    }

    /** 组件所在节点是否仍然有效（`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    onDestroy(): void {
        this.presentRevision += 1;
        this.loadRevision += 1;
        super.onDestroy();
    }
}
