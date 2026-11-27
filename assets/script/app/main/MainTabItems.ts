/** 主城底栏页签的展示配置；图标帧和业务类型分别由 MainRoot.prefab 实例声明。 */
export interface IMainTabItem {
    readonly name: string;
    readonly rdExpr?: string;
}

export const MAIN_TAB_ITEMS: readonly IMainTabItem[] = [
    { name: '商店' },
    { name: '英雄' },
    // 角色（人物）入口：宝石可合成（服务端）∪ 装备可锻造（`RDEquipLevelUp`，与角色页装备页签同一变量）。
    { name: '角色', rdExpr: '[RDTabGem]+([RDEquipLevelUp])' },
    // 「领地」指主城页，不是角色主界面。
    { name: '领地' },
    { name: '挑战' },
    { name: '联盟' },
    { name: '世界' },
];

/** 按 MainTab 类型取展示配置；未配置类型返回 undefined。 */
export function mainTabItem(type: number): IMainTabItem | undefined {
    return MAIN_TAB_ITEMS[type];
}
