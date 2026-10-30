import type { BigMapModel } from './BigMapModel';
export type { IBigMapPlotCellView, IBigMapPlotDetailView, IBigMapCityView, IBigMapMonsterView } from './BigMapModel';

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
}

/** 数据消息不携带 Model、Controller 或业务回调。 */
export interface IBigMapViewState {
    readonly ui: IBigMapUiState;
    readonly world: BigMapModel['world'];
    readonly mainBuildingId: number;
    readonly playerBaseHexId: number;
    readonly playerCampId: number;
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
    readonly collectableBuildings: ReadonlySet<number>;
    readonly buildMenu: ReturnType<BigMapModel['buildMenu']>;
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
    for (const plot of plots) {
        const detail = model.plotDetail(plot.hexId);
        if (detail) plotDetails.set(plot.hexId, detail);
        queueNames.set(plot.hexId, model.buildingNameOfQueueAt(plot.hexId));
    }
    const cities = new Map(model.allCityViews().map((city) => [city.cityId, city]));
    const monsters = new Map<number, NonNullable<ReturnType<BigMapModel['monsterView']>>>();
    for (const site of model.world.monsters) {
        const monster = model.monsterView(site.instanceId);
        if (monster) monsters.set(site.instanceId, monster);
    }
    return {
        ui: { ...ui }, world: model.world, mainBuildingId: model.mainBuildingId,
        playerBaseHexId: model.playerBaseHexId, playerCampId: model.playerCampId,
        isServerBase: model.isServerBase, actionRecoverSeconds: model.actionRecoverSeconds,
        canHarvest: model.canHarvest, adventureChapter: model.adventureChapter,
        resourceIcons: model.resourceIcons, buildingConfigs: model.buildingConfigs, campConfigs: model.campConfigs,
        territories: model.territoryRegions(), resources: model.resourceBar(), plots, plotDetails, queueNames,
        collectableBuildings: new Set([...model.buildingConfigs.keys()].filter((id) => model.canCollectBuilding(id))),
        buildMenu: model.buildMenu(), queues: model.queues(), queueUnlock: model.queueUnlockInfo(),
        cities, monsters, daySnapshot: model.daySnapshot(),
    };
}
