import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { buildZCPveEnemyDecks } from '../assets/script/app/zcds/application/ZCPveCombatConfig';

function card(id: string, unitId?: string): ZCDeckCard {
    return { id, name: id, type: unitId ? 2 : 1, rarity: '绿', unitId };
}

test('PVE 队伍超过本地 NPC 席位数时明确报错', () => {
    const cards = [card('101', 'unit-1'), card('102', 'unit-2'), card('103', 'unit-3'), card('104', 'unit-4')];

    assert.throws(
        () => buildZCPveEnemyDecks(cards, [[101], [102], [103], [104]]),
        /NPC 队伍数量.*3/,
    );
});

test('PVE 队伍中的无效或不可上场卡牌 ID 不会被静默跳过', () => {
    const cards = [card('101', 'unit-1'), card('102')];

    for (const invalidId of [999, 1.5, Number.NaN, 102]) {
        assert.throws(
            () => buildZCPveEnemyDecks(cards, [[101, invalidId]]),
            /队伍 1.*卡牌 ID/,
            `expected ID ${invalidId} to be rejected`,
        );
    }
});
