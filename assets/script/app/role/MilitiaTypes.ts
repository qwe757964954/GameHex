/**
 * 民兵「天赋」模块的类型与常量（**零引擎依赖**，可直接 import 单测）。
 *
 * 老端对应：`client/assets/script/app/game/ctrl/army/militia/`
 * （`LayerMiltiaMain` 主界面 + `LayerMiltiaMenuMenu` 菜单层 + `TabMiltiaTalent` 天赋分页）。
 *
 * 新端只迁**天赋**这一支（皮肤 tab 不迁）：角色页左侧导航「天赋」（`NavMilitia`）点开
 * `ui/Role/TabMilitiaTalent`，列表 + 详情 + 激活。
 */

/**
 * 兵种 id：民兵（`ArmyTypeId.MinBing`，老端 `CtrlArmy.ts`）。
 *
 * ⚠️ 整个天赋模块**只服务这一个兵种** —— `armyLevel` 表里 669 行按 id 分兵种
 * （66014 = 民兵，201 级），取错 id 会拉到别人的等级曲线上。
 */
export const MILITIA_ARMY_ID = 66014;

/** 老端兜底等级（`getLevel()` 读不到 `CmdArmyLevel` 时返回 1）。 */
export const MILITIA_DEFAULT_LEVEL = 1;

/** `armyLevel` 表的列（列式表 `k` 的顺序）。 */
export interface IMilitiaLevelRow {
    /** 兵种 id（民兵 = {@link MILITIA_ARMY_ID}）。 */
    readonly id: number;
    /** 等级 1..201。 */
    readonly level: number;
    /** 升到**下一级**要的金币数（本行的消耗 = 从本等级升上去）。 */
    readonly costGoldCnt: number;
    /** 升到下一级要的道具 id。 */
    readonly costItemID: number;
    /** 升到下一级要的道具数量。 */
    readonly costItemNum: number;
    /** 策划手写的描述（`modifyDesc`，没有 effect 时用）。 */
    readonly modifyDesc: string;
    /** `skillAttrModifier` id 列表（老端取 `[0]`）。 */
    readonly attrList: readonly number[];
    /** 图标 key（`icon` 表的键，如「图标_民兵天赋_1」；实际图 = key + `_1`/`_0`）。 */
    readonly icon: string;
    /** `skillAttrModifier` id 列表（老端第二路，`modifyDesc` 有值时用它取名字）。 */
    readonly modify: readonly number[];
}

/** `skillAttrModifier` 表里的一条属性改写在内存里的形状。 */
export interface IMilitiaModifierData {
    /** 改写的属性名 → 数值（如 `{ 民兵暴击率: 0.1 }`）。 */
    readonly data: Readonly<Record<string, number>>;
}

/** `skillAttrModifier` 表里的一条 `modify` 条目。 */
export interface IMilitiaModifierEntry {
    /** 类型（老端只认「修改属性」）。 */
    readonly type: string;
    readonly data: Readonly<Record<string, number>>;
}

/** `skillAttrModifier` 表的列。 */
export interface IMilitiaModifierRow {
    readonly id: number;
    readonly name: string;
    readonly desc: string;
    /** `modify` 数组（总览聚合要走第一条，只认 `type === '修改属性'`）。 */
    readonly modify: readonly IMilitiaModifierEntry[];
    /** 属性名 → 界面显示名（`armyTalent`；总览里的 key 用它替换）。 */
    readonly armyTalent: Readonly<Record<string, string>>;
}

/** 列表一格的三态（老端 `item.setSelectedPage("状态", …)`）。 */
export type MilitiaTalentState = 'locked' | 'unlocked' | 'current';

/** 天赋列表一格（老端 `renderListItem` 的入参投影）。 */
export interface IMilitiaTalentCell {
    /** 天赋等级。 */
    readonly level: number;
    /** 相对当前等级的三态。 */
    readonly state: MilitiaTalentState;
    /** 图标 key（已带 `_1` / `_0` 后缀）。 */
    readonly iconKey: string;
    /** 效果名（`skillAttrModifier.name`；没有 effect 时为空串）。 */
    readonly effectName: string;
    /** 效果描述（`skillAttrModifier.desc`；没有 effect 时为空串）。 */
    readonly effectDesc: string;
    /** 是否有 effect（老端据此把图标放大到 1.3 并显示右侧文本块）。 */
    readonly hasEffect: boolean;
    /** 是否是「下一级」（老端只给这一格挂红点）。 */
    readonly isNext: boolean;
}

/** 详情小弹窗（老端 `showSkillEffect`）。 */
export interface IMilitiaTalentDetail {
    /** 展示的等级。 */
    readonly level: number;
    /** 图标 key（已带后缀）。 */
    readonly iconKey: string;
    /** 效果名。 */
    readonly effectName: string;
    /** 效果描述。 */
    readonly effectDesc: string;
    /** 需要的金币数。 */
    readonly goldNeed: number;
    /** 持有的金币数。 */
    readonly goldOwned: number;
    /** 需要的道具 id。 */
    readonly itemId: number;
    /** 需要的道具数量。 */
    readonly itemNeed: number;
    /** 持有的道具数量。 */
    readonly itemOwned: number;
    /** 金币够不够。 */
    readonly goldEnough: boolean;
    /** 道具够不够。 */
    readonly itemEnough: boolean;
    /** 「激活」按钮是否可点（老端 `激活项` 页 = `lv === cur + 1`）。 */
    readonly activatable: boolean;
    /** 材料是否满足（金币 + 道具，老端 `checkCanLvUp`）。 */
    readonly canAfford: boolean;
}

/** 天赋页一次刷新的全部数据。 */
export interface IMilitiaTalentSnapshot {
    /** 当前等级（`CmdArmyLevel.level`；读不到 = {@link MILITIA_DEFAULT_LEVEL}）。 */
    readonly level: number;
    /** 列表数据（**等级降序**，老端 `[...tl].reverse()`）。 */
    readonly cells: readonly IMilitiaTalentCell[];
    /** 打开时要滚到中间的那一项下标（-1 = 不滚）。 */
    readonly focusIndex: number;
    /** 红点：当前等级能否升级（老端 `checkMilitiaCanLevelUp`）。 */
    readonly redDot: number;
}
