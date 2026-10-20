/**
 * 宝箱栏的领域模型：**零 `cc` 依赖**，供视图（`ChestBar` / `ChestSlotView`）与数据层
 * （`NewTreasureRepository`）共用。
 *
 * 为什么要单独成文件：这些常量/枚举/接口原先都放在 `ChestBar.ts` 里，而那个文件是
 * `cc.Component` 子类、一 import 就拉引擎 ⇒ `NewTreasureRepository` 这种纯数据仓库被迫
 * 连带依赖 `cc`，测试只能退化成「源码文本断言」（见 `tests/chest-bar.test.ts` 头注释）。
 */

/** 一屏的宝箱格数（对应 prefab 里 4 个 `ChestSlot` 实例）。 */
export const CHEST_SLOT_COUNT = 4;
/** 空槽位点「开始战斗」消耗的体力。 */
export const CHEST_EMPTY_SLOT_STAMINA_COST = 50;

/**
 * 宝箱格的状态（规则 302：`as const` 对象 + 同名派生类型，不用 `enum`）。
 */
export const ChestSlotState = {
    /** 空槽位：花体力开新宝箱。 */
    Empty: 'empty',
    /** 宝箱倒计时中。 */
    Counting: 'counting',
    /** 倒计时结束，可以开启。 */
    Ready: 'ready',
    /** 未解锁（等级 / 前置条件不够）。 */
    Locked: 'locked',
} as const;
export type ChestSlotState = (typeof ChestSlotState)[keyof typeof ChestSlotState];

/** 格子上那颗按钮要做什么。 */
export const ChestSlotAction = {
    /** 宝箱尚未启动计时：发起激活请求。 */
    Activate: 'activate',
    /** 开启宝箱（金色按钮）。 */
    Open: 'open',
    /** 开始战斗（蓝色按钮，空槽位）。 */
    Battle: 'battle',
    /** 加速 30 分钟（绿色按钮）。 */
    SpeedUp: 'speedUp',
} as const;
export type ChestSlotAction = (typeof ChestSlotAction)[keyof typeof ChestSlotAction];

/** 一格的数据。 */
export interface IChestSlotData {
    /** 服务端槽位下标；空槽位使用本地下标。 */
    index: number;
    state: ChestSlotState;
    /** 「宝箱名字」；空槽位不用。 */
    name: string;
    /** 剩余秒数（`Counting` 画进度与文本）。 */
    remainSeconds: number;
    /** 总秒数（进度条分母，`<= 0` 视为没有进度）。 */
    totalSeconds: number;
    /** 按钮行为。 */
    action: ChestSlotAction;
    /** 空槽位的体力消耗（`Battle` 才显示闪电 + 数字）。 */
    cost: number;
}
