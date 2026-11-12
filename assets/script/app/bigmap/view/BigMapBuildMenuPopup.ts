import { _decorator, Button, instantiate, Label, Node, Sprite } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { BIGMAP_HUD_COLORS } from './BigMapSkin';

const { ccclass, property } = _decorator;

/** 「解锁建造队列」这一行的 kind；`BigMapController.chooseBuilding` 的 `-1` 分支认它。 */
export const BIGMAP_QUEUE_ROW_KIND = -1;

/** 一行的显示数据。文案与配色都算好再传进来 —— 弹窗不认识 model，只负责画和发意图。 */
export interface IBigMapBuildMenuRow {
    readonly kind: number;
    readonly name: string;
    readonly detail: string;
    /** 正在摆放这座建筑：背景提亮，玩家能对上「我刚才点的哪个」。 */
    readonly selected: boolean;
    /** 名字用次要色（建筑还没解锁）。 */
    readonly nameMuted: boolean;
    /** `detail` 用危险色（未解锁原因 / 资源不足）。 */
    readonly detailDanger: boolean;
}

export interface IBigMapBuildMenuPopupContent {
    readonly rows: readonly IBigMapBuildMenuRow[];
}

/**
 * 建造目录弹窗（建筑列表 + 解锁建造队列）。
 *
 * 生命周期、模态遮罩、「点空白关闭」全部交给 `PopupBase`：
 * 基类会自己建一层全屏空白接收层（`ensureBlankCatcher`），`canCloseOnBlank()` 默认 true，
 * 所以这里**不放遮罩节点**，也不再需要页面里那块 `BuildMenuDim`。
 *
 * 数据从 `BigMapPage` 传入（`buildMenu` + `queueUnlock` 已经在那边算好），
 * 弹窗只做两件事：把行画出来、点了就把意图发回去。
 */
@ccclass('BigMapBuildMenuPopup')
export class BigMapBuildMenuPopup extends PopupBase {
    static prefabPath = 'ui/bigmap/BigMapBuildMenuPopup';

    /** 行容器：行由模板实例化，数量随目录变化。 */
    @property(Node) private rowsRoot: Node = null!;
    /** 行模板（prefab 里保持 active=false，运行时复制）。 */
    @property(Button) private rowTemplate: Button = null!;

    private rows: { node: Node; name: Label; detail: Label; background: Sprite; kind: number }[] = [];

    protected onInit(): void {
        this.rowTemplate.node.active = false;
    }

    protected onOpen(content: IBigMapBuildMenuPopupContent): void {
        this.render(content);
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 行是运行时复制出来的，关窗就清掉：下次打开按最新目录重建，避免留下上一份的残留。
        this.clearRows();
    }

    render(content: IBigMapBuildMenuPopupContent): void {
        if (this.rows.length !== content.rows.length) this.rebuildRows(content);
        content.rows.forEach((item, index) => {
            const row = this.rows[index];
            if (!row) return;
            row.kind = item.kind;
            row.name.string = item.name;
            row.detail.string = item.detail;
            row.name.color = item.nameMuted ? BIGMAP_HUD_COLORS.mutedText : BIGMAP_HUD_COLORS.cream;
            row.detail.color = item.detailDanger ? BIGMAP_HUD_COLORS.dangerText : BIGMAP_HUD_COLORS.mutedText;
            row.background.color = item.selected ? BIGMAP_HUD_COLORS.cardLight : BIGMAP_HUD_COLORS.cardDeep;
        });
    }

    private rebuildRows(content: IBigMapBuildMenuPopupContent): void {
        this.clearRows();
        content.rows.forEach((item, index) => {
            const node = instantiate(this.rowTemplate.node);
            node.name = `BuildRow_${item.kind}`;
            node.setParent(this.rowsRoot);
            node.active = true;
            // 行高 56（模板 50 + 6 间距），与面板 556 高刚好容下 10 行。
            node.setPosition(0, 222 - index * 56);
            const name = node.getChildByName('Name')?.getComponent(Label) ?? null!;
            const detail = node.getChildByName('Detail')?.getComponent(Label) ?? null!;
            const background = node.getComponent(Sprite) ?? null!;
            // 行是复用的：`render` 只更新 `row.kind`，所以点击必须读**当前**值 ——
            // 把 `item.kind` 闭包进回调，目录顺序一变就会点到别的建筑。
            const row = { node, name, detail, background, kind: item.kind };
            node.on(Button.EventType.CLICK, () => this.pick(row.kind), this);
            this.rows.push(row);
        });
    }

    private clearRows(): void {
        for (const row of this.rows) {
            if (row.node.isValid) row.node.destroy();
        }
        this.rows.length = 0;
    }

    /** 选中一行：发建造意图并关窗。解锁队列行走 `kind = -1`，由控制器分流。 */
    private pick(kind: number): void {
        this.sendIntent({ kind: 'build', buildingKind: kind });
        this.close(PopupCloseReason.Manual);
    }

    private sendIntent(intent: BigMapIntent): void {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
}
