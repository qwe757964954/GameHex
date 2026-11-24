/**
 * 新手引导控制器，串起步骤机、存档和业务完成事件。
 * 只订阅完成事件、推进步骤、上报进度、落盘并输出 IGuideViewState；奖励由服务端发放和推送。
 * completeCond 严格相等匹配；不碰节点，也不直连业务模块。
 */

import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { CardLineupEvent } from '../../card/CardLineupEvents';
import { GuideDebugEvent, GuideEvent } from './GuideEvents';
import type { IGuideAdvancePayload, IGuideCompletePayload } from './GuideEvents';
import type { IGuideGateway } from './GuideGateway';
import type { GuideProgress } from '../model/GuideProgress';
import type { GuideSaveStore } from '../model/GuideSaveStore';
import { restoreGuideProgress, remoteCursorToData } from '../model/GuideSaveStore';
import type { GuideSyncOutbox } from '../model/GuideSyncOutbox';
import type {
    GuideMaskType,
    GuideRequireAction,
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
    /** 上报待发队列；省略时退化为直接发送（预览 / 单测），退出即丢。 */
    readonly outbox?: GuideSyncOutbox;
    /** 已解析的步骤表（`parseGuideSteps` 的结果，行序即执行序）。 */
    readonly steps: readonly GuideStep[];
    readonly gateway?: IGuideGateway;
    /** 展示实例与只读状态出口；点击推进经 GuideEvent.Advance 回传。 */
    readonly view?: {
        readonly owner: object;
        readonly render: (state: IGuideViewState) => void;
    };
    readonly failed?: (error: unknown) => void;
    /** 时间源，默认 `Date.now`（单测注入固定值）。 */
    readonly now?: () => number;
}

export class GuideController extends ControllerBase {
    private progress: GuideProgress | null = null;
    private firstRun = false;
    /** 补发循环在途标记；避免并发 drain 打乱顺序。 */
    private flushing = false;
    /** 在途期间又有新推进；本轮结束后再扫一遍队列，避免最后一项要等下次启动。 */
    private flushQueued = false;

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
            if (this.options.gateway) {
                // 本地存档先出首帧；查询回来只做「远端更靠后」的校正，再补发积压的待发项。
                void this.options.gateway.load()
                    .then(cursor => this.adoptRemoteCursor(cursor))
                    .catch(error => this.report(error))
                    .then(() => this.flushOutbox());
            }
            console.log(`[Guide] 启动 · step=${progress.current?.stepId ?? '(结束)'} · firstRun=${this.firstRun} · completed=${progress.completedSteps.length}`);
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

        console.log(`[Guide] 完成 ${step.stepId}(${step.flowName}) → ${result.next?.stepId ?? '(结束)'}`);
        this.persist();
        this.syncProgress(step.stepId);
        this.publish();
        return true;
    }

    /**
     * 强制跳过整条引导，忽略 skipAble，上报进度并落盘。
     */
    skipAll(): boolean {
        const progress = this.progress;
        if (!progress || progress.isFinished) return false;
        try {
            progress.skip(true);
            console.log('[Guide] 强制跳过整条引导');
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
            progress.skip();
            console.log('[Guide] 跳过剩余步骤');
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

    private readonly onAdvance = (payload: IGuideAdvancePayload, source: object): void => {
        const view = this.options.view;
        if (!view || source !== view.owner || payload.stepId !== this.currentStepId) return;
        this.notify('click');
    };

    /**
     * 远端校正：只有远端更靠后才采用。重建步骤机而不是就地改游标，
     * 保证状态全部来自合并后的存档（本地 completed / skipped 仍是并集来源）。
     */
    private adoptRemoteCursor(cursor: CmdFunctionGuideInfo | null): void {
        if (this.isDisposed) return;
        if (!cursor) {
            // 服务端还没有游标（0/0 或本次没查到）：把本地已完成的最后一步补推上去，
            // 否则老玩家换设备后本地为空，会被判成新玩家从头再走一遍。
            this.pushLocalProgress();
            return;
        }
        try {
            const steps = this.options.steps;
            const remote = remoteCursorToData(cursor, steps);
            if (remote && this.options.store.applyRemoteCursor(cursor, steps, this.now())) {
                const progress = restoreGuideProgress(this.options.store, steps);
                if (!progress) return;
                this.progress = progress;
                // 远端已有进度 ⇒ 不是首次进入，避免把老账号重新判成新玩家。
                this.firstRun = false;
                // 只裁掉远端已确认的完成步：progress 的完成集是本地/远端并集，
                // 非前缀存档下可能含尚未上报成功的本地项，不能拿它整份 prune。
                this.options.outbox?.prune(remote.completedSteps);
                console.log(`[Guide] 远端校正 · step=${progress.current?.stepId ?? '(结束)'}`);
                this.publish();
                return;
            }
            // 远端落后于本地（本地走过更多）：把最后完成步补推。
            // 待发队列若因旧版本 / 清缓存丢失，这一步能让服务端重新追上，否则会永久卡在旧游标。
            const localCompleted = this.progress?.completedSteps.length ?? 0;
            if (remote && localCompleted > remote.completedSteps.length) {
                this.pushLocalProgress();
            }
        } catch (error) {
            this.report(error);
        }
    }

    /**
     * 迁移：把本地进度补推给服务端。游标按「最后已完成步」解释，
     * 推最后一步就等价于推整条已完成前缀，不必逐步重放。
     * 用当前步骤机过滤后的完成集，避免把旧表已删除的 stepId 推给服务端。
     */
    private pushLocalProgress(): void {
        const progress = this.progress;
        if (!progress) return;
        const completed = new Set(progress.completedSteps);
        // 合并存档的完成集顺序不保证是链序，必须按 steps 行序取最靠后的一项。
        let lastCompleted = '';
        for (const step of this.options.steps) {
            if (completed.has(step.stepId)) lastCompleted = step.stepId;
        }
        if (!lastCompleted) return;
        const outbox = this.options.outbox;
        if (!outbox) {
            // 预览 / 单测没有持久化队列，和 syncProgress 一样退化为直接发送。
            const gateway = this.options.gateway;
            if (gateway) void gateway.update(lastCompleted).catch(error => this.report(error));
            return;
        }
        outbox.push(lastCompleted, this.now());
    }

    private syncProgress(stepId: string): void {
        const gateway = this.options.gateway;
        if (!gateway) return;
        // 上报是推进之后的副作用；失败只报告，不能把已经完成的本地状态和展示一起中断。
        try {
            const outbox = this.options.outbox;
            if (!outbox) {
                // 预览 / 单测没有持久化队列，退回直接发送；退出即丢，不用于正式链路。
                void gateway.update(stepId).catch(error => this.report(error));
                return;
            }
            outbox.push(stepId, this.now());
            this.flushOutbox();
        } catch (error) {
            this.report(error);
        }
    }

    /** 串行补发待发项；退出后队列留在存储里，下次会话继续。 */
    private flushOutbox(): void {
        const gateway = this.options.gateway;
        const outbox = this.options.outbox;
        if (!gateway || !outbox) return;
        if (this.flushing) {
            // 本轮结束后再扫一遍；否则在途期间的新推进要等下一次外部推进或下次启动。
            this.flushQueued = true;
            return;
        }
        this.flushing = true;
        this.flushQueued = false;
        void this.drainOutbox(gateway, outbox)
            .catch(error => this.report(error))
            .finally(() => {
                this.flushing = false;
                if (!this.flushQueued) return;
                this.flushQueued = false;
                this.flushOutbox();
            });
    }

    private async drainOutbox(gateway: IGuideGateway, outbox: GuideSyncOutbox): Promise<void> {
        while (!this.isDisposed) {
            const head = outbox.head();
            if (!head) return;
            const result = await gateway.update(head.stepId);
            // await 回来宿主可能已释放：队列不丢，下次启动再发。
            if (this.isDisposed) return;
            if (result === 'retry') return;
            if (result === 'invalid') console.warn(`[Guide] 待发项无法上报，已丢弃 · step=${head.stepId}`);
            outbox.ack(head.stepId);
        }
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
