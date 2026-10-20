import type { ZCDeckCard } from '../model/ZCCombatCatalog';
import { ZCOwner } from '../model/ZCMapConfig';

/** 领地 NPC 只占敌方席位（`player` 永远留给本机玩家）。 */
type ZCPveEnemyOwner = Exclude<ZCOwner, 'player'>;

const ENEMY_OWNERS: readonly ZCPveEnemyOwner[] = [ZCOwner.Enemy, ZCOwner.Enemy2, ZCOwner.Enemy3];

/** Keeps each territory NPC team's playable cards on its own AI seat. */
export function buildZCPveEnemyDecks(
    availableCards: readonly ZCDeckCard[],
    teamCardIds: readonly (readonly number[])[],
): Readonly<Partial<Record<ZCPveEnemyOwner, readonly ZCDeckCard[]>>> {
    if (teamCardIds.length > ENEMY_OWNERS.length) {
        throw new Error(`领地 NPC 队伍数量不能超过 ${ENEMY_OWNERS.length}`);
    }

    const byId = new Map(availableCards.map((card) => [card.id, card]));
    const systemCards = availableCards.filter((card) => card.unitId === undefined);
    const decks: Partial<Record<ZCPveEnemyOwner, readonly ZCDeckCard[]>> = {};
    for (const [index, ids] of teamCardIds.entries()) {
        const owner = ENEMY_OWNERS[index];
        if (!owner) throw new Error(`领地 NPC 队伍 ${index + 1} 没有对应的对局席位`);
        const selected: ZCDeckCard[] = [];
        for (const id of new Set(ids)) {
            if (!Number.isSafeInteger(id) || id <= 0) {
                throw new Error(`领地 NPC 队伍 ${index + 1} 包含无效卡牌 ID：${id}`);
            }
            const card = byId.get(String(id));
            if (!card || card.unitId === undefined) {
                throw new Error(`领地 NPC 队伍 ${index + 1} 包含不可上场卡牌 ID：${id}`);
            }
            selected.push(card);
        }
        if (!selected.length) throw new Error(`领地 NPC 队伍 ${index + 1} 没有可用卡牌`);
        decks[owner] = [...selected, ...systemCards];
    }
    return decks;
}
