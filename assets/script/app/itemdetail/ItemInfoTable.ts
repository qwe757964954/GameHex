/**
 * 「道具信息」弹窗（蓝湖「道具信息」稿，720×1610，面板 470×659）的**版面常量与口径** ——
 * 零 import 纯函数层，`tests/iteminfo.test.ts` 直接 import。
 *
 * 与 `ItemDetailTable` 的分工：
 *   · `ItemDetailTable` —— 老端 FGUI「组件_角色_道具详情」那套（品质 / 数量 / 内容 / 合成）
 *   · 本文件           —— 新版蓝湖稿的**紧凑版**：物品框 + 类型/品质 + 说明 + 获取途径，
 *                        没有「内容」格、没有合成/前往按钮，面板固定高度。
 *
 * 版面真源 = 蓝湖设计稿节点坐标（设计稿画布 720×1610，面板 470×659 与设计 1:1）：
 *
 *   | 元素 | 设计稿（左上原点到右下） |
 *   |---|---|
 *   | 面板底板 | x125..595 / y542..1201 |
 *   | 获取途径底板 | x142..579 / y878..1029（437×151，九宫） |
 *   | 途径行 | 414×55 起，行距 11，底板内边距 13 |
 *
 * 行数按 `item.access` 实际条数收放：设计稿画了两行（151 高），公式对 n=2 恰好回到 151。
 */

/** 面板宽（设计稿 470，与设计 1:1）。 */
export const ITEM_INFO_PANEL_WIDTH = 470;

/** 面板高（设计稿 659，固定 —— 底板是一张整图，不能随内容伸缩）。 */
export const ITEM_INFO_PANEL_HEIGHT = 659;

/** 获取途径：单行高度。 */
export const ITEM_INFO_ROW_HEIGHT = 57;

/** 获取途径：行间距。 */
export const ITEM_INFO_ROW_GAP = 11;

/** 获取途径：底板上下内边距。 */
export const ITEM_INFO_ROWS_PAD = 13;

/** 获取途径：行宽（底板宽 437 − 左右 11.5）。 */
export const ITEM_INFO_ROW_WIDTH = 414;

/** 获取途径：底板宽（九宫，按行数只改高度）。 */
export const ITEM_INFO_PLATE_WIDTH = 437;

/**
 * 主物品格：设计稿尺寸 100×100。
 *
 * 格子里装的是**公共奖励格** `ui/common/RewardItem.prefab`，它烘的是 96×96
 * ⇒ 实例化后按 `SLOT / ITEM` 放大根节点（改根 `contentSize` 会让内部 Frame/Icon/Num 错位）。
 */
export const ITEM_INFO_REWARD_SLOT_SIZE = 100;

/** 公共奖励格（`ui/common/RewardItem.prefab`）的原始边长。 */
export const ITEM_INFO_REWARD_ITEM_SIZE = 96;

/**
 * prefab 里预建的行数。
 * 取 `item` 表 `access` 的最大长度（实测 4 条，仅 1 件物品），再多就是表出错，
 * 宁可截断 + 控制台告警，也不要为了极端数据把行做成虚拟列表。
 */
export const ITEM_INFO_MAX_ROWS = 4;

/**
 * 获取途径底板高度：`2 × 内边距 + n × 行高 + (n−1) × 行距`。
 * n=2 ⇒ 26 + 114 + 11 = 151（与设计稿底板高度一致）。
 */
export function itemInfoRowsHeightOf(count: number): number {
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n <= 0) return 2 * ITEM_INFO_ROWS_PAD + ITEM_INFO_ROW_HEIGHT;
    return 2 * ITEM_INFO_ROWS_PAD + n * ITEM_INFO_ROW_HEIGHT + (n - 1) * ITEM_INFO_ROW_GAP;
}

/** 实际要摆几行：至少 1 行（「暂无获取途径」占位），最多 `ITEM_INFO_MAX_ROWS`。 */
export function itemInfoRowCountOf(count: number): number {
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(n, ITEM_INFO_MAX_ROWS);
}

/**
 * `item.type`（`ItemType` 枚举）→ 界面上的「类型」名。
 *
 * ⚠️ 真源是 `assets/script/app/generated/refGen/RefEnum.ts` 的 `ItemType`（转表产出），
 * 这里只是**显示名**表 —— 枚举改名不影响它，但新增类型必须两边一起加，
 * 否则新类型会静默显示成空（`''`，页面会把整行藏掉）。
 *
 * 设计稿写的是「消耗品」（兵种经验那件），而表里兵种经验的 `type = 5 = 技能书` ——
 * 设计稿是示意文案，这里按枚举口径显示。11~13 是客户端/通用/军师，暂无界面在用，先不映射。
 */
export const ITEM_TYPE_NAMES: Readonly<Record<number, string>> = {
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
    const n = Math.floor(type);
    if (!Number.isFinite(n)) return '';
    return ITEM_TYPE_NAMES[n] ?? '';
}
