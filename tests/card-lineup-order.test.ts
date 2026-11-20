import assert from 'node:assert/strict';
import test from 'node:test';
import { sortLineupCards, visibleLineupCards } from '../assets/script/app/card/CardLineupTypes';
import { cardArtConfig } from './helpers/card-art-config';
import { ZCCardType, type ZCDeckCard, type ZCCardRarity, type ZCAttackTrait } from '../assets/script/app/zcds/model/ZCCombatCatalog';

function card(id: string, rarity: ZCCardRarity = 'green', attack: ZCAttackTrait = '坦克'): ZCDeckCard {
    return { id, name: id, type: ZCCardType.Barracks, rarity, traits: { attack, camp: '花果' } };
}

test('阵容页排除所有金矿类型，保留其余卡且不改动原阵型', () => {
    const cards = [card('archer'), { ...card('mine'), type: ZCCardType.Mine },
        { ...card('tower'), type: ZCCardType.Tower }, { ...card('another-mine'), type: ZCCardType.Mine }];
    assert.deepEqual(visibleLineupCards(cards).map(item => item.id), ['archer', 'tower']);
    assert.equal(cards.length, 4);
});

test('状态优先于品质和等级：已上阵、已解锁、有碎片未解锁、未获得', () => {
    const cards = [card('missing', 'gold'), card('fragments', 'purple'), card('unlocked', 'blue'), card('deployed')];
    const levels = new Map([['deployed', 1], ['unlocked', 20], ['fragments', 0]]);
    const fragments = new Map([['unlocked', { owned: 100 }], ['fragments', { owned: 1 }]]);
    assert.deepEqual(sortLineupCards(cards, new Set(['deployed']), levels, fragments, cardArtConfig.lineup).map(item => item.id),
        ['deployed', 'unlocked', 'fragments', 'missing']);
    assert.deepEqual(cards.map(item => item.id), ['missing', 'fragments', 'unlocked', 'deployed']);
});

for (const group of ['deployed', 'unlocked', 'fragments', 'missing']) {
    test(`${group} 同类依次按品质降序、等级降序、射法战坦排序`, () => {
        const cards = [card('green'), card('blue', 'blue'), card('purple', 'purple'),
            card('tank', 'gold'), card('warrior', 'gold', '战士'), card('mage', 'gold', '法师'), card('archer', 'gold', '射手')];
        const deployed = group === 'deployed' ? new Set(cards.map(item => item.id)) : new Set<string>();
        const levels = new Map(cards.map(item => [item.id, group === 'unlocked' || group === 'deployed' ? 5 : 0]));
        const fragments = new Map(cards.map(item => [item.id, { owned: group === 'fragments' ? 1 : 0 }]));
        if (group === 'unlocked' || group === 'deployed') {
            cards.push(card('higher-level', 'gold'));
            levels.set('higher-level', 6);
            levels.set('purple', 99);
            if (group === 'deployed') deployed.add('higher-level');
        }
        const expected = ['archer', 'mage', 'warrior', 'tank', 'purple', 'blue', 'green'];
        if (group === 'unlocked' || group === 'deployed') expected.unshift('higher-level');
        assert.deepEqual(sortLineupCards(cards, deployed, levels, fragments, cardArtConfig.lineup).map(item => item.id), expected);
    });
}

test('等级与碎片刷新会重新分组；全条件相同时保留原顺序', () => {
    const cards = [card('a'), card('b')];
    assert.deepEqual(sortLineupCards(cards, new Set(), new Map(), new Map(), cardArtConfig.lineup).map(item => item.id), ['a', 'b']);
    assert.deepEqual(sortLineupCards(cards, new Set(), new Map(), new Map([['b', { owned: 10 }]]), cardArtConfig.lineup).map(item => item.id), ['b', 'a']);
    assert.deepEqual(sortLineupCards(cards, new Set(), new Map([['a', 1]]), new Map([['b', { owned: 10 }]]), cardArtConfig.lineup).map(item => item.id), ['a', 'b']);
});

test('后端不可用时沿用离线等级；已上阵的卡不依赖英雄列表是否返回等级', () => {
    const cards = [card('a', 'gold'), card('b')];
    assert.deepEqual(sortLineupCards(cards, new Set(['b']), new Map(), new Map(), cardArtConfig.lineup, 3).map(item => item.id), ['b', 'a']);
});

test('可升级的卡排在最前，已上阵的也不例外（判据与条目上的升级箭头同源）', () => {
    const cards = [card('deployed', 'gold'), card('rich'), card('exp-short'), card('not-enough'), card('maxed')];
    const levels = new Map([['deployed', 5], ['rich', 3], ['exp-short', 4], ['not-enough', 4], ['maxed', 9]]);
    const fragments = new Map([
        // 碎片与种族经验同时够（升级按钮激活）⇒ 排最前，哪怕它没上阵、品质也更低。
        ['rich', { owned: 10, need: 10, maxed: false, upgradeable: true }],
        // 碎片够了、种族经验还差一截（按钮是灰的）⇒ 不进第一组（用户 2026-11-20 口径）。
        ['exp-short', { owned: 10, need: 10, maxed: false, upgradeable: false }],
        // 差一片 ⇒ 不进第一组。
        ['not-enough', { owned: 9, need: 10, maxed: false, upgradeable: false }],
        // 满级 ⇒ 不是「可升级」（箭头也不显示）。
        ['maxed', { owned: 99, need: 0, maxed: true, upgradeable: false }],
    ]);
    assert.deepEqual(sortLineupCards(cards, new Set(['deployed']), levels, fragments, cardArtConfig.lineup).map(item => item.id),
        // 后四张都只是「已解锁」，按等级降序（满级 9 > exp-short 4 = not-enough 4）。
        ['rich', 'deployed', 'maxed', 'exp-short', 'not-enough']);
    // 未解锁（0 级）的卡即使按钮激活也不算可升级 —— 那张图上是「解锁」，没有升级箭头。
    const locked = new Map([['not-enough', { owned: 30, need: 10, maxed: false, upgradeable: true }]]);
    assert.deepEqual(sortLineupCards([card('locked'), card('deployed')], new Set(['deployed']),
        new Map([['locked', 0], ['deployed', 5]]), locked, cardArtConfig.lineup).map(item => item.id),
        ['deployed', 'locked']);
});
