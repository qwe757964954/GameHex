import {
    _decorator,
    Button,
    Color,
    Label,
    Node,
    Prefab,
    Sprite,
    SpriteFrame,
} from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import { cardArtProvider } from './CardArtProvider';
import type { ICardArtConfig } from './CardArtConfig';
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
import { CardUnitPreviewAssets } from './CardUnitPreviewAssets';
import { CardPopupEvent } from './CardPopupEvents';
import { EventMgr } from '../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/**
 * 布阵弹窗，盖在卡牌阵容页上。
 *
 * 版式都在 LineupBoard.prefab：上阵区 4×2、中间职业统计、下面是 5 列卡池，
 * 底部品质加成 / 一键下阵 / 保存。页面只管输入和渲染，取数、草稿、保存归外部会话。
 * 阵型读 CmdFormationInfoReqMsg，卡池是后端英雄列表 ∩ pvpCard；点卡上阵，再点一下下阵。
 */
@ccclass('LineupBoardPage')
export class LineupBoardPage extends PopupBase implements IBoardCardHost {
    private renderRevision = 0;
    private poolRevision = 0;
    private classRevision = 0;
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

    @property({ tooltip: '页签没配图时的「选中」底色（新设计稿直接切 presetActiveFrame，正常走不到这里）' })
    presetActiveColor: Color = new Color(216, 178, 96, 255);

    @property({ tooltip: '页签没配图时的「未选中」底色' })
    presetIdleColor: Color = new Color(92, 70, 48, 255);

    @property({ type: SpriteFrame, tooltip: '页签「选中」图（新版橙色底板 bz_btn_02）' })
    presetActiveFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '页签「未选中」图（新版深灰底板 ba_btn_01）' })
    presetIdleFrame: SpriteFrame = null!;

    @property({ tooltip: '保存成功后是否关闭面板（默认不关，方便连续改几个方案）' })
    closeAfterSave = false;

    /** 当前选中的布阵方案下标。 */
    private presetIndex = 0;

    /**
     * 卡池数据 + 预先备好的美术。
     * `VirtualScrollView.renderItemFn` 是同步回调（滚动中随时触发），
     * 不能在里 await，所以美术必须在灌数据前全部缓存好。
     */
    private poolCards: readonly ZCDeckCard[] = [];
    private deployedIds: ReadonlySet<string> = new Set();
    private poolArt = new Map<string, ZCBoardCardFrames>();
    private heroLevels: ReadonlyMap<string, number> = new Map();
    private heroLevelCaps: ReadonlyMap<string, number> = new Map();
    private art: ICardArtConfig;

    /** 上阵区站台，下标 = 卡组下标，顺序与 Layout 一致。 */
    private arenaSlotCache: LineupBoardSlot[] | null = null;

    /**
     * 按从上到下、从左到右排同组节点，只给没挂 Layout 的 PresetRow 用。
     * Arena/Slots、ClassRow 的顺序直接取节点树，别按坐标再排一遍。
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

        //  CLICK 是挂在节点上的（Button 自身没有 on），别写成 button.on(...)。
        //  三个字段都直接声明成 `cc.Button`（Inspector 拖组件），所以不需要 getComponent。
        this.resetButton.node.on(Button.EventType.CLICK, this.onResetAll, this);
        this.saveButton.node.on(Button.EventType.CLICK, this.onSave, this);
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        const presets = LineupBoardPage.gridOrder(
            this.presetBar.children.map((node) => ({ node })),
        );
        for (let index = 0; index < presets.length; index += 1) {
            const button = presets[index].node.getComponent(Button);
            button.node.on(Button.EventType.CLICK, () => this.selectPreset(index), this);
        }
    }

    protected onOpen(): void {
        this.saveButton.interactable = false;
        this.saveLabel.string = CARD_LINEUP_TEXTS.boardSave;
        this.poolCards = [];
        this.poolArt.clear();
        for (const slot of this.arenaSlots()) slot.setEmpty(true);
    }

    async render(data: LineupBoardPresentation): Promise<void> {
        this.art = data.art;
        const scope = this.resourceScope;
        const revision = ++this.renderRevision;
        this.heroLevels = data.heroLevels;
        this.heroLevelCaps = data.heroLevelCaps;
        this.deployedIds = data.deployedIds;
        this.saveButton.interactable = data.canSave;
        this.saveLabel.string = data.saveText;
        this.updatePresetTabs(data.selectedPreset);
        await Promise.all([this.renderArena(data.cards), this.renderPool(data.pool), this.renderClassRow(data.cards)]);
        if (scope.disposed || !this.alive || revision !== this.renderRevision) return;
        this.rerenderPoolItems();
    }

    /**
     * 组件所在节点是否仍然有效。
     * `Component.node` 在组件被销毁后会变成 `null`，所以两种形态都要挡。
     */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && !this.resourceScope.disposed;
    }

    /**
     * 上阵区 8 个站台，下标就是卡组下标。
     * Slots 挂了 Grid Layout，这里直接取节点树顺序，不按坐标反推。
     */
    private arenaSlots(): readonly LineupBoardSlot[] {
        if (!this.arenaSlotCache) {
            this.arenaSlotCache = this.arenaArea.getComponentsInChildren(LineupBoardSlot);
        }
        return this.arenaSlotCache;
    }

    /** 上阵区：按卡组顺序填满 8 个站台，多出来的站台置空。 */
    private async renderArena(deck: readonly ZCDeckCard[]): Promise<void> {
        const scope = this.resourceScope;
        const revision = ++this.arenaRevision;
        const slots = this.arenaSlots();
        const previewAssets = this.unitPreviewAssets();
        const ready = await Promise.all(deck.slice(0, slots.length).map(async (card) => {
            const [frames, prefab] = await Promise.all([cardArtProvider.loadBoardSlot(card, this.art), previewAssets.load(card)]);
            return { card, frames, prefab };
        }));
        if (scope.disposed || !this.alive || revision !== this.arenaRevision) return;
        for (let index = 0; index < slots.length; index += 1) {
            // 站台会长期存活，但宿主每次刷新仍要重指，避免节点复用后悬空。
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

    private unitPreviewAssets(): CardUnitPreviewAssets<Prefab> {
        if (!this.previewAssets) {
            const assets = this.assets;
            this.previewAssets = new CardUnitPreviewAssets((path) => assets.load(path, Prefab));
        }
        return this.previewAssets;
    }

    /**
     * 卡池：驱动 PoolList 的虚拟列表。
     * 先把图异步备好，再交同步的 renderItemFn；滚动回调里不能 await。
     */
    private async renderPool(pool: readonly ZCDeckCard[]): Promise<void> {
        if (pool === this.poolCards && this.poolArt.size > 0) { this.rerenderPoolItems(); return; }
        const scope = this.resourceScope;
        const revision = ++this.poolRevision;
        this.poolCards = pool;

        // 按 key 去重后并发预加载（同一张图只 load 一次）
        const art = new Map<string, ZCBoardCardFrames>();
        await Promise.all(pool.map(async (card) => {
            art.set(card.id, await cardArtProvider.loadBoardCard(card, this.art));
        }));

        // 预加载期间面板可能已经关了，节点销毁后 poolList 也没了，先在这挡一下。
        if (scope.disposed || !this.alive || revision !== this.poolRevision) return;
        this.poolArt = art;

        const list = this.poolList;
        if (!list.node.isValid) return;
        list.renderItemFn = this.applyPoolItem;
        // `VirtualScrollView` 的槽位是在 start() 里建的，而 onOpen 早于 start。
        // 统一走 PopupBase 的取消安全帧等待：关闭期间会返回 false，不留下悬空 Promise。
        if (!await this.nextPopupFrame()) return;
        if (scope.disposed || !this.alive || revision !== this.poolRevision || !list.node.isValid) return;
        list.setTotalCount(pool.length);
    }

    /**
     * 把第 `index` 张卡灌进一个行节点（新建或回收来的）。必须同步。
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
     * 只刷当前可见的卡（勾选态变化后用），滚出可视区的行不用管。
     */
    private rerenderPoolItems(): void {
        const list = this.poolList;
        for (let index = 0; index < this.poolCards.length; index += 1) {
            const node = list.getItemByIndex(index);
            if (node) this.applyPoolItem(node, index);
        }
    }

    /** 中间那行「职业图标 + 数量」，顺序取表内 `cardUiArtClass` 的行序（`lineup.classes`）。 */
    private async renderClassRow(deck: readonly ZCDeckCard[]): Promise<void> {
        const scope = this.resourceScope;
        const revision = ++this.classRevision;
        const tallies = tallyDeckClasses(deck, this.art.lineup);
        //  ClassRow 挂的是水平 Layout，顺序 = 节点树顺序（同 `arenaSlots`：坐标是 Layout 算的，别反推）。
        const items = this.classBar.getComponentsInChildren(LineupBoardClassItem);
        for (let index = 0; index < items.length; index += 1) {
            const cardClass = this.art.lineup.classes[index]?.id ?? ZC_CARD_CLASSES[index];
            const tally = tallies[index] ?? null;
            // 职业统计行用白色计数图标，不用卡牌栏的亮/暗两态。
            const frame = await cardArtProvider.loadTallyFrames({
                kind: 'class',
                key: cardClass,
                name: this.art.lineup.classes[index]?.name ?? '',
                count: tally?.count ?? 0,
                reached: tally?.reached ?? false,
            }, this.art);
            if (scope.disposed || !this.alive || revision !== this.classRevision) return;
            items[index].render(tally, frame);
        }
    }

    private levelOf(card: ZCDeckCard, fallback: number): number {
        const level = this.heroLevels.get(card.id) ?? fallback;
        const cap = this.heroLevelCaps.get(card.id);
        return cap == null ? level : Math.min(level, cap);
    }

    selectPreset(index: number): void {
        EventMgr.instance.emit(CardPopupEvent.BoardIntent, { owner: this, kind: 'preset', index });
    }

    private updatePresetTabs(index: number): void {
        const presets = LineupBoardPage.gridOrder(
            this.presetBar.children.map((node) => ({ node })),
        );
        if (presets.length === 0) return;
        this.presetIndex = Math.max(0, Math.min(presets.length - 1, Math.round(index)));
        for (let i = 0; i < presets.length; i += 1) {
            const bg = presets[i].node.getComponent(Sprite);
            const active = i === this.presetIndex;
            const frame = active ? this.presetActiveFrame : this.presetIdleFrame;
            if (frame) {
                bg.spriteFrame = frame;
                bg.color = Color.WHITE;
            } else {
                bg.color = active ? this.presetActiveColor : this.presetIdleColor;
            }
        }
    }

    onResetAll(): void {
        EventMgr.instance.emit(CardPopupEvent.BoardIntent, { owner: this, kind: 'reset' });
    }

    private onCloseClick(): void { this.closeByButton(); }

    onSave(): void {
        EventMgr.instance.emit(CardPopupEvent.BoardIntent, { owner: this, kind: 'save' });
    }

    onCardTap(card: ZCDeckCard): void {
        EventMgr.instance.emit(CardPopupEvent.BoardIntent, { owner: this, kind: 'toggle', cardId: card.id });
    }

    protected onClose(): void {
        this.renderRevision++;
        this.arenaRevision++;
        this.poolRevision++;
        this.classRevision++;
        this.previewAssets = null;
    }

    onDestroy(): void {
        this.arenaSlotCache = null;
        super.onDestroy();
    }
}
