/**
 * 三套地图编辑器共用的**纯 UI 工具**。
 *
 * ## 只服务 territory / bigmap
 *
 * 它们用 `<script type="module">`，能 import。**对局地图（`index.html` + `app.js`）是 IIFE**
 * （普通 `<script src>`），import 不了 ESM —— 硬改成 module 会动它的作用域，不划算。
 * 所以对局地图那边靠**约定**保持一致（同样的文案、同样的百分比口径），不共享代码。
 *
 * ## 为什么不抽更多
 *
 * 预设下拉的标签、确认弹窗的文案、右侧面板结构，三套差异都很大（一关占多格 vs 世界布局 vs
 * 对抗地图）。强行统一会把「各自好用的部分」磨平 —— 这里只收**行为完全一致**的那几样。
 */

/** 未保存角标：有改动显示「未保存」，干净时整个隐藏。 */
export function setDirtyBadge(badge, dirty) {
    if (!badge) return;
    badge.hidden = !dirty;
    if (dirty) badge.textContent = '未保存';
}

/**
 * 把缩放同步到滑块。
 *
 * `percent` 是**百分比数字**（100 = 100%），不是倍数 —— 两套编辑器的内部 `zoom` 语义不同
 * （领地是对局地图的倍数 0.5~4，大地图直接存 30~220 的百分数），换算留在调用方，
 * 这里只认一个口径，避免"到底传倍数还是百分数"这种隐性 bug。
 */
export function syncZoomSlider(slider, percent) {
    if (!slider) return;
    const value = String(Math.round(percent));
    if (slider.value !== value) slider.value = value;
}

/** 绑定滑块：回调同样收**百分比数字**。 */
export function bindZoomSlider(slider, handler) {
    if (!slider) return;
    slider.addEventListener('input', () => handler(Number(slider.value)));
}

/** 缩放百分比文案（`100` → `100%`），三套统一用这个格式。 */
export function zoomPercentLabel(percent) {
    return `${Math.round(percent)}%`;
}
