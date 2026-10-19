import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap, getZCMapSection, ZC_ENEMY_HOME_ID, ZC_HEX_CONFIG, ZC_INITIAL_TERRITORY,
    ZC_MAP_ART, ZC_MAP_CITY_MODE, ZC_MAP_COLUMNS, ZC_MAP_HOMES, ZC_MAP_ID, ZC_MAP_PLAYER_COUNT,
    ZC_MAP_ROWS, ZC_PLAYER_HOME_ID, ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

/**
 * 编辑器 ↔ 客户端的地图契约对账。
 *
 * 两份来源都必须被游戏侧解析器吃下去：
 *   1. `tools/map-editor/presets/*.json` —— 编辑器当前预设库（v1/v2 存量 + 之后的 v3）；
 *   2. `tests/fixtures/zcds-map-v3-*.json` —— 编辑器实际产出的 v3 快照（由 CDP 探针导出后固化）。
 */
const legacyLayout = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout;
const fixture = (name: string): ZCMapLayout => (
    JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8')) as ZCMapLayout
);

/** 分区号按象限编码：1 = 下左、2 = 上左、3 = 下右、4 = 上右。 */
const sectionAt = (row: number, column: number): number => getZCMapSection(row * ZC_MAP_COLUMNS + column);

test('编辑器预设库里的每一张都能被游戏侧解析器载入', () => {
    const names = readdirSync('tools/map-editor/presets').filter((name) => name.endsWith('.json'));
    assert.ok(names.length > 1, '预设库里应该有地图');
    try {
        for (const name of names) {
            const source = JSON.parse(readFileSync(`tools/map-editor/presets/${name}`, 'utf8')) as ZCMapLayout;
            configureZCMap(source);
            assert.equal(ZC_MAP_PLAYER_COUNT, source.playerCount ?? 2, name);
            assert.equal(ZC_MAP_CITY_MODE, source.cityMode ?? 'fixed', name);
            assert.equal(ZC_MAP_ROWS, source.rows, name);
            assert.equal(ZC_MAP_COLUMNS, source.columns, name);
        }
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('战斗地图预设包含可自选主城的河道地图', () => {
    const selectRiver = JSON.parse(readFileSync('tools/map-editor/presets/select_river.json', 'utf8')) as ZCMapLayout;
    assert.equal(selectRiver.id, 'select_river');
    assert.equal(selectRiver.cityMode, 'select');
    assert.equal(selectRiver.playerCount, 2);
    assert.equal('homes' in selectRiver, false);
});

test('编辑器产出的 2 人镜像图：上下对折、双方各半', () => {
    const source = fixture('zcds-map-v3-2p');
    configureZCMap(source);
    try {
        assert.equal(ZC_MAP_PLAYER_COUNT, 2);
        assert.equal(ZC_MAP_CITY_MODE, 'fixed');
        assert.equal(ZC_MAP_ID, 'zcds-map-v3-2p');
        assert.equal(sectionAt(1, 1), 2);
        assert.equal(sectionAt(ZC_MAP_ROWS - 2, 1), 1);
        const playable = ZC_HEX_CONFIG.filter((hex) => hex.playable);
        assert.equal(playable.filter((hex) => getZCMapSection(hex.id) === 1).length * 2, playable.length);
        assert.ok(playable.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].row === ZC_MAP_ROWS - 1 - hex.row));
        assert.ok(playable.every((hex) => ZC_HEX_CONFIG[hex.mirrorId].column === hex.column));
        assert.equal(ZC_MAP_HOMES.length, 2);
        assert.equal(ZC_MAP_HOMES[0], ZC_PLAYER_HOME_ID);
        assert.equal(ZC_MAP_HOMES[1], ZC_ENEMY_HOME_ID);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('编辑器产出的 4 人四象限图：分区按象限落位、主城各自在本区', () => {
    const source = fixture('zcds-map-v3-4p');
    configureZCMap(source);
    try {
        assert.equal(ZC_MAP_PLAYER_COUNT, 4);
        assert.equal(ZC_MAP_COLUMNS % 2, 0, '四象限镜像要求偶数列，否则中线列会自镜像');
        assert.equal(sectionAt(1, 1), 2);
        assert.equal(sectionAt(1, ZC_MAP_COLUMNS - 2), 4);
        assert.equal(sectionAt(ZC_MAP_ROWS - 2, 1), 1);
        assert.equal(sectionAt(ZC_MAP_ROWS - 2, ZC_MAP_COLUMNS - 2), 3);

        assert.equal(ZC_MAP_HOMES.length, 4);
        ZC_MAP_HOMES.forEach((id, index) => {
            assert.equal(getZCMapSection(id), index + 1, `第 ${index + 1} 区主城必须落在本区`);
            const row = Math.floor(id / ZC_MAP_COLUMNS);
            const upper = ((index) & 1) === 1;
            assert.equal(upper, row < Math.floor(ZC_MAP_ROWS / 2), `第 ${index + 1} 区主城必须在中线己方一侧`);
        });

        // 四象限同时开上下 + 左右：mirrorId 是对角格，分区按 1↔4 / 2↔3 成对。
        for (const hex of ZC_HEX_CONFIG) {
            const mirror = ZC_HEX_CONFIG[hex.mirrorId];
            assert.equal(mirror.row, ZC_MAP_ROWS - 1 - hex.row);
            assert.equal(mirror.column, ZC_MAP_COLUMNS - 1 - hex.column);
            const section = getZCMapSection(hex.id);
            const partner = getZCMapSection(mirror.id);
            assert.equal(partner, section === 0 ? 0 : ((section - 1) ^ 3) + 1);
        }

        // 开局领地 = 1 区（玩家视角的己方）格数，4 人图里是整图的 1/4。
        const sectionOne = ZC_HEX_CONFIG.filter((hex) => hex.playable && getZCMapSection(hex.id) === 1).length;
        assert.equal(sectionOne, ZC_INITIAL_TERRITORY);
        assert.equal(sectionOne * 4, ZC_HEX_CONFIG.filter((hex) => hex.playable).length);
    } finally {
        configureZCMap(legacyLayout);
    }
});

test('编辑器产出的 4 人自选主城图：不产出主城坐标，镜像与分区仍成立', () => {
    const source = fixture('zcds-map-v3-select');
    configureZCMap(source);
    try {
        assert.equal(ZC_MAP_PLAYER_COUNT, 4);
        assert.equal(ZC_MAP_CITY_MODE, 'select');
        assert.equal(ZC_PLAYER_HOME_ID, -1);
        assert.equal(ZC_ENEMY_HOME_ID, -1);
        assert.equal(ZC_MAP_HOMES.length, 0);
        assert.equal(countSections(), 4);
    } finally {
        configureZCMap(legacyLayout);
    }
});

/**
 * 编辑器的默认底图是「全中立格 + 各方主城盘」（清空重画 / 3 人图改尺寸都走它）。
 * 本作地图的中立格占比很高，所以必须证明这种底图客户端吃得下：能载入、中立格可通行、
 * 开局领地恰好就是那 7 格主城盘 —— 而不是"编辑器里画得出来、进游戏崩"。
 */
test('编辑器清空重画产出的全中立底图：除主城盘外全是中立格，开局领地等于主城盘', () => {
    for (const name of ['zcds-map-v3-neutral-2p', 'zcds-map-v3-neutral-3p']) {
        const source = fixture(name);
        const players = source.playerCount ?? 2;
        configureZCMap(source);
        try {
            const playable = ZC_HEX_CONFIG.filter((hex) => hex.playable);
            const neutral = playable.filter((hex) => getZCMapSection(hex.id) === 0);
            assert.equal(playable.length, source.rows * source.columns, name + '：默认底图不该有虚空');
            assert.equal(neutral.length, playable.length - 7 * players,
                name + '：除各方主城盘（各 7 格）外应全是中立格');
            assert.equal(ZC_INITIAL_TERRITORY, 7, name + '：开局领地应等于本方主城盘 7 格');
            assert.equal(ZC_MAP_HOMES.length, players, name + '：每方都要有一座主城');
            ZC_MAP_HOMES.forEach((id, index) => {
                assert.equal(getZCMapSection(id), index + 1, `${name}：第 ${index + 1} 区主城必须落在本区`);
            });
        } finally {
            configureZCMap(legacyLayout);
        }
    }
});

test('编辑器产出的自由装饰由客户端保留，且不改变地形与分区', () => {
    const source = fixture('zcds-map-v3-decor');
    configureZCMap(source);
    try {
        assert.equal(ZC_MAP_ART.freeDecor?.length, 2);
        assert.ok(ZC_MAP_ART.freeDecor?.every((item) => item.art.startsWith('image/decor/')));
        assert.equal(Object.keys(ZC_MAP_ART.tiles ?? {}).some((key) => /^\d+,\d+$/.test(key)), false);
        assert.ok(ZC_HEX_CONFIG.some((hex) => !hex.playable), '这张图应该有虚空格');
        assert.equal(ZC_MAP_HOMES.length, 4);
    } finally {
        configureZCMap(legacyLayout);
    }
});

/** 图里实际出现的分区种类数（0 不算），用于确认 4 人图没有塌成 2 人。 */
function countSections(): number {
    const seen = new Set<number>();
    for (let id = 0; id < ZC_HEX_CONFIG.length; id += 1) {
        const section = getZCMapSection(id);
        if (section > 0) seen.add(section);
    }
    return seen.size;
}
