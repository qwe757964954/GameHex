/**
 * 新手引导的步骤机（纯 TS，不 import `cc`，可直接在 node 单测里跑）。
 *
 * ## 它管什么
 *
 * 1. **定位当前步** —— 存档恢复后能接着跑，不重放已完成的步骤；
 * 2. **推进** —— 只接受「当前步」完成，乱序 / 重复 / 已跳过的回调一律返回 `null`；
 * 3. **跳过** —— 从当前步起把剩余步骤一次性标记完成，并交出全部未发奖励（文档要求「跳过也补发」）；
 * 4. **发奖台账** —— `granted` 记录哪些步的奖励已经交出去，保证同一进程内不重复发。
 *
 * ## 它不管什么（边界，别越界用）
 *
 * - ❌ **不是权威发奖**：`granted` 是本地台账，换设备 / 清存档就没了。跨端幂等要靠服务端按
 *   `stepId` 去重，或者在登录时用服务端的引导进度覆盖本地。
 * - ❌ **不读表、不加载资源**：表由 `GuideStepConfig.parseGuideSteps` 解析后传进来；
 *   资源归属由 application 层的 Loader 负责。
 * - ❌ **不派发事件**：完成/跳过的表现由 Controller 订阅后自己做。
 * - ❌ **不做重试**：`complete()` 交出去的奖励清单必须由调用方落地；发失败要自己重试到成功。
 *   本类不会因为「没发出去」而回退步骤 —— 引导奖励是必得项，宁可补发也不要把玩家卡回上一步。
 *
 * ## 与文档的口径差异
 *
 * 设计案正文写「流程 1~5 强制、流程 6 可跳过」，但导表页只把 `skipAble=1` 标在 `8-1` 收尾步。
 * 本类按**表**判（`canSkip` 读当前步的 `skipAble`），不按正文。表改了就生效，不用动代码。
 */

import { GUIDE_STEP_END } from './GuideStepConfig';
import type { GuideReward, GuideStep } from './GuideStepConfig';

/** 可持久化的引导进度快照。存 `stepId` 字符串而不是下标 —— 表插行/删行不会让存档错位。 */
export interface GuideProgressData {
    /** 当前未完成的步；空串 = 引导已结束。 */
    readonly currentStepId: string;
    readonly completedSteps: readonly string[];
    readonly grantedSteps: readonly string[];
    /** 是否由「跳过」结束。 */
    readonly skipped: boolean;
}

/** `complete()` 的结果：下一步是谁、这次该发什么。 */
export interface GuideCompletion {
    readonly step: GuideStep;
    /** 下一步；`null` = 整条引导完成。 */
    readonly next: GuideStep | null;
    /** 本次应发的奖励（已按 `granted` 过滤），调用方负责落地。 */
    readonly rewards: readonly GuideReward[];
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
     * @param steps 已解析、且**按行序**排好的步骤表（不要在这里再排序）。
     * @param saved 上次存档；传入即恢复进度。
     *
     * @throws 表为空、缺 `firstLogin` 入口、`nextStep` 指向不存在的步、链上有环 —— 这些都抛。
     *   调用方（Loader / Controller）**必须** `try/catch` 并降级成「本次不引导」：
     *   配置错误可以少一段新手引导，但不能阻塞主界面进入。
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

    /** 已完成的步（含被跳过时一次性标记的）。 */
    get completedSteps(): readonly string[] {
        return [...this.completed];
    }

    /** 已发过奖的步。用于「重进游戏时补发漏掉的奖励」这类外部补偿逻辑。 */
    get grantedSteps(): readonly string[] {
        return [...this.granted];
    }

    /**
     * 完成当前步：推进 + 记账，返回本次该发的奖励。
     *
     * **幂等**：同一 `stepId` 重复调用（或传入非当前步）一律返回 `null`，不会重复发奖。
     * 奖励清单里的 `pro` 是权重，当前全表 `10000`（必得）；调用方若要接随机，按 `pro` 自己掷。
     */
    complete(stepId: string): GuideCompletion | null {
        const step = this.byId.get(stepId);
        if (!step) return null;
        if (this.cursor !== stepId) return null;
        if (this.completed.has(stepId)) return null;

        const rewards = this.ungrantedRewards(step);
        this.completed.add(stepId);
        // 只记「真的发过奖」的步：零奖励步也写 granted 会让存档出现 `grantedSteps: ['1-1']`
        // 这种误导现场（看日志的人会以为发过东西）。防重复完成靠 cursor，不靠这里。
        if (step.rewards.length > 0) this.granted.add(stepId);

        const next = step.nextStep === GUIDE_STEP_END ? null : this.byId.get(step.nextStep) ?? null;
        this.cursor = next ? next.stepId : null;
        return { step, next, rewards };
    }

    /**
     * 从当前步起跳过整条引导：剩余步骤全部标记完成，交出全部未发奖励。
     *
     * @param force `true` = 忽略当前步的 `skipAble`（调试逃生口 / 运营强推）。
     *   正常用户路径不要传 —— 表里 1~5 是强制流程。
     *   跳过后 `current` 为 `null`、`wasSkipped` 为真。
     */
    skip(force = false): readonly GuideReward[] {
        if (!force && !this.canSkip) return [];

        const rewards: GuideReward[] = [];
        let cursor = this.cursor;
        // 上限保护：链已在构造时校验过无环，这里只是防御非法状态下的死循环。
        for (let guard = 0; cursor && guard <= this.steps.length; guard += 1) {
            const step = this.byId.get(cursor);
            if (!step) break;
            if (!this.completed.has(cursor)) {
                rewards.push(...this.ungrantedRewards(step));
                this.completed.add(cursor);
                if (step.rewards.length > 0) this.granted.add(cursor);
            }
            cursor = step.nextStep === GUIDE_STEP_END ? null : step.nextStep;
        }

        this.cursor = null;
        this.skippedFlag = true;
        return rewards;
    }

    /** 导出存档。`currentStepId` 用空串表示已结束（JSON 友好，不用 `null`）。 */
    toSave(): GuideProgressData {
        return {
            currentStepId: this.cursor ?? '',
            completedSteps: [...this.completed],
            grantedSteps: [...this.granted],
            skipped: this.skippedFlag,
        };
    }

    /** 该步尚未发放的奖励；已发过返回空数组。补偿逻辑用它做只读判断。 */
    pendingRewards(stepId: string): readonly GuideReward[] {
        const step = this.byId.get(stepId);
        if (!step) return [];
        return this.ungrantedRewards(step);
    }

    private ungrantedRewards(step: GuideStep): GuideReward[] {
        if (this.granted.has(step.stepId)) return [];
        return step.rewards.map((reward) => ({ ...reward }));
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
     * 链校验：从唯一 `firstLogin` 入口顺 `nextStep` 走到底，必须覆盖全表且无环。
     *
     * 不覆盖全表 = 有步永远走不到（多半是 `nextStep` 写错）；有环 = 玩家会卡在同一步。
     * 这两种都在构造期抛，而不是等玩家踩到。
     */
    private assertChainCloses(): void {
        const entries = this.steps.filter((step) => step.triggerType === 'firstLogin');
        if (entries.length !== 1) {
            throw new Error(`guideStep 表需要且只能有 1 个 firstLogin 入口，实际 ${entries.length} 个`);
        }

        const visited = new Set<string>();
        let cursor: string | null = entries[0].stepId;
        while (cursor && cursor !== GUIDE_STEP_END) {
            const step: GuideStep | undefined = this.byId.get(cursor);
            if (!step) throw new Error(`guideStep.nextStep 指向不存在的步骤：${cursor}`);
            if (visited.has(cursor)) throw new Error(`guideStep 链上有环：${cursor}`);
            visited.add(cursor);
            cursor = step.nextStep;
        }

        if (visited.size !== this.steps.length) {
            const unreachable = this.steps
                .filter((step) => !visited.has(step.stepId))
                .map((step) => step.stepId);
            throw new Error(`guideStep 有步骤不在链上（永远走不到）：${unreachable.join(' / ')}`);
        }
    }
}
