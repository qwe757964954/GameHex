import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';
import { TERRITORY_SILVER_CHEST_REWARD_ID, TERRITORY_SITE_TYPE } from '../assets/script/app/territory/model/TerritoryMapConfig';

/**
 * 写请求「只发不等」之后，奖励路由就在各入口传给 `beginWrite` 的回调里。
 *
 * 这里把入口方法原样抽出来跑（`beginWrite` 换成「记下回调、测试手动喂回包」），钉住：
 *   ① 成功回包才展示奖励，失败 / 过期回包一个奖励都不许发；
 *   ② 随机格 `{ chest: false }`（首格 `{ popup: true }`），固定资源点默认开箱；
 *   ③ 银币宝箱按 `site.rewardId` 单独打标，卡牌宝箱保持默认调用。
 */
const source = ts.createSourceFile('model.ts', readFileSync(
    'assets/script/app/territory/application/TerritoryModel.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const model = source.statements.find(ts.isClassDeclaration)!;
const names = ['handleUnlockOnly', 'handleUnlockThenPass', 'openRandomResourceCell', 'finishWrite'];
const methods = names.map(name => {
    const method = model.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(source) === name);
    assert.ok(method, name);
    return method.getText(source);
}).join('\n');
const Probe = runInNewContext(ts.transpileModule(`class Probe { ${methods} }\nglobalThis.Probe=Probe;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nProbe;', {
    console,
    TERRITORY_TEXTS,
    TERRITORY_SILVER_CHEST_REWARD_ID,
    TERRITORY_SITE_TYPE,
    TERRITORY_REQUEST_STATUS: { ok: 'ok', offline: 'offline', failed: 'failed', rejected: 'rejected', invalid: 'invalid' },
    TERRITORY_WRITE_KIND: { unlock: 'unlock', pass: 'pass', sweep: 'sweep', idleReward: 'idleReward', monsterBox: 'monsterBox' },
    territoryRevealedCells: () => [2],
    readWriteFailure: (result: unknown): string | null => {
        if (!result || typeof result !== 'object') return null;
        if ('failed' in result) return (result as { failed: string }).failed;
        return 'reason' in result ? (result as { reason: string }).reason : null;
    },
});

type Handle = (result: unknown, ticket: unknown) => boolean;

interface IProbe {
    writeTickets: unknown[];
    loadId: number;
    interactionId: number;
    progress: Record<string, unknown>;
    map: { chapterId: number };
    beginWrite(kind: string, cellId: number, pending: unknown, busyText: unknown,
        send: () => string, handle: Handle): void;
    handleUnlockOnly(site: { cellId: number }, tip?: string): Promise<void>;
    handleUnlockThenPass(site: { cellId: number; rewardId?: number },
        texts: Record<string, string>): Promise<void>;
    openRandomResourceCell(cellId: number): Promise<void>;
    finishWrite(ticketId: number, result: unknown): void;
}

/** 探针跑在 vm 里，跨 realm 的普通对象直接 deepEqual 会判「结构相同但非同一引用」⇒ 先转本 realm。 */
function plain(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value ?? null));
}

function probeWith(overrides: Partial<IProbe> = {}) {
    const shown: Array<{ rewards: unknown; cell: number | null; options: unknown }> = [];
    const tips: string[] = [];
    let handle: Handle | null = null;
    const probe = Object.assign(new Probe() as IProbe, {
        writeTickets: [] as unknown[],
        loadId: 1,
        interactionId: 0,
        pendingFixedResourceCells: new Set<number>(),
        pendingRandomResourceCells: new Set<number>(),
        progress: {
            isOwned: () => false, isCellUnlocked: () => false, ownedCells: [] as number[],
            markCellsUnlocked() {}, markCellsPassed() {}, markCellPassed() {},
        },
        map: { chapterId: 1 },
        chapter: {},
        // 入口方法里的请求：测试只关心回包回调，记下来手动喂。
        beginWrite(_kind: string, _cellId: number, _pending: unknown, _busy: unknown,
            _send: () => string, next: Handle) { handle = next; },
        patrolReportCell(site: { cellId: number }) { return site.cellId; },
        previewCellsNow: () => [],
        canAffordUnlock: () => true,
        tryRandomResourceOpen: () => true,
        persistProgress() {}, refreshWalletFromServer() {},
        mergeServerState: async () => {},
        emitStateChange() {}, requireChapter() { return {}; },
        showRewards(rewards: unknown, cell: number | null, options?: unknown) {
            shown.push({ rewards, cell, options });
        },
        showTip(text: string) { tips.push(text); },
        ...overrides,
    });
    return {
        probe, shown, tips,
        deliver(result: unknown) {
            assert.ok(handle, '入口没有调用 beginWrite');
            return handle!(result, {});
        },
    };
}

test('解锁奖励：成功回包才展示，失败与过期回包都不展示', async () => {
    const rewards = [{ resId: 9, amount: 5 }];

    const ok = probeWith();
    await ok.probe.handleUnlockOnly({ cellId: 2 }, '');
    ok.deliver({ ok: true, rewards, unlockedCellIds: [2] });
    assert.deepEqual(plain(ok.shown.map(entry => entry.rewards)), [rewards]);
    assert.equal(ok.shown[0].cell, 2, '奖励要带来源格');

    const failed = probeWith();
    await failed.probe.handleUnlockOnly({ cellId: 2 }, '');
    failed.deliver({ ok: false, reason: 'rejected' });
    assert.deepEqual(failed.shown, [], '服务端拒绝不许发奖');

    // 过期回包：交互号变了 ⇒ finishWrite 在竞态校验处丢弃，不落到回调。
    const stale = probeWith();
    const handle = (): boolean => { throw new Error('过期回包不许进回调'); };
    stale.probe.writeTickets.push({
        id: 1, kind: 'unlock', cellId: 2, pending: null,
        loadId: 1, requestId: 0, exitBusy: null, sentAt: 0, handle,
    });
    stale.probe.interactionId = 7;
    stale.probe.finishWrite(1, { ok: true, rewards });
    assert.deepEqual(stale.shown, [], '过期回包不许发奖');
});

test('随机格：默认 chest:false，本账号第一格 popup:true', async () => {
    const rewards = [{ resId: 9, amount: 5 }];

    const later = probeWith({
        progress: {
            isOwned: () => false, isCellUnlocked: () => false, ownedCells: [9],
            markCellsUnlocked() {}, markCellsPassed() {}, markCellPassed() {},
        },
    });
    await later.probe.openRandomResourceCell(2);
    later.deliver({ ok: true, rewards, unlockedCellIds: [2] });
    assert.deepEqual(plain(later.shown[0].options), { chest: false }, '随机格默认不弹窗、只喷资源');

    const first = probeWith();
    await first.probe.openRandomResourceCell(2);
    first.deliver({ ok: true, rewards, unlockedCellIds: [2] });
    assert.deepEqual(plain(first.shown[0].options), { popup: true }, '新手引导 2-2：第一格要弹奖励窗');
});

test('固定资源点：默认开箱；银币宝箱按 rewardId 单独打标', async () => {
    const rewards = [{ resId: 9, amount: 5 }];
    const texts = { unlocked: '', unlockFailed: '', claimed: '', claimFailed: '' };

    // 两步式第二步：格子已解锁 ⇒ 走 `pass` 分支。
    const unlocked = {
        isOwned: () => false, isCellUnlocked: () => true, ownedCells: [] as number[],
        markCellsUnlocked() {}, markCellsPassed() {}, markCellPassed() {},
    };

    const card = probeWith({ progress: unlocked });
    await card.probe.handleUnlockThenPass({ cellId: 2, rewardId: 1011 }, texts);
    card.deliver({ ok: true, rewards });
    assert.equal(card.shown[0].options, undefined, '卡牌碎片宝箱仍走默认开箱');

    const silver = probeWith({ progress: { ...unlocked } });
    await silver.probe.handleUnlockThenPass({ cellId: 2, rewardId: 1023 }, texts);
    silver.deliver({ ok: true, rewards });
    assert.deepEqual(plain(silver.shown[0].options), { silverChest: true }, '银币宝箱要打上 silverChest');
});
