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
