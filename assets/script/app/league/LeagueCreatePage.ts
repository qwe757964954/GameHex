/**
 * 创建联盟弹窗，仅未入盟状态可达。旗帜横向列表按颜色下标换图。
 * 名字长度上限 20，费用和校验交给 LeagueRepository / LeagueCreateController。
 */

import { _decorator, Button, Color, EditBox, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import {
    LEAGUE_ART_ROOT,
    LEAGUE_COST_ENOUGH_COLOR,
    LEAGUE_COST_ENOUGH_STROKE,
    LEAGUE_COST_ICON_ROOT,
    LEAGUE_COST_SHORT_COLOR,
    LEAGUE_COST_SHORT_STROKE,
    leagueBannerArt,
} from './LeagueArt';
import { LeagueCreateEvent, type ILeagueCreateViewState } from './LeagueCreateEvents';
import { leagueCreateBannerIndices, type ILeagueCostView } from './LeagueTable';
import {
    LEAGUE_CREATE_NAME_PROMPT,
    LEAGUE_CREATE_QUICK_JOIN,
    LEAGUE_CREATE_SUBMIT,
    LEAGUE_CREATE_TITLE,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/**
 * 打开本弹窗的参数（`PopupBase.open({ userData: ... })`）。
 * 只带容器 owner，不带回调 —— 成功后由控制器按 owner 发 `LeagueTabEvent.Joined`。
 */
export interface ILeagueCreateParams {
    readonly owner?: object | null;
}

/** 旗帜行的两个可切节点名（与别的页面同源：`组件_联盟_旗帜` 的 `n5` / `icon`）。 */
const BANNER_FRAME = 'Frame';
const BANNER_COLOR_ICON = 'ColorIcon';

@ccclass('LeagueCreatePage')
export class LeagueCreatePage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueCreate';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: EditBox, tooltip: 'NameInput：lab_leagueName 的 cc.EditBox（多行）' })
    nameInput: EditBox = null;

    @property({ type: VirtualScrollView, tooltip: 'BannerListView：可选旗帜色（横向虚拟列表，8 项）' })
    bannerList: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'QuickJoinBox：「允许快速加入」勾选框（整块 50×50 是热区）' })
    quickJoinBox: Node = null;

    @property({ type: Node, tooltip: 'QuickJoinBox/Check：勾（FGUI 实例 checked=true ⇒ 默认已勾）' })
    quickJoinCheck: Node = null;

    @property({ type: Node, tooltip: 'BtnCreate：消耗按钮（底图 + 衬底 + 「创建」+ 消耗项）' })
    costButton: Node = null;

    @property({ type: Sprite, tooltip: 'BtnCreate/Cost/CostIcon：消耗图标（运行时按表换帧）' })
    costIcon: Sprite = null;

    @property({ type: Label, tooltip: 'BtnCreate/Cost/Has：持有量（「100/」，两态换色）' })
    costHasLabel: Label = null;

    @property({ type: Label, tooltip: 'BtnCreate/Cost/Need：需要量（恒一色，FGUI 没有 gearColor）' })
    costNeedLabel: Label = null;

    /** 列表数据源 —— 就是颜色下标本身（`[0..7]`）。 */
    private readonly bannerIndices: number[] = leagueCreateBannerIndices();

    /** 8 张旗面（首次打开后缓存，之后 `renderItemFn` 不再走异步）。 */
    private bannerFrames: (SpriteFrame | null)[] | null = null;

    /** 当前选中的旗帜色下标（渲染用；业务真源在 Model）。 */
    private selectIndex = 0;

    /** 每次取数递增，用来作废在飞的展示资源加载。 */
    private revision = 0;

    // 生命周期

    /**
     * 按钮 / 列表回调在 `onInit` 里接一次即可：`PopupBase._inited` 保证每实例只跑一次
     * （`if (!this._inited)`），所以「只绑一次」的布尔门闩已删。
     */
    protected onInit(): void {
        const close = this.closeButton?.getComponent(Button);
        if (close) close.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueCreate] CloseBtn 上没有 cc.Button，点击不会生效');

        this.bindClick(this.costButton, () => this.emitSubmit());
        this.bindClick(this.quickJoinBox, () => this.emitQuickJoin());
        this.nameInput?.node.on('text-changed', this.emitName, this);

        if (this.bannerList) {
            this.bannerList.renderItemFn = (node, index) => this.renderBanner(node, index);
            this.bannerList.onItemClickFn = (_node, index) => this.emitBanner(index);
        } else {
            console.warn('[LeagueCreate] BannerListView 没绑上，旗帜列表不会渲染');
        }
    }

    protected async onOpen(): Promise<void> {
        this.selectIndex = 0;
        if (this.nameInput) this.nameInput.string = '';
        this.applyStaticTexts();

        await this.loadBannerFrames();
        if (!this.alive) return;

        const revision = ++this.revision;
        // 列表槽位在 `VirtualScrollView.start()` 里建，而 `onOpen` 早于它
        // ⇒ 必须让出一帧再 `refreshList`，否则落在「槽位还没建」的空档（表现为列表空白）。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;
        this.present();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // 意图派发（只带原文 / 下标 / 勾选态，不带回调）

    private emitName(): void {
        EventMgr.instance.emit(LeagueCreateEvent.Intent, {
            owner: this, kind: 'name', name: this.nameInput?.string ?? '',
        });
    }

    private emitBanner(index: number): void {
        if (this.bannerIndices[index] === undefined) return;
        EventMgr.instance.emit(LeagueCreateEvent.Intent, { owner: this, kind: 'banner', index });
    }

    private emitQuickJoin(): void {
        if (!this.quickJoinCheck) {
            console.warn('[LeagueCreate] QuickJoinBox/Check 没绑上，勾选框点不动');
            return;
        }
        EventMgr.instance.emit(LeagueCreateEvent.Intent, {
            owner: this, kind: 'quickJoin', quickJoin: !this.quickJoinCheck.active,
        });
    }

    private emitSubmit(): void {
        EventMgr.instance.emit(LeagueCreateEvent.Intent, {
            owner: this,
            kind: 'submit',
            name: this.nameInput?.string ?? '',
            quickJoin: this.quickJoinSelected,
        });
    }

    // 渲染（控制器推来的状态一律绝对赋值）

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_CREATE_TITLE;
    }

    render(state: ILeagueCreateViewState): void {
        const input = this.nameInput;
        if (input && input.string !== state.name) input.string = state.name;
        if (this.quickJoinCheck) this.quickJoinCheck.active = state.quickJoin;
        this.selectIndex = state.selectIndex;
        this.repaintBanners();
        if (state.cost) this.applyCost(state.cost);
        const button = this.costButton?.getComponent(Button);
        if (button) button.interactable = !state.submitting;
    }

    /** 8 张旗面一次性预载（之后行渲染是纯同步的，槽位复用时不会闪上一张的图）。 */
    private async loadBannerFrames(): Promise<void> {
        if (this.bannerFrames) return;
        const revision = this.revision;
        const frames = await Promise.all(
            this.bannerIndices.map((index) => loadArt(leagueBannerArt(index), LEAGUE_ART_ROOT)),
        );
        if (!this.alive || revision !== this.revision) return;
        this.bannerFrames = frames;
    }

    /** 铺列表（`bannerIndices` 是静态的 8 项，直接 `refreshList`）。 */
    private present(): void {
        if (!this.bannerList || !this.bannerList.isValid) return;
        this.bannerList.refreshList(this.bannerIndices);
    }

    // 消耗项上屏

    /**
     * 消耗项上屏 —— 老端 `ViewConsumeItemOne.updateByConsume()`：
     *
     * ```ts
     * t.com.setSelectedPage("足够", hasNum >= needNum ? "是" : "否");
     * t.com.tm("lab_has").setText(hasNumStr + "/");
     * t.com.tm("lab_need").setText(needNumStr);
     * ```
     *
     * `足够` controller 落成的是 `lab_has` 的两套字色（`gearColor`）；
     * `lab_need` **没有** gearColor ⇒ 两态都保持 `#e6e5d9` / `#181614`（别顺手也染红）。
     */
    private applyCost(cost: ILeagueCostView): void {
        if (this.costHasLabel) {
            this.costHasLabel.string = cost.hasText;
            this.paintLabel(
                this.costHasLabel,
                cost.enough ? LEAGUE_COST_ENOUGH_COLOR : LEAGUE_COST_SHORT_COLOR,
                cost.enough ? LEAGUE_COST_ENOUGH_STROKE : LEAGUE_COST_SHORT_STROKE,
            );
        }
        if (this.costNeedLabel) {
            this.costNeedLabel.string = cost.needText;
            this.paintLabel(this.costNeedLabel, LEAGUE_COST_ENOUGH_COLOR, LEAGUE_COST_ENOUGH_STROKE);
        }
        void this.applyCostIcon(cost);
    }

    /** 消耗图标（`roleProperty.icon` 是 FGUI 组件名 ⇒ 目录固定 `icons/resource`）。 */
    private async applyCostIcon(cost: ILeagueCostView): Promise<void> {
        const sprite = this.costIcon;
        if (!sprite) return;
        const revision = this.revision;
        const frame = await loadArt(cost.iconName, cost.iconRoot || LEAGUE_COST_ICON_ROOT);
        if (!sprite.isValid || revision !== this.revision) return;
        if (!frame) {
            // 表里没有图标（或图挂了）：藏掉节点，别留一个空框
            sprite.node.active = false;
            return;
        }
        sprite.node.active = true;
        sprite.spriteFrame = frame;
    }

    /**
     * 给 label 换字色 / 描边色。
     *
     * FGUI 的 `gearColor` 只改 `color` 与 `strokeColor` 两个值；本端对应 `Label.color` /
     * `Label.outlineColor`。描边宽度已在 prefab 里写好（2），这里不动。
     */
    private paintLabel(
        label: Label,
        color: readonly [number, number, number],
        stroke: readonly [number, number, number],
    ): void {
        label.color = new Color(color[0], color[1], color[2], 255);
        if (label.enableOutline) label.outlineColor = new Color(stroke[0], stroke[1], stroke[2], 255);
    }

    // 旗帜列表

    /**
     * 铺一行的旗帜（**纯同步**：8 张图已在 `onOpen` 里预载完）。
     *
     * 槽位会被 clone 复用 ⇒ 每次都**绝对赋值**（选中外框的显隐 + 旗面图）。
     */
    private renderBanner(node: Node, index: number): void {
        const colorIndex = this.bannerIndices[index];
        if (colorIndex === undefined) {
            node.active = false;
            return;
        }
        node.active = true;

        const frame = node.getChildByName(BANNER_FRAME);
        if (frame) frame.active = index === this.selectIndex;

        const icon = node.getChildByName(BANNER_COLOR_ICON)?.getComponent(Sprite);
        if (icon) icon.spriteFrame = this.bannerFrames?.[colorIndex] ?? null;
    }

    /**
     * 点一张旗 ⇒ 只刷「选中外框」的显隐，**不重跑 `renderItemFn`**
     * （老端 `updateShowItem` 的同义做法）：重排整表会让横向列表跳一下。
     */
    private repaintBanners(): void {
        if (!this.bannerList || !this.bannerList.isValid) return;
        for (let index = 0; index < this.bannerIndices.length; index += 1) {
            const node = this.bannerList.getItemByIndex(index);
            if (!node) continue;
            const frame = node.getChildByName(BANNER_FRAME);
            if (frame) frame.active = index === this.selectIndex;
        }
    }

    // 勾选框

    /** 当前是否勾了「允许快速加入」（老端读 `按钮_勾选` 的 `selected`）。 */
    get quickJoinSelected(): boolean {
        return this.quickJoinCheck?.active === true;
    }

    // 杂项

    /**
     * 静态文案（FGUI 就是静态 `title` / `text`，prefab 已写好，这里只兜「空」）。
     *
     * 「允许快速加入」在 FGUI 里是**面板上的独立文本 `n10`**（`组件_联盟_勾选` 自带的
     * `title` 是空的、`autoClearText`）⇒ 它是 `QuickJoinBox` 的**兄弟**、不是后代，
     * `getComponentInChildren` 找不到它（会静默空转）⇒ 必须按兄弟名取。
     */
    private applyStaticTexts(): void {
        setLabelIfEmpty(this.costButton, LEAGUE_CREATE_SUBMIT);
        const quickJoinLabel = this.node?.getChildByName(QUICK_JOIN_LABEL_NODE) ?? null;
        setLabelIfEmpty(quickJoinLabel, LEAGUE_CREATE_QUICK_JOIN);
        const placeholder = this.nameInput?.placeholderLabel;
        if (placeholder && !placeholder.string) placeholder.string = LEAGUE_CREATE_NAME_PROMPT;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 按名字接按钮；节点有 `cc.Button` 走 CLICK，否则退回 `TOUCH_END`（缺节点只 warn）。 */
    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueCreate] 按钮节点缺失，点击不会生效');
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

/**
 * 「允许快速加入」的文本节点名。
 *
 * FGUI `组件_联盟_创建联盟.xml` 里它叫 `n10`（`xy="137,674" size="172,34"`），
 * 与勾选框 `按钮_勾选`（`92,666`）**同级** —— 勾选组件自带的 `title` 是空的（`autoClearText`），
 * 面板另起了一个文本当说明 ⇒ 构建器把它落成根下的 `QuickJoinLabel`。
 */
const QUICK_JOIN_LABEL_NODE = 'QuickJoinLabel';

/** 按钮底下的文案：prefab 已写好，运行期只在「空」时兜一次（免得手滑删了 label 就成空按钮）。 */
function setLabelIfEmpty(node: Node | null, text: string): void {
    const label = node ? node.getComponentInChildren(Label) : null;
    if (label && !label.string) label.string = text;
}
