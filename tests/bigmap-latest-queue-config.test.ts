import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { loadBigMapConfig } from '../assets/script/app/bigmap/application/BigMapConfigLoader';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import type { ConfigService } from '../assets/script/core/config/ConfigService';

function tables(): Record<string, unknown> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))]));
}

function currentQueue(): Record<string, unknown> {
    return { ...decompressBigMapRows(tables()[BIGMAP_TABLE.queue])[0] };
}

test('最新真实队列表删除三个客户端字段后仍可解析，保留队列价格及章节配置', () => {
    const raw = tables();
    const row = currentQueue();
    for (const key of ['offlineMaxHours', 'plotRows', 'plotCols']) assert.equal(key in row, false);
    const config = parseBigMapConfig(raw);
    assert.deepEqual(config.queue, {
        maxBuildQueue: row.maxBuildQueue, initBuildQueue: row.initBuildQueue,
        queueUnlockCost2: row.queueUnlockCost2, queueUnlockCost3: row.queueUnlockCost3,
        cancelReturnRate: row.cancelReturnRate, upgradeUnlockChapter: row.upgradeUnlockChapter,
        offlineMaxHours: 8, plotRows: 5, plotCols: 5,
    });
});

test('运行时 ConfigService 解压入口同样接受最新队列表，基地仍显示25格', async () => {
    const raw = tables();
    const service: ConfigService = {
        initialize: async () => {},
        async getTable<T>(name: string): Promise<readonly T[]> {
            return decompressBigMapRows(raw[name]) as unknown as readonly T[];
        },
    };
    const config = await loadBigMapConfig(service);
    const presenter = new BigMapPresenter({ config, storage: createMemoryBigMapStorage(),
        saveKey: 'queue-config', adventureChapter: () => 3, now: () => 1000 });
    assert.equal(presenter.plotCells().length, 25);
    assert.equal(presenter.base.buildings[0].hexId, 12);
    presenter.dispose();
});

test('历史队列表显式客户端参数继续生效，零小时仍明确禁用离线产出', () => {
    const raw = tables();
    for (const hours of [0, 3]) {
        const config = parseBigMapConfig({ ...raw, [BIGMAP_TABLE.queue]: [{ ...currentQueue(),
            offlineMaxHours: hours, plotRows: 7, plotCols: 9 }] });
        assert.equal(config.queue.offlineMaxHours, hours);
        assert.equal(config.queue.plotRows, 7);
        assert.equal(config.queue.plotCols, 9);
    }
});

for (const field of ['offlineMaxHours', 'plotRows', 'plotCols']) {
    test(`${field} 显式填写非法值时仍报错，不能用缺列默认值掩盖脏数据`, () => {
        const raw = tables();
        for (const value of [undefined, null, '', 'broken', NaN, Infinity, false, 1.5, -1]) {
            assert.throws(() => parseBigMapConfig({ ...raw, [BIGMAP_TABLE.queue]: [{ ...currentQueue(), [field]: value }] }),
                new RegExp(field));
        }
    });
}

test('队列业务必填字段和奇数布局约束保留校验', () => {
    const raw = tables();
    for (const field of ['maxBuildQueue', 'initBuildQueue', 'queueUnlockCost2', 'queueUnlockCost3', 'cancelReturnRate', 'upgradeUnlockChapter']) {
        const row = currentQueue();
        delete row[field];
        assert.throws(() => parseBigMapConfig({ ...raw, [BIGMAP_TABLE.queue]: [row] }), new RegExp(field));
    }
    assert.throws(() => parseBigMapConfig({ ...raw, [BIGMAP_TABLE.queue]: [{ ...currentQueue(), plotRows: 4 }] }), /奇数/);
});

test('队列槽位按 maxBuildQueue 全量返回：未解锁的标 locked，界面才知道上限几条', () => {
    const config = parseBigMapConfig(tables());
    const presenter = new BigMapPresenter({
        config, storage: createMemoryBigMapStorage(), saveKey: 'queue-capacity',
        adventureChapter: () => 3, now: () => 1000,
    });
    const views = presenter.queues();
    // 以前是 `slice(0, queueUnlocked)` —— 新号只能看见 1 条，`maxBuildQueue` 压根没体现。
    assert.equal(views.length, config.queue.maxBuildQueue, '槽位要按解锁上限给全');
    const locked = views.filter((view) => view.locked);
    assert.equal(locked.length, config.queue.maxBuildQueue - config.queue.initBuildQueue);
    assert.ok(views.slice(0, config.queue.initBuildQueue).every((view) => !view.locked));
    // 未解锁的槽位不能显示"忙着"（否则队列条会算成正在建造）。
    assert.ok(locked.every((view) => !view.busy && view.name === '' && view.remainSeconds === 0));
    // 解锁信息同样来自这张表的 maxBuildQueue / queueUnlockCost2。
    const unlock = presenter.queueUnlockInfo();
    assert.equal(unlock.max, config.queue.maxBuildQueue);
    assert.equal(unlock.current, config.queue.initBuildQueue);
    assert.equal(unlock.cost, config.queue.queueUnlockCost2);
    presenter.dispose();
});

test('队列表七个字段一个都不能白填：每个都在行为上有出处', () => {
    const config = parseBigMapConfig(tables());
    const row = currentQueue();
    assert.equal(config.queue.maxBuildQueue, row.maxBuildQueue);     // 槽位总数
    assert.equal(config.queue.initBuildQueue, row.initBuildQueue);   // 新档已解锁
    assert.equal(config.queue.queueUnlockCost2, row.queueUnlockCost2); // 第 2 条价格
    assert.equal(config.queue.queueUnlockCost3, row.queueUnlockCost3); // 第 3 条价格
    assert.equal(config.queue.cancelReturnRate, row.cancelReturnRate); // 取消返还比例
    assert.equal(config.queue.upgradeUnlockChapter, row.upgradeUnlockChapter); // 升级解锁章节
    const presenter = new BigMapPresenter({
        config, storage: createMemoryBigMapStorage(), saveKey: 'queue-fields',
        adventureChapter: () => row.upgradeUnlockChapter as number, now: () => 1000,
    });
    // upgradeUnlockChapter：到了这一章才允许升级建筑。
    assert.equal(presenter.upgradeUnlocked(), true);
    presenter.dispose();
});
