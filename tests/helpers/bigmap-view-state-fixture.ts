/** Minimal event payloads for view-only tests; no live model is exposed. */
export function bigMapViewStateFixture(fields: Record<string, any> = {}) {
    const data = { ui: { mode: 'world', selectedCityId: -1, selectedMonsterId: -1,
        selectedPlotHexId: -1, selectedBaseHexId: -1, pendingBuildingId: 0, pendingMoveInstanceId: 0,
        baseActionPending: false, enteringBattle: false, buildMenuVisible: false },
        plots: [], queueNames: new Map(), plotDetails: new Map(), cities: new Map(), monsters: new Map(),
        territories: [], resources: [], buildMenu: [], queues: [], collectableBuildings: new Set(), ...fields };
    return data;
}
