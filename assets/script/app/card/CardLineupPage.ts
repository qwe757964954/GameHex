import { _decorator, Button, Component, Label, Node, Prefab, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { ComponentController } from '../../framework/controller/ComponentController';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { cardArtProvider } from './CardArtProvider';
import { CardLineupBond } from './CardLineupBond';
import { CardLineupCard } from './CardLineupCard';
import type { ZCCardFrames, ZCCardFragmentProgress } from './CardLineupCard';
import { cardRepository } from './CardRepository';
import type { CardLineupData } from './CardRepository';
import { CardLineupSlot } from './CardLineupSlot';
import type { ZCSlotFrames } from './CardLineupSlot';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardUpgradePage } from './CardUpgradePage';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import type { ICardUpgradeOpenData } from './CardUpgradePage';
import {
    activeBondTitle,
    bondPercentTotal,
    visibleIconTallies,
} from './CardLineupTypes';
import type { ZCCardTally } from './CardLineupTypes';
import { LineupBoardPage } from './LineupBoardPage';
import { CardLineupEvent } from './CardLineupEvents';
import type { ICardDeckSavedPayload, IHeroUpgradedPayload } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/** 上阵区一个站台**备好的**数据（`null` = 空位）；先备齐、再一次性写，见 `presentLineup`。 */
interface IPreparedSlot {
    readonly card: ZCDeckCard;
    readonly frames: ZCSlotFrames;
    readonly prefab: Prefab | null;
}

/** 卡库一次提交要的全部数据（图与进度都已在手，`renderItemFn` 里只做同步赋值）。 */
interface IPreparedPool {
    readonly cards: readonly ZCDeckCard[];
    readonly frames: ReadonlyMap<string, ZCCardFrames>;
    readonly fragments: ReadonlyMap<string, ZCCardFragmentProgress>;
    readonly deployedIds: ReadonlySet<string>;
}

/** 图标行一次提交要的全部数据。 */
interface IPreparedIcons {
    readonly items: readonly ZCCardTally[];
    readonly frames: ReadonlyMap<string, SpriteFrame | null>;
}

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
 *   - 卡库 ← `pvpCard.json` **全表**（图鉴口径，与拥有关系无关，断网也是完整一屏）。
 *   - 等级 / 上限 ← `CmdPvpHeroInfoListReqMsg` 按 `heroId` 关联 `pvpCard.id` + `cardLevelUp.json`。
 *   - 图标计数 ← 八卡按 `traits.attack`（职业）+ `traits.camp`（阵营）推导。
 *   - 羁绊百分比 ← `pvpBond.json` + `calculateDeckBonuses()`。
 *
 * 底部 `TabBar`（兵种 / 神器 + `Lock`）是静态的：本组件不接管选中态，也不给点击回填。
 * 顶部队力「1716」仍是占位（战力系统未落地，走脚本属性 `previewPower`）。
 */
@ccclass('CardLineupPage')
export class CardLineupPage extends Component {
    /** 取数轮次：`bootstrap()` 的快照那次与 `refresh()` 的权威值那次会交错，用它丢掉过期结果。 */
    private lineupRevision = 0;
    private readonly controller = new ComponentController('card-lineup-preview');
    private get previewScope(): ResourceScope { return this.controller.scope; }
    private get assets() { return this.controller.resources.assets; }
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
        //  布阵面板保存成功 → 重刷本页（`onDeckSaved`）；卡升级成功 → 回写等级 + 重刷
        //  （`onHeroUpgraded`）。订阅必须在 `onDestroy` 里摘掉 —— `EventMgr` 是全局单例，
        //  页面是切 tab 就销毁重建的，不摘就会留着旧实例被回调。
        EventMgr.instance.on(CardLineupEvent.DeckSaved, this.onDeckSaved, this);
        EventMgr.instance.on(CardLineupEvent.HeroUpgraded, this.onHeroUpgraded, this);
        //  先把 8 个站台收起，再开始取数：prefab 的默认外观（8 个同款雕像 + 「3级」）
        // 是**假数据**，一帧都不该露出来。`start()` 在首帧渲染之前跑，所以这里来得及。
        this.renderLoading();
        void this.bootstrap();
    }

    /**
     * 首屏两段式：**先本地快照、再权威值**。
     *
     * 快照（上次服务端确认过的阵容）能命中时，第一帧画的就是玩家自己的卡，网络回来只做
     * 静默校正 —— 空窗从「假阵容」变成「旧阵容」。没快照（首次安装 / 过期 / 存坏）就
     * 老老实实停在空台，等 `refresh()` 画真实阵容。
     */
    private async bootstrap(): Promise<void> {
        const snapshot = cardRepository.loadLineupSnapshot();
        if (snapshot) await this.presentLineup(snapshot);
        await this.refresh();
    }

    /** 数据没到时的空台：8 个站台一律收起，不留任何「上一次渲染」的残留。 */
    private renderLoading(): void {
        for (const slot of this.arenaSlots()) slot.setEmpty();
    }

    protected onDestroy(): void {
        EventMgr.instance.offTarget(this);
        this.presentRevision += 1;
        this.arenaSlotCache = null;
        this.controller.dispose();
        this.lineupRevision += 1;
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
        void LineupBoardPage.open();
    }

    /** 布阵保存成功：本页八卡读的是「选中阵型」，而保存会把它置为选中，所以必须重刷。 */
    private onDeckSaved(_payload: ICardDeckSavedPayload): void {
        //  不判存活：订阅在 `onDestroy` 里摘掉了，页面没了就收不到这条。
        void this.refresh();
    }

    /**
     * 取一次权威阵容并渲染。
     *
     *  `lineupRevision` 挡「快照那次」与「这次权威值」的先后 —— 慢的那次回来不许覆盖快的。
     */
    async refresh(): Promise<void> {
        const revision = ++this.lineupRevision;
        const data = await cardRepository.loadLineup(this.autoLoadDecks);
        if (revision !== this.lineupRevision) return;
        await this.presentLineup(data);
    }

    /**
     * 页面唯一的写节点入口：只渲染，不取数。
     *
     * **一次原子提交**：三块内容（站台 / 卡库 / 图标行）先在 `prepare*` 里备齐，再同步写完，
     * 最后写羁绊条。分头写会出现「站台已是新阵容、图标行还是旧值」，看起来就是页面抖两下。
     */
    private async presentLineup(data: CardLineupData): Promise<void> {
        const revision = ++this.presentRevision;
        const { deck, catalog: cards } = data;
        //  `deck` 为空有两种成因，必须分开（与 `presentBoard` 同款口径）：
        //   ① 本地卡表没读到 → 保持空台；② 服务端说「选中阵型没上人」→ 渲染成空站台。
        //  补 `!heroListKnown` 是因为快照路径的 `catalog` 也空，但那是**已知**的数据，不能当 ① 早退。
        if (deck.length === 0 && cards.length === 0 && !data.heroListKnown) {
            console.warn('[CardLineupPage] 卡表未读到（deck / catalog 都为空且后端英雄列表不可用），保持空台');
            return;
        }
        this.heroListKnown = data.heroListKnown;
        this.heroLevels = data.heroLevels;
        const deployedIds = new Set(deck.map((card) => card.id));

        const [slots, pool, icons] = await Promise.all([
            this.prepareSlots(deck),
            // 快照只负责「上阵八卡」这一块，卡库等权威数据再画（见 `loadLineupSnapshot`）。
            cards.length > 0 ? this.preparePool(cards, deployedIds) : Promise.resolve(null),
            this.prepareIcons(deck),
        ]);
        if (revision !== this.presentRevision) return;

        this.commitSlots(slots);
        if (pool) this.commitPool(pool);
        this.commitIcons(icons);
        this.renderBondBanner(data.bonuses);
    }

    // ========================================================================
    // 上阵站台：prepare（备图）→ commit（同步全量写）
    // ========================================================================

    /** 按八卡顺序把 8 个站台要的数据备齐（`null` = 该位空着）。**不写节点**。 */
    private async prepareSlots(deck: readonly ZCDeckCard[]): Promise<ReadonlyArray<IPreparedSlot | null>> {
        const slots = this.arenaSlots();
        const previewAssets = this.unitPreviewAssets();
        const ready = await Promise.all(deck.slice(0, slots.length).map(async (card) => ({
            card,
            frames: await cardArtProvider.loadLineupSlot(card),
            prefab: await previewAssets.load(card),
        })));
        const items: Array<IPreparedSlot | null> = [];
        for (let index = 0; index < slots.length; index += 1) items.push(ready[index] ?? null);
        return items;
    }

    /** 同步写 8 个站台：有卡就整格重画，没卡就收起（不留上一轮的残留）。 */
    private commitSlots(items: ReadonlyArray<IPreparedSlot | null>): void {
        const slots = this.arenaSlots();
        for (let index = 0; index < slots.length; index += 1) {
            const item = items[index];
            if (!item) {
                slots[index].setEmpty();
                continue;
            }
            slots[index].node.active = true;
            slots[index].render(item.card, item.frames, this.levelOf(item.card), item.prefab);
        }
    }

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
     * 三张图先按整份英雄卡库预加载完再喂列表：`renderItemFn` 是**同步**回调，里面不能 `await`，
     * 否则槽位复用到新索引时会先闪一帧上一张卡的图。
     *
     * 条目 = `pvpCard` **全表**（`loadPvpCatalogCards()`，配置驱动，不按后端拥有关系过滤）；
     * 后端英雄列表只决定两件事：等级（未拥有 → 0 级）与「已出战！」标
     * （id 位于当前八卡集合里才显示）。
     */
    private async preparePool(cards: readonly ZCDeckCard[], deployedIds: ReadonlySet<string>): Promise<IPreparedPool> {
        const frames = new Map<string, ZCCardFrames>();
        await Promise.all(cards.map(async (card) => {
            frames.set(card.id, await cardArtProvider.loadLineupCard(card));
        }));

        // 碎片进度（已持有/所需）**先取好**再进 `renderItemFn`。
        // ⚠️ `renderItemFn` 是**同步**回调（槽位复用，await 会闪上一张卡的图，注释见下），
        //    所以不能在里面 `await loadUpgradeStatus`。
        // 卡库进度显示升级所需的本卡数量；经验是升级弹窗里的另一项材料。
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
        return { cards, frames, fragments, deployedIds };
    }

    /** 同步写卡库列表（回调与总条数一起设，避免列表先按旧条数刷一遍）。 */
    private commitPool(data: IPreparedPool): void {
        const { cards, frames, fragments, deployedIds } = data;

        this.cardGrid.renderItemFn = (node, index) => {
            const card = cards[index];
            if (!card) return;
            //  条目 prefab 上必挂 `CardLineupCard`（`CardLineupCard.prefab`），绑错当场抛栈。
            node.getComponent(CardLineupCard).render(card, frames.get(card.id), deployedIds.has(card.id),
                this.levelOf(card), fragments.get(card.id));
        };
        // 点卡库里的任意一张 → 打开卡牌升级弹窗。
        //  回调接在 `onItemClickFn` 上而不是给条目预制体挂 Button：条目是虚拟列表
        // 创建 / 复用 / 回收的，每个槽位在滚动中会换成另一张卡 —— 把点击绑在
        // 「槽位节点」上只有列表自己知道当前是第几张（`VScrollViewItem` 已经替我们做了
        // 按下-抬起位移判定，滑动列表不会误触发）。
        this.cardGrid.onItemClickFn = (_node, index) => {
            const card = cards[index];
            if (card) void this.openUpgrade(card);
        };
        this.cardGrid.refreshList(cards.length);
    }

    /**
     * 打开某张卡的升级弹窗（带着它的当前等级）。
     *
     * 升级结果不走回调 —— 弹窗升成功后派发 `CardLineupEvent.HeroUpgraded`，本页在校验
     * `onHeroUpgraded` 里订阅（见 `start()`）。这样弹窗不需要知道外面谁想听，
     * 也不会出现「漏传回调 ⇒ 升级完页面等级不更新且零报错」。
     */
    private async openUpgrade(card: ZCDeckCard): Promise<void> {
        await CardUpgradePage.open({
            userData: {
                card,
                cardId: card.id,
                level: this.levelOf(card),
            } satisfies ICardUpgradeOpenData,
        });
    }

    /**
     * 升级成功的回写：先把新等级塞进本页缓存（布阵面板不再发包，不补这一步它那边还是旧等级），
     * 再整页重刷一次。
     *
     * 重刷会**重新向后端要一次英雄列表**（`fetchPvpHeroInfos` 不做缓存命中），
     * 拿到的就是权威值；上面那步是给「不走本页重刷」的调用方兜底。
     */
    private onHeroUpgraded(payload: IHeroUpgradedPayload): void {
        const next = new Map(this.heroLevels);
        next.set(String(payload.heroId), payload.level);
        this.heroLevels = next;
        //  同上：事件订阅已随 `offTarget` 摘掉，这里不用再判存活。
        void this.refresh();
    }

    /** 金矿等非英雄卡没有后端等级，继续使用 prefab 上的兜底值。 */
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
     *  条目 = `visibleIconTallies(deck)` —— 职业与阵营混排、**卡数为 0 的维度不进列表**
     *  （所以条数是变的：满编八卡通常 5 项左右，不是固定 8）。顺序即设计稿从左到右，
     *  以后要加维度只改 `CardLineupTypes` 那两个纯函数。
     *
     *  列表参数（方向 / 条目预制体 / 间距 / 缓冲…）全部绑在 prefab 的 Inspector 上
     *  （项目约定：同一份配置不散在代码和 prefab 两处），代码只覆盖 `renderItemFn` + 总条数。
     *
     *  与 `renderCards` 同款：先把这些项的图标**全部异步备好**再喂列表 ——
     *  `renderItemFn` 是**同步**回调，里面不能 `await`，否则槽位复用到新下标时会先闪一帧上一项的图
     *  （阵营那几张现在拿不到图，是美术缺口，见 `CAMP_ICON_ON_ART`）。
     */
    private async prepareIcons(deck: readonly ZCDeckCard[]): Promise<IPreparedIcons> {
        const items = visibleIconTallies(deck);
        const frames = new Map<string, SpriteFrame | null>();
        await Promise.all(items.map(async (item) => {
            frames.set(`${item.kind}|${item.key}`, await cardArtProvider.loadTallyFrames(item));
        }));
        return { items, frames };
    }

    /** 同步写图标行。条数跟着阵容走：空阵容就是 0，列表清空 —— 别回退成 8。 */
    private commitIcons(data: IPreparedIcons): void {
        const { items, frames } = data;
        this.iconList.renderItemFn = (node, index) => {
            const item = items[index];
            if (!item) return;
            //  条目 prefab 上必挂 `CardLineupBond`（`CardLineupBond.prefab`），绑错就当场抛栈 ——
            //  不写 `if (!view) return`：那只会让列表静默空白，把配置错误藏起来。
            node.getComponent(CardLineupBond).render(item, frames.get(`${item.kind}|${item.key}`) ?? null);
        };
        this.iconList.refreshList(items.length);
    }

    /** 加成条：左侧写第一条生效羁绊的名字，右侧写当前阵容触发的合计百分比。 */
    private renderBondBanner(bonuses: ZCDeckBonuses): void {
        this.bondTitleLabel.string = activeBondTitle(bonuses);
        this.bondValueLabel.string = `${(bondPercentTotal(bonuses) * 100).toFixed(2)}%`;
    }
}
