import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { Toast } from '../common/Toast';
import { GoodsBox } from './GoodsBox';
import { ItemDetailRow } from './ItemDetailRow';
import { qualityFrameSuffixOf, qualityTitleStepOf } from './ItemDetailTable';
import type { IItemAccessRef, IItemRow } from './ItemDetailTable';
import { itemDetailRepository } from './ItemDetailRepository';
import type { IItemDetailRepository, IItemDetailSnapshot } from './ItemDetailRepository';
import { loadItemIconArt, loadQualityFrameArt, loadTitleArt } from './ItemDetailArtLoader';
import { ITEM_DETAIL_TEXTS } from './ItemDetailTexts';

const { ccclass, property } = _decorator;

/** `ItemDetailPage.open({ userData })` 的入参。 */
export interface IItemDetailOpenParams {
    /** 物品 `resId`（`item` 表主键）。 */
    readonly resId: number;
    /** 持有数量；不传按 `0`。 */
    readonly number?: number;
}

/** 一个物品框要用的两张图（宿主预加载好再铺，见 `loadFrames`）。 */
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
 * 「物品详情」弹窗 —— 老端 `LayerRolrItemDetail`（`LayerRoleItemDetailUI`），
 * FGUI `主界面_角色/组件/道具/组件_角色_道具详情.xml`（720×1280，与画布 1:1）。
 *
 * 版面（自上而下）：
 *   主底板 + 品质缎带 + 品质名 + 数量 + 物品名 + 主物品框
 *   「道具说明」+ 描述条
 *   「内容」标题 + 内容格子（`itemBox`）
 *   「获取途径」+ 途径列表
 *   底部按钮（前往 / 前往 / 合成，三选一）
 *
 * ## 分层（与 `SevenDayPage` / `FirstRechargePage` 同一套）
 *
 *   判定与解析  `ItemDetailTable`（纯函数、可单测）
 *   数据        `ItemDetailRepository`（读 `item` / `viewtype` / `itemCraft` / `gameConfig`）
 *   美术        `ItemDetailArt`（纯数据）+ `ItemDetailArtLoader`（`resources.load` + 缓存）
 *   子视图      `GoodsBox`（物品框）、`ItemDetailRow`（途径行）
 *   本类        只做「取数 → 预加载图 → 同步铺界面」和「点击 → 开详情 / 跳转」
 *
 * 项目约定：样式与布局全在 prefab 的 Inspector 上；只有「随数据变化的东西」
 * （品质帧、文案、按钮三选一、列表行）才在代码里算。
 *
 * ## ⚠️ 老端本界面**不发请求**
 *
 * `CtrlRole.openLayerRoleItemDetails(voItem)` 只做 `SetGoods(vo) + load()`，
 * 全部内容来自本地表 + 已持有的 Goods VO。所以本类也**不造假的刷新请求** ——
 * 表读不到显示空态，编辑器预览 / 离线都能打开，不白屏、不报错。
 */
@ccclass('ItemDetailPage')
export class ItemDetailPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/ItemDetail/`，I 与 D 大写）：
     * 热更新 zip 内路径大小写敏感，写错在编辑器里照样能跑，真机才 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/ItemDetail/ItemDetail';

    @property({ type: Node, tooltip: 'CloseBtn：关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

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
    /** 本次打开的入参。 */
    private resId = 0;
    private ownedNumber = 0;
    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private loadRevision = 0;
    private presentRevision = 0;
    /** 途径列表数据（`renderItemFn` 里按 index 现取）。 */
    private accessRefs: IItemAccessRef[] = [];
    /** 「内容」格子当前对应的 resId（点击回调里按 index 现取）。 */
    private contentResIds: number[] = [];
    /** `renderItemFn` / `onItemClickFn` 只需绑一次。 */
    private accessRendererBound = false;
    /** 这一趟要用的图（`renderItemFn` 等长驻回调从这里现取，不闭包捕获）。 */
    private frames: IItemDetailFrames = { title: null, self: EMPTY_BOX, contents: new Map() };
    /**
     * prefab 上烘的缎带静态帧 —— 让 `presentGoods` 能**无条件写** `spriteFrame`（规则 82）。
     * 不这么做的话，同一实例被不同品质的物品复用时，只要这一趟的缎带图加载失败（`null`），
     * 上一件物品的**品质颜色**就留在屏幕上了（不报错）。
     */
    private defaultTitleFrame: SpriteFrame | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.defaultTitleFrame = this.titleBg?.spriteFrame ?? null;
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.btnGo, () => this.onGoClick());
        this.bindButton(this.btnGo1, () => this.onGoClick());
        this.bindButton(this.btnCompos, () => this.onComposClick());
    }

    protected async onOpen(userData?: IItemDetailOpenParams): Promise<void> {
        this.resId = userData && Number.isFinite(userData.resId) ? userData.resId : 0;
        this.ownedNumber = userData && Number.isFinite(userData.number) ? (userData.number as number) : 0;
        this.accessRefs = [];
        this.contentResIds = [];
        this.snapshot = null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 让在途的 load / present 直接作废（它们醒来时页面已经关了）。
        this.loadRevision += 1;
        this.presentRevision += 1;
        this.accessList?.refreshList([]);
        this.accessRefs = [];
        this.contentResIds = [];
        this.snapshot = null;
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IItemDetailRepository): void {
        this.repo = repository;
    }

    /** 弹窗还活着吗（异步回来时页面可能已被关掉）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }

    /**
     * 绑按钮。
     *
     * ⚠️ FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**（规则 81b）：
     * 那种节点上绑 `Button.EventType.CLICK` 是**静默死按钮**。反过来，`<component>` 形态的
     * 按钮迁过来**有** `cc.Button`，绑 `TOUCH_END` 会绕过 `interactable`（灰态仍可点）。
     * 所以按「节点上到底有没有 `cc.Button`」分流 —— 两个方向都不会错。
     */
    private bindButton(node: Node | null | undefined, handler: () => void): void {
        if (!node) return;
        const button = node.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, handler, this);
            return;
        }
        node.on(Node.EventType.TOUCH_END, handler, this);
    }

    /** 无条件写 `active`（规则 82）；节点没绑就跳过（预览期漏绑定不抛）。 */
    private setActive(node: Node | null | undefined, active: boolean): void {
        if (node) node.active = active;
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

        //  图必须先 **await 完**再铺界面：列表与格子渲染是同步的，在里面现加载会先闪
        //  一帧上一份的图（`VScrollView` 回收残影同款缺陷）；更糟的是预加载集合漏项时
        //  **静默留白**（不报错，规则 60/73）—— 所以这里一次性把主框 + 全部内容格 +
        //  品质缎带一起预加载完。
        const frames = await this.loadFrames(snapshot);
        if (!this.alive || revision !== this.presentRevision) return;
        this.frames = frames;

        this.presentTexts(snapshot);
        this.presentGoods(snapshot);
        this.presentContent(snapshot);
        this.presentAccess(snapshot);
        this.presentButtons(snapshot);
    }

    // ---------- 预加载 ----------

    private async loadFrames(snapshot: IItemDetailSnapshot): Promise<IItemDetailFrames> {
        const title = loadTitleArt(qualityTitleStepOf(snapshot.row?.quality ?? 1));
        const self = this.loadBox(snapshot.row);
        const entries = await Promise.all(snapshot.itemBox.map(async (resId) => (
            [resId, await this.loadBox(snapshot.items.get(resId) ?? null)] as const
        )));
        const [titleFrame, selfFrames] = await Promise.all([title, self]);
        return { title: titleFrame, self: selfFrames, contents: new Map<number, IBoxFrames>(entries) };
    }

    /** 一个物品框的两张图（品质框 8 档 + 道具图标）。 */
    private async loadBox(item: IItemRow | null): Promise<IBoxFrames> {
        if (!item) return EMPTY_BOX;
        const [qualityFrame, iconFrame] = await Promise.all([
            loadQualityFrameArt(qualityFrameSuffixOf(item.quality)),
            loadItemIconArt(item.icon),
        ]);
        return { qualityFrame, iconFrame };
    }

    // ---------- 铺界面 ----------

    private presentTexts(snapshot: IItemDetailSnapshot): void {
        const texts = ITEM_DETAIL_TEXTS;
        const row = snapshot.row;
        // 无条件写（规则 82）：同一实例会被复用，条件式赋值会留下上一件物品的文案。
        this.nameText.string = row && row.name ? row.name : texts.unknownName;
        this.qualityText.string = snapshot.qualityName;
        this.countText.string = snapshot.numberText;
        this.descText.string = row && row.desc ? row.desc : texts.noDesc;
    }

    private presentGoods(snapshot: IItemDetailSnapshot): void {
        // 无条件写（规则 82）：`?? defaultTitleFrame` 保证「加载失败」也落到一个确定值，
        // 否则上一件物品的缎带颜色会留下来（缎带就是品质的**颜色**语义，静默显示错品质）。
        this.titleBg.spriteFrame = this.frames.title ?? this.defaultTitleFrame;
        const goods = this.goods;
        if (!goods) return;
        // 主物品框**不可点**：老端 `InitUI` 里主 `com_goods` 没有 `setClick`
        // （只有「内容」格里那个和 HUD 那个才有），显式清掉回调以免复用残留。
        goods.onClick = null;
        goods.render(this.frames.self.qualityFrame, this.frames.self.iconFrame, snapshot.numberText, true);
    }

    /** 「内容」格子容器下的物品框（按 `_children` 序 —— prefab 里从左到右摆，不要按 active 过滤）。 */
    private get contentSlots(): GoodsBox[] {
        const out: GoodsBox[] = [];
        const bar = this.contentBar;
        if (!bar) return out;
        for (const child of bar.children) {
            const box = child.getComponent(GoodsBox);
            if (box) out.push(box);
        }
        return out;
    }

    private presentContent(snapshot: IItemDetailSnapshot): void {
        const slots = this.contentSlots;
        this.contentResIds = snapshot.itemBox.slice();
        for (let index = 0; index < slots.length; index++) {
            const slot = slots[index];
            const resId = this.contentResIds[index];
            if (resId === undefined) {
                // 多出来的槽位一律藏掉（不是"留着空的"）
                slot.onClick = null;
                slot.hide();
                continue;
            }
            slot.node.active = true;
            // ⚠️ 回调里按 **index 现取** `this.contentResIds[index]`，不能闭包捕获 `resId`：
            //   槽位是固定节点、会被不同物品复用，捕获会让点第 3 格开第 1 格的物品。
            slot.onClick = () => this.openItemDetail(this.contentResIds[index]);
            // 「内容」格无数量：老端 `behavior.onNumberVisible(false)`
            const box = this.frames.contents.get(resId) ?? EMPTY_BOX;
            slot.render(box.qualityFrame, box.iconFrame, '', false);
        }
    }

    private presentAccess(snapshot: IItemDetailSnapshot): void {
        const list = this.accessList;
        if (!list) return;
        // 途径查不到时给一行占位（老端留空列表，看着像"界面坏了"）
        this.accessRefs = snapshot.accessRefs.length > 0
            ? snapshot.accessRefs.slice()
            : [{ resId: 0, text: ITEM_DETAIL_TEXTS.noAccess }];

        // ⚠️ `renderItemFn` / `onItemClickFn` 是**长驻**回调（只挂一次），
        //   它们每次被调用时都要拿「这一趟」的数据 —— 所以只能从 `this.accessRefs`
        //   **现取**，绝不能闭包捕获这里的 `snapshot`（否则后续 reload 都用第一份）。
        if (!this.accessRendererBound) {
            this.accessRendererBound = true;
            list.renderItemFn = (node, index) => this.renderAccessRow(node, index);
            list.onItemClickFn = (_node, index) => this.onAccessClick(index);
        }
        list.refreshList(this.accessRefs);
    }

    /** 虚拟列表的行渲染（被 clone 复用的槽位 → 每次按当前 `this.accessRefs` 重铺）。 */
    private renderAccessRow(node: Node, index: number): void {
        const view = node.getComponent(ItemDetailRow);
        if (!view) return;
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
        // 无条件写（规则 82）：prefab 照原稿烘出来 `btn_go`/`btn_go1`/「内容」都是 `true`、
        // 只有 `btn_compos` 是 `false` —— 「只在翻转时写」会让首帧停在错的组合上。
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
        // 占位行的 `resId` 是 0，不跳（否则点了没反应还以为卡了）
        if (!ref || ref.resId <= 0) return;
        this.jumpTo(ref.resId);
    }

    /**
     * 跳转出口。老端 `jumpTo(id)` 分两路收尾（5 个 `JUMP_TYPE` 走 `closeLayersAboveMain()`，
     * 其余走 `unload()`），最后都落到 `CtrlMgr.CtrlJumpView.JumpType(id)`。
     *
     * ⚠️ **本工程还没有 `CtrlJumpView`**（跳转链路不在本次迁移范围），所以这里统一
     * 提示「跳转未接入」并把 `id` 打进控制台 —— 这是**有意留下的接线口**，
     * 不假装跳成功（静默无反应会让联调时分不清是"没接线"还是"点了没生效"）。
     */
    private jumpTo(id: number): void {
        if (!Number.isFinite(id) || id <= 0) return;
        console.log(`[ItemDetail] 跳转 ${id}：${ITEM_DETAIL_TEXTS.jumpNotWired}`);
        Toast.show(ITEM_DETAIL_TEXTS.jumpNotWired);
    }

    /**
     * 点「内容」格子 → 打开那个物品**自己**的详情（老端 `item.onClickItem()`）。
     *
     * ⚠️ 必须 `allowMultiple: true`：`PopupManager` 默认「同类已打开则返回现有实例」，
     *    不放开的话点内容格子会**什么都不发生**（拿回的是当前这个页面）。
     */
    private openItemDetail(resId: number | undefined): void {
        if (resId === undefined || !Number.isFinite(resId) || resId <= 0) return;
        void ItemDetailPage.open({
            userData: { resId, number: 0 } as IItemDetailOpenParams,
            allowMultiple: true,
        });
    }
}
