/**
 * 引导待发队列（`GuideSyncOutbox`）的判据。
 *
 * 全部走注入式内存 storage，不 import `cc`。覆盖：FIFO、去重、跨会话、账号隔离、
 * 坏数据、按完成集裁剪，以及预览态不落盘。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGuideStorage } from '../assets/script/app/guide/model/GuideSaveStore';
import {
    GUIDE_OUTBOX_KEY_PREFIX,
    GuideSyncOutbox,
} from '../assets/script/app/guide/model/GuideSyncOutbox';

function owner(roleId: string) {
    return { roleId, serverId: 's1' };
}

test('先入先出：head 永远是最早入队的项，ack 后前进', () => {
    const outbox = new GuideSyncOutbox(owner('fifo'), createMemoryGuideStorage());
    assert.equal(outbox.head(), null);
    assert.equal(outbox.push('1-1', 1000), true);
    assert.equal(outbox.push('1-2', 2000), true);
    assert.equal(outbox.head()?.stepId, '1-1');
    assert.equal(outbox.size, 2);

    outbox.ack('1-1');
    assert.equal(outbox.head()?.stepId, '1-2');
    assert.equal(outbox.size, 1);
});

test('同一步重复入队只保留一条，不改变原有顺序', () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox(owner('dedupe'), storage);
    assert.equal(outbox.push('2-1', 1000), true);
    assert.equal(outbox.push('2-2', 2000), true);
    assert.equal(outbox.push('2-1', 3000), false);
    assert.deepEqual([outbox.head()?.stepId, outbox.size], ['2-1', 2]);
});

test('跨会话：新实例从存储冷读上次未发完的队列', () => {
    const key = `${GUIDE_OUTBOX_KEY_PREFIX}.server:s1:role:cold`;
    const storage = createMemoryGuideStorage({
        [key]: JSON.stringify({ version: 1, items: [{ stepId: '3-1', at: 900 }] }),
    });
    const outbox = new GuideSyncOutbox(owner('cold'), storage);
    assert.equal(outbox.head()?.stepId, '3-1');
    assert.equal(outbox.head()?.at, 900);
});

test('账号隔离：不同角色的队列互不干扰', () => {
    const storage = createMemoryGuideStorage();
    const a = new GuideSyncOutbox(owner('account-a'), storage);
    const b = new GuideSyncOutbox(owner('account-b'), storage);
    a.push('1-1', 1000);
    assert.equal(b.head(), null);
    assert.notEqual(a.storageKey, b.storageKey);
});

test('坏数据：JSON 损坏或结构不对时按空队列处理，不抛', () => {
    const key = `${GUIDE_OUTBOX_KEY_PREFIX}.server:s1:role:broken`;
    for (const raw of ['{not json', JSON.stringify({ version: 999, items: [{ stepId: '1-1' }] }), JSON.stringify({ version: 1, items: 'x' })]) {
        const outbox = new GuideSyncOutbox(owner('broken'), createMemoryGuideStorage({ [key]: raw }));
        assert.equal(outbox.head(), null);
        assert.equal(outbox.size, 0);
    }
});

test('裁剪：已完成步骤的待发项被移除，未完成的保留', () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox(owner('prune'), storage);
    outbox.push('1-1', 1000);
    outbox.push('2-1', 2000);
    outbox.push('3-1', 3000);
    outbox.prune(['1-1', '2-1']);
    assert.equal(outbox.head()?.stepId, '3-1');
    assert.equal(outbox.size, 1);
});

test('预览态（owner=null）：只进内存，绝不写存储', () => {
    const storage = createMemoryGuideStorage();
    const outbox = new GuideSyncOutbox(null, storage);
    outbox.push('1-1', 1000);
    assert.equal(outbox.head()?.stepId, '1-1');
    assert.equal(storage.getItem(`${GUIDE_OUTBOX_KEY_PREFIX}.preview`), null);
});
