/**
 * 新手引导控制器，串起步骤机、存档和业务完成事件。
 * 只订阅完成事件、推进步骤、发奖、落盘并输出 IGuideViewState；不碰节点，也不直连业务模块。
 * completeCond 严格相等匹配；发奖抛错只上报，不回滚进度。
 */

import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { CardLineupEvent } from '../../card/CardLineupEvents';
import { GuideDebugEvent, GuideEvent } from './GuideEvents';
import type { IGuideAdvancePayload, IGuideCompletePayload } from './GuideEvents';
import type { IGuideGateway } from './GuideGateway';
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
     * 完成判定 guideStep.completeCond。View 决定能否点对话条推进时必须用它，
     * 不能用 requireAction；requireAction 只表示玩家要做一个动作，不代表点对话条算完成。
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
    readonly gateway?: IGuideGateway;
    /** 展示实例与只读状态出口；点击推进经 GuideEvent.Advance 回传。 */
    readonly view?: {
        readonly owner: object;
        readonly render: (state: IGuideViewState) => void;
    };
    /** 发奖出口。省略时只打日志。 */
    readonly grant?: (rewards: readonly GuideReward[], stepId: string) => void;
    readonly failed?: (error: unknown) => void;
    /** 时间源，默认 `Date.now`（单测注入固定值）。 */
    readonly now?: () => number;
}

export class GuideController extends ControllerBase {
    private progress: GuideProgress | null = null;
    private firstRun = false;

    constructor(context: IControllerContext, private readonly options: IGuideControllerOptions) {
        super(context, 'guide');
        if (options.gateway) this.own(() => options.gateway.dispose());
    }

    /** 当前步 id；空串 = 未启动或已结束。调试 / 埋点用。 */
    get currentStepId(): string {
        return this.progress?.current?.stepId ?? '';
    }

    get isFinished(): boolean {
        return this.progress === null || this.progress.isFinished;
    }

    /**
     * 启动：读存档、恢复步骤机、发布首个状态。返回 false 表示本次不做引导，不抛出。
     */
    start(): boolean {
        if (this.progress) return true;
        try {
            const saved = this.options.store.load();
            const progress = restoreGuideProgress(this.options.store, this.options.steps, saved);
            if (!progress) return false;
            this.progress = progress;
            this.firstRun = saved === null;

            // 订阅放在确认要跑引导之后：启动失败提前 return，不会重复挂监听。
            // 联调逃生口：GuideDebugEvent.ForceSkip 可跳过整条引导。
            this.listen(GuideDebugEvent.ForceSkip, this.onForceSkip);
            // 完成判定两路：通用通道和卡牌升级事件。
            this.listen(GuideEvent.Complete, this.onCompleteReported);
            this.listen(GuideEvent.Advance, this.onAdvance);
            this.listen(CardLineupEvent.HeroUpgraded, this.onHeroUpgraded);
            if (this.options.gateway) void this.options.gateway.load().catch(error => this.report(error));
            console.log(`[Guide] 启动 · step=${progress.current?.stepId ?? '(结束)'} · firstRun=${this.firstRun} · completed=${progress.completedSteps.length} · granted=${progress.grantedSteps.length}`);
            this.publish();
            return true;
        } catch (error) {
            this.report(error);
            return false;
        }
    }

    /**
     * 业务侧上报某件事完成。命中当前步的 completeCond 才推进，返回是否真的推进了一步。
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
        this.syncProgress(step.stepId);
        this.publish();
        return true;
    }

    /**
     * 强制跳过整条引导，忽略 skipAble，奖励照常补发并落盘。
     */
    skipAll(): boolean {
        const progress = this.progress;
        if (!progress || progress.isFinished) return false;
        try {
            const rewards = progress.skip(true);
            console.log(`[Guide] 强制跳过整条引导 · 补发 ${rewards.length} 项奖励`);
            this.grantRewards(rewards, 'force-skip');
            this.persist();
            this.syncProgress(this.options.steps[this.options.steps.length - 1].stepId);
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
            this.syncProgress(this.options.steps[this.options.steps.length - 1].stepId);
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
                this.options.view.render(state);
            } catch (error) {
                this.report(error);
            }
            return;
        }
        console.log(`[GuideController] 当前步 ${state.stepId || '(结束)'} · ${state.flowName} · ${state.maskType}`);
    }

    private readonly onForceSkip = (): void => { this.skipAll(); };

    private readonly onAdvance = (payload: IGuideAdvancePayload): void => {
        const view = this.options.view;
        if (!view || payload?.owner !== view.owner || payload.stepId !== this.currentStepId) return;
        this.notify('click');
    };

    private syncProgress(stepId: string): void {
        if (this.options.gateway) void this.options.gateway.update(stepId).catch(error => this.report(error));
    }

    /** 通用通道：业务侧 `reportGuideComplete(cond, arg?)`。 */
    private readonly onCompleteReported = (payload: IGuideCompletePayload): void => {
        if (!payload || typeof payload.cond !== 'string' || !payload.cond) return;
        this.notify(payload.cond, payload.arg);
    };

    /**
     * 卡牌升级成功转成 cardLevelUp:<heroId>，直接订阅卡牌既有事件，不改业务侧。
     */
    private readonly onHeroUpgraded = (payload: { readonly heroId?: number }): void => {
        const heroId = Number(payload?.heroId);
        if (!Number.isSafeInteger(heroId) || heroId <= 0) return;
        this.notify('cardLevelUp', heroId);
    };

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }

    private report(error: unknown): void {
        if (this.options.failed) this.options.failed(error);
        else console.warn('[GuideController]', error);
    }
}
