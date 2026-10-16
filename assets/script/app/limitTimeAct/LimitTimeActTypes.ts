/**
 * 「限时活动」三页签（每日任务 / 每日礼包 / 限购）的类型定义。
 *
 * 老端 `LayerLimitTimeAct` 的 `ActType`：Task(0)=每日任务 / DayGift(1)=每日礼包 /
 * LimitBuy(2)=限购。配置与服务端数据都走后台活动链路（`CmdActivitySimple` + `reqActivityJson`
 * + `reqActivityLimitTimeInfo`），**不是** `assets/remoteRef` 里的静态表。
 */

/** 页签枚举（下标即老端 `ActType`，也是页签栏顺序）。 */
export const enum LimitTimeTab {
    /** 每日任务（配置 `limitTimeTask`，进度 `tlCmdTask`）。 */
    Task = 0,
    /** 每日礼包（配置 `limitTimeDay`，购买次数 `tlLimitTimeDay`）。 */
    DayGift = 1,
    /** 限购（配置 `limitTimeActivity`，购买次数 `tlLimitTimeActivity`）。 */
    LimitBuy = 2,
}

/** 服务器状态（`CmdCommonState`）。 */
export const TASK_STATE_UNDONE = 0;
export const TASK_STATE_FINISH = 1;
export const TASK_STATE_REWARDED = 2;

/** 一条奖励（配置里 `{ resId, number }`）。 */
export interface ILimitTimeReward {
    readonly resId: number;
    readonly number: number;
}

/** 每日任务的一行（`limitTimeTask`，服务端下发）。 */
export interface ILimitTimeTaskRow {
    readonly resId: number;
    readonly name: string;
    readonly sort: number;
    readonly desc: string;
    /** 老端 `TaskType`：跳转 / 判定用途。 */
    readonly targetType: number;
    /** `param.count`：达成条件需要的次数。 */
    readonly count: number;
    readonly rewards: readonly ILimitTimeReward[];
}

/** 每日任务的一条服务器进度（`CmdTask`）。 */
export interface ILimitTimeTaskState {
    readonly resId: number;
    readonly count: number;
    /** `CmdCommonState`：0 未完成 / 1 可领取 / 2 已领取。 */
    readonly state: number;
}

/** 每日礼包 / 限购共用的一行（`limitTimeDay` / `limitTimeActivity`，服务端下发）。 */
export interface ILimitTimeGoodsRow {
    readonly resId: number;
    readonly title: string;
    readonly desc: string;
    readonly rewards: readonly ILimitTimeReward[];
    /** 货币类型（`roleProperty` / 货币的 resId）。 */
    readonly priceType: number;
    /** 单价。 */
    readonly cost: number;
    /** 限购次数。 */
    readonly count: number;
    /** 折扣（如 2 = 2 折）；0 = 无折扣。 */
    readonly discount: number;
}

/** 每日礼包 / 限购的一条购买次数（`CmdActivityGoods`）。 */
export interface ILimitTimeGoodsState {
    readonly resId: number;
    /** 已购买次数。 */
    readonly times: number;
}

/** 后台活动（`CmdActivitySimple`）—— 决定要不要展示、拉什么配置。 */
export interface ILimitTimeActMeta {
    /** 活动实例 id（`CmdActivitySimple.id`，string）。 */
    readonly id: string;
    /** 活动类型（`CmdActivityTypeEnum.limit_time = 101`）。 */
    readonly type: number;
    /** 要拉取的配置 json 名（`jsonNames`，去掉 `*Config` 就是三页签配置名）。 */
    readonly jsonNames: readonly string[];
    /** 结束时间（毫秒时间戳，倒计时用）。 */
    readonly endTime: number;
    /** 标题（`limitTimeConfig` 里那条的 `title`）。 */
    readonly title: string;
    /** 入口图标（`limitTimeConfig` 里 key=icon 的 `value`）。 */
    readonly icon: string;
}

/** 三页签配置（`reqActivityJson` 下发的 JSON 内容，按 json 名索引）。 */
export interface ILimitTimeActConfig {
    /** `limitTimeTask` 行。 */
    readonly tasks: readonly ILimitTimeTaskRow[];
    /** `limitTimeDay` 行。 */
    readonly dayGifts: readonly ILimitTimeGoodsRow[];
    /** `limitTimeActivity` 行。 */
    readonly limitBuys: readonly ILimitTimeGoodsRow[];
}

/** 服务器数据（`reqActivityLimitTimeInfo` 响应）。 */
export interface ILimitTimeActData {
    /** 每日任务进度。 */
    readonly tasks: readonly ILimitTimeTaskState[];
    /** 每日礼包购买次数。 */
    readonly dayGifts: readonly ILimitTimeGoodsState[];
    /** 限购购买次数。 */
    readonly limitBuys: readonly ILimitTimeGoodsState[];
}

/** 采集一次界面要的全部数据（页面只依赖这一份快照）。 */
export interface ILimitTimeActSnapshot {
    readonly meta: ILimitTimeActMeta;
    readonly config: ILimitTimeActConfig;
    readonly data: ILimitTimeActData;
}
