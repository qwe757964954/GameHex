/**
 * 角色模块的类型与常量（**零引擎依赖**，可直接 import 单测）。
 *
 * 本轮只落地「角色主界面 + 背包三页签（宝石 / 装备 / 道具）」；
 * 左侧导航（武将 / 民兵 / 共鸣 / 近卫 / 属性预览 / 宝物 / 主公技）只登记，不做。
 */

/** 角色主界面左侧导航 id（与老端 FGUI 按钮一一对应）。 */
export const ROLE_NAV_IDS = [1, 2, 3, 4, 5, 6, 7] as const;

/** 背包页签 id：1 = 宝石，2 = 装备，3 = 道具。 */
export const ROLE_BAG_TAB_IDS = [1, 2, 3] as const;

export type RoleNavId = (typeof ROLE_NAV_IDS)[number];
export type RoleBagTabId = (typeof ROLE_BAG_TAB_IDS)[number];

/** 背包物品归属类型（决定图标加载通道）。 */
export type RoleBagKind = 'gem' | 'equip' | 'item';

export interface IRoleNavEntry {
    readonly id: RoleNavId;
    readonly name: string;
    readonly ready: boolean;
}

/**
 * 背包列表里的一格（三种 tab 统一形状）。
 *
 * 图标双通道（与「获得奖励」弹窗同一口径）：
 *   · 宝石 / 装备 —— iconKey 是 `icon.json` 的键（如「图标_宝石_白色」），**键就是文件名**，
 *                    图在 `icons/gem` / `icons/equip`（按 kind 分目录，**不走** `icons/head` 头像链）；
 *   · 道具        —— iconPath 是 item.icon 的 resources 相对路径，直接加载。
 */
export interface IRoleBagEntry {
    /** 列表项身份标识（宝石 = gemId，装备 = uniqueId，道具 = resId）。 */
    readonly id: number;
    /** 配置 resId（宝石槽类型 / 装备 / 道具）。 */
    readonly resId: number;
    /** 物品归属类型。 */
    readonly kind: RoleBagKind;
    /** 图标：icon.json 键（gem / equip）。 */
    readonly iconKey: string;
    /** 图标：resources 相对路径（item）。 */
    readonly iconPath: string;
    /** 名称。 */
    readonly name: string;
    /** 描述 / 属性描述（无则空串）。 */
    readonly desc: string;
    /** 品质（1–8，决定品质框）。 */
    readonly quality: number;
    /** 品阶（装备 `CmdEquipItem.rank`，显示 `{rank}GRADE_RANK`；其余为 0 = 不显示）。 */
    readonly rank: number;
    /** 数量（装备为 1）。 */
    readonly count: number;
    /** 是否装备 / 镶嵌中。 */
    readonly equipped: boolean;
    /** 是否有「更优」升级箭头。 */
    readonly upMark: boolean;
}

/** 装备部位数（老端 `equipType` 1..6；`Role.prefab` 里对应 `Equip1`..`Equip6`）。 */
export const ROLE_EQUIP_PART_COUNT = 6;

/**
 * 角色页装备栏**一格**的视图数据（`RoleRepository.equipParts()`）。
 *
 * ⚠️ 等级单独一个字段：它来自 `CmdEquip.level`（`CmdEquipPage.tlCmdEquip`），
 * **不在 `equip` 表里** —— `CmdEquipPart.equip`（`CmdEquipItem`）只有 resId / rank / curQuality。
 */
export interface IRoleEquipSlotData {
    /** 部位 1..6。 */
    readonly partId: number;
    /** 该部位穿着的装备（空位 = `null`）。 */
    readonly entry: IRoleBagEntry | null;
    /** 装备等级（`CmdEquip.level`；取不到 = 0 = 不显示）。 */
    readonly level: number;
}

export interface IRoleSnapshot {
    /** 战斗力（本轮先不接，0 = 未取到）。 */
    readonly power: number;
    /** 导航条目（按 id 升序）。 */
    readonly navs: readonly IRoleNavEntry[];
    /** 背包三个 tab 的条目数（key = tab id）。 */
    readonly bagCounts: Readonly<Record<RoleBagTabId, number>>;
}

// ============================================================
// 装备格（供「个人信息」PlayerInfoRepository 复用）
// ============================================================

/** 一个装备位上的装备（`CmdEquipPart.equip` 的界面投影，见 RoleTable.equipPartOf）。 */
export interface IEquipPartInfo {
    readonly equipId: number;
    /** `equipType` 表的部位序号 1..6；查不到时 0（界面按 0 隐藏）。 */
    readonly type: number;
    /** 图标路径（相对 `assets/resources/`），来自 `equip.icon`；空串 = 没有图。 */
    readonly icon: string;
    /** 品质 1..4（`equip.quality`）；0 = 未知。 */
    readonly quality: number;
    /** 该装备上的宝石数量；界面只画数量。 */
    readonly gemCount: number;
}
