/**
 * 新手引导步骤机，纯 TS，不 import cc。
 * 负责定位当前步、推进和跳过；奖励发放、幂等与到账由服务端处理。
 * 本类不读表、不加载资源、不派发事件。
 */

import { GUIDE_STEP_END } from './GuideStepConfig';
import type { GuideStep } from './GuideStepConfig';

/** 可持久化的引导进度快照。存 `stepId` 字符串而不是下标 —— 表插行/删行不会让存档错位。 */
export interface GuideProgressData {
    /** 当前未完成的步；空串 = 引导已结束。 */
    readonly currentStepId: string;
    readonly completedSteps: readonly string[];
    /** 仅兼容旧存档，不再新增，不代表服务端已发奖。 */
    readonly grantedSteps: readonly string[];
    /** 是否由「跳过」结束。 */
    readonly skipped: boolean;
}

/** `complete()` 的结果：完成了哪一步、下一个未完成步是谁。 */
export interface GuideCompletion {
    readonly step: GuideStep;
    /** 下一个未完成步；`null` = 整条引导完成。 */
    readonly next: GuideStep | null;
}

export class GuideProgress {
    private readonly steps: readonly GuideStep[];
    private readonly byId: Map<string, GuideStep>;
    private readonly completed = new Set<string>();
    private readonly granted = new Set<string>();
    /** 当前步；`null` = 已结束（正常完成或跳过）。 */
    private cursor: string | null = null;
    private skippedFlag = false;

    /**
     * @param steps 已解析且按行序排好的步骤表，不要在这里再排序。
     * @param saved 上次存档，传入即恢复进度。
     * @throws 表为空、缺 firstLogin 入口、nextStep 指向不存在的步、链上有环。
     *   调用方必须 try/catch 并降级成本次不引导。
     */
    constructor(steps: readonly GuideStep[], saved?: GuideProgressData) {
        if (steps.length === 0) throw new Error('guideStep 表为空，无法启动引导');

        this.steps = steps;
        this.byId = new Map(steps.map((step) => [step.stepId, step]));
        this.assertChainCloses();

        if (saved) this.restore(saved);
        else this.cursor = this.firstIncompleteStepId();
    }

    /** 当前步；`null` = 引导已结束（完成或跳过）。 */
    get current(): GuideStep | null {
        return this.cursor ? this.byId.get(this.cursor) ?? null : null;
    }

    /** 是否已经结束（走到 `end` 或跳过了）。 */
    get isFinished(): boolean {
        return this.cursor === null;
    }

    /** 是否由跳过结束（表现层据此决定要不要给「跳过后续奖励」的提示）。 */
    get wasSkipped(): boolean {
        return this.skippedFlag;
    }

    /** 当前步是否允许跳过 —— 读表里的 `skipAble`，当前只有收尾步为真。 */
    get canSkip(): boolean {
        const step = this.current;
        return step !== null && step.skipAble && !this.skippedFlag;
    }

    /** 已完成的步（含跳过时一次性标记的）。 */
    get completedSteps(): readonly string[] {
        return Array.from(this.completed);
    }

    /** 旧版奖励标记，只用于存档兼容，不作为到账或补发依据。 */
    get grantedSteps(): readonly string[] {
        return Array.from(this.granted);
    }

    /**
     * 完成当前步并推进。重复或非当前步返回 null。
     */
    complete(stepId: string): GuideCompletion | null {
        const step = this.byId.get(stepId);
        if (!step) return null;
        if (this.cursor !== stepId) return null;
        if (this.completed.has(stepId)) return null;

        this.completed.add(stepId);

        const next = step.nextStep === GUIDE_STEP_END ? null : this.byId.get(step.nextStep) ?? null;
        this.cursor = next ? next.stepId : null;
        // 配置热更可能在链中插入新步，旧档却已完成了它后面的步；
        // 完成插入步后必须越过这些已完成后继，否则会停在已完成步上再也推不动。
        this.advanceOverCompleted();
        return { step, next: this.current };
    }

    /** 跳过当前游标后连续已完成的步，只停在第一个未完成步或结束。 */
    private advanceOverCompleted(): void {
        while (this.cursor) {
            const step = this.byId.get(this.cursor);
            if (!step) {
                this.cursor = null;
                return;
            }
            if (!this.completed.has(this.cursor)) return;
            this.cursor = step.nextStep === GUIDE_STEP_END ? null : step.nextStep;
        }
    }

    /**
     * 从当前步起跳过整条引导，剩余步骤全部标记完成。
     * force 为 true 时忽略当前步 skipAble，仅用于调试或运营强推。
     */
    skip(force = false): void {
        if (!force && !this.canSkip) return;
        let cursor = this.cursor;
        // 构造期已校验链表无环，这里按链走即可。
        while (cursor) {
            const step = this.byId.get(cursor);
            if (!step) break;
            if (!this.completed.has(cursor)) {
                this.completed.add(cursor);
            }
            cursor = step.nextStep === GUIDE_STEP_END ? null : step.nextStep;
        }

        this.cursor = null;
        this.skippedFlag = true;
    }

    /** 导出存档。`currentStepId` 用空串表示已结束（JSON 友好，不用 `null`）。 */
    toSave(): GuideProgressData {
        return {
            currentStepId: this.cursor ?? '',
            completedSteps: Array.from(this.completed),
            grantedSteps: Array.from(this.granted),
            skipped: this.skippedFlag,
        };
    }

    private restore(saved: GuideProgressData): void {
        for (const id of saved.completedSteps ?? []) {
            if (this.byId.has(id)) this.completed.add(id);
        }
        for (const id of saved.grantedSteps ?? []) {
            if (this.byId.has(id)) this.granted.add(id);
        }
        this.skippedFlag = saved.skipped === true;

        const savedId = saved.currentStepId;
        // 存档里的步可能已被删表（策划改结构）⇒ 不卡死，从下一个未完成的步继续。
        this.cursor = savedId && this.byId.has(savedId) && !this.completed.has(savedId)
            ? savedId
            : this.firstIncompleteStepId();
    }

    private firstIncompleteStepId(): string | null {
        for (const step of this.steps) {
            if (!this.completed.has(step.stepId)) return step.stepId;
        }
        return null;
    }

    /**
     * 链校验：从唯一 firstLogin 入口顺 nextStep 走到底，必须覆盖全表且无环。
     * 不覆盖全表说明有步永远走不到，有环说明玩家会卡住，都在构造期抛出。
     * 行序还必须与链序一致：`firstIncompleteStepId` 与 `remoteCursorToData`
     * 都把「行前缀」当成「已完成前缀」，两者错位会跳过中间步或把未完成步当成已完成。
     */
    private assertChainCloses(): void {
        const entries = this.steps.filter((step) => step.triggerType === 'firstLogin');
        if (entries.length !== 1) {
            throw new Error(`guideStep 表需要且只能有 1 个 firstLogin 入口，实际 ${entries.length} 个`);
        }

        const visited = new Set<string>();
        const chain: string[] = [];
        let cursor: string | null = entries[0].stepId;
        while (cursor && cursor !== GUIDE_STEP_END) {
            const step: GuideStep | undefined = this.byId.get(cursor);
            if (!step) throw new Error(`guideStep.nextStep 指向不存在的步骤：${cursor}`);
            if (visited.has(cursor)) throw new Error(`guideStep 链上有环：${cursor}`);
            visited.add(cursor);
            chain.push(cursor);
            cursor = step.nextStep;
        }

        if (visited.size !== this.steps.length) {
            const unreachable = this.steps
                .filter((step) => !visited.has(step.stepId))
                .map((step) => step.stepId);
            throw new Error(`guideStep 有步骤不在链上（永远走不到）：${unreachable.join(' / ')}`);
        }

        for (let i = 0; i < this.steps.length; i += 1) {
            if (this.steps[i].stepId !== chain[i]) {
                throw new Error(
                    `guideStep 行序与 nextStep 链不一致：第 ${i + 1} 行是 ${this.steps[i].stepId}，链上应为 ${chain[i] ?? '(无)'}`,
                );
            }
        }
    }
}
