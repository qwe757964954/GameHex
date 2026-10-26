/**
 * 中立资源组合（表 `neutralResourceGroup`，策划表 `PVP-中立资源配置.xlsx / 中立资源组合`）。
 *
 *  口径（2026-10-26 改版）：地图点位不再自带资源池，只写一个 `groupId`；
 *  开局抽签 = 「在组内按 `weight`（万分比）抽一个资源项」，抽中的**资源项 id** 记进快照，
 *  领取时按该行的 `resourceType` 分派奖励。这样「一点位能出哪几种资源、各占多少」全部
 *  收敛到配置表，地图 JSON 只留点位坐标 + 组号。
 *
 *  奖励数值**只此一份真源**：金币 / 充能点数 / 卡 id / 兵数 / buff key 全部从表行的
 *  `param` 解析出来（见 `parseZCNeutralResourceParam`），代码里不再有第二份数值常量。
 *  旧的 `neutralResource` 表（PVP-地块 / 中立资源 sheet）已下线，**别再往回读**。
 */
import { ZCCardType, type ZCDeckCard } from './ZCCombatCatalog';

/**
 * 资源类型 = `neutralResourceGroup.resourceType` 的同值常量。
 *
 *  1 宝箱     —— `param` 是金币数字，只发金币
 *  2 金矿     —— `param` 是 `{resId}`，领到即在该格盖一座金矿（属性复用卡牌）
 *  3 兵团     —— `param` 是 `{resId, value}`，直接产 `value` 个该卡的兵
 *  4 神器充能 —— `param` 是充能点数，只给充能
 *  5 兵营     —— `param` 是 `{resId}`，领到即在该格盖一座兵营
 *  6 战斗Buff —— `param` 是 `{resId}`，`resId` 是 J 表光环 buff.key
 */
export const ZCNeutralResourceType = {
    Chest: 1,
    Mine: 2,
    Unit: 3,
    ArtifactCharge: 4,
    Barracks: 5,
    BattleBuff: 6,
} as const;
export type ZCNeutralResourceType = (typeof ZCNeutralResourceType)[keyof typeof ZCNeutralResourceType];

/** `resourceType` 的合法值集合（外部数据收窄用）。 */
const ZC_NEUTRAL_RESOURCE_TYPE_SET: ReadonlySet<number> = new Set(Object.values(ZCNeutralResourceType) as number[]);

/**
 * 格子上的**表现键**（不是业务类型）。
 *
 *  业务类型（`resourceType`）决定发什么，表现键决定画什么：
 *  一个 `type=1` 的资源项既可能画金币图（`gold`）也可能画宝箱图（`chest`），
 *  取决于表里的 `icon` 列。视图只认这个键。
 */
export const ZCNeutralResourceVisual = {
    Gold: 'gold',
    Mine: 'mine',
    Chest: 'chest',
    UnitCap: 'unit_cap',
    ArtifactCharge: 'artifact_charge',
    Barracks: 'barracks',
    Buff: 'buff',
} as const;
export type ZCNeutralResourceVisual = (typeof ZCNeutralResourceVisual)[keyof typeof ZCNeutralResourceVisual];

/** 表里 `icon` 列允许的静态图键（其它值视为没配图，走类型默认）。 */
const ZC_NEUTRAL_ICON_KEYS: ReadonlySet<string> = new Set<string>([
    ZCNeutralResourceVisual.Gold,
    ZCNeutralResourceVisual.Mine,
    ZCNeutralResourceVisual.Chest,
]);

/** 一个资源项 = 表里的一行（同组多行组成一个抽取池）。 */
export interface ZCNeutralResourceItem {
    /** 资源项 id（表 `id` 列）；**全局唯一**，快照里存的就是它。 */
    readonly id: number;
    readonly groupId: number;
    readonly groupName: string;
    readonly resourceType: ZCNeutralResourceType;
    /** 组内抽取权重（万分比）；`0` = 不参与抽取。 */
    readonly weight: number;
    /** `resourceType=1` 时的金币数。 */
    readonly gold: number;
    /** `resourceType=4` 时的充能点数。 */
    readonly artifactCharge: number;
    /** `resourceType=2/3/5` 引用的卡牌 id（`pvpCard.id`）。 */
    readonly cardId: string | null;
    /** `resourceType=3` 直接产出的兵数。 */
    readonly unitCount: number;
    /** `resourceType=6` 引用的 J 表光环 buff key。 */
    readonly buffKey: string | null;
    /** 格子上画什么。 */
    readonly visual: ZCNeutralResourceVisual;
}

/** 一个组合 = 同一 `groupId` 的若干资源项。 */
export interface ZCNeutralResourceGroup {
    readonly groupId: number;
    readonly name: string;
    readonly items: readonly ZCNeutralResourceItem[];
}

/** 编译后的全量组合：`groupId` → 组合，加上 `itemId` 直查。 */
export interface ZCNeutralResourceCatalog {
    readonly groups: ReadonlyMap<number, ZCNeutralResourceGroup>;
    readonly items: ReadonlyMap<number, ZCNeutralResourceItem>;
}

const EMPTY_CATALOG: ZCNeutralResourceCatalog = { groups: new Map(), items: new Map() };

let catalog: ZCNeutralResourceCatalog = EMPTY_CATALOG;

/** 表未加载时的空目录（用例与初始化失败路径共用）。 */
export function emptyZCNeutralResourceCatalog(): ZCNeutralResourceCatalog {
    return EMPTY_CATALOG;
}

/**
 * 表行 → 组合目录，并做**形状校验**。
 *
 *  ⚠️ 校验口径按 `resourceType` 分支，不做「统一当对象 / 统一当数组」的宽松处理：
 *  宝箱与充能的 `param` 是数字，建筑与 buff 是单个对象，兵团多一个 `value`。
 *  形状不对就抛 —— 静默吞掉会表现成「资源点领了但什么都没发」。
 *
 *  @param rows `neutralResourceGroup` 表的原始行（`configs.getTable` 结果）
 *  @param cards 本局卡牌目录（`pvpCard` 编译结果）—— 引用校验与类型校验都查它。
 *               ⚠️ 不能在这里用 `findCatalogCard`：目录要等 `loadPvpTables` 才装进全局，
 *               编译期全局还是上一局的。
 */
export function compileZCNeutralResourceCatalog(
    rows: readonly Record<string, unknown>[],
    cards: ReadonlyMap<string, ZCDeckCard>,
): ZCNeutralResourceCatalog {
    const groups = new Map<number, ZCNeutralResourceGroup>();
    const items = new Map<number, ZCNeutralResourceItem>();
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const where = `neutralResourceGroup[${index}]`;
        const groupId = row.groupId;
        const id = row.id;
        if (!Number.isInteger(groupId) || (groupId as number) <= 0) throw new Error(`${where}.groupId 必须是正整数`);
        if (!Number.isInteger(id) || (id as number) <= 0) throw new Error(`${where}.id 必须是正整数`);
        if (items.has(id as number)) throw new Error(`${where}.id 重复：${id}`);
        const groupName = typeof row.groupName === 'string' ? row.groupName.trim() : '';
        if (!groupName) throw new Error(`${where}.groupName 不能为空`);
        const resourceType = row.resourceType;
        if (typeof resourceType !== 'number' || !ZC_NEUTRAL_RESOURCE_TYPE_SET.has(resourceType)) {
            throw new Error(`${where}.resourceType 必须是 1~6：${String(resourceType)}`);
        }
        const weight = row.weight;
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
            throw new Error(`${where}.weight 必须是非负数`);
        }
        const param = row.param;
        const parsed = parseZCNeutralResourceParam(resourceType as ZCNeutralResourceType, param, where, cards);
        const icon = typeof row.icon === 'string' && ZC_NEUTRAL_ICON_KEYS.has(row.icon) ? row.icon : null;
        const item: ZCNeutralResourceItem = {
            id: id as number,
            groupId: groupId as number,
            groupName,
            resourceType: resourceType as ZCNeutralResourceType,
            weight,
            gold: parsed.gold,
            artifactCharge: parsed.artifactCharge,
            cardId: parsed.cardId,
            unitCount: parsed.unitCount,
            buffKey: parsed.buffKey,
            visual: neutralVisualOf(resourceType as ZCNeutralResourceType, icon),
        };
        items.set(item.id, item);
        const group = groups.get(item.groupId);
        if (group) {
            groups.set(item.groupId, { ...group, items: [...group.items, item] });
        } else {
            groups.set(item.groupId, { groupId: item.groupId, name: groupName, items: [item] });
        }
    }
    return { groups, items };
}

/** 装进运行时（`loadPvpTables` 调一次；传空 = 清空）。 */
export function setZCNeutralResourceCatalog(value: ZCNeutralResourceCatalog | null): void {
    catalog = value ?? EMPTY_CATALOG;
}

/** 当前目录（用例断言用，业务代码请用下面的窄接口）。 */
export function getZCNeutralResourceCatalog(): ZCNeutralResourceCatalog {
    return catalog;
}

/** 表现键：兵种 / 充能 / 兵营 / Buff 由类型固定，宝箱与金矿看 `icon`。 */
function neutralVisualOf(
    resourceType: ZCNeutralResourceType,
    icon: string | null,
): ZCNeutralResourceVisual {
    switch (resourceType) {
        case ZCNeutralResourceType.Unit: return ZCNeutralResourceVisual.UnitCap;
        case ZCNeutralResourceType.ArtifactCharge: return ZCNeutralResourceVisual.ArtifactCharge;
        case ZCNeutralResourceType.Barracks: return icon ? (icon as ZCNeutralResourceVisual) : ZCNeutralResourceVisual.Barracks;
        case ZCNeutralResourceType.BattleBuff: return icon ? (icon as ZCNeutralResourceVisual) : ZCNeutralResourceVisual.Buff;
        case ZCNeutralResourceType.Mine: return icon ? (icon as ZCNeutralResourceVisual) : ZCNeutralResourceVisual.Mine;
        case ZCNeutralResourceType.Chest:
        default: return icon ? (icon as ZCNeutralResourceVisual) : ZCNeutralResourceVisual.Chest;
    }
}

interface IZCParsedParam {
    readonly gold: number;
    readonly artifactCharge: number;
    readonly cardId: string | null;
    readonly unitCount: number;
    readonly buffKey: string | null;
}

const NO_PARAM: IZCParsedParam = {
    gold: 0, artifactCharge: 0, cardId: null, unitCount: 0, buffKey: null,
};

/** 数字参数（宝箱金币 / 充能点数）：正整数，允许 0 表示「只占位、不发」。 */
function nonNegativeInt(value: unknown, where: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`${where} 必须是非负整数：${String(value)}`);
    }
    return value;
}

/** 对象参数：只认 `resId`（可带 `value`），拒绝数组与多余字段。 */
function parseParamObject(param: unknown, where: string, allowValue: boolean): { resId: string; value: number } {
    if (!param || typeof param !== 'object' || Array.isArray(param)) {
        throw new Error(`${where} 必须是 {"resId":"…"} 形式的对象`);
    }
    const record = param as Record<string, unknown>;
    const resId = record.resId;
    if (typeof resId !== 'string' || !resId.trim()) throw new Error(`${where}.resId 必须是非空字符串`);
    for (const key of Object.keys(record)) {
        if (key !== 'resId' && !(allowValue && key === 'value')) {
            throw new Error(`${where} 出现未知字段：${key}`);
        }
    }
    if (!allowValue) return { resId, value: 0 };
    return { resId, value: nonNegativeInt(record.value, `${where}.value`) };
}

function parseZCNeutralResourceParam(
    resourceType: ZCNeutralResourceType,
    param: unknown,
    where: string,
    cards: ReadonlyMap<string, ZCDeckCard>,
): IZCParsedParam {
    switch (resourceType) {
        case ZCNeutralResourceType.Chest:
            return { ...NO_PARAM, gold: nonNegativeInt(param, `${where}.param（宝箱金币）`) };
        case ZCNeutralResourceType.ArtifactCharge:
            return { ...NO_PARAM, artifactCharge: nonNegativeInt(param, `${where}.param（充能点数）`) };
        case ZCNeutralResourceType.Mine: {
            const { resId } = parseParamObject(param, `${where}.param（金矿）`, false);
            return { ...NO_PARAM, cardId: requireCard(resId, ZCCardType.Mine, where, cards) };
        }
        case ZCNeutralResourceType.Barracks: {
            const { resId } = parseParamObject(param, `${where}.param（兵营）`, false);
            return { ...NO_PARAM, cardId: requireCard(resId, ZCCardType.Barracks, where, cards) };
        }
        case ZCNeutralResourceType.Unit: {
            const { resId, value } = parseParamObject(param, `${where}.param（兵团）`, true);
            if (value <= 0) throw new Error(`${where}.param.value 必须是正整数（兵团数量）`);
            return { ...NO_PARAM, cardId: requireCard(resId, ZCCardType.Barracks, where, cards), unitCount: value };
        }
        case ZCNeutralResourceType.BattleBuff: {
            const { resId } = parseParamObject(param, `${where}.param（战斗Buff）`, false);
            return { ...NO_PARAM, buffKey: resId };
        }
        default:
            return NO_PARAM;
    }
}

/**
 * 引用的卡牌必须存在且类型对得上。
 *
 *  「兵团」（`type=3`）引用的必须是**兵营卡**（`pvpCard.type=2`）而不是建筑卡 ——
 *  兵团要 `unitId` 才能出兵；「金矿」「兵营」各自引用同级建筑卡。
 */
function requireCard(
    resId: string,
    expected: ZCCardType,
    where: string,
    cards: ReadonlyMap<string, ZCDeckCard>,
): string {
    const card = cards.get(resId);
    if (!card) throw new Error(`${where}.param.resId 引用了不存在的卡牌：${resId}`);
    if (card.type !== expected) {
        throw new Error(`${where}.param.resId（${resId}）卡牌类型应为 ${expected}，实际是 ${card.type}`);
    }
    return resId;
}

/** 取组合；未知 groupId 返回 null（地图配错时由编辑器侧拦，运行时不当成崩溃）。 */
export function neutralResourceGroupOf(groupId: number | null | undefined): ZCNeutralResourceGroup | null {
    if (!Number.isInteger(groupId)) return null;
    return catalog.groups.get(groupId as number) ?? null;
}

/** 取资源项；`null` / 未知 id 返回 null（调用侧不必判空两层）。 */
export function neutralResourceItemOf(itemId: number | null | undefined): ZCNeutralResourceItem | null {
    if (!Number.isInteger(itemId)) return null;
    return catalog.items.get(itemId as number) ?? null;
}

/** 表现键；未知 id 返回 null（视图据此不画图标）。 */
export function neutralResourceVisualOf(itemId: number | null | undefined): ZCNeutralResourceVisual | null {
    return neutralResourceItemOf(itemId)?.visual ?? null;
}

/**
 * 组内按 `weight`（万分比）抽一个资源项。
 *
 *  全部权重为 0（表里标注「草稿」的组合）⇒ 返回 `null`：该点位本局不出资源，
 *  这不是错误，但**别把它当成"抽到了空"**去发奖。
 *  权重合计不等于 10000 时按实际合计归一（改名中值不抛，避免策划调数值就炸对局）。
 */
export function drawZCNeutralResourceItem(
    groupId: number | null | undefined,
    random: () => number,
): ZCNeutralResourceItem | null {
    const group = neutralResourceGroupOf(groupId);
    if (!group) return null;
    const pool = group.items.filter((item) => item.weight > 0);
    if (!pool.length) return null;
    // ⚠️ 单项也要**消耗一次随机数**：整局的随机序列是共享的，这里少抽一次会让后面的
    // 地块类型 / 抽卡序列整体偏移（对局表现会跟改版前不一致，且固定 seed 的用例会莫名变红）。
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let cursor = clampZCNeutralRandom(random) * total;
    for (const item of pool) {
        cursor -= item.weight;
        if (cursor < 0) return item;
    }
    return pool[pool.length - 1];
}

/**
 * 选点阶段/未抽签时的**预览项**：组内权重最高者（并列取靠前的行）。
 *
 *  选点阶段资源还没落地（进游戏才抽），只能按这个"最可能的那个"显示图标；
 *  与旧实现「取 pool 里权重最高的资源 id」同口径。
 */
export function previewZCNeutralResourceItem(groupId: number | null | undefined): ZCNeutralResourceItem | null {
    const group = neutralResourceGroupOf(groupId);
    if (!group) return null;
    let best: ZCNeutralResourceItem | null = null;
    for (const item of group.items) {
        if (item.weight <= 0) continue;
        if (!best || item.weight > best.weight) best = item;
    }
    return best ?? group.items[0] ?? null;
}

/** 该资源项领取后要盖一座建筑（金矿 / 兵营）；其余类型只发资源。 */
export function isZCNeutralResourceBuilding(item: ZCNeutralResourceItem | null | undefined): boolean {
    return item?.resourceType === ZCNeutralResourceType.Mine || item?.resourceType === ZCNeutralResourceType.Barracks;
}

/** 抽签用随机数：[0,1) 夹紧，避免 `random()` 返回 1 时游标落在末项之外。 */
function clampZCNeutralRandom(random: () => number): number {
    const value = random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999999, value)) : 0;
}
