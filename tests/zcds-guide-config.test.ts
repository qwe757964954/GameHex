import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../assets/script/app/zcds/model/ZCGuideConfig';

test('指南配置在 model 边界归一化，排序且跳过脏条目', () => {
    const entries = parseGuideEntries([
        { id: 'tower', order: 2, title: '防御塔', icon: '防御塔', price: '80', rewards: [{ name: '蓝', rate: '50', rarity: '蓝' }] },
        { id: '', order: 1 },
        { id: 'mine', order: 1, title: '金矿', icon: '金矿', price: 40, rewards: [{ name: '坏数据', rate: 'NaN' }] },
    ]);

    assert.deepEqual(entries.map((entry) => entry.id), ['mine', 'tower']);
    assert.equal(entries[0].rewards.length, 0);
    assert.equal(entries[1].rewards[0].rate, 50);
    assert.equal(getGuideIconPath('金矿'), 'image/buildings/mine/spriteFrame');
    assert.equal(getGuideIconPath('未登记'), null);
});

test('指南参数对缺失和非法项采用稳定默认值', () => {
    assert.deepEqual(parseGuideParams([{ key: 'panelTitle', value: '战斗指南' }, { key: '', value: '忽略' }]), {
        panelTitle: '战斗指南', footerText: '', emptyText: '暂无指南内容',
    });
});
