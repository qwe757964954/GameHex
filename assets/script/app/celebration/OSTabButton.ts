import { _decorator, Button, Component, Node } from 'cc';
import { osTabVisual } from './CelebrationViewState';

const { ccclass, property } = _decorator;

/**
 * 底栏一个庆典页签 —— 挂在 `ui/Celebration/OSRank` 根下的 `TabTarget` / `TabRank` / `TabShop`。
 *
 * ## 为什么抽成子组件（而不是在 `OSRankPage` 上摊 15 个 `@property`）
 *
 * 一个页签是「四张图 + 一个红点」的**强耦合小组**，三份完全同构：
 *
 * | 节点 | FGUI 名 | 图 | 何时显示 |
 * |---|---|---|---|
 * | `PlateUp` | `n10` | `TY_btn13` 168×132（`scale=0.7`） | **未选中** |
 * | `PlateDown` | `n11` | `TY_btn14` 168×132（`scale=0.7`） | **选中** |
 * | `IconOff` | `icon` | `zd_icon_qingdian*` 100×100 | **未选中** |
 * | `IconOn` | `selectIcon` | `zd_icon_qingdian*_1` 80×80 | **选中** |
 *
 * 摊在页面上就是 3 × 5 = 15 个属性 + 15 次 `active` 写入，全挤在一个 `applyTab` 里；
 * 抽出来后页面只持 3 个组件引用，且这套「选中态」的口径能被单测直接对（`osTabVisual`）。
 *
 * ## 🔴 三张未选中的图**长得一样**、三张选中的图**长得一样**
 *
 * `TY_btn13` / `TY_btn14` 是共用图（三个页签共用），只有 `icon` / `selectIcon` 是各自包的
 * （`zd_icon_qingdianMB` / `PM` / `TH`）。所以**本组件不管图** —— prefab 里已经烘好了各自那两张，
 * 本组件只负责「该显示哪一张」。写反了不报错，只是页签图标张冠李戴。
 *
 * ## 四件的 `active` 一律**无条件写**（规则 82）
 *
 * prefab 是照 FGUI **设计期**（`页签 selected="1"`）烘的，且三个页签实例只覆写了 `类型`
 * 没覆写 `button` ⇒ 生成器不得不对 `TabTarget` / `TabShop` 显式烘「未选中」。
 * 那套值只决定「首帧长什么样」；运行时**每趟无条件改写**，绝不「只在翻转时写」——
 * 否则首次 `新值 === 缓存初值` 会短路，页签永久停在错的选中态。
 *
 * ## 点击
 *
 * 三个页签在 FGUI 里都是真 `<button>`（`按钮_民兵页签`）⇒ 迁过来有 `cc.Button`，
 * 监听 `Button.EventType.CLICK` 即可。⚠️ 若哪天换成 `<loader>` / `<image>`，
 * 必须改 `Node.EventType.TOUCH_END`（规则 81b：`<loader>` 只有 `cc.Sprite`，
 * `CLICK` **永远不会 emit**，表现是「点了毫无反应且不报错」）。
 */

// 四张图谁亮的口径已抽到零 `cc` 的 `CelebrationViewState`（规则 78：带 `cc` 的文件里的纯函数，
// Node 用例 import 不进来 ⇒ 会永久脱离回归网）。这里 re-export ⇒ 外部 import 路径不变。
export { osTabVisual } from './CelebrationViewState';
export type { IOsTabVisual } from './CelebrationViewState';

@ccclass('OSTabButton')
export class OSTabButton extends Component {
    @property({ type: Node, tooltip: 'PlateUp：未选中底板（FGUI `n10`，`TY_btn13`）' })
    plateUp: Node = null;

    @property({ type: Node, tooltip: 'PlateDown：选中底板（FGUI `n11`，`TY_btn14`）' })
    plateDown: Node = null;

    @property({ type: Node, tooltip: 'IconOff：未选中图标（FGUI `icon`，100×100）' })
    iconOff: Node = null;

    @property({ type: Node, tooltip: 'IconOn：选中图标（FGUI `selectIcon`，80×80）' })
    iconOn: Node = null;

    @property({ type: Node, tooltip: 'RedDot：页签红点（FGUI `红点`）。只有「庆典目标」页签会被点亮，见 `OSRankPage`' })
    redDot: Node = null;

    /** 点击回调 —— **由宿主在 `onLoad` 之后挂一次**（页签不会像列表行那样被复用）。 */
    onTap: (() => void) | null = null;

    protected onLoad(): void {
        const button = this.node.getComponent(Button);
        if (!button) {
            // 与 `HangEntryButton` 同一处置：只说一声、不静默。
            // 缺 `cc.Button` 时 CLICK 永远不会被 emit，表现是「点了毫无反应且不报错」。
            console.error(`[Celebration] ${this.node.name} 上没有 cc.Button，页签点击不会生效`);
            return;
        }
        button.node.on(Button.EventType.CLICK, this._emitTap, this);
    }

    /**
     * 铺一次选中态 + 红点。
     *
     * 每一处都**无条件写**（规则 82）—— 见文件头。
     */
    render(selected: boolean, redDot: boolean): void {
        const vis = osTabVisual(selected);
        if (this.plateUp) this.plateUp.active = vis.plateUp;
        if (this.plateDown) this.plateDown.active = vis.plateDown;
        if (this.iconOff) this.iconOff.active = vis.iconOff;
        if (this.iconOn) this.iconOn.active = vis.iconOn;
        if (this.redDot) this.redDot.active = redDot;
    }

    private _emitTap(): void {
        this.onTap?.();
    }
}
