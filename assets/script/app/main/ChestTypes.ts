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
    /** 宝箱尚未启动计时：发起激活请求（金色按钮，文案「解锁」）。 */
    Activate: 'activate',
    /** 开启宝箱（绿色按钮，文案「开启」；与加速共用一套绿色底）。 */
    Open: 'open',
    /** 开始战斗（蓝色按钮，空槽位）。 */
    Battle: 'battle',
    /** 加速 30 分钟（绿色按钮）。 */
    SpeedUp: 'speedUp',
} as const;
export type ChestSlotAction = (typeof ChestSlotAction)[keyof typeof ChestSlotAction];

/** 一格的数据。 */
export interface IChestSlotData {
    /** 服务端槽位下标，固定为 1～4；界面数组下标为 0～3。 */
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

// ============================================================
// 宝箱详情弹窗（蓝湖「宝箱详情」）
// ============================================================

/**
 * 详情弹窗里**奖励说明**能放几格 —— 与 prefab 的 `Panel/ItemSlots/Slot1..5` 一一对应。
 *
 * 不是可调参数：改这个数要么露空槽、要么丢奖励，必须同步改 prefab。
 */
export const CHEST_DETAIL_REWARD_SLOTS = 5;

/** 一格「奖励说明」：品质框档位 + 图标 + 数量 + 概率（`ratePercent` 是**百分比**，70 ⇒ 显示 70%）。 */
export interface IChestDetailRewardData {
    readonly resId: number;
    readonly amount: number;
    readonly ratePercent: number;
    /** `icon` 字段拼好的可加载路径（取不到为空串）。 */
    readonly icon: string;
    /** 奖励道具品质（1..8，决定格子用哪个品质框）。 */
    readonly quality: number;
}

/**
 * 详情弹窗的**纯数据**。
 *
 * 刻意不在这里放 `SpriteFrame`：本文件是「零 `cc` 依赖」的领域模型，帧由页面
 * （`MainPage`）按 `icon` / 品质档位加载后注入视图。
 */
export interface IChestDetailData {
    readonly index: number;
    readonly cardBoxId: number;
    readonly name: string;
    readonly quality: number;
    /** 宝箱图标路径（`icons/item/...`）。 */
    readonly icon: string;
    readonly rewards: readonly IChestDetailRewardData[];
    /** 「立即打开」的货币消耗（`cardBoxOpenNow` 的第一段）；`0` = 不显示价格。 */
    readonly fastOpenCost: number;
    /** 剩余秒数（倒计时中才有意义）。 */
    readonly remainSeconds: number;
    readonly state: ChestSlotState;
    readonly action: ChestSlotAction;
}

/**
 * 秒数 → `HH:MM:SS`。
 *
 * 详情弹窗的倒计时文本与页面的每秒刷新共用同一份格式：两处各写一次必然漂移
 * （设计稿是 `01:35:25` 这种**三位**，不能省小时位）。
 */
export function formatChestCountdown(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return [hours, minutes, rest].map((value) => String(value).padStart(2, '0')).join(':');
}

/**
 * 「这颗按钮该写什么」—— 宝箱栏那颗按钮与**详情弹窗的主按钮**共用这一份判断。
 *
 * | `action` | 含义 | 文案 |
 * | :-- | :-- | :-- |
 * | `Activate` | 还没开始等（卡上显示的是"要等多久"） | 解锁 |
 * | `SpeedUp` | **正在等**（格上有倒计时） | 加速 |
 * | `Open` | 等完了 | 开启 |
 * | `Battle` | 空槽位 | 开始战斗 |
 *
 * 🔴 两处各写一份必然漂移：2026-11-09 栏位从「开启」改成「解锁」，详情弹窗还写着「打开」；
 * 同一天把等待中改成「加速」，弹窗又落后一轮（用户：「点击解锁中的宝箱，宝箱详情中的开启按钮
 * 用加速按钮替换」）。所以文案只在这里写一次，视图与页面都从这儿取。
 */
export function chestActionCaption(action: ChestSlotAction): string {
    if (action === ChestSlotAction.Battle) return '开始战斗';
    if (action === ChestSlotAction.SpeedUp) return '加速';
    if (action === ChestSlotAction.Activate) return '解锁';
    return '开启';
}
