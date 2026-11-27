import { createIconArtResolver, type IconArtResolver, type IconRow } from '../HeadArtModel';
import { ZC_CARD_CAMPS, ZC_CARD_CLASSES, ZC_CARD_RARITIES, type ZCCardCamp, type ZCCardClass, type ZCCardRarity, type ZCCardRarityMeta } from './CardLineupTypes';

const RARITY_ART_FIELDS = ['face', 'disc', 'frame', 'diamond'] as const;
const CLASS_ART_FIELDS = ['badge', 'boardHero'] as const;

export type ICardArtKey =
    | `${(typeof RARITY_ART_FIELDS)[number]}.${ZCCardRarity}`
    | `${(typeof CLASS_ART_FIELDS)[number]}.${ZCCardClass}`;

/**
 * 表内品级 id 与运行时 `ZCCardRarity` 同一套英文值（gold/purple/blue/green），无需映射。
 * 表里写 `金/紫/蓝/绿` 会被判未知品级。
 */
/** 三张矩阵表的表名（源表 A1 与 remoteRef 文件名）。 */
export const CARD_ART_TABLES = {
    rarity: 'cardUiArtRarity',
    cardClass: 'cardUiArtClass',
    camp: 'cardUiArtCamp',
} as const;

/**
 * 三张矩阵表的原始对象行，由 Repository / 对局加载器分别读取后传入。
 * 每张表首列是维度（rarity / class / camp），其余列是该维度的图种。
 */
export interface ICardArtTableRows {
    /** `cardUiArtRarity`：rarity + face / disc / frame / diamond */
    readonly rarity: readonly unknown[];
    /** `cardUiArtClass`：class + badge / boardHero */
    readonly cardClass: readonly unknown[];
    /** `cardUiArtCamp`：camp + name（阵营图标改由阵容页固定图提供，表内不再存路径） */
    readonly camp: readonly unknown[];
}

/**
 * 表必须齐全的键清单：品级 × 4 类图 + 职业 × 2 类图。
 * 阵营行只提供名称 / traits 反查，不再对应图片键。
 * 单一来源，测试与文档直接引用它，不再各自硬编码数量。
 */
function buildRequiredCardArtKeys(): ICardArtKey[] {
    const keys: ICardArtKey[] = [];
    for (const rarity of ZC_CARD_RARITIES) {
        for (const field of RARITY_ART_FIELDS) keys.push(`${field}.${rarity}`);
    }
    for (const cardClass of ZC_CARD_CLASSES) {
        for (const field of CLASS_ART_FIELDS) keys.push(`${field}.${cardClass}`);
    }
    return keys;
}

export const REQUIRED_CARD_ART_KEYS: readonly ICardArtKey[] = buildRequiredCardArtKeys();

/**
 * 品级行（`cardUiArtRarity`）：`name` 是展示文案（普通/稀有/史诗/传说），`sort` 是列表排序权重，0 最前。
 *
 * 结构直接复用 `ZCCombatCatalog.ZCCardRarityMeta`：注入品级元数据时，模型层与卡牌层拿到的是同一份形状。
 */
export type ICardRarityMeta = ZCCardRarityMeta;

/** 职业行（`cardUiArtClass`）：`name` 既是中文显示名，也是 `pvpCard.traits.attack` 的取值。 */
export interface ICardClassMeta {
    readonly id: ZCCardClass;
    readonly name: string;
    readonly sort: number;
}

/** 阵营行（`cardUiArtCamp`）：`name` 既是中文显示名，也是 `pvpCard.traits.camp` 的取值。 */
export interface ICardCampMeta {
    readonly id: ZCCardCamp;
    readonly name: string;
}

/** 阵容展示、排序与 traits 反查共用的维度元数据。 */
export interface ICardLineupCatalog {
    /** 表行顺序。 */
    readonly rarities: readonly ICardRarityMeta[];
    readonly classes: readonly ICardClassMeta[];
    readonly camps: readonly ICardCampMeta[];
    /** `traits.attack` 中文 → 职业；未知返回 null。 */
    classOfTrait(name: string): ZCCardClass | null;
    /** `traits.camp` 中文 → 阵营；未知返回 null。 */
    campOfTrait(name: string): ZCCardCamp | null;
}

export interface ICardArtConfig {
    /** 品级 / 职业两张矩阵表合成后的稳定键 → 资源完整相对路径（不带扩展名 / `/spriteFrame`）。 */
    readonly paths: ReadonlyMap<ICardArtKey, string>;
    /**
     * icon.json 解析器（`pvpCard.headIcon` → 头像 / 立绘），不来自卡牌矩阵表。
     * 两套真源在这一处汇合：卡牌固定件取 `paths`，角色专属图取 `heroIcons`。
     */
    readonly heroIcons: IconArtResolver;
    /** 三个维度的名称与排序（来自表的 `name` / `sort` 列）。 */
    readonly lineup: ICardLineupCatalog;
}

// 原生 V8 未启用 ICU 时无法解析 Unicode 属性转义；资源名使用中英文、数字、下划线和连字符。
const CARD_ART_PATH_PATTERN = /^(image|icons)\/[A-Za-z0-9\u4e00-\u9fff_-]+(?:\/[A-Za-z0-9\u4e00-\u9fff_-]+)+$/;

function asRow(value: unknown, table: string): Record<string, unknown> {
    if (!value || typeof value !== 'object') throw new Error(`${table} 行必须是对象`);
    return value as Record<string, unknown>;
}

function readPath(row: Record<string, unknown>, field: string, table: string, key: string): string {
    const value = row[field];
    if (typeof value !== 'string' || !CARD_ART_PATH_PATTERN.test(value) || value.endsWith('/spriteFrame')) {
        throw new Error(`${table} 路径无效：${key}=${String(value)}`);
    }
    return value;
}

function readSort(row: Record<string, unknown>, table: string, key: string): number {
    const value = row.sort;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${table} sort 无效：${key}=${String(value)}（需为非负整数）`);
    }
    return value;
}

function readName(row: Record<string, unknown>, table: string, key: string): string {
    const value = row.name;
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${table} name 无效：${key}`);
    return value.trim();
}

/** Repository 边界一次校验三张表并合成映射，渲染只消费已解析的路径。 */
export function parseCardArtConfig(tables: ICardArtTableRows, iconRows: readonly IconRow[]): ICardArtConfig {
    const paths = new Map<ICardArtKey, string>();
    const rarities: ICardRarityMeta[] = [];
    const seenRaritySort = new Set<number>();

    const seenRarity = new Set<string>();
    const seenRarityName = new Set<string>();
    for (const value of tables.rarity) {
        const table = CARD_ART_TABLES.rarity;
        const row = asRow(value, table);
        const rarityId = row.rarity;
        if (typeof rarityId !== 'string' || !ZC_CARD_RARITIES.includes(rarityId as ZCCardRarity)) {
            throw new Error(`${table} 未知品级：${String(rarityId)}（只接受 gold/purple/blue/green）`);
        }
        if (seenRarity.has(rarityId)) throw new Error(`${table} 重复品级：${rarityId}`);
        seenRarity.add(rarityId);
        const rarity = rarityId as ZCCardRarity;
        const name = readName(row, table, rarityId);
        if (seenRarityName.has(name)) throw new Error(`${table} name 重复：${name}`);
        seenRarityName.add(name);
        const sort = readSort(row, table, rarityId);
        if (seenRaritySort.has(sort)) throw new Error(`${table} sort 重复：${rarityId}=${sort}`);
        seenRaritySort.add(sort);
        rarities.push({ id: rarity, name, sort });
        for (const field of RARITY_ART_FIELDS) {
            const key = `${field}.${rarity}` as const;
            paths.set(key, readPath(row, field, table, key));
        }
    }

    const classes: ICardClassMeta[] = [];
    const classByTrait = new Map<string, ZCCardClass>();
    const seenClassSort = new Set<number>();
    const seenClass = new Set<string>();
    for (const value of tables.cardClass) {
        const table = CARD_ART_TABLES.cardClass;
        const row = asRow(value, table);
        const cardClass = row.class as ZCCardClass;
        if (!ZC_CARD_CLASSES.includes(cardClass)) {
            throw new Error(`${table} 未知职业：${String(cardClass)}`);
        }
        if (seenClass.has(cardClass)) throw new Error(`${table} 重复职业：${cardClass}`);
        seenClass.add(cardClass);
        const name = readName(row, table, cardClass);
        if (classByTrait.has(name)) throw new Error(`${table} name 重复：${name}（traits 归一化会歧义）`);
        classByTrait.set(name, cardClass);
        const sort = readSort(row, table, cardClass);
        if (seenClassSort.has(sort)) throw new Error(`${table} sort 重复：${cardClass}=${sort}`);
        seenClassSort.add(sort);
        classes.push({ id: cardClass, name, sort });
        for (const field of CLASS_ART_FIELDS) {
            const key = `${field}.${cardClass}` as const;
            paths.set(key, readPath(row, field, table, key));
        }
    }

    const camps: ICardCampMeta[] = [];
    const campByTrait = new Map<string, ZCCardCamp>();
    const seenCamp = new Set<string>();
    for (const value of tables.camp) {
        const table = CARD_ART_TABLES.camp;
        const row = asRow(value, table);
        const camp = row.camp as ZCCardCamp;
        if (!ZC_CARD_CAMPS.includes(camp)) {
            throw new Error(`${table} 未知阵营：${String(camp)}`);
        }
        if (seenCamp.has(camp)) throw new Error(`${table} 重复阵营：${camp}`);
        seenCamp.add(camp);
        const name = readName(row, table, camp);
        if (campByTrait.has(name)) throw new Error(`${table} name 重复：${name}（traits 归一化会歧义）`);
        campByTrait.set(name, camp);
        camps.push({ id: camp, name });
    }
    if (camps.length !== ZC_CARD_CAMPS.length) {
        const missing = ZC_CARD_CAMPS.find(camp => !seenCamp.has(camp));
        throw new Error(`cardUiArtCamp 缺少映射：camp.${missing}`);
    }

    for (const key of REQUIRED_CARD_ART_KEYS) if (!paths.has(key)) throw new Error(`cardUiArt 缺少映射：${key}`);

    const lineup: ICardLineupCatalog = {
        rarities,
        classes,
        camps,
        classOfTrait: (name) => classByTrait.get(name) ?? null,
        campOfTrait: (name) => campByTrait.get(name) ?? null,
    };
    return { paths, heroIcons: createIconArtResolver(iconRows), lineup };
}
