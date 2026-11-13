/**
 * 新手引导步骤表解析（对应 `assets/remoteRef/guideStep.json`）。
 *
 * ⚠️ 与 zcds 的 `ZCGuide*`（战斗内「指南」百科，展示建塔概率）**无关** —— 名字近，语义不同。
 *
 * 表是列存 `{k,v,c}`，运行时 `RefUtil.instance.getRefAll('guideStep')` 会解成行对象数组
 * 再交给本模块。解析只负责「单行 → 强类型」；步骤链是否闭合由 `GuideProgress` 在构造时校验
 * （单行解析没有全局视野，不该在这里判链）。
 *
 * 🔴 **保持输入顺序，不排序**：`stepId`（`'1-1'` / `'10-1'`）是字符串，按字典序排会把 `10-1`
 * 排到 `2-1` 前面。本表的执行序 = **行序**，与 `ZCGuideConfig.parseGuideEntries` 按
 * `order` 列排序的口径不同，别照抄那套。
 */

/** `nextStep` 的结束哨兵。写死字面量是为了和表里共存，不要在代码里手打 `'end'`。 */
export const GUIDE_STEP_END = 'end';

/** 步骤触发方式：首登进入，或上一步完成即触发。 */
export type GuideTriggerType = 'firstLogin' | 'prevDone';

/** 遮罩形态：全屏半透明 / 挖空高亮焦点。 */
export type GuideMaskType = 'full' | 'hole';

/** 要求的玩家操作；空串 = 该步不要求操作（纯展示）。 */
export type GuideRequireAction = 'click' | 'drag' | '';

/** 一条引导奖励（与 `openGridReward.gridRewards` / `mL` 同一套 resId 口径）。 */
export interface GuideReward {
    readonly resId: number;
    /** 数量。 */
    readonly number: number;
    /** 权重，`10000` = 100%。保留下来是为了以后接随机奖励，当前全是必得。 */
    readonly pro: number;
}

/** 一个引导步骤（`guideStep.json` 一行）。 */
export interface GuideStep {
    /** 步骤号，形如 `'1-1'`；全表唯一，是存档与埋点的稳定键。 */
    readonly stepId: string;
    /** 引导组 id；当前只有一个组（`1`），留着做多段引导扩展。 */
    readonly guideId: number;
    /** 流程名（`苏醒` / `翻第1块地`…），仅用于日志与调试。 */
    readonly flowName: string;
    readonly triggerType: GuideTriggerType;
    readonly maskType: GuideMaskType;
    /**
     * 焦点控件标识。**空串 = 该步没有焦点控件**（纯对话，或业务入口尚未接线）。
     *
     * 不要把它当节点路径直接 `cc.find` —— 宿主页层级一动就断（`MainTerritoryMap.ts:176`
     * 有同类注释）。正确做法是业务侧注册「锚点名 → Node」，引导按名取。
     */
    readonly focusNode: string;
    readonly requireAction: GuideRequireAction;
    /** 台词组 id（`D01`~`D16`），指向多语言表 key；空串 = 该步无台词。 */
    readonly dialogId: string;
    /** 完成事件名；带参用 `name:arg`（如 `cardLevelUp:68001`）。 */
    readonly completeCond: string;
    /** 该步是否允许跳过（当前只有收尾步为真）。 */
    readonly skipAble: boolean;
    /** 该步完成时发放的奖励；空数组 = 不发奖。 */
    readonly rewards: readonly GuideReward[];
    /** 下一步 `stepId`，或 {@link GUIDE_STEP_END}。 */
    readonly nextStep: string;
}

/**
 * 把 `guideStep` 的行对象数组解析成强类型步骤表。
 *
 * 容错口径：缺 `stepId` 的行**静默丢弃**（半行数据无法定位，留着只会在链校验里炸）；
 * 其余字段按类型兜底 —— 策划把 `skipAble` 写成 `'是'` 这类错误不该让引导整条挂掉。
 */
export function parseGuideSteps(rows: readonly unknown[]): GuideStep[] {
    const out: GuideStep[] = [];
    for (const row of rows) {
        const step = parseStep(row);
        if (step) out.push(step);
    }
    return out;
}

function parseStep(value: unknown): GuideStep | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (typeof raw.stepId !== 'string' || !raw.stepId) return null;
    return {
        stepId: raw.stepId,
        guideId: toCount(raw.guideId, 1),
        flowName: typeof raw.flowName === 'string' ? raw.flowName : '',
        triggerType: raw.triggerType === 'firstLogin' ? 'firstLogin' : 'prevDone',
        maskType: raw.maskType === 'hole' ? 'hole' : 'full',
        focusNode: typeof raw.focusNode === 'string' ? raw.focusNode : '',
        requireAction: toAction(raw.requireAction),
        dialogId: typeof raw.dialogId === 'string' ? raw.dialogId : '',
        completeCond: typeof raw.completeCond === 'string' ? raw.completeCond : '',
        skipAble: toCount(raw.skipAble, 0) === 1,
        // 表里列名叫 `rewardJson`（文档「导表建议」页的列头），代码里收窄成 `rewards`：
        // 它是数组不是字符串，叫 Json 会误导后来的人去做 `JSON.parse`。
        rewards: parseRewards(raw.rewardJson),
        nextStep: typeof raw.nextStep === 'string' && raw.nextStep ? raw.nextStep : GUIDE_STEP_END,
    };
}

function toAction(value: unknown): GuideRequireAction {
    return value === 'click' || value === 'drag' ? value : '';
}

function toCount(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function parseRewards(value: unknown): GuideReward[] {
    if (!Array.isArray(value)) return [];
    const out: GuideReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const resId = Number(raw.resId);
        const count = Number(raw.number);
        if (!Number.isFinite(resId) || resId <= 0) continue;
        if (!Number.isFinite(count) || count <= 0) continue;
        out.push({
            resId,
            number: count,
            pro: Number.isFinite(Number(raw.pro)) ? Number(raw.pro) : 10000,
        });
    }
    return out;
}
