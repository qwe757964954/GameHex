/**
 * 角色模块的类型与常量（**零引擎依赖**，可直接 import 单测）。
 *
 * 本轮只落地「角色主界面 + 背包三页签（宝石 / 装备 / 道具）」；
 * 左侧导航（武将 / 民兵 / 共鸣 / 近卫 / 属性预览 / 宝物 / 主公技）只登记，不做。
 */
import type { GameRequestStatus } from '../net/RequestGuard';

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
    readonly uniqueId?: string;
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
    /** 展示品质（1–7 普通…神话，决定品质框）；装备的 `curQuality` 是品质档，已在仓库换算。 */
    readonly quality: number;
    /** 品阶（装备 `CmdEquipItem.rank`，显示 `{rank}GRADE_RANK`；其余为 0 = 不显示）。 */
    readonly rank: number;
    /**
     * 单件分解返还的精炼石数量（仅装备有意义，见 `EquipDecomposeTable.equipDecomposeGain`）。
     * 其他类型缺省 / 0 = 不可分解。
     */
    readonly decompose?: number;
    /** 数量（装备为 1）。 */
    readonly count: number;
    /** 是否装备 / 镶嵌中。 */
    readonly equipped: boolean;
    /** 是否有「更优」升级箭头。 */
    readonly upMark: boolean;
}

/** 装备部位数（老端 `equipType` 1..6；`Role.prefab` 里对应 `Equip1`..`Equip6`）。 */
export const ROLE_EQUIP_PART_COUNT = 6;
export const ROLE_GEM_SOCKET_COUNT = 5;

/**
 * 装备锻造页签：`Strengthen` = 强化分页，`Upgrade` = 升品 / 洗炼分页。
 *
 * 规则 302：`as const` 对象 + 同名派生类型，不用 `enum`（样板见 `main/ChestTypes`）。
 */
export const EquipEvolveTab = {
    Strengthen: 'strengthen',
    Upgrade: 'upgrade',
} as const;
export type EquipEvolveTab = (typeof EquipEvolveTab)[keyof typeof EquipEvolveTab];

export interface IRoleGemEntry extends IRoleBagEntry {
    readonly kind: 'gem';
    readonly gemId: string;
    readonly equipId: number;
    /** 属性类型（`gemAttribute.type`；0 = 配置缺失），推荐箭头与同类灰罩按它比较。 */
    readonly attrType?: number;
    /** 生效技能 id（`gemAttribute.skillId`；0 = 非技能宝石），详情弹窗据此显示「生效技能」。 */
    readonly skillId?: number;
    /** 同部位装备上已存在「同属性类型 + 同品质」宝石的灰罩（老端 `TabGem.mask`）。 */
    readonly masked: boolean;
}

/**
 * 一条锻造消耗的结构化事实（展示 `owned/need`，图标取物品表 `icon`）。
 *
 * 与 {@link IRoleEquipGrowth.levelCost} 等字符串并列：字符串供确认弹窗拼接文案，
 * 本结构供锻造页渲染「持有/需求 + 颜色」；两者同源，改口径时一起改。
 */
export interface IRoleEquipCostFact {
    readonly name: string;
    readonly need: number;
    readonly owned: number;
    /** 图标资源路径（相对 resources 根，如 `icons/resource/图标_铜币`）。 */
    readonly iconPath: string;
}

/** 升品行的一条属性（`name` 含尾冒号，`cur/next` 已带 `+` / `%` 后缀）。 */
export interface IRoleEquipEffectRow {
    readonly name: string;
    readonly cur: string;
    readonly next: string;
}

export interface IRoleEquipGrowth {
    readonly id: string;
    readonly baseId: number;
    readonly name: string;
    readonly level: number;
    readonly rank: number;
    readonly worn: boolean;
    readonly attack: number;
    readonly hpPercent: number;
    readonly nextAttack?: number;
    readonly nextHpPercent?: number;
    readonly effects: readonly string[];
    /**
     * 已镶嵌宝石的属性文案（`gemAttribute.modifyDesc`，按孔位顺序）。
     *
     * 与 {@link effects}（装备洗练属性，和 {@link washValues} 下标一一对应）**分列**：
     * 宝石不参与洗练数值，混进 `effects` 会让升品页的下标错位。
     */
    readonly gemEffects: readonly string[];
    readonly washValues: readonly number[];
    readonly levelCost: readonly string[];
    readonly qualityCost: string | null;
    readonly washCost: string | null;
    /** 当前品阶的稀有度名（`equipRank.rarityName`，如「平凡」）。 */
    readonly rarityName: string;
    /** 下一品阶的稀有度名；已满品阶为 `null`。 */
    readonly nextRarityName: string | null;
    /** 升品行数据（`effects` 的「名称 + 当前 → 下一」拆列版本）。 */
    readonly effectRows: readonly IRoleEquipEffectRow[];
    /** 强化消耗（金币 / 图纸），按 `levelCost` 的顺序。 */
    readonly levelCostFacts: readonly IRoleEquipCostFact[];
    readonly qualityCostFact: IRoleEquipCostFact | null;
    readonly washCostFact: IRoleEquipCostFact | null;
}

export interface IRoleEquipPlan {
    readonly page: number;
    readonly name: string;
    readonly selected: boolean;
    readonly lockedUntil: number;
}

export interface IRoleGemGrowth {
    readonly lock: number;
    readonly refineCost: number;
    readonly pendingAttribute: string;
}

export interface IRoleGrowthProtocol {
    CmdEquipSelectPageReqMsg: [CmdEquipSelectPageReqMsg, CmdEquipSelectPageRspMsg];
    CmdEquipReplaceReqMsg: [CmdEquipReplaceReqMsg, CmdEquipReplaceRspMsg];
    CmdEquipDecomposeReqMsg: [CmdEquipDecomposeReqMsg, CmdEquipDecomposeRspMsg];
    CmdEquipUpLevelReqMsg: [CmdEquipUpLevelReqMsg, CmdEquipUpLevelRspMsg];
    CmdEquipUpLevelAllReqMsg: [CmdEquipUpLevelAllReqMsg, CmdEquipUpLevelAllRspMsg];
    CmdEquipUpQualityReqMsg: [CmdEquipUpQualityReqMsg, CmdEquipUpQualityRspMsg];
    CmdEquipWashReqMsg: [CmdEquipWashReqMsg, CmdEquipWashRspMsg];
    CmdEquipWashConformReqMsg: [CmdEquipWashConformReqMsg, CmdEquipWashConformRspMsg];
    CmdGemLockReqMsg: [CmdGemLockReqMsg, CmdGemLockRspMsg];
    CmdGemRefineReqMsg: [CmdGemRefineReqMsg, CmdGemRefineRspMsg];
    CmdGemRefineSaveReqMsg: [CmdGemRefineSaveReqMsg, CmdGemRefineSaveRspMsg];
}

export interface IRoleGemSocket {
    readonly page: number;
    readonly equipId: number;
    readonly order: number;
    readonly gemId: string;
}

export type RoleGemChange =
    | { readonly kind: 'on'; readonly payload: { equipId: number; page: number; id: string } }
    | { readonly kind: 'replace'; readonly payload: { equipId: number; page: number; order: number; id: string } }
    | { readonly kind: 'down'; readonly payload: { equipId: number; page: number; order: number } };

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
    readonly sockets: readonly IRoleGemSocket[];
}

export interface IRoleSnapshot {
    /** 战斗力：卡牌阵容战力（与卡牌页 / 主界面同源同式）；0 = 空阵容或未取到。 */
    readonly power: number;
    /** 导航条目（按 id 升序）。 */
    readonly navs: readonly IRoleNavEntry[];
    /** 背包三个 tab 的条目数（key = tab id）。 */
    readonly bagCounts: Readonly<Record<RoleBagTabId, number>>;
}

/**
 * 装备锻造红点：**单个部位**能不能强化 / 升品 / 洗炼。
 *
 * 判定口径见 `RoleEquipRedDotTable`；角色页「装备」页签、锻造入口、装备栏 6 格、
 * 锻造弹窗内的页签与按钮、底栏角色入口全部读这一份，避免各界面各算一套。
 */
export interface IEquipPartRedDots {
    /** 部位 1..6。 */
    readonly partId: number;
    /** 可强化（金币 + 强化道具足够、未满级）。 */
    readonly strengthen: boolean;
    /** 可升品（升品材料足够、未满品）。 */
    readonly upgrade: boolean;
    /** 可洗炼（已开放 `libCount >= 2` 且材料足够）。 */
    readonly wash: boolean;
    /** 三项任一为真。 */
    readonly any: boolean;
}

/** 装备锻造红点：6 个部位 + 整页汇总。 */
export interface IEquipRedDots {
    /** 下标 0..5 = 部位 1..6（恒 6 项，空位全 false）。 */
    readonly parts: readonly IEquipPartRedDots[];
    readonly strengthen: boolean;
    readonly upgrade: boolean;
    readonly wash: boolean;
    readonly any: boolean;
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

/**
 * 装备分解请求结果（`RoleRepository.decomposeEquips()`）。
 *
 * `removedIds` 以服务端回包为准 —— 服务端可能只接受其中一部分；
 * `rewards` 是 `CmdEquipDecomposeRspMsg.tlCmdGoods`，为空时界面不应假设「没有奖励」，
 * 先按成功提示。
 */
export interface IRoleDecomposeResult {
    readonly status: GameRequestStatus;
    /** 服务端确认已移除的装备 uniqueId（十进制字符串）。 */
    readonly removedIds: readonly string[];
    /** 分解获得的物品。 */
    readonly rewards: readonly CmdGoods[];
}

/**
 * 批量分解的执行选项。
 *
 * 当前协议 `CmdEquipDecomposeReqMsg.tlUniqueIds` 是 repeated，但**服务端未必实现批量**：
 * 默认先按老端整包发一次；回包缺件或服务端只接受单件时，剩余装备逐件补发。
 * `sequential` 用于后端明确只支持单件、想跳过整包等待的场景。
 */
export interface IRoleDecomposeOptions {
    readonly mode?: 'batch' | 'sequential';
    /** 每完成一件（或整包返回）回调一次；`completed` = 已确认移除件数，`total` = 本次提交总件数。 */
    readonly onProgress?: (completed: number, total: number) => void;
}
