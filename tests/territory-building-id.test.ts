import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 领地「建筑 ID」这条链路的守卫（2026-10-10 口径）。
 *
 * 山猫的原话，三条硬口径：
 *  1. **配置有建筑 id 才显示建筑 id**；没有就不显示（不是显示「未配置」占位）。
 *  2. `build.json` 的 `buildType`：1=基地 2=异步据点 3=boss关 4=普通关 5=固定宝箱 6=随机据点。
 *  3. **地图编辑配置哪个 id 就用哪个 id** —— 外观由地图 JSON 的 `buildingId` 决定，
 *     `build.json` 只当「buildId → 贴图」查询表，**不按 `buildType` 反推**。
 *     理由很硬：同一个 `buildType` 下可以有多个建筑（`69006`随机资源与 `69007`奖励据点**都是 6**），
 *     按类型反推必然张冠李戴。
 *
 * 另外「相同战斗 id = 一片战斗区域」是**数据事实**而非代码约定：
 * `chapter_01.json` 里 `configId=10010` 有 11 个站点，其中只有 1 个配了 `buildingId`
 * ⇒ 「区域内只有那个站点生成建筑」由**配置**保证，代码不做区域推断。
 *
 * ⚠️ 这里的 build 表归一逻辑**不 import `TerritoryPageAssets`** ——
 * 它顶部 `import { JsonAsset, SpriteFrame } from 'cc'`，而用例跑在 Node 里会
 * `Cannot find module 'cc'`（规则 78：被Node 用例 import 的模块依赖链上禁出现 `cc`）。
 * 所以照抄那 20 行归一逻辑在本文件内实现一份，**两边必须同规则**（下面有断言钉住）。
 */

const BUILD_TABLE = 'assets/remoteRef/build.json';
const MAP_PRESET = 'tools/map-editor/presets/territory/chapter_01.json';
const VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const PRESENTER_PATH = 'assets/script/app/territory/application/TerritoryModel.ts';
const ASSETS_PATH = 'assets/script/app/territory/application/TerritoryPageAssets.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

/**
 * build 表归一：**必须与 `TerritoryPageAssets.parseTerritoryBuildTable` 同规则**。
 * （不能 import 那个模块 —— 它依赖 `cc`，见文件头注释。）
 */
function parseTerritoryBuildTable(raw: unknown): Map<number, { buildId: number; buildType: number; buildresource: string }> {
    const table = new Map<number, { buildId: number; buildType: number; buildresource: string }>();
    const rows: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'object' && raw !== null && Array.isArray((raw as { v?: unknown }).v)
            ? ((raw as { k: string[]; v: unknown[][] }).v).map((values) => {
                const keys = (raw as { k: string[] }).k;
                return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
            })
            : [];
    for (const item of rows) {
        if (typeof item !== 'object' || item === null) continue;
        const row = item as { buildId?: unknown; buildType?: unknown; buildresource?: unknown };
        const buildId = Number(row.buildId);
        if (!Number.isFinite(buildId) || typeof row.buildresource !== 'string' || !row.buildresource) continue;
        table.set(buildId, {
            buildId,
            buildType: Number(row.buildType) || 0,
            buildresource: row.buildresource,
        });
    }
    return table;
}

test('build 表：本用例的归一逻辑与 TerritoryPageAssets.parseTerritoryBuildTable 同规则', () => {
    // 上一条已验证本文件这份实现的正确性；这里钉住**源码那份**也是同一套规则，
    // 免得将来只改一边、两边行为漂移（测试变成假绿）。
    const src = readFileSync('assets/script/app/territory/application/TerritoryPageAssets.ts', 'utf8');
    const start = src.indexOf('export function parseTerritoryBuildTable');
    assert.ok(start > 0, '找不到 parseTerritoryBuildTable');
    const body = src.slice(start, src.indexOf('\n}', start));
    // ① 键要 Number 归一（表里数字 / 地图 JSON 字符串）
    assert.match(body, /Number\(row\.buildId\)/, '源码侧也必须 Number(buildId) 归一');
    // ② 两种转表形态都认：数组行存 + {k,v} 稠密列存
    assert.match(body, /Array\.isArray\(raw\)/, '要认行存数组');
    assert.match(body, /Array\.isArray\(\(raw as \{ v\?: unknown \}\)\.v\)/, '要认稠密列存 {k,v}');
    // ③ 脏行丢弃而不是抛
    assert.match(body, /continue;/, '脏行应 continue 跳过');
    // ④ 返回 Map（视图按数字键查）
    assert.match(body, /new Map<number, ITerritoryBuildRow>\(\)/, '应返回 buildId → 行的 Map');
});

test('build 表：两种转表形态都能归一成 buildId → 行', () => {
    // ① 真实文件（行存形态）
    const fromFile = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));
    assert.ok(fromFile.size > 0, 'build 表应至少有一条');

    // ② 稠密列存形态：`{c:1, k:[表头], v:[行]}` —— 转表器的真实产物。
    //    ⚠️ 判据必须是 `c === 1`（与 `RefUtil.compressKeyRefDataFix` 同一口径），
    //    不是「有没有 `v`」—— 否则别的 `{k,v}` 结构会被误当数据、把整表读空。
    const dense = { c: 1, k: ['buildId', 'buildType', 'buildresource'], v: [[69001, 1, 'x/one'], [69002, 2, 'x/two']] };
    const fromDense = parseTerritoryBuildTable(dense);
    assert.equal(fromDense.size, 2, '稠密列存形态也要能读');
    assert.equal(fromDense.get(69001)?.buildresource, 'x/one');
    assert.equal(fromDense.get(69002)?.buildType, 2);

    // ②b 缺 `c === 1` 的 `{k,v}` 不认（防误判）
    assert.equal(parseTerritoryBuildTable({ k: ['buildId'], v: [[69001]] }).size, 0,
        '没有 c === 1 就不是转表产物，不该被当成数据');

    // ③ 垃圾输入不抛，只丢行
    assert.equal(parseTerritoryBuildTable(null).size, 0);
    assert.equal(parseTerritoryBuildTable({ v: 'not-array' }).size, 0);
    assert.equal(parseTerritoryBuildTable([{ buildId: 'x', buildresource: '' }]).size, 0,
        'buildId 非数字或 buildresource 为空的行应被丢掉');
});

test('build 表：键是数字 —— 地图 JSON 的 buildingId 是字符串，不归一就永远查不到', () => {
    const table = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));
    // 真实数据里 chapter_01 配的就是 '69003' 这种字符串
    assert.ok(table.get(Number('69003')), '字符串 "69003" 应能查到数字键 69003');
    assert.equal(table.get(Number('69003'))?.buildType, 3, '69003 应该是 boss关(buildType 3)');
    // 配了但表里没有的 id —— 视图要能优雅回退（不抛）
    assert.equal(table.get(Number('99999')), undefined);
});

test('build 表：buildType 枚举与策划口径一致（1基地 2异步 3boss 4普通关 5固定宝箱 6随机据点）', () => {
    const table = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));
    const byType = new Map<number, number[]>();
    for (const row of table.values()) {
        if (!byType.has(row.buildType)) byType.set(row.buildType, []);
        byType.get(row.buildType)!.push(row.buildId);
    }
    // 六个类型都在（1~6），每个类型的资源与枚举名对得上
    const EXPECTED: Record<number, string> = {
        1: 'territory_home_v1',
        2: 'territory_async_pvp_v1',
        3: 'territory_boss_v1',
        4: 'territory_outpost_v1',
        5: 'territory_fixed_resource_v1',
        6: 'territory_random_resource_v1',
    };
    for (const [type, resName] of Object.entries(EXPECTED)) {
        const ids = byType.get(Number(type));
        assert.ok(ids?.length, `buildType=${type} 没有任何建筑`);
        const resources = ids.map((id) => table.get(id)!.buildresource.split('/').pop());
        assert.ok(resources.includes(resName),
            `buildType=${type} 应包含 ${resName}，实际 ${resources.join('、')}`);
    }
    // ⚠️ 已知的数据事实：69007(territory_bonus) 也是 buildType=6 ——
    // 正因为「同类型多建筑」，选图才**必须**走 buildingId 而不是 buildType。
    assert.ok([...table.values()].some((r) => r.buildresource.endsWith('territory_bonus_v1')),
        '数据里确实存在第二个 buildType=6（奖励据点），这正是不能按 type 反推的原因');
});

test('视图：选图优先级 = 地图配的 buildingId > 站点 type', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const fn = src.slice(src.indexOf('private stationIconOf'), src.indexOf('private stateOf'));
    // ① 先查 buildFrames，且查表键做了 Number 归一（字符串 '69003' 也要能查到）
    assert.match(fn, /Number\(site\.buildingId\)/,
        '查表键必须 Number 归一 —— 表里是数字、地图 JSON 是字符串，不归一就是静默查不到');
    assert.match(fn, /art\.buildFrames\?\.get\(/, '应按 buildId 去 buildFrames 取帧');
    // ② 没配/查不到才回退按 type
    assert.ok(fn.indexOf('buildFrames') < fn.indexOf('TERRITORY_SITE_ART'),
        'buildingId 分支必须在 type 分支之前');
    assert.match(fn, /TERRITORY_SITE_ART\[site\.type\]/, '回退路径仍按站点 type 取图');
});

// 站点详情面板已移除（2026-10-27），「建筑 ID」那行随之消失，用例一并删除。

test('地图数据：同一 configId 是一片区域，区域内只有配了 buildingId 的站点生成建筑', () => {
    const map = JSON.parse(readFileSync(MAP_PRESET, 'utf8')) as Raw;
    const groups = new Map<string, Raw[]>();
    for (const site of map.sites) {
        const cid = String(site.configId ?? '');
        if (!/^\d+$/.test(cid)) continue;
        if (!groups.has(cid)) groups.set(cid, []);
        groups.get(cid)!.push(site);
    }
    const multi = [...groups.entries()].filter(([, sites]) => sites.length > 1);
    assert.ok(multi.length > 0, 'chapter_01 应存在「同一战斗 id 多站点」的区域');

    for (const [cid, sites] of multi) {
        const withBuilding = sites.filter((s) => s.buildingId);
        // 允许 0 个（整片都是普通格）或 1 个（唯一建筑），但不能 >1 个 —— 那会让「一片区域」
        // 画出多栋建筑，语义就乱了。
        assert.ok(withBuilding.length <= 1,
            `configId=${cid} 有 ${withBuilding.length} 个站点配了 buildingId，最多只能 1 个`);
    }
    // 反向：配置了 buildingId 的站点，其 id 必须在 build 表里查得到（否则外观静默退回 type）
    const table = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));
    for (const site of map.sites) {
        if (!site.buildingId) continue;
        assert.ok(table.get(Number(site.buildingId)),
            `站点 ${site.id} 配了 buildingId=${site.buildingId}，但 build 表里查不到该 id`);
    }
});

test('★★★ 建筑表必须走 RefUtil，不能用 AssetService（bundle 不对，零报错地读不到）', () => {
    const src = readFileSync(ASSETS_PATH, 'utf8');
    // ⚠️ 边界要卡在「下一个顶层定义」为止，不能一路 slice 到文件末尾 ——
    // 后面 `loadTerritoryMapJson` **合法**地用 `assets.load`（地图 JSON 就在 resources bundle 里），
    // 一路 slice 过去会把它算进本函数 ⇒ 假红。
    const start = src.indexOf('export async function loadTerritoryBuildTable');
    assert.ok(start > 0, 'loadTerritoryBuildTable 要能定位');
    const end = src.indexOf('\nexport ', start + 1);
    const loadTable = src.slice(start, end > start ? end : undefined);

    // 🔴 `remoteRef` 是**独立 bundle**，`AssetService` 走 `resources` bundle
    // ⇒ `assets.load('build', JsonAsset)` 报 `Bundle resources doesn't contain build`
    // （**不是 404**，极易误判成「表没转」/「转表器坏了」）。正解与 `BattleTokenRepository.readRows` 同款。
    assert.match(loadTable, /RefUtil\.instance\.getRefAllAsync\(/,
        'build 表在 remoteRef bundle，必须用 RefUtil.getRefAllAsync 读');
    assert.match(src, /from '\.\.\/\.\.\/\.\.\/framework\/ref\/RefUtil'/,
        '必须 import RefUtil（路径与 BattleTokenRepository 同深度：framework/ref/RefUtil）');

    // 反向：这段函数体内**不许**出现 assets.load。
    assert.ok(!/assets\.load\(/.test(loadTable),
        'loadTerritoryBuildTable 里不能有 assets.load —— resources bundle 里没有 build 表');

    // 表名要等于文件名（`build.json` → `build`），别写成带后缀或带目录。
    assert.match(src, /const BUILD_TABLE_NAME = 'build';/,
        "表名应是 'build'（RefUtil 传的是表名，不是资源路径）");
});

/**
 * 🔴 2026-11-06 用户：「chapter02~07 的地块上也需要和 chapter 01 一样，填写对应的关卡建筑 id、
 * boss 建筑 id，以及异步据点 id」。
 *
 * 背景：`stationIconOf` 对 `stage` / `boss` / `asyncPvp` 是「**没配 `buildingId` ⇒ 不画建筑**」，
 * 而 chapter_02~07 这三类站点**一个都没配** ⇒ 那几张图上一个关卡建筑都看不见。
 *
 * 判据钉的是**已发布产物**（`resources` 里那份，游戏真正加载的）而不是预设：
 * 改预设忘了发布，玩家看到的就是这张图 —— 那正是这次要防的。
 */
test('★★★章节 02~07：每个 (type, configId) 组都要配建筑，且 id 与类型对得上（2026-11-06）', () => {
    // 站点 type → (建筑 id, `build.json` 的 buildType)；与 `chapter_01` 的既有摆法一致。
    const SITE_BUILDINGS: Record<string, { id: string; buildType: number }> = {
        stage: { id: '69004', buildType: 4 },
        boss: { id: '69003', buildType: 3 },
        asyncPvp: { id: '69002', buildType: 2 },
    };
    const table = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));

    for (const chapter of [2, 3, 4, 5, 6, 7]) {
        const path = `assets/resources/config/territory-maps/chapter_0${chapter}.json`;
        const map = JSON.parse(readFileSync(path, 'utf8')) as Raw;
        const groups = new Map<string, Raw[]>();
        for (const site of map.sites) {
            if (!SITE_BUILDINGS[site.type]) continue;
            const key = `${site.type}:${site.configId}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(site);
        }
        assert.ok(groups.size > 0, `chapter_0${chapter} 应有关卡 / 首领 / 异步据点站点`);

        for (const [key, sites] of groups) {
            const type = key.split(':')[0];
            const expected = SITE_BUILDINGS[type];
            const withBuilding = sites.filter((site) => String(site.buildingId ?? '').trim());
            // 一个组 = 一片战斗区域 = 一个关卡；配 0 个 ⇒ 建筑不显示，配 >1 个 ⇒ 满片同款建筑。
            assert.equal(withBuilding.length, 1,
                `chapter_0${chapter} 的 ${key} 有 ${withBuilding.length} 个站点配了 buildingId，必须恰好 1 个`);
            const buildingId = String(withBuilding[0].buildingId);
            assert.equal(buildingId, expected.id,
                `chapter_0${chapter} 的 ${key} 应配 ${expected.id}(${type})，实际 ${buildingId}`);
            // 表里查得到，且 buildType 与站点类型一致（配错 id 时建筑会张冠李戴，且零报错）
            const row = table.get(Number(buildingId));
            assert.ok(row, `chapter_0${chapter} 的 ${key} 配了 ${buildingId}，但 build 表里查不到`);
            assert.equal(row!.buildType, expected.buildType,
                `${buildingId} 在 build 表里是 buildType=${row!.buildType}，与 ${type} 不符`);
        }
    }
});

/**
 * 🔴 2026-11-10 用户：「chapter01~07 地块使用了 1023 奖励的，建筑 id 从 69005 改成 69020」。
 *
 * ## 为什么这几格原来是「空串」，却长得和 69005 一样
 *
 * `stationIconOf` 对 `stage` / `boss` / `asyncPvp` 是「没配 `buildingId` ⇒ 不画建筑」，
 * 但 `fixedResource` / `bonus` **会继续往下回退**到 `TERRITORY_SITE_ART`：
 *
 *     fixedResource ⇒ art.fixedResource ⇒ image/territory/buildings/territory_fixed_resource_v1
 *
 * 那张图正好就是 `build.json` 里 `69005` 的贴图 ⇒ 空串与「配了 69005」视觉上完全一样。
 * 所以用户说的「从 69005 改成 69020」与实测「148 格全是空串」并不矛盾，
 * 本用例钉的是**结果**：`rewardId=1023` 的格必须显式写 `69020`。
 *
 * ## 为什么必须显式配 id
 *
 * 只有配了 `buildingId`，`stationIconOf` 的第一条分支（`buildFrames.get(69020)`）才会命中、
 * 并且**不再回退**。留着空串，改 `build.json` 里 69020 的贴图是**完全无效**的 —— 没人读它。
 *
 * ## 判据钉的是已发布产物
 *
 * 与上一条同口径：改预设忘了发布，玩家看到的就是发布那份。这里逐章核 `assets/resources/config/territory-maps`。
 */
test('★★★章节 01~07：用 1023 奖励的宝箱格配 69020（coinBox），且建筑表与贴图都在（2026-11-10）', () => {
    const REWARD_ID = 1023;
    const CHEST_BUILDING = '69020';
    const table = parseTerritoryBuildTable(JSON.parse(readFileSync(BUILD_TABLE, 'utf8')));

    const row = table.get(Number(CHEST_BUILDING));
    assert.ok(row, `${CHEST_BUILDING} 必须在 build 表里，否则配了 id 也查不到帧（零报错、外观不变）`);
    assert.equal(row!.buildType, 5, `${CHEST_BUILDING} 应是 buildType=5（固定宝箱）`);
    assert.equal(row!.buildresource, 'image/territory/buildings/coinBox',
        `${CHEST_BUILDING} 的贴图应是 coinBox`);

    let total = 0;
    for (const chapter of [1, 2, 3, 4, 5, 6, 7]) {
        const path = `assets/resources/config/territory-maps/chapter_0${chapter}.json`;
        const map = JSON.parse(readFileSync(path, 'utf8')) as Raw;
        const chests = (map.sites as Raw[]).filter((site) => site.rewardId === REWARD_ID);
        // 7 章合计 148 格（ch01=25 ch02=27 ch03=36 ch04~07 各 15）；某章变 0 说明奖励 id 被改回去了。
        assert.ok(chests.length > 0, `chapter_0${chapter} 应有 rewardId=${REWARD_ID} 的宝箱格`);

        for (const site of chests) {
            assert.equal(site.type, 'fixedResource',
                `chapter_0${chapter} 的 ${site.id} 带 rewardId=${REWARD_ID}，type 却不是 fixedResource`);
            assert.equal(String(site.buildingId ?? ''), CHEST_BUILDING,
                `chapter_0${chapter} 的 ${site.id}（cell ${site.cellId}）应配 ${CHEST_BUILDING}，`
                + `实际 "${site.buildingId ?? ''}" —— 空串会回退到 69005 的同款贴图，改了也没用`);
        }
        total += chests.length;
    }
    // 每格一个独立 `configId`（`fixedResource_<cellId>`）⇒ 逐格填，不像关卡那样「每组一格」。
    assert.equal(total, 148, '七章合计应有 148 个 rewardId=1023 的宝箱格');
});
