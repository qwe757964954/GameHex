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

/** 上阵区一个站台的数据（`null` = 空位）。`frames = null` = 图还在路上，先画空台 + 等级。 */
interface IPreparedSlot {
    readonly card: ZCDeckCard;
    readonly frames: ZCSlotFrames | null;
}

/** 站台图未就绪时喂给 `CardLineupSlot.render` 的空图：三项都缺、不得留上一轮的残留。 */
const EMPTY_SLOT_FRAMES: ZCSlotFrames = { disc: null, hero: null, badge: null };

/** 卡库一次提交要的数据：图**不在这儿**，由条目自己取（见 `commitPool`）。 */
interface IPreparedPool {
    readonly cards: readonly ZCDeckCard[];
    readonly fragments: ReadonlyMap<string, ZCCardFragmentProgress>;
    readonly deployedIds: ReadonlySet<string>;
}

/** 图标行一次提交要的数据：同理，图标由条目自取。 */
interface IPreparedIcons {
    readonly items: readonly ZCCardTally[];
}

/** 每帧最多补几个上阵模型：`sp.Skeleton` 实例化实测 ~1.4~2.7ms/个，八个别挤进一帧。 */
const SLOT_PREVIEWS_PER_FRAME = 2;

/**
 * 「卡牌阵容」页面主控（`assets/resources/ui/card/CardLineup.prefab`）。
 *
 * 版式由 prefab 按设计稿压到 720×1280 摆好，本组件只做三件事：读配置 → 备图 → 灌数据。
 * 底部六格导航归 `MainTabHost` 管，本页没有 `BottomNav` 节点。
 *
 * 三个容器：
 *   - `TeamArea`：挂 `cc.Layout`（GRID / 4 列 / CONTAINER），8 个 `CardLineupSlot` 由它排；
 *     **顺序真源 = 子节点顺序**，别按坐标反推（见 `arenaSlots()`）。
 *   - `CardGrid`：卡库虚拟列表的视窗（挂 `cc.Mask`），条目模板 `CardLineupCard.prefab`，
 *     槽位由列表自建 —— 所以 `getComponentsInChildren(CardLineupCard)` 在本页取不到东西。
 *   - `MidBar/BondList`：横向虚拟列表，条目模板 `CardLineupBond.prefab`。
 *     条目 = 职业与阵营混排，**卡数为 0 的不进列表**（见 `visibleIconTallies`）。
 *
 * 数据来源：
 *   - 八卡 ← 服务端**选中阵型**（`CmdFormationInfo.select === 1`），经 `resolveSelectedDeck()`
 *     映射成卡；拿不到（未连接 / 失败 / 没有选中）才退回本地 `pvpCard.json` 的默认八卡。
 *     布阵面板保存会把阵型置为选中，所以关面板后本页要重刷（见 `onDeckSaved`）。
 *   - 卡库 ← `pvpCard.json` 全表排除金矿；按上阵、解锁与碎片状态排序。
 *   - 等级 / 上限 ← `CmdPvpHeroInfoListReqMsg` 按 `heroId` 关联 `pvpCard.id` + `cardLevelUp.json`。
 *   - 图标计数 ← 八卡按 `traits.attack`（职业）+ `traits.camp`（阵营）推导。
 *   - 羁绊百分比 ← `pvpBond.json` + `calculateDeckBonuses()`。
 *
 * 底部 `TabBar`（兵种 / 神器 + `Lock`）是静态的：本组件不接管选中态，也不给点击回填。
 * 顶部队力「1716」仍是占位（战力系统未落地，走脚本属性 `previewPower`）。
 */
@ccclass('CardLineupPage')
export class CardLineupPage extends Component {
    private presentationResources: IControllerResources = null!;
    initialize(resources: IControllerResources): void { this.presentationResources = resources; }
    private get previewScope(): ResourceScope { return this.presentationResources.scope; }
    private get assets() { return this.presentationResources.assets; }
    private previewAssets: CardUnitPreviewAssets<Prefab> | null = null;

    /**
     * 每次 `presentLineup` 自增。
     *
     * 快照与权威值会**交错**（快照那次还在等美术，权威值就回来了），没有这道门闩
     * 就会出现「权威值先写、快照后到把它盖回旧阵容」。
     */
    private presentRevision = 0;

    /** 上阵区站台（顺序 = 节点树顺序 = Layout 排列顺序，下标 = 卡组下标）。取一次就够。 */
    private arenaSlotCache: CardLineupSlot[] | null = null;

    /** 还没补上单位模型的站台：`commitSlots` 只画静态立绘，模型由 `flushPreviews` 逐帧补。 */
    private pendingPreviews: Array<{ readonly slot: CardLineupSlot; readonly prefab: Prefab }> = [];
    private previewFlushScheduled = false;
    /** 静态首屏提交后下一帧才启动模型加载，避免冷加载争抢 UI 图片的下载与解析。 */
    private previewLoadTask: (() => void) | null = null;

    @property({ type: Label, tooltip: 'TopBar/QualityLabel：品质星下方小字' })
    qualityLabel: Label = null;

    @property({ type: Label, tooltip: 'TopBar/Ribbon/PowerLabel：队力数值' })
    powerLabel: Label = null;

    @property({ type: Label, tooltip: 'Banner/BondTitleLabel：加成条左侧标题（写第一条生效羁绊的名字）' })
    bondTitleLabel: Label = null;

    @property({ type: Label, tooltip: 'Banner/BondValueLabel：加成条右侧百分比' })
    bondValueLabel: Label = null;

    @property({ type: Node, tooltip: 'TeamArea：站台容器（挂 cc.Layout GRID 4 列，8 个 CardLineupSlot 由它排）' })
    teamArea: Node = null;

    @property({
        type: VirtualScrollView,
        tooltip: 'MidBar/BondList：图标行虚拟列表（横向，条目模板 = ui/card/CardLineupBond）。\n' +
            '列表参数全部绑在这个组件的 Inspector 上，代码只覆盖 renderItemFn + 总条数。',
    })
    iconList: VirtualScrollView = null;

    @property({
        type: VirtualScrollView,
        tooltip: 'CardGrid 上的 VirtualScrollView（**直接绑组件**）：卡库列表的视窗；槽位由列表自己建',
    })
    cardGrid: VirtualScrollView = null;

    @property({ tooltip: '队力占位值（战力系统未落地，设计稿上写的是 1716）' })
    previewPower = 1716;

    @property({ tooltip: '后端没有该卡等级时的兜底值（编辑器独立预览 / 后端不可用；卡库里「未拥有」的卡按 0 级显示，不走这里）' })
    fallbackLevel = 3;

    @property({ tooltip: 'cardLevelUp 没有该英雄配置时的等级上限兜底值' })
    fallbackLevelMax = 10;

    @property({ tooltip: '打开界面时自动读表补齐卡组（本页独立预览需要；正式流程里已经注入过就不会再读）' })
    autoLoadDecks = true;

    @property({
        type: Button,
        tooltip: 'MidBar/TeamEdit 上的 cc.Button（**直接绑组件，不是节点**）。\n' +
            '**必绑** —— 代码不判空、不按路径兜底；漏绑由 `card-lineup-ui-regression` 的 prefab 断言当场红。',
    })
    teamEditButton: Button = null;

    /** 后端英雄等级，key 与 `pvpCard.id` 一致。 */
    private heroLevels: ReadonlyMap<string, number> = new Map();

    /**
     * 这一次刷新有没有真拿到后端英雄列表。
     *
     * `true` 时「不在列表里」= 玩家没有这张卡 → 等级按 0 显示；
     * `false`（未连服 / 编辑器独立预览）时整页是离线态，退回 `fallbackLevel` 占位。
     * 少了这个区分，卡库一改成全表就会把 36 张卡全显示成「3级」。
     */
    private heroListKnown = false;

    protected start(): void {
        this.qualityLabel.string = CARD_LINEUP_TEXTS.qualityBonus;
        this.bondTitleLabel.string = CARD_LINEUP_TEXTS.bondBonusTitle;
        this.powerLabel.string = String(Math.max(0, Math.floor(this.previewPower)));
        this.bindTeamEdit();
        this.renderLoading();
        EventMgr.instance.on(CardLineupUiEvent.Render, this.onLineupRender, this);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' });
    }

    /**
     * 首屏两段式：**先本地快照、再权威值**。
     *
     * 快照（上次服务端确认过的阵容）能命中时，第一帧画的就是玩家自己的卡，网络回来只做
     * 静默校正 —— 空窗从「假阵容」变成「旧阵容」。没快照（首次安装 / 过期 / 存坏）就
     * 老老实实停在空台，等 `refresh()` 画真实阵容。
     */
    private readonly onLineupRender = (event: ICardLineupRender): void => {
        if (event.owner === this) void this.presentLineup(event.data).catch(error => {
            if (this.isValid) console.warn('[CardLineup] 渲染失败', error);
        });
    };

    /** 数据没到时的空台：8 个站台一律收起，不留任何「上一次渲染」的残留。 */
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

    /** 「队伍编辑」入口：字段直接绑 `cc.Button`，CLICK 仍挂在**节点**上（Button 自己没有 `on`）。 */
    private bindTeamEdit(): void {
        this.teamEditButton.node.on(Button.EventType.CLICK, this.onTeamEditClick, this);
    }

    /**
     * 打开布阵面板。加载 / 层级 / 关闭都归 `PopupManager` 管，本页只发起。
     *
     *  保存结果不走回调：面板会派发 `CardLineupEvent.DeckSaved`，本页订阅后重刷
     *  （`PopupDef.onClose` 只有一个 `reason`，装不下业务结果）。
     */
    private onTeamEditClick(): void {
        EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: this, kind: 'edit' });
    }

    refresh(): void { EventMgr.instance.emit(CardLineupUiEvent.Intent, { owner: this, kind: 'refresh' }); }

    /**
     * 页面唯一的写节点入口：只渲染，不取数。
     *
     * **一次原子提交**：三块内容（站台 / 卡库 / 图标行）先在 `prepare*` 里备齐**数据**，再同步写完，
     * 最后写羁绊条。分头写会出现「站台已是新阵容、图标行还是旧值」，看起来就是页面抖两下。
     *
     *  图**不进这条关键路径**：站台 8 张图若已预热好就同步带上，没好就先画空台 + 等级、
     *  由 `fillSlotArt` 后台补；卡库图与图标行图标由条目自取（见 `commitPool` / `commitIcons`）。
     *  改之前三段都在 `Promise.all` 里等图，卡库 35 张 × 3 张图实测 817ms、
     *  冷启动站台 8 张 26ms，整页被压到 800ms+ 空白 —— 而虚拟列表首屏只用得到十来个槽位。
     */
    private async presentLineup(data: CardLineupData): Promise<void> {
        this.art = data.art;
        const revision = ++this.presentRevision;
        this.cancelPreviewLoads();
        const deck = visibleLineupCards(data.deck);
        const cards = visibleLineupCards(data.catalog);
        //  `deck` 为空有两种成因，必须分开（与 `presentBoard` 同款口径）：
        //   ① 本地卡表没读到 → 保持空台；② 服务端说「选中阵型没上人」→ 渲染成空站台。
        //  补 `!heroListKnown` 是因为快照路径的 `catalog` 也空，但那是**已知**的数据，不能当 ① 早退。
        if (data.deck.length === 0 && data.catalog.length === 0 && !data.heroListKnown) {
            console.warn('[CardLineupPage] 卡表未读到（deck / catalog 都为空且后端英雄列表不可用），保持空台');
            return;
        }
        this.heroListKnown = data.heroListKnown;
        this.heroLevels = data.heroLevels;
        const deployedIds = new Set(deck.map((card) => card.id));

        //  三段**并发**跑：站台与图标行只依赖本地表，卡库要等权威数据（快照 catalog 为空时跳过）。
        //  `tests/card-lineup-ui-regression.test.ts` 拿 `data.catalog.length > 0 ? this.preparePool`
        //  这个源码形态钉住「快照 catalog 为空要跳过卡库」—— 别包一层函数把它藏起来。
        const [slots, pool, icons] = await Promise.all([
            this.prepareSlots(deck),
            // 快照只负责「上阵八卡」这一块，卡库等权威数据再画（见 `loadLineupSnapshot`）。
            data.catalog.length > 0 ? this.preparePool(cards, deployedIds) : Promise.resolve(null),
            this.prepareIcons(deck),
        ]);
        if (!this.isValid || revision !== this.presentRevision) return;

        this.commitSlots(slots);
        if (pool) this.commitPool(pool);
        this.commitIcons(icons);
        this.renderBondBanner(data.bonuses);
    }

    // ========================================================================
    // 上阵站台：prepare（只取已就绪的图）→ commit（同步画等级 / 空台）→ 图后台补
    // ========================================================================

    /**
     * 站台图缓存（`id → 已就绪的三张图`）。
     *
     * 页面实例级，跨 `refresh` 复用；放着是为了让「预热已跑完」的第二次进页**同步**拿图，
     * 不必再走一次异步补。生命周期跟页面走，不碰 `CardArtProvider` 的会话缓存。
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
     * **不再等图**：只把已经加载好的图带进提交，没好的留 `null` 由 `fillSlotArt` 后台补。
     *
     * 冷启动第一版这里要等 8 张站台图（实测 26ms）—— 切 tab 的 `prefetchHero` 其实已经
     * 发了同样的请求，但冷启动资源下载来不及赶在点击前完成，于是首屏得等它剩下的那段。
     * 现在改成「有就画、没有就先出等级牌」，26ms 从关键路径上彻底消失。
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
        // 新一轮提交同时作废上一轮的分帧计时器：只清队列会让 `previewFlushScheduled`
        // 仍为 true，迟到模型到达时 `schedulePreviews()` 直接 return，而旧计时器可能已被
        // 停用/解绑 ⇒ 模型永远补不上，且零报错。解除后由新模型自己重新注册。
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
            //  先画静态立绘（**不传 `prefab`**），单位模型交给 `flushPreviews` 逐帧补：
            //  八个 `sp.Skeleton` 实例化约 20ms，和整页数据挤在同一帧就是那一下卡顿。
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
     * 8 个站台，下标 = 卡组下标。**顺序取节点树顺序**。
     *
     *  `TeamArea` 挂 GRID Layout，它按子节点顺序排版 —— `_lpos` 是它的**产物**，
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
     *  列表参数（行/列数、主副方向间距、缓冲、滚动风格…）**全部绑在 prefab 的 Inspector 上**
     * （项目约定：同一份配置不散在代码和 prefab 两处），代码只覆盖 `renderItemFn` + 总条数。
     *
     *  ⚠️ 这里**只备数据**（碎片 + 排序），不再全量备图：35 张卡 × 3 张图实测 817ms，
     *  而虚拟列表首屏只用得到十来个槽位 —— 全量备图是在为看不见的卡付首屏时间。
     *  图改由条目自取（`commitPool` 传 `this.loadPoolFrames`），已加载过的同步命中缓存。
     *
     *  条目来自 `pvpCard` 全表并排除金矿；碎片备齐后按状态、品质、等级、职业排序。
     */
    private async preparePool(cards: readonly ZCDeckCard[], deployedIds: ReadonlySet<string>): Promise<IPreparedPool> {
        // 碎片进度（已持有/所需）**先取好**再进 `renderItemFn`：它是排序的分组依据
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
     * 再次滚回来能**同步**命中，不出现「先空白再出图」。
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
     * 上一次提交给卡库的数据指纹。`null` = 从未提交过（**不能用空串**：纯金矿卡库的
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

        //  两个回调**每轮都要重绑**：它们闭包捕获本轮的 `cards`，不重绑的话滚动时
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
     * 图标行：驱动 `MidBar/BondList` 的**横向**虚拟列表。
     *
     *  条目 = `visibleIconTallies(deck, art.lineup)` —— 职业与阵营混排、**卡数为 0 的维度不进列表**
     *  （所以条数是变的：满编八卡通常 5 项左右，不是固定 8）。顺序即表内维度行序，
     *  以后要加维度只改 `PVP-卡牌美术.xlsx` 对应 sheet。
     *
     *  列表参数（方向 / 条目预制体 / 间距 / 缓冲…）全部绑在 prefab 的 Inspector 上
     *  （项目约定：同一份配置不散在代码和 prefab 两处），代码只覆盖 `renderItemFn` + 总条数。
     *
     *  与 `preparePool` 同款：条目数据先到就提交，图标由条目自取（`loadIconFrame`）。
     *  `renderItemFn` 是**同步**回调，里面不能 `await`，`await` 因此在条目内部（带 token 防串图）。
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
