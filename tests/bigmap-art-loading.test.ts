import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as catalog from '../assets/script/app/bigmap/application/BigMapArtCatalog';
import * as bundleCatalog from '../assets/script/core/asset/BundleCatalog';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function artLoader() {
    const source = readFileSync('assets/script/app/bigmap/application/BigMapArtLoader.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const moduleExports: Record<string, Function> = {};
    runInNewContext(code, {
        exports: moduleExports, console,
        require: (name: string) => {
            if (name === 'cc') return { SpriteFrame: class {} };
            if (name === './BigMapArtCatalog') return catalog;
            if (name === '../../../core/asset/BundleCatalog') return bundleCatalog;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return (...args: unknown[]) => {
        args[4] ??= loadBigMapConfig().buildings;
        return moduleExports.loadBigMapArt(...args);
    };
}

test('同一作用域中的重复建筑资源仅加载一次，布局指定背景仍优先', async () => {
    const calls: string[] = [];
    const assets = {
        has: async () => true,
        load: async (path: string) => { calls.push(path); return { path }; },
    };
    const art = await artLoader()(assets, { disposed: false }, 'custom/world');
    assert.equal(calls.filter((path) => path.endsWith('/construction/spriteFrame')).length, 1);
    assert.equal(art.background.path, 'custom/world/spriteFrame');
    assert.equal(art.tiledBackground.path, 'bigMapBG/spriteFrame');
    assert.equal(art.baseBackground.path, 'image/base_background/spriteFrame');
    assert.ok(!calls.some((path) => path.includes('/base_ground/')));
    assert.equal(art.buildings.size, 23);
    assert.equal(art.resources.size, 5);
    // 2026-11-12：`IBigMapArt.ui` 那 9 张已摘除，只剩 `stamina` 走资源图标兜底 ——
    // 钉「同一张只请求一次」，并确认其余 UI 件不再被请求（`detail` 图已随清单删库，这里守的是代码侧零请求）。
    assert.equal(calls.filter((path) => path.endsWith('/concept/ui/stamina/spriteFrame')).length, 1);
    assert.equal(calls.some((path) => path.endsWith('/concept/ui/detail/spriteFrame')), false);
});

test('基础贴图未完成时其他资源组已经发起，不串行等待六批资源', async () => {
    const paths: string[] = [];
    let finish: () => void = () => {};
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const loading = artLoader()({ has: async () => true, load: async (path: string) => {
        paths.push(path); await ready; return { path };
    } }, { disposed: false });
    await new Promise((resolve) => setImmediate(resolve));
    try {
        for (const path of ['concept/sprites/construction', 'concept/ui/stamina', 'base_background', 'main/city/btn_quick_fight']) {
            assert.ok(paths.some((entry) => entry.endsWith(`${path}/spriteFrame`)), `${path} 不应等待其他资源组`);
        }
    } finally { finish(); await loading; }
});

test('页面加载前关闭不会发起资源请求，加载途中关闭不会发布迟到的美术引用', async () => {
    let requests = 0;
    const scope = { disposed: true };
    const assets = {
        has: async () => { requests += 1; return true; },
        load: async () => { scope.disposed = true; return {}; },
    };
    const load = artLoader();
    const closed = await load(assets, scope);
    assert.equal(requests, 0);
    assert.equal(closed.home, null);
    scope.disposed = false;
    const late = await load(assets, scope);
    assert.equal(late.home, null);
    assert.equal(late.baseBackground, null);
    assert.equal(late.tiledBackground, null);
    assert.ok([...late.resources.values()].every((frame) => frame === null));
});

test('连续背景缺失时保留自定义布局背景，不再加载旧地皮', async () => {
    const art = await artLoader()({
        has: async (path: string) => !path.startsWith('bigMapBG'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, 'custom/world');
    assert.equal(art.tiledBackground, null);
    assert.equal(art.background.path, 'custom/world/spriteFrame');
    assert.equal(art.ground, null);
    assert.equal(art.groundVariants.length, 0);
});

test('废弃荒地背景和六张旧地皮完全不探测、不加载，旧配置也不再触发请求', async () => {
    for (const background of ['', 'image/wasteland_background', 'image/bigmap/wasteland_background']) {
        const paths: string[] = [];
        const art = await artLoader()({
            has: async (path: string) => { paths.push(path); return true; },
            load: async (path: string) => { paths.push(path); return { path }; },
        }, { disposed: false }, background);
        assert.equal(paths.some(path => /wasteland_background|\/grounds\/ground_/.test(path)), false);
        assert.equal(art.background, null);
        assert.equal(art.ground, null);
        assert.equal(art.groundVariants.length, 0);
        assert.equal(art.tiledBackground.path, 'bigMapBG/spriteFrame');
    }
});

test('资源缺失走既有建筑兜底，缺失美术不会改变规则配置', async () => {
    const assets = {
        has: async (path: string) => !path.includes('/concept/'),
        load: async (path: string) => ({ path }),
    };
    const art = await artLoader()(assets, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/camp_home/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/camp_legion/spriteFrame');
    assert.equal(art.baseBackground.path, 'image/base_background/spriteFrame');
});

 test('基地建筑优先用表里的 baseBuildIcon，世界标记用新的 SLG 据点图', async () => {
    const config = loadBigMapConfig();
    const art = await artLoader()({ has: async () => true, load: async (path: string) => ({ path }) }, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/camp_home/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/camp_legion/spriteFrame');
    // 野怪不走据点分段表（`bigmapMonster` 自己一套），仍是领地那张 Boss 图。
    assert.equal(art.monster.path, 'image/territory/buildings/territory_boss_v1/spriteFrame');
    // 表里配了 `baseBuildIcon` ⇒ 用它。
    // ⚠️ 断言取**表里的值**，不写死图名：2026-11-11 基地建筑换成美术给的 `base_*` 六张图，
    //    写死 `barracks-pineapple` 的话换一次图就要改一次测试，而那是表的数据不是契约。
    const icon = config.buildings.get(71002)!.icon;
    assert.ok(icon, '粮食田必须配 baseBuildIcon');
    assert.equal(art.buildings.get(71002).path, `${icon}/spriteFrame`);
    // 同类共用一张图：71003 与 71002 同 type，走同一张。
    assert.equal(art.buildings.get(71003).path, `${config.buildings.get(71003)!.icon}/spriteFrame`);
    // 全表唯一没配图的 71017（小玩法入口，没有同类可参照）仍回退概念图。
    assert.equal(art.buildings.get(71017).path, 'image/buildings/camp_outpost/spriteFrame');
});

test('23 座基地建筑按表读图标，没配该列的唯一一座才回退概念图', async () => {
    const calls: string[] = [];
    const config = loadBigMapConfig();
    const art = await artLoader()({ has: async (path: string) => { calls.push(path); return true; }, load: async (path: string) => {
        calls.push(path); return { path };
    } }, { disposed: false }, '', new Map(), config.buildings);
    assert.equal(config.buildings.get(71014)?.icon, 'image/buildings/base_iron');
    assert.equal(config.buildings.get(71023)?.initialCellId, 1023);
    assert.equal(art.buildings.size, 23);
    // 配了图标的建筑走表里的图；同 type 共用同一张。
    // 期望值一律取表（`config.buildings.get(id).icon`），不写死图名 —— 换美术不动测试。
    for (const id of [71001, 71002, 71006, 71007, 71011, 71012, 71015, 71016, 71018, 71023]) {
        const icon = config.buildings.get(id)!.icon;
        assert.ok(icon, `${id} 应配 baseBuildIcon`);
        assert.equal(art.buildings.get(id).path, `${icon}/spriteFrame`, `${id} 应加载表里的图标`);
    }
    // 同类同图：三类田各自的 5/5/3 座共用一张。
    for (const group of [[71002, 71003, 71004, 71005, 71006], [71007, 71008, 71009, 71010, 71011], [71012, 71013, 71014]]) {
        const icons = group.map((id) => config.buildings.get(id)!.icon);
        assert.equal(new Set(icons).size, 1, `${group[0]} 同类应共用一张图`);
    }
    // 只有 71017（小玩法入口）没有配置图标。
    const withoutIcon = [...config.buildings.values()].filter((b) => !b.icon).map((b) => b.id);
    assert.deepEqual(withoutIcon, [71017]);
    assert.equal(art.buildings.get(71017).path, 'image/buildings/camp_outpost/spriteFrame');
    assert.equal(calls.some((path) => path.startsWith('ui/bigmap/building/')), false,
        '表里的 baseBuildIcon 已改成真实路径，不该再出现旧的 71004 式拼法');
    // 粮食田五座共用同一张：只探测一次、加载一次。
    const grainIcon = config.buildings.get(71002)!.icon;
    assert.ok(calls.filter((path) => path === `${grainIcon}/spriteFrame`).length <= 2,
        '同类型共用一张图时只探测一次、加载一次');
    const own = new Map(config.buildings);
    const field = own.get(71003);
    assert.ok(field);
    own.set(71003, { ...field, icon: 'custom/field' });
    const custom = await artLoader()({ has: async () => true, load: async (path: string) => ({ path }) }, { disposed: false }, '', new Map(), own);
    assert.equal(custom.buildings.get(71003).path, 'custom/field/spriteFrame');
});

test('表里图标没入库时统一回退通用建筑图，不再按 baseBuildType 猜旧概念图', async () => {
    // 只让通用图命中：表里 `baseBuildIcon` 指向的目录全部 miss。
    const art = await artLoader()({ has: async (path: string) => !path.startsWith('image/buildings/base')
        && !path.startsWith('image/territory/buildings/'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, '', new Map(), loadBigMapConfig().buildings);
    // 2026-11-12 删掉了 `BIGMAP_BUILDING_ART` 那 8 项按 type 对概念图的兜底，改成一张通用图。
    for (const id of [71003, 71007, 71012, 71015, 71016, 71018]) {
        assert.equal(art.buildings.get(id).path, 'image/buildings/camp_outpost/spriteFrame', `${id} 应回退通用图`);
    }
});

test('城池按 campIcon 归一成新据点图，段内轮转且同一张只请求一次，缺图回退既有机城图', async () => {
    const config = loadBigMapConfig();
    const calls: string[] = [];
    const art = await artLoader()({ has: async () => true, load: async (path: string) => {
        calls.push(path); return { path };
    } }, { disposed: false }, '', new Map(), config.buildings, config.camps);
    assert.equal(art.camps.size, 81);
    // 1xx 前哨营地段内两张：101 → `_2`、102 → 主图 ⇒ 相邻据点必然不同。
    assert.equal(art.camps.get(101).path, 'image/buildings/camp_outpost_2/spriteFrame');
    assert.equal(art.camps.get(102).path, 'image/buildings/camp_outpost/spriteFrame');
    // 2xx 雾隐堡段内两张。
    assert.equal(art.camps.get(201).path, 'image/buildings/camp_mist_fort_2/spriteFrame');
    // 8xx 太阳神座只有一张。
    assert.equal(art.camps.get(801).path, 'image/buildings/camp_sun_throne/spriteFrame');
    // 同一张图只请求一次（`load` 内部按路径去重）。
    assert.equal(calls.filter((p) => p.endsWith('/camp_outpost_2/spriteFrame')).length, 1);
    // 81 个据点全部让位给新美术，没有一条还停在概念占位图上。
    assert.deepEqual([...art.camps.values()].filter((frame) => String(frame?.path).includes('/concept/')), []);
    const camps = new Map(config.camps);
    const camp = camps.get(101);
    assert.ok(camp);
    camps.set(101, { ...camp, iconPath: 'missing/camp' });
    const fallback = await artLoader()({ has: async (path: string) => !path.startsWith('missing/'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, '', new Map(), config.buildings, camps);
    assert.equal(fallback.camps.get(101), fallback.city);
});

test('旧表 / 旧包的概念占位图仍归一成新据点图，按段与 campId 轮转', () => {
    // 2026-11-12 起 `DM-城池配置.xlsx` 的 campIcon 已是真实图名 ⇒ 正常链路不再命中这条映射，
    // 它只剩「服务器历史快照 / 旧分支导出的 json」一个用途。用纯函数钉住，别让它悄悄失效。
    const art = (path: string, campId: number) => catalog.worldCampArtFor(path, campId);
    // 1xx 前哨营地：段内两张按 campId 奇偶交替。
    assert.equal(art('image/bigmap/concept/sprites/mutant_camp', 101), 'image/buildings/camp_outpost_2');
    assert.equal(art('image/bigmap/concept/sprites/mutant_camp', 102), 'image/buildings/camp_outpost');
    // 旧前缀 / 新前缀两种写法都要能归一（`toBigMapArtPath` 幂等）。
    assert.equal(art('image/concept/sprites/fortress', 201), 'image/buildings/camp_mist_fort_2');
    // 8xx 太阳神座只有一张。
    assert.equal(art('image/concept/sprites/headquarters', 801), 'image/buildings/camp_sun_throne');
    // 已经是真实图名 ⇒ 原样返回，不二次映射。
    assert.equal(art('image/buildings/camp_sky', 701), 'image/buildings/camp_sky');
    assert.equal(art('image/territory/buildings/territory_boss_v1', 101),
        'image/territory/buildings/territory_boss_v1');
});
