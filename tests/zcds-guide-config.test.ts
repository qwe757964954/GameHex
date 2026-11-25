import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../assets/script/app/zcds/model/ZCGuideConfig';

test('指南配置在 model 边界归一化，排序且跳过脏条目', () => {
    const entries = parseGuideEntries([
        { id: 'tower', order: 2, title: '防御塔', icon: 'tower', price: '80', rewards: [{ name: '蓝', rate: '50', rarity: 'blue' }] },
        { id: '', order: 1 },
        { id: 'mine', order: 1, title: '金矿', icon: 'mine', price: 40, rewards: [{ name: '坏数据', rate: 'NaN' }] },
    ]);

    assert.deepEqual(entries.map((entry) => entry.id), ['mine', 'tower']);
    assert.equal(entries[0].rewards.length, 0);
    assert.equal(entries[1].rewards[0].rate, 50);
    assert.equal(entries[1].rewards[0].rarity, 'blue');
    assert.equal(getGuideIconPath('mine'), 'image/buildings/mine/spriteFrame');
    assert.equal(getGuideIconPath('tower'), null);
});

test('指南只接受登记的图标和品级，并拒绝非法概率与超出槽位的奖励组', () => {
    const reward = (rate: unknown, rarity = 'gold') => ({ name: '奖励', rate, rarity });
    const [entry] = parseGuideEntries([
        { id: 'valid', order: 1, icon: 'barracks', rewards: [reward(0, 'empty'), reward('100')] },
        { id: 'overflow', rewards: Array.from({ length: 5 }, () => reward(20)) },
        { id: 'invalid', order: 2, rewards: [reward(null), reward(-1), reward(101)] },
    ]);
    assert.equal(entry.id, 'valid');
    assert.equal(entry.icon, 'barracks');
    assert.deepEqual(entry.rewards.map(({ rate, rarity }) => [rate, rarity]), [[0, 'empty'], [100, 'gold']]);
    assert.equal(getGuideIconPath('toString'), null);
    assert.equal(getGuideIconPath('金矿'), null);
    const [unknownIds] = parseGuideEntries([{ id: 'unknown', icon: '兵营', rewards: [reward(100, '金'), reward(100, 'toString')] }]);
    assert.equal(unknownIds.icon, null);
    assert.deepEqual(unknownIds.rewards, []);
    assert.deepEqual(parseGuideEntries([{ id: 'overflow', rewards: Array.from({ length: 5 }, () => reward(20)) }]), []);
    assert.deepEqual(parseGuideEntries([{ id: 'invalid', rewards: [reward(null), reward(-1), reward(101)] }])[0].rewards, []);
});

test('指南参数对缺失和非法项采用稳定默认值', () => {
    assert.deepEqual(parseGuideParams([{ key: 'panelTitle', value: '战斗指南' }, { key: '', value: '忽略' }]), {
        panelTitle: '战斗指南', footerText: '', emptyText: '暂无指南内容', rewardColumns: 2,
    });
});

test('指南奖励列数读取现有配置并对无效值回退', () => {
    assert.equal(parseGuideParams([{ key: 'rewardColumns', value: '1' }]).rewardColumns, 1);
    assert.equal(parseGuideParams([{ key: 'rewardColumns', value: 3 }]).rewardColumns, 2);
});

test('指南导出表的图标和奖励品级均可直接作为运行时 ID', () => {
    const table: { k: string[]; v: unknown[][] } = JSON.parse(readFileSync('assets/remoteRef/zcGuide.json', 'utf8'));
    const rows = table.v.map(values => Object.fromEntries(table.k.map((key, index) => [key, values[index]])));
    const entries = parseGuideEntries(rows);
    assert.equal(entries.length, rows.length);
    for (const entry of entries) {
        const row = rows.find(value => value.id === entry.id);
        assert.ok(row);
        assert.ok(entry.icon && getGuideIconPath(entry.icon));
        assert.equal(entry.icon, row.icon);
        assert.deepEqual(entry.rewards, row.rewards);
    }
});
