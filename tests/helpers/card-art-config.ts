import { readFileSync } from 'node:fs';
import { CARD_ART_TABLES, parseCardArtConfig, type ICardArtTableRows } from '../../assets/script/app/card/CardArtConfig';

function readRows(name: string): any[] {
    const table = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return table.v.map((values: unknown[]) => Object.fromEntries(table.k.map((key: string, index: number) => [key, values[index]])));
}

/** 三张矩阵表（cardUiArtRarity / cardUiArtClass / cardUiArtCamp）的真实对象行。 */
export function readCardArtTables(): ICardArtTableRows {
    return {
        rarity: readRows(CARD_ART_TABLES.rarity),
        cardClass: readRows(CARD_ART_TABLES.cardClass),
        camp: readRows(CARD_ART_TABLES.camp),
    };
}

export const cardArtConfig = parseCardArtConfig(readCardArtTables(), readRows('icon'));
