/**
 * 主界面右下角「聊天」入口按钮（`assets/resources/ui/main/ArenaRoot.prefab`（竞技页）根下 `ChatEntry`）。
 *
 * ⚠️ 2026-09-24：入口按钮连同资源栏、左右入口列一起从 `MainRoot.prefab`（主界面外壳）
 * **搬到 `ArenaRoot`**，归为「竞技页自己的常驻 HUD」—— 切到角色页时随 ArenaRoot 一起销毁，
 * 表现就是「只在竞技页显示」。
 *
 * 版面真源 = 老端 FGUI `战斗_主界面/组件/战斗_主界面.xml` 的 `聊天` 组件：
 * 外层 100×100、内层按钮 90×100（`xy=(5,0)`，在 100 宽里水平居中）、
 * 图标 `zjm_icon03_LiaoTian`（已落 `image/chat/ct_main_chat.png`，实测 90×100，非九宫）、
 * 红点 `com_rd` 在 `xy=(69,1)`（30×30 组件 ⇒ 中心相对外框中心 = `(+34, +34)`）。
 *
 * ## 为什么不是 `open.json` 的数据驱动入口
 *
 * 策划表里 `refId=13` 那行是 `belond = 0`（左列 2 / 右列 3 之外），
 * 老端就是因为它是「右下角固定悬浮按钮」才不放进左右两列的。
 * 所以这里**手挂**一个按钮，而不是去改表 —— 改表会把它塞进左/右列，位置就错了。
 *
 * 位置用 `cc.Widget` 的 `alignFlags = RIGHT | BOTTOM` + `right = 15 / bottom = 152`
 * 表达（与老端 `sidePair="bottom-bottom"` 同义）：换机型高度变化时贴着右下角走，
 * 不要写成固定 `position` —— 那样在更高的机型上会飘到屏幕中间。
 *
 * ## 红点
 *
 * 按既定口径「红点统一后面做」：`RedDot` 节点在 prefab 里**保持隐藏**，
 * 本类只把引用留好（`setRedDot`），不主动点亮，也不在 `onLoad` 里强改它的 `active`。
 */

import { _decorator, Button, Component, Node } from 'cc';
import { PopupManager } from '../../framework/ui/PopupManager';
import { ChatPage } from './ChatPage';

const { ccclass, property } = _decorator;

@ccclass('ChatEntryButton')
export class ChatEntryButton extends Component {
    @property({
        type: Node,
        tooltip: 'RedDot：红点占位（本轮不接，节点在 prefab 里保持隐藏）。接红点时用 setRedDot() 显隐。',
    })
    redDot: Node = null!;

    onLoad(): void {
        const button = this.node.getComponent(Button);
        if (!button) {
            console.warn(`[Chat] ${this.node.name} 上没有 cc.Button，点击不会生效`);
            return;
        }
        // ⚠️ 刻意**不**配对应的 onDestroy / off（与 login/ServerSelectItem.ts、login/ServerSelectPanel.ts、
        //    framework/ui/PopupBase.ts 同一约定）。手动 off 会炸，而且一炸就炸整条销毁链：
        //
        //   ① 同节点组件按 `_components` 数组序销毁（engine `node.ts:1544` 的
        //      `comps[i]._destroyImmediate()`）——prefab 里 `Btn` 的组件序是
        //      [UITransform, Sprite, **cc.Button**, ChatEntryButton]
        //      ⇒ cc.Button 排在前面，**先**被销毁；
        //   ② `CCObject._destroyImmediate`（`object.ts:377`）在 `_onPreDestroy()` 返回后会调
        //      `_destruct()`（`object.ts:388`），而它把实例 own property 里所有 object 型字段
        //      重置为 null —— 其中就包含 `Component.node`
        //      （`component.ts:188` `public node: Node = NullNode`，`NullNode = null`）
        //      ⇒ 此刻 `Button.node === null`；
        //   ③ `Node._findComponent`（`node.ts:297`）**不校验 isValid** ⇒
        //      `this.node.getComponent(Button)` 拿回来的正是那个已 destruct 的 Button
        //      ⇒ `.node.off(...)` 抛 `TypeError: Cannot read properties of null (reading 'off')`；
        //   ④ 异常从组件销毁循环里抛出 ⇒ `object.ts:391` 的 `_objFlags |= Destroyed` 执行不到
        //      ⇒ 节点/组件停在 Destroying 却未 Destroyed ⇒ 之后重复销毁刷
        //      "You are trying to destroy a object twice or more"。
        //
        //    而「不 off」本来就是安全的：节点销毁时序里 `Node._onPreDestroyBase` 会先
        //    `this._eventProcessor.destroy()`（`node.ts:1530`，在销毁组件之前）把监听清空。
        button.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    private onClick(): void {
        void this.openChat();
    }

    /**
     * 打开聊天弹窗。
     *
     * `PopupManager` 同类单实例 ⇒ 连点不会叠出两个聊天框（第二下返回同一个实例）。
     * 管理器常驻节点被销毁 / 预制体加载失败时 `openAsync` 自己也返回 `null`，这里只留痕。
     */
    async openChat(): Promise<void> {
        const manager = PopupManager.inst;
        if (!manager) {
            console.error('[Chat] 入口按钮：PopupManager 不可用，聊天打不开');
            return;
        }
        const popup = await manager.openAsync(ChatPage);
        if (!popup) console.error('[Chat] 入口按钮：聊天弹窗打开失败');
    }

    /** 红点显隐的唯一入口（本轮不接，接口先留好）。 */
    setRedDot(visible: boolean): void {
        if (this.redDot) this.redDot.active = visible;
    }
}
