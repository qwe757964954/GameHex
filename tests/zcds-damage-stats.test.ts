import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildDamageStatsColumns, damageStatsBarRatio, damageValueOf, defaultEnemyOwner, enemyOwnersOf,
    formatDamageStatsValue, isDeckStatsUnit, type IZCDamageStatsUnit,
} from '../assets/script/app/zcds/model/ZCDamageStats';

const units: readonly IZCDamageStatsUnit[] = [
    { owner: 'player', unitId: '68001', cardId: '68001', name: '豌豆游侠', iconKey: 'cardHead/68001', rarity: 'green', damage: 1200, damageTaken: 300 },
    { owner: 'player', unitId: '68002', cardId: '68002', name: '巨力坚果', iconKey: '', rarity: 'blue', damage: 0, damageTaken: 800 },
    { owner: 'enemy', unitId: '68003', cardId: '68003', name: '火焰树妖', iconKey: 'cardHead/68003', rarity: 'purple', damage: 900, damageTaken: 100 },
    { owner: 'enemy2', unitId: '68004', cardId: '68004', name: '玉林好汉', iconKey: 'cardHead/68004', rarity: 'gold', damage: 450, damageTaken: 50 },
];

test('战斗统计按我方 / 敌方分栏，阵容外的行仍按页签过滤 0 值、分母取各自全队合计', () => {
    const damage = buildDamageStatsColumns(units, 'damage');
    assert.deepEqual(damage.own.map(unit => unit.cardId), ['68001'], '伤害页签不列 0 输出的阵容外单位');
    assert.deepEqual(damage.enemy.map(unit => unit.cardId), ['68003', '68004']);
    assert.equal(damage.totalOwn, 1200, '我方分母 = 我方全队合计');
    assert.equal(damage.totalEnemy, 1350, '敌方分母 = 敌方全队合计（900 + 450）');

    const taken = buildDamageStatsColumns(units, 'taken');
    assert.deepEqual(taken.own.map(unit => unit.cardId), ['68002', '68001'],
        '承伤页签保留只挨打的单位，并按承伤降序（阵容外单位没有阵容序可比）');
    assert.deepEqual(taken.enemy.map(unit => unit.cardId), ['68003', '68004']);
    assert.equal(taken.totalOwn, 1100, '承伤页签同一套口径：分母 = 全队总承伤');
    assert.equal(taken.totalEnemy, 150);
    assert.equal(damageValueOf(units[0], 'damage'), 1200);
    assert.equal(damageValueOf(units[0], 'taken'), 300);
});

/**
 * 11-24 需求：进局先按阵容序铺满整副卡组，拿到实际数据再按数值降序。
 *
 * 两段共用一条排序口径（数值降序 → 阵容序 → 席位序 → 卡 id），所以不需要「阶段开关」：
 * 开局全 0 时第一关键字恒等、自然落到阵容序。
 */
test('进局全 0 时按阵容序铺满整副卡组，有数据后按数值降序、同值仍按阵容序', () => {
    const deck = (damage: readonly number[]): IZCDamageStatsUnit[] => damage.map((value, index) => ({
        owner: 'player', unitId: `u${index}`, cardId: `c${index}`, name: `卡${index}`,
        iconKey: '', rarity: 'green', damage: value, damageTaken: 0, deckOrder: index,
    }));
    const opening = buildDamageStatsColumns(deck([0, 0, 0, 0]), 'damage');
    assert.deepEqual(opening.own.map(unit => unit.cardId), ['c0', 'c1', 'c2', 'c3'],
        '开局 0 伤害也要铺满阵容，并按阵容序（不再整列空白）');
    assert.equal(opening.totalOwn, 0, '全 0 时分母为 0（条全空）');
    assert.ok(opening.own.every(isDeckStatsUnit));

    const fought = buildDamageStatsColumns(deck([30, 900, 0, 500]), 'damage');
    assert.deepEqual(fought.own.map(unit => unit.cardId), ['c1', 'c3', 'c0', 'c2'],
        '数值降序；0 伤害的阵容卡仍留在列尾（按阵容序）');
    assert.equal(fought.totalOwn, 1430, '分母 = 30 + 900 + 0 + 500');

    const tie = buildDamageStatsColumns(deck([200, 200, 50, 50]), 'damage');
    assert.deepEqual(tie.own.map(unit => unit.cardId), ['c0', 'c1', 'c2', 'c3'],
        '同数值时必须保持阵容序（不稳定会让虚拟列表每帧重排、行闪烁）');

    const taken = buildDamageStatsColumns(deck([10, 0, 0, 0]).map(unit => ({ ...unit, damageTaken: unit.damage, damage: 0 })), 'taken');
    assert.deepEqual(taken.own.map(unit => unit.cardId), ['c0', 'c1', 'c2', 'c3'], '承伤页签同样铺满阵容');
});

test('敌方列只收当前选中的那一方，默认选席位序最小的敌方', () => {
    const units: readonly IZCDamageStatsUnit[] = [
        { owner: 'player', unitId: 'p', cardId: 'p', name: '我方', iconKey: '', rarity: 'green', damage: 100, damageTaken: 0, deckOrder: 0 },
        { owner: 'enemy', unitId: 'e1', cardId: 'e1', name: '敌方一', iconKey: '', rarity: 'blue', damage: 300, damageTaken: 0, deckOrder: 0 },
        { owner: 'enemy2', unitId: 'e2', cardId: 'e2', name: '敌方二', iconKey: '', rarity: 'purple', damage: 900, damageTaken: 0, deckOrder: 0 },
        { owner: 'enemy3', unitId: 'e3', cardId: 'e3', name: '敌方三', iconKey: '', rarity: 'gold', damage: 500, damageTaken: 0, deckOrder: 0 },
    ];
    assert.deepEqual(enemyOwnersOf(units), ['enemy', 'enemy2', 'enemy3'], '按席位序给出敌方列表（不含玩家）');
    assert.equal(defaultEnemyOwner(units), 'enemy', '默认选 id 小的敌方');
    assert.deepEqual(enemyOwnersOf(units, ['player', 'enemy2', 'enemy']), ['enemy', 'enemy2'],
        '席位表是权威来源：顺序仍按席位序，玩家那席要剔掉');

    const first = buildDamageStatsColumns(units, 'damage', 'enemy');
    assert.deepEqual(first.enemy.map(unit => unit.cardId), ['e1'], '只收选中的那一方');
    const third = buildDamageStatsColumns(units, 'damage', 'enemy3');
    assert.deepEqual(third.enemy.map(unit => unit.cardId), ['e3']);
    assert.equal(third.totalEnemy, 500, '分母跟着选中的那一方走（不是所有敌方合计）');
    const merged = buildDamageStatsColumns(units, 'damage');
    assert.deepEqual(merged.enemy.map(unit => unit.cardId), ['e2', 'e3', 'e1'],
        '没有席位上下文（老调用方）时退回全部敌方合并、按数值降序');
    assert.equal(merged.totalEnemy, 1700, '合并口径的分母 = 三方合计');

    assert.equal(defaultEnemyOwner([units[0]]), null, '单机局没有敌方 ⇒ 不选中任何一方');
    assert.deepEqual(enemyOwnersOf([]), []);
});

test('战斗统计数值按设计稿口径格式化，异常值收敛为 0', () => {
    assert.equal(formatDamageStatsValue(265700), '265.7K');
    assert.equal(formatDamageStatsValue(65288), '65288');
    assert.equal(formatDamageStatsValue(100), '100');
    assert.equal(formatDamageStatsValue(100000), '100K');
    assert.equal(formatDamageStatsValue(1200000), '1.2M');
    assert.equal(formatDamageStatsValue(0), '0');
    assert.equal(formatDamageStatsValue(-5), '0');
    assert.equal(formatDamageStatsValue(Number.NaN), '0');
    assert.equal(formatDamageStatsValue(Number.POSITIVE_INFINITY), '0');
});

test('进度条 = 本行占全队总量的比例（不是列内第一满格），非零低值保留可见下限', () => {
    assert.equal(damageStatsBarRatio(1200, 1200), 1, '独占全队 ⇒ 满格');
    assert.equal(damageStatsBarRatio(600, 1200), 0.5);
    assert.equal(damageStatsBarRatio(0, 1200), 0);
    assert.equal(damageStatsBarRatio(1200, 0), 0, '分母为 0（开局全 0 / 单人局）⇒ 条空');
    assert.equal(damageStatsBarRatio(1, 100000), 0.02, '有伤害但占比极小时仍要看得见一条细线');
    assert.equal(damageStatsBarRatio(2000, 1200), 1, '脏数据也不许画出界');
});

test('整列各行的占比之和为 1：条长回答「占全队多少」，不是「离第一名多远」', () => {
    const deck = (damage: readonly number[]): IZCDamageStatsUnit[] => damage.map((value, index) => ({
        owner: 'player', unitId: `u${index}`, cardId: `c${index}`, name: `卡${index}`,
        iconKey: '', rarity: 'green', damage: value, damageTaken: 0, deckOrder: index,
    }));
    const columns = buildDamageStatsColumns(deck([30, 900, 0, 500]), 'damage');
    const ratios = columns.own.map(unit => damageStatsBarRatio(damageValueOf(unit, 'damage'), columns.totalOwn));
    const sum = ratios.reduce((total, ratio) => total + ratio, 0);
    assert.equal(columns.totalOwn, 1430);
    assert.deepEqual(ratios.map(ratio => Math.round(ratio * 1000) / 1000), [0.629, 0.35, 0.021, 0],
        '900/1430 ≈ 63%、500/1430 ≈ 35%、30/1430 ≈ 2.1%、0 伤害 = 空条（行序 = 数值降序）');
    assert.ok(Math.abs(sum - 1) < 1e-9, `占比之和必须为 1（实际 ${sum}）`);
    // 旧口径（按列内最大值）会把 900 画成满格、30 画成 3.3%；新口径它只占全队 63% / 2.1%。
    assert.equal(damageStatsBarRatio(900, 900), 1, '对比：最大值口径下第一名永远满格');
    assert.ok(damageStatsBarRatio(900, columns.totalOwn) < 1, '新口径下第一名也按占全队的份额画');
});