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
    const gameNet = { instance: { isConnected: true, send: (request: Request) =>
        new Promise<boolean>((resolve) => requests.push({ callback: request.callback, resolve })) } };
    const exported: Record<string, unknown> = {};
    runInNewContext(code, { exports: exported, console, require: (id: string) => {
        // 解锁回包里的领奖出口（随机格「解锁即发奖」）。本用例只关心 succ 归属，不关心弹窗。
        if (id === '../../../framework/FW') return { FW: { ShowReward: () => { /* no-op */ } } };
        if (id === '../../net/GameNet') return { GameNet: gameNet };
        if (id === '../../net/RequestGuard') return { withTimeout: (promise: Promise<boolean>) => promise };
        if (id === './RequestTerritoryCellInfoMsg') return {
            RequestTerritoryCellInfo: Request, RequestTerritoryIdleReward: Request,
            RequestTerritoryPassCell: Request, RequestTerritorySweep: Request,
            RequestTerritoryUnlockCell: Request,
        };
        if (id === '../../battle/BattleStartService') return {
            startBattle: async () => null,
        };
        if (id === '../model/TerritoryCellBitSet') return {};
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
