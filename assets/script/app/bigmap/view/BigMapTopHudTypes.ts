import { formatBigMapResourceAmount } from '../../../core/math/CompactNumber';
import type { BigMapResType } from '../model/BigMapTypes';

/**
 * 顶部资源格的唯一顺序：粮 / 木 / 铁 / 金币 / 行动力。
 *
 * 世界与基地共用同一份顺序，图标、数值、反馈都按这个下标绑定；
 * 不再维护「世界 5 格 / 基地 4 格」两套数组，避免金币在基地静默缺失。
 */
export const BIGMAP_TOP_RES_TYPES = ['grain', 'wood', 'iron', 'coin', 'stamina'] as const;

/**
 * 顶栏占用的设计高度（px，720 设计宽）。
 *
 * 玩家卡顶边 160、资源第三行底边 327（720×1280 屏高），再留 13px 呼吸位。
 * `BigMapPage.worldAreaRect` 用它给地图留顶边，避免卡片压住可点格子。
 */
export const BIGMAP_TOP_HUD_HEIGHT = 340;

/** 顶栏只读资源行；Model 的完整资源视图可直接结构赋值。 */
export interface IBigMapTopResourceSource {
    readonly type: BigMapResType;
    readonly amount: number;
    readonly cap: number;
    readonly amountKnown?: boolean;
}

/** 单个资源格：原始数据 + 已格式化文本。反馈类需要原始数据判断增减。 */
export interface IBigMapTopResourceSlot {
    readonly type: BigMapResType;
    readonly text: string;
    readonly source: IBigMapTopResourceSource;
}

export interface IBigMapTopQueueSource {
    readonly busy: boolean;
    readonly locked: boolean;
}

export interface IBigMapTopHudView {
    readonly slots: readonly IBigMapTopResourceSlot[];
    readonly buildQueueText: string;
    readonly researchQueueText: string;
}

/** 资源整数 → 顶栏紧凑文本（≥1000 用一位小数 K），常态与滚动反馈共用。 */
export { formatBigMapResourceAmount } from '../../../core/math/CompactNumber';

/**
 * 单格常态文本。
 *
 * - 余额未知：行动力有恢复倒计时就显示 `12s`，其余 `—`；
 * - 已知：走 K 格式化；行动力再拼 `/上限`（背包态 cap=NaN 时不拼）。
 */
export function formatBigMapTopResourceText(view: IBigMapTopResourceSource, actionRecoverSeconds: number | null): string {
    if (view.amountKnown === false) {
        return view.type === 'stamina' && actionRecoverSeconds !== null && actionRecoverSeconds > 0
            ? `${actionRecoverSeconds}s` : '—';
    }
    const cap = view.type === 'stamina' && Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
    return formatBigMapResourceAmount(view.amount) + cap;
}

/** 建造队列摘要：基地顶栏的队列卡与底部建造面板共用同一口径。 */
export function buildBigMapQueueText(queues: readonly IBigMapTopQueueSource[]): string {
    let busy = 0;
    let unlocked = 0;
    for (const queue of queues) {
        if (queue.busy) busy += 1;
        if (!queue.locked) unlocked += 1;
    }
    return `${busy}/${unlocked}`;
}

/**
 * 一次产出顶栏全量视图：5 个资源格 + 队列摘要。
 *
 * 纯函数，不碰节点；`resources` 缺项 / 为空时对应格显示 `—`，不抛。
 */
export function buildBigMapTopHudView(
    resources: readonly IBigMapTopResourceSource[],
    queues: readonly IBigMapTopQueueSource[],
    actionRecoverSeconds: number | null,
): IBigMapTopHudView {
    const slots: IBigMapTopResourceSlot[] = [];
    for (const type of BIGMAP_TOP_RES_TYPES) {
        let source: IBigMapTopResourceSource | null = null;
        for (let index = 0; index < resources.length; index += 1) {
            if (resources[index].type === type) {
                source = resources[index];
                break;
            }
        }
        slots.push({
            type,
            text: source ? formatBigMapTopResourceText(source, actionRecoverSeconds) : '—',
            source: source ?? { type, amount: 0, cap: Number.NaN, amountKnown: false },
        });
    }
    return {
        slots,
        buildQueueText: buildBigMapQueueText(queues),
        // 大地图没有「研究队列」这条业务，保留设计稿占位，不伪造进度。
        researchQueueText: '—',
    };
}
