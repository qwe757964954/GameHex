import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ARTIFACT_CLAIM_BURST_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT, HEX_GROUND_GLOW_ART_ROOT, MAP_RESOURCE_ART_ROOT, SPAWN_REGION_ART_ROOT, GAMEUI_ART_ROOT, NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME } from '../assets/script/app/ArtPaths';

test('建筑 prefab 不保留已删除的固定兵营/防御塔帧，城墙 prefab 使用现有墙砖', () => {
    const revealPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameCardReveal.prefab', 'utf8');
    const hexPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameHex.prefab', 'utf8');
    for (const source of [revealPrefab, hexPrefab]) {
        assert.equal(source.includes('barracksFrame'), false);
        assert.equal(source.includes('towerFrame'), false);
    }

    const wallPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameWall.prefab', 'utf8');
    // 墙砖目录已随 Loader 的 WALL_TILE_DIRECTORY 迁到 image/buildings/walls（旧 image/walls 从未入库）。
    const downMeta = JSON.parse(readFileSync('assets/resources/image/buildings/walls/down.png.meta', 'utf8')) as { uuid: string };
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
        '../model/ZCGameResourcePlan': resourcePlan,
        cc,
        '../../../core/asset/BundleCatalog': { BATTLE_BUNDLE: 'battle' },
        '../../ArtPaths': {
            decorFramePath: (name: string) => `image/decor/${name}/spriteFrame`,
            // 神器图标走它拼 `image/artifact/<icon>/spriteFrame`（png 是 SpriteFrame 子资源）。
            spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`,
            // 地块底部发光序列帧的目录。**必须透传真值**：漏给这个符号时 loader 侧拿到
            // `undefined`，`loadDir(undefined)` 会让下面的目录清单多出一个 `undefined` 项 ——
            // 症状就是「多出一项 undefined」而不是报错，很难看出是桩缺符号（2026-10-14 修）。
            ARTIFACT_CLAIM_BURST_ART_ROOT,
            HEX_GROUND_GLOW_ART_ROOT,
            HEX_FLIP_PULSE_ART_ROOT,
            // 金币/气泡/中立占位图三组同样透传真值：漏给时 `spriteFramePath` 拼出
            // `undefined/xxx/spriteFrame`，loadedPrefabs 清单会多出带 `undefined` 的假路径。
            MAP_RESOURCE_ART_ROOT,
            SPAWN_REGION_ART_ROOT,
            GAMEUI_ART_ROOT,
            NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME,
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
        '../model/ZCNeutralResourceGroup': {
            // 兵团类资源项要产的兵从完整目录预加载：桩里给空目录（本用例不测那条分支）。
            getZCNeutralResourceCatalog: () => ({ items: new Map() }),
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
            // 跨表引用闸（assertDeckUnitsPlayable / findUndeployableDeckCards）已整体移除，
            // 改为构建期工具 tools/pvp_card_check.py 校验，预加载期不再做这条检查。
            // `loadArtifactIconFrame` 用它取神器图标名（真源 = `pvpArtifact` 第一行的 `icon`）。
            getPvpRuntimeRules: () => ({ artifactIcon: '霜封冰刃' }),
        },
        '../model/ZCMatchConfig': {
            captureZCMatchConfig: (_source: unknown, options: { allowUnresolvedSelect?: boolean }) => {
                assert.equal(pvpTablesLoaded, true, '配置快照必须在 PVP 表注入后创建');
                assert.equal(configuredMaps.at(-1), 'preloaded-map', '快照必须包含本次加载的地图');
                assert.equal(options.allowUnresolvedSelect, true);
                // prepare 会展开 playerDeck / enemyDeck 计算本局阵容视觉依赖（离线空阵容）。
                return { map: { id: 'preloaded-map', cityMode: 'fixed' }, configHash: 'loader-snapshot', playerDeck: [], enemyDeck: [] };
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
        [mapDirectory, buildingDirectory, wallDirectory, HEX_GROUND_GLOW_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT, ARTIFACT_CLAIM_BURST_ART_ROOT].sort(),
    );
    assert.deepEqual(configuredMaps, ['preloaded-map']);
    assert.deepEqual(loadedPrefabs.sort(), [
        // 本局携带神器的图标（中立资源点「神器充能」格用，图名来自 pvpArtifact[].icon）。
        'image/artifact/霜封冰刃/spriteFrame',
        // 中立资源占位问号 / 金币飞行贴图 / 自选主城区域气泡（三组后期新增的图标加载）。
        'image/map-resource/coin_icon/spriteFrame',
        'effects/arrow',
        'effects/empowered',
        'effects/slash',
        // 城墙砖接缝 shader（重叠区边缘带暗色淡化）。
        'shaders/wall-tile',
        // 兵种整体外轮廓（放大副本）shader。
        'shaders/unit-outline-copy',
        'ui/game/ZCGameBoard',
        'ui/game/ZCBossPanel',
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
        'units/archer',
        // 单位出生特效（24 帧光柱，loader 既有加载；expected 此前漏同步）。
        'units/effects/出生特效/出生特效',
        // 阵亡 / 建筑摧毁 / 四职业受击特效（后期分批加入的纯表现件）。
        'units/effects/死亡特效/死亡特效',
        'units/effects/建筑死亡特效/建筑死亡特效',
        'units/effects/受击特效/射手受击/射手受击',
        'units/effects/受击特效/战士受击/战士受击',
        'units/effects/受击特效/法师受击/法师受击',
        'units/effects/受击特效/坦克受击/坦克受击',
        'units/militia',
    ].sort());
    assert.equal(prepared.unitVisualPrefabs.size, 2);
    assert.equal(prepared.effectVisualPrefabs.size, 3);
    assert.equal(prepared.buildingFrames.size, 2);
    assert.ok(prepared.buildingFrames.has('hq-base'), '建筑外观帧按图片名索引');
    assert.equal(prepared.wallFrames.size, 4);
    assert.ok(prepared.wallFrames.has('rightUp'), '城墙砖帧按图片名索引');
    assert.ok(prepared.wallMaterial, '城墙砖接缝材质随对局资源预加载');
    assert.deepEqual((await prepared.loadGuide()).entries, [], '指南点击时加载，仍归属本局资源');
});
