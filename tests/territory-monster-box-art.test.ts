/**
 * 巡逻宝箱（`patrolChest`）的模型图 —— 4 档闭合 / 开盖。
 *
 * 用户原话（配图 = assets 面板里 `image/territory/buildings/` 下的
 * `territory_monsterBox_L1 ~ L4`）：「**巡逻宝箱使用这边的资源**」。
 *
 * 这批是 212×212 的**建筑规格**图（与 `territory_home_v1` / `territory_fixed_resource_v1` 同规格），
 * 而详情弹窗原先取的是 `image/main/chest/boxLevel{1..4}`（100×100 的新手宝箱 UI 图，
 * 塞进面板 192×192 的 `ChestModel` 里被放大近 2 倍）⇒ 地图与弹窗两处一起换。
 *
 * 本文件钉四组：
 * ① 路径函数（4 档 + 闭合/开盖 + 脏等级夹取）；
 * ② 图真的在盘上、且是 212 正方形的建筑规格；
 * ③ 渲染分支：只有**锚点格**画、按等级取、通过后换开盖、缺图不画；
 * ④ 结构守卫：弹窗不再回到 `image/main/chest/boxLevel*`。
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assetPath, assetExists } from './helpers/asset-paths';
import { loadTerritoryMapViewClass, stationRenderWithProjection } from './helpers/territory-map-view-sandbox';
import {
    TERRITORY_MONSTER_BOX_ART_SCALE,
    TERRITORY_MONSTER_BOX_MAX_LV,
    TERRITORY_MONSTER_BOX_MIN_LV,
    territoryMonsterBoxArtPath,
} from '../assets/script/app/territory/model/TerritoryMonsterBoxSpec';

const MAIN_PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');

test('★路径函数：4 档 × 闭合 / 开盖，脏等级夹到最近一档', () => {
    for (let lv = TERRITORY_MONSTER_BOX_MIN_LV; lv <= TERRITORY_MONSTER_BOX_MAX_LV; lv += 1) {
        assert.equal(territoryMonsterBoxArtPath(lv),
            `image/territory/buildings/territory_monsterBox_L${lv}/spriteFrame`);
        assert.equal(territoryMonsterBoxArtPath(lv, true),
            `image/territory/buildings/territory_monsterBoxOpen_L${lv}/spriteFrame`);
    }
    // 等级来自服务端快照：0 / 负数 / 超上限 / 非数字都不许拼出不存在的路径。
    assert.equal(territoryMonsterBoxArtPath(0), territoryMonsterBoxArtPath(1), '0 档按 1 档画');
    assert.equal(territoryMonsterBoxArtPath(-3), territoryMonsterBoxArtPath(1));
    assert.equal(territoryMonsterBoxArtPath(9), territoryMonsterBoxArtPath(4), '越界夹到 4 档');
    assert.equal(territoryMonsterBoxArtPath(Number.NaN), territoryMonsterBoxArtPath(1));
    assert.equal(territoryMonsterBoxArtPath(2.4), territoryMonsterBoxArtPath(2), '小数四舍五入');
});

test('★★八张图都在盘上，且是 212 正方形的建筑规格（不是 UI 碎图）', () => {
    for (let lv = TERRITORY_MONSTER_BOX_MIN_LV; lv <= TERRITORY_MONSTER_BOX_MAX_LV; lv += 1) {
        for (const open of [false, true]) {
            const png = territoryMonsterBoxArtPath(lv, open).replace('/spriteFrame', '.png');
            assert.ok(assetExists(png), `缺图：${png}`);
            const meta = JSON.parse(readFileSync(assetPath(`${png}.meta`), 'utf8')) as {
                subMetas?: Record<string, { userData?: { rawWidth?: number; rawHeight?: number } }>;
            };
            const size = meta.subMetas?.f9941?.userData;
            // 212 是 `territory-page-current-json` 里登记过的两种建筑画布规格之一（128 / 212）。
            assert.equal(size?.rawWidth, 212, `${png} 画布宽应是 212（建筑规格）`);
            assert.equal(size?.rawHeight, 212, `${png} 画布高应是 212（非正方形会被 CUSTOM 拉伸）`);
        }
    }
});

interface IPatrolRenderOptions {
    readonly lv?: number;
    readonly passed?: boolean;
    readonly patrolId?: number | null;
    readonly art?: Record<string, unknown>;
}

/** 跑一次真实 `stationRenderOf`（站点状态由发布帧投影算出，不手写）。 */
function renderPatrol(options: IPatrolRenderOptions = {}): Record<string, unknown> {
    const MapView = loadTerritoryMapViewClass() as new () => {
        stationRenderOf: (site: unknown, input: unknown) => Record<string, unknown>;
    };
    const view = new MapView();
    const cellId = 401;
    const site = {
        id: 'patrolChest_1',
        type: 'patrolChest',
        cellId,
        battleId: 60001,
        patrolId: options.patrolId === undefined ? 50021 : options.patrolId ?? undefined,
        buildingId: '69021',
        unlock: { silverCost: 10, staminaCost: 5 },
    };
    const art = options.art ?? {
        patrolChestFrames: new Map([1, 2, 3, 4].map(lv => [lv, `closed-L${lv}`])),
        patrolChestOpenFrames: new Map([1, 2, 3, 4].map(lv => [lv, `open-L${lv}`])),
        // 体量倍率由 `TerritoryPageAssets` 随 art 一起透传（视图不 import 那份常量）。
        patrolChestIconScale: TERRITORY_MONSTER_BOX_ART_SCALE,
    };
    const input = {
        map: { id: 'monster_box_art', sites: [site] },
        stageByCell: new Map(),
        art,
        wallet: { silver: 999, stamina: 999 },
        siteOpenableCells: [],
        pendingFixedResourceCells: [],
        monsterBoxes: options.lv === undefined ? [] : [{ cellId, lv: options.lv }],
        patrolPassedCells: options.passed ? new Set([cellId]) : new Set<number>(),
        progress: {
            isCellUnlocked: () => true,
            isOwned: () => options.passed === true,
            isAreaPassed: () => false,
            isDisabled: () => false,
            explorationAt: () => null,
            checkUnlock: () => ({ ok: true }),
        },
    };
    return stationRenderWithProjection(view)(site, input);
}

test('★★★锚点格按等级取模型：未通过闭合、通过换开盖、快照没到按 1 档', () => {
    assert.equal(renderPatrol({ lv: 3 }).icon, 'closed-L3', '等级 3 的巡逻宝箱应画 L3 闭合图');
    assert.equal(renderPatrol({ lv: 3, passed: true }).icon, 'open-L3',
        '本片通过后换开盖版（同等级，不换档位）');
    assert.equal(renderPatrol({ lv: 3 }).iconScale, TERRITORY_MONSTER_BOX_ART_SCALE,
        '巡逻宝箱要按共用倍率缩小一档（开盖版可见高 91.6 会顶满 90 的格面）');
    assert.equal(renderPatrol({ lv: 4, passed: true }).icon, 'open-L4');
    assert.equal(renderPatrol({ lv: 1 }).icon, 'closed-L1');
    assert.equal(renderPatrol({}).icon, 'closed-L1',
        '服务端快照还没到（lv=0）按 1 档画 —— 别让锚点格空着等数据');
});

test('★★兄弟格不画宝箱；缺图 / 老夹具不传表都不阻断', () => {
    // 一片巡逻区 4~8 格：只有带 `patrolId` 的那格是锚点。
    assert.equal(renderPatrol({ lv: 2, patrolId: null }).icon, null,
        '没有 patrolId 的兄弟格不许长箱子（会长出一排）');
    // 美术缺这一档 ⇒ 只是这一格不画，不是报错路径。
    const partial = {
        patrolChestFrames: new Map([[1, 'closed-L1']]),
        patrolChestOpenFrames: new Map<number, string>(),
    };
    assert.equal(renderPatrol({ lv: 3, art: partial }).icon, null, '这一档没图 ⇒ 不画');
    assert.equal(renderPatrol({ lv: 1, art: partial }).icon, 'closed-L1', '有图的档位照画');
    assert.equal(renderPatrol({ lv: 3, art: {} }).icon, null, '老夹具不传这两张表 ⇒ 退回「不画宝箱」');
});

test('★结构守卫：弹窗与地图共用同一套图，弹窗不再读 image/main/chest', () => {
    assert.match(MAIN_PAGE_SRC, /territoryMonsterBoxArtPath\(lv\)/,
        '巡逻宝箱弹窗的模型图要走 model 的路径函数');
    // 🔴 反向断言必须**剥注释**（规则 104）：旧路径正写在「原先取 boxLevel」的说明注释里，
    // 不剥的话这条会被自己的文档绊倒。
    const code = MAIN_PAGE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /image\/main\/chest\/boxLevel/,
        'image/main/chest/boxLevel* 是新手宝箱那套 100×100 UI 图，不许回流');
    // 地图侧：4 档表由 `TerritoryPageAssets` 加载，视图只取不拼路径。
    assert.match(MAP_VIEW_SRC, /private patrolChestIconOf\(/);
    assert.match(MAP_VIEW_SRC, /input\.patrolPassedCells\?\.has\(site\.cellId\) \?\? station\.owned/,
        '通过判据必须用片区口径 patrolPassedCells（不是逐格 owned）');
});
