import { _decorator, Button, Component, Label, Node, Prefab, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import type { AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCDeckBonuses, ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { cardArtProvider } from './CardArtProvider';
import { CardLineupBond } from './CardLineupBond';
import { CardLineupCard } from './CardLineupCard';
import type { ZCCardFrames, ZCCardFragmentProgress } from './CardLineupCard';
import { cardRepository } from './CardRepository';
import type { CardLineupData } from './CardRepository';
import { CardLineupPresenter } from './CardPresenters';
import { CardLineupSlot } from './CardLineupSlot';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardUpgradePage } from './CardUpgradePage';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import type { ICardUpgradeOpenData } from './CardUpgradePage';
import {
    activeBondTitle,
    bondPercentTotal,
    visibleIconTallies,
} from './CardLineupTypes';
import { LineupBoardPage } from './LineupBoardPage';
import type { ILineupBoardOpenSession } from './LineupBoardPage';

const { ccclass, property } = _decorator;

/**
 * 「卡牌阵容」页面主控（`assets/resources/ui/card/CardLineup.prefab`）。
 *
 * 版式全部由 prefab 按设计稿 `assets/resources/image/卡牌阵容.png`（720×1610）
 * 压到 720×1280 摆好，本组件只做三件事：读配置 → 备图 → 灌数据。
 *
 *  本页**不含底部六格导航** —— 六格归主界面宿主 `MainRoot` 的 `MainTabHost` 管，
 * 本页的 prefab 里没有 `BottomNav` 节点，切换 tab 由宿主负责。
 *
 * 容器分工（2026-09-15 改，2026-09-22 又加了图标行）：
 *   - `TeamArea` 挂 `cc.Layout`（GRID / 4 列 / `resizeMode=CONTAINER`），8 个站台由 Layout 排，
 *     本组件**不再**逐个摆位置；尺寸也由 Layout 算（刚好包住 4×2 格）；
 *   - `CardGrid` 是虚拟列表 `VirtualScrollView` 的视窗（挂 `cc.Mask`），条目模板 =
 *     `CardLineupCard.prefab`，槽位由列表自己建/复用 —— 所以卡库**没有**常驻的 8 个实例，
 *     `getComponentsInChildren(CardLineupCard)` 在本页已经取不到东西了。
 *   - `MidBar/BondList` 是**第二条**虚拟列表（横向），条目模板 = `CardLineupBond.prefab`，
 *     条目 = 职业与阵营混排、**卡数为 0 的不进列表**（见 `visibleIconTallies`）。
 *     原来这里是 `Bond1..Bond4` 四个写死的嵌套实例（只有职业），
 *     改成列表是为了「条目数跟着数据走、超宽自动可滑」；同理
 *     `getComponentsInChildren(CardLineupBond)` 在这里也取不到东西。
 *
 * 站台与中栏仍用 `getComponentsInChildren`，省掉一批 Inspector 绑定；
 * 但**不依赖节点树顺序** —— 编辑器里批量建节点时兄弟顺序是不确定的
 * （实测并行创建同一批节点会乱序），所以统一用 `gridOrder()` 按节点坐标
 * 排成「从上到下、从左到右」，位置才是稳定契约。
 *
 * 数据来源：
 *   - 上阵八卡            ← 服务端**选中阵型**（`CmdFormationInfo.select === 1`）的 `heroId` 列表，
 *                          经 `LineupPresets.resolveSelectedDeck()` 映射成卡；拿不到阵型数据
 *                          （未连接 / 请求失败 / 没有选中阵型）才退回本地 `pvpCard.json`
 *                          的「玩家默认」八卡。布阵面板保存时会把该阵型置为选中，所以
 *                          关面板后本页要重刷（见 `onTeamEditClick`）
 *   - 下栏卡库（`CardGrid`）← `pvpCard.json` **全表**（图鉴口径，见 `loadPvpCatalogCards()`），
 *                          与后端拥有关系无关；断网时也照样是完整一屏
 *   - 已拥有英雄与等级    ← `CmdPvpHeroInfoListReqMsg`，按 `heroId` 关联 `pvpCard.id`
 *                          （只用来填等级 + 标「已出战！」，未拥有的卡显示 0 级）
 *   - 英雄等级上限        ← `cardLevelUp.json`
 *   - 中栏图标行计数      ← 由八卡按 `traits.attack`（职业）+ `traits.camp`（阵营）推导（见 CardLineupTypes）
 *   - 羁绊加成条百分比    ← `pvpBond.json` + `calculateDeckBonuses()`
 *   - 品级 / 卡面配色     ← `card.rarity`（绿1 蓝2 紫3 金4）
 *
 *  底部 `TabBar`（`TabLabel1`「兵种」/ `TabLabel2`「神器」+ `Lock`）**是静态的**：
 * 当前只做「兵种」这一屏，prefab 里第一格就是选中态、第二格灰字 + 上锁，正是要的样子，
 * 所以本组件不接管它，也不给点击回填。要接神器时再在这里加选中态切换与第二份数据源。
 *
 *  顶部队力「1716」仍是占位：战力系统未落地，目前使用脚本上的可调属性。
 */
@ccclass('CardLineupPage')
export class CardLineupPage extends Component {
    private readonly presenter = new CardLineupPresenter(cardRepository);
    private readonly previewScope = new ResourceScope('card-lineup-preview');
    private assets: AssetService | null = null;
    private previewAssets: CardUnitPreviewAssets<Prefab> | null = null;
    private slotsRevision = 0;

    initialize(assets: AssetService): void {
        this.assets = assets;
    }
    @property({ type: Label, tooltip: 'TopBar/QualityLabel：品质星下方小字' })
    qualityLabel: Label = null!;

    @property({ type: Label, tooltip: 'TopBar/Ribbon/PowerLabel：队力数值' })
    powerLabel: Label = null!;

    @property({ type: Label, tooltip: 'Banner/BondTitleLabel：加成条左侧标题（写第一条生效羁绊的名字）' })
    bondTitleLabel: Label = null!;

    @property({ type: Label, tooltip: 'Banner/BondValueLabel：加成条右侧百分比' })
    bondValueLabel: Label = null!;

    @property({ type: Node, tooltip: 'TeamArea：站台容器（挂 cc.Layout GRID 4 列，8 个 CardLineupSlot 由它排）' })
    teamArea: Node = null!;

    @property({
        type: VirtualScrollView,
        tooltip: 'MidBar/BondList：图标行虚拟列表（横向，条目模板 = ui/card/CardLineupBond）。\n' +
            '列表参数全部绑在这个组件的 Inspector 上，代码只覆盖 renderItemFn + 总条数。',
    })
    iconList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'CardGrid：卡库虚拟列表的视窗节点（挂 VirtualScrollView + Mask）；槽位由列表自己建，本组件只喂数据' })
    cardGrid: Node = null!;

    @property({ tooltip: '队力占位值（战力系统未落地，设计稿上写的是 1716）' })
    previewPower = 1716;

    @property({ tooltip: '后端没有该卡等级时的兜底值（编辑器独立预览 / 后端不可用；卡库里「未拥有」的卡按 0 级显示，不走这里）' })
    fallbackLevel = 3;

    @property({ tooltip: 'cardLevelUp 没有该英雄配置时的等级上限兜底值' })
    fallbackLevelMax = 10;

    @property({ tooltip: '打开界面时自动读表补齐卡组（本页独立预览需要；正式流程里已经注入过就不会再读）' })
    autoLoadDecks = true;

    @property({
        type: Node,
        tooltip: 'MidBar/TeamEdit：「队伍编辑」按钮（节点上挂 cc.Button）——点击打开布阵面板。\n' +
            '留空时按路径 MidBar/TeamEdit 自动查找。',
    })
    teamEditButton: Node | null = null;

    /** 后端英雄等级，key 与 `pvpCard.id` 一致。 */
    private heroLevels: ReadonlyMap<string, number> = new Map();

    /** `cardLevelUp` 中每个英雄的最高等级。 */
    private heroLevelCaps: ReadonlyMap<string, number> = new Map();

    /**
     * 这一次刷新有没有真拿到后端英雄列表。
     *
     * `true` 时「不在列表里」= 玩家没有这张卡 → 等级按 0 显示；
     * `false`（未连服 / 编辑器独立预览）时整页是离线态，退回 `fallbackLevel` 占位。
     * 少了这个区分，卡库一改成全表就会把 36 张卡全显示成「3级」。
     */
    private heroListKnown = false;

    /**
     * 按「从上到下、从左到右」排同组实例。
     *
     * 一行内的实例 y 完全相同，所以先比 y、再比 x；`1` 的容差是为了
     * 容忍浮点与手工微调，避免同一行被判成两行。
     */
    private static gridOrder<T extends Component>(items: readonly T[]): T[] {
        return items.slice().sort((a, b) => {
            const pa = a.node.position, pb = b.node.position;
            if (Math.abs(pa.y - pb.y) > 1) return pb.y - pa.y;
            return pa.x - pb.x;
        });
    }

    protected start(): void {
        this.qualityLabel.string = CARD_LINEUP_TEXTS.qualityBonus;
        this.bondTitleLabel.string = CARD_LINEUP_TEXTS.bondBonusTitle;
        this.powerLabel.string = String(Math.max(0, Math.floor(this.previewPower)));
        this.bindTeamEdit();
        void this.refresh();
    }

    protected onDestroy(): void {
        this.slotsRevision += 1;
        this.previewScope.dispose();
        this.presenter.dispose();
    }

    /**
     * 接上「队伍编辑」入口：`MidBar/TeamEdit` 上的 `cc.Button` 被点击 → 打开布阵面板。
     *
     *  CLICK 事件挂在**节点**上（`Button` 自身没有 `on`），别写成 `button.on(...)`。
     * 按项目约定不手动 `off` —— 监听随节点销毁由引擎自动清理。
     */
    private bindTeamEdit(): void {
        const teamEdit = this.teamEditNode;
        const button = teamEdit ? teamEdit.getComponent(Button) : null;
        if (!button) {
            console.warn('[CardLineupPage] MidBar/TeamEdit 上没有 cc.Button，布阵入口未接');
            return;
        }
        button.node.on(Button.EventType.CLICK, this.onTeamEditClick, this);
    }

    /**
     * 「队伍编辑」按钮节点。
     * 优先用 Inspector 绑定，没绑就按路径查 —— 与 `LineupBoardPage.poolList` 同一套思路：
     * 能绑就绑，绑不上也不至于静默失效（脚本新增的 `@property` 在编辑器热重载前绑不了）。
     */
    private get teamEditNode(): Node | null {
        if (this.teamEditButton && this.teamEditButton.isValid) return this.teamEditButton;
        const found = this.node.getChildByPath('MidBar/TeamEdit');
        if (found) this.teamEditButton = found;
        return found;
    }

    /**
     * 打开布阵面板（`assets/resources/ui/card/LineupBoard.prefab`）。
     *
     * `LineupBoardPage` 是 `PopupBase`，加载 / 层级 / 关闭都归常驻 `Popup` 节点上的
     * `PopupManager` 管，本页只负责发起；`open()` 内部会走 `onOpen()` → `refresh()` 重新读表。
     *
     *  **关面板要重刷本页**：八卡读的是服务端「选中阵型」，而布阵面板保存时会把该阵型
     * 置成选中（见 `FormationService` 的 `select = 1`）—— 不刷的话关掉面板看到的还是旧阵容。
     *  只在**真保存过**时才刷：没改就关面板不该白发一次英雄列表请求
     * （`fetchPvpHeroInfos` 不做缓存命中，见 `PvpHeroService`）。
     */
    private async onTeamEditClick(): Promise<void> {
        // 同类弹窗去重、加载中关闭与重开都由 PopupManager 统一保证，业务入口不再维护易失锁。
        const session: ILineupBoardOpenSession = {};
        session.assets = this.assets;
        await LineupBoardPage.open({
            userData: session,
            onClose: () => { if (session.saved) void this.refresh(); },
        });
    }

    /** 重新读一遍数据并刷新整页（阵容变化后调用）。 */
    async refresh(): Promise<void> {
        await this.presenter.refresh(this.autoLoadDecks, {
            isAlive: () => !!this.node && this.node.isValid,
            presentLineup: (data) => this.presentLineup(data),
        });
    }

    /** Presenter 的唯一页面写入口：这里只做节点渲染，不再请求数据。 */
    private async presentLineup(data: CardLineupData): Promise<void> {
        const { deck, catalog: cards } = data;
        //  `deck` 为空有两种完全不同的成因，必须分开（与布阵面板 `presentBoard` 同款口径）：
        //   ① 本地卡表就没读到（连 catalog 一起是空的）→ 保持 prefab 占位外观，别把页面清空；
        //   ② 服务端明确说「当前选中的阵型一个英雄都没上」（玩家一键下阵后保存）→ 该渲染成空站台。
        //  以前 `deck` 只来自本地卡表（非空即有），所以「空就 return」不会出问题；
        //  现在它可能来自阵型，② 会被那条早退误伤成「下阵没生效」。
        if (deck.length === 0 && cards.length === 0) {
            console.warn('[CardLineupPage] 卡表未读到（deck 与 catalog 都为空），保持 prefab 占位外观');
            return;
        }

        this.heroListKnown = data.heroListKnown;
        this.heroLevels = data.heroLevels;
        this.heroLevelCaps = data.heroLevelCaps;
        const deployedIds = new Set(deck.map((card) => card.id));

        await Promise.all([
            this.renderSlots(deck),
            this.renderCards(cards, deployedIds),
            this.renderIconRow(deck),
        ]);
        if (!this.node || !this.node.isValid) return;
        this.renderBondBanner(data.bonuses);
    }

    /** 上阵站台：按八卡顺序填满 8 个实例。 */
    private async renderSlots(deck: readonly ZCDeckCard[]): Promise<void> {
        const revision = ++this.slotsRevision;
        const slots = CardLineupPage.gridOrder(this.teamArea.getComponentsInChildren(CardLineupSlot));
        const previewAssets = this.unitPreviewAssets();
        const ready = await Promise.all(deck.slice(0, slots.length).map(async (card) => ({
            card,
            frames: await cardArtProvider.loadLineupSlot(card),
            prefab: await previewAssets?.load(card) ?? null,
        })));
        if (!this.node || !this.node.isValid || revision !== this.slotsRevision) return;
        for (let index = 0; index < slots.length; index += 1) {
            const item = ready[index];
            if (!item) {
                slots[index].setEmpty();
                continue;
            }
            slots[index].node.active = true;
            slots[index].render(item.card, item.frames, this.levelOf(item.card), item.prefab);
        }
    }

    private unitPreviewAssets(): CardUnitPreviewAssets<Prefab> | null {
        const assets = this.assets;
        if (!assets) return null;
        if (!this.previewAssets) {
            this.previewAssets = new CardUnitPreviewAssets(
                (path) => assets.load(path, Prefab, { scope: this.previewScope }));
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
    private async renderCards(cards: readonly ZCDeckCard[], deployedIds: ReadonlySet<string>): Promise<void> {
        const list = this.cardGrid.getComponent(VirtualScrollView)!;

        const frames = new Map<string, ZCCardFrames>();
        await Promise.all(cards.map(async (card) => {
            frames.set(card.id, await cardArtProvider.loadLineupCard(card));
        }));

        // 碎片进度（已持有/所需）**先取好**再进 `renderItemFn`。
        // ⚠️ `renderItemFn` 是**同步**回调（槽位复用，await 会闪上一张卡的图，注释见下），
        //    所以不能在里面 `await loadUpgradeStatus`。
        // 卡库进度显示升级所需的本卡数量；经验是升级弹窗里的另一项材料。
        const fragmentByCard = new Map<string, ZCCardFragmentProgress>();
        await Promise.all(cards.map(async (card) => {
            const status = await cardRepository.loadUpgradeStatus(card.id, this.levelOf(card));
            const cardRequirement = status.requirements.find((item) => item.key === 'card');
            fragmentByCard.set(card.id, {
                owned: cardRequirement?.owned ?? 0,
                need: cardRequirement?.need ?? 0,
                maxed: status.maxed || !status.configured,
            });
        }));

        if (!this.node.isValid || !list.node.isValid) return;

        list.renderItemFn = (node, index) => {
            const card = cards[index];
            if (!card) return;
            const view = node.getComponent(CardLineupCard);
            if (!view) return;
            view.render(card, frames.get(card.id)!, deployedIds.has(card.id),
                this.levelOf(card), fragmentByCard.get(card.id));
        };
        // 点卡库里的任意一张 → 打开卡牌升级弹窗。
        //  回调接在 `onItemClickFn` 上而不是给条目预制体挂 Button：条目是虚拟列表
        // 创建 / 复用 / 回收的，每个槽位在滚动中会换成另一张卡 —— 把点击绑在
        // 「槽位节点」上只有列表自己知道当前是第几张（`VScrollViewItem` 已经替我们做了
        // 按下-抬起位移判定，滑动列表不会误触发）。
        list.onItemClickFn = (_node, index) => {
            const card = cards[index];
            if (card) void this.openUpgrade(card);
        };
        list.refreshList(cards.length);
    }

    /** 打开某张卡的升级弹窗（带着它的当前等级）。 */
    private async openUpgrade(card: ZCDeckCard): Promise<void> {
        await CardUpgradePage.open({
            userData: {
                card,
                cardId: card.id,
                level: this.levelOf(card),
                onUpgraded: (heroId, level) => this.onHeroUpgraded(heroId, level),
            } satisfies ICardUpgradeOpenData,
        });
    }

    /**
     * 升级成功的回写：先把新等级塞进 `PvpHeroService` 的缓存（布阵面板不再发包，
     * 不补这一步它那边还是旧等级），再整页重刷一次。
     *
     * 重刷会**重新向后端要一次英雄列表**（`fetchPvpHeroInfos` 不做缓存命中），
     * 拿到的就是权威值；上面那步是给「不走本页重刷」的调用方兜底。
     */
    private onHeroUpgraded(heroId: number, level: number): void {
        const next = new Map(this.heroLevels);
        next.set(String(heroId), level);
        this.heroLevels = next;
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
    private async renderIconRow(deck: readonly ZCDeckCard[]): Promise<void> {
        const list = this.iconList;
        const items = visibleIconTallies(deck);

        const frames = new Map<string, SpriteFrame | null>();
        await Promise.all(items.map(async (item) => {
            frames.set(`${item.kind}|${item.key}`, await cardArtProvider.loadTallyFrames(item));
        }));
        // 加载期间整页可能已经被换掉（切 tab / 退出登录），别再往释放掉的列表上写。
        if (!this.node || !this.node.isValid || !list.node.isValid) return;

        list.renderItemFn = (node, index) => {
            const item = items[index];
            if (!item) return;
            const view = node.getComponent(CardLineupBond);
            if (!view) return;
            view.render(item, frames.get(`${item.kind}|${item.key}`) ?? null);
        };
        // 条数跟着阵容走：全零（空阵容）时这里就是 0，列表清空 —— 别回退成 8。
        list.refreshList(items.length);
    }

    /** 加成条：左侧写第一条生效羁绊的名字，右侧写当前阵容触发的合计百分比。 */
    private renderBondBanner(bonuses: ZCDeckBonuses): void {
        this.bondTitleLabel.string = activeBondTitle(bonuses);
        this.bondValueLabel.string = `${(bondPercentTotal(bonuses) * 100).toFixed(2)}%`;
    }
}
