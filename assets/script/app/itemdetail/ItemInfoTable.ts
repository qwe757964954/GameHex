/**
 * 「道具信息」弹窗（蓝湖「道具信息」稿，720×1610，面板 470×659）的版面常量与口径
 * —— 零 import 纯函数层，`tests/iteminfo.test.ts` 直接 import。
 *
 * 与 `ItemDetailTable` 的分工：那个是老端 FGUI「组件_角色_道具详情」那套（品质 / 数量 / 内容 / 合成），
 * 本文件是新版蓝湖稿的紧凑版 —— 物品框 + 类型/品质 + 说明 + 获取途径，没有内容格，也没有合成/前往按钮。
 *
 * 版面真源是设计稿节点坐标（画布 720×1610，面板 470×659 与设计 1:1）：
 *   面板底板     x125..595 / y542..1201
 *   途径底板     x142..579 / y878..1029（437×151，九宫）
 *   途径行       414×55 起，行距 11，底板内边距 13
 * 行数按 `item.access` 实际条数收放：设计稿画了两行（151 高），公式对 n=2 恰好回到 151。
 */

/** 面板宽（设计稿 470，与设计 1:1）。 */
export const ITEM_INFO_PANEL_WIDTH = 470;

/** 面板高（设计稿 659，固定 —— 底板是一张整图，不能随内容伸缩）。 */
export const ITEM_INFO_PANEL_HEIGHT = 659;

/**
 * 主物品格：设计稿尺寸 100×100。
 *
 * 格子里装的是公共奖励格 `ui/common/RewardItem.prefab`，它烘的是 96×96，
 * 实例化后按 `SLOT / ITEM` 放大根节点（改根 `contentSize` 会让内部 Frame / Icon / Num 错位）。
 */
export const ITEM_INFO_REWARD_SLOT_SIZE = 100;

/** 公共奖励格（`ui/common/RewardItem.prefab`）的原始边长。 */
export const ITEM_INFO_REWARD_ITEM_SIZE = 96;

/**
 * `item.type`（`ItemType` 枚举）→ 界面上的「类型」名。
 *
 * 真源是转表产出的 `ItemType`，这里只是显示名表：枚举改名不影响它，但新增类型要两边一起加，
 * 否则新类型会静默显示成空（页面会把整行藏掉）。11~13（客户端 / 通用 / 军师）暂无界面在用，先不映射。
 */
const ITEM_TYPE_NAMES: Readonly<Record<number, string>> = {
    1: '普通',
    2: '头像',
    3: '宝箱',
    4: '装备',
    5: '技能书',
    6: '角色资源',
    7: '宝石',
    8: '装备图纸',
    9: '皮肤',
    10: '灵兽',
};

/** 类型名；未登记 / 非法值返回空串（调用方据此藏掉类型行）。 */
export function itemTypeNameOf(type: number): string {
    const index = Math.floor(type);
    if (!Number.isFinite(index)) return '';
    return ITEM_TYPE_NAMES[index] ?? '';
}
