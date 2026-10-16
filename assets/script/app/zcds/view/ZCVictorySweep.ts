import type { ZCOwner } from '../model/ZCGameModel';
import type { ZCHexView } from './ZCHexView';
import {
    buildVictorySweepPlan, victorySweepDuration, victorySweepLitStep,
    victorySweepRevertCursor, victorySweepRevertMix,
} from './ZCGameViewUtil';

interface VictorySweepState {
    winner: ZCOwner;
    steps: ReadonlyMap<number, number>;
    stepCount: number;
    elapsed: number;
    litStep: number;
    /** 回正游标（见 `victorySweepRevertCursor`）：整数 = 已回正到第几步，小数 = 行内过渡比例。 */
    revertCursor: number;
}

/**
 * 结算胜利方扫场动画。
 *
 * 纯表现层：步号表按「离起点那一侧隔了几行」分层、**整行共用一个步号**，
 * 每铺到一格就把那格的 `ZCHexView.sweepOwner` 设成胜利方 —— **不回写模型**，
 * 所以战报与领地统计读到的仍是真实归属。
 *
 * 🔴 2026-10-15 row8 起轴上是**两段、且重叠**（见 `ZCGameViewUtil` 的两段常量）：
 *  - ① 填充：整行铺**深饱和**阵营色，一行接一行；
 *  - ② 回正：铺到最后两行时从**起点**整行推回去，每格从深饱和色过渡到阵营**当前色**
 *    （`setSweepOwner(owner, mix)` 的 `mix`）。
 *
 * 回正段每帧都在变（行内是连续过渡），所以 `advance` 的「要不要重画」判据同时看
 * 填充步号与回正游标两个量 —— 只比填充步号的话，回正会整段不刷新。
 */
export class ZCVictorySweep {
    private state: VictorySweepState | null = null;

    constructor(
        private readonly hexViews: ReadonlyMap<number, ZCHexView>,
        private readonly entitiesByHex: ReadonlyMap<number, number>,
    ) {}

    /**
     * 开始扫场：建步号表，**但一格都不染**。幂等 —— 已在播时忽略。
     * 返回 false 表示这一盘没有可染的格子（全是虚空），调用方别等它。
     *
     * 起手不留亮格（`litStep = -1`，等第一次 `advance` 才推到 0）是故意的：
     * 镜头要先拉远到看得见整盘，如果这里就把起手那一格染上，玩家在原视角下会先看到
     * 屏幕边上莫名变了一格、几百毫秒后镜头才动 —— 顺序反了。
     */
    start(map: Parameters<typeof buildVictorySweepPlan>[0], winner: ZCOwner): boolean {
        if (this.state) return true;
        const plan = buildVictorySweepPlan(map, winner);
        if (!plan.stepCount) return false;
        this.state = {
            winner,
            steps: plan.steps,
            stepCount: plan.stepCount,
            elapsed: 0,
            litStep: -1,
            revertCursor: -1,
        };
        // litStep = -1 ⇒ 这一趟只会把每格的覆盖显式清成「无」（顺带兜掉可能的残留），
        // 不会染色。
        this.applyViews();
        return true;
    }

    /**
     * 推进扫场，返回视图覆盖是否变化；调用方据此重绘，播放状态通过 isPlaying 查询。
     *
     * 只在「填充跨到新的一行」或「回正游标动了」时才重画：整盘 200 来格的 spriteFrame 赋值，
     * 每帧无条件刷会白白吃掉结算这几秒。回正段虽然每帧游标都会动，但 `ZCHexView.render`
     * 自己用 `contentKey` 挡掉了无变化的格 —— 实际只有正在过渡的那一两行会真的换图。
     */
    advance(dt: number): boolean {
        const sweep = this.state;
        if (!sweep) return false;
        sweep.elapsed += Math.max(0, dt);
        const lit = victorySweepLitStep(sweep.elapsed, sweep.stepCount);
        const cursor = victorySweepRevertCursor(sweep.elapsed, sweep.stepCount);
        if (lit !== sweep.litStep || cursor !== sweep.revertCursor) {
            sweep.litStep = lit;
            sweep.revertCursor = cursor;
            this.applyViews();
            return true;
        }
        return false;
    }

    /**
     * 中止扫场并把所有格子还原成真实归属的底色。
     * 重开一局、退出对局都要调 —— 否则下一局的格子会带着上一局胜利方的颜色出场。
     */
    clear(): void {
        if (!this.state) return;
        this.state = null;
        // 视图覆盖由渲染世界的 clearVictorySweep 统一清理。
    }

    /**
     * 查询某格在扫场期间应显示的阵营归属。
     * 返回 `null` = 不覆盖（用真实归属）；返回阵营 = 用扫场胜利方覆盖。
     *
     * 由 `renderHexSystem` 的 `ownerForHex` 回调调用，用来决定领地轮廓边界与地块染色。
     */
    ownerForHex(hexId: number): ZCOwner | null {
        const sweep = this.state;
        if (!sweep) return null;
        const step = sweep.steps.get(hexId);
        if (step === undefined) return null;
        return step <= sweep.litStep ? sweep.winner : null;
    }

    /** 是否持有扫场覆盖；播放结束后保留覆盖，直到调用 clear。 */
    get active(): boolean {
        return this.state !== null;
    }

    get isPlaying(): boolean {
        const sweep = this.state;
        return sweep !== null && sweep.elapsed < victorySweepDuration(sweep.stepCount);
    }

    /**
     * 把当前步号和回正游标写进各格视图；地块重绘由调用方统一驱动。
     *
     * 每格的颜色由两个量决定（`ZCGameViewUtil.victorySweepRevertMix`）：
     *  - 还没铺到（`step > litStep`）⇒ 覆盖撤掉，按真实归属渲染；
     *  - 铺到了但还没轮到回正 ⇒ `mix = 0`（深饱和色）；
     *  - 回正已经推过这一行 ⇒ `mix = 1`（阵营当前色）；正推在这一行 ⇒ 中间值。
     */
    private applyViews(): void {
        const sweep = this.state;
        if (!sweep) return;
        for (const [hexId, step] of sweep.steps) {
            const entityId = this.entitiesByHex.get(hexId);
            // 判 `=== undefined` 而不是 `!entityId`：实体序号是自增的，"没有"是 undefined，
            // 0 只表示"当前没用这个号"。写成 falsy 判断会让 0 号实体静默漏染一格。
            if (entityId === undefined) continue;
            const painted = step <= sweep.litStep;
            this.hexViews.get(entityId)?.setSweepOwner(
                painted ? sweep.winner : null,
                painted ? victorySweepRevertMix(sweep.revertCursor, step) : 0,
            );
        }
    }
}
