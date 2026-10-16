/**
 * 北伐两个子页（排行 / 奖励）共用的**页签按钮** —— FGUI `主界面_联盟/副本/北伐中原/组件_联盟_页签.xml`
 * （`extention="Button"`、`mode="Radio"`、207×105，内部一枚 224×79 的 loader + 一行 title + 一颗 `com_rd`）。
 *
 * ## 两态怎么表达（FGUI 用 `gearIcon` + `gearColor` 两条一起切）
 *
 * ```xml
 * <gearIcon  controller="button" pages="0,1,2,3"
 *            values="…7ws21yxnalz | …7ws21yxnam2 | …7ws21yxnalz | …7ws21yxnam2"/>
 * <gearColor controller="button" pages="0,1,2,3"
 *            values="#b6af95,#160e08|#fcf0d6,#502010|#b6af95,#502010|#fcf0d6,#502010"/>
 * ```
 *
 * `button` controller 的 4 页是 `up / down / over / selectedOver`，`selected="3"` ⇒
 *
 * | 状态 | 底图 | 字色 | 描边 |
 * |---|---|---|---|
 * | 未选中 | `TY_btn23`（**亮**） | `#b6af95`（暗） | `#160e08` |
 * | 选中 | `TY_btn20`（**暗**） | `#fcf0d6`（亮） | `#502010` |
 *
 * ⚠️ **底图与字色是反着来的**（选中 = 底图变暗 + 文字变亮）—— 只换底图不换字色，
 *    两个页签看着都像"选中的"，肉眼几乎分不出。两张底图由宿主预载后传进来
 *    （`render()` 是同步的，现加载会闪一帧上一张图，同 `LeagueRewardSlot` 的口径）。
 *
 * ## 红点
 *
 * FGUI 那颗 `com_rd` 名字是 `com_rd`，本端统一叫 `RedDot`（挂 `ui/common/RedDot.prefab` 的嵌套实例），
 * 与 `LeagueTable.LEAGUE_ENTRANCE_RED_DOT` 同一个约定。只有**奖励页**两颗页签会点亮它
 * （老端 `updateView()` 里 `tab_league.com_rd` / `tab_role.com_rd`）；排行页两颗不点亮（但节点照建，
 * 免得两个 prefab 的页签结构不一致）。
 */

import { _decorator, Button, color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';
import {
    LEAGUE_ART_NORTH_TAB_NORMAL,
    LEAGUE_ART_NORTH_TAB_SELECTED,
    LEAGUE_ART_NORTH_TAB_TEXT_NORMAL,
    LEAGUE_ART_NORTH_TAB_TEXT_SELECTED,
    LEAGUE_ART_NORTH_TAB_TEXT_STROKE,
} from './LeagueArt';

const { ccclass, property } = _decorator;

/** 页签的两张底图（宿主预载后传进来；`null` ⇒ 保留 prefab 上的静态图，不清成空白）。 */
export interface ILeagueNorthTabFrames {
    readonly normal: SpriteFrame | null;
    readonly selected: SpriteFrame | null;
}

/** 页签要用的图名（宿主按它预载）—— 与 `LeagueArt` 的两态常量一一对应，别各写一份。 */
export const LEAGUE_NORTH_TAB_ART_NAMES: readonly string[] = [
    LEAGUE_ART_NORTH_TAB_NORMAL,
    LEAGUE_ART_NORTH_TAB_SELECTED,
];

@ccclass('LeagueNorthTab')
export class LeagueNorthTab extends Component {
    /**
     * `Bg`：底图（FGUI `组件_联盟_页签.xml` 的 `n4`，224×79 而组件只有 207×105
     * ⇒ 底图**必须**是子节点，不能挂在根上）。
     *
     * ⚠️ 保留 `getComponent(Sprite)` 兜底：老写法是「把底图挂在根上」，
     *    万一有 prefab 还是那个形状，`onLoad` 里也能取到。
     */
    @property({ type: Sprite, tooltip: 'Bg：页签底图（两态靠换 spriteFrame）' })
    bg: Sprite = null!;

    @property({ type: Label, tooltip: 'title：页签文案（联盟排名 / 盟内进度 / 联盟奖励 / 个人奖励）' })
    titleLabel: Label = null!;

    @property({ type: Node, tooltip: 'com_rd：页签红点（只有奖励页会点亮）' })
    redDot: Node = null!;

    /** 点到这个页签（宿主按自己的页签表分发）。 */
    onTabClick: (() => void) | null = null;

    /** 实际写图的那个 Sprite（`bg` 优先，退回根上的 Sprite）。 */
    private bgSprite: Sprite | null = null;

    private frames: ILeagueNorthTabFrames = { normal: null, selected: null };
    private selected = false;
    private dotOn = false;
    private bound = false;

    protected onLoad(): void {
        this.bgSprite = this.bg ?? this.getComponent(Sprite);
        if (this.bound) return;
        this.bound = true;
        const button = this.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onClick, this);
        else this.node.on(Node.EventType.TOUCH_END, this.onClick, this);
        this.apply();
    }

    /** 传入两张底图（宿主预载）—— 读画时调一次就够，重复调也安全。 */
    setFrames(frames: ILeagueNorthTabFrames): void {
        this.frames = frames;
        this.apply();
    }

    /** 选中态（绝对赋值）。 */
    setSelected(selected: boolean): void {
        this.selected = selected === true;
        this.apply();
    }

    /** 红点（绝对赋值）。 */
    setRedDot(on: boolean): void {
        this.dotOn = on === true;
        this.apply();
    }

    /** 文案（页签表改了文案时用；一般 prefab 上已经写好）。 */
    setTitle(text: string): void {
        if (this.titleLabel) this.titleLabel.string = text;
    }

    /** 当前是否选中（探针 / 单测用）。 */
    get isSelected(): boolean {
        return this.selected;
    }

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 把 `selected` / `dotOn` / `frames` 三个状态**一次性落到节点上**。
     *
     * ⚠️ 三条都是**绝对赋值**（不累积）：槽位复用 / 反复切页签时不会留下上一次的残影。
     */
    private apply(): void {
        const frame = this.selected ? this.frames.selected : this.frames.normal;
        const sprite = this.bgSprite ?? this.bg ?? this.getComponent(Sprite);
        if (frame && sprite) sprite.spriteFrame = frame;

        if (this.titleLabel) {
            const rgb = this.selected ? LEAGUE_ART_NORTH_TAB_TEXT_SELECTED : LEAGUE_ART_NORTH_TAB_TEXT_NORMAL;
            this.titleLabel.color = color(rgb[0], rgb[1], rgb[2], 255);
            // 描边同色切（FGUI 那条 `gearColor` 的第二列）：选中态描边更深
            this.titleLabel.outlineColor = color(
                LEAGUE_ART_NORTH_TAB_TEXT_STROKE[0],
                LEAGUE_ART_NORTH_TAB_TEXT_STROKE[1],
                LEAGUE_ART_NORTH_TAB_TEXT_STROKE[2],
                255,
            );
        }

        // 红点走共用组件（跨嵌套 prefab 边界取不到内部组件 ⇒ 取不到就退回直接写 active）
        const dot = this.redDot ? this.redDot.getComponent(RedDot) : null;
        if (dot) dot.setRedDot(this.dotOn ? 1 : 0);
        else if (this.redDot) this.redDot.active = this.dotOn;
    }

    private readonly onClick = (): void => {
        if (this.onTabClick) this.onTabClick();
    };
}
