/**
 * 中立资源点的奖励种类。
 *
 *  与地图 `resourcePoints[].pool` 的 key **同名同集合** —— 那边是权重池（`{chest: 1}`、
 * `{gold: 5, unit_cap: 3, artifact_charge: 2}`），这边是「抽到该 id 后发什么」。
 * 两边必须一起改，否则会出现「池里抽得到、这边发不出」或反之。
 */
export const ZCNeutralResourceId = {
    Gold: 'gold',
    Mine: 'mine',
    Chest: 'chest',
    UnitCap: 'unit_cap',
    ArtifactCharge: 'artifact_charge',
} as const;
export type ZCNeutralResourceId = (typeof ZCNeutralResourceId)[keyof typeof ZCNeutralResourceId];

const ZC_NEUTRAL_RESOURCE_ID_SET: ReadonlySet<string> = new Set(Object.values(ZCNeutralResourceId));

/**
 * 外部数据（地图 JSON 的资源池 key、快照）里的 id 是否合法。
 *
 * 声明侧统一用 `ZCNeutralResourceId`，只有不可信的输入才走这里收窄 ——
 * 别再 `resourceId as ZCNeutralResourceId` 强转把配置错误放进来。
 */
export function isZCNeutralResourceId(value: unknown): value is ZCNeutralResourceId {
    return typeof value === 'string' && ZC_NEUTRAL_RESOURCE_ID_SET.has(value);
}

/**
 * 一份奖励：金币 + 神器充能 + 直接产出的兵。
 *
 *   **历史包袱**：`unitCap`（"每方兵力上限 +N"）**至今没有可用字段**——
 *  `rules.unitCapPerSide` 是全局规则常量、快照里没有每方独立上限，所以这一项
 *  恒为 0、**代码不消费它**。2026-10-08 起兵力资源改走 `rewardCardId` +`rewardUnitCount`
 *  （直接产 N 个具体兵），表里 `unitCap` 列保留只为不破坏既有列位，别再往里填非 0 值。
 */
export interface ZCNeutralResourceReward {
    readonly gold: number;
    readonly artifactCharge: number;
    /** 直接产出的卡牌 id（`pvpCard.id`）；`null` = 这一项不发兵。 */
    readonly rewardCardId: string | null;
    /** 发几个该卡的兵；`<= 0` 视为不发。 */
    readonly rewardUnitCount: number;
}

/**
 *  **数值是占位口径，待策划确认。**
 *
 * 这套中立资源点是 Demo3.8 自有玩法，老端 `client` 里搜不到对应实现，策划表
 * （`assets/resources/config/maps/*.json`）也只给了资源 id 池、**没有给奖励数值**，
 * 所以下面的数字是按「相对倍率」先定的占位值，不是策划案。
 *
 * 定稿前请与策划对齐，并同步更新 `tests/zcds-neutral-resource-reward.test.ts` 里的期望值。
 *
 * 相对关系（这是有意为之，改数值时别破坏）：
 * - `gold`（金币）最少：它是「顺手的零钱」，不是奖励主体。
 * - `mine`（金矿）给约 `gold` 的 5倍：本味是稳定收入，值得单独占一格。
 * - `chest`（宝箱）折算价值最高，且**额外给神器充能**：它是唯一「开箱」型资源。
 * - `artifact_charge`（神器）只给充能、不给金币：它对应 `artifactChargeFull` 的一次整充能。
 * - `unit_cap`（兵力）**直接产 3 个 68001豌豆游侠**（2026-10-08 定，见 `rewardCardId`）：
 *   走现有 `spawnUnit` 的 `born` 流程，出生在资源点格上，行为与兵营产出的兵完全一致
 *   （`idle`= 已在射程内待机攻击；`moveForward` = 无目标待命，两者都会主动索敌）。
 */
export const ZC_NEUTRAL_RESOURCE_REWARDS: Readonly<Record<ZCNeutralResourceId, ZCNeutralResourceReward>> = {
    gold: { gold: 50, artifactCharge: 0, rewardCardId: null, rewardUnitCount: 0 },
    mine: { gold: 250, artifactCharge: 0, rewardCardId: null, rewardUnitCount: 0 },
    chest: { gold: 100, artifactCharge: 1, rewardCardId: null, rewardUnitCount: 0 },
    unit_cap: { gold: 0, artifactCharge: 0, rewardCardId: '68001', rewardUnitCount: 3 },
    artifact_charge: { gold: 0, artifactCharge: 1, rewardCardId: null, rewardUnitCount: 0 },
};

/** 什么都不发的空奖励（多处兜底共用同一份，避免各写一个字面量）。 */
const NO_REWARD: ZCNeutralResourceReward = {
    gold: 0, artifactCharge: 0, rewardCardId: null, rewardUnitCount: 0,
};

/**
 * 取奖励；`resourceId` 不认识时返回 0 奖励（而不是 undefined，调用侧不必判空）。
 *
 * 入参保持 `string`：快照 / 地图配置是外部数据，未知 id 是**运行时可能发生**的情况，
 * 契约是兜底为 0（见 `tests/zcds-neutral-resource-reward.test.ts`）；用守卫收窄，
 * 不用 `as` 强转硬塞进索引签名。
 */
export function neutralResourceRewardOf(resourceId: string | null | undefined): ZCNeutralResourceReward {
    return resourceId && isZCNeutralResourceId(resourceId) ? ZC_NEUTRAL_RESOURCE_REWARDS[resourceId] : NO_REWARD;
}

/**
 * 这个资源点发不发出任何东西（用于「发了但总额是 0」时跳过发放，避免空操作）。
 *
 *   **必须把产兵算进去**：兵力资源的金币/充能都是 0、只有 `rewardUnitCount > 0`，
 * 漏判这一项会导致「以为没奖励就跳过，实际该发兵」。
 */
export function hasNeutralResourceReward(reward: ZCNeutralResourceReward): boolean {
    return reward.gold > 0
        || reward.artifactCharge > 0
        || (!!reward.rewardCardId && reward.rewardUnitCount > 0);
}