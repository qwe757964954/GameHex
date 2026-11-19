import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * 写请求改成「只发不等」之后，succ 的归属从「Promise 各带各的回调」变成
 * 「回包解码各读各的报文」：两条解锁回包交错到达时，解码结果仍然一一对应。
 *
 * 这条用例压的正是当初引入 `writeWithSucc` 的那个并发窗口 —— 现在由解码层保证。
 */
test('overlapping unlock responses keep their own succ results', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryCellRepository.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const sent: object[] = [];
    class Request {
        constructor(_args: unknown, _caller: unknown) { sent.push(this); }
        // `dispatch` 用协议名做发送/超时留痕：桩也要能报名字。
        getReqMsgProtoName(): string { return 'CmdTestReqMsg'; }
    }
    const exported: Record<string, unknown> = {};
    runInNewContext(code, { exports: exported, console, require: (id: string) => {
        if (id === '../../../framework/FW') return { FW: { ShowReward: () => { /* no-op */ } } };
        if (id === '../../net/GameNet') return {
            // 只发不等：`send` 收下包即可，回包由测试直接喂给 `read*Rsp`。
            GameNet: { instance: { isConnected: true, send: () => Promise.resolve(true) } },
        };
        if (id === '../../net/RequestGuard') return { withTimeout: (promise: Promise<boolean>) => promise };
        if (id === '../../net/Timeouts') return { READ_TIMEOUT_MS_LONG: 5_000 };
        if (id === './RequestTerritoryCellInfoMsg') return {
            RequestTerritoryCellInfo: Request, RequestTerritoryIdleReward: Request,
            RequestTerritoryPassCell: Request, RequestTerritorySweep: Request,
            RequestTerritoryUnlockCell: Request, RequestTerritoryUpMonsterBoxLv: Request,
        };
        if (id === '../../battle/BattleStartService') return { startBattle: async () => null };
        if (id === '../model/TerritoryCellBitSet') return {};
        if (id === '../model/TerritoryMonsterBox') return {};
        if (id === '../model/TerritoryProgress') return {
            normalizeTerritoryChapter: (chapter: number) => (Number.isFinite(chapter) && chapter > 0 ? Math.floor(chapter) : 1),
        };
        if (id === '../model/TerritoryGrantedReward') return { readTerritoryGrantedRewards: () => [] };
        if (id === '../model/TerritoryRequestStatus') return {
            TERRITORY_REQUEST_STATUS: {
                ok: 'ok', offline: 'offline', failed: 'failed',
                rejected: 'rejected', invalid: 'invalid',
            },
        };
        throw new Error(id);
    } });
    const Repository = exported.TerritoryCellRepository as new () => {
        sendUnlockCell: (chapter: number, cell: number) => string;
        readUnlockRsp: (msg: unknown) => { ok: boolean; reason?: string; unlockedCellIds?: number[] };
    };
    const repository = new Repository();
    // 两条请求都发出去了（只发不等，没有各自的 Promise）。
    assert.equal(repository.sendUnlockCell(1, 4), 'ok');
    assert.equal(repository.sendUnlockCell(1, 5), 'ok');
    assert.equal(sent.length, 2, '两条解锁都要真的组包发出');
    // 回包交错到达：解码结果互不影响，各带各的 succ 归属。
    const first = repository.readUnlockRsp({ succ: 1, cellId: [4, 5] });
    const second = repository.readUnlockRsp({ succ: 0 });
    assert.deepEqual({ ...first, unlockedCellIds: Array.from(first.unlockedCellIds ?? []) },
        { ok: true, unlockedCellIds: [4, 5], rewards: [] });
    assert.deepEqual({ ...second }, { ok: false, reason: 'rejected' });
});

/**
 * 服务端拒绝时下发的是 `CmdTips`，不是对应 `Rsp`：`ConnectedNetState` 只把那条请求
 * 置为 rejected，**不派发 Rsp 事件** ⇒ 事件通道上的业务收不到任何信号，只能等 5 秒硬超时
 * （实测：`CmdTips` 20ms 就到，全屏 loading 转到 5723ms 才收）。
 *
 * 守卫三件事：挂 `fErrorCallback`（在 `send` 之前，`packageRequest` 会取走）、把失败连同
 * 协议名回灌出去、装配层把它接到 Model。
 */
test('rejected write requests must report back: fErrorCallback wired before send', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryCellRepository.ts', 'utf8');
    assert.match(source, /request\.fErrorCallback = \(reason: string\): void => \{/,
        'dispatch 要挂 fErrorCallback（拒绝 / 超时 / 取消都从这里出来）');
    assert.match(source, /this\.onWriteError\?\.\(messageName, reason\)/,
        '要把「哪条协议 + 什么原因」回灌出去');
    assert.ok(source.indexOf('request.fErrorCallback =') < source.indexOf('GameNet.instance.send(request, false)'),
        '★fErrorCallback 必须在 send 之前挂：`packageRequest` 会取走并清空');

    const entry = readFileSync('assets/script/app/territory/application/TerritoryEntry.ts', 'utf8');
    assert.match(entry, /cells\.onWriteError = \(requestName, reason\) => model\.applyWriteError\(requestName, reason\)/,
        '★装配层必须把仓储的失败回灌接到 Model（否则在途票还是等 5 秒超时）');
});
