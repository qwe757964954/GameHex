import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import * as HeadArtModel from '../assets/script/app/HeadArtModel';
import * as BattleStartModel from '../assets/script/app/battle/BattleStartModel';
import type { ZCBattleStart, ZCBattleUnit } from '../assets/script/app/battle/BattleStartModel';
import * as PvpInfoModel from '../assets/script/app/battle/PvpInfoModel';
import { ZCGamePreload } from '../assets/script/app/zcds/application/ZCGamePreload';
import type { ZCGamePreparedResources } from '../assets/script/app/zcds/application/ZCGameLoader';

function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
/**
 * 沙箱里的「本机角色 id」。必须与用例里构造的我方单元 `roleId` 一致 ——
 * `ProcedureMatching` 用它（`splitBattleUnits(units, roleId)`）从回包里认出自己那一只。
 */
const SELF_ROLE_ID = '10001';
/**
 * 沙箱里的「本机头像 id」。取 `head` 表里真有的 70002（凯尔萨斯）——
 * 与其绑定的 `icon.json` 条目是 `ui://图标/icon_hero_head_40010`。
 */
const SELF_AVATAR_ID = '70002';
const prepared = {
    hudPrefab: { name: 'hud' },
    baseMatchConfig: { map: {}, enemyDeck: [] },
} as unknown as ZCGamePreparedResources;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('匹配预加载只启动一次，移交后匹配退出保留资源，对局退出释放', async () => {
    let calls = 0, released = 0;
    const preload = new ZCGamePreload({ prepare: async scope => { calls++; scope!.defer(() => released++); return prepared; } });
    assert.equal(calls, 1);
    assert.equal(await preload.ready, prepared);
    assert.equal(await preload.ready, prepared);
    const battle = new ResourceScope('battle'); preload.transferTo(battle);
    preload.releaseFromMatching(); assert.equal(released, 0);
    assert.throws(() => preload.transferTo(battle), /已移交/);
    battle.dispose(); battle.dispose(); assert.equal(released, 1);
});

test('匹配期间离开立即释放，迟到加载也会释放，不能移交已取消资源', async () => {
    let released = 0; let scope!: ResourceScope;
    const pending = deferred<ZCGamePreparedResources>();
    const preload = new ZCGamePreload({ prepare: current => { scope = current!; scope.defer(() => released++); return pending.promise; } });
    preload.releaseFromMatching(); assert.equal(released, 1);
    scope.defer(() => released++); assert.equal(released, 2);
    pending.resolve(prepared); await preload.ready;
    assert.throws(() => preload.transferTo(new ResourceScope('battle')), /取消/);
});

test('后台预加载提前失败时释放资源，之后对局仍能收到原始错误', async () => {
    let released = 0;
    const pending = deferred<ZCGamePreparedResources>();
    const preload = new ZCGamePreload({ prepare: scope => { scope!.defer(() => released++); return pending.promise; } });
    pending.reject(new Error('missing battle asset')); await flush();
    assert.equal(released, 1);
    await assert.rejects(preload.ready, /missing battle asset/);
});

function procedures(sessionPreload: ZCGamePreload | null = null) {
    const loads: Array<ReturnType<typeof deferred<ZCGamePreparedResources>>> = [];
    const scopes: ResourceScope[] = [];
    const options: any[] = [];
    /** 匹配过程中 `page.updateMine()` 收到的我方数据（服务端回包到达后刷新用）。 */
    const mineUpdates: any[] = [];
    const navigations: any[] = [];
    /** 图标加载器收到的每次请求（`{name, root}`），用来断言预取范围。 */
    const iconRequests: { name: string; root: string }[] = [];
    let released = 0, destroyed = 0, staged: any;
    /** 对局组件实例收到的单局 entry，用来验证 seed 随实例数据交接。 */
    let stagedSeed: string | null | undefined;
    // 「开始游戏」服务端的替身：`serverResponse` 是服务端**会**回什么，
    // `lastResult` 是客户端缓存（`startBattle` 成功后写入、`clearLastBattleStart` 清空），
    // 与 `BattleStartService` 的真实语义对齐 —— 否则 onEnter 里那次 clear 会把准备的数据一起抹掉。
    let serverResponse: ZCBattleStart | null = null;
    let lastResult: ZCBattleStart | null = null;
    /** `CmdPvpInfoReqMsg` 的替身响应（默认 `null` = 拿不到，界面保留本地占位）。 */
    let pvpInfoResponse: PvpInfoModel.ZCPvpInfo | null = null;
    class Loader {
        prepare(scope?: ResourceScope) {
            if (scope) { scopes.push(scope); scope.defer(() => released++); }
            const pending = deferred<ZCGamePreparedResources>(); loads.push(pending); return pending.promise;
        }
    }
    /**
     * 匹配界面组件的替身。**必须是同一个对象**：`updateMine` 要在 `onEnter` 之后
     * 由 `battleStartTask.then()` 异步调用，每次 `getComponent` 都新建对象就抓不到。
     */
    const page = {
        beginMatch: (value: unknown) => options.push(value),
        updateMine: (value: unknown) => mineUpdates.push(value),
    };
    class Base {
        assets = { load: async () => ({}) };
        sessionAssets = { takeBattlePreload: () => sessionPreload };
        configs = {};
        scope: ResourceScope | null = null;
        host = { addComponent: () => ({ initialize: (entry: any) => { staged = entry; stagedSeed = entry.battleSeed; }, shutdown() {}, destroy() {} }) };
        log() {} error() {}
        navigate(route: string, params: unknown) { navigations.push({ route, params }); }
        releaseResourceScope() { this.scope?.dispose(); this.scope = null; }
        _adoptResourceScope(scope: ResourceScope) { this.scope = scope; }
        onDestroy() { this.releaseResourceScope(); }
    }
    const dependencies: Record<string, unknown> = {
        cc: { Prefab: class {}, Node: class {}, Vec3: { ZERO: {} }, instantiate: () => ({ setParent() {}, setPosition() {}, getComponent: () => page, destroy: () => destroyed++ }) },
        '../../core/runtime/GameRoute': { GameRoute: { Battle: 'battle' } },
        '../../framework/procedure/ProcedureBase': { ProcedureBase: Base },
        // 用真模块（ArtPaths 不 import cc，Node 里能直接读），免得根目录改名后这里静默变 undefined
        '../ArtPaths': ArtPaths,
        // 用真模块（HeadArtModel 只依赖零引擎的 RequestGuard + ArtPaths）——
        // 「img 经 head+icon 两层变成资源名」「写头像必须连根目录一起写」「解不出就不调加载器」
        // 这几条口径不该在沙箱里被替身糊掉；`onPreload` 的预取也因此走的是真路径
        // （`preloadHeadByIds` → `loader(name, HEAD_ART_ROOT)`），断言才有意义。
        '../HeadArtModel': HeadArtModel,
        // 用真模块（BattleStartModel 只依赖零引擎的 RequestGuard，Node 里能直接读）——
        // 「服务端单元 → 界面数据」的口径不该在这里被替身糊掉。
        '../battle/BattleStartModel': BattleStartModel,
        // 服务层经 GameNet 拉进 cc，Node 里 import 就炸，只能替身；替身必须保住两个语义：
        // `startBattle` 等回包**之后**才写缓存、`clearLastBattleStart` 只清缓存。
        // 前者不能写成同步 —— 否则 `pickOpponents` 不等也能拿到数据，
        // "选人前必须先 await 一次"这条约束就验不出来了。
        '../battle/BattleStartService': {
            startBattle: () => Promise.resolve().then(() => {
                lastResult = serverResponse;
                return serverResponse;
            }),
            getLastBattleStart: () => lastResult,
            clearLastBattleStart: () => { lastResult = null; },
        },
        // 图标加载器的替身必须**是个函数**：`ProcedureMatching.onPreload` 会直接调它预取
        // 本机头像（`image/icon/head`），给个对象会在沙箱里 `is not a function` 炸掉。
        // 顺带把每次请求记下来 —— 预取范围（名字 + 根目录）是要被断言的。
        '../matching/MatchIcons': {
            createMatchIconLoader: () => (name: string, root: string) => {
                iconRequests.push({ name, root });
                return Promise.resolve(null);
            },
            preloadMatchIcons: async (names: readonly string[], root: string) => {
                for (const name of names) iconRequests.push({ name, root });
            },
        },
        // PVP 玩法信息（我方段位/积分）：替身保住两条契约 —— ①拿不到返回 `null`（调用方保留本地值，
        // 不能抛）；②**永远是异步的**（真实现要过 socket，同步返回会让"到达即刷新"变成永真）。
        '../battle/PvpInfoService': {
            fetchPvpInfo: () => Promise.resolve().then(() => pvpInfoResponse),
            // 上一局的缓存（"打完一局加减分后不闪空"用的）。这里给 `null` = 从没缓存过，
            // 与接入缓存之前的行为逐位一致 —— 用例验的是 `fetchPvpInfo` 那条真链路。
            getLastPvpInfo: () => null,
            clearLastPvpInfo: () => { /* 缓存清空，用例不关心 */ },
        },
        // 用真模块（PvpInfoModel 只依赖零引擎的 RequestGuard，Node 里能直接读）——
        // 「服务端 grade 变成段位名、score 为 0 时保留原值」这条口径不该在沙箱里被替身糊掉。
        '../battle/PvpInfoModel': PvpInfoModel,
        '../matching/MatchingPage': { MatchingPage: class {} },
        // 段位/神器/头像「id → 显示值」：用**真** buildMatchProfileLookup（纯函数）配四张迷你表
        // —— 「服务端 gradeId 变成段位名」「img 经 head+icon 两层变成资源名」这两条口径
        // 不该在沙箱里被替身糊成空串。
        '../matching/MatchProfileConfig': {
            loadMatchProfileLookup: async () => BattleStartModel.buildMatchProfileLookup(
                [{ gradeId: 1001, gradeName: '菜鸟护卫Ⅰ' }],
                [{ artifactId: 69001, name: '希瓦的守护' }],
                [{ resId: Number(SELF_AVATAR_ID), icon: '图标_头像_凯尔萨斯' }],
                [{ key: '图标_头像_凯尔萨斯', path: 'ui://图标/icon_hero_head_40010' }],
            ),
        },
        // 本机身份：替身给出固定的 roleId / 昵称 / 头像 id（真实现读 `CmdRole` 缓存，属引擎侧）。
        // `buildSelfPlayerData` 的替身必须**复刻真实现的口径**：昵称与头像各自独立覆盖，
        // 头像要经共用的解析器（`lookup.headArt`）与共用的写入函数（`applyHeadArt`）才换成
        // 资源名 —— 这样才验得出 `ProcedureMatching` 有没有把 `profileLookup` 传进来
        // （不传 → `avatar` 恒空 → 断言必红）。
        '../matching/MatchSelfProfile': {
            readSelfIdentity: () => ({ roleId: SELF_ROLE_ID, name: '本机昵称', avatarId: SELF_AVATAR_ID }),
            buildSelfPlayerData: (identity: { name?: string; avatarId?: string } | null, lookup?: any) => {
                const data: any = {
                    name: identity && identity.name ? identity.name : '本地占位',
                    avatarIcon: 'img_people',
                    power: 1,
                    rank: '本地段位',
                    trophy: 1,
                    artifactName: '本地神器',
                    artifactIcon: 'icon_faqi',
                    stats: [],
                };
                if (identity) HeadArtModel.applyHeadArt(data, identity.avatarId ?? '', lookup?.headArt);
                return data;
            },
        },
        '../matching/MatchPool': {
            LOCAL_PLAYER: {},
            // 本地对手池要带上段位/神器名：它们是"服务端没给 / 表里查不到"时的兜底值，
            // 替身只给 name 就验不出「保留兜底而不是清空」这条口径。
            pickLocalOpponent: () => ({ name: 'enemy', power: 1, rank: '本地段位', artifactName: '本地神器' }),
        },
        '../matching/MatchTipsConfig': { loadMatchTips: async () => [] },
        // `ProcedureMatching` 会直接读神器/CmdRole 推送缓存（r268 起），两处都有 try/catch 兜着，
        // 但**模块本身**必须在白名单里 —— 缺了会在沙箱 require 阶段就 `Unexpected dependency`
        // 抛掉，整个文件的所有用例一起红（这正是"新增 import 不补依赖"那个坑）。
        // 返回空表即可：那两处只用于日志与"没推送就留空占位"。
        '../net/CacheMgr': { CacheMgr: { instance: { getTlCmdArtifact: () => [], getTlCmdRole: () => [] } } },
        '../zcds/ZCGame': { MAP_DIRECTORY: 'config/maps', ZCGame: class ZCGame {} },
        '../zcds/application/ZCGameLoader': { ZCGameLoader: Loader },
        '../zcds/application/ZCGamePreload': { ZCGamePreload },
        '../zcds/application/ZCClientCombatConfig': { buildZCClientCombatConfig: (config: unknown) => ({ config, skipped: [] }) },
        '../zcds/application/ZCPveCombatConfig': { buildZCPveEnemyDecks: () => ({}) },
        '../zcds/model/ZCMatchConfig': { captureZCMatchConfig: (config: unknown) => config ?? { map: {}, enemyDeck: [] } },
        '../zcds/model/ZCRankBoard': { buildSeatProfiles: () => new Map() },
        '../territory/model/TerritorySaveStore': { TerritorySaveStore: { resolveBattle() {} } },
        '../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore: () => ({ resolveBattle() {} }) },
    };
    const load = (name: string) => {
        const context = { exports: {} as any, require: (name: string) => {
            if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
            return dependencies[name];
        } };
        const code = ts.transpileModule(readFileSync(`assets/script/app/procedure/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        runInNewContext(code, context); return new context.exports[name]();
    };
    return { matching: load('ProcedureMatching'), battle: load('ProcedureGame'), loads, scopes, options, mineUpdates, navigations, iconRequests,
        setServerBattleStart(value: ZCBattleStart | null) { serverResponse = value; },
        setPvpInfo(value: PvpInfoModel.ZCPvpInfo | null) { pvpInfoResponse = value; },
        get lastBattleStart() { return lastResult; },
        get released() { return released; }, get destroyed() { return destroyed; }, get staged() { return staged; },
        get stagedSeed() { return stagedSeed; } };
}

test('匹配开始即加载，对局等待同一 Promise，界面退出后战斗引用保持有效', async () => {
    const fixture = procedures();
    const matchingScope = new ResourceScope('matching');
    await fixture.matching.onPreload(undefined, { resources: matchingScope, cancelled: false });
    assert.equal(fixture.loads.length, 0, '匹配界面预加载期间不提前阻塞加载战斗资源');
    // 本机头像必须在预加载阶段就取好：否则进界面第一帧画的是 prefab 里的占位图
    // `img_people`，`resources.load` 回来（真机实测 ~0.4s）才跳成真头像 —— 眼见的"头像闪一下"。
    assert.ok(
        fixture.iconRequests.some((r) => r.name === 'icon_hero_head_40010' && r.root === ArtPaths.HEAD_ART_ROOT),
        'onPreload 必须预取本机头像（名字经 head+icon 解出、根目录 image/icon/head）',
    );
    fixture.matching._adoptResourceScope(matchingScope); fixture.matching.onEnter();
    assert.equal(fixture.options.length, 1); assert.equal(fixture.loads.length, 1);
    const opponent = { name: 'enemy', power: 100 };
    fixture.options[0].onMatched(opponent);
    const params = fixture.navigations[0].params;
    assert.equal(params.opponent, opponent);
    const scope = new ResourceScope('battle');
    let done = false;
    const ready = fixture.battle.onPreload(params, { resources: scope, cancelled: false }).then(() => { done = true; });
    await flush(); assert.equal(done, false); assert.equal(fixture.destroyed, 0);
    fixture.loads[0].resolve(prepared); await ready;
    assert.equal(fixture.loads.length, 1, '切到对局时不能重新加载');
    fixture.matching.onLeave(); assert.equal(fixture.destroyed, 1); assert.equal(fixture.released, 0);
    fixture.battle._adoptResourceScope(scope); fixture.battle.onEnter();
    assert.equal(fixture.staged, prepared);
    fixture.battle.onLeave(); assert.equal(fixture.released, 1);
});

test('匹配直接接管登录后完成的对局预加载，不再启动第二次加载', async () => {
    let released = 0;
    const loginPreload = new ZCGamePreload({
        prepare: async scope => {
            scope!.defer(() => released++);
            return prepared;
        },
    });
    await loginPreload.ready;
    const fixture = procedures(loginPreload);
    const matchingScope = new ResourceScope('matching');
    await fixture.matching.onPreload(undefined, { resources: matchingScope, cancelled: false });
    fixture.matching._adoptResourceScope(matchingScope);
    fixture.matching.onEnter();
    assert.equal(fixture.loads.length, 0, '登录后已准备资源时不能再调用 ZCGameLoader');

    fixture.options[0].onMatched({ name: 'enemy', power: 100 });
    const battleScope = new ResourceScope('battle');
    await fixture.battle.onPreload(fixture.navigations[0].params, { resources: battleScope, cancelled: false });
    fixture.matching.onLeave();
    assert.equal(released, 0, '匹配退出不能释放已经移交给对局的资源');
    fixture.battle._adoptResourceScope(battleScope);
    fixture.battle.onEnter();
    fixture.battle.onLeave();
    assert.equal(released, 1);
});

test('等待战斗资源期间取消导航，不移交资源或进入对局，匹配离开负责释放', async () => {
    const fixture = procedures();
    await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false });
    fixture.matching.onEnter(); fixture.options[0].onMatched({ name: 'enemy' });
    const context = { resources: new ResourceScope('battle'), cancelled: false };
    const ready = fixture.battle.onPreload(fixture.navigations[0].params, context);
    context.cancelled = true; context.resources.dispose(); fixture.battle.onPreloadCancelled();
    fixture.loads[0].resolve(prepared); await ready;
    assert.equal(fixture.battle.preparedResources, null); assert.equal(fixture.staged, undefined);
    assert.equal(fixture.released, 0);
    fixture.matching.onLeave(); assert.equal(fixture.released, 1);
});

test('旧匹配回调不能启动新战局，重新匹配创建新预加载，直接进入战斗保留加载入口', async () => {
    const fixture = procedures();
    const enter = async () => { await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false }); fixture.matching.onEnter(); };
    await enter(); fixture.matching.onLeave(); await enter();
    fixture.options[0].onMatched({ name: 'stale' }); assert.equal(fixture.navigations.length, 0);
    fixture.options[1].onMatched({ name: 'current' }); assert.equal(fixture.navigations.length, 1);
    assert.equal(fixture.loads.length, 2);
    fixture.matching.onLeave();
    fixture.loads[0].resolve(prepared); fixture.loads[1].resolve(prepared); await flush();
    const directScope = new ResourceScope('direct-battle');
    const ready = fixture.battle.onPreload(undefined, { resources: directScope, cancelled: false });
    assert.equal(fixture.loads.length, 3);
    assert.equal(fixture.scopes[2], directScope);
    fixture.loads[2].resolve(prepared); await ready;
    assert.equal(fixture.battle.preparedResources, prepared);
});

test('管理器销毁匹配流程时释放后台资源，迟到回调不能进入战斗', async () => {
    const fixture = procedures();
    const scope = new ResourceScope('matching');
    await fixture.matching.onPreload(undefined, { resources: scope, cancelled: false });
    fixture.matching._adoptResourceScope(scope); fixture.matching.onEnter();
    fixture.matching.onDestroy();
    assert.equal(fixture.released, 1); assert.equal(fixture.destroyed, 1);
    assert.equal(scope.disposed, true);
    fixture.loads[0].resolve(prepared); await flush();
    fixture.options[0].onMatched({ name: 'late' });
    assert.equal(fixture.navigations.length, 0);
});

const battleUnit = (
    campId: number, name: string, power: number, roleId: string, over: Partial<ZCBattleUnit> = {},
): ZCBattleUnit => ({
    campId, roleId, serverId: 1, name, power,
    avatarId: '', headFrameId: '', gradeId: 0, gradeScore: 0, heroIds: [], artifactId: 0, artifactLevel: 0,
    ...over,
});

test('开始游戏：服务端下发对局数据时，选对手用敌方单元，并把本局数据带进对局', async () => {
    const fixture = procedures();
    fixture.setServerBattleStart({
        battleId: 'battle-1',
        seed: '1234567890123456789',
        version: '1.0.0',
        units: [
            battleUnit(1, '我方', 111, SELF_ROLE_ID, {
                gradeId: 1001, gradeScore: 55, artifactId: 69001, avatarId: SELF_AVATAR_ID,
            }),
            battleUnit(2, '服务端对手', 8888, '20002', { gradeId: 9999 }),
        ],
    });
    await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false });
    fixture.matching.onEnter();

    // 「开始游戏」在 onEnter 里就发出去了，但它是异步的：不 await 就拿不到缓存 ——
    // 这正是 MatchingPage 要在选人前 await 一次 awaitReady 的原因。
    assert.equal(fixture.lastBattleStart, null, '同步阶段缓存还是空的（请求在途）');

    const options = fixture.options[0];
    assert.equal(typeof options.awaitReady, 'function', '选人前必须能等在途请求');
    assert.equal(options.mine.name, '本机昵称', '匹配中我方条先显示本机资料（CmdRole 缓存）');
    assert.equal(options.mine.avatarIcon, 'icon_hero_head_40010', '本机头像 id 经 head+icon 两层解成资源名');
    assert.equal(options.mine.avatarRoot, ArtPaths.HEAD_ART_ROOT, '头像要连根目录一起给，不能还指在占位图目录');

    await options.awaitReady();
    await flush();
    // 回包到达即刷新我方条 —— 「匹配过程中显示自己的个人信息」，不等匹配成功。
    assert.equal(fixture.mineUpdates.length, 1, '服务端回包到达必须刷新我方信息条');
    const mine = fixture.mineUpdates[0];
    assert.equal(mine.name, '我方', '我方昵称取服务端单元');
    assert.equal(mine.power, 111, '我方战力取服务端单元');
    assert.equal(mine.rank, '菜鸟护卫Ⅰ', 'gradeId 经 grade 表换成段位名');
    assert.equal(mine.trophy, 55, '段位积分填奖杯位');
    assert.equal(mine.artifactName, '希瓦的守护', 'artifactId 经 pvpArtifact 表换成神器名');
    assert.equal(mine.avatarIcon, 'icon_hero_head_40010', '头像取服务端单元那份（本表里 img=70002）');
    assert.equal(mine.avatarRoot, ArtPaths.HEAD_ART_ROOT);

    const picked = options.pickOpponents()[0];
    assert.equal(picked.name, '服务端对手', '昵称取服务端敌方单元');
    assert.equal(picked.power, 8888, '战力取服务端敌方单元');
    assert.equal(picked.rank, '本地段位', '表里没有这个 gradeId → 保留本地兜底值，不能清成空');

    options.onMatched([picked]);
    const params = fixture.navigations[0].params;
    assert.equal(params.opponent, picked);
    assert.equal(params.battle?.battleId, 'battle-1', '本局服务端数据必须随 params 带进对局');
    assert.equal(params.battle?.seed, '1234567890123456789', 'seed 走字符串，不接受 number');

    // 离开匹配要清缓存，否则下一局会读到上一局的 battleId
    fixture.matching.onLeave();
    assert.equal(fixture.lastBattleStart, null);
});

test('开始游戏：服务端没数据（未连接/超时/协议没通）时退回本地对手池，对局照常进', async () => {
    const fixture = procedures();
    await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false });
    fixture.matching.onEnter();

    const options = fixture.options[0];
    assert.equal(options.mine.name, '本机昵称', '拿不到服务端数据也要显示本机资料');
    // 头像来自 `CmdRole` 缓存（登录时就有），**不依赖**「开始游戏」回包 ——
    // 所以服务端没实现这条协议时，我方头像照样是真图。
    assert.equal(options.mine.avatarIcon, 'icon_hero_head_40010', '本机头像不依赖服务端开战回包');
    assert.equal(options.mine.avatarRoot, ArtPaths.HEAD_ART_ROOT);
    await options.awaitReady();
    await flush();
    assert.equal(fixture.mineUpdates.length, 0, '没有服务端数据就不刷新我方条（保持本机资料，别清空）');
    const picked = options.pickOpponents()[0];
    assert.equal(picked.name, 'enemy', '退回 MatchPool 的本地对手');

    options.onMatched([picked]);
    assert.equal(fixture.navigations[0].params.battle, null, '降级时 battle 为 null，对局不能因此被拦');
});

/**
 * 「开始游戏」的随机种子必须**真的交到对局**（`ZCGameModel.random` 的播种入口），
 * 不能只停在 `params` 与日志里 —— 否则"接了种子"只是文档上的一句话。
 *
 *  这里**不经过 `pickOpponents()`**：它当前有独立的既有偏差（见上一条用例：
 *  `pickOpponents` 的兜底底数从本地对手池换成了硬编码空值，而用例期望没跟上），
 *  那条红不该拖住本用例的判定。`onMatched` 只要求"匹配成功 → 带着本局数据 navigate"，
 *  所以直接给一个对手即可，种子链路照样走完整。
 */
test('对局随机种子：有服务端数据时随 battle 交给 ZCGame entry，降级时显式为 null', async () => {
    const seed = '9876543210987654321';
    const online = procedures();
    const battle = {
        battleId: 'seed-battle',
        seed,
        version: '1.0.0',
        units: [battleUnit(1, '我方', 111, SELF_ROLE_ID), battleUnit(2, '对手', 8888, '20002')],
    } as ZCBattleStart;
    const params = { battle, selfRoleId: SELF_ROLE_ID };
    const scope = new ResourceScope('battle-seed');
    const ready = online.battle.onPreload(params, { resources: scope, cancelled: false });
    online.loads[0].resolve(prepared); await ready;
    online.battle._adoptResourceScope(scope);
    online.battle.onEnter(params);
    assert.equal(online.staged.resources, prepared);
    assert.equal(online.stagedSeed, seed, '对局组件实例必须收到服务端种子');

    const offline = procedures();
    const fallbackParams = { battle: null };
    const fallbackScope = new ResourceScope('battle-seed-fallback');
    const fallbackReady = offline.battle.onPreload(fallbackParams, { resources: fallbackScope, cancelled: false });
    offline.loads[0].resolve(prepared); await fallbackReady;
    offline.battle._adoptResourceScope(fallbackScope);
    offline.battle.onEnter(fallbackParams);
    assert.equal(offline.stagedSeed, null, '没有服务端数据时 entry 必须显式包含 null seed');
});
test('匹配中显示服务端 PVP 信息（段位/积分），本接口没有的列保留本地值', async () => {
    const fixture = procedures();
    // `CmdPvpInfoRspMsg.info` 真机实测形状：满级前的号就是 grade=1001 / score=0 / winCount=0。
    fixture.setPvpInfo({ grade: 1001, score: 0, winCount: 0, gradeRewardTag: 0 });
    await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false });
    fixture.matching.onEnter();
    await flush();

    assert.equal(fixture.mineUpdates.length, 1, 'PVP 信息到达必须刷新我方信息条（匹配过程中，不等匹配成功）');
    const mine = fixture.mineUpdates[0];
    assert.equal(mine.rank, '菜鸟护卫Ⅰ', 'grade 是 id → 经 grade 表换成段位名');
    assert.equal(mine.name, '本机昵称', '本接口没有昵称列 → 保留 CmdRole 缓存的本机昵称');
    assert.equal(mine.trophy, 1, 'score = 0 不是有效显示值 → 保留本地占位，不能清成 0');
    assert.equal(mine.artifactName, '本地神器', '本接口没有神器列 → 保留本地值');
    assert.equal(mine.power, 1, '本接口没有战力列 → 保留本地值');
});

test('PVP 信息与「开始游戏」回包并行到达时叠加，不互相整条覆盖', async () => {
    const fixture = procedures();
    // 两份数据各给一部分字段，且**故意让「开始游戏」那份漏掉 PVP 独有的段位**（gradeId 9999 表里没有）：
    //  叠加正确 → 段位保留 PVP 那份；写成「谁后到谁赢」 → 段位被清回本地占位。
    fixture.setPvpInfo({ grade: 1001, score: 0, winCount: 0, gradeRewardTag: 0 });
    fixture.setServerBattleStart({
        battleId: 'battle-merge',
        seed: '1',
        version: '1.0.0',
        units: [
            battleUnit(1, '我方', 111, SELF_ROLE_ID, { gradeId: 9999, gradeScore: 55, artifactId: 69001 }),
            battleUnit(2, '对手', 8888, '20002'),
        ],
    });
    await fixture.matching.onPreload(undefined, { resources: new ResourceScope('matching'), cancelled: false });
    fixture.matching.onEnter();

    const options = fixture.options[0];
    await options.awaitReady();
    await flush();

    // 两条是在途并行、到达顺序不定的。`refreshMineView` 每次都从 `mineBase` 重算，
    // 所以**最后一次刷新必定同时叠上两份**；中途那次可能只叠到先到的那一份（渐进上屏）。
    // 断言只钉「最后一次」—— 用"存在一条"会把中途那次的半成品也算进去。
    assert.ok(fixture.mineUpdates.length >= 1, '至少刷新一次');
    const last = fixture.mineUpdates[fixture.mineUpdates.length - 1];
    assert.equal(last.power, 111, '服务端单元的战力');
    assert.equal(last.artifactName, '希瓦的守护', '服务端单元的神器名（id 查表）');
    assert.equal(last.name, '我方', '昵称改用服务端单元');
    assert.equal(last.trophy, 55, '单元给了 gradeScore → 用单元的');
    assert.equal(last.rank, '菜鸟护卫Ⅰ', '单元那份 gradeId 查不到 → 保留 PVP 信息给的段位，不能被清成本地占位');
});

function loaderFixture(assets: any, configs = { initialize: async () => {}, getTable: async (_name: string) => [] }) {
    let configured = 0, injected = 0;
    const dependencies: Record<string, unknown> = {
        cc: { JsonAsset: class {}, Prefab: class {} },
        '../../ArtPaths': {
            decorFramePath: (name: string) => `decor/${name}`,
            spriteFramePath: (root: string, name: string) => `${root}/${name}/spriteFrame`,
        },
        '../view/ZCGameViewUtil': { ZC_DECOR_KEY_PATTERN: /^\d+,\d+$/ },
        './ZCGuideLoader': { ZCGuideLoader: class { async prepare() { return { entries: [], params: {}, iconFrames: new Map() }; } } },
        '../model/ZCCombatCatalog': { getAllUnitDefinitions: () => [{ unitId: 'test', prefabPath: 'visual/unit', attackProfile: { effectPrefabPath: 'visual/effect' } }] },
        // `isRandomMapCandidate` 是 `loadRandomMap` 的随机池判据：桩里缺符号会在调用时
        // 抛 TypeError（跟被测行为无关）。替身与真实实现同口径。
        '../model/ZCGameModel': {
            configureZCMap: () => configured++,
            getZCLocalPlayerCountOverride: () => null,
            isRandomMapCandidate: (layout: { playerCount?: number; cityMode?: string } | null) => {
                const count = layout?.playerCount ?? 2;
                return (count === 2 || count === 3 || count === 4)
                    && (layout?.cityMode === undefined || layout.cityMode === 'fixed' || layout.cityMode === 'select');
            },
        },
        '../model/ZCGameRuntimeConfig': {
            loadPvpTables: () => injected++,
            assertDeckUnitsPlayable() {},
            // `loadArtifactIconFrame` 用它取神器图标名（真源 = `pvpArtifact` 第一行的 `icon`）。
            getPvpRuntimeRules: () => ({ artifactIcon: '霜封冰刃' }),
        },
    };
    const context = { exports: {} as any, require: (name: string) => dependencies[name], console: { info() {}, error() {}, warn() {} } };
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    runInNewContext(code, context);
    return { loader: new context.exports.ZCGameLoader(assets, configs, 'maps', () => 0),
        get configured() { return configured; }, get injected() { return injected; } };
}

test('配置就绪后单位和特效与首屏 Prefab 并行加载，不等待外壳先完成', async () => {
    const shell = deferred<object>();
    const paths: string[] = [];
    const fixture = loaderFixture({
        load: (path: string) => { paths.push(path); return path.startsWith('visual/') ? Promise.resolve({ path }) : shell.promise; },
        loadDir: async () => [{ name: 'map', json: {} }],
    });
    const ready = fixture.loader.prepare(new ResourceScope('battle'));
    await flush();
    assert.ok(paths.includes('visual/unit')); assert.ok(paths.includes('visual/effect'));
    // 12 张战斗 Prefab（棋盘图层 ZCGameBoard + 抽卡展示卡牌 ZCGameCardReveal + 装饰条目 ZCGameDecor
    // + 自选主城 HUD ZCSpawnSelection + 传说卡出场横幅 ZCGameLegendBanner）+ 2 张单位/特效视觉 Prefab。
    assert.ok(paths.includes('ui/game/ZCGameBoard'), '棋盘图层容器与首屏 Prefab 同批并行加载');
    assert.ok(paths.includes('ui/game/ZCGameCardReveal'));
    assert.ok(paths.includes('ui/game/ZCGameDecor'), '装饰条目 prefab 与首屏 Prefab 同批并行加载');
    assert.ok(paths.includes('ui/game/ZCGameLegendBanner'), '传说卡横幅与首屏 Prefab 同批并行加载');
    // +1 =本局携带神器的图标（中立资源点「神器充能」格显示它，2026-10-08 起随首屏一起加载）。
    assert.ok(
        paths.includes('image/artifact/霜封冰刃/spriteFrame'),
        '神器图标与首屏资源同批并行加载（png 走 SpriteFrame 子资源，路径带 /spriteFrame）',
    );
    // 19 = 上面逐项 includes 过的那批 + 4 个只参与计数、没单列 includes 的路径
    // （`shaders/unit-outline-copy`、`ui/game/ZCBossPanel`、桩里的 `visual/unit` 与 `visual/effect`）。
    assert.equal(paths.length, 19);
    shell.resolve({});
    const result = await ready;
    assert.equal(result.unitVisualPrefabs.size, 1); assert.equal(result.effectVisualPrefabs.size, 1);
});

test('取消后迟到的地图加载不能覆盖当前地图配置', async () => {
    const maps = deferred<object[]>();
    const fixture = loaderFixture({ load: async () => ({}), loadDir: () => maps.promise });
    const scope = new ResourceScope('battle');
    const ready = fixture.loader.prepare(scope);
    await flush(); assert.equal(fixture.configured, 0);
    scope.dispose(); maps.resolve([{ name: 'late-map', json: {} }]);
    await assert.rejects(ready, /取消/);
    assert.equal(fixture.configured, 0);
});

test('配置初始化期间取消，不继续读表或注入过期配置', async () => {
    const initialization = deferred<void>(); let tablesRead = 0;
    const fixture = loaderFixture({ load: async () => ({}), loadDir: async () => [] }, {
        initialize: () => initialization.promise, getTable: async () => { tablesRead++; return []; },
    });
    const scope = new ResourceScope('battle');
    const ready = fixture.loader.prepare(scope);
    scope.dispose(); initialization.resolve();
    await assert.rejects(ready, /取消/);
    assert.equal(tablesRead, 0); assert.equal(fixture.injected, 0);
});
