/**
 * 占城（领地）服务端对接的接线护栏。
 *
 * ⚠️ 本文件**不能**直接 import `TerritoryCellRepository` —— 它经`GameNet` 拉进 `cc`，
 * 在 Node 里 import 就炸（与 `battle-start-protocol.test.ts` / `chat.test.ts` 同一原因）。
 * 因此按工程既有做法分两段：
 *   A. **纯函数层**直接 import（`TerritoryProgress` 的服务端合并、`TerritoryCellBitSet`）——
 *      这些是真正的业务口径，值得单测。
 *   B. **接线层**读源码文本，断言「确实调了 Repository / 顺序对 / 失败会回落」。
 *      纯源码断言看似弱，但它是**唯一**能在 Node 里钉住 cc 依赖代码的手段
 *      （同族见 `formation-board.test.ts` / `pvp-hero-interface.test.ts`）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import type { TerritoryMapConfig } from '../assets/script/app/territory/model/TerritoryMapConfig';

// ============================================================
// A. 纯函数层：服务端状态合并（TerritoryProgress）
// ============================================================

/** 3×3 的小图：格子 id = row * 3 + col，起点在 0。 */
function makeMap(): TerritoryMapConfig {
    return {
        chapterId: 1,
        rows: 3,
        columns: 3,
        startCellId: 0,
        sites: [],
        defaults: {
            requiredCells: [],
            combatPower: 0,
            silverCost: 0,
            staminaCost: 0,
            exploreSeconds: 1,
        },
    } as TerritoryMapConfig;
}

test('applyServerState：passCells 变成已占领，unlockCells 变成可探索', () => {
    const progress = new TerritoryProgress(makeMap());
    const added = progress.applyServerState({
        passCells: [2, 4],
        unlockCells: [1, 2, 4, 5],
    });
    assert.deepEqual(added, [2, 4], '新增占领格要返回（页面据此决定要不要重绘）');
    assert.deepEqual([...progress.ownedCells], [0, 2, 4], '起点 0 永远占领 + 服务端给的 2/4');
    // ⚠️ 未拉状态时**一律放行**（不是 false）—— 收紧会让玩家在离线时点不动格子。
    assert.equal(progress.serverStateKnown, false, '还没拉过服务端状态');
    assert.equal(progress.isUnlockable(1), true, '未知状态必须放行，否则网络一抖就点不动');
    progress.markServerStateKnown(true);
    assert.equal(progress.isUnlockable(1), true, '1 在 unlockCells 里');
    assert.equal(progress.isUnlockable(3), false, '3 不在 unlockCells 里 ⇒ 未解锁');
    assert.equal(progress.isUnlockable(2), true, '已解锁（通关的格子当然也算可点）');
});

test('applyServerState 是**单调合并**：服务端没给的本地格子要保住', () => {
    // 本地已有 3、7（探索中）；服务端只给 2。
    const progress = new TerritoryProgress(makeMap(), {
        ownedCells: [3, 7],
        explorations: [{
            cellId: 5, cells: [5], silverCost: 0, staminaCost: 0,
            exploreSeconds: 1, requiredCombatPower: 0,
            startedAt: 0, finishesAt: 9_999_999_999_999,
        }],
    });
    const added = progress.applyServerState({ passCells: [2], unlockCells: [2] });
    assert.deepEqual(added, [2]);
    assert.deepEqual([...progress.ownedCells], [0, 2, 3, 7],
        '⚠️ 服务端没提到的本地格子不能被清掉 —— 那等于凭空吃掉玩家进度');
    assert.equal(progress.explorationAt(5) !== null, true, '探索中的格子不能被服务端状态冲掉');
});

test('applyServerState：服务端说通关 ⇒ 该格的探索直接结算掉', () => {
    const progress = new TerritoryProgress(makeMap(), {
        explorations: [{
            cellId: 6, cells: [6], silverCost: 0, staminaCost: 0,
            exploreSeconds: 1, requiredCombatPower: 0,
            startedAt: 0, finishesAt: 9_999_999_999_999,
        }],
    });
    progress.applyServerState({ passCells: [6], unlockCells: [] });
    assert.equal(progress.explorationAt(6), null, '已被服务端判定通关 ⇒ 不用再等本地计时');
    assert.equal(progress.isOwned(6), true);
});

test('applyServerState：越界格子被丢弃（服务端扩容过章节、客户端拿的是旧地图）', () => {
    const progress = new TerritoryProgress(makeMap());
    const added = progress.applyServerState({ passCells: [8, 99, -1], unlockCells: [99] });
    assert.deepEqual(added, [8], '只有 8 在 3×3 范围内');
    assert.equal(progress.isOwned(99), false);
});

test('markServerStateKnown(false) 会退回"全放行"（请求失败时不能卡住玩家）', () => {
    const progress = new TerritoryProgress(makeMap());
    progress.markServerStateKnown(true);
    progress.applyServerState({ passCells: [], unlockCells: [1] });
    assert.equal(progress.isUnlockable(1), true);
    assert.equal(progress.isUnlockable(5), false, '已拉过状态 ⇒ 5 未解锁');
    // ⚠️ 失败路径必须能退回"一律放行"，否则网络一抖玩家就点不动格子。
    progress.markServerStateKnown(false);
    assert.equal(progress.isUnlockable(5), true, '未知状态下必须放行');
});

test('checkExplore 会按服务端解锁态拦人，但**只在成功拉过状态后**', () => {
    const map = makeMap();
    const progress = new TerritoryProgress(map);
    // 未拉状态 ⇒ 放行（本地规则仍生效：起点已占领会被拦）。
    assert.equal(progress.checkExplore(4, 0).ok, true, '未知状态不该拦人');
    progress.markServerStateKnown(true);
    progress.applyServerState({ passCells: [], unlockCells: [1] });
    assert.equal(progress.checkExplore(4, 0).ok, false, '4 不在 unlockCells ⇒ 拦住');
    assert.equal(progress.checkExplore(1, 0).ok, true, '1 已解锁 ⇒ 放行');
    assert.equal(progress.checkExplore(0, 0).ok, false, '起点已占领 ⇒ 本地规则照样拦');
});

test('markCellUnlocked / markCellPassed：写请求成功后才记账（不乐观更新）', () => {
    const progress = new TerritoryProgress(makeMap());
    progress.markServerStateKnown(true);
    // 记账前：4 未解锁、也未占领。
    assert.equal(progress.isOwned(4), false);
    assert.equal(progress.isUnlockable(4), false, '还没记账 ⇒ 仍未解锁');
    progress.markCellUnlocked(3);
    assert.equal(progress.isUnlockable(3), true);
    progress.markCellPassed(4);
    assert.equal(progress.isOwned(4), true, '通关成功后本地才记为已占领');
    assert.equal(progress.isUnlockable(4), false, '已占领的格子不需要"解锁"（checkExplore 会先拦 owned）');
    // 越界调用不应污染状态
    progress.markCellPassed(99);
    assert.equal(progress.isOwned(99), false);
});

// ============================================================
// B. 接线层：读源码断言（TerritoryCellRepository / TerritoryPage 带 cc，不能 import）
// ============================================================

const REPO_SRC = readFileSync(
    'assets/script/app/territory/application/TerritoryCellRepository.ts',
    'utf8',
);
const PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
// 2026-10-09 抽 Presenter 后：编排与调用方断言的真源换到 TerritoryPresenter（纯 TS，可直接读文本）。
const PRESENTER_SRC = readFileSync(
    'assets/script/app/territory/application/TerritoryPresenter.ts',
    'utf8',
);
const REQ_SRC = readFileSync(
    'assets/script/app/territory/application/RequestTerritoryCellInfoMsg.ts',
    'utf8',
);

test('★领地的 5 条占城协议都在 RequestMsg 里，且请求名与 proto 一致', () => {
    // 少一条 ⇒ 该功能点了没反应、零报错。
    const expected = [
        'CmdCityChapterCellInfoReqMsg',
        'CmdCityChapterUnlockCellReqMsg',
        'CmdCityChapterPassCellReqMsg',
        'CmdCityChapterSweepReqMsg',
        'CmdCityChapterIdleRewardReqMsg',
    ];
    for (const protoName of expected) {
        assert.ok(REQ_SRC.includes(protoName), `缺请求类：${protoName}`);
    }
    // 协议名必须来自 proto（拼错 ⇒ 服务端认不出，GameNet 会打「MessageId 中没定义」）。
    const proto = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    for (const protoName of expected) {
        assert.ok(proto.includes(`message ${protoName}`), `proto 里没有 ${protoName}`);
    }
    // 请求类必须覆写 getReqMsgProtoName（否则基类返回 CmdPlayerLoginReqMsg）。
    assert.equal(
        (REQ_SRC.match(/getReqMsgProtoName\(\): ReqMsgProtoName \{\s*return '/g) ?? []).length,
        expected.length,
        '每个请求类都要覆写 getReqMsgProtoName',
    );
});

/**
 * ★★ 占城协议曾经"有定义但发不出去" —— 登记机制在**生成产物**里，不在 proto 源文件里。
 *
 * `ProtoCoder.initMessage()`扫的是 `protoCompiledStatic.ts` 的 `MessageId` **枚举**，
 * 靠 `key.replace('RspMsg','') + 'ReqMsg'` **反推**请求名（`framework/net/ProtoCoder.ts:289`）。
 * 所以登记的 key 必须是 `…RspMsg`；`proto` 源文件里有、但生成产物是旧的 ⇒
 * 运行时 `_reqNameIdMap` 里没这条 ⇒ `GameNet` 打「不存在协议 …：MessageId 中没定义」。
 *
 * 实测踩过：proto 源 10-09 更新（含 6 条占城），`protoCompiledStatic.ts` 还是 09-24 的
 * ⇒ 源里有、产物里0 条 ⇒ 请求全部被拦。
 */
test('★★ 占城协议已登记进运行时 MessageId（proto 源更新了，生成产物也必须重生成）', () => {
    const STATIC = 'assets/script/lib/protobuf/protoCompiledStatic.ts';
    const staticSrc = readFileSync(STATIC, 'utf8');
    const protoSrc = readFileSync('client_proto/protoCompiled.proto', 'utf8');

    // 复刻 ProtoCoder.initMessage：从 MessageId 枚举扫 key → 去 RspMsg → 拼 ReqMsg。
    const enumAt = staticSrc.indexOf('cmd.MessageId = (function() {');
    assert.ok(enumAt > 0, '生成产物里找不到 MessageId 枚举');
    const enumEnd = staticSrc.indexOf('return values;', enumAt);
    const enumBody = staticSrc.slice(enumAt, enumEnd);
    const entryRe = /valuesById\[(\d+)\] = "([A-Za-z0-9_]+)"/g;
    const requestNameToId = new Map<string, number>();
    let matched: RegExpExecArray | null;
    while ((matched = entryRe.exec(enumBody))) {
        requestNameToId.set(matched[2].replace('RspMsg', '') + 'ReqMsg', Number(matched[1]));
    }
    assert.ok(requestNameToId.size > 100, `MessageId 枚举项数异常：${requestNameToId.size}`);

    const expected = [
        'CmdCityChapterCellInfoReqMsg',
        'CmdCityChapterUnlockCellReqMsg',
        'CmdCityChapterPassCellReqMsg',
        'CmdCityChapterSweepReqMsg',
        'CmdCityChapterIdleRewardReqMsg',
    ];
    for (const reqName of expected) {
        assert.ok(
            requestNameToId.has(reqName),
            `★生成产物 ${STATIC} 的 MessageId 里没有 ${reqName}`
            + ' ⇒ GameNet 会报「不存在协议…MessageId 中没定义」。'
            + '修法：跑 node tools/proto/gen_static_module.mjs 重新生成（别手改产物）',
        );
        // 消息号必须与 proto 源一致（proto 改了没重生成时，两边会不同）。
        const rspName = reqName.replace('ReqMsg', 'RspMsg');
        const idInProto = new RegExp(`${rspName}\\s*=\\s*(\\d+)`).exec(protoSrc);
        assert.ok(idInProto, `proto 源里找不到 ${rspName} = <消息号>`);
        assert.equal(
            requestNameToId.get(reqName),
            Number(idInProto[1]),
            `${reqName} 的消息号与 proto 源不一致（proto 改了但没重生成）`,
        );
    }
});

test('★★ 生成产物不比 proto 源旧（proto 更新后必须重跑生成脚本）', () => {
    // 判据：proto 源里每个 `MessageId` 项，在生成产物的枚举里都能找到。
    // 只抽查占城这一族 —— 全量对比会在 proto 里有、生成产物暂时没有的新协议上误报。
    const protoSrc = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    const staticSrc = readFileSync('assets/script/lib/protobuf/protoCompiledStatic.ts', 'utf8');
    const enumAt = staticSrc.indexOf('cmd.MessageId = (function() {');
    const enumBody = staticSrc.slice(enumAt, staticSrc.indexOf('return values;', enumAt));
    for (const name of ['CmdCityChapterInfoRspMsg', 'CmdCityChapterCellInfoRspMsg']) {
        assert.ok(
            protoSrc.includes(`${name} = `),
            `proto 源里应有 ${name}`,
        );
        assert.ok(
            enumBody.includes(`"${name}"`),
            `★生成产物的 MessageId 枚举里缺 ${name} —— `
            + 'proto 更新过但没重跑 tools/proto/gen_static_module.mjs',
        );
    }
});

test('★Repository 真的发包：走 GameNet.send 且带 withTimeout', () => {
    assert.ok(/GameNet\.instance/.test(REPO_SRC), '必须走 GameNet.instance');
    // `net.send` 可能跨行写（withTimeout 包了一层），所以只查"出现了 net.send("。
    assert.ok(/net\.send\(/.test(REPO_SRC), '必须调 net.send 发包');
    // ⚠️ withTimeout 必加：`GameNet.send` 没有按请求超时，服务端不回就永悬在"加载中"。
    assert.ok(/withTimeout\(/.test(REPO_SRC), '必须 withTimeout，否则界面会永远转圈');
    // ⚠️ needLoading 必须传 false：领地页有自己的 loading 态，别让网络层再叠一层。
    // 用宽松匹配（`build() as never, false`），跨行也能命中。
    assert.ok(
        /net\.send\([\s\S]{0,80}?,\s*false\s*\)/.test(REPO_SRC),
        '发包要传 needLoading=false（领地页自己有 loading 态）',
    );
    // 离线早退：连不上就别发。
    assert.ok(/isConnected/.test(REPO_SRC), '必须判 isConnected 并离线早退');
});

test('★写请求一律等服务端 succ，不乐观更新', () => {
    // 每条写请求都要判 succ；本地记账（markCellPassed / markCellUnlocked）只在 ok 后调。
    assert.equal(
        (REPO_SRC.match(/succ/g) ?? []).length >= 3,
        true,
        'unlockCell / passCell / sweep 都要判 succ',
    );
    assert.ok(/rejected/.test(REPO_SRC), 'succ=0 要归成 rejected（业务拒绝 ≠ 网络失败）');
    // ⚠️ 领挂机那条 rsp **没有 succ**（proto 只有 idleTime）⇒ 回包到达即成功，
    // 不能因为没 succ 字段就判失败。
    assert.ok(/lastIdleTime/.test(REPO_SRC), '要记 idleTime（挂机结算靠它）');
});

test('★固定与随机资源点的回包都携带奖励明细，弹窗由成功的操作发起', () => {
    const proto = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    for (const response of ['CmdCityChapterUnlockCellRspMsg', 'CmdCityChapterPassCellRspMsg']) {
        const block = proto.match(new RegExp(`message ${response} \\{([^}]+)\\}`))?.[1] ?? '';
        // ⚠️ 字段名以后端为准：r572「章节协议新增物品列表」起是驼峰 `tlCmdGoods`（此前叫 `tl_cmd_goods`）。
        //    空格用 \s* 放宽 —— proto 里为对齐写成 `tlCmdGoods   = 4`，钉死单空格会假红。
        assert.match(block, /repeated CmdGoods tlCmdGoods\s*=\s*4/);
    }
    assert.match(REPO_SRC, /readTerritoryGrantedRewards\(rsp\?\.tlCmdGoods\)/);
    assert.doesNotMatch(REPO_SRC, /FW\.ShowReward\(/, '网络层不能在失败或页面已关闭后直接弹窗');
    assert.match(PRESENTER_SRC, /isUnlocked && result\.rewards\?\.length/);
    // 发奖要带上「来自哪一格」：飘字落点用（挂机产出没有来源格 ⇒ 不传，页面回落到起始格）。
    assert.match(PRESENTER_SRC, /showRewards\(result\.rewards, site\.cellId\)/);
    assert.match(PRESENTER_SRC, /showRewards\(result\.rewards, cellId\)/);
});

test('★随机格成功不再弹「已开启」轻提示（会和奖励弹窗抢同一时刻）', () => {
    // 随机格是「解锁即发奖」：奖励弹窗已经承担了这次操作的反馈，再叠一句轻提示，
    // 两条 UI 会同时出现。失败分支的轻提示保留（那时没有奖励窗）。
    assert.ok(
        !/TERRITORY_TEXTS\.randomOpened/.test(PRESENTER_SRC),
        '成功分支别再弹「已开启」轻提示 —— 与奖励弹窗冲突；随机格的反馈只由奖励窗承担',
    );
});

test('★Repository 绝不走 CacheMgr（服务端不推，走缓存只会拿到恒空数组）', () => {
    // ⚠️ 只能查**代码里有没有真的用**，不能查这个词出现没出现 ——
    // 文件头的注释就写了「为什么不用 CacheMgr」，一查就误报。
    // 判据：出现的是 `CacheMgr.instance.get…` 这类**调用**，而不是注释里的 `CacheMgr`。
    assert.ok(
        !/CacheMgr\s*\.\s*instance/.test(REPO_SRC),
        '⚠️ 这些表服务端不推（protoCache.json 里没有），用 CacheMgr 只会拿到恒空数组、零报错',
    );
    assert.ok(
        !/import[^;]*CacheMgr/.test(REPO_SRC),
        '不该 import CacheMgr',
    );
});

test('★TerritoryPage 确实调了 Repository，且在建完 progress 之后立刻合并', () => {
    // Page 持有 Repository（构造 Presenter 时作为 gateway 端口传入）。
    assert.ok(/new TerritoryCellRepository\(\)/.test(PAGE_SRC), '页面必须持有 Repository');
    // 发请求与合并在 Presenter（gateway 端口）。
    assert.ok(/gateway\.fetchChapterCells\(/.test(PRESENTER_SRC), '必须真的发请求（否则线上不请求）');
    // 顺序：先 new TerritoryProgress，再 fetch + apply。
    const progressAt = PRESENTER_SRC.indexOf('new TerritoryProgress(');
    const fetchAt = PRESENTER_SRC.indexOf('gateway.fetchChapterCells(');
    // ⚠️ 这里必须锚 `result.state`（`mergeServerState` 里那处）而不是裸的 `progress.applyServerState(` ——
    // `applyPassCellsBro`（Bro 落地）里也有一句同名的 `this.progress.applyServerState(...)`，
    // 而它写在文件更靠前的位置 ⇒ 用 `indexOf` 抓裸串会抓到Bro 那处、判出「apply 在 fetch 之前」的假红。
    const applyAt = PRESENTER_SRC.indexOf('progress.applyServerState(result.state)');
    assert.ok(progressAt > 0 && fetchAt > progressAt, '必须先建 progress 再拉服务端状态');
    assert.ok(applyAt > fetchAt, '拉到的状态必须合并进 progress（只拉不合并 = 白拉）');
});

test('★拉取失败时不阻断页面、且不收紧解锁态（网络抖动不能让玩家点不动格子）', () => {
    // 失败分支必须 return 而不是 throw/卡住；且**不能**调 markServerStateKnown(true)。
    assert.ok(/mergeServerState/.test(PRESENTER_SRC), '要有独立的合并方法，便于单独早退');
    assert.ok(
        /沿用本地存档/.test(PRESENTER_SRC),
        '失败分支要显式说明沿用本地存档（静默失败但留痕）',
    );
    // ⚠️ 直接钉"失败分支里没有 markServerStateKnown(true)"：
    // 只靠"标记在失败分支之后"的位置断言太弱（重构就失效）。
    const body = mergeServerStateBody();
    const failAt = body.indexOf("'reason' in result");
    assert.ok(failAt > 0, 'mergeServerState 里要有失败早退分支');
    const knownAt = body.indexOf('markServerStateKnown(true)');
    assert.ok(knownAt > 0, '要有标记已知的调用');
    assert.ok(knownAt > failAt, '★标记必须在失败早退之后（失败时标"已知"会把玩家锁死）');
    // 失败分支体里不得出现标记。
    const failBranch = body.slice(failAt, body.indexOf('}', failAt));
    assert.ok(
        !/markServerStateKnown/.test(failBranch),
        '失败分支里不能标记服务端状态已知 —— 请求失败时未知状态必须继续"全放行"',
    );
});

/** 抽出 `mergeServerState` 方法体（到下一个同级方法声明为止），供上面的定位断言用。 */
function mergeServerStateBody(): string {
    const start = PRESENTER_SRC.indexOf('private async mergeServerState(');
    assert.ok(start > 0, '找不到 mergeServerState 方法');
    const end = PRESENTER_SRC.indexOf('\n    private ', start + 10);
    return PRESENTER_SRC.slice(start, end > 0 ? end : PRESENTER_SRC.length);
}

/** 抽出 `loadChapter` 方法体。 */
function loadChapterBody(): string {
    const start = PRESENTER_SRC.indexOf('private async loadChapter(');
    assert.ok(start > 0, '找不到 loadChapter 方法');
    const end = PRESENTER_SRC.indexOf('\n    private ', start + 10);
    return PRESENTER_SRC.slice(start, end > 0 ? end : PRESENTER_SRC.length);
}

test('★页面真的发了请求（"没请求"就是我上一轮的错，必须钉死）', () => {
    // ⚠️ 这条是最直接的回归护栏：`mergeServerState` 写了但没人调 = 线上永远不请求。
    assert.ok(
        /await this\.mergeServerState\(/.test(PRESENTER_SRC),
        'loadChapter 必须 await mergeServerState —— 只定义不调用 = 永远发不出请求',
    );
    // 且必须在建progress 之后（否则合并进去的格子会被随后新建的 progress 覆盖掉）。
    const body = loadChapterBody();
    const newProgressAt = body.indexOf('new TerritoryProgress(');
    const mergeAt = body.indexOf('mergeServerState(');
    assert.ok(newProgressAt > 0 && mergeAt > newProgressAt, '必须先建 progress 再合并');
});

test('★切章节要清服务端快照（否则会先渲染上一章的状态再被覆盖，格子闪一下）', () => {
    // gateway 在 loadChapter 里是从 ports 解构的局部变量，调用形式是 `gateway.clear()`。
    const clearAt = PRESENTER_SRC.indexOf('gateway.clear();');
    const cachedReset = PRESENTER_SRC.indexOf('this.serverCellStateCache = null');
    assert.ok(clearAt > 0, '切章节必须清 Repository 快照');
    assert.ok(cachedReset > 0, '切章节必须清 Presenter 侧的 serverCellStateCache');
    // 两个清理都要在 loadChapter 里（所有入口都走它）。
    const loadAt = PRESENTER_SRC.indexOf('private async loadChapter(');
    assert.ok(clearAt > loadAt && cachedReset > loadAt, '清理必须在 loadChapter 内');
});

/**
 * ★★★ 写链路必须有调用方（2026-10-09 真机踩出来的死锁）
 *
 * `TerritoryCellRepository.unlockCell / passCell / sweep / claimIdleReward`
 * 四个方法**全工程零调用方**地存在了很久，没有任何报错 ——
 * 因为"方法定义了没人调"跟"方法不存在"在运行时表现完全一样：**什么都不会发生**。
 *
 * 后果是闭环死锁：客户端从不告诉服务端"我解锁/通关了哪一格"
 * ⇒ 服务端 `passCells` 永远停在起点 367 ⇒ 可解锁前沿只有起点
 * ⇒ `markServerStateKnown(true)` 一收紧，除了起点整张图点不动。
 * 真机日志原文：`unlock=1 格 [367] pass=1 格 [367]`。
 *
 * 这是 MEMORY 194「服务端数据写了但没人调」的**镜像形态**：
 * 那条是服务端推了没人收，这条是客户端要写没人写。判据一样 —— grep 调用方，不是 grep 定义。
 */
test('★★★ 写链路必须有调用方：unlockCell / passCell 都要真的被调', () => {
    assert.ok(
        /gateway\.unlockCell\(/.test(PRESENTER_SRC),
        '★TerritoryPresenter 必须调 gateway.unlockCell —— 开战前要让服务端解锁这一格，'
        + '否则服务端永远不知道玩家解锁了哪一格，可解锁前沿只有起点，整张图点不动',
    );
    assert.ok(
        /gateway\.passCell\(/.test(PRESENTER_SRC),
        '★TerritoryPresenter 必须调 gateway.passCell —— 通关要上报，'
        + '否则服务端 passCells 永远只有起点',
    );
});

test('★★★ 解锁请求在扣本地资源之前（否则被拒绝时白扣银币体力，且要不回来）', () => {
    // 口径 B：`unlockCells` 由服务端算，客户端不自己推断 ⇒ 必须先问服务端。
    // 顺序反了会在 succ=0 时白扣资源 —— 本地存档是唯一副本，扣了没法退。
    const startAt = PRESENTER_SRC.indexOf('private async startBattle(');
    assert.ok(startAt > 0, '找不到 startBattle');
    const end = PRESENTER_SRC.indexOf('\n    private ', startAt + 10);
    const body = PRESENTER_SRC.slice(startAt, end > 0 ? end : PRESENTER_SRC.length);

    const unlockAt = body.indexOf('gateway.unlockCell(');
    assert.ok(unlockAt > 0, 'startBattle 里必须请求解锁');
    // 扣费已拆到 beginBattle（store.beginBattle 在其中），这里查的是"调用它"在解锁之后。
    // ⚠️ 必须**从 unlockAt 之后**找：`startBattle` 开头有一条「已解锁 ⇒ 直接进战斗」的快路径
    //    （`isCellUnlocked` 命中时它本来就不需要再解锁，第一个 `this.beginBattle(` 落在那儿），
    //    取全局第一个会把这层绕行误报成"先扣费后解锁"。
    const callBeginAt = body.indexOf('this.beginBattle(', unlockAt);
    assert.ok(callBeginAt > 0, 'startBattle 必须在解锁确认后调 beginBattle 扣费进战斗');
    assert.ok(
        unlockAt < callBeginAt,
        '★解锁请求必须在扣费/进战斗之前 —— 反过来会在服务端拒绝时白扣银币体力',
    );
    // ⚠️ 顺带钉住"扣费真的拆出去了"：如果有人图省事把 store.beginBattle 搬回 startBattle，
    // 上面的顺序断言会被绕过，故这里直接禁。
    assert.ok(
        body.indexOf('store.beginBattle(') < 0,
        'store.beginBattle 不该再出现在 startBattle 里（扣费已挪到 beginBattle，由解锁结果把关）',
    );
});

test('★★★ 只有 rejected 才停战；离线/网络失败必须放行（网络抖动不该让玩家点不动格子）', () => {
    const startAt = PRESENTER_SRC.indexOf('private async startBattle(');
    const end = PRESENTER_SRC.indexOf('\n    private ', startAt + 10);
    const body = PRESENTER_SRC.slice(startAt, end > 0 ? end : PRESENTER_SRC.length);

    assert.ok(/rejected/.test(body), "要按 reason 分流：'rejected' 才停");
    assert.ok(/unlockRejected/.test(body), '被服务端拒绝要给玩家一句可读提示，不能静默');
    // ⚠️ 反向断言：不能因为任何失败都直接 return（那正是"离线点不动格子"的老坑）。
    assert.ok(
        /console\.warn/.test(body),
        '离线/超时分支要 console.warn 留痕 —— 静默放行会让线上问题查不出来',
    );
});

test('occupation persists a pending pass until the server confirms it', () => {
    const progress = new TerritoryProgress(makeMap());
    assert.equal(progress.startExplore(1, 0, 1000).ok, true);
    assert.deepEqual(progress.settle(2000), [1]);
    const restored = new TerritoryProgress(makeMap(), progress.toJSON());
    assert.deepEqual(restored.pendingPassCells, [1]);
    assert.equal(restored.isOwned(1), true);
    assert.deepEqual(restored.settle(3000), []);
    restored.applyServerState({ unlockCells: [1], passCells: [1] });
    assert.deepEqual(restored.pendingPassCells, []);
    assert.equal(restored.isOwned(1), true);
});

// ============================================================
// C. 服务端主动推送：通关格子广播（CmdCityChapterPassCellBroMsg）
// ============================================================

test('★Bro 的 cellId 是数组：一次推多个格子全部落地，且幂等', () => {
    const progress = new TerritoryProgress(makeMap());

    // 一条广播带 3 个格子（`repeated uint32` ⇒ 解出来是普通 number[]）。
    const first = progress.applyServerState({ unlockCells: [], passCells: [1, 4, 7] });
    assert.deepEqual(first, [1, 4, 7], '数组里的每个格子都该落地');
    for (const cell of [1, 4, 7]) assert.equal(progress.isOwned(cell), true);

    // ⚠️ 同一批再推一次（服务端重复推送是常态）⇒ `added` 必须为空，
    // 否则每次重推都白刷新一次界面 + 写一次盘。
    assert.deepEqual(
        progress.applyServerState({ unlockCells: [], passCells: [1, 4, 7] }),
        [],
        '重复广播不应产生新增',
    );

    // 部分重叠：只有真正新增的 2 个进added。
    assert.deepEqual(
        progress.applyServerState({ unlockCells: [], passCells: [1, 2, 5] }),
        [2, 5],
        '只有真新增的格子该返回',
    );
});

test('★Bro 只带通关、不带解锁 ⇒ 不能顺手放行未解锁的格子', () => {
    const progress = new TerritoryProgress(makeMap());
    progress.markServerStateKnown(true);

    // Bro 落地（`unlockCells` 传空 —— 广播没讲解锁这件事）。
    progress.applyServerState({ unlockCells: [], passCells: [6] });
    assert.equal(progress.isOwned(6), true, '通关格子该变已占领');
    assert.equal(
        progress.isUnlockable(8),
        false,
        '8 号格没被 Bro 解锁，不能因为收了一条广播就变得可点',
    );
});

test('★Bro 的格子同样走越界裁剪（服务端扩容过章节、客户端地图是旧的）', () => {
    const progress = new TerritoryProgress(makeMap()); // 3×3 ⇒ 合法 id 0..8
    const added = progress.applyServerState({ unlockCells: [], passCells: [3, 99, -1] });
    assert.deepEqual(added, [3], '越界与负数都要被丢弃，只有 3 落地');
    assert.equal(progress.isOwned(99), false);
});

test('★★★ Bro 必须真的订阅了（不订阅 = 联机时看不到别人的通关，零报错）', () => {
    assert.match(REPO_SRC, /addEvent\(\s*'CmdCityChapterPassCellBroMsg'/,
        'Repository 必须用 GameNet.addEvent 订阅 Bro —— RequestMsg 那套只管自己发的 req→rsp');
    assert.match(REPO_SRC, /listenPassCellsBro/,
        '必须暴露订阅入口，否则 Presenter 接不上');
    assert.match(PRESENTER_SRC, /gateway\.listenPassCellsBro\?\./,
        'Presenter 装载章节后必须订阅 Bro');
    assert.match(PRESENTER_SRC, /applyPassCellsBro/,
        'Presenter 必须有一个落地方法');
});

test('★★★ Bro 订阅幂等 + dispose 必退订', () => {
    // 重复订阅只挂一次监听：否则同一个包被处理多次，表现为「一次广播新增了 N 个格子」。
    const listen = REPO_SRC.slice(
        REPO_SRC.indexOf('listenPassCellsBro(onPassCells'),
        REPO_SRC.indexOf('unlistenPassCellsBro'),
    );
    assert.match(listen, /if \(this\.broListener\) return;/,
        '重复订阅必须早退（只换回调，不重复挂监听）');
    assert.match(REPO_SRC, /removeCallerEvent/,
        '退订要用 removeCallerEvent（按 caller 摘掉全部监听）');

    // dispose 必须退订：监听挂在 GameNet 上（进程级），Presenter 销毁后还在回调
    // ⇒ 表现为「关页面后再进，格子莫名变已占领」。
    const dispose = PRESENTER_SRC.slice(
        PRESENTER_SRC.indexOf('dispose(): void {'),
        PRESENTER_SRC.indexOf('dispose(): void {') + 400,
    );
    assert.match(dispose, /unlistenPassCellsBro/,
        'dispose 必须退订 Bro 监听，否则会回调到已销毁的对象');
});

test('★★★ Bro 的章节号归一：Repository 与 Presenter 必须同一口径', () => {
    // 两处各写一份归一（Repository 收包时用、Presenter 比对时用）⇒ 必须一致，
    // 否则「服务端推 levelChapter=0」时 Repository 归成1、Presenter 按 0 比对，
    // 格子白收（症状：广播收到了但格子没变，且零报错）。
    const repoNorm = /private normalizeChapter\(levelChapter: number\): number \{[\s\S]*?\};?\s*$/m;
    const repoBody = REPO_SRC.match(repoNorm);
    assert.ok(repoBody, 'Repository 的 normalizeChapter 要能定位');
    const presenterBody = PRESENTER_SRC.match(/private normalizeBroChapter\(levelChapter: number\): number \{[\s\S]*?\n    \}/);
    assert.ok(presenterBody, 'Presenter 的 normalizeBroChapter 要能定位');
    for (const [label, body] of [['Repository', repoBody[0]], ['Presenter', presenterBody[0]]] as const) {
        assert.match(body, />= 1 \? parsed : 1/,
            `${label} 的章节归一口径必须是「<1 一律当第 1 章」`);
    }
});

test('★★★ Bro 落地必须复用 applyServerState，且不碰 serverStateKnown', () => {
    const bro = PRESENTER_SRC.slice(
        PRESENTER_SRC.indexOf('private applyPassCellsBro'),
        PRESENTER_SRC.indexOf('private normalizeBroChapter'),
    );
    assert.ok(bro.length > 0, 'applyPassCellsBro 要能定位');
    // 复用单调合并（含上界裁剪 + 探索结算），不另写一套。
    assert.match(bro, /applyServerState\(\{ unlockCells: \[\], passCells: cellIds \}\)/,
        'Bro 落地必须复用 applyServerState（单调不减 + 越界裁剪 + 结算探索中的那格）');
    // ⚠️ 不能调 markServerStateKnown：置 true 后 isUnlockable 从"全放行"收紧成"只看 unlockCells"，
    // 而 Bro 不带解锁信息 ⇒ unlockable 还是空集 ⇒ 玩家点不动任何格子（零报错的功能塌方）。
    assert.ok(!/markServerStateKnown/.test(bro),
        'Bro 不带解锁信息，绝不能调 markServerStateKnown（会让玩家点不动格子）');
    // 章节不匹配直接丢。
    assert.match(bro, /normalizeBroChapter\(levelChapter\) !== this\.map\.chapterId/,
        '章节不匹配的 Bro 必须直接丢（切章节时服务端可能还在推旧章）');
});

// ============================================================
// C-2. 服务端主动下发：章节格子状态（战斗结束 / 通关后不经请求下发）
// ============================================================

test('★★★ 主动下发的 CellInfo 必须真的订阅了（不订阅 = 战斗结束界面不刷新，零报错）', () => {
    assert.match(REPO_SRC, /addEvent\(\s*'CmdCityChapterCellInfoRspMsg'/,
        'Repository 必须用 GameNet.addEvent 订阅主动下发的 CellInfo');
    assert.match(REPO_SRC, /listenCellInfo/,
        '必须暴露订阅入口，否则 Presenter 接不上');
    assert.match(PRESENTER_SRC, /gateway\.listenCellInfo\?\./,
        'Presenter 装载章节后必须订阅 CellInfo');
    assert.match(PRESENTER_SRC, /applyCellInfoState/,
        'Presenter 必须有一个落地方法');
});

test('★★★ CellInfo 订阅幂等 + dispose 必退订', () => {
    // 重复订阅只挂一次监听：否则主动下发的一条快照会被落地两次。
    const listen = REPO_SRC.slice(
        REPO_SRC.indexOf('listenCellInfo(maxCell'),
        REPO_SRC.indexOf('unlistenCellInfo'),
    );
    assert.match(listen, /if \(this\.cellInfoListener\) return;/,
        '重复订阅必须早退（只换回调，不重复挂监听）');
    const dispose = PRESENTER_SRC.slice(
        PRESENTER_SRC.indexOf('dispose(): void {'),
        PRESENTER_SRC.indexOf('dispose(): void {') + 420,
    );
    assert.match(dispose, /unlistenCellInfo/,
        'dispose 必须退订 CellInfo 监听，否则会回调到已销毁的对象');
});

test('★★★ fetch 自己的响应不能被当主动推重复落地', () => {
    // 每条响应都会经 msgEventProxy 广播，fetch 那次已在 RequestMsg 回调里 readState，
    // 必须靠在途标志排除，否则同一份快照被落地两次。
    assert.match(REPO_SRC, /this\.fetchInProgress = true/,
        'fetchChapterCells 开始必须置在途标志');
    assert.match(REPO_SRC, /this\.fetchInProgress = false/,
        'fetchChapterCells 结束（finally）必须清在途标志');
    const onMsg = REPO_SRC.slice(
        REPO_SRC.indexOf('private onCellInfoMessage'),
        REPO_SRC.indexOf('private onCellInfoMessage') + 420,
    );
    assert.match(onMsg, /if \(this\.fetchInProgress\) return;/,
        '在途 fetch 的响应必须忽略，不能重复落地');
});

test('★★★ CellInfo 落地复用 applyServerState；完整快照可 markServerStateKnown（与 Bro 不同）', () => {
    const apply = PRESENTER_SRC.slice(
        PRESENTER_SRC.indexOf('private applyCellInfoState'),
        PRESENTER_SRC.indexOf('private applyCellInfoState') + 900,
    );
    assert.ok(apply.length > 0, 'applyCellInfoState 要能定位');
    assert.match(apply, /applyServerState\(state\)/,
        '主动下发的快照必须复用 applyServerState（单调不减 + 越界裁剪 + 清 pendingPasses）');
    // 与 Bro 相反：CellInfo 带 unlockCells 完整快照，应当 mark，否则下次点开仍按旧快照判。
    assert.match(apply, /markServerStateKnown\(true\)/,
        'CellInfo 是完整快照，应当 markServerStateKnown（Bro 才不能 mark）');
    assert.match(apply, /normalizeBroChapter\(state\.levelChapter\) !== this\.map\.chapterId/,
        '章节不匹配的 CellInfo 必须直接丢');
});
