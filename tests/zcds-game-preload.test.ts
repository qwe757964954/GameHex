import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { ResourceLoadManager } from '../assets/script/core/asset/ResourceLoadManager';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { AssetService } from '../assets/script/core/asset/AssetService';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import { ZC_ATTACK_TRAITS } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import assert from 'node:assert/strict';
import * as cardArtModule from '../assets/script/app/card/CardArtConfig';
import { cardArtConfig, readCardArtTables } from './helpers/card-art-config';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ARTIFACT_CLAIM_BURST_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT, HEX_GROUND_GLOW_ART_ROOT, MAP_RESOURCE_ART_ROOT, SPAWN_REGION_ART_ROOT, GAMEUI_ART_ROOT, NEUTRAL_RESOURCE_UNKNOWN_ICON_NAME } from '../assets/script/app/ArtPaths';
import { assetPath } from './helpers/asset-paths';

test('建筑 prefab 不保留已删除的固定兵营/防御塔帧，城墙 prefab 使用现有墙砖', () => {
    const revealPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameCardReveal.prefab', 'utf8');
    const hexPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameHex.prefab', 'utf8');
    for (const source of [revealPrefab, hexPrefab]) {
        assert.equal(source.includes('barracksFrame'), false);
        assert.equal(source.includes('towerFrame'), false);
    }

    const wallPrefab = readFileSync('assets/bundles/battle/ui/game/ZCGameWall.prefab', 'utf8');
    // 墙砖目录已随 Loader 的 WALL_TILE_DIRECTORY 迁到 image/buildings/walls（旧 image/walls 从未入库）。
    const downMeta = JSON.parse(readFileSync(assetPath('image/buildings/walls/down.png.meta'), 'utf8')) as { uuid: string };
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
        loadDir: async (path: string, _type: unknown, options: { bundle?: string }) => {
            loadedDirectories.push(path);
            if (path === MAP_RESOURCE_ART_ROOT) {
                assert.equal(options.bundle, 'battle', '中立图标从 battle 包加载');
                return ['gate', 'extension', 'portal', 'horn'].map(name => new SpriteFrame(name));
            }
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
        getTable: async (name: string) => {
            if (name === cardArtModule.CARD_ART_TABLES.rarity) return readCardArtTables().rarity;
            if (name === cardArtModule.CARD_ART_TABLES.cardClass) return readCardArtTables().cardClass;
            if (name === cardArtModule.CARD_ART_TABLES.camp) return readCardArtTables().camp;
            if (name === 'icon') return [];
            return [{ name }];
        },
    };
    const dependencies: Record<string, unknown> = {
        '../../card/CardArtConfig': cardArtModule,
        '../ZCDCLogSwitch': { ZCDC_LOG_DIAGNOSTICS: false, ZCDC_LOG_WARNINGS: true },
        '../model/ZCGameResourcePlan': resourcePlan,
        '../model/ZCVisualResourcePlan': { buildZCVisualResourcePlan },
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
            setCardRarityMeta: () => {},
            // 受击特效 prefab 清单按这份词表拼路径（`<职业>受击`），桩必须透传真值，
            // 漏给时 loader 拿到 undefined，`ZCGameResourcePlan` 展开就会抛 TypeError。
            ZC_ATTACK_TRAITS,
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
            // 本用例验证首次进对局的完整加载：未预编译，故返回 false，走 getTable + loadPvpTables。
            isZCRuntimeCompiled: () => false,
            loadPvpTables: () => { pvpTablesLoaded = true; },
            // 跨表引用闸（assertDeckUnitsPlayable / findUndeployableDeckCards）已整体移除，
            // 改为构建期工具 tools/pvp_card_check.py 校验，预加载期不再做这条检查。
            // `loadArtifactIconFrame` 用它取神器图标名（真源 = `pvpArtifact` 第一行的 `icon`）。
            getPvpRuntimeRules: () => ({ artifactIcon: '霜封冰刃' }),
        },
        './ZCRuntimePrecompiler': {
            // 预编译模块内部会安装运行时表；桩里复用同一注入效果，保证后续断言顺序不变。
            ensureZCRuntimeCompiled: async () => { pvpTablesLoaded = true; },
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
        exports: {} as { ZCGameLoader: new (resources: unknown, mapDirectory: string) => { prepare(): Promise<any> } },
        require: (name: string) => dependencies[name],
        console: { info() {}, warn() {}, error() {} },
    };
    runInNewContext(code, context);

    const loader = new context.exports.ZCGameLoader({ assets: assetService, configs: configService }, mapDirectory);
    const prepared = await loader.prepare();
    assert.equal(prepared.cardArtConfig.paths.get('hero.mage'), cardArtConfig.paths.get('hero.mage'));

    assert.equal(prepared.baseMatchConfig.map.id, 'preloaded-map', '冻结配置快照随预加载结果移交');
    assert.equal(prepared.baseMatchConfig.configHash, 'loader-snapshot');
    assert.equal(prepared.neutralResourceFrames.get('portal').name, 'portal');
    assert.deepEqual(
        loadedDirectories.slice().sort(),
        [mapDirectory, buildingDirectory, wallDirectory, HEX_GROUND_GLOW_ART_ROOT, HEX_FLIP_PULSE_ART_ROOT, ARTIFACT_CLAIM_BURST_ART_ROOT, MAP_RESOURCE_ART_ROOT].sort(),
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

function shellLoader(assets: AssetService): {
    loadShellPrefabs(scope: ResourceScope, selectSpawn: boolean, hasBossPanel: boolean): Promise<Record<string, { path: string } | null>>;
} {
    const source = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    const context = {
        exports: {} as { ZCGameLoader: new (resources: unknown, directory: string) => ReturnType<typeof shellLoader> },
        require: (name: string): unknown => {
            if (name === '../model/ZCGameResourcePlan') return resourcePlan;
            if (name === 'cc') return { Prefab: class {} };
            if (name.endsWith('/BundleCatalog')) return { BATTLE_BUNDLE: 'battle' };
            return {};
        },
    };
    runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    return new context.exports.ZCGameLoader({ assets }, 'maps');
}

function shellAssets(beforeLoad = async (_path: string): Promise<void> => {}) {
    const loaded: string[] = [];
    let released = 0;
    const delegate: AssetService = {
        async load<T>(path, _type, options): Promise<T> {
            loaded.push(path);
            assert.equal(options.bundle, 'battle');
            assert.equal(options.priority, 100);
            await beforeLoad(path);
            options.scope.defer(() => released++);
            return { path } as T;
        },
        async loadDir() { return []; },
        async has() { return true; },
    };
    return { assets: new ResourceLoadManager(delegate, { maxConcurrentLoads: 1 }), loaded, released: () => released };
}

test('首屏外壳复用资源管理器批次，保留条件槽位并随战斗释放', async () => {
    for (const [selectSpawn, hasBossPanel] of [[false, false], [true, false], [false, true], [true, true]]) {
        const h = shellAssets();
        const scope = new ResourceScope('shells');
        let batches = 0;
        const loadBatch = h.assets.loadBatch.bind(h.assets);
        h.assets.loadBatch = (requests, options) => { batches++; return loadBatch(requests, options); };
        const values = await shellLoader(h.assets).loadShellPrefabs(scope, selectSpawn, hasBossPanel);
        assert.equal(batches, 1);
        assert.equal(Object.keys(values).length, 13);
        assert.equal(values.hudPrefab?.path, resourcePlan.ZC_BATTLE_SHELL_PATHS.hud);
        assert.equal(values.spawnSelectionPrefab?.path ?? null, selectSpawn ? resourcePlan.ZC_BATTLE_SHELL_PATHS.spawnSelection : null);
        assert.equal(values.bossPanelPrefab?.path ?? null, hasBossPanel ? resourcePlan.ZC_BATTLE_SHELL_PATHS.bossPanel : null);
        assert.equal(h.loaded.length, 11 + Number(selectSpawn) + Number(hasBossPanel));
        assert.equal(h.released(), 0);
        scope.dispose();
        assert.equal(h.released(), h.loaded.length);
        h.assets.dispose();
    }
});

test('首屏外壳批次失败释放已加载资源并保留原始错误', async () => {
    const failure = new Error('missing board');
    const h = shellAssets(async path => { if (path === resourcePlan.ZC_BATTLE_SHELL_PATHS.board) throw failure; });
    const scope = new ResourceScope('failed-shells');
    await assert.rejects(shellLoader(h.assets).loadShellPrefabs(scope, true, true), error => error === failure);
    assert.equal(h.released(), 1);
    assert.equal(h.loaded.length, 2, '失败后不派发剩余排队资源');
    scope.dispose();
    h.assets.dispose();
});

test('取消首屏外壳批次停止排队资源，迟到结果仍被释放', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const h = shellAssets(() => pending);
    const scope = new ResourceScope('cancelled-shells');
    const result = shellLoader(h.assets).loadShellPrefabs(scope, true, true);
    scope.dispose();
    await assert.rejects(result, /取消/);
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(h.loaded.length, 1);
    assert.equal(h.released(), 1);
    h.assets.dispose();
});
