import { toCount, toIdString, toPositiveInt } from '../net/RequestGuard';
import type { MatchPlayerData, MatchStat } from '../matching/MatchTypes';
import { MATCH_STAT_TYPES } from '../matching/MatchTypes';
import { applyHeadArt, createHeadArtResolver } from '../HeadArtModel';
import type { HeadArtResolver, HeadRow, IconRow } from '../HeadArtModel';
import { CARD_LEVEL_ATTR_STAT, type ZCCardLevelAttrs } from '../card/CardLevelAttr';

/**
 * 「开始游戏」数据模型与边界校验 —— 纯函数，零引擎依赖，可单测。
 */

/** PVP 匹配局 battleType（不能用 1，那撞老枚举 CHAPTER）。 */
export const ZC_BATTLE_TYPE_PVP = 1001;

export const ZC_BATTLE_TYPE_SLG_MONSTER = 1003;
export const ZC_BATTLE_TYPE_SLG_CAMP = 1004;
export type IZCSlgBattleType = typeof ZC_BATTLE_TYPE_SLG_MONSTER | typeof ZC_BATTLE_TYPE_SLG_CAMP;

/**
 * 章节战斗（领地关卡 / Boss 关）的 battleType。这里是固定值，不是每关的 configId；
 * 关卡身份由 battleParams 里的格子 id 决定。早期把 configId 当 battleType 发出去，
 * 服务端会按未知类型处理且不报错。
 */
export const ZC_BATTLE_TYPE_CHAPTER = 1002;

/**
 * 章节战斗内嵌的子类型，固定放在 battleParams[0]。
 * 1 = 格子战斗，2 = 宝箱战斗；两者参数结构相同，只有首项不同。
 * 子类型和 battleType 不是一回事，改错一个数字服务端同样会静默按未知类型处理。
 */
export const ZC_CHAPTER_BATTLE_SUB_CELL = 1;

/** 宝箱战斗的子类型。 */
export const ZC_CHAPTER_BATTLE_SUB_TREASURE = 2;

/**
 * 格子战斗参数：[子类型, 章节 id, 格子 id]。
 * proto 里 battleParams 是 repeated string，数字必须转字符串，否则 protobuf 写不出去。
 */
export function chapterCellBattleParams(chapterId: number, cellId: number): string[] {
    return [String(ZC_CHAPTER_BATTLE_SUB_CELL), String(chapterId), String(cellId)];
}

/**
 * 宝箱战斗参数，与格子战斗同结构，只有子类型不同。
 * 目前还没有调用点，先按服务端约定保留，接线时直接用。
 */
export function chapterTreasureBattleParams(chapterId: number, cellId: number): string[] {
    return [String(ZC_CHAPTER_BATTLE_SUB_TREASURE), String(chapterId), String(cellId)];
}

/**
 * 战斗单元来源类型，对应 CmdBattleUnitInfo.unitType：1 玩家、2 机器人、3 怪物。
 * 协议字段可选，老服务端不下发。缺省不能当成玩家，否则战绩和结算口径都会错。
 */
export const ZC_BATTLE_UNIT_TYPE = {
    Player: 1,
    Robot: 2,
    Monster: 3,
} as const;

export type ZCBattleUnitType = (typeof ZC_BATTLE_UNIT_TYPE)[keyof typeof ZC_BATTLE_UNIT_TYPE];

/** 服务端下发的单个战斗单元。 */
export interface ZCBattleHero {
    readonly heroId: number;
    readonly level: number;
}

/**
 * 服务端下发的增量属性，attrId 形如 attack.addRate。
 * 这是规则增量，不是绝对值；当绝对值用会少算，未知键丢掉则整条规则消失。
 * 与绝对值同时下发时：`addRate` 在定值之后叠乘（PVP 关卡对敌方的减益），`add` 仍被定值压制。
 * 目前只认 attack 和 maxHp，扩项时运行时白名单也要一起改。
 */
export interface ZCBattleHeroModifier {
    readonly statId: 'attack' | 'maxHp';
    /** add = 绝对增量；addRate = 相对基础值的比例。 */
    readonly operation: 'add' | 'addRate';
    readonly value: number;
}

export interface ZCBattleHeroAttrs {
    readonly heroId: number;
    /** 服务端最终数值，缺失项保留客户端计算结果。 */
    readonly attributes: Readonly<Partial<ZCCardLevelAttrs>>;
    /** 没有增量时不写这个键，保持与旧回包同形。 */
    readonly modifiers?: readonly ZCBattleHeroModifier[];
}

/**
 * 已校验的一对 key/value。协议注释写的是 id，但实际下发的是属性名，
 * 例如 levelAttackRatio，不是数字编号。
 */
export interface ZCBattleBuffEntry {
    /** 属性 key，原样保留。 */
    readonly key: string;
    /** 原始值字符串。 */
    readonly value: string;
    /** 解析出的有限数值；解析失败为 null。 */
    readonly numeric: number | null;
}

/** 一种来源的 buff 集合。source 的取值含义协议未说明，不要按 source 分流。 */
export interface ZCBattleBuff {
    readonly source: number;
    /** 保持服务端顺序，不去重不合并。 */
    readonly entries: readonly ZCBattleBuffEntry[];
}

export interface ZCBattleUnit {
    readonly campId: number;
    /** 服务端战斗单元 id；与阵营席位 campId 不是一回事。 */
    readonly unitId: number;
    readonly roleId: string;
    readonly serverId: number;
    readonly name: string;
    readonly power: number;
    readonly avatarId: string;
    readonly headFrameId: string;
    readonly gradeId: number;
    readonly gradeScore: number;
    readonly heroIds: readonly number[];
    /** 供卡牌技能解锁和升级在开局前编译。 */
    readonly heroes?: readonly ZCBattleHero[];
    readonly heroAttrs?: readonly ZCBattleHeroAttrs[];
    readonly artifactId: number;
    readonly artifactLevel: number;
    /** 来源类型；缺省或未知值不能当成玩家。 */
    readonly unitType?: ZCBattleUnitType;
    /** PVP buff；老服务端不下发时为 []。 */
    readonly buffs: readonly ZCBattleBuff[];
}

/** 一次开始游戏结果。 */
export interface ZCBattleStart {
    readonly battleId: string;
    /** 随机种子必须是字符串，uint64 超过 2^53，转 number 会让相邻种子相同。 */
    readonly seed: string;
    readonly version: string;
    readonly units: readonly ZCBattleUnit[];
    readonly mapInfo?: Readonly<CmdPvpMapInfo>;
}

export interface ZCBattleTeams {
    readonly mine: ZCBattleUnit | null;
    readonly enemy: ZCBattleUnit | null;
}

/** 只认 1/2/3，其余值一律归为 undefined。 */
export function normalizeBattleUnitType(value: unknown): ZCBattleUnitType | undefined {
    const num = toCount(value);
    if (num === ZC_BATTLE_UNIT_TYPE.Player) return ZC_BATTLE_UNIT_TYPE.Player;
    if (num === ZC_BATTLE_UNIT_TYPE.Robot) return ZC_BATTLE_UNIT_TYPE.Robot;
    if (num === ZC_BATTLE_UNIT_TYPE.Monster) return ZC_BATTLE_UNIT_TYPE.Monster;
    return undefined;
}

/**
 * 扁平字符串 [key,value,key,value] 转成对结构。三条边界都按「丢数据并告警」处理：
 * 奇数长度丢末位；空 key 整对丢弃；同 key 保留多条，不替消费方合并。
 * key 是属性名，不能当数字解析。
 */
export function parseBattleBuffEntries(buffs: readonly string[] | null | undefined): ZCBattleBuffEntry[] {
    const list = Array.isArray(buffs) ? buffs : [];
    const entries: ZCBattleBuffEntry[] = [];
    if (list.length % 2 !== 0) {
        console.warn('[BattleStartModel] buff 列表长度为奇数，末位已丢弃', list.length, list[list.length - 1]);
    }
    const pairCount = Math.floor(list.length / 2);
    for (let index = 0; index < pairCount; index += 1) {
        const keyText = list[index * 2];
        const valueText = list[index * 2 + 1];
        const key = typeof keyText === 'string' ? keyText.trim() : '';
        const value = typeof valueText === 'string' ? valueText : String(valueText ?? '');
        if (!key) {
            console.warn('[BattleStartModel] buff key 为空，整对已丢弃', keyText, valueText);
            continue;
        }
        entries.push({ key, value, numeric: toFiniteNumber(value) });
    }
    return entries;
}

/** 字符串 → 有限数值；空串 / 非数字 / Infinity 一律 `null`（不是 0，也不是 NaN）。 */
function toFiniteNumber(value: string): number | null {
    if (!value.trim()) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * buffInfo 转 ZCBattleBuff 数组。按数组原序保留，不合并同 source 的条目；
 * 缺字段或非数组按 [] 处理。
 */
export function parseBattleBuffs(infos: CmdPvpBuffInfo[] | null | undefined): ZCBattleBuff[] {
    const list = Array.isArray(infos) ? infos : [];
    const result: ZCBattleBuff[] = [];
    for (const info of list) {
        if (!info) continue;
        result.push({
            source: toCount(info.source),
            entries: parseBattleBuffEntries(info.buffs),
        });
    }
    return result;
}

/**
 * 取某个 key 的倍率值，同 key 多次出现按累乘。一个都没有时返回 null 而不是 1，
 * 调用方据此区分「没下发」和「明确 ×1」。
 */
export function battleBuffRatio(buffs: readonly ZCBattleBuff[] | null | undefined, key: string): number | null {
    const target = typeof key === 'string' ? key.trim() : '';
    if (!target) return null;
    let result: number | null = null;
    for (const group of Array.isArray(buffs) ? buffs : []) {
        for (const entry of group.entries) {
            if (entry.key !== target || entry.numeric === null) continue;
            result = (result ?? 1) * entry.numeric;
        }
    }
    return result;
}

/** CmdBattleUnitInfo → ZCBattleUnit；campId / showInfo 缺失返回 null。 */
export function normalizeBattleUnit(info: CmdBattleUnitInfo | null | undefined): ZCBattleUnit | null {
    if (!info) return null;
    const campId = toPositiveInt(info.campId);
    if (campId === null) {
        console.warn('[BattleStartModel] 缺少合法 campId，已跳过', info);
        return null;
    }
    const show = info.showInfo;
    if (!show) {
        console.warn('[BattleStartModel] 缺少 showInfo，已跳过', info);
        return null;
    }
    const heroes = normalizeBattleHeroes(info.heroInfos);
    // `campId` / `unitId` / `power` / `gradeId` / `gradeScore` / `artifactId` / `artifactLevel`
    // 在 proto 里都是 `int32` / `uint32` ⇒ 运行时就是 number，不再过一遍 Long 转换；
    // `roleId` / `img` / `headFrame` 是 `uint64` ⇒ `Long`，必须走 `toIdString`（超 2^53 保持精度）。
    return {
        campId,
        unitId: info.unitId,
        roleId: toIdString(show.roleId),
        serverId: show.serverId,
        name: typeof show.name === 'string' ? show.name : '',
        power: show.power,
        avatarId: toIdString(show.img),
        headFrameId: toIdString(show.headFrame),
        gradeId: show.gradeId,
        gradeScore: show.gradeScore,
        heroIds: heroes.map((hero) => hero.heroId),
        heroes,
        artifactId: info.artifactId,
        artifactLevel: info.artifactLevel,
        unitType: normalizeBattleUnitType(info.unitType),
        buffs: parseBattleBuffs(info.buffInfo),
        heroAttrs: parseBattleHeroAttrs(info.attrs),
    };
}

/** 累加中间态：一个 heroId 下的绝对值属性 + 增量属性。 */
interface IZCBattleHeroAttrAccumulator {
    readonly attributes: { -readonly [K in keyof ZCCardLevelAttrs]?: number };
    /** 键 = 完整 `attrId`（即 `statId.operation`），重复下发后覆盖前。 */
    readonly modifiers: Map<string, ZCBattleHeroModifier>;
}

/**
 * attrId 到增量语义的映射。与 CARD_LEVEL_ATTR_STAT（绝对值）分开，
 * 避免调用方靠有没有点号去猜语义。
 */
const BATTLE_HERO_MODIFIER_STATS: Readonly<Record<string, Pick<ZCBattleHeroModifier, 'statId' | 'operation'>>> = {
    'attack.add': { statId: 'attack', operation: 'add' },
    'attack.addRate': { statId: 'attack', operation: 'addRate' },
    'maxHp.add': { statId: 'maxHp', operation: 'add' },
    'maxHp.addRate': { statId: 'maxHp', operation: 'addRate' },
};

/** 协议数值只在边界转一次；重复英雄/属性按最后一条合法值覆盖。 */
export function parseBattleHeroAttrs(infos: CmdPvpHeroAttrInfo[] | null | undefined): ZCBattleHeroAttrs[] {
    const heroes = new Map<number, IZCBattleHeroAttrAccumulator>();
    for (const info of Array.isArray(infos) ? infos : []) {
        if (!info) continue;
        const heroId = toPositiveInt(info.heroId);
        if (heroId === null) continue;
        for (const attr of Array.isArray(info.attrs) ? info.attrs : []) {
            if (!attr) continue;
            const attrId = typeof attr.attrId === 'string' ? attr.attrId.trim() : '';
            const key = Object.prototype.hasOwnProperty.call(CARD_LEVEL_ATTR_STAT, attrId)
                ? CARD_LEVEL_ATTR_STAT[attrId] : undefined;
            const modifier = key || !Object.prototype.hasOwnProperty.call(BATTLE_HERO_MODIFIER_STATS, attrId)
                ? undefined : BATTLE_HERO_MODIFIER_STATS[attrId];
            //  合法性按**目标字段**判，不按 attrId 判：`maxHp.add = 0` 与 `maxHp = 0` 一样没意义，
            //  `attack` 系列允许 0 / 负数（服务端会下发减法类规则）。
            const statId = key ?? modifier?.statId;
            const value = typeof attr.value === 'string' && attr.value.trim() !== '' ? Number(attr.value) : NaN;
            if (!statId || !Number.isFinite(value) || (statId !== 'attack' && value === 0)) {
                console.warn('[BattleStartModel] 无效英雄属性，已跳过', heroId, attr);
                continue;
            }
            const entry = heroes.get(heroId) ?? { attributes: {}, modifiers: new Map<string, ZCBattleHeroModifier>() };
            if (key) {
                const previous = entry.attributes[key];
                if (previous !== undefined && previous !== value) {
                    console.warn('[BattleStartModel] 同一绝对值属性重复下发，后值覆盖前值',
                        heroId, attrId, previous, value);
                }
                entry.attributes[key] = value;
            } else if (modifier) {
                const previous = entry.modifiers.get(attrId);
                if (previous && previous.value !== value) {
                    //  这里按 `attrId` 覆盖，**不是**累加（下游 `applyZCTypedUnitModifiers` 才做累加）。
                    //  值不一致说明服务端按来源拆成了多条，客户端只留最后一条 ⇒ 少算且零报错。
                    console.warn('[BattleStartModel] 同一增量属性重复下发，仅保留后值',
                        heroId, attrId, previous.value, value);
                }
                entry.modifiers.set(attrId, { statId: modifier.statId, operation: modifier.operation, value });
            }
            heroes.set(heroId, entry);
        }
    }
    const parsed = Array.from(heroes, ([heroId, entry]) => ({
        heroId,
        attributes: entry.attributes,
        ...(entry.modifiers.size ? { modifiers: Array.from(entry.modifiers.values()) } : {}),
    }));
    //  绝对值与增量同时下发时，`applyZCTypedUnitModifiers` 的口径是：
    //  `addRate` 在定值之后叠乘（关卡减益），`add` 仍被定值压制。只有 `add` 会丢，
    //  所以只对 `add` 留痕；按**单元**汇总成一条，避免逐英雄打把日志刷满。
    const overlapped: string[] = [];
    for (const hero of parsed) {
        for (const modifier of hero.modifiers ?? []) {
            if (modifier.operation === 'add' && hero.attributes[modifier.statId] !== undefined) {
                overlapped.push(`${hero.heroId}:${modifier.statId}.add`);
            }
        }
    }
    if (overlapped.length) {
        console.warn('[BattleStartModel] 绝对值与绝对增量同时下发，add 将被绝对值覆盖',
            overlapped.length, overlapped.join(','));
    }
    return parsed;
}

/**
 * 响应 → ZCBattleStart；不可用返回 null。
 * 三条：code!==1、battleId 空、无一条合法单元。
 */
export function normalizeBattleStart(rsp: CmdStartBattleRspMsg | null | undefined): ZCBattleStart | null {
    if (!rsp) return null;
    const code = toCount(rsp.code);
    if (code !== 1) {
        console.warn('[BattleStartModel] 开始战斗失败，code =', code);
        return null;
    }
    const battleId = typeof rsp.battleId === 'string' ? rsp.battleId : '';
    if (!battleId) {
        console.warn('[BattleStartModel] 缺少 battleId，已丢弃', rsp);
        return null;
    }
    const units = normalizeBattleUnits(rsp.unitInfos);
    if (units.length === 0) {
        console.warn('[BattleStartModel] 没有可用战斗单元，已丢弃', rsp);
        return null;
    }
    const mapInfo = rsp.mapInfo;
    const isUint32 = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
    if (mapInfo && (typeof mapInfo.id !== 'string' || !mapInfo.id.trim()
        || typeof mapInfo.name !== 'string' || !isUint32(mapInfo.version)
        || (mapInfo.resourcePoints != null && !Array.isArray(mapInfo.resourcePoints))
        || (mapInfo.unitHomeIndexes != null && !Array.isArray(mapInfo.unitHomeIndexes))
        || (mapInfo.resourcePoints ?? []).some(point => !point || !isUint32(point.row)
            || !isUint32(point.column) || !isUint32(point.groupId) || !isUint32(point.resourceId))
        || (mapInfo.unitHomeIndexes ?? []).some(home => !home || !isUint32(home.unitId)
            || home.unitId === 0 || !isUint32(home.homeIndex)))) {
        console.warn('[BattleStartModel] 本局地图快照无效，已丢弃', mapInfo);
        return null;
    }
    return {
        battleId,
        seed: toIdString(rsp.seed),
        version: typeof rsp.version === 'string' ? rsp.version : '',
        units,
        ...(mapInfo ? { mapInfo: {
            id: mapInfo.id, name: mapInfo.name, version: mapInfo.version,
            resourcePoints: (mapInfo.resourcePoints ?? []).map(point => ({ ...point })),
            unitHomeIndexes: (mapInfo.unitHomeIndexes ?? []).map(home => ({ ...home })),
        } } : {}),
    };
}

/** 逐条校验、按 campId 去重（后覆盖前）、再升序。 */
export function normalizeBattleUnits(infos: CmdBattleUnitInfo[] | null | undefined): readonly ZCBattleUnit[] {
    const result = new Map<number, ZCBattleUnit>();
    for (const info of infos ?? []) {
        const unit = normalizeBattleUnit(info);
        if (!unit) continue;
        result.set(unit.campId, unit);
    }
    // 用 Array.from：构建期 concat 不展开 Map 迭代器。
    return Array.from(result.values()).sort((a, b) => a.campId - b.campId);
}

/** 上阵英雄 id：过滤非法、去重、保序。 */
export function normalizeHeroIds(heroInfos: CmdPvpHeroInfo[] | null | undefined): number[] {
    return normalizeBattleHeroes(heroInfos).map((hero) => hero.heroId);
}

/** 上阵英雄构筑：同 heroId 去重并保留最高有效等级。 */
export function normalizeBattleHeroes(heroInfos: CmdPvpHeroInfo[] | null | undefined): ZCBattleHero[] {
    const levels = new Map<number, number>();
    for (const info of heroInfos ?? []) {
        if (!info) continue;
        const heroId = toPositiveInt(info.heroId);
        if (heroId === null) continue;
        const level = toPositiveInt(info.level) ?? 1;
        levels.set(heroId, Math.max(levels.get(heroId) ?? 1, level));
    }
    return Array.from(levels, ([heroId, level]) => ({ heroId, level }));
}

/**
 * 分我方/敌方。优先用本机 roleId 命中（最可靠）；
 * 命中不了退回 campId 升序前两条并告警。
 */
export function splitBattleUnits(units: readonly ZCBattleUnit[], selfRoleId?: string): ZCBattleTeams {
    const self = selfRoleId ? units.find((unit) => unit.roleId === selfRoleId) : undefined;
    if (self) {
        return { mine: self, enemy: units.find((unit) => unit.campId !== self.campId) ?? null };
    }
    if (units.length > 1 && selfRoleId) {
        console.warn(
            '[BattleStartModel] 本机 roleId 未命中，退回 campId 升序区分敌我', selfRoleId, units,
        );
    }
    return { mine: units[0] ?? null, enemy: units[1] ?? null };
}

export interface GradeRow {
    gradeId?: unknown;
    gradeName?: unknown;
}

export interface ArtifactRow {
    artifactId?: unknown;
    name?: unknown;
    /**
     * pvpArtifact[].icon 是图标资源名，不是路径；图统一在 image/artifact/<icon>。
     */
    icon?: unknown;
}

export interface MatchCardRow {
    id?: unknown;
    traits?: { camp?: unknown; attack?: unknown } | null;
}

export type { HeadArtResolver, HeadRow, IconRow } from '../HeadArtModel';

/** 服务端 id → 界面显示值解析器；查不到返回空串，调用方保留原值。 */
export interface MatchProfileLookup {
    heroStats(heroIds: readonly number[]): MatchStat[];
    gradeName(gradeId: number): string;
    artifactName(artifactId: number): string;
    /** 神器图标资源名（`pvpArtifact[].icon`）；查不到返回空串，调用方保留 prefab 原帧。 */
    artifactIcon(artifactId: number): string;
    /**
     * 表里所有非空神器图标名（去重）。
     *
     * 给「按 id 预热」不成立的场合兜底：本局神器 id 要等「开始游戏」回包才拿得到，
     * 那时界面已经开了 ⇒ 预热时按 id 查必然落空。表只有十几行，全表预热代价可忽略。
     * 与 `artifactIcon()` 同一份 `artifactRows`，口径不会漂移。
     */
    allArtifactIcons(): string[];
    headArt: HeadArtResolver;
}

/** 用表行建展示解析器；id 经 toCount 收敛，坏行跳过。 */
export function buildMatchProfileLookup(
    gradeRows: readonly GradeRow[] | null | undefined,
    artifactRows: readonly ArtifactRow[] | null | undefined,
    headRows?: readonly HeadRow[] | null,
    iconRows?: readonly IconRow[] | null,
    cardRows?: readonly MatchCardRow[] | null,
): MatchProfileLookup {
    const grades = new Map<number, string>();
    for (const row of gradeRows ?? []) {
        if (!row) continue;
        const id = toCount(row.gradeId);
        const name = typeof row.gradeName === 'string' ? row.gradeName : '';
        if (id <= 0 || !name) continue;
        grades.set(id, name);
    }
    const artifacts = new Map<number, string>();
    const artifactIcons = new Map<number, string>();
    for (const row of artifactRows ?? []) {
        if (!row) continue;
        const id = toCount(row.artifactId);
        const name = typeof row.name === 'string' ? row.name : '';
        //图标与名字**分开存**：名字缺失不该连带把图标也丢掉（表里两列各自可能留空）。
        const icon = typeof row.icon === 'string' ? row.icon : '';
        if (id <= 0) continue;
        if (name) artifacts.set(id, name);
        if (icon) artifactIcons.set(id, icon);
    }
    const cards = new Map<number, { camp: string; attack: string }>();
    for (const row of cardRows ?? []) {
        if (!row) continue;
        const id = toCount(row.id);
        if (id <= 0) continue;
        cards.set(id, {
            camp: typeof row.traits?.camp === 'string' ? row.traits.camp : '',
            attack: typeof row.traits?.attack === 'string' ? row.traits.attack : '',
        });
    }
    return {
        heroStats: heroIds => cards.size === 0 ? [] : MATCH_STAT_TYPES.map(stat => ({
            icon: stat.icon,
            value: heroIds.filter(id => cards.get(id)?.[stat.trait] === stat.value).length,
        })),
        gradeName: (gradeId: number): string => grades.get(toCount(gradeId)) ?? '',
        artifactName: (artifactId: number): string => artifacts.get(toCount(artifactId)) ?? '',
        artifactIcon: (artifactId: number): string => artifactIcons.get(toCount(artifactId)) ?? '',
        // 用 Array.from 而不是展开 Set：构建期 Babel 的 loose 模式会把它降级成 concat，
        // Set 迭代器展开后为空，预热列表会恒空。
        allArtifactIcons: (): string[] => Array.from(new Set(artifactIcons.values())),
        headArt: createHeadArtResolver(headRows, iconRows),
    };
}

/**
 * 把服务端单元叠加到玩家数据：只覆盖服务端给了的字段。
 * name 非空、power/gradeScore > 0 才覆盖；rank/artifact 查表，神器 id 为 0 时清空；
 * 头像连根目录一起换（applyHeadArt 成对）。
 */
export function applyUnitToPlayerView(
    base: MatchPlayerData,
    unit: ZCBattleUnit | null,
    lookup?: MatchProfileLookup | null,
): MatchPlayerData {
    if (!unit) return base;
    const next: MatchPlayerData = { ...base };
    if (lookup) next.stats = lookup.heroStats(unit.heroIds);
    if (unit.artifactId === 0) {
        next.artifactName = '';
        next.artifactIcon = '';
    }
    if (unit.name) next.name = unit.name;
    if (unit.power > 0) next.power = unit.power;
    if (unit.gradeScore > 0) next.trophy = unit.gradeScore;
    const rank = lookup ? lookup.gradeName(unit.gradeId) : '';
    if (rank) next.rank = rank;
    const artifact = lookup ? lookup.artifactName(unit.artifactId) : '';
    if (artifact) next.artifactName = artifact;
    const artifactIcon = lookup ? lookup.artifactIcon(unit.artifactId) : '';
    if (artifactIcon) next.artifactIcon = artifactIcon;
    applyHeadArt(next, unit.avatarId, lookup?.headArt);
    return next;
}
