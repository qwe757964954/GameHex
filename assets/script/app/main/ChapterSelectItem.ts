import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { CHAPTER_SELECT_STATE } from '../territory/model/ChapterSelectRows';
import type { IChapterSelectRow } from '../territory/model/ChapterSelectRows';

const { ccclass, property } = _decorator;

/**
 * 状态块文字色（照效果图）：金黄块压米白字会糊成一团 ⇒ 用深棕；苔绿块用米白。
 * `Label.color` 的 setter 是逐通道 `set()` 复制，不会把这两个常量实例共享出去。
 */
const STATUS_INK_GOLD = new Color(92, 56, 28, 255);
const STATUS_INK_GREEN = new Color(255, 248, 228, 255);

/**
 * 「章节选择」弹窗里的一行（`ChapterSelectPanel` 的列表模板，代码 clone 后逐行渲染）。
 *
 * 三套外观（切图来自 `image/chapter-select`，2x 出图、九宫格拉伸）：
 * - `locked`：铁灰底板 `row_locked` + 铁灰序号块 `num_block_lock` + 挂锁，**不显示百分比**；
 * - `progress`：米黄底板 `row_base` + 木质序号块 + 苔绿状态块 `status_green` + 百分比；
 * - `cleared`：同 `progress`，状态块换成金黄 `status_gold`。
 * 当前章节额外套一层金色高亮环 `row_current_ring`（中间透明，叠在行最上层不挡内容）。
 *
 * 行点击由 `ChapterSelectPanel` 在 clone 后统一绑（模板自己不订阅），
 * 避免同一份事件在复制出来的每个实例里各绑一遍。
 */
@ccclass('ChapterSelectItem')
export class ChapterSelectItem extends Component {
    @property({ type: Sprite, group: '节点引用', tooltip: 'RowBg：行底板（米黄 / 铁灰）' })
    private rowBg: Sprite = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'CurrentRing：当前章节金色高亮环' })
    private currentRing: Sprite = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'NumBlock：序号块底板' })
    private numBlock: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'NumBlock/IndexLabel：序号（1 起）' })
    private indexLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'TitleLabel：章节名' })
    private titleLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'StatusBlock：完成度状态块（锁定时整块隐藏）' })
    private statusBlock: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'StatusBlock：状态块底板（绿 / 金）' })
    private statusBg: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'StatusBlock/PercentLabel：完成度百分比' })
    private percentLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'StatusBlock/CompleteLabel：「完成度」小字' })
    private completeLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'LockIcon：挂锁（仅锁定行显示）' })
    private lockIcon: Node = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '普通行底板 row_base' })
    private rowBaseFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '锁定行底板 row_locked' })
    private rowLockedFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '木质序号块 num_block' })
    private numBlockFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '铁灰序号块 num_block_lock' })
    private numBlockLockFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '苔绿状态块 status_green（未通关）' })
    private statusGreenFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '美术', tooltip: '金黄状态块 status_gold（已通关）' })
    private statusGoldFrame: SpriteFrame = null!;

    /** 幂等渲染：全量赋值，不做差异比较（列表最多 8 行，开销可忽略）。 */
    render(row: IChapterSelectRow): void {
        const locked = row.state === CHAPTER_SELECT_STATE.locked;
        this.rowBg.spriteFrame = locked ? this.rowLockedFrame : this.rowBaseFrame;
        this.currentRing.node.active = row.current;
        this.numBlock.spriteFrame = locked ? this.numBlockLockFrame : this.numBlockFrame;
        this.indexLabel.string = String(row.index);
        this.titleLabel.string = row.title;
        this.statusBlock.active = !locked;
        this.lockIcon.active = locked;
        if (locked) return;
        const cleared = row.state === CHAPTER_SELECT_STATE.cleared;
        this.statusBg.spriteFrame = cleared ? this.statusGoldFrame : this.statusGreenFrame;
        // 效果图：金块上是深棕字（米白在金黄底上糊成一团），绿块上是米白字
        const ink = cleared ? STATUS_INK_GOLD : STATUS_INK_GREEN;
        this.percentLabel.color = ink;
        this.completeLabel.color = ink;
        this.percentLabel.string = `${row.percent}%`;
        this.completeLabel.string = '完成度';
    }
}
