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
