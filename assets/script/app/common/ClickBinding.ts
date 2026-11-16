import { Button, Node } from 'cc';

/**
 * 存量 FGUI 迁移页的兼容绑法：有 `cc.Button` 走 CLICK，没有则退 TOUCH_END。
 *
 * @deprecated 仅 FGUI `<loader>` / `<image>` 迁过来的页面过渡用。新页面必须在
 * prefab 上挂 `cc.Button` 并只绑 CLICK —— 本 helper 是 `AGENTS.md`「禁止
 * CLICK/TOUCH_END 兜底」的存量例外，不应扩散；页面补齐 Button 后应删除。
 */
export function bindButton(
    node: Node | null | undefined,
    handler: () => void,
    target?: unknown,
): void {
    if (!node) return;
    const button = node.getComponent(Button);
    if (button) {
        button.node.on(Button.EventType.CLICK, handler, target);
        return;
    }
    node.on(Node.EventType.TOUCH_END, handler, target);
}
