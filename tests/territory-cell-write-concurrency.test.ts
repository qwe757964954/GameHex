import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('overlapping unlock responses keep their own succ results', async () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryCellRepository.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const requests: Array<{ callback: (rsp: { succ: number }) => void; resolve: (ok: boolean) => void }> = [];
    class Request {
        callback: (rsp: { succ: number }) => void;
        constructor(_args: unknown, _caller: unknown, callback: (rsp: { succ: number }) => void) {
            this.callback = callback;
        }
    }
    // Repository 走 `GameNet.sendRequest`（静态）⇒ 桩在静态方法上，用可手动 resolve 的 Promise
    // 把「回包到达」与「传输完成」两个时刻分开（这正是本用例要压的并发窗口）。
    const gameNet = { sendRequest: (make: () => unknown) => new Promise<string>((resolve) => {
        const request = make() as Request;
        requests.push({ callback: request.callback, resolve: (ok: boolean) => resolve(ok ? 'ok' : 'failed') });
    }) };
    const exported: Record<string, unknown> = {};
    runInNewContext(code, { exports: exported, console, require: (id: string) => {
        // 解锁回包里的领奖出口（随机格「解锁即发奖」）。本用例只关心 succ 归属，不关心弹窗。
        if (id === '../../../framework/FW') return { FW: { ShowReward: () => { /* no-op */ } } };
        if (id === '../../net/GameNet') return { GameNet: gameNet };
        if (id === '../../net/RequestGuard') return { withTimeout: (promise: Promise<boolean>) => promise };
        if (id === '../../net/Timeouts') return { READ_TIMEOUT_MS_LONG: 5_000 };
        if (id === './RequestTerritoryCellInfoMsg') return {
            RequestTerritoryCellInfo: Request, RequestTerritoryIdleReward: Request,
            RequestTerritoryPassCell: Request, RequestTerritorySweep: Request,
            RequestTerritoryUnlockCell: Request,
        };
        if (id === '../../battle/BattleStartService') return {
            startBattle: async () => null,
        };
        if (id === '../model/TerritoryCellBitSet') return {};
        // 2026-11-18 新增 import：`readState` 用它解析 `monsterBoxInfos`，
        // `unlockCell` 这条路径不碰它，给空对象即可（缺模块时 `require` 会直接 throw）。
        if (id === '../model/TerritoryMonsterBox') return {};
        // `unlockCell` 组包要归一章节号（0/负数/NaN → 1）。以前这条没被 require 到，
        // 多半是导入顺序不同；补上避免落到末尾的 `throw new Error(id)`。
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
        unlockCell: (chapter: number, cell: number) => Promise<{ ok: boolean; reason?: string }>;
    };
    const repository = new Repository();
    const first = repository.unlockCell(1, 4);
    const second = repository.unlockCell(1, 5);
    requests[0].callback({ succ: 1 });
    requests[1].callback({ succ: 0 });
    requests[0].resolve(true);
    requests[1].resolve(true);
    assert.equal((await first).ok, true);
    assert.deepEqual({ ...(await second) }, { ok: false, reason: 'rejected' });
});
