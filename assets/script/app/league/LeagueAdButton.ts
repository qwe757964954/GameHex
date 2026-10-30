/**
 * 「联盟 · 广告按钮」——FGUI `主界面_联盟/组件/按钮_联盟_广告.xml` 的 Cocos 版（240×110）。
 *
 * 捐献面板上**两颗按钮用的是同一个组件**，靠 `类型` controller 切页：
 *
 * | FGUI 控制器 | 页 | 面板上的实例 | 可见的子节点 |
 * |---|---|---|---|
 * | `类型` | 0 免费 | `btnFree` | `n10` 底图 + `n7` 浅色条 + `lab_adv` + `n9` 小视频角标 + `com_rd` |
 * | `类型` | 1 金币 | `btnBuy`（`controller="类型,1"`） | `n10` 底图 + `labCost` + `icon` + `com_rd` |
 *
 * 五处 `gearDisplay` 就是上表的可见性，本类在 `setPage()` 里**绝对赋值**成 `active`
 * （FGUI 的控制器在 Cocos 里没有等价物，只能摊成 bool）。见 `LeagueDonatePage`。
 *
 * ## 抠出来的几处口径（别按直觉改）
 *
 * 1. **`labCost` 与 `icon` 的位置是「隔着一段」的**：`icon`（50×50，中心 x=67）
 *    在左、`labCost`（103×46，中心 x=159.5）在右 —— 金币按钮的左右结构（图标 + 数字）。
 * 2. **`n7` 浅色条与 `n9` 小视频角标中心重合**（都在 (119.5, 26)）：条是 `lab_adv`
 *    上面那行浅底，视频角标压在条上 ⇒ 两者**同进同出**（都只在「免费」页）。
 * 3. **`n7` 是 `white_jiao8` 染色**（原图纯白，靠 `color="#666666"` + `alpha="0.4"` 才渲染成
 *    那条灰底）—— 只写 `a` 不写 rgb 会渲染成白条。见 `LEAGUE_ART_AD_BAR_TINT`。
 * 4. **`com_rd` 在「免费」页只受 `hasDonateRD` 管**（老端 `LayerLeagueDonate.updateView`）
 *    —— 广告子系统没迁 ⇒ 本端**恒关**（见 `LeagueDonatePage`）。
 *
 * 7 个 `@property` 在 `LeagueDonate.prefab` 的两颗实例（`BtnFree` / `BtnBuy`）上**全部绑死**
 * ⇒ 方法里一律直接 `.` 取值，不写 `if (this.xxx)`（2026-10-30 清理；prefab 掉组件要炸出来，
 * 静默跳过只会让「切页没反应」查不出来）。
 */

import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** `类型` controller 的两页（与 FGUI `pages="0,免费,1,金币"` 同序）。 */
export type LeagueAdButtonPage = 'free' | 'coin';

@ccclass('LeagueAdButton')
export class LeagueAdButton extends Component {
    @property({ type: Sprite, tooltip: 'n10：底图 TY_btn10（两页共用）' })
    bg: Sprite = null;

    @property({ type: Node, tooltip: 'n7：浅色条 white_jiao8（仅「免费」页）' })
    freeBar: Node = null;

    @property({ type: Label, tooltip: 'lab_adv：免费次数文案（仅「免费」页）' })
    freeLabel: Label = null;

    @property({ type: Node, tooltip: 'n9：小视频角标 img_video（仅「免费」页）' })
    freeVideo: Node = null;

    @property({ type: Node, tooltip: 'icon：货币图标容器（仅「金币」页，内含 cc.Sprite）' })
    costIcon: Node = null;

    @property({ type: Label, tooltip: 'labCost：单价（仅「金币」页）' })
    costLabel: Label = null;

    @property({ type: Node, tooltip: 'com_rd：红点（老端只受 hasDonateRD 管；本端恒关）' })
    redDot: Node = null;

    /** `icon` 上的 `cc.Sprite`（懒取一次）。 */
    private iconSprite: Sprite | null = null;

    /**
     * 切页 —— FGUI `setSelectedPage("类型", ...)` 的等价物。
     *
     * 五处 `gearDisplay` 全部**绝对赋值**（不读上一帧）：两个实例各自独立，跨实例复用也不会串。
     */
    setPage(page: LeagueAdButtonPage): void {
        const free = page === 'free';
        this.freeBar.active = free;
        this.freeLabel.node.active = free;
        this.freeVideo.active = free;
        this.costIcon.active = !free;
        this.costLabel.node.active = !free;
    }

    /** `labCost`（金币页的单价）。 */
    setCost(cost: number): void {
        this.costLabel.string = Number.isFinite(cost) ? String(Math.trunc(cost)) : '0';
    }

    /** `lab_adv`（免费页的文案）。 */
    setFreeLabel(text: string): void {
        this.freeLabel.string = text;
    }

    /** `icon` 的货币图标（按 `resId` 解析出的帧；`null` 时保留静态图）。 */
    setCostIcon(frame: SpriteFrame | null): void {
        if (!frame) return;
        if (!this.iconSprite) this.iconSprite = this.costIcon.getComponent(Sprite);
        this.iconSprite.spriteFrame = frame;
    }

    /** 红点显隐的唯一入口（本端恒 `false`，接口先留好）。 */
    setRedDot(visible: boolean): void {
        this.redDot.active = !!visible;
    }
}
