import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap, ZC_ENEMY_HOME_ID, ZC_HEX_CONFIG, ZC_MAP_CITY_MODE, ZC_MAP_HOMES,
    ZC_MAP_PLAYER_COUNT, ZC_PLAYER_HOME_ID, ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import {
    resolveZCMapZoom, ZC_MAP_ZOOM_MAX, ZC_MAP_ZOOM_MIN,
} from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { assetPath } from './helpers/asset-paths';

//  `captureZCMatchConfig()` 的默认分支会读全局 PVP 表，先按 tests/zcds-neutral-map.test.ts 的口径装载。
const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
] as const;
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

/** 地图目录只在 ZCGame.ts 里定义一次，这里读回来，避免路径在两处漂移。 */
const MAP_DIRECTORY = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8')
    .match(/MAP_DIRECTORY = '([^']+)'/)![1];
const legacyLayout = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout;

/** 与 tests/zcds-neutral-map.test.ts 同一张几何：8 行 × 6 列、上下镜像、四角虚空。 */
const BASE_ASCII = ['NNNNNN', '######', '######', '.####.'];
function mapLayout(overrides: Partial<ZCMapLayout> = {}): ZCMapLayout {
    return {
        id: 'declaration-test', version: 2, rows: 8, columns: 6,
        mirrorVertical: true, ascii: [...BASE_ASCII],
        playerHome: { row: 6, column: 2 }, enemyHome: { row: 1, column: 2 },
        ...overrides,
    };
}
/** 自选主城模式：地图不产出主城坐标。 */
function selectLayout(overrides: Partial<ZCMapLayout> = {}): ZCMapLayout {
    return mapLayout({ cityMode: 'select', playerHome: undefined, enemyHome: undefined, ...overrides });
}

/**
 * 多人地图（v3）：8×8 全图存储、不开镜像压缩，四象限式分区。
 * 分区号按象限编码 1=下左 / 2=上左 / 3=下右 / 4=上右，3 人图只用 1~3。
 */
const MULTI_ASCII = {
    3: [
        '22223322', '22223322', '22223322', '22223322',
        '11113311', '11113311', '11113311', '11113311',
    ],
    4: [
        '22224444', '22224444', '22224444', '22224444',
        '11113333', '11113333', '11113333', '11113333',
    ],
};
const MULTI_HOMES = {
    3: [{ row: 6, column: 1 }, { row: 1, column: 1 }, { row: 6, column: 4 }],
    4: [{ row: 6, column: 1 }, { row: 1, column: 1 }, { row: 6, column: 6 }, { row: 1, column: 6 }],
};
function multiLayout(count: 3 | 4, overrides: Partial<ZCMapLayout> = {}): ZCMapLayout {
    return {
        id: `multi-${count}`, version: 3, rows: 8, columns: 8,
        mirrorVertical: false, mirrorHorizontal: false, mirror180: false,
        playerCount: count, cityMode: 'fixed',
        ascii: [...MULTI_ASCII[count]], homes: MULTI_HOMES[count].map((home) => ({ ...home })),
        ...overrides,
    };
}

test('对局人数与主城模式缺省时按 2 人 / 固定主城处理', () => {
    configureZCMap(mapLayout());
    try {
        assert.equal(ZC_MAP_PLAYER_COUNT, 2);
        assert.equal(ZC_MAP_CITY_MODE, 'fixed');
        assert.equal(ZC_PLAYER_HOME_ID, 6 * 6 + 2);
        assert.equal(ZC_ENEMY_HOME_ID, 1 * 6 + 2);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('对局人数 2 / 3 / 4 都能载入并原样透传', () => {
    try {
        configureZCMap(mapLayout());
        assert.equal(ZC_MAP_PLAYER_COUNT, 2);
        assert.ok(ZC_PLAYER_HOME_ID >= 0, '2 人固定主城模式仍应产出主城');
        for (const count of [3, 4] as const) {
            configureZCMap(multiLayout(count));
            assert.equal(ZC_MAP_PLAYER_COUNT, count);
            assert.equal(ZC_MAP_CITY_MODE, 'fixed');
            assert.equal(ZC_MAP_HOMES.length, count);
            assert.ok(ZC_MAP_HOMES.every((id) => id >= 0), `${count} 人固定主城模式仍应产出主城`);
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('非法的对局人数与主城模式被拒绝，且不污染地图状态', () => {
    configureZCMap(multiLayout(4));
    try {
        for (const bad of [0, 1, 5, 100, 2.5, -2, '3' as unknown as number]) {
            assert.throws(() => configureZCMap(mapLayout({ playerCount: bad })), /对局人数/, `playerCount=${String(bad)}`);
        }
        assert.throws(() => configureZCMap(mapLayout({ cityMode: 'auto' as unknown as 'fixed' })), /主城模式/);
        // 上面每次都是抛在赋值之前，已载入的那张 4 人图不应被改坏。
        assert.equal(ZC_MAP_PLAYER_COUNT, 4);
        assert.equal(ZC_MAP_CITY_MODE, 'fixed');
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('自选主城地图不产出主城坐标，校验与镜像配对仍成立', () => {
    configureZCMap(selectLayout());
    try {
        assert.equal(ZC_MAP_CITY_MODE, 'select');
        assert.equal(ZC_MAP_PLAYER_COUNT, 2);
        assert.equal(ZC_PLAYER_HOME_ID, -1);
        assert.equal(ZC_ENEMY_HOME_ID, -1);
        const playable = ZC_HEX_CONFIG.filter((hex) => hex.playable);
        assert.equal(playable.length, 8 * 6 - 4);
        // 没有主城锚点时按几何镜像配对：上下镜像 + 列不变。
        assert.ok(playable.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].row === 7 - hex.row));
        assert.ok(playable.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].column === hex.column));
        assert.ok(playable.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].mirrorId === hex.id));
        // 阵营仍按字符画分：上半敌方、下半我方，各 16 格。
        assert.equal(playable.filter((hex) => hex.row < 4).length, playable.filter((hex) => hex.row >= 4).length);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('自选主城模式下即使带着主城坐标也按无主城处理', () => {
    configureZCMap(mapLayout({ cityMode: 'select' }));
    try {
        assert.equal(ZC_MAP_CITY_MODE, 'select');
        assert.equal(ZC_PLAYER_HOME_ID, -1);
        assert.equal(ZC_ENEMY_HOME_ID, -1);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('自选主城地图不能直接进入对局，必须先完成选点', () => {
    configureZCMap(selectLayout());
    try {
        assert.throws(() => captureZCMatchConfig(), /自选主城/);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('固定主城地图的开局配置带上人数与主城模式', () => {
    configureZCMap(multiLayout(4));
    try {
        const match = captureZCMatchConfig();
        assert.equal(match.map.playerCount, 4);
        assert.equal(match.map.cityMode, 'fixed');
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('地图目录里的每一张都在声明层可用，缺省为 2 人 / 固定主城', () => {
    const directory = assetPath(`${MAP_DIRECTORY}`);
    const names = readdirSync(directory).filter((name) => name.endsWith('.json'));
    assert.ok(names.length > 1);
    try {
        for (const name of names) {
            const source = JSON.parse(readFileSync(`${directory}/${name}`, 'utf8')) as ZCMapLayout;
            configureZCMap(source);
            assert.equal(ZC_MAP_PLAYER_COUNT, source.playerCount ?? 2, name);
            assert.equal(ZC_MAP_CITY_MODE, source.cityMode ?? 'fixed', name);
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});

/**
 * R22「【战斗】相机」第 1 条：`局内战斗的支持地图缩放（每个地图配置对应的最大和最小倍率`。
 *
 * 判据分三层：
 *  ① `resolveZCMapZoom` 的缺省与纠错口径（缺省 0.6/1.2、只配一半另一半走默认、
 *     越界 / 非数字 / 上下限颠倒**抛错不静默夹取**）；
 *  ② `configureZCMap` 把区间写进运行时绑定，`captureZCMatchConfig` 再带进本局快照
 *     —— 中间任何一环漏了，HUD 那边拿到的就是默认值，地图配的倍率静默失效；
 *  ③ 地图目录里的每一张都能过这一关（配错了在这个用例里当场炸，而不是开局才炸）。
 */
test('★★地图自己的镜头倍率区间：缺省 0.6/1.2，越界就抛，并经单局快照交给相机', () => {
    // ① 纯函数口径
    assert.deepEqual(resolveZCMapZoom(undefined), { min: 0.6, max: 1.2 }, '没配就走缺省');
    assert.deepEqual(resolveZCMapZoom({}), { min: 0.6, max: 1.2 });
    assert.deepEqual(resolveZCMapZoom({ zoomMin: 0.4 }), { min: 0.4, max: 1.2 }, '只配一半，另一半走默认');
    assert.deepEqual(resolveZCMapZoom({ zoomMax: 1.4 }), { min: 0.6, max: 1.4 });
    assert.deepEqual(resolveZCMapZoom({ zoomMin: 0.3, zoomMax: 1.5 }), { min: 0.3, max: 1.5 }, '硬边界本身应放行');
    // 越界 / 非数字 / 上下限颠倒：**抛**，不夹 —— 静默夹取会让"配错了"这件事从表现上看不出来。
    assert.throws(() => resolveZCMapZoom({ zoomMin: 0.2 }), /zoomMin/, '低于硬下界应抛');
    assert.throws(() => resolveZCMapZoom({ zoomMax: 1.6 }), /zoomMax/, '高于硬上界应抛');
    assert.throws(() => resolveZCMapZoom({ zoomMin: '0.8' as unknown as number }), /必须是数字/, '字符串应抛');
    assert.throws(() => resolveZCMapZoom({ zoomMin: NaN }), /必须是数字/, 'NaN 应抛');
    assert.throws(() => resolveZCMapZoom({ zoomMin: Infinity }), /必须是数字/, 'Infinity 应抛');
    assert.throws(() => resolveZCMapZoom({ zoomMin: 1.1, zoomMax: 0.9 }), /下限.*大于上限/, '上下限颠倒应抛');

    // ② 真的配到地图上 → 写进运行时 → 进本局快照
    configureZCMap(mapLayout({ zoomMin: 0.45, zoomMax: 1.35 }));
    try {
        assert.equal(ZC_MAP_ZOOM_MIN, 0.45);
        assert.equal(ZC_MAP_ZOOM_MAX, 1.35);
        const match = captureZCMatchConfig();
        assert.equal(match.map.zoomMin, 0.45, '★快照必须带上地图自己的下限，否则 HUD 只会用默认值');
        assert.equal(match.map.zoomMax, 1.35, '★快照必须带上地图自己的上限');
    } finally {
        configureZCMap(legacyLayout);
    }
    // 没配的地图落回缺省（不是上一张图的残留 —— `configureZCMap` 每次都重算）。
    try {
        const match = captureZCMatchConfig();
        assert.equal(match.map.zoomMin, 0.6);
        assert.equal(match.map.zoomMax, 1.2);
    } finally {
        configureZCMap(legacyLayout);
    }

    // ③ 地图目录里的每一张都过得了这一关
    const directory = assetPath(`${MAP_DIRECTORY}`);
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
        const source = JSON.parse(readFileSync(`${directory}/${name}`, 'utf8')) as ZCMapLayout;
        assert.doesNotThrow(() => resolveZCMapZoom(source), `${name} 的镜头倍率配置不合法`);
    }
});
