/** Minimal event payloads for view-only tests; no live model is exposed. */
export function bigMapViewStateFixture(fields: Record<string, any> = {}) {
    const data = { ui: { mode: 'world', selectedCityId: -1, selectedMonsterId: -1,
        selectedPlotHexId: -1, selectedBaseHexId: -1, pendingBuildingId: 0, pendingMoveInstanceId: 0,
        baseActionPending: false, enteringBattle: false, buildMenuVisible: false,
        campRolesVisible: false, campRoleIndex: 0, pendingCampMoveId: 0 },
        plots: [], queueNames: new Map(), queueBuildingIds: new Map(), plotDetails: new Map(),
        cities: new Map(), monsters: new Map(),
        territories: [], resources: [], buildMenu: [], queues: [], collectableBuildings: new Set(),
        placeableHexIds: [], moveableHexIds: [], buildingConfigs: new Map(), ...fields };
    return data;
}

/**
 * 建筑详情的最小夹具 —— **`IBigMapPlotDetailView` 加字段时只改这里**。
 *
 * 2026-11-11 加产量 / 前置 / 缺料那批字段时踩过：`bigmap-move.test.ts` 里手搓了一份
 * 老对象，`formatBigMapPlotDetail` 读 `detail.preBuild.filter` 直接崩在运行时。
 * 手搓 detail 的用例一律走本工厂，新增字段在这里补默认值。
 */
export function bigMapPlotDetailFixture(fields: Record<string, any> = {}) {
    return {
        name: '粮食田', buildingId: 71002, instanceId: 1, level: 1, targetLevel: 2, stored: 0,
        costGrain: 0, costWood: 0, costIron: 0, buildTime: 0, canUpgrade: true, reason: '',
        queueSlotIndex: -1, remainSeconds: 0, progress: 0,
        produceNow: 0, produceNext: 0, produceCap: 0, resType: '', storedRatio: 0,
        attrBonus: 0, instantCost: 0, preBuild: [], missing: [], ...fields,
    };
}
