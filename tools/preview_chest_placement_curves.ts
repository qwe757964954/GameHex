/**
 * 开箱落位采样器（离线验收用，与 `tools/preview_chest_placement.py` 配对）。
 *
 * 真源 = `model/TerritoryChestAnimation`：这里只把「改前 / 改后」两套缩放与补偿算出来写成 JSON，
 * Python 那边不重算公式，只负责贴图 —— 图与运行时看到的是同一套数。
 *
 *   npx tsx tools/preview_chest_placement_curves.ts
 *
 * 产物：`docs/.tmp-chest-placement.json`
 */
import { writeFileSync } from 'node:fs';
import {
    TERRITORY_CHEST_ART_METRICS,
    territoryChestPlacement,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';

/**
 * 地图上静止宝箱的可见宽 —— 与 `TerritoryStationView.BUILDING_VISIBLE_WIDTH` 同值。
 * 那个模块 import 了 `cc`，node 里跑不起来，所以这里抄一份；两边一致性由
 * `tests/territory-chest-placement.test.ts` 直接从源码里抠出来比对。
 */
const BUILDING_VISIBLE_WIDTH = 84;
/** 改前：按画布高归一到 132（`CHEST_VISIBLE_HEIGHT`，已退役）。 */
const LEGACY_VISIBLE_HEIGHT = 132;
/** 站点 `Icon` 节点尺寸（`TerritoryStation.prefab` 的 128×128）。 */
const STATION_ICON_NODE_SIZE = 128;

const metrics = TERRITORY_CHEST_ART_METRICS;
const before = {
    scale: LEGACY_VISIBLE_HEIGHT / metrics.canvasHeight,
    offsetX: 0,
    offsetY: 0,
};
const after = territoryChestPlacement(metrics, BUILDING_VISIBLE_WIDTH, metrics.canvasWidth, metrics.canvasHeight);

const payload = {
    metrics,
    stationIconNodeSize: STATION_ICON_NODE_SIZE,
    targetVisibleWidth: BUILDING_VISIBLE_WIDTH,
    before,
    after,
};
writeFileSync('docs/.tmp-chest-placement.json', JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify(payload, null, 2));
