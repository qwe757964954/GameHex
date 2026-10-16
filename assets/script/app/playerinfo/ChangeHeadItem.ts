import { _decorator, Component, Node, Sprite, SpriteFrame, Color } from 'cc';

const { ccclass, property } = _decorator;

/** 已解锁时的正常色。 */
const COLOR_NORMAL = new Color(255, 255, 255, 255);
/** 未解锁时压暗（老端用 `gearLook` 的 `grayed` 效果，Cocos 侧用颜色近似）。 */
const COLOR_LOCKED = new Color(90, 90, 90, 255);

/**
 * 「更换头像」列表里的一格 —— 老端 `个人信息__组件_个人信息_更换头像item`
 * （FGUI `个人信息/组件/更换头像/组件_个人信息_更换头像item.xml`，组件本体 123×123）。
 *
 * 结构（FGUI 原稿 → prefab）：
 *   `n5`  底图 84×77 拉伸到 123×122   → `ItemBg`
 *   `com_head` 头像框                → `HeadBox`（`HeadFrame` 73×73 底 + `HeadIcon` 90×90 头像）
 *   `n2` 选中框 `icon_fg_selected`    → `SelectedFrame`（`gearDisplay controller="选中"`，设计期隐藏）
 *   `com_rd` 新头像红点               → `RedDot`（设计期隐藏）
 *
 * ## 两个控制器（老端运行时切页，Cocos 侧改显隐 / 颜色）
 *
 * | FGUI 控制器 | 页面 | 老端写法 | 本组件 |
 * |---|---|---|---|
 * | `选中` `pages="0,否,1,是"` | 是 ⇒ `n2` 显示 | `setSelectedPage("选中", …)` | `setSelected()` |
 * | `是否解锁` `pages="0,否,1,是"` | 否 ⇒ `com_head` 置灰 | `setSelectedPage("是否解锁", …)` | `setLocked()` |
 *
 * ⚠️ 状态**一律无条件写**（规则 82）：槽位会被不同头像复用，条件式赋值会留下上一格的选中框。
 * ⚠️ 点击用 `TOUCH_END` 不是 `Button.EventType.CLICK` —— FGUI 这一格是纯 `<component>`，
 *    迁过来**没有 `cc.Button`**（规则 81b），绑 `CLICK` 是静默死按钮。
 */
@ccclass('ChangeHeadItem')
export class ChangeHeadItem extends Component {
    @property({ type: Sprite, tooltip: 'HeadIcon：头像图（`com_head.icon`，设计期无图，运行时塞）' })
    headIcon: Sprite = null!;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像底框 73×73（`com_head.n0`）' })
    headFrame: Sprite = null!;

    @property({ type: Node, tooltip: 'SelectedFrame：选中框（`n2`，设计期隐藏）' })
    selectedFrame: Node = null!;

    @property({ type: Node, tooltip: 'RedDot：新头像红点（`com_rd`，设计期隐藏）' })
    redDot: Node = null!;

    /** 点这一格（参数 = **数据下标**，由 `HeadGridList` 在重绑时写入 `dataIndex`）。 */
    onClicked: ((dataIndex: number) => void) | null = null;

    /** 当前承载的数据下标（-1 = 未被绑定）。 */
    dataIndex = -1;

    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    // ============================================================
    // 对外
    // ============================================================

    /** 塞头像图（`null` = 清空，不保留上一格的图）。 */
    setHead(frame: SpriteFrame | null): void {
        if (this.headIcon) this.headIcon.spriteFrame = frame;
    }

    /** 选中态。**无条件写**。 */
    setSelected(selected: boolean): void {
        if (this.selectedFrame) this.selectedFrame.active = selected;
    }

    /** 解锁态：未解锁压暗。**无条件写**。 */
    setLocked(locked: boolean): void {
        const c = locked ? COLOR_LOCKED : COLOR_NORMAL;
        if (this.headIcon) this.headIcon.color = c;
        if (this.headFrame) this.headFrame.color = c;
    }

    /** 新头像红点。**无条件写**。 */
    setNew(isNew: boolean): void {
        if (this.redDot) this.redDot.active = isNew;
    }

    // ============================================================
    // 内部
    // ============================================================

    private onTouchEnd(): void {
        if (this.dataIndex < 0) return;
        this.onClicked?.(this.dataIndex);
    }
}
