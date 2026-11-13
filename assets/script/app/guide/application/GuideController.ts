/**
 * 新手引导控制器：把「步骤机 + 存档 + 业务完成事件」串起来。
 *
 * ## 职责边界（对齐 MVC 规范）
 *
 * - ✅ 订阅完成事件、推进步骤机、发奖、落盘、输出 `IGuideViewState`
 * - ❌ 不碰节点 / 不建遮罩 / 不做高亮 —— 那是 View 的事，Controller 只交状态
 * - ❌ 不直连业务模块（territory / card）—— 业务侧调 {@link GuideController.notify}，
 *      或者由组合层把业务事件转成 `notify` 调用。这样引导内核不认识任何业务类型，可单测。
 *
 * ## 完成事件的匹配口径
 *
 * 表里的 `completeCond` 是字符串，带参用 `name:arg`：
 *
 * ```
 * notify('tileFlipped')            → 匹配 'tileFlipped'
 * notify('cardLevelUp', 68001)     → 匹配 'cardLevelUp:68001'
 * ```
 *
 * **严格相等**才推进 —— 不做前缀匹配，避免 `cardLevelUp` 误推 `cardLevelUp:68001` 这种带参步。
 *
 * ## 发奖失败怎么办
 *
 * `complete()` 记账在前、`grant()` 在后。`grant` 抛错只上报（`failed`），**不回滚进度**：
 * 引导奖励是必得项，宁可让服务端按 `stepId` 幂等补发，也不要把玩家卡回上一步。
 */

import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { CardLineupEvent } from '../../card/CardLineupEvents';
import { GuideEvent } from './GuideEvents';
import type { IGuideCompletePayload } from './GuideEvents';
import type { GuideProgress } from '../model/GuideProgress';
import type { GuideSaveStore } from '../model/GuideSaveStore';
import { restoreGuideProgress } from '../model/GuideSaveStore';
import type {
    GuideMaskType,
    GuideRequireAction,
    GuideReward,
    GuideStep,
} from '../model/GuideStepConfig';

/** 交给 View 的只读状态。View 按它建遮罩 / 定位焦点 / 播台词，不反向问 Controller。 */
export interface IGuideViewState {
    /** 当前步 id；空串 = 引导已结束。 */
    readonly stepId: string;
    readonly flowName: string;
    readonly maskType: GuideMaskType;
    /** 焦点锚点名；空串 = 本步无焦点。业务侧按名解析 Node，不要当路径 `cc.find`。 */
    readonly focusNode: string;
    readonly dialogId: string;
    readonly requireAction: GuideRequireAction;
    /**
     * 完成判定（`guideStep.completeCond`）。
     *
     * View 必须用它决定「点对话条能不能推进这一步」，**不能用 `requireAction`**：
     * `requireAction='click'` 只说明"玩家要做一个点击动作"（可能是点地块、点收下），
     * 不代表"点对话条就算完成"。两者混用会让 `2-1`（completeCond=tileFlipped）
     * 被对话条点击误推进、`2-2`（popupClosed）永远推不动。
     */
    readonly completeCond: string;
    /** 本次是否首次进入（`firstLogin` 触发判据）。 */
    readonly isFirstRun: boolean;
    /** 是否已结束（走完或被跳过）。 */
    readonly finished: boolean;
    /** 是否是「跳过」结束的。 */
    readonly skipped: boolean;
}

export interface IGuideControllerOptions {
    readonly store: GuideSaveStore;
    /** 已解析的步骤表（`parseGuideSteps` 的结果，行序即执行序）。 */
    readonly steps: readonly GuideStep[];
    /**
     * 状态出口。
     *
     * `advance` 是给 View 的「台词播完、再点一次」回调 —— View 拿到它就等于拿到
     * 「以 click 完成本步」的许可；不传则点击不推进（翻地 / 升级这类步走业务事件）。
     */
    readonly view?: {
        readonly render: (state: IGuideViewState, advance: () => void) => void;
    };
    /** 发奖出口。省略时只打日志。 */
    readonly grant?: (rewards: readonly GuideReward[], stepId: string) => void;
    readonly failed?: (error: unknown) => void;
    /** 时间源，默认 `Date.now`（单测注入固定值）。 */
    readonly now?: () => number;
}

/** 调试 / 运营用的引导事件名（不进正式玩家路径）。 */
export const GuideDebugEvent = {
    /** 强制跳过整条引导。 */
    ForceSkip: 'guide:debug-force-skip',
} as const;

export class GuideController extends ControllerBase {
    private progress: GuideProgress | null = null;
    private firstRun = false;
    /** 给 View 的点击推进回调；绑定一次，避免每次 publish 造新闭包。 */
    private readonly onViewAdvance = (): void => { this.notify('click'); };

    constructor(context: IControllerContext, private readonly options: IGuideControllerOptions) {
        super(context, 'guide');
    }

    /** 当前步 id；空串 = 未启动或已结束。调试 / 埋点用。 */
    get currentStepId(): string {
        return this.progress?.current?.stepId ?? '';
    }

    get isFinished(): boolean {
        return this.progress === null || this.progress.isFinished;
    }

    /**
     * 启动：读存档 → 恢复步骤机 → 发布首个状态。
     *
     * @returns `false` = 配置不可用（空表 / 断链）或本步已无内容，本次不做引导。
     *   **不抛** —— 引导配置坏了不该让主界面进不去。
     */
    start(): boolean {
        if (this.progress) return true;
        // 联调逃生口：任意位置点 `GuideDebugEvent.ForceSkip` 就能跳过整条引导。
        this.listen(GuideDebugEvent.ForceSkip, this.onForceSkip);

        // 「完成判定」两个来源：
        //  ① 通用通道 `GuideEvent.Complete`（业务侧调 `reportGuideComplete`）；
        //  ② 已有的强事件（卡牌升级成功），直接订阅，业务侧零改动。
        this.listen(GuideEvent.Complete, this.onCompleteReported);
        this.listen(CardLineupEvent.HeroUpgraded, this.onHeroUpgraded);
        try {
            const saved = this.options.store.load();
            const progress = restoreGuideProgress(this.options.store, this.options.steps, saved);
            if (!progress) return false;
            this.progress = progress;
            this.firstRun = saved === null;
            // 引导只有十几步，低频日志；这条是"链路真的起来了"的唯一证据 ——
            // 没有它，真机上「没启动」和「启动了但 View 没显示」完全无法区分。
            console.log(`[Guide] 启动 · step=${progress.current?.stepId ?? '(结束)'} · firstRun=${this.firstRun} · completed=${progress.completedSteps.length} · granted=${progress.grantedSteps.length}`);
            this.publish();
            return true;
        } catch (error) {
            this.report(error);
            return false;
        }
    }

    /**
     * 业务侧上报「某件事完成了」。命中当前步的 `completeCond` 才推进。
     *
     * @param cond 事件名，如 `'tileFlipped'` / `'cardLevelUp'`
     * @param arg 可选的参数，拼成 `name:arg` 参与匹配
     * @returns 是否真的推进了一步
     */
    notify(cond: string, arg?: string | number): boolean {
        const progress = this.progress;
        if (!progress) return false;
        const step = progress.current;
        if (!step) return false;

        const key = arg === undefined ? cond : `${cond}:${arg}`;
        if (step.completeCond !== key) return false;

        const result = progress.complete(step.stepId);
        if (!result) return false;

        console.log(`[Guide] 完成 ${step.stepId}(${step.flowName}) → ${result.next?.stepId ?? '(结束)'} · 奖励 ${result.rewards.length} 项`);
        this.grantRewards(result.rewards, step.stepId);
        this.persist();
        this.publish();
        return true;
    }

    /**
     * 强制跳过整条引导（忽略 `skipAble`）。
     *
     * 两个用途：① 联调逃生口（`GuideDebugEvent.ForceSkip` 触发）；② 运营强推走完。
     * 奖励照常补发，进度落盘为「已跳过」，不会在下次进主界面又冒出来。
     */
    skipAll(): boolean {
        const progress = this.progress;
        if (!progress || progress.isFinished) return false;
        try {
            const rewards = progress.skip(true);
            console.log(`[Guide] 强制跳过整条引导 · 补发 ${rewards.length} 项奖励`);
            this.grantRewards(rewards, 'force-skip');
            this.persist();
            this.publish();
            return true;
        } catch (error) {
            this.report(error);
            return false;
        }
    }

    /** 请求跳过当前步及之后全部。不可跳（`skipAble=0`）时返回 `false`。 */
    skip(): boolean {
        const progress = this.progress;
        if (!progress || !progress.canSkip) return false;
        try {
            const rewards = progress.skip();
            console.log(`[Guide] 跳过剩余步骤 · 补发 ${rewards.length} 项奖励`);
            this.grantRewards(rewards, 'skip');
            this.persist();
            this.publish();
            return true;
        } catch (error) {
            this.report(error);
            return false;
        }
    }

    /** 主动落盘（例如切后台前）。正常情况下 `notify` / `skip` 已自动写过。 */
    persist(): void {
        if (!this.progress) return;
        try {
            this.options.store.save(this.progress.toSave(), this.now());
        } catch (error) {
            console.error(`[Guide] 存档写入失败 · step=${this.progress.current?.stepId ?? '(结束)'}`, error);
            this.report(error);
        }
    }

    private grantRewards(rewards: readonly GuideReward[], stepId: string): void {
        if (rewards.length === 0) return;
        try {
            if (this.options.grant) this.options.grant(rewards, stepId);
            else console.log(`[GuideController] 步骤 ${stepId} 应发奖励`, rewards);
        } catch (error) {
            // 记账已在前一步完成；发奖失败不回流进度，靠服务端按 stepId 幂等补发。
            this.report(error);
        }
    }

    private publish(): void {
        const progress = this.progress;
        const step = progress?.current ?? null;
        const state: IGuideViewState = step
            ? {
                stepId: step.stepId,
                flowName: step.flowName,
                maskType: step.maskType,
                focusNode: step.focusNode,
                dialogId: step.dialogId,
                requireAction: step.requireAction,
                completeCond: step.completeCond,
                isFirstRun: this.firstRun,
                finished: false,
                skipped: false,
            }
            : {
                stepId: '',
                flowName: '',
                maskType: 'full',
                focusNode: '',
                dialogId: '',
                requireAction: '',
                completeCond: '',
                isFirstRun: this.firstRun,
                finished: true,
                skipped: progress?.wasSkipped ?? false,
            };

        if (this.options.view) {
            try {
                // 点击推进只对 click 步有效；`notify` 内部还会校验「是不是当前步」，
                // 所以 View 拿着过期状态晚一步回调也是安全的。
                this.options.view.render(state, this.onViewAdvance);
            } catch (error) {
                this.report(error);
            }
            return;
        }
        console.log(`[GuideController] 当前步 ${state.stepId || '(结束)'} · ${state.flowName} · ${state.maskType}`);
    }

    private readonly onForceSkip = (): void => { this.skipAll(); };

    /** 通用通道：业务侧 `reportGuideComplete(cond, arg?)`。 */
    private readonly onCompleteReported = (payload: IGuideCompletePayload): void => {
        if (!payload || typeof payload.cond !== 'string' || !payload.cond) return;
        this.notify(payload.cond, payload.arg);
    };

    /**
     * 卡牌升级成功 → `cardLevelUp:<heroId>`。
     *
     * 直接订阅卡牌侧的既有事件，**不做业务侧改动**。注意设计案的 6-3 写的是
     * 「升级动画播完」，这里用的是「服务端确认升级成功」—— 早于动画结束，
     * 玩家能更早看到下一句；若要求严格等动画，需要在 `CardUpgradePage` 的动画结束回调里
     * 改成 `reportGuideComplete('cardLevelUp', heroId)`。
     */
    private readonly onHeroUpgraded = (payload: { readonly heroId?: number }): void => {
        const heroId = Number(payload?.heroId);
        if (!Number.isSafeInteger(heroId) || heroId <= 0) return;
        this.notify('cardLevelUp', heroId);
    };

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }

    private report(error: unknown): void {
        if (this.options.failed) this.options.failed(error);
        else console.warn('[GuideController]', error);
    }
}
