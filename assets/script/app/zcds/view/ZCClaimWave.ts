import type { ZCHexView } from './ZCHexView';
import {
    buildClaimWavePlan,
    claimWaveProgress,
    type ZCClaimWaveCallbacks,
    type ZCClaimWaveEntry,
    type ZCClaimWavePlan,
} from './ZCGameViewUtil';

/**
 * 开局归属扩散波所需的外部访问能力。由渲染世界注入，避免本模块直接持有地块视图表的内部引用。
 */
export interface ZCClaimWaveDeps {
    /** 地块视图注册表；归调用方持有，claim wave 只读查找。 */
    hexViews: ReadonlyMap<number, ZCHexView>;
    /** hexId 到实体序号的只读索引。 */
    hexEntityBySource: ReadonlyMap<number, number>;
}

interface ZCClaimWaveState {
    plan: ZCClaimWavePlan;
    /** 波前起点（表现时钟，与 `visualTime` 同源）。 */
    startedAt: number;
    /** 上一拍写进各格的进度：值没变就不碰 Sprite（`Sprite.color` 每次赋值都会标脏重绘）。 */
    written: Map<number, number>;
}

/**
 * 开局「归属扩散」表现：把**中立格**在选点阶段铺的半区色逐个换成战斗底色，
 * 以各自主城为圆心向外扩散（环内按极角扫一圈）、半径越来越大、越往外越快。
 *
 * ## 归属格不在这里
 *
 * 开局就归属的格（主城 + 其 6 邻格）**不进波**（见 `buildClaimWavePlan` 的过滤）：
 * 需求要的就是它们「一帧直接切换」。波只负责中立格 —— 因为整盘底色要从
 * 「紫 / 红的半区色」退回真实的战斗底色，这一步才是需要摊开成一圈圈扩散的那个变化。
 *
 * ## 为什么是纯表现层
 *
 * 归属在**开局那一刻就已经定好了**（`ZCSnapshotCodec.createInitialState` 把主城格与
 * 主城邻格直接判给对应方），半区也只是选点阶段的既有概念，没有任何"逐格占领"的模型过程。
 * 所以这里和 `ZCVictorySweep` 一样：只写地块视图的临时覆盖色，**绝不回写模型** ——
 * 快照、战报、领地统计读到的始终是「已经归属」这一个事实，动画只决定底色**何时**回到战斗态。
 *
 * ## 为什么不用 `dt` 累加
 *
 * 进度一律按 `now − startedAt` 反推（`now` 来自 `ZCGameRenderWorld.visualTime`）：
 * 暂停 / 切后台 / 掉帧都不会让波前跑偏，也不需要额外的"暂停时停表"处理。
 */
export class ZCClaimWave {
    private state: ZCClaimWaveState | null = null;

    constructor(private readonly deps: ZCClaimWaveDeps) {}

    /** 当前是否正在播扩散波。 */
    get active(): boolean {
        return this.state !== null;
    }

    /**
     * 开始播扩散波：建时间表，并**立刻把所有要染的格压到「半区色」（进度 0）**。
     *
     * 压到 0 是必须的：调用方在本调用之前已经按真实归属整盘渲染过一遍，不压的话第一帧
     * 整片直接就是战斗底色 —— 波还没开始就已经结束了，看起来和没有这个动画一模一样。
     *
     * 幂等（已在播时忽略）。返回 `false` = 这一盘没有要染的格（没有主城 / 主城全是中立 /
     * 半区查不到），调用方不必等它。
     */
    start(
        map: ReadonlyArray<Readonly<{
            id: number; x: number; y: number; neighbors: readonly number[]; playable?: boolean;
        }>>,
        homes: readonly number[],
        callbacks: ZCClaimWaveCallbacks,
        startedAt: number,
    ): boolean {
        if (this.state) return true;
        const plan = buildClaimWavePlan(map, homes, callbacks);
        if (!plan.entries.size) return false;
        this.state = { plan, startedAt, written: new Map() };
        for (const [hexId, entry] of plan.entries) this.write(hexId, entry, 0);
        return true;
    }

    /**
     * 推进到 `now`。返回 **true = 还在播**。
     *
     * 播完（所有格都到 1）就自动收尾：把所有覆盖清成 `null`，让地块回到按真实归属渲染 ——
     * 覆盖期的「进度 1」色与常规渲染同值，但 `canDevelop` 那类旁路只有在常规路径里才算得对，
     * 所以收尾必须显式交还控制权，不能把覆盖一直挂着。
     */
    advance(now: number): boolean {
        const state = this.state;
        if (!state) return false;
        let pending = false;
        for (const [hexId, entry] of state.plan.entries) {
            const progress = claimWaveProgress(now, entry.startSeconds, state.startedAt);
            if (progress < 1) pending = true;
            this.write(hexId, entry, progress);
        }
        if (pending) return true;
        this.clear();
        return false;
    }

    /**
     * 中止并把所有已覆盖的格交还常规渲染。
     * 重开一局、退出对局都要调 —— 否则下一局的格子会带着上一局中途的过渡色出场。
     */
    clear(): void {
        const state = this.state;
        if (!state) return;
        this.state = null;
        for (const hexId of state.plan.entries.keys()) {
            const entityId = this.deps.hexEntityBySource.get(hexId);
            if (entityId === undefined) continue;
            this.deps.hexViews.get(entityId)?.setClaimWave(null);
        }
        state.written.clear();
    }

    /** 把某一格的进度写进视图；进度与上一拍相同（且不是首次）就整块跳过。 */
    private write(hexId: number, entry: ZCClaimWaveEntry, progress: number): void {
        const state = this.state;
        if (!state) return;
        const previous = state.written.get(hexId);
        if (previous !== undefined && previous === progress) return;
        state.written.set(hexId, progress);
        // 判 `=== undefined` 而不是 falsy：实体序号自增，"没有"是 undefined，0 只表示"当前没用这个号"。
        const entityId = this.deps.hexEntityBySource.get(hexId);
        if (entityId === undefined) return;
        this.deps.hexViews.get(entityId)?.setClaimWave({
            from: entry.fromOwner, to: entry.toOwner, progress,
        });
    }
}
