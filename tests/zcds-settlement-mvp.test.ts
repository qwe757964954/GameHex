import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { buildSettlementMvp, formatSettlementAmount, type IZCSettlementMvpCard } from '../assets/script/app/zcds/model/ZCSettlementMvp';

/**
 * 结算 MVP 卡片的数据口径（纯函数，不依赖引擎）。
 *
 * 蓝湖「结算-MVP」稿（720×1610）：MVP 标识 + **本局赢家阵营输出最高的卡的骨骼模型** +
 * `Lv.x 名字` + 总输出 / 总承伤两条进度条（带百分比与数值）+「查看完整队伍」。
 * 这里只锁「谁当选、百分比怎么算、数字怎么缩写」，几何与美术在 prefab
 * （见 `zcds-settlement-page.test.ts`），骨骼播放契约见 `ZCSettlementMvpActor`。
 */

function card(
    owner: string, unitId: string, damage: number, damageTaken: number, extra: Partial<IZCSettlementMvpCard> = {},
): IZCSettlementMvpCard {
    return {
        owner: owner as ZCOwner, unitId, cardId: `card-${unitId}`,
        name: `${owner}-${unitId}`, prefabPath: `units/${unitId}`, prefabSize: 1,
        damage, damageTaken, level: 0, ...extra,
    };
}

test('数值缩写：千位 K / 百万位 M，整数不带小数尾巴', () => {
    assert.equal(formatSettlementAmount(0), '0');
    assert.equal(formatSettlementAmount(980), '980');
    assert.equal(formatSettlementAmount(999), '999');
    assert.equal(formatSettlementAmount(1000), '1K');
    assert.equal(formatSettlementAmount(265700), '265.7K', '设计稿示例 265.7K');
    assert.equal(formatSettlementAmount(1234), '1.2K');
    assert.equal(formatSettlementAmount(1234567), '1.2M');
    assert.equal(formatSettlementAmount(-5), '0', '负值按 0 处理');
});

test('只从赢家阵营里选输出最高的卡；全场最高在败方时不当选', () => {
    const mvp = buildSettlementMvp([
        card('player', '81', 50000, 90000),
        card('enemy', '82', 265700, 265700),
        card('enemy2', '83', 12000, 30000),
    ], ZCOwner.Player);
    assert.ok(mvp);
    assert.equal(mvp.owner, ZCOwner.Player);
    assert.equal(mvp.unitId, '81');
    assert.equal(mvp.name, 'player-81');
    assert.equal(mvp.prefabPath, 'units/81');
    assert.equal(mvp.dealtText, '50K');
    // 百分比分母仍是**全场所有卡**合计：50000 / 327700 ≈ 15.3% → 15%
    assert.equal(mvp.dealtRateText, '15%');
    assert.equal(mvp.takenText, '90K');
    assert.equal(mvp.takenRateText, '23%', '90000 / 385700 ≈ 23.3% → 23%');
});

test('同一阵营多张卡取输出最大者，百分比按全场合计', () => {
    const mvp = buildSettlementMvp([
        card('player', '81', 10000, 1000),
        card('player', '82', 90000, 10000),
        card('enemy', '83', 10000, 90000),
    ], ZCOwner.Player);
    assert.ok(mvp);
    assert.equal(mvp.unitId, '82');
    assert.equal(mvp.dealtText, '90K');
    assert.equal(mvp.dealtRateText, '82%', '90000 / 110000 ≈ 81.8% → 82%');
    assert.equal(mvp.takenRateText, '10%');
});

test('平局 / 撤退（无胜方）退化为全场输出最高的卡', () => {
    const mvp = buildSettlementMvp([
        card('player', '81', 5000, 0),
        card('enemy', '82', 7000, 0),
    ], null);
    assert.ok(mvp);
    assert.equal(mvp.owner, ZCOwner.Enemy);
    assert.equal(mvp.unitId, '82');
});

test('胜方阵营没有任何卡时退化为全场最高（不把 MVP 整块藏掉）', () => {
    const mvp = buildSettlementMvp([
        card('player', '81', 0, 4000),
        card('enemy', '82', 7000, 0),
    ], ZCOwner.Player);
    assert.ok(mvp);
    assert.equal(mvp.unitId, '82', 'player 侧 0 输出，退化到全场最高');
});

test('并列时先出现者当选（席位序 + 卡表序稳定）', () => {
    const mvp = buildSettlementMvp([
        card('player', '81', 5000, 0),
        card('player', '82', 5000, 0),
        card('enemy', '83', 5000, 0),
    ], ZCOwner.Player);
    assert.ok(mvp);
    assert.equal(mvp.unitId, '81');
    assert.equal(mvp.dealtRateText, '33%');
});

test('等级来自卡牌英雄等级：>0 出 Lv.x，缺省收起', () => {
    const leveled = buildSettlementMvp([
        card('player', '81', 9000, 1000, { level: 15 }),
        card('enemy', '82', 1000, 9000),
    ], ZCOwner.Player);
    assert.ok(leveled);
    assert.equal(leveled.levelText, 'Lv.15');

    const unknown = buildSettlementMvp([card('player', '81', 9000, 1000)], ZCOwner.Player);
    assert.ok(unknown);
    assert.equal(unknown.levelText, '', '本地局没有英雄等级 ⇒ 不显示 Lv.');
});

test('空统计 / 全员零输出时不出 MVP 卡', () => {
    assert.equal(buildSettlementMvp([], null), null);
    assert.equal(buildSettlementMvp([
        card('player', '81', 0, 0),
        card('enemy', '82', 0, 100),
    ], ZCOwner.Player), null, '全员 0 输出不出 MVP');
});

test('名字缺失退回卡 id；prefabSize 非法按 1', () => {
    const mvp = buildSettlementMvp([
        card('enemy', '82', 30, 0, { name: '', prefabSize: 0 }),
    ], ZCOwner.Enemy);
    assert.ok(mvp);
    assert.equal(mvp.name, 'card-82');
    assert.equal(mvp.prefabSize, 1);
    assert.equal(mvp.prefabPath, 'units/82');
});
