import { toCount, toIdString, toPositiveInt } from '../net/RequestGuard';
import type { MatchPlayerData } from '../matching/MatchTypes';
import { applyHeadArt, createHeadArtResolver } from '../HeadArtModel';
import type { HeadArtResolver, HeadRow, IconRow } from '../HeadArtModel';

/**
 * 「开始游戏」数据模型与边界校验 —— 纯函数，零引擎依赖，可单测。
 */

/** PVP 匹配局 battleType（不能用 1，那撞老枚举 CHAPTER）。 */
export const ZC_BATTLE_TYPE_PVP = 1001;

export const ZC_BATTLE_TYPE_SLG_MONSTER = 1003;
export const ZC_BATTLE_TYPE_SLG_CAMP = 1004;
export type IZCSlgBattleType = typeof ZC_BATTLE_TYPE_SLG_MONSTER | typeof ZC_BATTLE_TYPE_SLG_CAMP;

/**
 * 章节战斗（领地关卡 / Boss 关）的 battleType。
 *
 * ## ⚠️ 是**固定值**，不是每关的 `configId`
 *
 * `battleType` 表达的是「**打哪一类战斗**」，关卡身份由 `battleParams` 里的
 * `格子id` 定位（见 {@link chapterCellBattleParams}）⇒ 同一章的所有关卡（含 Boss）都用这一个类型。
 * 早期实现误把 `site.configId`（每关不同，如 `10001`）当 battleType 发出去，
 * 症状是「点Boss 关没反应 / 服务端按未知类型处理」。
 *
 * 与 `ZC_BATTLE_TYPE_PVP` 同一套 `1000 + n` 的私有编号段（避开老枚举的 1~若干）。
 */
export const ZC_BATTLE_TYPE_CHAPTER = 1002;

/**
 * 章节战斗（1002）**内嵌的子类型**，固定占 `battleParams[0]`
 *（山猫 2026-10-15 定：「1002 的战斗里面要嵌个子类型」）。
 *
 * | 子类型 | 常量 | `battleParams` |
 * |---|---|---|
 * | 1 | `ZC_CHAPTER_BATTLE_SUB_CELL`（格子战斗） | `[1, 章节id, 格子id]` |
 * | 2 | `ZC_CHAPTER_BATTLE_SUB_TREASURE`（宝箱战斗） | `[2, 章节id, 格子id]` —— 与格子战斗**同结构**，暂未接线 |
 *
 * ⚠️ 别与 `battleType` 混为一谈：`battleType` 说「打哪一大类」，
 * 子类型说「**同一大类里的哪一种**」，关卡身份仍然只由后面的 `格子id` 决定
 * —— 两者都变了要连服务端一起确认，改错一个数字服务端按未知类型处理，**零报错**。
 */
export const ZC_CHAPTER_BATTLE_SUB_CELL = 1;

/** 宝箱战斗的子类型（1002 / `battleParams[0] = 2`）。 */
export const ZC_CHAPTER_BATTLE_SUB_TREASURE = 2;

/**
 * 格子战斗（1002 / 子类型 1）的 `battleParams`：`[子类型, 章节id, 格子id]`。
 *
 * ⚠️ 三个值**全转字符串**：proto 里 `battleParams` 是 `repeated string`，
 * 直接塞数字 protobuf 的 `writers.string` 写不出来 ⇒ 整条**空发出去**，服务端说参数缺失且不报错。
 */
export function chapterCellBattleParams(chapterId: number, cellId: number): string[] {
    return [String(ZC_CHAPTER_BATTLE_SUB_CELL), String(chapterId), String(cellId)];
}

/**
 * 宝箱战斗（1002 / 子类型 2）的 `battleParams`：`[子类型, 章节id, 格子id]`。
 *
 * 与格子战斗**同结构**（山猫 2026-10-15 拍板「对称」），只有下标 0 的子类型不同
 * ⇒ 两种战斗共用一条参数布局，服务端按 `battleParams[0]` 分流，别各写一套顺序。
 *
 * ⚠️ 当前**没有任何调用点**（领地还没接宝箱战斗流程）—— 先用单测把形状钉住，
 * 真接线时补一处调用即可。别因为「现在零引用」就删（规则 170 指的是**已废弃**的实现，
 * 这条是服务端约定的口径，属于等着被调用的接口，删了等于把约定从代码里抹掉）。
 */
export function chapterTreasureBattleParams(chapterId: number, cellId: number): string[] {
    return [String(ZC_CHAPTER_BATTLE_SUB_TREASURE), String(chapterId), String(cellId)];
}

/**
 * 战斗单元的来源类型 —— 对应 `CmdBattleUnitInfo.unitType`（服务端 2026-10-26 新增）。
 *
 * | 值 | 含义 |
 * |---|---|
 * | 1 | 玩家 |
 * | 2 | 机器人 |
 * | 3 | 怪物 |
 *
 * ⚠️ 协议里是 `optional`：老服务端**不下发**这个字段（读到 `undefined`），
 * 与「给了 0 / 负数 / 未知值」一样都归为「不知道」，**绝不回退成 Player**
 * —— 把机器人当成玩家会让战绩、结算、头像口径一起错，而且全程零报错。
 */
export const ZC_BATTLE_UNIT_TYPE = {
    /** 真实玩家（有角色档）。 */
    Player: 1,
    /** 服务端补位的机器人（有 showInfo，但不是真角色）。 */
    Robot: 2,
    /** 关卡 / SLG 怪物（PVP 对局里不该出现）。 */
    Monster: 3,
} as const;

export type ZCBattleUnitType = (typeof ZC_BATTLE_UNIT_TYPE)[keyof typeof ZC_BATTLE_UNIT_TYPE];

/** 服务端下发的单个战斗单元（一方）。 */
export interface ZCBattleHero {
    readonly heroId: number;
    readonly level: number;
}

/**
 * `CmdPvpBuffInfo.buffs` 里的一对 `key,value`（已校验）。
 *
 * 协议是 `repeated string`，注释写的是 `[id,value,id,value]`，但**实际下发的 `id` 是字符串属性名**
 * （2026-10-29 实测：`["levelAttackRatio","0.8","levelHpRatio","0.8"]`，与 `levelInfo` 表的
 * `levelAttack` / `levelHp` 对应）—— 不是数字编号。按数字解析会把**所有合法数据丢光**，
 * 而且全程零报错（`toPositiveInt('levelAttackRatio')` 返回 null）。
 */
export interface ZCBattleBuffEntry {
    /** 属性 key（如 `levelAttackRatio` / `levelHpRatio`），**字符串**，原样保留。 */
    readonly key: string;
    /**
     * 原始值字符串（如 `"0.8"`）。
     *
     * 协议只承诺是 `string`，没承诺一定是数字（将来可能有文本属性）。
     * 原文一律保留，数值另见 {@link numeric}。
     */
    readonly value: string;
    /**
     * `value` 解析出的**有限数值**；解析不出来是 `null`。
     *
     * 单独给一个字段而不是让消费方自己 `Number()`：`Number('')` 是 0、`Number('x')` 是 NaN，
     * 两者都会被静默当成"合法的 0 加成"，比显式 null 难查一个数量级。
     */
    readonly numeric: number | null;
}

/**
 * 一种来源的 buff 集合（`CmdPvpBuffInfo`）。
 *
 * ⚠️ `source` 的取值含义协议里只有一句「来源」，客户端没有枚举表。
 * 实测（2026-10-29）只见过 `source = 1`，内容就是服务端算好的关卡倍率
 * （`levelAttackRatio` / `levelHpRatio`）。**别按 source 分支**，见 {@link ZCBattleUnit.buffs}。
 */
export interface ZCBattleBuff {
    /** 来源（`CmdPvpBuffInfo.source`，`uint32`）。 */
    readonly source: number;
    /** 该来源下的 buff，保持服务端下发顺序，**不去重不合并**（叠加语义归消费方）。 */
    readonly entries: readonly ZCBattleBuffEntry[];
}

export interface ZCBattleUnit {
    readonly campId: number;
    /**
     * 服务端战斗单元 id（`CmdBattleUnitInfo.unitId = 6`）。
     *
     * ⚠️ 与 `campId` **不是一回事**：`campId` 是阵营席位（1~4，前端只拿它映射 `ZCOwner`），
     * `unitId` 是服务端给每个参战单元分配的身份 —— 战斗统计
     * （`CmdBattleStatisticsInfo.unitId`）靠它把数据归属到具体单元。
     * 缺字段 / 非法值收敛成 0（本地局没有服务端 id），**不代表"第 0 号单元"**。
     */
    readonly unitId: number;
    readonly roleId: string;
    readonly serverId: number;
    readonly name: string;
    readonly power: number;
    /** 头像 id（不是资源名）。 */
    readonly avatarId: string;
    readonly headFrameId: string;
    readonly gradeId: number;
    readonly gradeScore: number;
    readonly heroIds: readonly number[];
    /** 保留 CmdPvpHeroInfo.level，供卡牌技能解锁/升级在开局前编译。 */
    readonly heroes?: readonly ZCBattleHero[];
    readonly artifactId: number;
    readonly artifactLevel: number;
    /**
     * 单元来源类型（玩家 / 机器人 / 怪物）。
     *
     * 服务端未下发或给了未知值时是 `undefined` —— **不等于玩家**，
     * 任何按它分流的地方都必须先判空再决定兜底口径。
     */
    readonly unitType?: ZCBattleUnitType;
    /**
     * PVP buff 列表（`CmdBattleUnitInfo.buffInfo = 8`，服务端 2026-10-29 / r936 新增）。
     *
     * **恒为数组**：老服务端不下发 ⇒ `[]`，调用方不用判 `undefined`。
     * 结构是「来源 → 若干 `key,value`」，其中 key 是**属性名**（`levelAttackRatio` 等），
     * 不是数字编号 —— 详见 {@link ZCBattleBuffEntry}。
     *
     * 消费方是 `buildZCClientCombatConfig`（按 `campId` 折成 owner 级关卡倍率，
     * 再经 `compileZCMatchRuntime` 乘进该方所有单位的攻/血）。
     * 同一 `key` 出现多次时**按倍率累乘**，不按来源去重。
     */
    readonly buffs: readonly ZCBattleBuff[];
}

/** 一次开始游戏结果。 */
export interface ZCBattleStart {
    readonly battleId: string;
    /** 随机种子，必须保持字符串（uint64 超 2^53，转 number 会让相邻种子相同）。 */
    readonly seed: string;
    readonly version: string;
    readonly units: readonly ZCBattleUnit[];
}

export interface ZCBattleTeams {
    readonly mine: ZCBattleUnit | null;
    readonly enemy: ZCBattleUnit | null;
}

/**
 * `unitType` 归一化：只认 1 / 2 / 3，其余（缺省、0、负数、小数、字符串垃圾）一律 `undefined`。
 *
 * 收成联合类型而不是裸 `number`，一是让调用方的 `switch` 能做穷尽检查，
 * 二是防止有人把魔法数字写进分支（写错一个数字没有任何报错）。
 */
export function normalizeBattleUnitType(value: unknown): ZCBattleUnitType | undefined {
    const num = toCount(value);
    if (num === ZC_BATTLE_UNIT_TYPE.Player) return ZC_BATTLE_UNIT_TYPE.Player;
    if (num === ZC_BATTLE_UNIT_TYPE.Robot) return ZC_BATTLE_UNIT_TYPE.Robot;
    if (num === ZC_BATTLE_UNIT_TYPE.Monster) return ZC_BATTLE_UNIT_TYPE.Monster;
    return undefined;
}

/**
 * `[key,value,key,value,...]` 扁平字符串 → 成对结构。
 *
 * 三条边界，全部「丢数据 + 出声」，不猜：
 *   ① **奇数长度**：末位没有配对的 value，丢弃并告警（补齐一个假 value 等于替服务端编数据）；
 *   ② **key 为空 / 非字符串**：**整对**丢弃 —— 只有 value 没有 key 是无主数据；
 *   ③ **同 key 重复**：**保留多条**，不合并、不覆盖 —— 合并语义（覆盖？累乘？）属于消费方，
 *      在这里替它决定会把「叠加」和「服务端 bug」一起吞掉。
 *
 * ⚠️ **不要把 key 当数字解析**：实际下发的是 `levelAttackRatio` 这种属性名。
 * 2026-10-29 之前这里按正整数解析，会把整条 buff 丢光且零报错。
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
 * `CmdBattleUnitInfo.buffInfo` → {@link ZCBattleBuff} 数组。
 *
 * 一个单元可能有多种来源（每个元素一个 `source`），**按数组原序保留**，不合并同 `source` 的条目。
 * 缺字段 / 非数组 / 元素为 null ⇒ 返回 `[]`（老服务端不下发，不是错误）。
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
 * 从 buff 列表里取某个 key 的**倍率值**；一处都没有 / 全是非数值 ⇒ `null`。
 *
 * - 同 key 出现多次按**累乘**（倍率天生可叠，且不区分 `source`）；
 * - 一个都没有时返回 `null` 而不是 `1` —— 调用方据此区分「服务端没下发」与「下发了 1」，
 *   后者是"明确要求 ×1"，前者是"这局没有这条规则"。
 */
export function battleBuffRatio(buffs: readonly ZCBattleBuff[] | null | undefined, key: string): number | null {
    const target = typeof key === 'string' ? key.trim() : '';
    if (!target) return null;
    let result: number | null = null;
    for (const group of Array.isArray(buffs) ? buffs : []) {
        for (const entry of group?.entries ?? []) {
            if (!entry || entry.key !== target || entry.numeric === null) continue;
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
    return {
        campId,
        unitId: toCount(info.unitId),
        roleId: toIdString(show.roleId),
        serverId: toCount(show.serverId),
        name: typeof show.name === 'string' ? show.name : '',
        power: toCount(show.power),
        avatarId: toIdString(show.img),
        headFrameId: toIdString(show.headFrame),
        gradeId: toCount(show.gradeId),
        gradeScore: toCount(show.gradeScore),
        heroIds: heroes.map((hero) => hero.heroId),
        heroes,
        artifactId: toCount(info.artifactId),
        artifactLevel: toCount(info.artifactLevel),
        unitType: normalizeBattleUnitType(info.unitType),
        buffs: parseBattleBuffs(info.buffInfo),
    };
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
    return {
        battleId,
        seed: toIdString(rsp.seed),
        version: typeof rsp.version === 'string' ? rsp.version : '',
        units,
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
    const self = selfRoleId ? units.find((unit) => unit.roleId !== '' && unit.roleId === selfRoleId) : undefined;
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
     * `pvpArtifact[].icon` —— 图标**资源名**（如 `霜封冰刃`），不是路径。
     *
     * 图在 `image/artifact/<icon>`（**与对局里的神器格同一张图**，山猫 2026-10-08 定），
     * 不在匹配界面自己的 `image/matching/` 根下。
     */
    icon?: unknown;
}

export type { HeadArtResolver, HeadRow, IconRow } from '../HeadArtModel';

/** 服务端 id → 界面显示值解析器；查不到返回空串，调用方保留原值。 */
export interface MatchProfileLookup {
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

/** 用四张表行建解析器 —— 纯函数。id 经 toCount 收敛，坏行跳过。 */
export function buildMatchProfileLookup(
    gradeRows: readonly GradeRow[] | null | undefined,
    artifactRows: readonly ArtifactRow[] | null | undefined,
    headRows?: readonly HeadRow[] | null,
    iconRows?: readonly IconRow[] | null,
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
    return {
        gradeName: (gradeId: number): string => grades.get(toCount(gradeId)) ?? '',
        artifactName: (artifactId: number): string => artifacts.get(toCount(artifactId)) ?? '',
        artifactIcon: (artifactId: number): string => artifactIcons.get(toCount(artifactId)) ?? '',
        // ⚠️ 用 `Array.from` 而不是 `[...set]`：构建期 Babel 的 loose 模式会把展开降级成
        // `[].concat(iterator)`，Set 迭代器被 concat 展开成空数组 ⇒ 预热列表恒空
        // （`tests/battle-start-protocol.test.ts` 有专门一条用例钉这个口径）。
        allArtifactIcons: (): string[] => Array.from(new Set(artifactIcons.values())),
        headArt: createHeadArtResolver(headRows, iconRows),
    };
}

/**
 * 把服务端单元叠加到玩家数据：只覆盖服务端给了的字段。
 * name 非空、power/gradeScore > 0 才覆盖；rank/artifact 查表；
 * 头像连根目录一起换（applyHeadArt 成对）。
 */
export function applyUnitToPlayerView(
    base: MatchPlayerData,
    unit: ZCBattleUnit | null,
    lookup?: MatchProfileLookup | null,
): MatchPlayerData {
    if (!unit) return base;
    const next: MatchPlayerData = { ...base };
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
