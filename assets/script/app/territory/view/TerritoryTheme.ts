import { Color } from 'cc';
import type { TerritorySiteType } from '../model/TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';

/**
 * 领地模块的配色真源。
 *
 *  原先散在 `TerritoryPage` 顶部的 `COLORS` 里，页面瘦身后由 `TerritoryMapView` /
 *  `TerritoryStationView` / `TerritoryHeaderView` / 详情弹窗共用 —— 放在一处，改色只改这里。
 *  （纯常量 + 纯映射函数；不持有任何节点，也不参与状态判定。）
 */

/** 页面与面板底色（暖棕木质，对齐阵容页风格）。 */
export const TERRITORY_COLORS = {
    page: new Color(46, 32, 22, 255),
    panel: new Color(74, 54, 38, 248),
    panelLight: new Color(92, 70, 48, 255),
    gold: new Color(245, 201, 92, 255),
    cream: new Color(238, 235, 214, 255),
    muted: new Color(196, 181, 160, 255),
    available: new Color(74, 138, 92, 255),
    owned: new Color(122, 158, 78, 255),
    /** 已通关（奖励已领完、没有奖励可领取）的站点底条色：区别于「可领取 available」与「已占领 owned」。 */
    cleared: new Color(43, 160, 110, 255),
    exploring: new Color(201, 138, 61, 255),
    danger: new Color(160, 67, 57, 255),
    /**
     * 「解锁状态」的底条色 —— **红**（山猫 2026-10-15 定：「关卡的解锁状态 用红色」，
     * 口径 = **所有站点类型**的不可解锁态：关卡 / 首领 / 资源点 / 异步PVP / 奖励点 / 随机格）。
     *
     * ⚠️ 与下面的 `randomConditionText` **同值** `230,30,24` —— 同一个「条件不满足」语义：
     * 底条是这个红、条上的银币消耗文字也是这个红。改一处要记得改另一处。
     */
    locked: new Color(230, 30, 24, 255),
    /**
     * 「已解锁但策划还没绑关卡」的据点底条色 —— **不跟着 `locked` 变红**。
     *
     * 它不是「没解锁」（格子已经开了），缺的是**配置**；用中性灰棕跟真正的「不可解锁」区分开，
     * 否则满屏红会把「还差条件」和「待配表」混成一件事。
     */
    unbound: new Color(107, 93, 79, 255),
    randomConditionText: new Color(230, 30, 24, 255),
    randomAvailableText: new Color(255, 255, 255, 255),
    // 🔴 原来的三个**格子底色** `mapNeutral / mapOwned / mapTarget`（米 / 绿 / 金）已于
    // 2026-10-16 删除：地图底色改成两张成品美术图二选一（未通关 `img_land_02` 泥土块 /
    // 已通关 `img_land_01` 草地块），不再靠染色区分状态 —— 成品图自带明暗，再乘色会发脏。
    // 状态表达交给「哪张地皮 + 哪个格面框」，见 `TerritoryMapView.paintHexes`。
    mapLabelText: new Color(62, 43, 30, 255),
} as const;

/**
 * 站点界面状态的命名常量（**唯一事实源**：`TerritorySiteState` 由它推导）。
 *
 * ⚠️ 禁止写 `'owned'` / `state === 'exploring'` 这类裸字面量——状态改名或拼错时
 * 字面量比较会静默失配，走本表则编译期就暴露。
 */
export const TERRITORY_STATION_STATE = {
    owned: 'owned',
    exploring: 'exploring',
    available: 'available',
    locked: 'locked',
} as const;

/** 站点在界面上的四种状态（判定在渲染层，颜色只在这里映射）。 */
export type TerritorySiteState = typeof TERRITORY_STATION_STATE[keyof typeof TERRITORY_STATION_STATE];

/** 站点底条颜色。 */
export function territoryStationTint(state: TerritorySiteState): Color {
    switch (state) {
        case TERRITORY_STATION_STATE.owned: return TERRITORY_COLORS.owned;
        case TERRITORY_STATION_STATE.exploring: return TERRITORY_COLORS.exploring;
        case TERRITORY_STATION_STATE.available: return TERRITORY_COLORS.available;
        default: return TERRITORY_COLORS.locked;
    }
}

/** 首领站点的图标底条色（比普通关卡更醒目）。 */
export function territoryBossTint(): Color {
    return TERRITORY_COLORS.danger;
}

/** 「地图上有格子、但策划还没绑定关卡」的据点：按据点类型给色，好一眼认出是哪一类待补。 */
export function territoryUnboundTint(type: TerritorySiteType): Color {
    switch (type) {
        case TERRITORY_SITE_TYPE.asyncPvp: return new Color(148, 92, 60, 255);
        case TERRITORY_SITE_TYPE.fixedResource: return new Color(167, 126, 46, 255);
        case TERRITORY_SITE_TYPE.bonus: return new Color(190, 140, 70, 255);
        default: return TERRITORY_COLORS.unbound;
    }
}
