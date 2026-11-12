import type { BigMapModel } from './BigMapModel';
export type { IBigMapResourceView, IBigMapPlotCellView, IBigMapPlotDetailView, IBigMapCityView, IBigMapMonsterView } from './BigMapModel';

export interface IBigMapUiState {
    readonly mode: 'world' | 'base';
    readonly selectedCityId: number;
    readonly selectedMonsterId: number;
    readonly selectedPlotHexId: number;
    readonly selectedBaseHexId: number;
    readonly pendingBuildingId: number;
    readonly pendingMoveInstanceId: number;
    readonly baseActionPending: boolean;
    readonly enteringBattle: boolean;
    readonly buildMenuVisible: boolean;
    readonly campRolesVisible: boolean;
    readonly campRoleIndex: number;
    readonly pendingCampMoveId: number;
}

/** 数据消息不携带 Model、Controller 或业务回调。 */
export interface IBigMapViewState {
    readonly ui: IBigMapUiState;
    readonly world: BigMapModel['world'];
    readonly mainBuildingId: number;
    readonly playerBaseHexId: number;
    readonly playerCampId: number;
    readonly selfRoleId: string;
    readonly isServerBase: boolean;
    readonly actionRecoverSeconds: number | null;
    readonly canHarvest: boolean;
    readonly adventureChapter: number;
    readonly resourceIcons: BigMapModel['resourceIcons'];
    readonly buildingConfigs: BigMapModel['buildingConfigs'];
    readonly campConfigs: BigMapModel['campConfigs'];
    readonly territories: ReturnType<BigMapModel['territoryRegions']>;
    readonly resources: ReturnType<BigMapModel['resourceBar']>;
    readonly plots: ReturnType<BigMapModel['plotCells']>;
    readonly plotDetails: ReadonlyMap<number, NonNullable<ReturnType<BigMapModel['plotDetail']>>>;
    readonly queueNames: ReadonlyMap<number, string>;
    /** 在建格 → 建筑 id（建造中的格不在 `plots` 的建筑里，画图要靠它）。 */
    readonly queueBuildingIds: ReadonlyMap<number, number>;
    readonly collectableBuildings: ReadonlySet<number>;
    readonly buildMenu: ReturnType<BigMapModel['buildMenu']>;
    /**
     * 摆放态下「哪些空格放得下」（红绿预判）。
     *
     * 不在摆放态时恒为空数组。**只是客户端预判**：联机时以服务端回包为准。
     */
    readonly placeableHexIds: readonly number[];
    /**
     * 移建态下「哪些空格落得下」（红绿预判），用 `bigMapCanMove` 逐格判定。
     *
     * 不在移建态时恒为空数组；原格不在内（`bigMapCanMove` 对原格返回 false）。
     * 只是客户端预判：联机时以服务端回包为准。
     */
    readonly moveableHexIds: readonly number[];
    readonly queues: ReturnType<BigMapModel['queues']>;
    readonly queueUnlock: ReturnType<BigMapModel['queueUnlockInfo']>;
    readonly cities: ReadonlyMap<number, NonNullable<ReturnType<BigMapModel['cityView']>>>;
    readonly monsters: ReadonlyMap<number, NonNullable<ReturnType<BigMapModel['monsterView']>>>;
    readonly daySnapshot: ReturnType<BigMapModel['daySnapshot']>;
}

export function buildBigMapViewState(model: BigMapModel, ui: IBigMapUiState): IBigMapViewState {
    const plots = model.plotCells();
    const plotDetails = new Map<number, NonNullable<ReturnType<BigMapModel['plotDetail']>>>();
    const queueNames = new Map<number, string>();
    const queueBuildingIds = new Map<number, number>();
    for (const plot of plots) {
        const detail = model.plotDetail(plot.hexId);
        if (detail) plotDetails.set(plot.hexId, detail);
        queueNames.set(plot.hexId, model.buildingNameOfQueueAt(plot.hexId));
        queueBuildingIds.set(plot.hexId, model.buildingIdOfQueueAt(plot.hexId));
    }
    const cities = new Map(model.allCityViews().map((city) => [city.cityId, city]));
    const monsters = new Map<number, NonNullable<ReturnType<BigMapModel['monsterView']>>>();
    for (const site of model.world.monsters) {
        const monster = model.monsterView(site.instanceId);
        if (monster) monsters.set(site.instanceId, monster);
    }
    return {
        ui: { ...ui }, world: model.world, mainBuildingId: model.mainBuildingId,
        playerBaseHexId: model.playerBaseHexId, playerCampId: model.playerCampId, selfRoleId: model.selfRoleId,
        isServerBase: model.isServerBase, actionRecoverSeconds: model.actionRecoverSeconds,
        canHarvest: model.canHarvest, adventureChapter: model.adventureChapter,
        resourceIcons: model.resourceIcons, buildingConfigs: model.buildingConfigs, campConfigs: model.campConfigs,
        territories: model.territoryRegions(), resources: model.resourceBar(), plots, plotDetails, queueNames, queueBuildingIds,
        collectableBuildings: new Set(Array.from(model.buildingConfigs.keys()).filter((id) => model.canCollectBuilding(id))),
        buildMenu: model.buildMenu(), queues: model.queues(), queueUnlock: model.queueUnlockInfo(),
        // 只有摆放态才算：没选建筑时不必逐格跑 `bigMapCanPlace`（25 次规则判定白跑）。
        placeableHexIds: ui.pendingBuildingId !== 0 ? model.placeableHexIds(ui.pendingBuildingId) : [],
        // 移建态同理：逐格跑 `bigMapCanMove`，给长按拖动 / 卡片移动提供红绿落点。
        moveableHexIds: ui.pendingMoveInstanceId !== 0 ? model.moveableHexIds(ui.pendingMoveInstanceId) : [],
        cities, monsters, daySnapshot: model.daySnapshot(),
    };
}
