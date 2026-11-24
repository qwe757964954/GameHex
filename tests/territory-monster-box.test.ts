/**
 * 占城（领地）· 怪物宝箱协议接入的护栏。
 *
 * 覆盖两段：
 *   A. **纯函数**：`model/TerritoryMonsterBox` 的解析 / 合并口径（可直接 import，零 cc）；
 *   B. **接线**：`TerritoryCellRepository`（经 ts.transpileModule 抽出来跑真实逻辑）
 *      与 Model / Controller / ViewState 的源码断言。
 *
 * 为什么 Repository 不直接 import：它经 `GameNet` 拉进 `cc`，Node 里 import 就炸
 * （与 `territory-cell-protocol.test.ts` 同一原因）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    readTerritoryMonsterBox,
    readTerritoryMonsterBoxes,
    territoryMonsterBoxLvByCell,
    withTerritoryMonsterBox,
} from '../assets/script/app/territory/model/TerritoryMonsterBox';
import * as bitSet from '../assets/script/app/territory/model/TerritoryCellBitSet';
import * as requestStatus from '../assets/script/app/territory/model/TerritoryRequestStatus';
import * as grantedReward from '../assets/script/app/territory/model/TerritoryGrantedReward';
import * as monsterBox from '../assets/script/app/territory/model/TerritoryMonsterBox';
import * as territoryProgress from '../assets/script/app/territory/model/TerritoryProgress';
import { TerritoryProgress } from '../assets/script/app/territory/model/TerritoryProgress';
import type { TerritoryMapConfig } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { buildTerritoryStationStates } from '../assets/script/app/territory/application/TerritoryViewState';

const REPO_PATH = 'assets/script/app/territory/application/TerritoryCellRepository.ts';
const REPO_SRC = readFileSync(REPO_PATH, 'utf8');
const MODEL_SRC = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
const CONTROLLER_SRC = readFileSync('assets/script/app/territory/application/TerritoryController.ts', 'utf8');
/** 网关由 Entry 装配（Controller 只接收 Model 实例），见 `territory-mvc-boundary`。 */
const ENTRY_SRC = readFileSync('assets/script/app/territory/application/TerritoryEntry.ts', 'utf8');
const VIEW_STATE_SRC = readFileSync(
    'assets/script/app/territory/application/TerritoryViewState.ts',
    'utf8',
);
const REQ_SRC = readFileSync(
    'assets/script/app/territory/application/RequestTerritoryCellInfoMsg.ts',
    'utf8',
);
const PROTO_SRC = readFileSync('client_proto/protoCompiled.proto', 'utf8');

// ============================================================
// A. 纯函数层
// ============================================================

test('★readTerritoryMonsterBox：正常条目 / 脏条目各自的判定', () => {
    assert.deepEqual(readTerritoryMonsterBox({ cellId: 7, lv: 3 }), { cellId: 7, lv: 3 });
    // `lv = 0` 是服务端「已生成、还没算等级」的占位，与"没有这条记录"不同 ⇒ 不能丢。
    assert.deepEqual(readTerritoryMonsterBox({ cellId: 7, lv: 0 }), { cellId: 7, lv: 0 });
    for (const bad of [null, undefined, 1, 'x', {}, { cellId: 1 }, { lv: 1 },
        { cellId: -1, lv: 1 }, { cellId: 1.5, lv: 1 }, { cellId: 1, lv: -2 }, { cellId: 1, lv: 'a' }]) {
        assert.equal(readTerritoryMonsterBox(bad), null, `脏条目应丢：${JSON.stringify(bad)}`);
    }
});

test('★★ 一条脏数据只丢那一条 —— 不像 bitSet 那样整包作废', () => {
    const boxes = readTerritoryMonsterBoxes([
        { cellId: 4, lv: 2 },
        { cellId: 'bad', lv: 1 },
        { cellId: 6, lv: 5 },
    ]);
    assert.deepEqual(boxes, [{ cellId: 4, lv: 2 }, { cellId: 6, lv: 5 }],
        '整包作废会让明明能升级的箱子变成"没有等级"');
    // 对照组：bitSet 坏一块就返回 null（口径差异是刻意的，别照搬）。
    const broken = bitSet.decodeCellBitSet([{ low: NaN, high: 0 }]);
    assert.equal(broken.cells, null, 'bitSet 必须整包作废，否则会按"缺格子"渲染');
});

test('readTerritoryMonsterBoxes：空值 / 非数组 / 越界裁剪 / 重复取后者', () => {
    assert.deepEqual(readTerritoryMonsterBoxes(undefined), []);
    assert.deepEqual(readTerritoryMonsterBoxes(null), []);
    assert.deepEqual(readTerritoryMonsterBoxes({ cellId: 1, lv: 1 }), []);
    // 服务端扩容过章节、客户端是旧地图 ⇒ 越界箱子裁掉（与 decodeCellBitSet 同一条理由）。
    assert.deepEqual(
        readTerritoryMonsterBoxes([{ cellId: 2, lv: 1 }, { cellId: 99, lv: 4 }], 9),
        [{ cellId: 2, lv: 1 }],
    );
    // 同 cellId 重复下发：后一条覆盖前一条（服务端顺序即权威），结果按格子号升序。
    assert.deepEqual(
        readTerritoryMonsterBoxes([{ cellId: 9, lv: 1 }, { cellId: 3, lv: 2 }, { cellId: 9, lv: 6 }]),
        [{ cellId: 3, lv: 2 }, { cellId: 9, lv: 6 }],
    );
});

test('withTerritoryMonsterBox：同格覆盖 + 保持升序（与读出来的形状一致）', () => {
    const before = [{ cellId: 3, lv: 2 }, { cellId: 9, lv: 1 }];
    assert.deepEqual(withTerritoryMonsterBox(before, { cellId: 9, lv: 4 }),
        [{ cellId: 3, lv: 2 }, { cellId: 9, lv: 4 }]);
    assert.deepEqual(withTerritoryMonsterBox(before, { cellId: 5, lv: 1 }),
        [{ cellId: 3, lv: 2 }, { cellId: 5, lv: 1 }, { cellId: 9, lv: 1 }]);
    assert.deepEqual(withTerritoryMonsterBox([], { cellId: 1, lv: 1 }), [{ cellId: 1, lv: 1 }]);
});

test('territoryMonsterBoxLvByCell：查表口径（没有 = 0，不是 undefined）', () => {
    const levels = territoryMonsterBoxLvByCell([{ cellId: 4, lv: 3 }, { cellId: 8, lv: 1 }]);
    assert.equal(levels.get(4), 3);
    assert.equal(levels.get(8), 1);
    assert.equal(levels.get(5), undefined);
    assert.equal(territoryMonsterBoxLvByCell(null).size, 0);
});

// ============================================================
// B. 接线层
// ============================================================

/** 3×3 小图：格子 id = row * 3 + col，起点在 0。 */
function makeMap(): TerritoryMapConfig {
    return {
        chapterId: 1,
        rows: 3,
        columns: 3,
        startCellId: 0,
        sites: [{
            id: 'patrolChest_4', type: 'patrolChest', cellId: 4, footprint: [4],
            unlock: { requiredCells: [], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 },
        }],
        defaults: { requiredCells: [], combatPower: 0, silverCost: 0, staminaCost: 0, exploreSeconds: 1 },
    } as unknown as TerritoryMapConfig;
}

test('★站点状态带 monsterBoxLv：快照里有值就取，没有就是 0', () => {
    const map = makeMap();
    const progress = new TerritoryProgress(map);
    const states = buildTerritoryStationStates({
        map, progress,
        wallet: { silver: 100, stamina: 100 },
        siteOpenableCells: [], pendingFixedResourceCells: [],
        monsterBoxes: [{ cellId: 4, lv: 3 }],
    });
    assert.equal(states.get(4)?.monsterBoxLv, 3);
    const empty = buildTerritoryStationStates({
        map, progress,
        wallet: { silver: 100, stamina: 100 },
        siteOpenableCells: [], pendingFixedResourceCells: [],
        monsterBoxes: [],
    });
    assert.equal(empty.get(4)?.monsterBoxLv, 0, '没有怪物宝箱的格必须是 0，视图据此判"不显示等级"');
});

test('★协议字段与请求类：名字 / 字段号 / 生成产物三方一致', () => {
    // ① 上行：只有章节 + 格子（消耗由服务端按等级扣，客户端不传钱）。
    const reqBlock = PROTO_SRC.match(/message CmdCityChapterUpMonsterBoxLvReqMsg \{([^}]+)\}/)?.[1] ?? '';
    assert.match(reqBlock, /required uint32 levelChapter\s*=\s*1/);
    assert.match(reqBlock, /required uint32 cellId\s*=\s*2/);
    // ② 下行：`succ` + 那一格的新等级。
    const rspBlock = PROTO_SRC.match(/message CmdCityChapterUpMonsterBoxLvRspMsg \{([^}]+)\}/)?.[1] ?? '';
    assert.match(rspBlock, /required uint32 succ\s*=\s*1/);
    assert.match(rspBlock, /required ChapterMonsterBoxInfo monsterBoxInfo\s*=\s*2/);
    // ③ 快照里的宝箱集合是字段 5。
    const cellBlock = PROTO_SRC.match(/message CmdCityChapterCellInfoRspMsg \{([^}]+)\}/)?.[1] ?? '';
    assert.match(cellBlock, /repeated ChapterMonsterBoxInfo monsterBoxInfos\s*=\s*5/);
    // ④ 请求类真的存在且覆写的协议名与 proto 一致。
    assert.match(REQ_SRC, /class RequestTerritoryUpMonsterBoxLv extends RequestMsg</);
    assert.match(REQ_SRC, /return 'CmdCityChapterUpMonsterBoxLvReqMsg';/);
});

test('★快照解析带 monsterBoxInfos，且按 maxCell 裁剪', () => {
    assert.match(REPO_SRC, /monsterBoxes: readTerritoryMonsterBoxes\(record\.monsterBoxInfos, maxCell\)/,
        '快照解析漏 monsterBoxInfos ⇒ 地图永远拿不到宝箱等级（零报错）');
    // `emptyCellState` 也必须带空集合，否则"没拉到快照"会退化成 undefined。
    assert.match(REPO_SRC, /emptyCellState/);
    assert.deepEqual(bitSet.emptyCellState(2).monsterBoxes, []);
});

test('★★ 升级结果只认回包等级：不本地 +1，`succ` 才算成功', () => {
    // 写请求只发不等：发送与解码分开，等级只在 `readMonsterBoxRsp` 里认。
    const methodAt = REPO_SRC.indexOf('readMonsterBoxRsp(');
    assert.ok(methodAt > 0, 'Repository 缺 readMonsterBoxRsp');
    const body = REPO_SRC.slice(methodAt, methodAt + 900);
    assert.match(body, /readTerritoryMonsterBox\(/, '等级必须从回包读');
    assert.doesNotMatch(body, /\blv\s*\+\s*1\b/, '不许本地 +1（服务端才是等级真源）');
    assert.match(body, /TERRITORY_REQUEST_STATUS\.rejected/, '`succ !== 1` 必须归 rejected');
    assert.match(body, /withTerritoryMonsterBox\(/, '成功后才把新等级并进快照');
    // 发送侧不许带任何回包假设。
    assert.match(REPO_SRC, /sendUpMonsterBoxLv\(levelChapter: number, cellId: number/);
});

/** 抽出真实 Repository 在 Node 里跑（桩掉 GameNet 与请求类）。 */
function loadRepository() {
    const captured: Array<{ callback: (msg: unknown) => void }> = [];
    class Request {
        constructor(_args: unknown, _caller: unknown, readonly callback: (msg: unknown) => void) {
            captured.push({ callback });
        }
        // `dispatch` 用协议名做发送/超时留痕：桩也要能报名字。
        getReqMsgProtoName(): string { return 'CmdTestReqMsg'; }
    }
    const code = ts.transpileModule(REPO_SRC, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exported: Record<string, new () => unknown> = {};
    runInNewContext(code, {
        exports: exported,
        console: { info() {}, log() {}, warn() {}, error() {} },
        require: (id: string) => ({
            '../../net/GameNet': {
                GameNet: {
                    // 写请求只发不等：`send` 收下 RequestMsg，回包由测试自己塞给 `read*Rsp`。
                    instance: {
                        isConnected: true,
                        send: (request: unknown) => { captured.push({ callback: () => {} }); return Promise.resolve(true); },
                    },
                    sendRequest: async (make: () => unknown) => {
                        make();
                        return 'ok';
                    },
                },
            },
            '../../battle/BattleStartService': { requestBattleStart: async () => null },
            '../../net/Timeouts': { READ_TIMEOUT_MS_LONG: 5000 },
            './RequestTerritoryCellInfoMsg': {
                RequestTerritoryCellInfo: Request,
                RequestTerritoryIdleReward: Request,
                RequestTerritoryPassCell: Request,
                RequestTerritorySweep: Request,
                RequestTerritoryUnlockCell: Request,
                RequestTerritoryUpMonsterBoxLv: Request,
            },
            '../model/TerritoryCellBitSet': bitSet,
            '../model/TerritoryMonsterBox': monsterBox,
            '../model/TerritoryRequestStatus': requestStatus,
            '../model/TerritoryGrantedReward': grantedReward,
            '../model/TerritoryProgress': territoryProgress,
        }[id] ?? {}),
    });
    const Repository = exported.TerritoryCellRepository as new () => {
        fetchChapterCells(chapter: number, maxCell: number): Promise<unknown>;
        sendUpMonsterBoxLv(chapter: number, cellId: number): string;
        readMonsterBoxRsp(msg: unknown): { ok: boolean; monsterBox?: { cellId: number; lv: number } | null; reason?: string };
        state: bitSet.ITerritoryCellState | null;
    };
    return { repository: new Repository(), captured };
}

/**
 * vm 里造出来的对象原型与测试上下文不同 ⇒ `deepStrictEqual` 会报
 * 「Values have same structure but are not reference-equal」，先转成本 realm 的纯 JSON。
 */
function plain(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value ?? null));
}

function boxesOf(repository: { state: bitSet.ITerritoryCellState | null }): unknown {
    return plain(repository.state?.monsterBoxes ?? []);
}

test('★★ 升级成功把新等级并进快照；失败（succ=0）一个字都不改', async () => {
    const { repository, captured } = loadRepository();
    // 先拉一次快照，让 repository 手里有这一章的箱子（lv=2）。
    const fetching = repository.fetchChapterCells(1, 9);
    captured[captured.length - 1].callback({
        levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [],
        monsterBoxInfos: [{ cellId: 4, lv: 2 }],
    });
    await fetching;
    assert.deepEqual(boxesOf(repository), [{ cellId: 4, lv: 2 }]);

    // 服务端拒绝 ⇒ 保持原值，不能乐观 +1。
    assert.equal(repository.sendUpMonsterBoxLv(1, 4), 'ok', '写请求只发不等，发送成功即 ok');
    assert.deepEqual(plain(repository.readMonsterBoxRsp({ succ: 0 })), { ok: false, reason: 'rejected' });
    assert.deepEqual(boxesOf(repository), [{ cellId: 4, lv: 2 }], '失败回包不许改快照');

    // 成功 ⇒ 用回包的等级覆盖（这里刻意给 7，不是 3 —— 证明不是本地 +1）。
    assert.equal(repository.sendUpMonsterBoxLv(1, 4), 'ok');
    assert.deepEqual(plain(repository.readMonsterBoxRsp({ succ: 1, monsterBoxInfo: { cellId: 4, lv: 7 } })),
        { ok: true, monsterBox: { cellId: 4, lv: 7 } });
    assert.deepEqual(boxesOf(repository), [{ cellId: 4, lv: 7 }]);
});

test('★★ succ=1 但回包没有合法条目 ⇒ 成功但等级未知（不报失败、不猜等级）', async () => {
    const { repository, captured } = loadRepository();
    const fetching = repository.fetchChapterCells(1, 9);
    captured[captured.length - 1].callback({
        levelChapter: 1, rewardState: 0, unlockCells: [1], passCells: [],
        monsterBoxInfos: [{ cellId: 4, lv: 2 }],
    });
    await fetching;

    assert.equal(repository.sendUpMonsterBoxLv(1, 4), 'ok');
    assert.deepEqual(plain(repository.readMonsterBoxRsp({ succ: 1, monsterBoxInfo: { cellId: 4, lv: 'bad' } })),
        { ok: true, monsterBox: null }, '服务端已经升级、消耗可能已扣 ⇒ 不能报失败，由调用方重拉');
    assert.deepEqual(boxesOf(repository), [{ cellId: 4, lv: 2 }], '拿不到权威值就保持原样');
});

test('★★ 运行时编码器真的编得出来（static 模块，不是 json）', async () => {
    const root = (await import('../assets/script/lib/protobuf/protoCompiledStatic')).default as any;
    const cmd = root.com.xkhy.tafang.cmd;

    // ① 升级请求：id1 = 章节、id2 = 格子（tag = 8 / 16）。
    const Up = cmd.CmdCityChapterUpMonsterBoxLvReqMsg;
    const upBytes = Up.encode(Up.create({ levelChapter: 2, cellId: 4 })).finish();
    assert.deepEqual([...upBytes], [8, 2, 16, 4], '字段号错了服务端会读成别的字段（或全 0）');
    assert.equal(Up.decode(upBytes).cellId, 4);

    // ② 宝箱条目：id1 = cellId、id2 = lv。
    const Info = cmd.ChapterMonsterBoxInfo;
    assert.deepEqual([...Info.encode(Info.create({ cellId: 4, lv: 3 })).finish()], [8, 4, 16, 3]);

    // ③ 快照里 `monsterBoxInfos` 是 id5（tag = 5<<3|2 = 42），解回来逐条都在。
    const Rsp = cmd.CmdCityChapterCellInfoRspMsg;
    const rspBytes = Rsp.encode(Rsp.create({
        levelChapter: 1, rewardState: 0,
        monsterBoxInfos: [{ cellId: 4, lv: 3 }, { cellId: 8, lv: 1 }],
    })).finish();
    assert.ok([...rspBytes].includes(42), '报文里必须出现 id5（42）—— 否则服务端没下发宝箱集合');
    const decoded = Rsp.decode(rspBytes);
    assert.deepEqual(decoded.monsterBoxInfos.map((box: { cellId: number; lv: number }) =>
        ({ cellId: box.cellId, lv: box.lv })), [{ cellId: 4, lv: 3 }, { cellId: 8, lv: 1 }]);
});

test('★Model / Controller 接线：意图 → 网关 → 仓储，三层都在', () => {
    // ① 网关端口声明了这条协议（只发不等，回包走事件通道）。
    assert.match(MODEL_SRC, /sendUpMonsterBoxLv\(chapterId: number, cellId: number\): TerritorySendStatus/);
    assert.match(MODEL_SRC, /sendUpMonsterBoxLv\(chapterId, cellId\)/);
    assert.match(CONTROLLER_SRC, /CmdCityChapterUpMonsterBoxLvRspMsg/);
    assert.match(CONTROLLER_SRC, /applyMonsterBoxRsp\(this\.options\.cells\.readMonsterBoxRsp\(message\)\)/);
    // ② Model 有升级入口，且只发「快照里有箱子」的格。
    assert.match(MODEL_SRC, /async upgradeMonsterBox\(cellId: number\): Promise<void>/);
    assert.match(MODEL_SRC, /monsterBoxes\.some\(box => box\.cellId === cellId\)/,
        '没有箱子的格不该发请求（只会被服务端拒）');
    // ③ Entry 装配仓储并把本页宿主作为 caller 注入（仓储本身就是网关），Controller 接了意图。
    assert.match(ENTRY_SRC, /new TerritoryCellRepository\(this\)/);
    assert.match(CONTROLLER_SRC, /case 'upgradeMonsterBox': void this\.model\.upgradeMonsterBox\(intent\.cellId\)/);
    // ④ 视图状态两个出口都带上了等级来源。
    assert.match(MODEL_SRC, /readonly monsterBoxes: readonly ITerritoryMonsterBox\[\]/);
    assert.match(VIEW_STATE_SRC, /monsterBoxLv: boxLvByCell\.get\(site\.cellId\) \?\? 0/);
});
