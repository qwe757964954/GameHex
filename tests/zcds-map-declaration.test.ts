import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap, ZC_ENEMY_HOME_ID, ZC_HEX_CONFIG, ZC_MAP_CITY_MODE, ZC_MAP_HOMES,
    ZC_MAP_PLAYER_COUNT, ZC_PLAYER_HOME_ID, ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

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
    const directory = `assets/resources/${MAP_DIRECTORY}`;
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
