import { CARD_LINEUP_TEXTS } from '../card/CardLineupTexts';

/** 主城底栏页签的展示配置；图标帧和业务类型分别由 MainRoot.prefab 实例声明。 */
export interface IMainTabItem {
    readonly name: string;
    readonly rdExpr?: string;
}

export const MAIN_TAB_ITEMS: readonly IMainTabItem[] = [
    { name: CARD_LINEUP_TEXTS.navShops },
    { name: CARD_LINEUP_TEXTS.navHero },
    { name: CARD_LINEUP_TEXTS.navRoles },
    { name: CARD_LINEUP_TEXTS.navTerritory },
    { name: CARD_LINEUP_TEXTS.navChallenge },
    { name: CARD_LINEUP_TEXTS.navAlliance },
    { name: CARD_LINEUP_TEXTS.navWorld },
];

/** 按 MainTab 类型取展示配置；未配置类型返回 undefined。 */
export function mainTabItem(type: number): IMainTabItem | undefined {
    return MAIN_TAB_ITEMS[type];
}
