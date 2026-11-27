import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compileZCNeutralResourceCatalog } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap, ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { findCatalogCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import {
    ZC_MONSTER_FOCUS_TOAST,
    ZC_MONSTER_FOCUS_SPINE_SCALE,
    zcMonsterFocusSpineArtLiftPx,
    zcMonsterFocusSpineScale,
    zcMonsterFocusSpineY,
} from '../assets/script/app/zcds/model/ZCMonsterPresentation';

/**
 * 野怪集火：特效再下移 100px + 放大 1.5 倍 + 点击后的三句提示（2026-11-26 第 56 批）。
 *
 * 需求原文：「野怪特效按钮需要下移100px，在野怪血条上方间隔3px即可，特效按钮需要放大1.5倍，
 * 点击特效按钮后弹出提示UI，地块相邻后才能集火野怪，激活野怪后，点击按钮，弹出屏幕中间弹出
 * 文字提示，开始激活野怪，点击取消集火，取消集火时弹出提示【集火取消】」。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(path, 'utf8');
const HEX_SOURCE = read('assets/script/app/zcds/view/ZCHexView.ts');
const CONTROLLER_SOURCE = read('assets/script/app/zcds/application/ZCBattleRuntimeController.ts');
const CONTRACT_SOURCE = read('assets/script/app/zcds/application/ZCBattleRuntimeContract.ts');
const COMPOSITION_SOURCE = read('assets/script/app/bootstrap/battle/BattleComposition.ts');
const PRESENTATION_SOURCE = read('assets/script/app/zcds/model/ZCMonsterPresentation.ts');

const tableNames = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'monsterCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'neutralResourceGroup', 'neutralEnhanceGate',
    'skillAttrModifier', 'generalStar'];
const tables = Object.fromEntries(tableNames.map(name => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) =>
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]])))];
})) as unknown as ZCPvpTables;

/**
 * 🔴 主城自带守卫（`pvpCard` id=1001「主角」）不进入卡池，源表 `baseHp` 就是 0，而
 * `ZCPvpTableParser.parseCard` 要求 `baseHp > 0` —— 于是整份表**编译阶段**就抛错。
 *
 * 2026-11-26 17:55 上游把整个 `assets/remoteRef/` 全量重转了一遍（36 张表时间戳一致），
 * 这张表的 `baseHp` 就落回了源表的 0。这与本用例要测的「集火判据」毫无关系，但会让 ① 连
 * fixture 都建不起来。这里只把这种"不进入卡池的守卫行"补到 1 让编译过得去，**不动源表、
 * 不动产物**：该收紧的地方是配表校验那条线（`zcds-client-combat-config` 一类），不是这里。
 */
function patchGuardCardHp(pvpTables: ZCPvpTables): void {
    for (const row of pvpTables.pvpCard ?? []) {
        if (typeof row.baseHp === 'number' && row.baseHp <= 0) row.baseHp = 1;
    }
}

patchGuardCardHp(tables);

/**
 * 一颗野怪 + 一圈**全中立**的邻居（默认不与我方相邻 ⇒ 集火被拦）。
 * 用例里再按需要把某个邻居改成我方已建成地块。
 */
function monsterFixture() {
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/normal.json', 'utf8')));
    const base = captureZCMatchConfig();
    const card = findCatalogCard('68001');
    ZC_RUNTIME_CONFIG.updateCatalogs({ neutralResources: compileZCNeutralResourceCatalog([
        { groupId: 14001, id: 1400101, groupName: '测试野怪', resourceType: 11, weight: 10000,
            param: { resId: '68001', wakeRange: 2, reviveRate: 1 } },
    ], new Map([[card.id, card]]), []) });
    const config = { ...base, map: { ...base.map, hexes: base.map.hexes.map(point => ({ ...point })), resolvedResources: [] },
        rules: { ...base.rules, enemyAiIntervalSeconds: 10000 } };
    const state = ZCSnapshotCodec.createInitialState(config);
    const hex = state.hexes.find(cell => config.map.hexes[cell.id].playable && cell.owner === 'neutral'
        && config.map.hexes[cell.id].neighbors.length === 6);
    assert.ok(hex, '普通地图上必须能找到六边形中立格');
    hex.neutralResourceId = 1400101;
    const neighbors = config.map.hexes[hex.id].neighbors;
    //  邻居全部抹成空中立：不然出生点附近本来就有的我方地块会让「不相邻」这条测不到。
    for (const id of neighbors) Object.assign(state.hexes[id], { owner: 'neutral', building: 'none', hp: 0, maxHp: 0 });
    return { config, state, hex, neighbors };
}

function buildNeighbor(state: { hexes: Record<number, { owner: string; building: string; hp: number; maxHp: number }> },
    neighborId: number): void {
    Object.assign(state.hexes[neighborId], { owner: 'player', building: 'barracks', hp: 10, maxHp: 10 });
}

test('① 集火拦截原因与开关同一条判据：不相邻 → 相邻可切 → 冷却 → 可取消', () => {
    const f = monsterFixture();
    const model = new ZCGameModel(f.state, () => 0, f.config);
    //  🔴 构造时会 `decode` 一份快照（不是同一个对象），断言必须看模型自己那份。
    const state = (model as unknown as { state: typeof f.state }).state;
    const monster = state.hexes[f.hex.id];
    assert.ok(monster.neutralFeature, '野怪格必须被中立特性初始化（否则按钮都没地方长）');

    //  不相邻：按钮可点，但模型必须回原因（不是"静默什么都没发生"）。
    assert.equal(model.toggleMonsterFocus(f.hex.id), false);
    assert.deepEqual(model.toggleMonsterFocusResult(f.hex.id), { ok: false, kind: null, reason: 'not-adjacent' });
    assert.deepEqual(monster.neutralFeature.focusOwners ?? [], [], '被拦时不能偷着把野怪唤醒');

    //  相邻地块建好 ⇒ 立刻可切（解锁是按棋盘实时算的，不用等下一拍）。
    //  ⚠️ 每次调用都会真的切（有副作用），所以只调一次再断言，别为了读 `reason` 多调一次。
    buildNeighbor(state, f.neighbors[0]);
    assert.deepEqual(model.toggleMonsterFocusResult(f.hex.id), { ok: true, kind: 'started', reason: null });
    assert.deepEqual(monster.neutralFeature.focusOwners, ['player']);
    assert.equal(monster.neutralFeature.awake, true, '首次集火顺带唤醒');

    //  刚切完就在冷却里：回 cooldown，状态不动。
    assert.deepEqual(model.toggleMonsterFocusResult(f.hex.id), { ok: false, kind: null, reason: 'cooldown' });
    assert.deepEqual(monster.neutralFeature.focusOwners, ['player']);

    //  冷却过了 ⇒ 这一下是"关"，`kind` 必须能区分（控制器靠它选「集火取消」那句）。
    state.elapsedSeconds = 3;
    assert.deepEqual(model.toggleMonsterFocusResult(f.hex.id), { ok: true, kind: 'cancelled', reason: null });
    assert.deepEqual(monster.neutralFeature.focusOwners, []);

    //  非对局中：两个都是 null ⇒ 控制器不弹任何东西。
    state.status = 'defeat';
    assert.deepEqual(model.toggleMonsterFocusResult(f.hex.id), { ok: false, kind: null, reason: null });
});

test('② 三句提示文案逐字对齐需求', () => {
    assert.equal(ZC_MONSTER_FOCUS_TOAST['not-adjacent'], '相邻地块才能集火野怪');
    assert.equal(ZC_MONSTER_FOCUS_TOAST.started, '开始激活野怪');
    assert.equal(ZC_MONSTER_FOCUS_TOAST.cancelled, '集火取消');
    //  冷却也点了按钮 ⇒ 必须给一句，否则玩家以为点漏了。
    assert.equal(ZC_MONSTER_FOCUS_TOAST.cooldown, '集火冷却中，请稍候');
});

test('③ 特效锚点：美术底边贴血条 + 3，放大 1.5 倍后底边不飘', () => {
    const barTopY = 200;
    const baseScale = 0.5;                       // prefab 上的 `_lscale`
    const boundsY = 200;                         // 骨架 `bounds.y`
    const scale = zcMonsterFocusSpineScale(baseScale);
    assert.equal(scale, baseScale * ZC_MONSTER_FOCUS_SPINE_SCALE);
    //  放大之后美术更高 ⇒ 原点要让得更多，可见底边仍然在同一条线上。
    const y = zcMonsterFocusSpineY(barTopY, zcMonsterFocusSpineArtLiftPx(boundsY, scale));
    assert.equal(y, barTopY + 3 - boundsY * scale);
    assert.equal(y + boundsY * scale, barTopY + 3, '可见底边 = 血条顶边 + 3');
});

test('④ 视图：按钮恒可点，缩放基准存了要还原', () => {
    //  🔴 不再有 `unlocked && remaining <= 0` 这种"点不动"的分支：点不动 = 没反馈。
    assert.doesNotMatch(HEX_SOURCE, /this\.monsterFocusButton\.interactable = unlocked && remaining <= 0/,
        '旧的可点性判据必须删干净');
    assert.match(HEX_SOURCE, /this\.monsterFocusButton\.interactable = true;/, '按钮恒可点');
    assert.match(HEX_SOURCE, /private monsterSpineBaseScale: Vec3 \| null = null;/, '要存基准缩放才能还原');
    assert.match(HEX_SOURCE, /this\.monsterSpineBaseScale = null;/, '退出野怪态要清掉基准（池化复用）');
    //  美术抬升只在第一次读骨架，之后走缓存 / 兜底。
    assert.match(HEX_SOURCE, /private monsterFocusSpineArtLiftValue\(\): number \| null \{/);
    assert.match(HEX_SOURCE, /skeletonData\.getRuntimeData\(true\)/, '读骨架 bounds 的入口');
    assert.match(PRESENTATION_SOURCE, /export const ZC_MONSTER_FOCUS_SPINE_ART_LIFT = 200;/,
        '读不到骨架时的兜底（就是实测那 100px 的一半 × 缩放 0.5）');
});

test('⑤ 控制器：按模型结果弹吐司，同句 1 秒内不重复', () => {
    assert.match(CONTROLLER_SOURCE, /const result = this\.model\.toggleMonsterFocusResult\(hexId\);/);
    assert.match(CONTROLLER_SOURCE, /const key = result\.reason \?\? result\.kind;/, '被拦给原因、成功给开/关');
    assert.match(CONTROLLER_SOURCE, /if \(!key\) return;/, '两个都空 ⇒ 不弹');
    assert.match(CONTROLLER_SOURCE, /if \(result\.kind\) this\.render\(\);/, '只有真的切了才重渲染');
    assert.match(CONTROLLER_SOURCE, /this\.services\.toast\?\.\(ZC_MONSTER_FOCUS_TOAST\[key\]\);/);
    assert.match(CONTROLLER_SOURCE, /const MONSTER_FOCUS_TOAST_REPEAT_SECONDS = 1;/);
    assert.match(CONTROLLER_SOURCE,
        /if \(last && last\.key === key && now - last\.at < MONSTER_FOCUS_TOAST_REPEAT_SECONDS\) return;/,
        '同句去重：连点不会把吐司队列刷满');
    //  🔴 application 层不许直接 import `common/Toast`（它顶层 `import 'cc'`，
    //  而 node 用例会直接 import 本控制器）。装配交给组合根。
    assert.doesNotMatch(CONTROLLER_SOURCE, /from '\.\.\/\.\.\/common\/Toast'/, '控制器不能直接引 Toast');
    assert.match(CONTRACT_SOURCE, /readonly toast\?: \(message: string\) => void;/, '出口挂在 services 上');
    assert.match(COMPOSITION_SOURCE, /toast\(message\) \{ Toast\.show\(message\); \},/, '组合根接真实实现');
});

test('⑥ 提示走的是"屏幕中央"那条公共吐司，而不是新造一套 UI', () => {
    const toast = read('assets/script/app/common/Toast.ts');
    assert.match(toast, /static show\(message: string\): void/);
    //  根节点 `_lpos = (0,0)` + 锚点 (0.5,0.5) ⇒ 就是这个节点摆在屏幕正中，
    //  所以「屏幕中间弹出文字提示」不需要另做一套 UI。
    const prefab = JSON.parse(read('assets/resources/ui/common/Toast.prefab')) as { __type__: string; _name?: string; _lpos?: { x: number; y: number }; _anchorPoint?: { x: number; y: number } }[];
    const root = prefab.find(node => node.__type__ === 'cc.Node' && node._name === 'Toast');
    assert.ok(root?._lpos, 'Toast 根节点必须还在');
    assert.deepEqual([root._lpos!.x, root._lpos!.y], [0, 0], '根节点在屏幕中央');
    const transform = prefab.find(component => component.__type__ === 'cc.UITransform');
    assert.deepEqual([transform?._anchorPoint?.x, transform?._anchorPoint?.y], [0.5, 0.5], '锚点居中');
});
