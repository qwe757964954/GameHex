import { _decorator, Component, Label, Node, Sprite, SpriteFrame, UIOpacity } from 'cc';
import { RedDot } from '../common/RedDot';

const { ccclass, property } = _decorator;

/**
 * 七日狂欢的**一个天数按钮**（内联在 `SevenDay.prefab` 的 `DayBar` 下，99×99）。
 *
 * 结构对齐 FGUI `七日狂欢/自定义组件/按钮_七日狂欢_天数.xml`：
 *   本节点挂 `cc.Sprite` 当底板（两态换图），下面挂 `DayLabel` / `RedDot` / `SelectGlow`。
 *
 *  FGUI 里那个按钮还有两个装饰件，本期**没落地**（都不承载信息）：
 *    - `selectDay`（`组件_特效_七日狂欢当前天.xml`，选中时旋转的光效）→ 用 `SelectGlow` 占位，
 *      运行时挂 `SevenDayGlow` 上一个 `cc.RotateBy` 式的匀速自转；美术给了图就换上；
 *    - `com_rd`（公用红点组件）⇒ 用工程的 RedDot 组件。
 */
@ccclass('SevenDayDayTab')
export class SevenDayDayTab extends Component {
    /** `DayLabel`：`第一天` / `第二天` … */
    @property({ type: Label, tooltip: 'DayLabel：天数文案（第N天）' })
    dayLabel: Label = null;

    /** 底板就是**本节点自己**的 `cc.Sprite`。 */
    @property({ type: Sprite, tooltip: '背景：本节点上的 cc.Sprite（两态换图）' })
    background: Sprite = null;

    @property({ type: RedDot, tooltip: 'RedDot：有可领取任务时的红点（默认隐藏）' })
    redDot: RedDot = null;

    @property({ type: Node, tooltip: 'SelectGlow：选中时的旋转光效（默认隐藏）' })
    selectGlow: Node = null;

    /**
     * ⚠️ 图名别写反（2026-09-26 实测，用 md5 对过老端原稿）：
     *   老端 `自定义组件/按钮_七日狂欢_天数.xml` 里 `状态=开启` 挂的是 `七日狂欢_按钮_天数01.png`、
     *   `未开启` 挂 `…天数02.png`；而 `sd_day_on.png` 的 md5 **等于** `天数01`（亮黄）、
     *   `sd_day_off.png` 等于 `天数02`（暗灰）。
     *   ⇒ **已解锁 = `sd_day_on`（亮）**、未解锁 = `sd_day_off`（暗）。
     *   （先前这里两个 tooltip 互换了，prefab 也照错的绑 —— 症状是「已解锁的天显示成暗球」。）
     */
    @property({ type: SpriteFrame, tooltip: '已解锁的底板（`sd_day_on`，亮黄）' })
    unlockedFrame: SpriteFrame = null;

    @property({ type: SpriteFrame, tooltip: '未解锁的底板（`sd_day_off`，暗灰）' })
    lockedFrame: SpriteFrame = null;

    /** 选中态的放大倍率——FGUI 用 scale 1.2 表示"当前天"。 */
    private static readonly SELECTED_SCALE = 1.12;

    render(day: number, label: string, unlocked: boolean, selected: boolean, hasRedDot: boolean): void {
        if (!this.background) {
            // ⚠️ `@property` 是「同节点指自己」那种，新建脚本时编辑器未必把字段写进 prefab，
            //    这里兜一次（见 `cocos-mcp-build-prefab` §15.4）；已绑定时不会走到。
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }
        this.dayLabel.string = label;
        // ⚠️ 绝对赋值：天数按钮会被复用（切天数时同 7 个节点重填），
        //    条件式赋值会留下上一个状态的图（对象池同款缺陷，规则 10）。
        this.background.spriteFrame = unlocked ? this.unlockedFrame : this.lockedFrame;
        this.redDot.setRedDot(hasRedDot);
        this.selectGlow.active = selected;
        this.node.setScale(selected ? SevenDayDayTab.SELECTED_SCALE : 1, selected ? SevenDayDayTab.SELECTED_SCALE : 1, 1);
        // 未解锁的按钮压暗（老端靠 `gearColor` 改文字色；这里整体压暗更省一张图）
        const opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        opacity.opacity = unlocked ? 255 : 200;
    }

    /** 隐藏（表里天数不够 7 天时，多余的天数按钮藏掉）。 */
    hide(): void {
        this.node.active = false;
    }
}
