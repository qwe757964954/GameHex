import { _decorator, Button, Component, Node } from 'cc';
import { RedDot } from '../common/RedDot';
import { osTabVisual } from './CelebrationViewState';

const { ccclass, property } = _decorator;

// 选中态口径放在零 cc 的 CelebrationViewState，带 cc 的文件里的纯函数 Node 用例 import 不进来。
// 这里 re-export，外部 import 路径不变。
export { osTabVisual } from './CelebrationViewState';
export type { IOsTabVisual } from './CelebrationViewState';

/**
 * 底栏一个庆典页签，挂在 `ui/Celebration/OSRank` 根下的 `TabTarget` / `TabRank` / `TabShop`。
 *
 * 一个页签是「四张图 + 一个红点」的强耦合小组，三个页签同构：
 * `PlateUp`（FGUI `n10`，`TY_btn13`）、`PlateDown`（`n11`，`TY_btn14`）、
 * `IconOff`（`icon`，100×100）、`IconOn`（`selectIcon`，80×80）。
 * 本组件不管图：`TY_btn13/14` 三页签共用，`icon/selectIcon` 已按页签烘进 prefab，这里只决定显示哪张。
 *
 * 四张图的 `active` 一律无条件写。prefab 照设计期（`页签 selected="1"`）烘，只决定首帧；
 * 若「只在翻转时写」，首次新值等于缓存初值就会短路，页签永久停在错的选中态。
 *
 * 三个页签在 FGUI 里都是真按钮，迁过来有 `cc.Button`，监听 `CLICK` 即可。
 * 若哪天换成 loader / image，必须改用 `TOUCH_END`：只有 `cc.Sprite` 时 `CLICK` 永不 emit，
 * 表现是「点了毫无反应且不报错」。
 */
@ccclass('OSTabButton')
export class OSTabButton extends Component {
    @property({ type: Node, tooltip: 'PlateUp：未选中底板（FGUI n10，TY_btn13）' })
    plateUp: Node = null!;

    @property({ type: Node, tooltip: 'PlateDown：选中底板（FGUI n11，TY_btn14）' })
    plateDown: Node = null!;

    @property({ type: Node, tooltip: 'IconOff：未选中图标（FGUI icon，100×100）' })
    iconOff: Node = null!;

    @property({ type: Node, tooltip: 'IconOn：选中图标（FGUI selectIcon，80×80）' })
    iconOn: Node = null!;

    @property({ type: RedDot, tooltip: 'RedDot：页签红点（工程通用红点）。只有「庆典目标」页签会被点亮，见 OSRankPage' })
    redDot: RedDot = null!;

    /** 点击回调，由宿主在 `onLoad` 之后挂一次；页签不会像列表行那样被复用。 */
    onTap: () => void = null!;

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this._emitTap, this);
    }

    /** 铺一次选中态 + 红点；每一处都无条件写。 */
    render(selected: boolean, redDot: boolean): void {
        const vis = osTabVisual(selected);
        this.plateUp.active = vis.plateUp;
        this.plateDown.active = vis.plateDown;
        this.iconOff.active = vis.iconOff;
        this.iconOn.active = vis.iconOn;
        this.redDot.setRedDot(redDot);
    }

    private _emitTap(): void {
        this.onTap();
    }
}
