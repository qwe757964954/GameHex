import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRoleComposeView,
    ROLE_COMPOSE_HIGH_QUALITY,
    type IRoleComposeGem,
    type IRoleComposeQuality,
} from '../assets/script/app/role/RoleComposeView';
import { ROLE_TEXTS, roleQualityName } from '../assets/script/app/role/RoleTexts';

const gems: Record<string, IRoleComposeGem> = {
    g1: { quality: 2, iconKey: '图标_宝石_绿色' },
    g2: { quality: 3, iconKey: '图标_宝石_蓝色' },
    g3: { quality: 3, iconKey: '图标_宝石_蓝色' },
    g4: { quality: 4, iconKey: '图标_宝石_紫色' },
    g5: { quality: 7, iconKey: '图标_宝石_粉色' },
};

const qualities: IRoleComposeQuality[] = [
    { quality: 1, consume: 0, iconKey: '图标_宝石_白色' },
    { quality: 2, consume: 5, iconKey: '图标_宝石_绿色' },
    { quality: 3, consume: 5, iconKey: '图标_宝石_蓝色' },
    { quality: 4, consume: 5, iconKey: '图标_宝石_紫色' },
    { quality: 5, consume: 5, iconKey: '图标_宝石_橙色' },
    { quality: 6, consume: 5, iconKey: '图标_宝石_红色' },
    { quality: 7, consume: 5, iconKey: '图标_宝石_粉色' },
];

const find = (id: string) => gems[id] ?? null;

test('materials collapse into one chip per quality and estimate the next tiers', () => {
    // 参考稿的数据：绿 55 / 蓝 30 / 紫 10 → 蓝 11 / 紫 6 / 金 2 = 19。
    const view = buildRoleComposeView([
        { id: 'g1', count: 55 },
        { id: 'g2', count: 30 },
        { id: 'g4', count: 10 },
    ], find, qualities);

    assert.equal(view.gemCount, 95);
    assert.deepEqual(view.materials.map(chip => [chip.quality, chip.count]), [[2, 55], [3, 30], [4, 10]]);
    assert.deepEqual(view.outputs.map(chip => [chip.quality, chip.count]), [[3, 11], [4, 6], [5, 2]]);
    assert.deepEqual(view.outputs.map(chip => chip.iconKey), ['图标_宝石_蓝色', '图标_宝石_紫色', '图标_宝石_橙色']);
    assert.equal(view.outputCount, 19);
    assert.equal(view.topQuality, 4);
});

test('same-quality materials from different gems share one chip', () => {
    const view = buildRoleComposeView([
        { id: 'g2', count: 3 },
        { id: 'g3', count: 2 },
    ], find, qualities);

    assert.equal(view.materials.length, 1);
    assert.deepEqual(view.materials[0], { quality: 3, count: 5, iconKey: '图标_宝石_蓝色' });
    // 5 张蓝 → 1 张紫；紫档 consume 5，1 张不够再产出一档。
    assert.deepEqual(view.outputs.map(chip => [chip.quality, chip.count]), [[4, 1]]);
    assert.equal(view.outputCount, 1);
});

test('duplicate ids are accumulated instead of repeated as separate chips', () => {
    const view = buildRoleComposeView([{ id: 'g1', count: 2 }, { id: 'g1', count: 3 }], find, qualities);
    assert.equal(view.gemCount, 5);
    assert.deepEqual(view.materials, [{ quality: 2, count: 5, iconKey: '图标_宝石_绿色' }]);
});

test('unresolved gems still count as consumed but never render as a chip', () => {
    const view = buildRoleComposeView([{ id: 'missing', count: 4 }, { id: 'g2', count: 3 }], find, qualities);
    assert.equal(view.gemCount, 7);
    assert.deepEqual(view.materials.map(chip => chip.quality), [3]);
    assert.equal(view.topQuality, 3);
    // 3 张蓝不足 5 张，没有产出。
    assert.deepEqual(view.outputs, []);
    assert.equal(view.outputCount, 0);
});

test('top tier materials produce nothing and do not crash', () => {
    const view = buildRoleComposeView([{ id: 'g5', count: 10 }], find, qualities);
    assert.equal(view.gemCount, 10);
    assert.equal(view.topQuality, 7);
    assert.deepEqual(view.outputs, []);
});

test('a missing consume column hides the estimate instead of inventing one', () => {
    const partial: IRoleComposeQuality[] = [{ quality: 3, consume: 0, iconKey: '图标_宝石_蓝色' }];
    const view = buildRoleComposeView([{ id: 'g1', count: 10 }], find, partial);
    assert.equal(view.gemCount, 10);
    assert.deepEqual(view.materials.map(chip => chip.quality), [2]);
    assert.deepEqual(view.outputs, []);
    assert.equal(view.outputCount, 0);
});

test('empty materials produce an empty view that the popup refuses to open', () => {
    const view = buildRoleComposeView([], find, qualities);
    assert.deepEqual(view.materials, []);
    assert.deepEqual(view.outputs, []);
    assert.equal(view.gemCount, 0);
    assert.equal(view.outputCount, 0);
    assert.equal(view.topQuality, 0);
});

test('quality copy uses concrete names and the two section titles', () => {
    assert.equal(roleQualityName(5), '传说');
    assert.equal(roleQualityName(6), '绝世');
    assert.equal(roleQualityName(7), '神话');
    assert.equal(roleQualityName(0), '普通');
    assert.equal(roleQualityName(99), '普通');
    assert.equal(ROLE_TEXTS.gemComposeWarn('传说'), '含传说宝石，合成后无法找回');
    assert.equal(ROLE_TEXTS.gemComposeAgain('绝世'), '确认合成绝世宝石');
    assert.equal(ROLE_TEXTS.gemComposeSummary(95), '将消耗 95 颗宝石');
    assert.equal(ROLE_TEXTS.gemComposeOutput(19), '预计产出 19 颗宝石');
    assert.equal(ROLE_TEXTS.gemComposeChipCount(55), '×55');
});

test('the popup gate arms at 传说 and above', () => {
    const low = buildRoleComposeView([{ id: 'g4', count: 10 }], find, qualities);
    const high = buildRoleComposeView([{ id: 'g5', count: 5 }], find, qualities);
    assert.equal(low.topQuality >= ROLE_COMPOSE_HIGH_QUALITY, false);
    assert.equal(high.topQuality >= ROLE_COMPOSE_HIGH_QUALITY, true);
});
