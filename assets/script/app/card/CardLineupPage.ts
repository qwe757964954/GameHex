import { _decorator, Button, Component, Label, Node, Prefab, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import type { IControllerResources } from '../../framework/controller/ControllerBase';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';

import { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { cardArtProvider } from './CardArtProvider';
import type { ICardArtConfig } from './CardArtConfig';
import { CardLineupBond } from './CardLineupBond';
import { CardLineupCard } from './CardLineupCard';
import type { ZCCardArtLoader, ZCCardFrames, ZCCardFragmentProgress } from './CardLineupCard';
import { cardRepository } from './CardRepository';
import type { CardLineupData } from './CardRepository';
import { CardLineupSlot } from './CardLineupSlot';
import type { ZCSlotFrames } from './CardLineupSlot';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { formatPowerText } from './CardLineupPower';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import {
    activeBondTitle,
    bondPercentTotal,
    sortLineupCards,
    visibleIconTallies,
    visibleLineupCards,
} from './CardLineupTypes';
import type { ZCCardTally } from './CardLineupTypes';
import { CardLineupUiEvent, type ICardLineupRender } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/** 一个站台要的数据；frames 为空表示图还没到，先画空台和等级。 */
interface IPreparedSlot {
    readonly card: ZCDeckCard;
    readonly frames: ZCSlotFrames | null;
}

/** 图没到时给站台的空图，不能沿用上一轮。 */
const EMPTY_SLOT_FRAMES: ZCSlotFrames = { disc: null, hero: null, badge: null };

/** 卡库一次提交的数据；图由条目自己加载。 */
interface IPreparedPool {
    readonly cards: readonly ZCDeckCard[];
    readonly fragments: ReadonlyMap<string, ZCCardFragmentProgress>;
    readonly deployedIds: ReadonlySet<string>;
}

/** 图标行一次提交的数据，图同样由条目自己取。 */
interface IPreparedIcons {
    readonly items: readonly ZCCardTally[];
}

/** 每帧最多补几个上阵模型：`sp.Skeleton` 实例化实测 ~1.4~2.7ms/个，八个别挤进一帧。 */
const SLOT_PREVIEWS_PER_FRAME = 2;

/**
 * 卡牌阵容页。版式都在 prefab 里，这里只管数据：拿阵型、备图、刷列表。
 *
 * TeamArea 的 8 个站台按子节点顺序排；CardGrid 和 BondList 是虚拟列表，
 * 条目自己取图，所以别在页面里遍历它们的子节点找卡。
 *
 * 阵型优先读服务端选中项，拿不到再退回本地 pvpCard.json 的默认八卡。
 * 等级、上限、羁绊、战力分别来自英雄列表、cardLevelUp、pvpBond 和当前上阵卡。
 * 底部页签是静态的，本页不接管选中态。
 */
@ccclass('CardLineupPage')
export class CardLineupPage extends Component {
    private presentationResources: IControllerResources = null!;
    initialize(resources: IControllerResources): void { this.presentationResources = resources; }
    private get previewScope(): ResourceScope { return this.presentationResources.scope; }
    private get assets() { return this.presentationResources.assets; }
    private previewAssets: CardUnitPreviewAssets<Prefab> | null = null;

    /**
     * 快照和权威值会乱序回来，用这个版本号挡住旧快照，别让它把新阵容盖回去。
     */
    private presentRevision = 0;

    /** 上阵站台，顺序就是节点树顺序，下标对应卡组位置。 */
    private arenaSlotCache: CardLineupSlot[] | null = null;

    /** 还没补模型的上阵位：先画静态图，模型随后逐帧补。 */
    private pendingPreviews: Array<{ readonly slot: CardLineupSlot; readonly prefab: Prefab }> = [];
    private previewFlushScheduled = false;
    /** 首屏静态图提交后，下一帧再开始加载模型，先别和 UI 图抢下载。 */
    private previewLoadTask: (() => void) | null = null;

    @property({ type: Label, tooltip: 'TopBar/QualityLabel：品质星下方小字' })
    qualityLabel: Label = null;

    @property({ type: Label, tooltip: 'TopBar/Ribbon/PowerLabel：队力数值' })
    powerLabel: Label = null;

    @property({ type: Label, tooltip: 'Banner/BondTitleLabel：加成条左侧标题（写第一条生效羁绊的名字）' })
    bondTitleLabel: Label = null;

    @property({ type: Label, tooltip: 'Banner/BondValueLabel：加成条右侧百分比' })
    bondValueLabel: Label = null;

    @property({ type: Node, tooltip: 'TeamArea：8 个站台由 Grid Layout 排列' })
    teamArea: Node = null;

    @property({
        type: VirtualScrollView,
        tooltip: 'MidBar/BondList：职业/阵营图标行，横向虚拟列表',
    })
    iconList: VirtualScrollView = null;

    @property({
        type: VirtualScrollView,
        tooltip: 'CardGrid 上的 VirtualScrollView：卡库列表视窗，槽位由列表自己建',
    })
    cardGrid: VirtualScrollView = null;

    @property({ tooltip: '后端没有该卡等级时的兜底值（编辑器独立预览 / 后端不可用；卡库里「未拥有」的卡按 0 级显示，不走这里）' })
    fallbackLevel = 3;

    @property({ tooltip: 'cardLevelUp 没有该英雄配置时的等级上限兜底值' })
    fallbackLevelMax = 10;

    @property({ tooltip: '打开界面时自动读表补齐卡组（本页独立预览需要；正式流程里已经注入过就不会再读）' })
    autoLoadDecks = true;

    @property({
        type: Button,
        tooltip: 'MidBar/TeamEdit 的 cc.Button，必绑；漏绑回归测试会直接报错。',
    })
    teamEditButton: Button = null;

    /** 后端英雄等级，key 与 `pvpCard.id` 一致。 */
    private heroLevels: ReadonlyMap<string, number> = new Map();

    /**
     * 这次刷新有没有真拿到后端英雄列表。
     * 拿到了，列表里没有就是 0 级；没拿到（离线或编辑器预览）才用 fallbackLevel。
     */
    private heroListKnown = false;

    protected start(): void {
        this.qualityLabel.string = CARD_LINEUP_TEXTS.qualityBonus;
        this.bondTitleLabel.string = CARD_LINEUP_TEXTS.bondBonusTitle;
        this.powerLabel.string = '--';
        this.bindTeamEdit();
        this.renderLoading();
        EventMgr.instance.on(CardLineupUiEvent.Render, this.onLineupRender, this);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' });
    }

    /**
     * 首屏先画本地快照，等权威值回来再校正。没有快照就停在空台，等 refresh。
     */
    private readonly onLineupRender = (event: ICardLineupRender): void => {
        if (event.owner === this) void this.presentLineup(event.data).catch(error => {
            if (this.isValid) console.warn('[CardLineup] 渲染失败', error);
        });
    };

    /** 数据还没到，先把 8 个站台收起来。 */
    private renderLoading(): void {
        for (const slot of this.arenaSlots()) slot.setEmpty();
    }

    protected onDestroy(): void {
        EventMgr.instance.offTarget(this);
        this.presentRevision += 1;
        this.arenaSlotCache = null;
        this.cancelPreviewLoads();
        this.pendingPreviews.length = 0;
        this.previewFlushScheduled = false;
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' });
    }

    /** 队伍编辑按钮绑在 cc.Button 上，点击监听挂在节点上。 */
    private bindTeamEdit(): void {
        this.teamEditButton.node.on(Button.EventType.CLICK, this.onTeamEditClick, this);
    }

    /**
     * 打开布阵面板。保存结果不回调，面板发 DeckSaved，本页收到后自己重刷。
     */
    private onTeamEditClick(): void {
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: this, kind: 'edit' });
    }

    refresh(): void { EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: this, kind: 'refresh' }); }

    /**
     * 页面统一写节点的地方，只渲染不取数。
     * 站台、卡库、图标行先备数据再一起提交，避免三块各画一半造成闪动。
     */
    private async presentLineup(data: CardLineupData): Promise<void> {
        this.art = data.art;
        const revision = ++this.presentRevision;
        this.cancelPreviewLoads();
        const deck = visibleLineupCards(data.deck);
        const cards = visibleLineupCards(data.catalog);
        // deck 为空要分两种情况：本地表没读到就保持空台；服务端明确说没人上阵就渲染空站台。
        // 快照路径 catalog 也是空，但 heroListKnown 能区分，不能一起提前 return。
        if (data.deck.length === 0 && data.catalog.length === 0 && !data.heroListKnown) {
            this.powerLabel.string = '--';
            console.warn('[CardLineupPage] 卡表未读到（deck / catalog 都为空且后端英雄列表不可用），保持空台');
            return;
        }
        this.heroListKnown = data.heroListKnown;
        this.heroLevels = data.heroLevels;
        const deployedIds = new Set(deck.map((card) => card.id));

        // 三段并行：站台和图标只看本地表，卡库要等权威数据，快照的 catalog 为空就先跳过。
        // 回归测试会按 data.catalog.length > 0 ? this.preparePool 的写法做断言，别包成函数。
        const [slots, pool, icons] = await Promise.all([
            this.prepareSlots(deck),
            // 快照只画上阵八卡，卡库等权威数据。
            data.catalog.length > 0 ? this.preparePool(cards, deployedIds) : Promise.resolve(null),
            this.prepareIcons(deck),
        ]);
        if (!this.isValid || revision !== this.presentRevision) return;

        this.powerLabel.string = data.power === undefined ? '--' : formatPowerText(data.power);
        this.commitSlots(slots);
        if (pool) this.commitPool(pool);
        this.commitIcons(icons);
        this.renderBondBanner(data.bonuses);
    }

    // ========================================================================
    // 上阵站台：prepare（只取已就绪的图）→ commit（同步画等级 / 空台）→ 图后台补
    // ========================================================================

    /**
     * 站台图缓存，页面实例内跨刷新复用。
     * 第二次进页如果预热已经跑完，这里能直接同步拿到图。
     */
    private readonly slotFrames = new Map<string, ZCSlotFrames>();
    private art: ICardArtConfig;

    private loadSlotFrames(card: ZCDeckCard): Promise<ZCSlotFrames> {
        const cached = this.slotFrames.get(card.id);
        if (cached) return Promise.resolve(cached);
        return cardArtProvider.loadLineupSlot(card, this.art).then((frames) => {
            this.slotFrames.set(card.id, frames);
            return frames;
        });
    }

    /**
     * 不再等图。已经加载好的就带上，没有的先留空，由 fillSlotArt 后台补。
     */
    private async prepareSlots(deck: readonly ZCDeckCard[]): Promise<ReadonlyArray<IPreparedSlot | null>> {
        const slots = this.arenaSlots();
        const items: Array<IPreparedSlot | null> = [];
        for (let index = 0; index < slots.length; index += 1) {
            const card = deck[index];
            items.push(card ? { card, frames: this.slotFrames.get(card.id) ?? null } : null);
        }
        return items;
    }

    /** 图没赶上的站台：后台加载，回来了只补图（等级牌已经在 `commitSlots` 里画好）。 */
    private fillSlotArt(card: ZCDeckCard, slot: CardLineupSlot): void {
        const revision = this.presentRevision;
        void this.loadSlotFrames(card).then((frames) => {
            // 快照 / 权威阵容交错、或页面已销毁 ⇒ 旧阵容的迟到图不许盖到新站台上。
            if (!this.isValid || revision !== this.presentRevision) return;
            slot.applyStaticArt(frames);
        }).catch(() => undefined);
    }

    /** 同步写 8 个站台：有卡就整格重画，没卡就收起（不留上一轮的残留）。 */
    private commitSlots(items: ReadonlyArray<IPreparedSlot | null>): void {
        const slots = this.arenaSlots();
        // 新一轮提交要作废上一轮的分帧计时器。只清队列不够，previewFlushScheduled 还留着 true，
        // 新模型会以为已经排过队，结果谁都不补。
        this.unschedule(this.flushPreviews);
        this.previewFlushScheduled = false;
        // 作废上一轮还没补完的模型（否则旧卡的模型会挂到新阵容的站台上）。
        this.pendingPreviews.length = 0;
        for (let index = 0; index < slots.length; index += 1) {
            const item = items[index];
            if (!item) {
                slots[index].setEmpty();
                continue;
            }
            slots[index].node.active = true;
            // 先画静态立绘，模型交给 flushPreviews 分帧补，八个 Skeleton 一起上是会卡的。
            slots[index].render(item.card, item.frames ?? EMPTY_SLOT_FRAMES, this.levelOf(item.card));
            if (!item.frames) this.fillSlotArt(item.card, slots[index]);
        }
        this.schedulePreviewLoads(items, slots);
    }

    private cancelPreviewLoads(): void {
        if (this.previewLoadTask) this.unschedule(this.previewLoadTask);
        this.previewLoadTask = null;
    }

    private schedulePreviewLoads(items: ReadonlyArray<IPreparedSlot | null>, slots: readonly CardLineupSlot[]): void {
        if (!items.some(item => item !== null)) return;
        const revision = this.presentRevision;
        const load = (): void => {
            this.previewLoadTask = null;
            const previewAssets = this.unitPreviewAssets();
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (!item) continue;
                void previewAssets.load(item.card).then(prefab => {
                    // 快照 / 权威阵容会交错，迟到模型不得进入新一轮站台或销毁页面。
                    if (!this.isValid || revision !== this.presentRevision || !prefab) return;
                    this.pendingPreviews.push({ slot: slots[index], prefab });
                    this.schedulePreviews();
                }).catch(error => {
                    if (this.isValid && revision === this.presentRevision) {
                        console.warn('[CardLineup] 单位模型加载失败，保留静态立绘', error);
                    }
                });
            }
        };
        this.previewLoadTask = load;
        this.scheduleOnce(load);
    }

    private schedulePreviews(): void {
        if (this.previewFlushScheduled || this.pendingPreviews.length === 0) return;
        this.previewFlushScheduled = true;
        this.schedule(this.flushPreviews);
    }

    /**
     * 每帧补 `SLOT_PREVIEWS_PER_FRAME` 个上阵模型，补完就停。
     *
     * 用组件逐帧调度，队列耗尽后停止；销毁时引擎解除，停用时暂停。
     * 不在 scheduleOnce 回调里重注册自身：引擎会在回调返回后删除同一个计时器。
     */
    private readonly flushPreviews = (): void => {
        for (let count = 0; count < SLOT_PREVIEWS_PER_FRAME && this.pendingPreviews.length > 0; count += 1) {
            const next = this.pendingPreviews.shift();
            next.slot.applyPreview(next.prefab);
        }
        if (this.pendingPreviews.length === 0) {
            this.unschedule(this.flushPreviews);
            this.previewFlushScheduled = false;
        }
    };

    /**
     * 8 个站台，下标 = 卡组下标。顺序取节点树顺序。
     *
     *  `TeamArea` 挂 GRID Layout，它按子节点顺序排版 —— `_lpos` 是它的产物，
     *  按坐标反推只会在原地绕一圈（兄弟顺序错了坐标也跟着错，救不回来）。
     */
    private arenaSlots(): readonly CardLineupSlot[] {
        if (!this.arenaSlotCache) {
            this.arenaSlotCache = this.teamArea.children
                .map((node) => node.getComponent(CardLineupSlot))
                .filter((slot): slot is CardLineupSlot => !!slot);
        }
        return this.arenaSlotCache;
    }

    private unitPreviewAssets(): CardUnitPreviewAssets<Prefab> {
        if (!this.previewAssets) {
            this.previewAssets = new CardUnitPreviewAssets(
                (path) => this.assets.load(path, Prefab, { scope: this.previewScope }));
        }
        return this.previewAssets;
    }

    /**
     * 卡库：`CardGrid` 是虚拟列表（`VirtualScrollView`）的视窗，条目模板 = `CardLineupCard.prefab`。
     *
     *  列表参数（行/列数、主副方向间距、缓冲、滚动风格…）全部绑在 prefab 的 Inspector 上
     * （项目约定：同一份配置不散在代码和 prefab 两处），代码只覆盖 `renderItemFn` + 总条数。
     *
     *  这里只备数据（碎片 + 排序），不再全量备图：35 张卡 × 3 张图实测 817ms，
     *  而虚拟列表首屏只用得到十来个槽位 —— 全量备图是在为看不见的卡付首屏时间。
     *  图改由条目自取（`commitPool` 传 `this.loadPoolFrames`），已加载过的同步命中缓存。
     *
     *  条目来自 `pvpCard` 全表并排除金矿；碎片备齐后按状态、品质、等级、职业排序。
     */
    private async preparePool(cards: readonly ZCDeckCard[], deployedIds: ReadonlySet<string>): Promise<IPreparedPool> {
        // 碎片进度（已持有/所需）先取好再进 `renderItemFn`：它是排序的分组依据
        // （已上阵 → 已解锁 → 解锁中 → 未拥有），不是可以后补的展示细节。
        const fragments = new Map<string, ZCCardFragmentProgress>();
        await Promise.all(cards.map(async (card) => {
            const status = await cardRepository.loadUpgradeStatus(card.id, this.levelOf(card));
            const cardRequirement = status.requirements.find((item) => item.key === 'card');
            fragments.set(card.id, {
                owned: cardRequirement?.owned ?? 0,
                need: cardRequirement?.need ?? 0,
                maxed: status.maxed || !status.configured,
            });
        }));
        const sortedCards = sortLineupCards(cards, deployedIds, this.heroLevels, fragments, this.art.lineup,
            this.heroListKnown ? 0 : this.fallbackLevel);
        return { cards: sortedCards, fragments, deployedIds };
    }

    /**
     * 卡库图缓存：`id → 已就绪的三张图`。
     *
     * 页面实例级（跨 `refresh` 复用，同 id 同图）；条目在虚拟列表里被复用 / 回收时，
     * 再次滚回来能同步命中，不出现「先空白再出图」。
     */
    private readonly poolFrames = new Map<string, ZCCardFrames>();

    private readonly loadPoolFrames: ZCCardArtLoader = (card) => {
        const cached = this.poolFrames.get(card.id);
        if (cached) return Promise.resolve(cached);
        return cardArtProvider.loadLineupCard(card, this.art).then((frames) => {
            this.poolFrames.set(card.id, frames);
            return frames;
        });
    };

    /**
     * 上一次提交给卡库的数据指纹。`null` = 从未提交过（不能用空串：纯金矿卡库的
     * 指纹就是空串，那样会把「清空旧列表」误判成「没变化」而跳过 `refreshList`）。
     *
     * `refreshList` 会 `setTotalCount` → `_updateVisible(true)` 强制重画所有可见槽位；
     * 数据没变时这一趟纯属白跑，所以指纹相同就只重绑回调、不重建列表。
     */
    private poolSignature: string | null = null;
    private poolCount = -1;

    /** 同步写卡库列表（回调与总条数一起设，避免列表先按旧条数刷一遍）。 */
    private commitPool(data: IPreparedPool): void {
        const { cards, fragments, deployedIds } = data;
        const signature = cards.map((card) => {
            const progress = fragments.get(card.id);
            return `${card.id}:${this.levelOf(card)}:${deployedIds.has(card.id) ? 1 : 0}`
                + `:${progress?.owned ?? 0}:${progress?.need ?? 0}:${progress?.maxed ? 1 : 0}`;
        }).join('|');

        //  两个回调每轮都要重绑：它们闭包捕获本轮的 `cards`，不重绑的话滚动时
        //  槽位复用会拿上一轮的数组（甚至点开升级弹窗点到旧卡）。
        this.cardGrid.renderItemFn = (node, index) => {
            const card = cards[index];
            if (!card) return;
            //  条目 prefab 上必挂 `CardLineupCard`（`CardLineupCard.prefab`），绑错当场抛栈。
            //  已备好的图同步写；没备好的先清空占位，由条目自己按 `loadPoolFrames` 补 ——
            //  `renderItemFn` 仍是同步回调，`await` 移进了条目内部（带 token 防串图）。
            node.getComponent(CardLineupCard).render(card, this.poolFrames.get(card.id) ?? null,
                deployedIds.has(card.id), this.levelOf(card), fragments.get(card.id), this.loadPoolFrames);
        };
        // 点卡库里的任意一张 → 打开卡牌升级弹窗。
        //  回调接在 `onItemClickFn` 上而不是给条目预制体挂 Button：条目是虚拟列表
        // 创建 / 复用 / 回收的，每个槽位在滚动中会换成另一张卡 —— 把点击绑在
        // 「槽位节点」上只有列表自己知道当前是第几张（`VScrollViewItem` 已经替我们做了
        // 按下-抬起位移判定，滑动列表不会误触发）。
        this.cardGrid.onItemClickFn = (_node, index) => {
            const card = cards[index];
            if (card) EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: this, kind: 'upgrade', card });
        };
        const unchanged = signature === this.poolSignature && cards.length === this.poolCount;
        this.poolSignature = signature;
        this.poolCount = cards.length;
        if (unchanged) return;
        this.cardGrid.refreshList(cards.length);
    }

    /**
     * 打开某张卡的升级弹窗（带着它的当前等级）。
     *
     * 升级结果不走回调 —— 弹窗升成功后派发 `CardLineupEvent.HeroUpgraded`，本页在校验
     * `onHeroUpgraded` 里订阅（见 `start()`）。这样弹窗不需要知道外面谁想听，
     * 也不会出现「漏传回调 ⇒ 升级完页面等级不更新且零报错」。
     */
    /** 后端列表已知时，未拥有的卡按 0 级显示；离线预览沿用占位等级。 */
    private levelOf(card: ZCDeckCard): number {
        const level = this.heroLevels.get(card.id);
        if (level !== undefined) return level;
        // 卡库是全表图鉴（含未拥有的卡）：后端列表已经拿到了、但里面没有这张卡，
        // 说明玩家没拥有它 → 按 0 级显示（进度条会渲染成 0/10 的空白条）。
        // 只有后端整个不可用时才退回 `fallbackLevel` 占位，否则离线预览会满屏「0/10」。
        return this.heroListKnown ? 0 : this.fallbackLevel;
    }

    /**
     * 图标行：驱动 `MidBar/BondList` 的横向虚拟列表。
     *
     *  条目 = `visibleIconTallies(deck, art.lineup)` —— 职业与阵营混排、卡数为 0 的维度不进列表
     *  （所以条数是变的：满编八卡通常 5 项左右，不是固定 8）。顺序即表内维度行序，
     *  以后要加维度只改 `PVP-卡牌美术.xlsx` 对应 sheet。
     *
     *  列表参数（方向 / 条目预制体 / 间距 / 缓冲…）全部绑在 prefab 的 Inspector 上
     *  （项目约定：同一份配置不散在代码和 prefab 两处），代码只覆盖 `renderItemFn` + 总条数。
     *
     *  与 `preparePool` 同款：条目数据先到就提交，图标由条目自取（`loadIconFrame`）。
     *  `renderItemFn` 是同步回调，里面不能 `await`，`await` 因此在条目内部（带 token 防串图）。
     */
    private async prepareIcons(deck: readonly ZCDeckCard[]): Promise<IPreparedIcons> {
        const items = visibleIconTallies(deck, this.art.lineup);
        return { items };
    }

    /** 图标缓存：`${kind}|${key} → 图标`（`null` 也要缓存 —— 阵营缺图是已知缺口，别反复重试）。 */
    private readonly iconFrames = new Map<string, SpriteFrame | null>();

    private readonly loadIconFrame = (item: ZCCardTally): Promise<SpriteFrame | null> => {
        const key = `${item.kind}|${item.key}`;
        if (this.iconFrames.has(key)) return Promise.resolve(this.iconFrames.get(key) ?? null);
        return cardArtProvider.loadTallyFrames(item, this.art).then((frame) => {
            this.iconFrames.set(key, frame);
            return frame;
        });
    };

    /** 同步写图标行。条数跟着阵容走：空阵容就是 0，列表清空 —— 别回退成 8。 */
    private commitIcons(data: IPreparedIcons): void {
        const { items } = data;
        this.iconList.renderItemFn = (node, index) => {
            const item = items[index];
            if (!item) return;
            //  条目 prefab 上必挂 `CardLineupBond`（`CardLineupBond.prefab`），绑错就当场抛栈 ——
            //  不写 `if (!view) return`：那只会让列表静默空白，把配置错误藏起来。
            const key = `${item.kind}|${item.key}`;
            node.getComponent(CardLineupBond).render(item, this.iconFrames.get(key) ?? null, this.loadIconFrame);
        };
        this.iconList.refreshList(items.length);
    }

    /** 加成条：左侧写第一条生效羁绊的名字，右侧写当前阵容触发的合计百分比。 */
    private renderBondBanner(bonuses: ZCDeckBonuses): void {
        this.bondTitleLabel.string = activeBondTitle(bonuses);
        this.bondValueLabel.string = `${(bondPercentTotal(bonuses) * 100).toFixed(2)}%`;
    }
}
