import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * P2 热路径结构守卫。
 *
 * 行为回归由各自模块的用例覆盖；这里只钉住「不要退回高频分配/线性扫描」的实现形状，
 * 防止 P2 优化在后续重构中被无意还原。
 */
const read = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function bodyOf(source: string, signature: string, length = 900): string {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `找不到签名：${signature}`);
    return source.slice(start, start + length);
}

test('P2-1 地块投影：只在地形失效时重建，逻辑步不再无条件清空', () => {
    const source = read('assets/script/app/zcds/model/ZCGameModel.ts');
    const advance = bodyOf(source, 'private advance(dt: number): void {', 700);
    assert.doesNotMatch(advance, /this\.hexRenderMap\s*=\s*null/, 'advance 不得每步清空投影表');
    assert.match(source, /private refreshHexRenderMap\([^)]*\): ReadonlyMap<number, ZCGameRenderHex>/, '投影刷新入口');
    assert.match(source, /const hexesById = this\.hexRenderMap \?\?= new Map/, '复用 Map，不再每帧 new');
    assert.match(source, /this\.hexRenderElapsed === elapsed/, '同一逻辑步的显示帧直接复用');
    assert.match(source, /this\.topologyRevision === this\.hexRenderTopologyRevision/, '地形版本一致才跳过刷新');
    assert.match(source, /entry\.state = state;/, '复用地块对象并逐字段刷新');
});

test('P2-2 战斗事件：advance 用写指针原地压缩，不 filter 新数组', () => {
    const source = read('assets/script/app/zcds/model/ZCGameModel.ts');
    const advance = bodyOf(source, 'private advance(dt: number): void {', 1100);
    assert.doesNotMatch(advance, /combatEvents\s*=\s*this\.state\.combatEvents\.filter/, '不得每步 filter');
    assert.match(advance, /const combatEvents = this\.state\.combatEvents;/, '持有原数组');
    assert.match(advance, /combatEvents\.length = write;/, '原地截断');
});

test('P2-5 HUD 席位计数：走一次性缓存，不再逐席位全表 filter', () => {
    const source = read('assets/script/app/zcds/model/ZCGameModel.ts');
    const count = bodyOf(source, 'private territoryCount(owner: ZCOwner): number {', 450);
    assert.match(count, /this\.territoryCounts/, '使用席位计数缓存');
    assert.doesNotMatch(count, /state\.hexes\.filter/, '不得逐次全表 filter');
    assert.match(source, /private readonly territoryCounts = new Map<ZCFaction, number>\(\);/, '缓存字段');
    assert.match(source, /this\.territoryCountsReady = false;/, '归属变化后失效');
});

test('P2-9 防御塔：单次扫描取最近目标，不 filter + sort', () => {
    const source = read('assets/script/app/zcds/model/ZCGameModel.ts');
    const towers = bodyOf(source, 'private updateTowers(dt: number): void {', 1400);
    assert.match(towers, /let targetDistance = Number\.POSITIVE_INFINITY;/, '保留最小距离');
    assert.doesNotMatch(towers, /\.sort\(/, '不得 sort 候选');
    assert.doesNotMatch(towers, /\.filter\(/, '不得 filter 候选');
});

test('P2-3/P2-4 静态帧：复用边界掩码与渲染入参对象', () => {
    const source = read('assets/script/app/zcds/view/ZCGameRenderWorld.ts');
    assert.match(source, /buildTerritoryBoundaryMasks\(this\.map, this\.ownerForHex, this\.boundaryMasks\)/,
        '边界掩码 Map 复用');
    assert.match(source, /const renderArgs = this\.hexRenderArgs;/, '渲染入参复用');
    assert.match(source, /view\.render\(renderArgs\)/, '不再逐格字面量');
    assert.doesNotMatch(bodyOf(source, 'private renderHexSystem(frame: ZCGameRenderFrame): void {', 900),
        /view\.render\(\{/, 'renderHexSystem 内不得出现参数对象字面量');
});

test('P2-10 中立特性：命中集合不再用 includes，距离不用 hypot', () => {
    const source = read('assets/script/app/zcds/model/systems/ZCNeutralFeatureSystem.ts');
    assert.match(source, /const hitUnitIds = new Set\(feature\.hitUnitIds\);/, '本拍先建 Set');
    assert.match(source, /hitUnitIds\.has\(unit\.id\)/, 'O(1) 命中判断');
    assert.doesNotMatch(source, /feature\.hitUnitIds\.includes/, '不得线性 includes');
    assert.doesNotMatch(source, /Math\.hypot/, '统一 sqrt');
});

test('P2-11 渲染中立特性：静态帧建索引，动态帧只遍历有特性的格', () => {
    const source = read('assets/script/app/zcds/view/ZCGameRenderWorld.ts');
    assert.match(source, /private readonly neutralFeatureHexStates = new Map/, '特性格索引');
    assert.match(source, /this\.refreshNeutralFeatureHexIds\(frame\)/, '静态帧重建');
    assert.match(source, /for \(const hex of this\.neutralFeatureHexStates\.values\(\)\)/, '动态帧只遍历索引');
});

test('P2-14 EventBus：emit 直接读 active 标记，不做逐 handler Map.get + includes', () => {
    const source = read('assets/script/framework/event/EventBus.ts');
    const emit = bodyOf(source, 'emit(event: E, payload?: any): void {', 200);
    assert.match(emit, /if \(item\.active\) item\.handler\.call/, 'active 快照');
    assert.doesNotMatch(emit, /\.includes\(/, '不得逐 handler includes');
    assert.equal((emit.match(/this\.handlers\.get\(event\)/g) ?? []).length, 1, '事件级 Map.get 只做一次');

});

test('P2-6 资源缓存：Map 索引 + 字符串拼接 key，不再线性 find/JSON.stringify', () => {
    const source = read('assets/script/core/asset/ScopedAssetCache.ts');
    assert.match(source, /private readonly entriesByKey = new Map</, 'key/type 索引');
    assert.doesNotMatch(source, /this\.entries\.find\(/, '不得线性 find');
    assert.doesNotMatch(source, /JSON\.stringify\(\s*\[\s*kind/, 'key 不用 JSON.stringify');
    assert.match(source, /return `\$\{kind\}\\u0000/, '分隔符拼接 key');
});

test('P2-7 存档：优先 structuredClone，去掉多余的 JSON 往返', () => {
    const source = read('assets/script/app/territory/model/TerritorySaveStore.ts');
    assert.match(source, /if \(typeof structuredClone === 'function'\) return structuredClone\(value\);/, 'structuredClone 优先');
    assert.match(source, /battle: parsed\.battle/, '解析结果直接使用');
});

test('P2-13 领地站点：候选格判断预建 Set', () => {
    const source = read('assets/script/app/territory/view/TerritoryMapView.ts');
    assert.match(source, /const openableCells = new Set\(input\.randomResourceOpenableCells\);/, '可开集合');
    assert.match(source, /const pendingCells = new Set\(input\.pendingRandomResourceCells\);/, '待定集合');
    assert.match(source, /openableCells\.has\(cellId\)/, 'O(1) 判断');
    assert.doesNotMatch(source, /input\.randomResourceOpenableCells\.includes\(cellId\)/, '不得逐格 includes');
});

test('P2-16 基地态 Graphics：复用 Set，只清已画过的格', () => {
    const source = read('assets/script/app/bigmap/view/BigMapBaseView.ts');
    assert.match(source, /private readonly selectionPainted = new Set<number>\(\);/, '描边缓存');
    assert.match(source, /if \(wasPainted \|\| isSelected\) slot\.selection\.clear\(\);/, '按需 clear');
    assert.doesNotMatch(source, /for \(const cell of this\.cells\) \{[\s\S]{0,200}slot\.selection\.clear\(\);[\s\S]{0,40}if \(isSelected\)/,
        '不得每格无条件 clear');
});

test('P2-8 索敌：owner 分桶 + 目标地块预分组，候选循环不新建坐标对象', () => {
    const targeting = read('assets/script/app/zcds/model/systems/ZCTargetingSystem.ts');
    const acquire = bodyOf(targeting, 'static acquire(', 5000);
    assert.match(acquire, /context\.unitsOf\(owner\)/, '敌方单位走 owner 桶');
    assert.match(acquire, /context\.candidateHexes\(unit\.owner\)/, '目标地块按当前 owner 预分组');
    assert.match(targeting, /const ACQUIRE_POSITION = \{ x: 0, y: 0 \};/, '候选坐标复用');
    assert.doesNotMatch(acquire, /const candidatePosition = \{/, '不得每次 acquire 新建坐标对象');

    const registry = read('assets/script/app/zcds/model/systems/ZCUnitRegistry.ts');
    assert.match(registry, /private readonly byOwner = new Map/, 'owner 索引');
    assert.match(registry, /unitsOf\(owner: ZCOwner\)/, 'owner 查询入口');
    assert.match(registry, /changeOwner\(unit: ZCUnitState, owner: ZCOwner\)/, '阵营迁移入口');

    const model = read('assets/script/app/zcds/model/ZCGameModel.ts');
    assert.match(model, /private readonly candidateHexesByOwner = new Map/, '地块目标分组');
    assert.match(model, /unitsOf: \(owner\) => this\.units\.unitsOf\(owner\)/, '索敌上下文接入 owner 索引');
    assert.match(model, /candidateHexes: \(owner\) =>/, '索敌上下文接入地块分组');
});
