import { _decorator, Button, Label, Node, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { EventMgr } from '../../framework/event/EventMgr';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { TerritoryUiEvent } from '../territory/application/TerritoryEvents';
import { ChapterSelectItem } from './ChapterSelectItem';
import type { IChapterSelectRow } from '../territory/model/ChapterSelectRows';

const { ccclass, property } = _decorator;

/** 弹窗内容：行数据由 `loadChapterSelectRows` 组装好再传进来（弹窗自己不解表）。 */
export interface IChapterSelectContent {
    readonly rows: readonly IChapterSelectRow[];
    /** 当前章节在 `rows` 里的位置；`-1` 表示不在列表内（不滚动）。 */
    readonly currentIndex: number;
}

/**
 * 「章节选择」弹窗 —— 主界面 `BeginGame` 两侧的章节入口点开（切图见
 * `assets/resources/image/chapter-select/切图说明.md`）。
 *
 * ## 职责边界
 * - 尺寸 / 遮罩 / 点空白关闭 / 层级全部交给 `PopupManager` + `PopupBase`（prefab 上
 *   根节点与 `Dim` 各挂四边 `cc.Widget`）；
 * - **行数据**由 `loadChapterSelectRows` 组装，本类只负责铺行与派发意图；
 * - 选章走 `TerritoryUiEvent.Intent`（`kind: 'selectChapter'`），由 `TerritoryController`
 *   转给模型；弹窗**不直接**调模型，也不关心中间是否被拒（当前章没通关时模型自己弹提示）。
 *
 * ## 列表是虚拟列表（`VirtualScrollView`）
 * - 行模板 = `Content` 的第一个子节点 `Item`（prefab 里 `active=false`；列表 `start()` 时
 *   会把它 `removeFromParent` 收作模板，之后只 clone 出可视区那几个 slot）；
 * - 渲染回调 `renderItemFn` **只能代码赋值**（不是 `@property`，Inspector 上没有这个槽）；
 * - `Content` 上**不能挂 `cc.Layout`** —— 虚拟列表自己算 slot 坐标，Layout 会每帧覆盖；
 * - 行点击在 `renderItemFn` 里绑：slot 是复用的，用 `node.targetOff(this)` 先清掉自己上一次
 *   的监听再加（幂等，且不会误伤 `VirtualScrollView` 自己绑的点击处理）。
 */
@ccclass('ChapterSelectPanel')
export class ChapterSelectPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/main/`）。 */
    static prefabPath = 'ui/main/ChapterSelectPanel';

    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'List：虚拟列表（Mask 挂在它身上）' })
    private list: VirtualScrollView = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'TitlePlank/TitleLabel：标题「章节选择」' })
    private titleLabel: Label = null!;

    /** 本次打开要铺的行（`renderItemFn` 是长驻回调，必须从这里现取，不能闭包捕获入参）。 */
    private rows: readonly IChapterSelectRow[] = [];
    private rendererBound = false;

    protected onOpen(userData?: IChapterSelectContent): void {
        const content = userData;
        if (!content) return;
        this.titleLabel.string = '章节选择';
        this.rows = content.rows;
        if (!this.rendererBound) {
            this.rendererBound = true;
            this.list.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        // ⚠️ 顺序关键：先把 content 归零、再改数量。
        // `_recomputeContentSize()` 里有一段「改数量前在底部 ⇒ 改完保持贴底」的 snap，
        // 弹窗实例被回收复用时（上次滚到底、这次只有 5 行）会把位置 clamp 到贴底，
        // 第一行就被顶掉了。`scrollToTop()` 走 tween 赶不上这次 reflow，直接归零最稳。
        this.list.content?.setPosition(0, 0, 0);
        this.list.setTotalCount(this.rows.length);
        // 滚到当前章再延后一帧：slot 与 content 高度要等列表自己 `_updateVisible` 才算出来。
        this.scheduleOnce(() => this.scrollToCurrent(content.currentIndex));
    }

    /**
     * 让当前章进视野 —— **首屏能装下就别再动，装不下才滚**。
     *
     * 5 行（内容 824）只比视窗（720）高 104：无条件 `scrollToIndex` 会把它顶到顶部，
     * 反而裁掉第一行。回顶已经在 `onOpen` 里、`setTotalCount` 之前做掉了。
     */
    private scrollToCurrent(index: number): void {
        if (index < 0 || this.rows.length === 0) return;
        const view = this.list.node.getComponent(UITransform);
        const content = this.list.content?.getComponent(UITransform);
        if (!view || !content) return;
        // 内容高 = n × 行高 + (n − 1) × 间距 ⇒ 反推 stride，别在脚本里硬编码行高
        const stride = (content.height + this.list.spacing) / this.rows.length;
        if (stride <= 0) return;
        if (index < Math.floor(view.height / stride)) return;
        this.list.scrollToIndex(index, false);
    }

    protected onClose(): void {
        this.rows = [];
    }

    /** 虚拟列表的单行渲染（slot 复用 ⇒ 每次全量重铺）。 */
    private renderRow(node: Node, index: number): void {
        const row = this.rows[index];
        if (!row) return;
        const item = node.getComponent(ChapterSelectItem);
        if (!item) return;
        item.render(row);
        // slot 会被回收复用：先摘掉自己上一次绑的监听，避免同一个节点堆积多个闭包
        node.targetOff(this);
        node.on(Button.EventType.CLICK, () => this.onRowSelect(row.chapterId), this);
    }

    private onRowSelect(chapterId: number): void {
        EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'selectChapter', chapterId } });
        this.close();
    }
}
