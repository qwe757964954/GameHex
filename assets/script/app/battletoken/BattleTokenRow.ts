import { _decorator, CCInteger, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { BT_ART_NAMES, btSpriteType } from './BattleTokenArt';
import { jointState, rewardSlotState } from './BattleTokenTable';
import type { ILevelRow, IPlanRow } from './BattleTokenTable';
import { BattleTokenRewardSlot } from './BattleTokenRewardSlot';

const { ccclass, property } = _decorator;

/** 渲染一行要的外部数据（由页面在 `renderItemFn` 里现取，**禁闭包捕获**）。 */
export interface IRowContext {
    /** 该类型的分级行（含 `max`）。 */
    readonly rows: readonly ILevelRow[];
    /** 该类型的方案行，按 `order` 升序。 */
    readonly plans: readonly IPlanRow[];
    /** 当前战令等级。 */
    readonly level: number;
    /** `order - 1` → 该档位开没开（来自 `CmdBattleToken.tlBattleTokenMessage`）。 */
    readonly opened: readonly boolean[];
    /** `order - 1` → 该档位的 `tlTakeLevel`（`null` = 服务端没给这个字段）。 */
    readonly takenLevels: readonly (readonly number[] | null)[];
    /** 奖励 `resId` → 品质（`null` 时按品质 1 兜底）。 */
    readonly qualityOf: (resId: number) => number;
    /** 奖励 `resId` → 图标帧（未预加载到时为 `null`）。 */
    readonly iconOf: (resId: number) => SpriteFrame | null;
    /** 品质档 → 框帧。 */
    readonly frameOf: (quality: number) => SpriteFrame | null;
    /** 点击某一格（`order` 从 1 开始，`index` 是 0-based 行号）。 */
    readonly onTake: (order: number, index: number, resId: number) => void;
}

/**
 * 战令列表的**一行**（FGUI `组件_战令_项.xml` 三方案 / `组件_战令_项_两个.xml` 两方案）。
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 里每一处状态都必须**绝对赋值**（规则 10）。
 *
 * ⚠️ 两个模板是两个 prefab（`BattleTokenRow3` / `BattleTokenRow2`），只是同一个脚本、
 * `slotCount` 不同 —— 因为 FGUI 原稿本身就是两个组件（底板图 `zhanl3` / `zhanl1` 不同、
 * 两个格的 `xy` 也不同），合并成一个再运行时改坐标反而更脆。
 */
@ccclass('BattleTokenRow')
export class BattleTokenRow extends Component {
    @property({ type: Sprite, tooltip: '行底板（三方案 bt_row_bg_3 / 两方案 bt_row_bg_2）' })
    background: Sprite = null!;

    @property({ type: [BattleTokenRewardSlot], tooltip: '奖励格（三方案 3 个 / 两方案 2 个）' })
    slots: BattleTokenRewardSlot[] = [];

    @property({ type: Node, tooltip: '上方连接段容器（FGUI group n105「头」）' })
    lineTop: Node = null!;

    @property({ type: Sprite, tooltip: '上方连接段的填充（FGUI n104「上」）' })
    lineTopFill: Sprite = null!;

    @property({ type: Node, tooltip: '下方连接段容器（FGUI group n102「尾」）' })
    lineBottom: Node = null!;

    @property({ type: Sprite, tooltip: '下方连接段的填充（FGUI n98「下」）' })
    lineBottomFill: Sprite = null!;

    @property({ type: Label, tooltip: '等级数字（FGUI 文本_等级）' })
    levelLabel: Label = null!;

    /** 这条模板是几个格子（3 = 通行证，2 = 其余）。由生成器写死。 */
    @property({ type: CCInteger, tooltip: '格子数：3 = 三方案模板，2 = 两方案模板' })
    slotCount = 3;

    /** 行底板图（生成器写入；两个模板各自固定，仅暴露给单测核对）。 */
    @property({ type: SpriteFrame, tooltip: '行底板图（生成器写入）' })
    backgroundFrame: SpriteFrame = null!;

    /**
     * 铺一行。
     *
     * @param index 0-based 行号
     * @param ctx   本趟上下文（由页面现取）
     */
    render(index: number, ctx: IRowContext): void {
        const row = ctx.rows[index];
        if (!row) {
            // 数据比可视槽位少（`refreshList` 后的残留槽位）⇒ 整行停用，别画半截旧数据
            this.node.active = false;
            return;
        }
        this.node.active = true;

        // ---- 连接段 + 等级 ----
        const joints = jointState(index, row.max, ctx.level);
        if (this.lineTop) this.lineTop.active = joints.topExist;
        if (this.lineTopFill) {
            // 帧由 prefab 写死（`bt_line_fill`，九宫），这里只切显隐（规则：状态绝对赋值）
            this.lineTopFill.type = btSpriteType(BT_ART_NAMES.lineFill);
            this.lineTopFill.node.active = joints.topLit;
        }
        if (this.lineBottom) this.lineBottom.active = joints.bottomExist;
        if (this.lineBottomFill) {
            this.lineBottomFill.type = btSpriteType(BT_ART_NAMES.lineFill);
            this.lineBottomFill.node.active = joints.bottomLit;
        }
        if (this.levelLabel) this.levelLabel.string = `${index + 1}`;

        // ---- 每个格子 ----
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            if (!slot) continue;
            if (i >= this.slotCount || i >= row.resIds.length) {
                slot.hide();
                continue;
            }
            slot.node.active = true;

            const resId = row.resIds[i];
            const opened = !!ctx.opened[i];
            const taken = ctx.takenLevels[i] ?? null;
            const state = rewardSlotState(opened, taken, ctx.level, index);

            const quality = ctx.qualityOf(resId);
            slot.render(
                state,
                ctx.frameOf(quality),
                ctx.iconOf(resId),
            );
            slot.bindTake(state.canTake ? () => ctx.onTake(i + 1, index, ctx.plans[i]?.resId ?? 0) : null);
        }
    }
}
