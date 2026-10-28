import {
    _decorator,
    Button,
    Color,
    Label,
    Node,
    Prefab,
    Sprite,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import type { AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { cardArtProvider } from './CardArtProvider';
import { cardRepository } from './CardRepository';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import {
    tallyDeckClasses,
    ZC_CARD_CLASSES,
} from './CardLineupTypes';
import { LineupBoardCard } from './LineupBoardCard';
import type { IBoardCardHost, ZCBoardCardFrames } from './LineupBoardCard';
import { LineupBoardClassItem } from './LineupBoardClassItem';
import { LineupBoardSlot } from './LineupBoardSlot';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import type { LineupBoardPresentation } from './CardPresentations';
import { LineupDraftStore } from './LineupDraftStore';
import type { LineupDraftSnapshot } from './LineupDraftStore';
import { buildPresetDecks } from './LineupPresets';
import { Toast } from '../common/Toast';
import { selectFormation } from './FormationService';
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import { CardLineupEvent } from './CardLineupEvents';
import type { ICardDeckSavedPayload } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/**
 * 布阵面板的打开参数（`LineupBoardPage.open({ userData })`）。
 *
 * 只带**依赖**（加载兵种 prefab 用的 `AssetService`），不带业务结果 ——
 * 保存成功的结果走 `CardLineupEvent.DeckSaved` 事件（见 `CardLineupEvents`）。
 *
 *  以前这里叫 `ILineupBoardOpenSession`，还带一个 `saved?: boolean`：面板保存时置 `true`，
 * 卡牌页在 `onClose` 里读。两个毛病 —— 结果绑在「关闭」上（面板开着保存，页面不刷），
 * 以及共享可变字段要靠「这轮是不是我写的」互相猜。事件版本把这两件事都去掉了：
 * 保存成功**当场**派发，订阅方各自决定要不要刷。
 */
export interface ILineupBoardOpenData {
    assets?: AssetService | null;
}

/**
 * 「布阵」面板（`assets/resources/ui/card/LineupBoard.prefab`）。
 *
 * 对应设计稿 `卡牌阵容_队伍编辑`（720×1610）—— 它是**盖在「卡牌阵容」页上的弹窗**：
 * 上半是上阵区（8 个站台 = 2 行 × 4），中间一行职业统计，下半是可上阵卡池（5 列 × 3 行），
 * 底部「品质加成 / 一键下阵 / 保存」。
 *
 * 版式全部由 prefab 按设计稿坐标摆好（容器 667×1048，居中于 720×1280），
 * 本组件只做三件事：读数据 → 备图 → 灌数据。
 *
 * 容器分工：
 *   - `arenaArea` 下的 `Slots` 挂 `cc.Layout`（GRID 4×2、cellSize 125×148、间距 25/6），
 *     8 个 `LineupBoardSlot` 实例由 Layout 自动排位，增删站台不用手算坐标；
 *   - `poolArea` 下的 `ClassRow` 挂 `cc.Layout`（HORIZONTAL、spacingX 50.5，
 *     容器宽 = 4×80 + 3×50.5 = 471.5），4 个 `LineupBoardClassItem` 实例由 Layout 自动排位；
 *   - `poolArea` 下的 `PoolList` 是 `VirtualScrollView` 虚拟列表（5 列，
 *     `itemPrefab = LineupBoardCard`），行节点运行时创建、滚出可视区即回收；
 *     卡池条数跟随后端英雄列表变化，**不用再动 prefab**；
 *   - 上阵区仍用 `gridOrder()` 按坐标排序后填数据，**不依赖节点树顺序**
 *     （Layout 只保证位置，兄弟顺序仍可能被编辑器打乱）。
 *
 * 数据来源：
 *   - 各方案的上阵卡组       ← `CmdFormationInfoReqMsg`（`formations`），页签下标 i → `formationId = i + 1`；
 *                             没有后端数据（未连接/失败/编辑器预览）时所有页签都退回本地八卡
 *   - 卡池                   ← `CmdPvpHeroInfoListReqMsg` ∩ `pvpCard`，等级上限读 `cardLevelUp.json`
 *   - 保存                   ← `CmdFormationOpReqMsg`（整份阵型覆盖），见 `onSave()`
 *
 * 交互：点一下卡池里的卡即上阵到第一个空位（再点一下下阵），不再支持拖拽。
 */
@ccclass('LineupBoardPage')
export class LineupBoardPage extends PopupBase implements IBoardCardHost {
    /** 取数轮次：慢的那次回来不许覆盖快的（这职责原来在 `LineupBoardPresenter` 里）。 */
    private boardRevision = 0;
    private readonly previewScope = new ResourceScope('lineup-board-preview');
    private assets: AssetService | null = null;
    private previewAssets: CardUnitPreviewAssets<Prefab> | null = null;
    private arenaRevision = 0;

    /** 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。 */
    static prefabPath = 'ui/card/LineupBoard';

    @property({ type: Label, tooltip: 'Title/Ribbon/Label：标题「布阵」' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: 'Footer/QualityLabel：左下角「品质加成」' })
    qualityLabel: Label = null!;

    @property({ type: Label, tooltip: 'Footer/BtnReset/Label：「一键下阵」' })
    resetLabel: Label = null!;

    @property({ type: Label, tooltip: 'Footer/BtnSave/Label：「保存」（发包期间改成「保存中…」，结果就地反馈）' })
    saveLabel: Label = null!;

    @property({ type: Node, tooltip: 'Arena：上阵区容器（其下 Slots 挂 cc.Layout，8 个站台由 Layout 自动排）' })
    arenaArea: Node = null!;

    @property({ type: Node, tooltip: 'Pool：卡池容器（Panel 背景 + ClassRow + PoolList）' })
    poolArea: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'Pool/PoolList：卡池虚拟列表（本 prefab 内的普通节点，Inspector 已绑定）' })
    poolList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'Pool/ClassRow：4 个 LineupBoardClassItem 的容器（挂 cc.Layout 水平排位，代码仍按 x 排序取用）' })
    classBar: Node = null!;

    @property({ type: Node, tooltip: 'Arena/PresetRow：4 个布阵方案页签（顺序由 x 决定，第 i 格 = formationId i+1）' })
    presetBar: Node = null!;

    @property({ type: Button, tooltip: 'Footer/BtnReset 上的 cc.Button（**绑组件不绑节点**）' })
    resetButton: Button = null!;

    @property({ type: Button, tooltip: 'Footer/BtnSave 上的 cc.Button（**绑组件不绑节点**）' })
    saveButton: Button = null!;

    @property({ type: Button, tooltip: 'CloseBtn 上的 cc.Button（**绑组件不绑节点**）' })
    closeButton: Button = null!;

    @property({ tooltip: '后端没有该卡等级时，站台「N级」使用的兜底值' })
    fallbackLevel = 3;

    @property({ tooltip: '后端没有该卡等级时，卡池左下角数字使用的兜底值' })
    fallbackPoolLevel = 1;

    @property({ tooltip: '默认选中的布阵方案页签下标（设计稿上高亮的是第 1 格）' })
    defaultPreset = 0;

    @property({ tooltip: '打开界面时自动读表补齐卡组（本页独立预览需要；正式流程里已经注入过就不会再读）' })
    autoLoadDecks = true;

    @property({ tooltip: '页签「选中」底色（样式放 Inspector，代码不写死颜色）' })
    presetActiveColor: Color = new Color(216, 178, 96, 255);

    @property({ tooltip: '页签「未选中」底色' })
    presetIdleColor: Color = new Color(92, 70, 48, 255);

    @property({ tooltip: '保存成功后是否关闭面板（默认不关，方便连续改几个方案）' })
    closeAfterSave = false;

    /** 当前选中的布阵方案下标。 */
    private presetIndex = 0;
    private draft: LineupDraftStore | null = null;

    /**
     * 卡池数据 + 预先备好的美术。
     * `VirtualScrollView.renderItemFn` 是**同步**回调（滚动中随时触发），
     * 不能在里 await，所以美术必须在灌数据前全部缓存好。
     */
    private poolCards: readonly ZCDeckCard[] = [];
    private deployedIds: Set<string> = new Set();
    private poolArt = new Map<string, ZCBoardCardFrames>();
    private heroLevels: ReadonlyMap<string, number> = new Map();
    private heroLevelCaps: ReadonlyMap<string, number> = new Map();

    /** 上阵区站台（按 `gridOrder` 排好，下标 = 卡组下标）。节点树不变，取一次就够。 */
    private arenaSlotCache: LineupBoardSlot[] | null = null;
    private saving = false;

    /**
     * 按「从上到下、从左到右」排同组实例（一行内 y 相同，所以先比 y 再比 x）。
     *
     * **只留给 `PresetRow` 用**：那 4 个布阵方案页签是**没有 Layout** 的手摆节点，坐标是唯一真源。
     * 挂了 Layout 的容器（`Arena/Slots` / `ClassRow`）不要用这里 —— 它们的坐标就是 Layout 按
     * 兄弟顺序算出来的，再按坐标排序等于原地转圈，顺序直接取节点树就行。
     */
    private static gridOrder<T extends { node: Node }>(items: readonly T[]): T[] {
        return items.slice().sort((a, b) => {
            const pa = a.node.position, pb = b.node.position;
            if (Math.abs(pa.y - pb.y) > 1) return pb.y - pa.y;
            return pa.x - pb.x;
        });
    }

    protected onInit(): void {
        this.titleLabel.string = CARD_LINEUP_TEXTS.boardTitle;
        this.qualityLabel.string = CARD_LINEUP_TEXTS.qualityBonus;
        this.resetLabel.string = CARD_LINEUP_TEXTS.boardResetAll;
        this.saveLabel.string = CARD_LINEUP_TEXTS.boardSave;

        //  CLICK 是挂在**节点**上的（Button 自身没有 on），别写成 button.on(...)。
        //  三个字段都直接声明成 `cc.Button`（Inspector 拖组件），所以不需要 getComponent。
        this.resetButton.node.on(Button.EventType.CLICK, this.onResetAll, this);
        this.saveButton.node.on(Button.EventType.CLICK, this.onSave, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        const presets = LineupBoardPage.gridOrder(
            this.presetBar.children.map((node) => ({ node })),
        );
        for (let index = 0; index < presets.length; index += 1) {
            const button = presets[index].node.getComponent(Button)!;
            button.node.on(Button.EventType.CLICK, () => this.selectPreset(index), this);
        }
    }

    protected onOpen(userData?: ILineupBoardOpenData): void | Promise<void> {
        // 调用方（卡牌阵容页）只传依赖；保存结果通过 `CardLineupEvent.DeckSaved` 事件回传。
        this.assets = userData?.assets ?? null;
        //  8 个站台先收起：`LineupBoardSlot.prefab` 的 `Unit` 组默认就是收起的，
        //  这里再显式收一遍 —— 面板是复用打开的（关了再开），别让上一轮的卡停在新面板上。
        for (const slot of this.arenaSlots()) slot.setEmpty(true);
        return this.refresh();
    }

    /**
     * 取一次数据并渲染整块面板。
     *
     *  本面板自己干：取数 → 组草稿 → 渲染，不再有 Presenter 中转。
     *  渲染途中的每次 `await` 之后仍要判 `this.alive`：面板被 `PopupManager.close()`
     *  直接 `destroy()` 时，实测会崩在 `LineupBoardSlot.render` 里 `this.disc` 为 null。
     */
    async refresh(): Promise<void> {
        const presetCount = Math.max(1, this.presetBar.children.length);
        const revision = ++this.boardRevision;
        const data = await cardRepository.loadBoard(this.autoLoadDecks);
        if (revision !== this.boardRevision) return;
        if (!this.alive) return;
        // 每个页签的初始卡组来自后端阵型（`formationId = 页签下标 + 1`）；
        // 没有后端数据时 `buildPresetDecks` 会让所有页签都用本地卡组。
        const decks = buildPresetDecks(data, presetCount);
        // 优先用服务端返回的选中阵型，没有再用默认页签
        let initialPreset = this.defaultPreset;
        if (data.formations) {
            const selectedFormation = data.formations.find((f) => f.selected);
            if (selectedFormation) {
                initialPreset = selectedFormation.formationId - 1;
            }
        }
        await this.presentBoard({
            ...data,
            draft: new LineupDraftStore(data.deck, 8, presetCount, initialPreset, decks),
        });
    }

    private async presentBoard(data: LineupBoardPresentation): Promise<void> {
        this.draft = data.draft;
        this.heroLevels = data.heroLevels;
        this.heroLevelCaps = data.heroLevelCaps;
        const deck = data.draft.snapshot().cards;
        if (!this.alive) return;
        const snapshot = data.draft.snapshot();
        //  卡组为空的两种情况要分开：**没有后端阵型数据**时 store 用的是本地八卡（不会为空，
        // 除非表本身读不到）；有后端数据但这一格是空的，则本来就该显示「没有上阵卡」。
        // 所以这里不再像改动前那样「空就保持占位外观」，只对「表都读不到」出声。
        if (deck.length === 0 && data.formations === null) {
            console.warn('[LineupBoardPage] 卡组为空（既没有后端阵型也没有本地卡表），保持 prefab 占位外观');
        }
        this.applySnapshot(snapshot);
        if (!this.alive) return;
        await Promise.all([this.renderArena(deck), this.renderPool(data.pool)]);
        if (!this.alive) return;
        await this.renderClassRow(deck);
        if (!this.alive) return;
        this.updatePresetTabs(snapshot.selectedPreset);
    }

    /**
     * 组件所在节点是否仍然有效。
     * `Component.node` 在组件被销毁后会变成 `null`，所以两种形态都要挡。
     */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /**
     * 上阵区 8 个站台，下标 = 卡组下标。**顺序直接取节点树顺序**。
     *
     * `Arena/Slots` 挂着 GRID Layout（cell 125×148、间距 25/6），它按**子节点顺序**从左上排到右下，
     * 坐标就是它的产物 —— 再按坐标反推一遍顺序是原地转圈（兄弟顺序真错了，坐标也跟着错，
     * 排序只会还原成同一个顺序，救不回来）。
     */
    private arenaSlots(): readonly LineupBoardSlot[] {
        if (!this.arenaSlotCache) {
            this.arenaSlotCache = this.arenaArea.getComponentsInChildren(LineupBoardSlot);
        }
        return this.arenaSlotCache;
    }

    /** 上阵区：按卡组顺序填满 8 个站台，多出来的站台置空。 */
    private async renderArena(deck: readonly ZCDeckCard[]): Promise<void> {
        const revision = ++this.arenaRevision;
        const slots = this.arenaSlots();
        const previewAssets = this.unitPreviewAssets();
        const ready = await Promise.all(deck.slice(0, slots.length).map(async (card) => ({
            card,
            frames: await cardArtProvider.loadBoardSlot(card),
            prefab: await previewAssets?.load(card) ?? null,
        })));
        if (!this.alive || revision !== this.arenaRevision) return;
        for (let index = 0; index < slots.length; index += 1) {
            // 站台实例是 prefab 预建的、长期存活；tapHost 每次刷新都重指一次，
            // 与 applyPoolItem 里 `view.tapHost = this` 同一约定（节点复用后宿主不能悬空）。
            slots[index].tapHost = this;
            const item = ready[index];
            if (!item) {
                slots[index].setEmpty(true);
                continue;
            }
            slots[index].render(item.card, item.frames,
                this.levelOf(item.card, this.fallbackLevel), item.prefab);
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
     * 卡池：驱动 `Pool/PoolList` 的虚拟列表渲染。
     *
     * 行节点由 `VirtualScrollView` 创建 / 复用 / 回收，本方法只做两件事：
     * **先把美术全部异步备好**，再交付一个**同步**的 `renderItemFn`
     * （滚动中随时回调，不能在里面 await）。卡池内容来自后端英雄列表；是否
     * 「已上阵」仍按当前八卡 id 集合判断。
     */
    private async renderPool(pool: readonly ZCDeckCard[]): Promise<void> {
        this.poolCards = pool;

        // 按 key 去重后并发预加载（同一张图只 load 一次）
        const art = new Map<string, ZCBoardCardFrames>();
        await Promise.all(pool.map(async (card) => {
            art.set(card.id, await cardArtProvider.loadBoardCard(card));
        }));
        this.poolArt = art;

        //  预加载期间面板可能已经关了。必须在这里挡：节点一销毁，`poolList` 也会被释放，
        // 再往下走就会往已释放的列表上写，把真正的原因盖掉。
        if (!this.alive) return;

        const list = this.poolList;
        if (!list.node.isValid) return;
        list.renderItemFn = this.applyPoolItem;
        // `VirtualScrollView` 的槽位是在 start() 里建的，而 onOpen 早于 start。
        // 统一走 PopupBase 的取消安全帧等待：关闭期间会返回 false，不留下悬空 Promise。
        if (!await this.nextPopupFrame()) return;
        if (!this.alive || !list.node.isValid) return;
        list.setTotalCount(pool.length);
    }

    /**
     * 把第 `index` 张卡灌进一个行节点（新建或回收来的）。**必须同步**。
     */
    private readonly applyPoolItem = (node: Node, index: number): void => {
        const card = this.poolCards[index];
        const view = node.getComponent(LineupBoardCard);
        if (!view || !card) return;
        const frames = this.poolArt.get(card.id);
        if (!frames) return;
        // 行节点会被回收复用，宿主每轮都要重新指一次（视图实例可能换了卡）。
        view.tapHost = this;
        view.render(card, frames, this.deployedIds.has(card.id), this.levelOf(card, this.fallbackPoolLevel));
    };

    /**
     * 只重刷**当前可见**的卡（勾选态变化后用）。
     * 虚拟列表外滚出可视区的行节点是回收复用的，不需要也不应该去改它们。
     */
    private rerenderPoolItems(): void {
        const list = this.poolList;
        for (let index = 0; index < this.poolCards.length; index += 1) {
            const node = list.getItemByIndex(index);
            if (node) this.applyPoolItem(node, index);
        }
    }

    /** 中间那行「职业图标 + 数量」，顺序固定为 `ZC_CARD_CLASSES`。 */
    private async renderClassRow(deck: readonly ZCDeckCard[]): Promise<void> {
        const tallies = tallyDeckClasses(deck);
        //  ClassRow 挂的是水平 Layout，顺序 = 节点树顺序（同 `arenaSlots`：坐标是 Layout 算的，别反推）。
        const items = this.classBar.getComponentsInChildren(LineupBoardClassItem);
        for (let index = 0; index < items.length; index += 1) {
            const cardClass = ZC_CARD_CLASSES[index];
            const { on } = await cardArtProvider.loadClassFrames(cardClass);
            if (!this.alive) return;
            items[index].render(tallies[index] ?? null, on);
        }
    }

    private levelOf(card: ZCDeckCard, fallback: number): number {
        const level = this.heroLevels.get(card.id) ?? fallback;
        const cap = this.heroLevelCaps.get(card.id);
        return cap == null ? level : Math.min(level, cap);
    }

    /** 切换布阵方案页签：换一份草稿（各方案的上阵卡互不影响），同时通知服务端选中该阵型。 */
    selectPreset(index: number): void {
        const snapshot = this.draft?.selectPreset(index);
        this.updatePresetTabs(snapshot?.selectedPreset ?? index);
        if (!snapshot) return;
        this.applySnapshot(snapshot);
        void this.renderArena(snapshot.cards);
        void this.renderClassRow(snapshot.cards);
        this.rerenderPoolItems();
        // // 告诉服务端：当前选中的是这个阵型
        // if (this.draft) {
        //     const formationId = this.draft.formationIdOf(index);
        //     void selectFormation(formationId, this);
        // }
    }

    private updatePresetTabs(index: number): void {
        const presets = LineupBoardPage.gridOrder(
            this.presetBar.children.map((node) => ({ node })),
        );
        if (presets.length === 0) return;
        this.presetIndex = Math.max(0, Math.min(presets.length - 1, Math.round(index)));
        for (let i = 0; i < presets.length; i += 1) {
            const bg = presets[i].node.getComponent(Sprite)!;
            bg.color = i === this.presetIndex ? this.presetActiveColor : this.presetIdleColor;
        }
    }

    /** 一键下阵：清空当前方案的上阵区并摘掉卡池的「已上阵」标（只改本地草稿，落库在「保存」）。 */
    onResetAll(): void {
        const snapshot = this.draft?.reset();
        if (!snapshot) return;
        this.applySnapshot(snapshot);
        void this.renderArena(snapshot.cards);
        void this.renderClassRow(snapshot.cards);
        this.rerenderPoolItems();
        console.log('[LineupBoardPage] 当前方案已全部下阵');
    }

    /** 右上角 CloseBtn：经 PopupManager 统一出栈关闭（reason = CloseButton）。 */
    private onCloseClick(): void {
        this.closeByButton();
    }

    // ========================================================================
    // 保存（CmdFormationOpReqMsg）
    // ========================================================================

    /**
     * 保存当前方案：把整份阵型（`formationId` + 完整 `heroId` 列表）覆盖式发给服务端。
     *
     *  发包期间按钮置灰并显示「保存中…」（既是反馈，也是防连点）；结果就地写在按钮文案上：
     * 成功 `已保存`、未连接 `未连接服务器`、失败 `保存失败`。
     * **失败时不 `commit()`** —— 草稿仍然算"未保存"，用户可以再点一次。
     */
    async onSave(): Promise<void> {
        if (this.saving) return;
        const draft = this.draft;
        if (!draft) return;

        const snapshot = draft.snapshot();
        const heroIds: number[] = [];
        for (const card of snapshot.cards) {
            const heroId = Number(card.id);
            if (!Number.isSafeInteger(heroId) || heroId <= 0) {
                console.warn('[LineupBoardPage] 上阵卡 id 不是合法英雄编号，已取消保存', card.id);
                this.renderSaveResult(CARD_LINEUP_TEXTS.boardSaveFailed);
                return;
            }
            heroIds.push(heroId);
        }

        const formationId = draft.formationIdOf(this.presetIndex);
        this.saving = true;
        this.setSaveButtonEnabled(false);
        // 保存反馈就地写在按钮上（置灰 + 「保存中…」），不弹全屏 LoadingPopup。
        this.renderSaveResult(CARD_LINEUP_TEXTS.boardSaving);

        const result = await cardRepository.saveFormation(formationId, heroIds, this);

        this.saving = false;
        if (!this.alive) return;
        this.setSaveButtonEnabled(true);

        if (result.kind !== 'success') {
            this.renderSaveResult(CARD_LINEUP_TEXTS.boardSave);
            Toast.show(result.kind === 'offline'
                ? CARD_LINEUP_TEXTS.boardSaveOffline
                : CARD_LINEUP_TEXTS.boardSaveFailed);
            return;
        }
        // 服务端已经存下了，本地草稿才算干净。
        draft.commit();
        //  派发「阵型已保存」：卡牌阵容页的八卡读的是服务端「选中阵型」，而本次保存把它置成了
        // 选中（`select = 1`），所以它必须重刷。**当场派发，不等关闭** —— 面板挂着的时候
        // 保存过一次就已经生效了。谁关心谁订阅，面板不需要知道外面有谁（见 `CardLineupEvents`）。
        EventMgr.instance.emit(CardLineupEvent.DeckSaved, {
            formationId,
            heroIds,
        } satisfies ICardDeckSavedPayload);
        console.log('[LineupBoardPage] 阵型已保存', formationId, heroIds);
        this.renderSaveResult(CARD_LINEUP_TEXTS.boardSaved);
        Toast.show(CARD_LINEUP_TEXTS.boardSaved);
        if (this.closeAfterSave) this.close();
    }

    private renderSaveResult(text: string): void {
        if (!this.alive) return;
        this.saveLabel.string = text;
    }

    private setSaveButtonEnabled(enabled: boolean): void {
        // 字段本身就是 `cc.Button`，直接写 `interactable` —— 不用再 getComponent、也不用判空。
        this.saveButton.interactable = enabled;
    }

    private applySnapshot(snapshot: LineupDraftSnapshot): void {
        this.deployedIds = new Set(snapshot.deployedIds);
        this.presetIndex = snapshot.selectedPreset;
        // 草稿一变，「已保存 / 保存失败」就不再代表现状了 —— 恢复成可保存的文案。
        if (!this.saving) this.renderSaveResult(CARD_LINEUP_TEXTS.boardSave);
    }

    // ========================================================================
    // 卡池点击上阵 / 下阵（IBoardCardHost）
    // ========================================================================

    /**
     * 短按点击：已上阵 → 下阵；未上阵 → 上阵到第一个空位。
     */
    onCardTap(card: ZCDeckCard): void {
        if (!this.alive || !this.draft) return;
        const snapshot = this.deployedIds.has(card.id)
            ? this.draft.remove(card.id)
            : this.draft.put(card);
        this.applySnapshot(snapshot);
        void this.renderArena(snapshot.cards);
        void this.renderClassRow(snapshot.cards);
        this.rerenderPoolItems();
    }

    onDestroy(): void {
        // 摘掉订阅（`DeckSaved` 等）：`EventMgr` 是全局单例，面板每次关闭都销毁重建。
        EventMgr.instance.offTarget(this);
        this.arenaRevision += 1;
        this.previewScope.dispose();
        this.arenaSlotCache = null;
        this.boardRevision += 1;
        super.onDestroy();
    }
}
