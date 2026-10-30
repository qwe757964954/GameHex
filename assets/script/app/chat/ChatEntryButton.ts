/**
 * 主界面底部聊天条的点击入口（ArenaRoot/BottomHud/ChatBar）。
 * 通过 PopupManager 打开聊天页，复用同类弹窗单实例规则。
 * 红点由宿主按需提供；当前底部聊天条没有红点节点。
 */

import { _decorator, Button, Component, Node } from 'cc';
import { PopupManager } from '../../framework/ui/PopupManager';
import { ChatPage } from './ChatPage';

const { ccclass, property } = _decorator;

@ccclass('ChatEntryButton')
export class ChatEntryButton extends Component {
    @property({
        type: Node,
        tooltip: 'Optional notification dot supplied by the host',
    })
    redDot: Node | null = null;

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
        const popup = await manager.openAsync(ChatPage);
        if (!popup) console.error('[Chat] 入口按钮：聊天弹窗打开失败');
    }

    /** 红点显隐的唯一入口（本轮不接，接口先留好）。 */
    setRedDot(visible: boolean): void {
        if (this.redDot) this.redDot.active = visible;
    }
}
