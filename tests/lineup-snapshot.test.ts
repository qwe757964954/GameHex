import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LINEUP_SNAPSHOT_KEY,
    LINEUP_SNAPSHOT_MAX_AGE_MS,
    LINEUP_SNAPSHOT_VERSION,
    clearLineupSnapshot,
    normalizeLineupSnapshot,
    readLineupSnapshot,
    writeLineupSnapshot,
} from '../assets/script/app/card/LineupSnapshot';
import type { LineupSnapshotStorage } from '../assets/script/app/card/LineupSnapshot';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';

/**
 * 「卡牌阵容」首帧快照（`LineupSnapshot`）的判据。
 *
 * 这个模块存在的唯一理由：进页面到服务端回包之间**不许**显示 prefab 的默认外观
 * （8 个同款雕像 + 「3级」）。所以它的失败模式必须全是「安静返回 null」——
 * 脏数据、过期、JSON 坏、存储不可用，任何一种都不能抛、也不能返回半成品阵容。
 */

class MemoryStorage implements LineupSnapshotStorage {
    readonly map = new Map<string, string>();
    failWrite = false;

    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        if (this.failWrite) throw new Error('quota exceeded');
        this.map.set(key, value);
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }
}

//  `ZCDeckCard` 的字段大多可选，但 `type` / `rarity` 是必填枚举；这里只关心 `id` / `name`，
//  所以用 `unknown` 中转，避免为一个夹具把整张表的字段抄一遍。
const CARD = (id: string): ZCDeckCard => ({ id, name: `卡${id}` }) as unknown as ZCDeckCard;

const payload = (overrides: Record<string, unknown> = {}) => ({
    version: LINEUP_SNAPSHOT_VERSION,
    savedAt: 1_000,
    cards: [CARD('101'), CARD('102')],
    levels: { '101': 5, '102': 3 },
    ...overrides,
});

test('写进去能原样读回来（卡组 + 等级）', () => {
    const storage = new MemoryStorage();
    writeLineupSnapshot([CARD('101'), CARD('102')], new Map([['101', 5], ['102', 3]]), 1_000, storage);

    const snapshot = readLineupSnapshot(1_000, storage);
    assert.ok(snapshot);
    assert.deepEqual(snapshot.cards.map((card) => card.id), ['101', '102']);
    assert.deepEqual(snapshot.levels, { '101': 5, '102': 3 });
    assert.equal(storage.map.has(LINEUP_SNAPSHOT_KEY), true);
});

test('版本不符：整份丢弃（不做迁移）', () => {
    const storage = new MemoryStorage();
    storage.setItem(LINEUP_SNAPSHOT_KEY, JSON.stringify(payload({ version: LINEUP_SNAPSHOT_VERSION + 1 })));
    assert.equal(readLineupSnapshot(1_000, storage), null);
});

test('过期就用不了，而且顺手把键删掉（否则每次进页面都白读一次）', () => {
    const storage = new MemoryStorage();
    storage.setItem(LINEUP_SNAPSHOT_KEY, JSON.stringify(payload({ savedAt: 1_000 })));
    const justExpired = 1_000 + LINEUP_SNAPSHOT_MAX_AGE_MS + 1;

    assert.equal(readLineupSnapshot(justExpired, storage), null);
    assert.equal(storage.map.has(LINEUP_SNAPSHOT_KEY), false, '过期快照要清键，不能留着反复读');
});

test('savedAt 在未来（设备时间被往回调）也算不可信', () => {
    const storage = new MemoryStorage();
    storage.setItem(LINEUP_SNAPSHOT_KEY, JSON.stringify(payload({ savedAt: 5_000 })));
    assert.equal(readLineupSnapshot(1_000, storage), null);
});

test('脏数据一律 null：卡缺 id / JSON 坏 / 不是对象', () => {
    const noisy = [
        payload({ cards: [{ name: '没有 id' }] }),
        payload({ cards: 'not-an-array' }),
        payload({ savedAt: 'yesterday' }),
        payload({ cards: [{ id: '', name: '空 id' }] }),
    ];
    for (const raw of noisy) {
        assert.equal(normalizeLineupSnapshot(raw, 1_000), null, `应判脏：${JSON.stringify(raw)}`);
    }

    const storage = new MemoryStorage();
    storage.setItem(LINEUP_SNAPSHOT_KEY, '{ 这不是 json');
    assert.equal(readLineupSnapshot(1_000, storage), null);
    assert.equal(storage.map.has(LINEUP_SNAPSHOT_KEY), false, '坏 JSON 要清掉');
});

test('没有存储 / 写不进去：安静失败，不抛', () => {
    assert.equal(readLineupSnapshot(1_000, null), null);

    const storage = new MemoryStorage();
    storage.failWrite = true;
    assert.doesNotThrow(() => writeLineupSnapshot([CARD('101')], new Map(), 1_000, storage));
    assert.equal(readLineupSnapshot(1_000, storage), null);

    assert.doesNotThrow(() => clearLineupSnapshot(storage));
});

test('空卡组能存能读（玩家一键下阵后保存过）', () => {
    const storage = new MemoryStorage();
    writeLineupSnapshot([], new Map(), 1_000, storage);
    const snapshot = readLineupSnapshot(1_000, storage);
    assert.ok(snapshot);
    assert.equal(snapshot.cards.length, 0);
});
