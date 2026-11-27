import { _decorator, Button, CCInteger, Color, Component, Label, Node } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { RedDot } from '../common/RedDot';
import { RoleEvent } from './RoleEvents';
import type { RoleBagTabId } from './RoleTypes';

const { ccclass, property } = _decorator;

/** 未选中：灰底深棕字；选中：白字 + 深棕描边（设计稿）。颜色值是只读常量，`Label.color` 的 setter 会复制。 */
const LABEL_IDLE = new Color(74, 55, 38, 255);
const LABEL_SELECTED = new Color(255, 255, 255, 255);
const LABEL_OUTLINE = new Color(54, 34, 17, 255);

/**
 * 角色页背包页签（挂 `ui/Role/Role.prefab` 的 `BagTabGem` / `BagTabEquip` / `BagTabItem`）。
 *
 * 负责本页签的三件事，宿主 `RolePage` 不再逐节点取 Button / `hl` / `title` / `com_rd`：
 *   1. 点击 —— 自己绑 CLICK 并派发 `{ kind: 'bag', tab }`；
 *   2. 选中态 —— `setSelected` 绝对赋值 `hl` 显隐 + 文字色 / 描边（切回来不留残影）；
 *   3. 红点 —— `setRedDot` 透传给 `com_rd` 上的 `RedDot`。
 *
 * `tabId` 是 Inspector 数据，**不从节点名反推**（`BagTabGem` → 1 这种约定改个名就静默错位）。
 */
@ccclass('RoleBagTabItem')
export class RoleBagTabItem extends Component {
    @property({ type: CCInteger, tooltip: '页签 id：1 宝石 / 2 装备 / 3 道具' })
    tabId: RoleBagTabId = 1;

    @property({ type: Node, tooltip: 'hl：选中高亮底板（本页签被选中时显示）' })
    hl: Node = null!;

    @property({ type: Label, tooltip: 'title：页签文字（选中切白字 + 描边）' })
    title: Label = null!;

    @property({ type: RedDot, tooltip: 'com_rd：本页签的红点（RedDot 组件）' })
    redDot: RedDot = null!;

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    /** 选中态。未选中的页签也要写（`hl` 显隐是两态都得落），否则切走时高亮留在原地。 */
    setSelected(selected: boolean): void {
        this.hl.active = selected;
        this.title.color = selected ? LABEL_SELECTED : LABEL_IDLE;
        this.title.enableOutline = selected;
        this.title.outlineColor = LABEL_OUTLINE;
        this.title.outlineWidth = 2;
    }

    /** 红点唯一入口（0 / false = 不显示），透传给 `com_rd` 上的 `RedDot`。 */
    setRedDot(value: number | boolean): void {
        this.redDot.setRedDot(value);
    }

    private onClick = (): void => {
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: this.tabId });
    };
}
