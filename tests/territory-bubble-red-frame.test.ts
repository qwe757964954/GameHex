import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as MapMarkerBadge from '../assets/script/app/common/MapMarkerBadge';
import * as TerritoryChestBubble from '../assets/script/app/territory/model/TerritoryChestBubble';
import * as TerritoryLevelBubble from '../assets/script/app/territory/model/TerritoryLevelBubble';
import { BATTLE_BUNDLE, bundleForPath } from '../assets/script/core/asset/BundleCatalog';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 2026-11-11 用户：「合并svn之后，未通关的预告气泡又变回了蓝色，不是红色」。
 *
 * 静态链路（判据 / 路径常量 / PNG / meta / bundle 路由 / art 传递）全是对的，
 * 唯一的实机分支是 `TerritoryPageAssets.loadFrame()` 的 **`assets.has()` 索引预检**：
 * 旧实现查不到 config.json 的 paths 就 `return null`，把 `levelBubblePendingFrame`
 * 静默置空 ⇒ `stationRenderOf` 两条「未通关」分支一起回退已通关蓝图 `frame_03`。
 * 而既有夹具一律 `has: async () => true`（`territory-random-resource-render` 等），
 * 所以 12 条专项用例全绿也盖不住这条实机状态。
 *
 * 本文件把「has=false」当成一等公民跑真实 `loadTerritoryBattleArt`，并守住
 * 「红图从磁盘 → bundle → art 槽位 → 站点渲染」整条链。
 */

const PAGE_ASSETS = 'assets/script/app/territory/application/TerritoryPageAssets.ts';
const MAP_VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const SRC = readFileSync(PAGE_ASSETS, 'utf8');
const RED_PATH = 'image/spawn-region/frame_02/spriteFrame';
const BLUE_PATH = 'image/spawn-region/frame_03/spriteFrame';
const RED_PNG = 'assets/bundles/battle/image/spawn-region/frame_02.png';
const BLUE_PNG = 'assets/bundles/battle/image/spawn-region/frame_03.png';

interface FakeAssets {
    load: (path: string) => Promise<{ path: string } | null>;
    has: (path: string) => Promise<boolean>;
}

/** 跑真 `loadTerritoryBattleArt`（VM 桩表在本文件内收口，不依赖别的夹具的 require 白名单）。 */
async function loadArt(makeAssets: (calls: { loaded: string[]; hasCalls: string[] }) => FakeAssets) {
    const code = ts.transpileModule(SRC, { compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    const calls = { loaded: [] as string[], hasCalls: [] as string[] };
    const assets = makeAssets(calls);
    const warnings: string[] = [];
    runInNewContext(code, {
        exports: moduleExports,
        console: { warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')) },
        require: (id: string) => {
            if (id === 'cc') return { JsonAsset: class {}, SpriteFrame: class {} };
            if (id.endsWith('/MapMarkerBadge')) return MapMarkerBadge;
            if (id === '../model/TerritoryChestBubble') return TerritoryChestBubble;
            if (id === '../model/TerritoryLevelBubble') return TerritoryLevelBubble;
            // 建筑表走 RefUtil，不是 AssetService；给空表让这轮只验气泡链路。
            if (id === '../../../framework/ref/RefUtil') return {
                RefUtil: { instance: { getRefAllAsync: async () => ([]) } },
            };
            if (id === '../../ArtPaths') return {
                ART_ROOT: 'image',
                BUILDING_ART_ROOT: 'image/buildings',
                COMMON_ART_ROOT: 'image/common',
                RESOURCE_ICON_ART_ROOT: 'icons/resource',
                TERRITORY_ART_ROOT: 'image/territory',
                TERRITORY_BUILDING_ART_ROOT: 'image/territory/buildings',
                spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`,
                spriteFramePathOf: (path: string) => path.endsWith('/spriteFrame') ? path : `${path}/spriteFrame`,
            };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    const run = moduleExports.loadTerritoryBattleArt as (a: FakeAssets, bg: string) => Promise<Record<string, any>>;
    const art = await run(assets, '');
    return { art, calls, warnings };
}

function normalAssets(calls: { loaded: string[]; hasCalls: string[] }, hasResult: boolean): FakeAssets {
    return {
        load: async (path: string) => { calls.loaded.push(path); return { path }; },
        has: async (path: string) => { calls.hasCalls.push(path); return hasResult; },
    };
}

// ============================================================
// 一、实机状态：`has=false` 不许把红图判空
// ============================================================

test('★bundle 索引查不到（has=false）时，未通关红图仍然加载成功', async () => {
    const { art, calls } = await loadArt((c) => normalAssets(c, false));
    assert.equal(art.levelBubbleFrame.path, BLUE_PATH, '已通关槽位仍是蓝 frame_03');
    assert.equal(art.levelBubblePendingFrame.path, RED_PATH,
        '🔴 has=false 不能短路判空：红 frame_02 必须进 art，否则预告气泡全回退成蓝色');
    assert.notEqual(art.levelBubbleFrame.path, art.levelBubblePendingFrame.path,
        '两个槽位不许被压成同一张图（2026-10-28 踩过一次）');
    assert.equal(calls.loaded.includes(RED_PATH), true, '红图必须真的被 load 过');
    assert.equal(calls.loaded.includes(BLUE_PATH), true);
    assert.equal(art.pvpBubblePortrait.path, TerritoryLevelBubble.TERRITORY_PVP_BUBBLE_PORTRAIT_PATH);
    assert.equal(existsSync('assets/resources/' + TerritoryLevelBubble.TERRITORY_PVP_BUBBLE_PORTRAIT_PATH.replace('/spriteFrame', '.png')), true);
    // 正常路径根本不该再查索引：预检只用于失败时写日志。
    assert.equal(calls.hasCalls.length, 0, 'has 已从「加载前的闸门」降级为「失败后的日志」');
});

test('has=true 的旧夹具行为不变（回归既有 territory-random-resource-render 口径）', async () => {
    const { art } = await loadArt((c) => normalAssets(c, true));
    assert.equal(art.levelBubbleFrame.path, BLUE_PATH);
    assert.equal(art.levelBubblePendingFrame.path, RED_PATH);
});

test('真缺图仍返回 null 且降级不崩，has 只用来把日志说清楚', async () => {
    const { art, calls, warnings } = await loadArt((c) => ({
        load: async (path: string) => {
            c.loaded.push(path);
            if (path === RED_PATH) throw new Error('Bundle battle doesn\'t contain frame_02');
            return { path };
        },
        has: async (path: string) => { c.hasCalls.push(path); return false; },
    }));
    assert.equal(art.levelBubbleFrame.path, BLUE_PATH, '单张图失败不许拖垮整份美术表');
    assert.equal(art.levelBubblePendingFrame, null, '真缺图仍按旧策略返回 null');
    assert.equal(calls.hasCalls.includes(RED_PATH), true, '失败后才查一次索引');
    assert.equal(warnings.length, 1, '单张失败只打一条 warn');
    assert.match(warnings[0], /bundle 索引也未登记此路径/);
});

// ============================================================
// 二、源码守卫：预检不许复活成短路闸门
// ============================================================

function loadFrameBody(): string {
    const at = SRC.indexOf('async function loadFrame(');
    assert.ok(at > 0, 'loadFrame 必须存在');
    const end = SRC.indexOf('\n}', at);
    assert.ok(end > at, '要能切出 loadFrame 函数体');
    // 🔴 函数头注释里逐字引用了被修掉的旧写法（`if (!(await assets.has...)) return null`），
    //    不去注释会被守卫当真代码命中 —— 与 `territory-chest-bubble` 那次同类假红。
    return SRC.slice(at, end).split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');
}

test('★loadFrame 里 assets.load 排在 assets.has 之前，且没有 has 短路 return', () => {
    const body = loadFrameBody();
    assert.doesNotMatch(body, /if\s*\(!\(?await assets\.has/,
        '不许再用 `if (!(await assets.has(...))) return null` 把索引查不到当成图不存在');
    const loadAt = body.indexOf('await assets.load(');
    const hasAt = body.indexOf('await assets.has(');
    assert.ok(loadAt > 0 && hasAt > loadAt, 'has 只能出现在 load 失败后的 catch 里');
    assert.match(body, /catch \(error\)/, 'load 失败必须被 catch 兜成 null');
});

test('解构顺序与 Promise.all 顺序对齐：PASSED 在 PENDING 之前', () => {
    const at = SRC.indexOf('export async function loadTerritoryBattleArt(');
    const block = SRC.slice(at, SRC.indexOf('\n}', at));
    const destructAt = block.indexOf('levelBubbleFrame, levelBubblePendingFrame');
    assert.ok(destructAt > 0, '解构里两个槽位必须相邻且按「蓝、红」排列');
    const passedAt = block.indexOf('loadFrame(assets, MAP_MARKER_BUBBLE_FRAME_PASSED_PATH)');
    const pendingAt = block.indexOf('loadFrame(assets, MAP_MARKER_BUBBLE_FRAME_PENDING_PATH)');
    assert.ok(passedAt > 0 && pendingAt > passedAt,
        '数组顺序错了会把红图塞进已通关槽位 —— 表现为「通关的变红、没通关的变蓝」');
    assert.match(block, /return \{ background, levelBubbleFrame, levelBubblePendingFrame/);
});

// ============================================================
// 三、磁盘真值：红图确实在 battle 包里，且是 sprite-frame
// ============================================================

test('★两张气泡底图都在 battle bundle，meta 都是 sprite-frame + f9941', () => {
    for (const [png, path] of [[RED_PNG, RED_PATH], [BLUE_PNG, BLUE_PATH]] as const) {
        assert.equal(existsSync(png), true, `${png} 不能丢`);
        assert.equal(existsSync(`${png}.meta`), true, `${png}.meta 不能丢`);
        const meta = JSON.parse(readFileSync(`${png}.meta`, 'utf8'));
        assert.equal(meta.userData?.type, 'sprite-frame', `${png} 必须是 sprite-frame（默认 texture 会静默取不到）`);
        assert.ok(meta.subMetas?.f9941, `${png} 必须有 @f9941 子资源`);
        assert.equal(bundleForPath(path), BATTLE_BUNDLE, `${path} 必须路由到 battle 包`);
    }
    // 🔴 索引登记方式本来就不一致：红 frame_02 是 packable:false 的散图、
    //    蓝 frame_03 进 auto-atlas。这正是「预检短路」只坑红图的原因，别把它「统一」掉。
    const redMeta = JSON.parse(readFileSync(`${RED_PNG}.meta`, 'utf8'));
    const blueMeta = JSON.parse(readFileSync(`${BLUE_PNG}.meta`, 'utf8'));
    assert.equal(redMeta.subMetas.f9941.userData.packable, false);
    assert.equal(blueMeta.subMetas.f9941.userData.packable, true);
});

test('路径常量：未通关红 frame_02 / 已通关蓝 frame_03，两者不许相等', () => {
    assert.equal(MapMarkerBadge.MAP_MARKER_BUBBLE_FRAME_PENDING_PATH, RED_PATH);
    assert.equal(MapMarkerBadge.MAP_MARKER_BUBBLE_FRAME_PASSED_PATH, BLUE_PATH);
    assert.notEqual(MapMarkerBadge.MAP_MARKER_BUBBLE_FRAME_PENDING_PATH,
        MapMarkerBadge.MAP_MARKER_BUBBLE_FRAME_PASSED_PATH);
});

// ============================================================
// 四、数据层：红图进 art 后，两条「未通关」分支真的取红图
// ============================================================

const RED_FRAME = { path: RED_PATH };
const BLUE_FRAME = { path: BLUE_PATH };
const GHOST_FRAME = {
    rect: { x: 0, y: 0, width: 128, height: 96 },
    originalSize: { width: 128, height: 128 },
    offset: { x: 0, y: 0 },
};

function stationRenderOf(opts: { preview?: boolean; unlocked?: boolean; passed?: boolean }): Record<string, any> {
    const View = loadTerritoryMapViewClass();
    const view = new View();
    Object.assign(view, {
        stationIconOf: () => GHOST_FRAME,
        stateOf: () => 'available',
    });
    const site = {
        cellId: 213, type: 'boss', configId: '10005', buildingId: '69003',
        footprint: [213, 214], unlock: { silverCost: 35, staminaCost: 1, requiredCells: [] },
    };
    const stage = { chapterId: 2, stage: 10, isBoss: true };
    return (view as any).stationRenderOf(site, {
        stageByCell: new Map([[213, stage]]),
        art: { randomSilverIcon: {}, chestIcon: null,
            levelBubbleFrame: BLUE_FRAME, levelBubblePendingFrame: RED_FRAME },
        previewCells: opts.preview ? [213] : [],
        siteOpenableCells: [213],
        pendingFixedResourceCells: [],
        map: { sites: [] },
        progress: {
            isCellUnlocked: () => opts.unlocked ?? false,
            isOwned: () => false,
            isAreaPassed: () => opts.passed ?? false,
        },
    }) as Record<string, any>;
}

test('★预告（未解锁）气泡 = 红 frame_02；已通关 = 蓝 frame_03', () => {
    const preview = stationRenderOf({ preview: true });
    assert.equal(preview.levelBubble, '2-10');
    assert.equal(preview.levelBubbleFrame, RED_FRAME, '截图里 2-10 那颗必须是红的');
    assert.equal(preview.previewBubble, true);

    const passed = stationRenderOf({ unlocked: true, passed: true });
    assert.equal(passed.levelBubbleFrame, BLUE_FRAME, '2-9 那种已通关格保持蓝');
});

test('已解锁但未通关也走红图（不是只有预告分支才是红）', () => {
    const out = stationRenderOf({ unlocked: true });
    assert.equal(out.levelBubbleFrame, RED_FRAME);
});

test('视图两条分支都优先取 levelBubblePendingFrame（源码守卫）', () => {
    const src = readFileSync(MAP_VIEW, 'utf8');
    assert.match(src, /levelBubbleFrame: previewBubble\s*\? input\.art\.levelBubblePendingFrame/);
    assert.match(src, /levelBubbleFrame: claimed\s*\? input\.art\.levelBubbleFrame[\s\S]{0,240}input\.art\.levelBubblePendingFrame/);
});
