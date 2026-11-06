/**
 * 卡牌维度「单源」护栏。
 *
 * ① 品级档位由表 `cardUiArtRarity.sort` 派生，代码里不再有第二份 rank 表：
 *    `rarityRank` 的输入只有一份元数据，改表权重档位就必须跟着变。
 * ② `pvpCard.traits` 里出现的职业 / 阵营中文值必须全部落在 `ZCCombatCatalog` 的词表内。
 *    表里新增一个词（比如第五个职业）不会报任何错：`resolveCardClass` 静默兜底成 `tank`、
 *    `resolveCardCamp` 静默返回 `null`，规则与表现一起歪，而且没有任何日志。
 * ③ 品级 id 数组在卡牌侧是 re-export，不是第二份副本 —— 用引用相等钉死。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    cardRarityMeta, rarityNameOfTier, rarityRank, setCardRarityMeta, ZC_ATTACK_TRAITS, ZC_CAMP_TRAITS,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZC_CARD_RARITIES as CARD_RARITIES } from '../assets/script/app/card/CardLineupTypes';
import { ZC_CARD_RARITIES as MODEL_RARITIES } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { cardArtConfig } from './helpers/card-art-config';

test('品级 id 数组只有一份：卡牌侧 re-export 的是同一个引用', () => {
    assert.equal(CARD_RARITIES, MODEL_RARITIES, 'CardLineupTypes 里不应再写一份品级数组');
    assert.deepEqual([...MODEL_RARITIES].sort(), ['blue', 'gold', 'green', 'purple']);
});

test('品级档位由表 sort 派生，改表权重档位自动跟随', () => {
    try {
        setCardRarityMeta(cardArtConfig.lineup.rarities);
        assert.deepEqual(cardRarityMeta().map((meta) => meta.sort), [0, 1, 2, 3], '注入后按 sort 升序');
        assert.equal(rarityRank('green'), 1);
        assert.equal(rarityRank('blue'), 2);
        assert.equal(rarityRank('purple'), 3);
        assert.equal(rarityRank('gold'), 4);
        assert.equal(rarityNameOfTier(4), '传说');
        assert.equal(rarityNameOfTier(5), '', '越界档位返回空串，不抛错');

        // 表把权重整体倒过来：金最靠后、绿最前，档位必须跟着反过来。
        setCardRarityMeta([
            { id: 'gold', name: '传说', sort: 3 },
            { id: 'purple', name: '史诗', sort: 2 },
            { id: 'blue', name: '稀有', sort: 1 },
            { id: 'green', name: '普通', sort: 0 },
        ]);
        assert.equal(rarityRank('green'), 4);
        assert.equal(rarityRank('gold'), 1);
        assert.equal(rarityNameOfTier(4), '普通');
    } finally {
        setCardRarityMeta([]);
        assert.equal(rarityRank('gold'), 4, '空注入回退默认兜底');
    }
});

test('pvpCard.traits 的职业 / 阵营取值与 ZCCombatCatalog 的词表完全一致', () => {
    const table = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    const column = table.k.indexOf('traits');
    assert.ok(column >= 0, 'pvpCard 表没有 traits 列');

    const attacks = new Set<string>();
    const camps = new Set<string>();
    for (const row of table.v) {
        const traits = row[column] as { attack?: string; camp?: string } | null;
        if (!traits) continue;
        if (traits.attack) attacks.add(traits.attack);
        if (traits.camp) camps.add(traits.camp);
    }

    assert.deepEqual([...attacks].sort(), [...ZC_ATTACK_TRAITS].sort(),
        '职业词表与 pvpCard 不一致：表里新词会被 resolveCardClass 静默兜底成 tank');
    assert.deepEqual([...camps].sort(), [...ZC_CAMP_TRAITS].sort(),
        '阵营词表与 pvpCard 不一致：表里新词会被 resolveCardCamp 静默返回 null');
});
