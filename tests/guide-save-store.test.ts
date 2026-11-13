/**
 * 引导存档层（`GuideSaveStore` / `restoreGuideProgress`）的判据。
 *
 * 全部走注入式内存 storage —— 不碰真 localStorage，也不 import `cc`
 * （适配器 `GuideStorageAdapter` 才碰引擎，它不进单测）。
 *
 * 覆盖五类风险：
 *   ① 坏档 / 版本不符导致主流程崩；② 多实例互相覆盖导致进度倒退；
 *   ③ 重复写盘（幂等失效）；④ 存储抛异常（隐私模式 / 配额满）导致丢档；
 *   ⑤ 换账号串档。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGuideSteps } from '../assets/script/app/guide/model/GuideStepConfig';
import { GuideProgress } from '../assets/script/app/guide/model/GuideProgress';
import {
    createMemoryGuideStorage,
    GUIDE_SAVE_KEY_PREFIX,
    GUIDE_SAVE_VERSION,
    GuideSaveStore,
    restoreGuideProgress,
} from '../assets/script/app/guide/model/GuideSaveStore';
import type { GuideProgressData } from '../assets/script/app/guide/model/GuideProgress';

const RAW = JSON.parse(
    readFileSync('assets/remoteRef/guideStep.json', 'utf8'),
) as { k: string[]; v: unknown[][] };

const STEPS = parseGuideSteps(RAW.v.map((row) => {
    const out: Record<string, unknown> = {};
    RAW.k.forEach((key, index) => { out[key] = row[index]; });
    return out;
}));

/** 各测试用不同 roleId，避免 `GuideSaveStore.memoryFallback`（静态）互相污染。 */
function owner(roleId: string) {
    return { roleId, serverId: 's1' };
}

function dataOf(overrides: Partial<GuideProgressData> = {}): GuideProgressData {
    return {
        currentStepId: '1-1',
        completedSteps: [],
        grantedSteps: [],
        skipped: false,
        ...overrides,
    };
}

test('首次读取：从未开始过返回 null（区别于「空进度」）', () => {
    const store = new GuideSaveStore(owner('first-read'), createMemoryGuideStorage());
    assert.equal(store.load(), null);
});

test('写入后读回：字段与时间戳正确，version 写死为当前 schema', () => {
    const store = new GuideSaveStore(owner('roundtrip'), createMemoryGuideStorage());
    const wrote = store.save(dataOf({
        currentStepId: '3-1',
        completedSteps: ['1-1', '1-2', '1-3', '2-1', '2-2'],
        grantedSteps: ['2-2'],
    }), 1000);
    assert.equal(wrote, true);

    const saved = store.load();
    assert.ok(saved);
    assert.equal(saved.version, GUIDE_SAVE_VERSION);
    assert.equal(saved.currentStepId, '3-1');
    assert.deepEqual(saved.completedSteps, ['1-1', '1-2', '1-3', '2-1', '2-2']);
    assert.deepEqual(saved.grantedSteps, ['2-2']);
    assert.equal(saved.startedAt, 1000);
    assert.equal(saved.updatedAt, 1000);
});

test('幂等：内容没变时第二次 save 不写盘（返回 false）', () => {
    const storage = createMemoryGuideStorage();
    const store = new GuideSaveStore(owner('idempotent'), storage);
    assert.equal(store.save(dataOf({ currentStepId: '2-1' }), 1000), true);
    // 第二次时间戳变但内容等价：updatedAt 会变 ⇒ 仍算一次写入，这里断言的是"字段级无变化"那条路径
    const again = store.save(dataOf({ currentStepId: '2-1' }), 1000);
    assert.equal(again, false);
});

test('合并写：旧实例晚写不会把进度倒退回去（completed 取并集）', () => {
    const storage = createMemoryGuideStorage();
    const store = new GuideSaveStore(owner('merge'), storage);

    store.save(dataOf({ currentStepId: '3-1', completedSteps: ['1-1', '1-2'] }), 1000);
    // 一个停留在旧状态的实例（比如某页面缓存的 GuideProgress）晚一步写盘
    store.save(dataOf({ currentStepId: '1-2', completedSteps: ['1-1'] }), 2000);

    const saved = store.load();
    assert.ok(saved);
    assert.deepEqual(saved.completedSteps, ['1-1', '1-2']);
    // 传入的 currentStepId 已完成 ⇒ 判定为落后，保留磁盘上的当前步
    assert.equal(saved.currentStepId, '3-1');
    assert.equal(saved.startedAt, 1000);
    assert.equal(saved.updatedAt, 2000);
});

test('坏档：JSON 损坏时按未开始处理，不抛', () => {
    const storage = createMemoryGuideStorage({
        [`${GUIDE_SAVE_KEY_PREFIX}.server:s1:role:broken-json`]: '{not json',
    });
    const store = new GuideSaveStore(owner('broken-json'), storage);
    assert.equal(store.load(), null);
});

test('版本不符：整份丢弃，按未开始处理', () => {
    const key = `${GUIDE_SAVE_KEY_PREFIX}.server:s1:role:old-version`;
    const storage = createMemoryGuideStorage({
        [key]: JSON.stringify({ version: 999, currentStepId: '5-1', completedSteps: ['1-1'] }),
    });
    const store = new GuideSaveStore(owner('old-version'), storage);
    assert.equal(store.load(), null);
});

test('字段级容错：缺 skipped / 数组写成字符串都不整份丢弃', () => {
    const key = `${GUIDE_SAVE_KEY_PREFIX}.server:s1:role:partial`;
    const storage = createMemoryGuideStorage({
        [key]: JSON.stringify({
            version: GUIDE_SAVE_VERSION,
            currentStepId: '2-1',
            completedSteps: ['1-1', '1-1', 42, ''],   // 去重 + 过滤非字符串
            grantedSteps: 'not-an-array',
        }),
    });
    const store = new GuideSaveStore(owner('partial'), storage);
    const saved = store.load();
    assert.ok(saved);
    assert.equal(saved.currentStepId, '2-1');
    assert.deepEqual(saved.completedSteps, ['1-1']);
    assert.deepEqual(saved.grantedSteps, []);
    assert.equal(saved.skipped, false);
    assert.equal(saved.startedAt, 0);
});

test('身份非法：roleId 为空时构造期抛错，不写串账号', () => {
    assert.throws(
        () => new GuideSaveStore({ roleId: '  ', serverId: 's1' }, createMemoryGuideStorage()),
        /缺少角色或区服身份/,
    );
});

test('预览态（owner=null）：只写内存，绝不落盘污染真账号', () => {
    const storage = createMemoryGuideStorage();
    const store = new GuideSaveStore(null, storage);
    store.save(dataOf({ currentStepId: '2-1' }), 1000);

    // 内存里读得到（同会话可用）
    assert.equal(store.load()?.currentStepId, '2-1');
    // 但存储里没有任何 key
    assert.equal(storage.getItem(`${GUIDE_SAVE_KEY_PREFIX}.preview`), null);
});

test('存储抛异常（隐私模式 / 配额满）：退回内存，本次会话不丢档', () => {
    const throwing = {
        getItem(): string | null { throw new Error('SecurityError'); },
        setItem(): void { throw new Error('QuotaExceededError'); },
    };
    const store = new GuideSaveStore(owner('throwing'), throwing);
    assert.equal(store.save(dataOf({ currentStepId: '4-1', completedSteps: ['1-1'] }), 1000), true);

    const saved = store.load();
    assert.ok(saved);
    assert.equal(saved.currentStepId, '4-1');
});

test('跨启动：全新实例从存储冷读上一进程写下的进度', () => {
    // 必须预置 storage 且**不给内存兜底留缓存**（key 是全新的 roleId），
    // 否则 `memoryFallback` 会先命中，这条测试就变成"自己读自己刚写的"，证明不了冷启动。
    const key = `${GUIDE_SAVE_KEY_PREFIX}.server:s1:role:cold-start`;
    const storage = createMemoryGuideStorage({
        [key]: JSON.stringify({
            version: GUIDE_SAVE_VERSION,
            currentStepId: '5-1',
            completedSteps: ['1-1', '1-2'],
            grantedSteps: ['1-1'],
            skipped: false,
            startedAt: 900,
            updatedAt: 950,
        }),
    });

    const store = new GuideSaveStore(owner('cold-start'), storage);
    const saved = store.load();
    assert.ok(saved);
    assert.equal(saved.currentStepId, '5-1');
    assert.deepEqual(saved.completedSteps, ['1-1', '1-2']);
    assert.equal(saved.startedAt, 900);
    assert.equal(saved.updatedAt, 950);
});

test('账号隔离：不同 role 的 key 互不干扰', () => {
    const storage = createMemoryGuideStorage();
    const a = new GuideSaveStore(owner('account-a'), storage);
    const b = new GuideSaveStore(owner('account-b'), storage);
    a.save(dataOf({ currentStepId: '3-1' }), 1000);
    assert.equal(b.load(), null);
    assert.notEqual(a.storageKey, b.storageKey);
});

test('restoreGuideProgress：按存档恢复到当前步，已完成步不重跑', () => {
    const store = new GuideSaveStore(owner('restore'), createMemoryGuideStorage());
    store.save(dataOf({
        currentStepId: '6-1',
        completedSteps: ['1-1', '1-2', '1-3', '2-1', '2-2', '3-1', '4-1', '5-1', '5-2', '5-3', '5-4'],
        grantedSteps: ['2-2', '3-1', '4-1'],
    }), 1000);

    const progress = restoreGuideProgress(store, STEPS);
    assert.ok(progress);
    assert.equal(progress.current?.stepId, '6-1');
    assert.deepEqual(progress.pendingRewards('2-2'), []);
});

test('restoreGuideProgress：配置坏掉时返回 null（本次不引导），不让主流程崩', () => {
    const store = new GuideSaveStore(owner('bad-config'), createMemoryGuideStorage());
    const broken = parseGuideSteps([{ stepId: '1-1', triggerType: 'firstLogin', nextStep: '9-9' }]);
    assert.equal(restoreGuideProgress(store, broken), null);
});

test('端到端：推进 5 步 → 存档 → 重启恢复 → 继续走到结束', () => {
    const storage = createMemoryGuideStorage();
    const first = new GuideSaveStore(owner('e2e'), storage);
    const p1 = new GuideProgress(STEPS);
    assert.ok(p1);
    for (let i = 0; i < 5; i += 1) {
        const current = p1.current;
        assert.ok(current);
        assert.ok(p1.complete(current.stepId));
    }
    first.save(p1.toSave(), 1000);

    const second = new GuideSaveStore(owner('e2e'), storage);
    const p2 = restoreGuideProgress(second, STEPS);
    assert.ok(p2);
    assert.equal(p2.current?.stepId, p1.current?.stepId);
    assert.deepEqual(p2.completedSteps.sort(), p1.completedSteps.sort());

    let guard = 0;
    while (p2.current && guard++ < 32) {
        const done = p2.complete(p2.current.stepId);
        assert.ok(done);
    }
    assert.equal(p2.isFinished, true);
    second.save(p2.toSave(), 2000);
    assert.equal(second.load()?.currentStepId, '');
});
