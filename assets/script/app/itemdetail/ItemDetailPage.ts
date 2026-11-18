import { _decorator, Button, Label, Node, Sprite, SpriteFrame, UITransform, Widget } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { Toast } from '../common/Toast';
import { GoodsBox } from './GoodsBox';
import { ItemDetailRow } from './ItemDetailRow';
import { qualityTitleStepOf } from './ItemDetailTable';
import type { IItemAccessRef, IItemRow } from './ItemDetailTable';
import { itemDetailRepository } from './ItemDetailRepository';
import type { IItemDetailRepository, IItemDetailSnapshot } from './ItemDetailRepository';
import { loadItemIconArt, loadItemQualityFrame, loadTitleArt } from './ItemDetailArtLoader';
import { ITEM_DETAIL_TEXTS } from './ItemDetailTexts';

const { ccclass, property } = _decorator;

/** `ItemDetailPage.open({ userData })` 的入参。 */
export interface IItemDetailOpenParams {
    /** 物品 `resId`（`item` 表主键）。 */
    readonly resId: number;
    /** 持有数量；不传按 `0`。 */
    readonly number?: number;
}

/** 一个物品框要用的两张图。 */
interface IBoxFrames {
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
}

/** 一趟界面要用的全部图。 */
interface IItemDetailFrames {
    readonly title: SpriteFrame | null;
    readonly self: IBoxFrames;
    readonly contents: ReadonlyMap<number, IBoxFrames>;
}

const EMPTY_BOX: IBoxFrames = { qualityFrame: null, iconFrame: null };

/**
 * 「物品详情」弹窗：老端 `LayerRolrItemDetail`，FGUI `组件_角色_道具详情.xml`（720×1280，与画布 1:1）。
 *
 * 版面自上而下：品质缎带 + 品质名 + 数量 + 物品名 + 主物品框、「道具说明」、
 * 「内容」格、「获取途径」、底部按钮（前往 / 前往 / 合成，三选一）。
 *
 * 分层与本模块其他页面一致：判定在 `ItemDetailTable`（纯函数），取数在 `ItemDetailRepository`，
 * 美术在 `ItemDetailArt` / `ItemDetailArtLoader`，子视图是 `GoodsBox` 与 `ItemDetailRow`；
 * 本类只做「取数 → 预加载图 → 铺界面」和点击转发。
 *
 * 样式与布局全在 prefab 的 Inspector 上，只有随数据变化的部分（品质帧、文案、
 * 按钮三选一、列表行）才在代码里算。
 *
 * 老端这个界面不发请求（`openLayerRoleItemDetails` 只用本地表 + 已持有的 Goods VO），
 * 所以这里也不造刷新请求：表读不到就显示空态，离线也能打开。
 */
@ccclass('ItemDetailPage')
export class ItemDetailPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     *
     * 目录名必须与磁盘一致（`assets/resources/ui/ItemDetail/`）：热更新 zip 内路径大小写敏感，
     * 写错在编辑器里照样能跑，真机才会 `resources.load` 失败变成空弹窗。
     */
    static prefabPath = 'ui/ItemDetail/ItemDetail';

    /** 关闭按钮；prefab 里没有 CloseBtn，未绑时点空白关闭。 */
    @property({ type: Node, tooltip: 'CloseBtn：关闭按钮（挂 cc.Button）' })
    closeButton: Node | null = null;

    /** `PanelBg`：主底板（九宫），高度按「获取途径」实际行数收放。 */
    @property({ type: Node, tooltip: 'PanelBg：主底板（高度按获取途径行数收放）' })
    panelBg: Node = null!;

    /** `AccessTitle`：「获取途径」标题，内容区藏起来时整块上移。 */
    @property({ type: Node, tooltip: 'AccessTitle：「获取途径」标题（随内容区显隐移动）' })
    accessTitle: Node = null!;

    @property({ type: Sprite, tooltip: 'TitleBg：品质缎带（7 档，随品质换帧）' })
    titleBg: Sprite = null!;

    @property({ type: Label, tooltip: 'NameText：物品名' })
    nameText: Label = null!;

    @property({ type: GoodsBox, tooltip: 'Goods：主物品框（带数量）' })
    goods: GoodsBox = null!;

    @property({ type: Label, tooltip: 'QualityText：品质名（`gameConfig.qualityname`）' })
    qualityText: Label = null!;

    @property({ type: Label, tooltip: 'CountText：持有数量（`0` ⇒ 空串）' })
    countText: Label = null!;

    @property({ type: Label, tooltip: 'DescText：道具说明' })
    descText: Label = null!;

    @property({ type: Node, tooltip: 'ContentTitle：「内容」标题（有 itemBox 才显示）' })
    contentTitle: Node = null!;

    @property({ type: Node, tooltip: 'ContentBar：「内容」格子容器（挂 GoodsBox，从左到右）' })
    contentBar: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'AccessList：获取途径列表（模板 = ItemDetailRow）' })
    accessList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'BtnGo：前往按钮（有内容可使用）' })
    btnGo: Node = null!;

    @property({ type: Node, tooltip: 'BtnGo1：前往按钮（无内容可使用）' })
    btnGo1: Node = null!;

    @property({ type: Node, tooltip: 'BtnCompos：合成按钮（碎片够才显示）' })
    btnCompos: Node = null!;

    /** 数据端口；测试可替换。 */
    private repo: IItemDetailRepository = itemDetailRepository;

    /** 当前快照（表 + 本次数量）。 */
    private snapshot: IItemDetailSnapshot | null = null;
    private resId = 0;
    private ownedNumber = 0;
    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private loadRevision = 0;
    private presentRevision = 0;
    /** 途径列表数据（渲染与点击回调都按 index 现取）。 */
    private accessRefs: IItemAccessRef[] = [];
    /** 「内容」格子当前对应的 resId。 */
    private contentResIds: number[] = [];
    /** 这一趟要用的图。 */
    private frames: IItemDetailFrames = { title: null, self: EMPTY_BOX, contents: new Map() };
    /**
     * prefab 上烘的缎带静态帧，`presentGoods` 无条件写 `spriteFrame` 时的回退值。
     * 没有它的话，同一实例换品质且这趟缎带图加载失败（`null`）时，
     * 上一件物品的品质颜色会留在屏幕上。
     */
    private defaultTitleFrame: SpriteFrame | null = null;

    /** 面板 / 列表 / 标题的 prefab 基线，运行时只按内容差值收放。 */
    private panelWidget: Widget = null!;
    private panelBaseHeight = 0;
    private panelBaseBottom = 0;
    private listBaseHeight = 0;
    private listBaseY = 0;
    private titleBaseY = 0;
    private contentBlockHeight = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        // 记下 prefab 的静态基线，后面 `applyLayout` 只叠加差值。
        this.defaultTitleFrame = this.titleBg.spriteFrame ?? null;
        const panel = this.panelBg.getComponent(UITransform);
        this.panelWidget = this.panelBg.getComponent(Widget);
        this.panelBaseHeight = panel.height;
        this.panelBaseBottom = this.panelWidget.bottom;
        const list = this.accessList.node.getComponent(UITransform);
        this.listBaseHeight = list.height;
        this.listBaseY = this.accessList.node.position.y;
        this.titleBaseY = this.accessTitle.position.y;
        this.contentBlockHeight = this.contentTitle.position.y - this.titleBaseY;

        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.btnGo, () => this.onGoClick());
        this.bindButton(this.btnGo1, () => this.onGoClick());
        this.bindButton(this.btnCompos, () => this.onComposClick());
    }

    protected async onOpen(userData?: IItemDetailOpenParams): Promise<void> {
        this.resId = Number.isFinite(userData?.resId) ? userData.resId : 0;
        this.ownedNumber = Number.isFinite(userData?.number) ? userData.number : 0;
        this.accessRefs = [];
        this.contentResIds = [];
        this.snapshot = null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 让在途的 load / present 作废。
        this.accessList.refreshList([]);
        this.accessRefs = [];
        this.contentResIds = [];
        this.snapshot = null;
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IItemDetailRepository): void {
        this.repo = repository;
    }

    /** 弹窗还活着吗（异步回来时可能已被关掉）。 */
    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }

    /**
     * 绑按钮：prefab 已挂 `cc.Button`，只绑 CLICK，不退回 TOUCH_END。
     * `closeButton` 允许未绑（本页没有 CloseBtn），未绑时安全跳过。
     */
    private bindButton(node: Node | null | undefined, handler: () => void): void {
        node?.on(Button.EventType.CLICK, handler, this);
    }

    /** 无条件写 `active`，避免复用实例时残留上一件物品的显隐。 */
    private setActive(node: Node, active: boolean): void {
        node.active = active;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = await this.repo.load(this.resId, this.ownedNumber);
        if (!this.alive || revision !== this.loadRevision) return;
        this.snapshot = snapshot;
        await this.present();
    }

    private async present(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const revision = ++this.presentRevision;

        // 图必须先 await 完再铺界面：列表与格子是同步渲染的，边渲染边加载会先闪一帧旧图，
        // 预加载漏项时还会静默留白。所以主框、全部内容格和品质缎带一次性预加载完。
        const frames = await this.loadFrames(snapshot);
        if (!this.alive || revision !== this.presentRevision) return;
        this.frames = frames;

        this.presentTexts(snapshot);
        this.presentGoods(snapshot);
        this.presentContent(snapshot);
        this.presentAccess(snapshot);
        this.presentButtons(snapshot);
        this.applyLayout(this.accessRefs.length, this.contentResIds.length > 0);
    }

    /**
     * 面板 / 列表 / 标题的纵向位置按实际内容一起收放。
     *
     * 必须排在 `presentAccess` 之后：那里才定下 `accessRefs`（查不到途径会塞一行占位）。
     * 三样一起动的原因：只缩列表不改按钮，中间反而空得更明显；只缩面板不改按钮，按钮会跑出面板。
     */
    private applyLayout(rowCount: number, hasContent: boolean): void {
        const list = this.accessList;
        const listNode = list.node;
        const listTransform = listNode.getComponent(UITransform);
        const needed = rowCount * list.itemHeight + Math.max(0, rowCount - 1) * list.spacing;
        const listHeight = Math.min(this.listBaseHeight, needed);
        listTransform.setContentSize(listTransform.width, listHeight);

        const shift = hasContent ? 0 : this.contentBlockHeight;
        listNode.setPosition(listNode.position.x, this.listBaseY + shift, listNode.position.z);
        this.accessTitle.setPosition(this.accessTitle.position.x, this.titleBaseY + shift, this.accessTitle.position.z);

        const panelHeight = this.panelBaseHeight - (this.listBaseHeight - listHeight) - shift;
        this.panelWidget.bottom = this.panelBaseBottom + (this.panelBaseHeight - panelHeight);
        this.panelWidget.updateAlignment();
    }

    // ---------- 预加载 ----------

    private async loadFrames(snapshot: IItemDetailSnapshot): Promise<IItemDetailFrames> {
        const titleTask = loadTitleArt(qualityTitleStepOf(snapshot.row?.quality ?? 1));
        const selfTask = this.loadBox(snapshot.row);
        const entries = await Promise.all(snapshot.itemBox.map(async (resId) => (
            [resId, await this.loadBox(snapshot.items.get(resId) ?? null)] as const
        )));
        const [title, self] = await Promise.all([titleTask, selfTask]);
        return { title, self, contents: new Map<number, IBoxFrames>(entries) };
    }

    /** 一个物品框的两张图（品质框 8 档 + 道具图标）。 */
    private async loadBox(item: IItemRow | null): Promise<IBoxFrames> {
        if (!item) return EMPTY_BOX;
        const [qualityFrame, iconFrame] = await Promise.all([
            loadItemQualityFrame(item.quality),
            loadItemIconArt(item.icon),
        ]);
        return { qualityFrame, iconFrame };
    }

    // ---------- 铺界面 ----------

    private presentTexts(snapshot: IItemDetailSnapshot): void {
        const texts = ITEM_DETAIL_TEXTS;
        const row = snapshot.row;
        // 同一实例会被复用，全部无条件写，条件赋值会留下上一件物品的文案。
        this.nameText.string = row && row.name ? row.name : texts.unknownName;
        this.qualityText.string = snapshot.qualityName;
        this.countText.string = snapshot.numberText;
        this.descText.string = row && row.desc ? row.desc : texts.noDesc;
    }

    private presentGoods(snapshot: IItemDetailSnapshot): void {
        // 缎带承载品质的颜色语义，必须每趟都有确定值。
        this.titleBg.spriteFrame = this.frames.title ?? this.defaultTitleFrame;
        // 主物品框不可点（老端主 `com_goods` 没有 setClick），显式清掉复用实例的残留回调。
        this.goods.onClick = null;
        this.goods.render(this.frames.self.qualityFrame, this.frames.self.iconFrame, snapshot.numberText, true);
    }

    /** 「内容」格子容器下的物品框（按 `_children` 序，prefab 里从左到右摆，不按 active 过滤）。 */
    private get contentSlots(): GoodsBox[] {
        const out: GoodsBox[] = [];
        for (const child of this.contentBar.children) {
            out.push(child.getComponent(GoodsBox));
        }
        return out;
    }

    private presentContent(snapshot: IItemDetailSnapshot): void {
        this.contentResIds = snapshot.itemBox.slice();
        const slots = this.contentSlots;
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index];
            const resId = this.contentResIds[index];
            if (resId === undefined) {
                // 多出来的槽位一律藏掉，连带清掉回调。
                slot.onClick = null;
                slot.hide();
                continue;
            }
            slot.node.active = true;
            // 回调里按 index 现取：槽位是固定节点、会被不同物品复用，闭包捕获 resId 会点错物品。
            slot.onClick = () => this.openItemDetail(this.contentResIds[index]);
            // 「内容」格无数量（老端 `behavior.onNumberVisible(false)`）。
            const box = this.frames.contents.get(resId) ?? EMPTY_BOX;
            slot.render(box.qualityFrame, box.iconFrame, '', false);
        }
    }

    private presentAccess(snapshot: IItemDetailSnapshot): void {
        const list = this.accessList;
        // 途径查不到时给一行占位，否则空列表看着像界面坏了。
        this.accessRefs = snapshot.accessRefs.length > 0
            ? snapshot.accessRefs.slice()
            : [{ resId: 0, text: ITEM_DETAIL_TEXTS.noAccess }];

        // `renderItemFn` / `onItemClickFn` 是普通属性赋值，不是事件订阅；每次铺列表写同一组回调，
        // 回调内部从 `this.accessRefs` 现取数据。
        list.renderItemFn = (node, index) => this.renderAccessRow(node, index);
        list.onItemClickFn = (_node, index) => this.onAccessClick(index);
        list.refreshList(this.accessRefs);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用，每次按当前 `this.accessRefs` 重铺）。 */
    private renderAccessRow(node: Node, index: number): void {
        const view = node.getComponent(ItemDetailRow);
        const ref = this.accessRefs[index];
        if (!ref) {
            view.hide();
            return;
        }
        node.active = true;
        view.render(ref.text);
    }

    private presentButtons(snapshot: IItemDetailSnapshot): void {
        const buttons = snapshot.buttons;
        // prefab 照原稿把 `btn_go` / `btn_go1` /「内容」烘成 true、`btn_compos` 烘成 false，
        // 而弹窗实例会被复用，所以五处显隐全部按状态无条件写。
        // 「内容」容器如果只藏格子不藏容器，会在道具说明与获取途径之间留一块死区。
        this.setActive(this.contentTitle, buttons.showContent);
        this.setActive(this.contentBar, buttons.showContent);
        this.setActive(this.btnGo, buttons.showGo);
        this.setActive(this.btnGo1, buttons.showGo1);
        this.setActive(this.btnCompos, buttons.showCompos);
    }

    // ============================================================
    // 点击
    // ============================================================

    private onGoClick(): void {
        this.jumpTo(this.snapshot?.row?.useJump ?? 0);
    }

    private onComposClick(): void {
        Toast.show(ITEM_DETAIL_TEXTS.composNotWired);
    }

    private onAccessClick(index: number): void {
        const ref = this.accessRefs[index];
        // 占位行的 resId 是 0，不跳（否则点了没反应还以为卡了）。
        if (!ref || ref.resId <= 0) return;
        this.jumpTo(ref.resId);
    }

    /**
     * 跳转出口。老端 `CtrlMgr.CtrlJumpView.JumpType(id)` 这里有两条收尾路径，
     * 本工程还没有 `CtrlJumpView`，所以统一提示「跳转未接入」并把 id 打进控制台。
     * 这是有意留下的接线口：不假装跳成功，否则联调时分不清是没接线还是点了不生效。
     */
    private jumpTo(id: number): void {
        if (!Number.isFinite(id) || id <= 0) return;
        console.log(`[ItemDetail] 跳转 ${id}：${ITEM_DETAIL_TEXTS.jumpNotWired}`);
        Toast.show(ITEM_DETAIL_TEXTS.jumpNotWired);
    }

    /**
     * 点「内容」格子 → 打开那件物品自己的详情（老端 `item.onClickItem()`）。
     *
     * `allowMultiple: true` 必须带上：`PopupManager` 默认「同类已打开则返回现有实例」，
     * 不放开的话点内容格子拿回的是当前页面，等于没反应。
     */
    private openItemDetail(resId: number | undefined): void {
        if (resId === undefined || !Number.isFinite(resId) || resId <= 0) return;
        void ItemDetailPage.open({
            userData: { resId, number: 0 } as IItemDetailOpenParams,
            layer: this.popupLayer,
            allowMultiple: true,
        });
    }
}
