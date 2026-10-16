import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { HEX_FLIP_PULSE_ART_ROOT, HEX_GROUND_GLOW_ART_ROOT } from '../assets/script/app/ArtPaths';

test('建筑 prefab 不保留已删除的固定兵营/防御塔帧，城墙 prefab 使用现有墙砖', () => {
    const revealPrefab = readFileSync('assets/resources/ui/game/ZCGameCardReveal.prefab', 'utf8');
    const hexPrefab = readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8');
    for (const source of [revealPrefab, hexPrefab]) {
        assert.equal(source.includes('barracksFrame'), false);
        assert.equal(source.includes('towerFrame'), false);
    }

    const wallPrefab = readFileSync('assets/resources/ui/game/ZCGameWall.prefab', 'utf8');
    const downMeta = JSON.parse(readFileSync('assets/resources/image/walls/down.png.meta', 'utf8')) as { uuid: string };
    assert.ok(wallPrefab.includes(`${downMeta.uuid}@f9941`), 'ZCGameWall 应绑定现有 down 墙砖作为加载兜底');
});

test('对局流程在进入前准备地图、配置和全部首屏 Prefab', async () => {
    const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const source = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    /** 地图目录只在 ZCGame.ts 里定义一次，这里读回来，避免路径在两处漂移。 */
    const mapDirectory = gameSource.match(/MAP_DIRECTORY = '([^']+)'/)![1];
    /** 建筑外观目录在 Loader 里定义一次，同样读回来，避免路径在测试里漂移。 */
    const buildingDirectory = source.match(/BUILDING_DIRECTORY = '([^']+)'/)![1];
    /** 城墙砖目录同理（WALL_TILE_DIRECTORY）。 */
    const wallDirectory = source.match(/WALL_TILE_DIRECTORY = '([^']+)'/)![1];
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const loadedPrefabs: string[] = [];
    const loadedDirectories: string[] = [];
    const configuredMaps: string[] = [];
    let pvpTablesLoaded = false;
    let deckUnitsChecked = false;

    class Prefab { constructor(public readonly path: string) {} }
    class SpriteFrame { constructor(public readonly name: string) {} }
    class EffectAsset {}
    class Material { initialize(): void {} }
    const assetService = {
        load: async (path: string, _type: unknown) => {
            loadedPrefabs.push(path);
            return new Prefab(path);
        },
        loadDir: async (path: string, _type: unknown) => {
            loadedDirectories.push(path);
            // 建筑外观目录返回假 SpriteFrame（带 name）；地图目录返回带 json 的地图资产。
            if (path === buildingDirectory) {
                return [new SpriteFrame('hq-base'), new SpriteFrame('barracks-peashooter')];
            }
            // 城墙砖目录返回 4 方向假 SpriteFrame。
            if (path === wallDirectory) {
                return ['up', 'down', 'rightUp', 'rightDown'].map((name) => new SpriteFrame(name));
            }
            return [{ name: 'preloaded-map', json: { id: 'preloaded-map' } }];
        },
    };
    const cc = {
        JsonAsset: class {}, Prefab, SpriteFrame, EffectAsset, Material,
    };
    const definitions = [
        // `empoweredProfile` = 强化那一击的技能行（普攻 / 技能双链）。漏收它的 prefab，
        // 运行时 `ZCGameRenderWorld` 按 `event.effectPrefabPath` 查表会落空 → 技能特效永远不出现。
        { unitId: '1036', prefabPath: 'units/militia', attackProfile: { effectPrefabPath: 'effects/slash' }, empoweredProfile: { effectPrefabPath: 'effects/empowered' } },
        { unitId: '1001', prefabPath: 'units/archer', attackProfile: { effectPrefabPath: 'effects/arrow' } },
    ];
    const configService = {
        initialize: async () => {},
        getTable: async (name: string) => [{ name }],
    };
    const dependencies: Record<string, unknown> = {
        cc,
        '../../ArtPaths': {
            decorFramePath: (name: string) => `image/decor/${name}/spriteFrame`,
            // 神器图标走它拼 `image/artifact/<icon>/spriteFrame`（png 是 SpriteFrame 子资源）。
            spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`,
            // 地块底部发光序列帧的目录。**必须透传真值**：漏给这个符号时 loader 侧拿到
            // `undefined`，`loadDir(undefined)` 会让下面的目录清单多出一个 `undefined` 项 ——
            // 症状就是「多出一项 undefined」而不是报错，很难看出是桩缺符号（2026-10-14 修）。
            HEX_GROUND_GLOW_ART_ROOT,
            HEX_FLIP_PULSE_ART_ROOT,
        },
        './ZCGuideLoader': {
            ZCGuideLoader: class {
                async prepare() {
                    return { entries: [], params: {}, iconFrames: new Map() };
                }
            },
        },
        '../model/ZCCombatCatalog': {
            getAllUnitDefinitions: () => {
                assert.equal(pvpTablesLoaded, true, '单位表现资源必须在数值表注入后解析');
                return definitions;
            },
        },
        '../model/ZCModifierRuntime': {
            getZCModifierCatalogs: () => ({ adapters: { textOverrides: new Map() } }),
        },
        '../model/ZCGameModel': {
            configureZCMap: (map: { id: string }) => configuredMaps.push(map.id),
            // `loadRandomMap` 的随机池判据（新增依赖，桩里缺符号会在调用时抛 TypeError）。
            getZCLocalPlayerCountOverride: () => null,
            isRandomMapCandidate: (layout: { playerCount?: number; cityMode?: string } | null) => {
                const count = layout?.playerCount ?? 2;
                return (count === 2 || count === 3 || count === 4)
                    && (layout?.cityMode === undefined || layout.cityMode === 'fixed' || layout.cityMode === 'select');
            },
        },
        '../model/ZCGameRuntimeConfig': {
            loadPvpTables: () => { pvpTablesLoaded = true; },
            // 跨表引用闸：必须在数值表注入之后跑（卡 → 单位 的完整性依赖已注入的卡组/单位目录）
            assertDeckUnitsPlayable: () => {
                assert.equal(pvpTablesLoaded, true, '引用了不可上场单位的检查必须在表注入之后');
                deckUnitsChecked = true;
            },
            // `loadArtifactIconFrame` 用它取神器图标名（真源 = `pvpArtifact` 第一行的 `icon`）。
            getPvpRuntimeRules: () => ({ artifactIcon: '霜封冰刃' }),
        },
        '../model/ZCMatchConfig': {
            captureZCMatchConfig: (_source: unknown, options: { allowUnresolvedSelect?: boolean }) => {
                assert.equal(pvpTablesLoaded, true, '配置快照必须在 PVP 表注入后创建');
                assert.equal(configuredMaps.at(-1), 'preloaded-map', '快照必须包含本次加载的地图');
                assert.equal(options.allowUnresolvedSelect, true);
                return { map: { id: 'preloaded-map', cityMode: 'fixed' }, configHash: 'loader-snapshot' };
            },
        },
    };
    const context = {
        exports: {} as { ZCGameLoader: new (assets: unknown, configs: unknown, mapDirectory: string) => { prepare(): Promise<any> } },
        require: (name: string) => dependencies[name],
        console: { info() {}, warn() {}, error() {} },
    };
    runInNewContext(code, context);

    const loader = new context.exports.ZCGameLoader(assetService, configService, mapDirectory);
    const prepared = await loader.prepare();

    assert.equal(prepared.baseMatchConfig.map.id, 'preloaded-map', '冻结配置快照随预加载结果移交');
    assert.equal(prepared.baseMatchConfig.configHash, 'loader-snapshot');
    assert.deepEqual(
        loadedDirectories.slice().sort(),
        [mapDirectory, buildingDirectory, wallDirectory, HEX_GROUND_GLOW_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT].sort(),
    );
    assert.deepEqual(configuredMaps, ['preloaded-map']);
    assert.equal(deckUnitsChecked, true, '预加载必须校验「卡引用的单位能上场」');
    assert.deepEqual(loadedPrefabs.sort(), [
        // 本局携带神器的图标（中立资源点「神器充能」格用，图名来自 pvpArtifact[].icon）。
        'image/artifact/霜封冰刃/spriteFrame',
        'effects/arrow',
        'effects/empowered',
        'effects/slash',
        // 城墙砖接缝 shader（重叠区边缘带暗色淡化）。
        'shaders/wall-tile',
        'ui/game/ZCGameBoard',
        'ui/game/ZCGameCardReveal',
        'ui/game/ZCGameDecor',
        'ui/game/ZCGameEffect',
        'ui/game/ZCGameFloatText',
        'ui/game/ZCGameHUD',
        'ui/game/ZCGameHex',
        'ui/game/ZCGameLegendBanner',
        'ui/game/ZCGameUnit',
        'ui/game/ZCGameWall',
        'ui/game/ZCGameWallLayer',
        'ui/game/ZCSpawnSelection',
        'units/archer',
        // 单位出生特效（24 帧光柱，loader 既有加载；expected 此前漏同步）。
        'units/effects/出生特效/出生特效',
        'units/militia',
    ].sort());
    assert.equal(prepared.unitVisualPrefabs.size, 2);
    assert.equal(prepared.effectVisualPrefabs.size, 3);
    assert.equal(prepared.buildingFrames.size, 2);
    assert.ok(prepared.buildingFrames.has('hq-base'), '建筑外观帧按图片名索引');
    assert.equal(prepared.wallFrames.size, 4);
    assert.ok(prepared.wallFrames.has('rightUp'), '城墙砖帧按图片名索引');
    assert.ok(prepared.wallMaterial, '城墙砖接缝材质随对局资源预加载');
    assert.deepEqual(prepared.guide.entries, [], '指南内容由应用层预加载后随对局资源一并移交');
});
