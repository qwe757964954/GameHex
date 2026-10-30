import { _decorator, Node, SpriteFrame, UITransform, Vec3, view } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { GoodsBox } from '../itemdetail/GoodsBox';
import { ItemDetailPage } from '../itemdetail/ItemDetailPage';
import {
    ACTIVITY_PREVIEW_HEIGHT,
    previewBubblePlacement,
    previewBubbleWidth,
    previewCellCount,
    previewCellX,
} from './LayerActivityLayout';
import type { IPreviewAnchorBox } from './LayerActivityLayout';

const { ccclass, property } = _decorator;

/** 复用的临时向量（每次点宝箱都 new 一个没必要）。 */
const _tmpWorld = new Vec3();

/** 一格要画的东西 —— **由调用方解析好**（见 `IRewardPreviewParams` 的说明）。 */
export interface IRewardPreviewCell {
    /** 品质框；`null` ⇒ 退回 prefab 上的静态帧（不会画成「没品质」）。 */
    readonly qualityFrame: SpriteFrame | null;
    /** 道具图标；`null` ⇒ 整块隐藏。 */
    readonly iconFrame: SpriteFrame | null;
    /** 数量文案（空串即不显示）。 */
    readonly numberText: string;
    /** 点这一格开详情用（`<= 0` 则不可点）。 */
    readonly resId: number;
    readonly number: number;
}

/** 打开参数。 */
export interface IRewardPreviewParams {
    /** 要预览的奖励（按顺序取前 `ACTIVITY_PREVIEW_MAX_CELLS` 条）。 */
    readonly cells: readonly IRewardPreviewCell[];
    /** 锚点（被点的那个宝箱）在 **UI 世界坐标**里的盒。 */
    readonly anchor: IPreviewAnchorBox;
}

/**
 * 「奖励预览」浮动气泡（`assets/resources/ui/Activity/RewardPreview.prefab`）。
 *
 * 对齐老端 `CtrlAlert.OpenPanelRewards` → `PanelPreviewRewards`（FGUI
 * `共用弹窗/组件/panel弹窗/奖励预览/组件_共用弹窗_查看奖励`）：
 * **点一个不可领取 / 已领取的周活跃宝箱时，把宝箱里有什么摆出来看看**。
 *
 * ## 与老端的两处**有意偏离**（详见 `LayerActivityLayout` 的「奖励预览气泡」一节）
 *
 *   ① 老端用 12 根方位箭头择优定位（`GetPoupPosition2`）。它自己在 `PanelPreviewRewards.ts`
 *      文件头注明「该方法不适用于 720p 的界面，位置信息错误」，而本端设计分辨率正是 720×1280；
 *      且那 12 根箭头的图本端没有 ⇒ 本端改成「贴宝箱正上方、水平居中、夹进屏内，
 *      上方放不下就翻到下方」（`previewBubblePlacement`，纯函数、可单测）。
 *   ② 老端气泡宽固定 `90n + 10(n−1)` 且根节点跟着 list 缩（不改高）；本端气泡宽按内容算
 *      （`2×15 + 90n + 10(n−1)`，见 `previewBubbleWidth`），高恒 150（FGUI 根高）。
 *
 * ## 为什么**不在这里**取数 / 解析图标
 *
 *   调用方（`LayerActivityPage`）为了铺任务行，早就把品质框（4 张固定图）与道具图标
 *   （按 `resId`）预加载并缓存住了，宝箱奖励与任务奖励共用同一批 `resId`。
 *   在这里再查一次 `item` / `roleProperty` 表只会**多一次异步**，还会让「打开气泡」变成
 *   一个可能失败的流程（失败就没有任何反馈 —— 正是这一刀要修的病）。
 *   ⇒ 本类只负责**摆**，不负责**取**；`onOpen` 全同步，没有在途状态要丢。
 *
 * ## 关闭口径
 *
 *   `closeOnBlank = true`（`PopupBase` 默认）+ `contentNodes = [Bubble]`
 *   ⇒ 点气泡**里**不关、点气泡**外**关。这正是老端 `PanelPreviewRewards` 的行为：
 *   `getHasBackground()` 返回 `false`（无全屏遮罩），而 `getFloatNode()` 返回 `com_tips`
 *   ⇒ `PopUtil.CheckInside` 只把「落在 `com_tips` 里」的点击算作「点自己」，其余一律销毁。
 */
@ccclass('RewardPreviewPage')
export class RewardPreviewPage extends PopupBase {
    /**
     * 预制体 resources 路径；目录名须与磁盘一致（Android / iOS 热更新 zip 内路径**大小写敏感**）。
     */
    static prefabPath = 'ui/Activity/RewardPreview';

    @property({ type: Node, tooltip: 'Bubble：气泡底板（九宫格；锚点必须 (0.5,0.5)，运行时按格数改宽）' })
    bubble: Node = null;

    @property({ type: Node, tooltip: 'Bubble/Cells：格子容器（子节点 Cell1..CellN，各挂 GoodsBox）' })
    cells: Node = null;

    /**
     * 当前**打开着**的实例。
     *
     * 同类单开是 `PopupManager` 的默认（`allowMultiple !== true` ⇒ 已打开就返回旧实例），
     * 但那样「点第二个宝箱」会**什么都不发生**（`onOpen` 不会重跑）。这里自己留一个指针：
     * 已开着就**就地重铺 + 重新定位**，否则才新开。
     */
    private static active: RewardPreviewPage | null = null;

    /** 这一次要显示的格子数据（`onCellClick` 按 index 现取）。 */
    private currentCells: readonly IRewardPreviewCell[] = [];

    // ============================================================
    // 静态入口
    // ============================================================

    /**
     * 显示一个宝箱的奖励预览。**已经开着就就地重铺**（不叠窗、也不会「点了没反应」）。
     */
    static showAt(params: IRewardPreviewParams): void {
        const current = RewardPreviewPage.active;
        if (current && current.isPopupOpen && current.node && current.node.isValid) {
            current.present(params);
            return;
        }
        // `PopupBase.open` 是 `PopupManager.openAsync` 的同义写法，失败会 `console.error` 留痕。
        void RewardPreviewPage.open({ userData: params });
    }

    /** 当前实例是否还活着（探针 / 单测用）。 */
    static get current(): RewardPreviewPage | null {
        return RewardPreviewPage.active;
    }

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        // 内容区显式点名气泡：点气泡不关窗、点别处关窗（见类头「关闭口径」）。
        // ⚠️ 必须在 `_bindBlankClose()` 之前设好 —— 基类是在 `onInit` 之后才建的接收层。
        if (this.bubble) this.contentNodes = [this.bubble];
        this.bindCells();
    }

    protected onOpen(userData?: IRewardPreviewParams): void {
        RewardPreviewPage.active = this;
        if (userData) this.present(userData);
    }

    protected onClose(): void {
        if (RewardPreviewPage.active === this) RewardPreviewPage.active = null;
        this.currentCells = [];
    }

    // ============================================================
    // 铺界面
    // ============================================================

    /**
     * 把「这一批奖励 + 锚点」摆上去。
     *
     * 公开是为了让 `showAt` 能在**已经开着**时就地重铺（不必走一次 `open`/`close`）。
     */
    present(params: IRewardPreviewParams): void {
        this.currentCells = params.cells;

        const slots = this.cellNodes();
        const want = previewCellCount(params.cells.length);
        if (slots.length < want) {
            // 不静默丢：格子数不够时**说清楚**（改 prefab 的 `Bubble/Cells` 加格子）
            console.warn(
                `[Activity] RewardPreview 只摆了 ${slots.length} 个格子，`
                + `放不下 ${want} 条奖励，多出来的不会显示`,
            );
        }
        const shown = Math.min(want, slots.length);
        const width = previewBubbleWidth(shown);

        // 气泡底板：九宫格 Sprite（`_type = SLICED` + `sizeMode = CUSTOM`）⇒ 改尺寸即可拉伸
        this.bubble?.getComponent(UITransform)?.setContentSize(width, ACTIVITY_PREVIEW_HEIGHT);

        for (let index = 0; index < slots.length; index += 1) {
            const node = slots[index];
            const box = node.getComponent(GoodsBox);
            if (index >= shown) {
                // 复用残留：藏掉之前先把内容清干净（万一格数变多，不会先闪上一批的图）
                box?.render(null, null, '', false);
                node.active = false;
                continue;
            }
            const cell = params.cells[index] ?? null;
            const numberText = cell?.numberText ?? '';
            // 四个参数**无条件写**（规则 82：复用格不能条件式赋值，否则品质框会留在上一档）
            box?.render(
                cell?.qualityFrame ?? null,
                cell?.iconFrame ?? null,
                numberText,
                numberText.length > 0,
            );
            node.active = true;
            node.setPosition(previewCellX(index, shown), 0, 0);
        }

        this.applyPlacement(params.anchor, width);
    }

    /**
     * 把气泡摆到锚点（被点的宝箱）附近。
     *
     * ⚠️ 换算**必须**走 `convertToNodeSpaceAR`，不要手算「减去半个可见区」：
     *    本工程 UI 世界坐标的原点就在**屏幕左下角**（`cam.screenToWorld(0,0) === (0,0)`），
     *    而弹窗根节点在弹窗层里的位置是 `(0,0)` ⇒ 层原点 = 可见区中心。
     *    `PopupBase.isPointOnNode` 的头注释里记着这条（曾有版本按「原点在中心」算，把居中的
     *    内容板全判成「点在内容上」⇒ 点空白反而不关）。
     */
    private applyPlacement(anchor: IPreviewAnchorBox, bubbleWidth: number): void {
        const bubble = this.bubble;
        if (!bubble) return;

        const visible = view.getVisibleSize();
        const placement = previewBubblePlacement(
            anchor,
            bubbleWidth,
            ACTIVITY_PREVIEW_HEIGHT,
            visible.width,
            visible.height,
        );

        const rootTransform = this.node.getComponent(UITransform);
        if (!rootTransform) {
            // 理论上不会走到（prefab 根一定有 UITransform）；退化成「层坐标 = UI 坐标」会偏
            bubble.setPosition(placement.x, placement.y, 0);
            return;
        }
        const local = rootTransform.convertToNodeSpaceAR(_tmpWorld.set(placement.x, placement.y, 0));
        bubble.setPosition(local.x, local.y, 0);
    }

    // ============================================================
    // 格子
    // ============================================================

    /**
     * `Bubble/Cells` 下的格子（按名字序 = `Cell1..CellN`）。
     *
     * ⚠️ 这里**不写成 `@property([GoodsBox])`**：MCP 的 `component_set_component_property`
     *    只支持 `propertyType === 'component'`（单个组件），**没有 componentArray**
     *    （`nodeArray` 那条分支本身也是坏的，见 `LayerActivityPage.ACTIVITY_HEADER_NODES` 的注释）
     *    ⇒ 组件数组在 Inspector 上根本配不出来。按节点名字取是同处境下唯一的可行做法，
     *    并由 `tests/activity.test.ts` 钉住 prefab 里确实摆了 `ACTIVITY_PREVIEW_MAX_CELLS` 个格子。
     */
    private cellNodes(): Node[] {
        const parent = this.cells;
        if (!parent) return [];
        return parent.children.filter((node) => !!node && node.isValid && node.name.startsWith('Cell'));
    }

    /** 绑格子点击 —— 格子在 prefab 里是静态的（不 clone），绑一次即可。 */
    private bindCells(): void {
        const slots = this.cellNodes();
        for (let index = 0; index < slots.length; index += 1) {
            const box = slots[index].getComponent(GoodsBox);
            if (!box) {
                console.warn(`[Activity] RewardPreview 的 ${slots[index].name} 上没有 GoodsBox 组件，这一格不可点`);
                continue;
            }
            // 回调里按 index **现取**当前数据：格子不复用，但 `currentCells` 每次都换。
            box.onClick = () => this.onCellClick(index);
        }
    }

    /** 点一格 ⇒ 弹物品详情（与 `ShowRewardPage.onItemClick` 同一口径）。 */
    private onCellClick(index: number): void {
        const cell = this.currentCells[index];
        if (!cell || !(cell.resId > 0)) return;
        void ItemDetailPage.open({
            userData: { resId: cell.resId, number: cell.number },
            allowMultiple: true,
        });
    }
}
