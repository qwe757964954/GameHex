import {
    isZCCardType,
    ZC_CARD_TYPE_NAMES,
    ZCCardType,
    ZCSkillTrigger,
} from './ZCCombatCatalog';
import type {
    ZCBondEffectType, ZCBondRule, ZCCardRarity, ZCCardTraits,
    ZCCounterRule, ZCDeckCard, ZCAttackProfile, ZCUnitDefinition, ZCUnitId,
} from './ZCCombatCatalog';
import {
    ZC_PVP_TILE_TYPES,
} from './ZCPvpTileRules';
import type { ZCPvpTileConfig, ZCPvpTileType, ZCPvpTileTypeWeight } from './ZCPvpTileRules';



export function object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(field + ' 必须是对象');
    }
    return value as Record<string, unknown>;
}

export function array(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(field + ' 必须是数组');
    return value;
}

export function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(field + ' 必须是非空字符串');
    }
    return value;
}

function optionalText(value: unknown, field: string): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new Error(field + ' 必须是字符串');
    return value;
}

export function number(value: unknown, field: string, min = 0, allowZero = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < min : value <= min)) {
        throw new Error(field + ' 必须是' + (allowZero ? '不小于' : '大于') + ' ' + min + ' 的数字');
    }
    return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(field + ' 必须是数字');
    return value;
}

function assetPath(value: unknown, field: string): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new Error(field + ' 必须是资源路径字符串');
    return value;
}

function optionalTrigger(value: unknown, field: string): ZCSkillTrigger | undefined {
    const raw = optionalText(value, field);
    if (raw === undefined) return undefined;
    if (raw !== ZCSkillTrigger.everyNAttacks && raw !== ZCSkillTrigger.everySeconds) {
        throw new Error(field + ' 只能是 ' + ZCSkillTrigger.everyNAttacks + ' / ' + ZCSkillTrigger.everySeconds + '，收到 ' + JSON.stringify(raw));
    }
    return raw as ZCSkillTrigger;
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
    if (value === null || value === undefined || value === 0) return undefined;
    return number(value, field);
}

/**
 * 兵种美术的等比缩放系数（`pvpCard.prefabSize`）：留空 = **1**（不缩放）。
 *
 * 为什么不用 `optionalPositiveNumber`：那个把 `0` 当「未配置」，而缩放系数取 0 的后果是
 * **单位在战场上凭空消失**（scale 全 0 ⇒ 什么都画不出来，且不报错）。
 * 这里显式区分两件事 —— 空 ⇒ 1（策划没配，用默认）；填了非正数 ⇒ 抛错（配错了，当场炸）。
 *
 * 值域不设上限：将来真要出「巨人」卡（2~3 倍）时不必再改解析层。
 */
function parsePrefabSize(value: unknown, field: string): number {
    if (value === null || value === undefined || value === '') return 1;
    return number(value, field);
}

export function globalNumber(global: Record<string, unknown>, field: string, min = 0, allowZero = false): number {
    return number(global[field], 'global.' + field, min, allowZero);
}

export function globalNumberOr(global: Record<string, unknown>, field: string, fallback: number, min = 0, allowZero = false): number {
    return global[field] === undefined ? fallback : globalNumber(global, field, min, allowZero);
}

function parseTraits(value: unknown): ZCCardTraits | undefined {
    if (value === null || value === undefined) return undefined;
    const raw = object(value, 'cards[].traits');
    return {
        attack: text(raw.attack, 'cards[].traits.attack') as ZCCardTraits['attack'],
        camp: text(raw.camp, 'cards[].traits.camp') as ZCCardTraits['camp'],
    };
}

function parseCardRarity(value: unknown): ZCCardRarity {
    const rarities: ZCCardRarity[] = ['绿', '蓝', '紫', '金'];
    if (typeof value === 'number' && Number.isInteger(value)) {
        const rarity = rarities[value - 1];
        if (rarity) return rarity;
    }
    if (typeof value === 'string') {
        const rarity = value.trim() as ZCCardRarity;
        if (rarities.includes(rarity)) return rarity;
    }
    throw new Error('cards[].rarity 必须是 1=绿、2=蓝、3=紫、4=金');
}

/** 数字形式的 type（配表里部读到数字或字符串都要过这关）——从枚举派生，加类型不用同步。 */
const CARD_TYPE_DIGITS = new RegExp('^[' + Object.values(ZCCardType).join('') + ']$');
const CARD_TYPE_RANGE_HINT = Object.values(ZCCardType)
    .map((type) => `${type}=${ZC_CARD_TYPE_NAMES[type]}`)
    .join(' ');

function parseCardType(value: unknown, cardName: string): ZCCardType {
    if (isZCCardType(value)) return value;
    if (typeof value === 'string' && CARD_TYPE_DIGITS.test(value.trim())) return Number(value) as ZCCardType;
    throw new Error('卡【' + cardName + '】的 type 必须是 ' + CARD_TYPE_RANGE_HINT + '，当前是 ' + JSON.stringify(value));
}

function parseCardCycleSeconds(raw: Record<string, unknown>, type: ZCCardType): number {
    if (raw.cycleSeconds !== null && raw.cycleSeconds !== undefined) {
        return number(raw.cycleSeconds, 'cards[].cycleSeconds');
    }
    const fields: Partial<Record<ZCCardType, string>> = {
        [ZCCardType.Mine]: 'goldDigTime',
        [ZCCardType.Barracks]: 'soilderAddTime',
        [ZCCardType.Tower]: 'buildAttackTime',
        [ZCCardType.Wall]: 'buildAttackTime',
        [ZCCardType.Hq]: 'goldDigTime',
    };
    const preferredField = fields[type];
    if (preferredField) {
        const v = raw[preferredField];
        if (typeof v === 'number' && v > 0) return number(v, 'cards[].' + preferredField);
    }
    for (const fallbackField of Object.values(fields)) {
        const v = raw[fallbackField];
        if (typeof v === 'number' && v > 0) return number(v, 'cards[].' + fallbackField);
    }
    throw new Error('cards[].cycleSeconds 缺失且无 fallback 列可用');
}

function parseCardTypeList(value: unknown, field: string): ZCCardType[] {
    if (value === null || value === undefined || value === '') return [];
    return array(value, field).map((entry) => {
        if (isZCCardType(entry)) return entry;
        if (typeof entry === 'string' && CARD_TYPE_DIGITS.test(entry.trim())) return Number(entry) as ZCCardType;
        throw new Error(field + ' 只能是 ' + CARD_TYPE_RANGE_HINT + '，当前是 ' + JSON.stringify(entry));
    });
}

/**
 * 主城是**场地固有建筑**，不是能打出去的卡。
 *
 * 它必须留在 `PVP-卡牌` 里 —— 转表器只导出首列 `deck` 非空的行，所以现表把它挂在
 * `玩家默认` slot=0（不与任何「卡组」概念冲突，只是让它能被导出来）。
 * 但**所有卡组消费方都必须把它摘掉**：漏掉任何一处，「玩家默认」就会被数成 9 张 ——
 * `loadPvpTables` 的 `!== 8` 校验会让**整局进不去**，卡牌阵容页则会多出一个站台。
 *
 * 两处消费方（`loadPvpTables` 与卡牌阵容页 `CardLineupDecks.parseDecks`）都走这里，
 * 别再各写一份 `type !== ZCCardType.Hq` —— 那正是会悄悄漂移的地方。
 */
export function isHqCard(card: { type: ZCCardType }): boolean {
    return card.type === ZCCardType.Hq;
}

/** 解析一行 pvpCard；配置编译与卡牌阵容页共用。 */
export function parseCard(value: unknown): ZCDeckCard & { enabled: boolean } {
    const raw = object(value, 'cards[]');
    const unitId = raw.unitId === null || raw.unitId === undefined ? undefined : text(String(raw.unitId), 'cards[].unitId');
    const name = text(raw.name, 'cards[].name');
    const type = parseCardType(raw.type, name);
    return {
        enabled: raw.enabled === true,
        id: text(String(raw.id), 'cards[].id'),
        name,
        type,
        rarity: parseCardRarity(raw.rarity),
        unitId,
        unitPrefabPath: assetPath(raw.unitPrefabPath, 'cards[].unitPrefabPath'),
        traits: parseTraits(raw.traits),
        buildSeconds: optionalNumber(raw.buildSeconds, 'cards[].buildSeconds'),
        cycleSeconds: parseCardCycleSeconds(raw, type),
        // 建筑耐久：基础值必填 —— 它是建筑血量的**唯一来源**（表缺这列会在这里立刻炸，
        // 而不是变成一碰就碎的 0 血建筑）。品级系数与产金数量缺省 0。
        baseHp: number(raw.baseHp, 'cards[].baseHp'),
        cyclePerTierValue: optionalNumber(raw.cyclePerTierValue, 'cards[].cyclePerTierValue'),
        buildDigGoldNum: optionalNumber(raw.buildDigGoldNum, 'cards[].buildDigGoldNum'),
        cycleBaseValue: optionalNumber(raw.cycleBaseValue, 'cards[].cycleBaseValue'),
        // 头像：值是 icon.json 的图标名（不是资源名），留空合法（该卡暂无头像）。
        // 不在这里校验它是否真能在 icon.json 里解出来 —— 表与图的同步由
        // `tests/card-head-icon.test.ts` 那条「读真表 + 查真目录」的用例钉死。
        headIcon: optionalText(raw.headIcon, 'cards[].headIcon'),
        // 建筑外观图名（image/buildings 下图片名），留空合法，视图按建筑类型回退。
        buildIcon: optionalText(raw.buildIcon, 'cards[].buildIcon'),
    };
}

/**
 * 解析 `pvpCard` 中任意一张可收藏卡牌。
 *
 * 卡池行没有 `deck`，不能直接走只服务于出战卡组的 `parseCard()`；这里补一个仅用于
 * 校验的内部组名，复用完全相同的字段解析口径，返回值不会把该组名暴露给消费方。
 */
export function parseCardCatalogRow(value: unknown): ZCDeckCard & { enabled: boolean } {
    const normalized = normalizeCardRow(value);
    const parsed = parseCard({
        ...normalized,
        // deck 列已删除（2026-09-28），卡组归属由后端 unitInfos 下发。
        // 卡池行目前留空；对兵营卡语义就是「每品级不追加建筑耐久」。
        cyclePerTierValue: normalized.cyclePerTierValue ?? 0,
    });
    return parsed;
}

export function parseAttackProfiles(value: unknown): ReadonlyMap<number, ZCAttackProfile> {
    const result = new Map<number, ZCAttackProfile>();
    for (const item of array(value, 'skills')) {
        const raw = object(item, 'skills[]');
        const skillId = number(raw.skillId, 'skills[].skillId');
        if (result.has(skillId)) throw new Error(`skills[].skillId 重复：${skillId}`);
        const mode = text(raw.mode, `skills.${skillId}.mode`);
        if (mode !== 'melee' && mode !== 'projectile' && mode !== 'area') {
            throw new Error(`skills.${skillId}.mode 必须是 melee/projectile/area`);
        }
        result.set(skillId, {
            skillId,
            name: text(raw.name, `skills.${skillId}.name`),
            mode,
            effectKey: optionalText(raw.effectKey, `skills.${skillId}.effectKey`),
            projectileKey: optionalText(raw.projectileKey, `skills.${skillId}.projectileKey`),
            projectileSpeed: optionalPositiveNumber(raw.projectileSpeed, `skills.${skillId}.projectileSpeed`),
            collisionRadius: optionalPositiveNumber(raw.collisionRadius, `skills.${skillId}.collisionRadius`),
            areaRadius: optionalPositiveNumber(raw.areaRadius, `skills.${skillId}.areaRadius`),
            empoweredEvery: optionalPositiveNumber(raw.empoweredEvery, `skills.${skillId}.empoweredEvery`),
            empoweredSkillId: optionalPositiveNumber(raw.empoweredSkillId, `skills.${skillId}.empoweredSkillId`),
            // 留空 = 按次数（`empoweredEvery`）；`'every_seconds'` 才走 CD。值域校验在 `optionalTrigger` 里，
            // 写错拼写会**直接抛错**而不是静默回落 —— 触发方式是决定战斗节拍的东西，静默回落最难查。
            trigger: optionalTrigger(raw.trigger, `skills.${skillId}.trigger`),
            cooldown: optionalPositiveNumber(raw.cooldown, `skills.${skillId}.cooldown`),
            // 伤害倍率：留空 = 1（普攻行一律留空，只有武将技行填）。`optionalPositiveNumber`
            // 把 `0` 也当「未配置」—— 倍率 0 没有业务含义，静默当成默认比让它把伤害打没更安全。
            damageRate: optionalPositiveNumber(raw.damageRate, `skills.${skillId}.damageRate`),
            effectPrefabPath: assetPath(raw.effectPrefabPath, `skills.${skillId}.effectPrefabPath`),
            durationSeconds: optionalNumber(raw.durationSeconds, `skills.${skillId}.durationSeconds`),
            waves: optionalPositiveNumber(raw.waves, `skills.${skillId}.waves`),
            slowRatio: optionalNumber(raw.slowRatio, `skills.${skillId}.slowRatio`),
            onHitStatusId: optionalText(raw.onHitStatusId, `skills.${skillId}.onHitStatusId`),
        });
    }
    return result;
}

/**
 * `pvpCard` 一行 → 单位定义，按 `unitId` 建目录。
 *
 *  **2026-09-20 合表**：`PVP-单位.xlsx` 已并入 `PVP-卡牌.xlsx`，单位属性内联在卡行上
 *  （列名统一加 `unit` 前缀：`unitMaxHp` / `unitAttack` / `unitPrefabPath` …）。
 *  两表原本是**严格 1:1**（35 卡 ↔ 35 单位，无一对多），所以内联零冗余；
 *  同时从根本上消灭了旧口径「卡 id 与单位 id 同值」那个跨表约定 ——
 *  它靠两表行序一致来维系，实际却因两表排序规则不同而在 **35 行里错位 29 行**
 *  （卡面写铜须、数值与立绘来自近卫半人马）。没有 join 就没有 join 错。
 *
 * - `unitId` = 「本行产出的兵种」的引用：**兵种卡**填本行卡自己的 id（1:1 期间恒等）。
 *   将来若出现「多张卡共用一个兵种」，把它指向另一卡行的 id 即可 —— 变成同表自引用，
 *   仍然不需要外部表。
 * - 建筑卡（主城/金矿）没有单位列，两项都空 → 跳过。
 *    建筑行的 `unitId` **必须留空**：`parseCard` 不判空、`findUnplayableDeckCards` 以
 *   `unitId == null` 认建筑卡（`if (!card.unitId) continue;`），填上会把建筑当成
 *   「引用了不存在单位的出战卡」，让 `assertDeckUnitsPlayable()` 在预加载期抛错、整局进不去。
 *   它们不需要单位：建筑耐久来自 `baseHp`（`+ 品级 × cyclePerTierValue`），
 *   城墙走 `PVP-全局.wallMaxHp`。
 * - `spawnSeconds` 取 `soilderAddTime` —— 合表后「产兵间隔」只剩这一个来源。
 *   原 `pvpUnit.spawnSeconds` 是与它语义重复的僵尸列（35 行里 34 行数值不同，
 *   且因 `cycleSeconds` 优先取 `soilderAddTime` 而**几乎永不生效**），已随表废弃。
 * - 「碰撞半径」还在调优，允许留空 → 按 0 处理。
 *   注意 `bodyRadius = 0` 会让**攻击距离 ≤ 100** 的近战单位少算对方的碰撞半径
 *   （见 `ZCGameModel.unitAttackReach`），调优完成后策划补上即可。
 *
 * 导出仅为单测直接喂合成行，业务侧一律走 `loadPvpTables`。
 */
export function parseUnits(
    cardRows: unknown,
    skills: ReadonlyMap<number, ZCAttackProfile>,
): Map<ZCUnitId, ZCUnitDefinition> {
    const result = new Map<ZCUnitId, ZCUnitDefinition>();
    for (const item of array(cardRows, 'pvpCard')) {
        const raw = object(item, 'pvpCard[]');
        const label = raw.name == null ? raw.id : raw.name;
        const prefabPath = assetPath(raw.unitPrefabPath, `pvpCard.${label}.unitPrefabPath`);
        const skillId = optionalNumber(raw.unitSkillId, `pvpCard.${label}.unitSkillId`);
        // 建筑卡（主城/金矿）本来就没有单位 —— 这不是脏数据，是它们不出兵。
        if (!prefabPath && skillId === undefined) continue;
        if (!prefabPath) throw new Error(`pvpCard.${label}.unitPrefabPath 缺失（已配 unitSkillId=${skillId}）`);
        if (skillId === undefined) throw new Error(`pvpCard.${label}.unitSkillId 缺失（已配 unitPrefabPath=${prefabPath}）`);
        const unitId = text(String(raw.unitId ?? raw.id), `pvpCard.${label}.unitId`);
        if (result.has(unitId)) throw new Error(`pvpCard[].unitId 重复：${unitId}`);
        const attackProfile = skills.get(skillId);
        if (!attackProfile) throw new Error(`pvpCard.${label}.unitSkillId 未在 PVP 技能表中定义：${skillId}`);
        // 强化那一击的技能行（36000 段）。**缺失就当场抛**：否则「每 N 次普攻打一次技能特效」
        // 会退化成静默播普攻特效 —— 表填了、代码没报错、只是永远看不到技能。
        const empoweredProfile = attackProfile.empoweredSkillId
            ? skills.get(attackProfile.empoweredSkillId)
            : undefined;
        if (attackProfile.empoweredSkillId && !empoweredProfile) {
            throw new Error(
                `pvpCard.${label} 的普攻技能 ${skillId} 配了 empoweredSkillId=${attackProfile.empoweredSkillId}，`
                + '但 PVP 技能表里没有这一行',
            );
        }
        result.set(unitId, {
            unitId,
            name: text(raw.name, `pvpCard.${label}.name`),
            maxHp: number(raw.unitMaxHp, `pvpCard.${label}.unitMaxHp`),
            attack: number(raw.unitAttack, `pvpCard.${label}.unitAttack`),
            moveSpeed: number(raw.unitMoveSpeed, `pvpCard.${label}.unitMoveSpeed`),
            attackRange: number(raw.unitAttackRange, `pvpCard.${label}.unitAttackRange`),
            attackInterval: number(raw.unitAttackInterval, `pvpCard.${label}.unitAttackInterval`),
            attackDuration: number(raw.unitAttackDuration, `pvpCard.${label}.unitAttackDuration`),
            attackHitTime: number(raw.unitAttackHitTime, `pvpCard.${label}.unitAttackHitTime`),
            bodyRadius: optionalNumber(raw.unitBodyRadius, `pvpCard.${label}.unitBodyRadius`) ?? 0,
            spawnSeconds: optionalNumber(raw.soilderAddTime, `pvpCard.${label}.soilderAddTime`) ?? 0,
            flying: refBool(raw.unitFlying) ?? false,
            canAttackAir: refBool(raw.unitCanAttackAir) ?? false,
            hero: refBool(raw.unitHero) ?? false,
            prefabPath,
            // 美术等比缩放：表里留空按 1（不缩放）。**填了 0 或负数直接抛** ——
            // 那会让单位在战场上凭空消失或上下翻转，比报错难查得多。
            prefabSize: parsePrefabSize(raw.prefabSize, `pvpCard.${label}.prefabSize`),
            attackProfile,
            empoweredProfile,
        });
    }
    if (result.size === 0) {
        throw new Error('pvpCard 里没有可上场的单位（需要同时具备「单位预设」与「普攻技能ID」）');
    }
    return result;
}

export function parseTileConfigs(value: unknown): Readonly<Record<ZCPvpTileType, ZCPvpTileConfig>> {
    const result = {} as Record<ZCPvpTileType, ZCPvpTileConfig>;
    for (const item of array(value, 'pvpTiles.configs')) {
        const raw = object(item, 'pvpTiles.configs[]');
        const type = number(raw.id, 'pvpTiles.configs[].id') as ZCPvpTileType;
        if (!ZC_PVP_TILE_TYPES.includes(type)) throw new Error(`未知地块类型：${type}`);
        const weights = object(raw.rarityWeights, `pvpTiles.configs.${type}.rarityWeights`);
        result[type] = {
            type,
            name: text(raw.name, `pvpTiles.configs.${type}.name`),
            price: number(raw.price, `pvpTiles.configs.${type}.price`),
            rarityWeights: {
                空: number(weights.empty, `${type}.empty`, 0, true),
                绿: number(weights.green, `${type}.green`, 0, true),
                蓝: number(weights.blue, `${type}.blue`, 0, true),
                紫: number(weights.purple, `${type}.purple`, 0, true),
                金: number(weights.gold, `${type}.gold`, 0, true),
            },
            eligibleCardTypes: parseCardTypeList(raw.eligibleCardTypes, `${type}.eligibleCardTypes`),
        };
    }
    for (const type of ZC_PVP_TILE_TYPES) {
        if (!result[type]) throw new Error(`缺少地块类型：${type}`);
    }
    return result;
}

export function parseTileWeights(value: unknown): ZCPvpTileTypeWeight[] {
    return array(value, 'tileGeneration.weights').map((item) => {
        const raw = object(item, 'tileGeneration.weights[]');
        return {
            type: number(raw.tileType, 'tileGeneration.weights[].tileType') as ZCPvpTileType,
            weight: number(raw.weight, 'tileGeneration.weights[].weight'),
            initialCountLimit: 0,
            setCountLimit: 0,
        };
    });
}

/** 解析基础阵容权重随机表 pvpBaseTeamWeight：地块类型 / 生成权重 / 初始生成个数限制 / 集合内个数限制。 */
export function parseBaseTeamWeights(value: unknown): ZCPvpTileTypeWeight[] {
    return array(value, 'pvpBaseTeamWeight').map((item) => {
        const raw = object(item, 'pvpBaseTeamWeight[]');
        return {
            type: number(raw.tileType, 'pvpBaseTeamWeight[].tileType') as ZCPvpTileType,
            weight: number(raw.weight, 'pvpBaseTeamWeight[].weight'),
            initialCountLimit: number(raw.initialCountLimit, 'pvpBaseTeamWeight[].initialCountLimit', 0, true),
            setCountLimit: number(raw.setCountLimit, 'pvpBaseTeamWeight[].setCountLimit', 0, true),
        };
    });
}

/**
 * 克制表：维度列写的是**中文维度名**，这里翻译成 `ZCCardTraits` 的键。
 *
 * 2026-09-16 起只有「攻击 / 阵营」两维（`PVP-克制羁绊` 同步精简），
 * 旧的「情绪 / 植物」两维连同词表一起废弃 —— 若表里再出现，
 * 会在这里抛错（宁可进不去对局，也不要静默变成一条永不生效的死规则）。
 */
export function parseCounterRules(value: unknown): ZCCounterRule[] {
    const traits: Record<string, keyof ZCCardTraits> = { 攻击: 'attack', 阵营: 'camp' };
    return array(value, 'combat.counters').map((item) => {
        const raw = object(item, 'combat.counters[]');
        const dimension = text(raw.dimension, 'combat.counters[].dimension');
        const trait = traits[dimension];
        if (!trait) throw new Error(`未知克制维度：${dimension}`);
        return {
            trait,
            attacker: text(raw.attacker, 'combat.counters[].attacker'),
            defender: text(raw.defender, 'combat.counters[].defender'),
            damageMultiplier: number(raw.damageMultiplier, 'combat.counters[].damageMultiplier'),
        };
    });
}

/** 解析 pvpBond 全表；配置编译与卡牌阵容页共用。 */
export function parseBondRules(value: unknown): ZCBondRule[] {
    const bondTraits: ReadonlySet<string> = new Set(['attack', 'camp']);
    const bondEffects: ReadonlySet<string> = new Set(['unitHp', 'unitAttack', 'spawnInterval', 'moveSpeed', 'income', 'towerAttack']);
    return array(value, 'combat.bonds').map((item) => {
        const raw = object(item, 'combat.bonds[]');
        const trait = text(raw.trait, 'combat.bonds[].trait');
        if (!bondTraits.has(trait)) throw new Error(`未知羁绊维度：${trait}`);
        const effectType = text(raw.effectType, 'combat.bonds[].effectType');
        if (!bondEffects.has(effectType)) throw new Error(`未知羁绊效果类型：${effectType}`);
        return {
            id: text(raw.id, 'combat.bonds[].id'),
            name: text(raw.name, 'combat.bonds[].name'),
            trait: trait as keyof ZCCardTraits,
            target: text(raw.target, 'combat.bonds[].target'),
            threshold: number(raw.threshold, 'combat.bonds[].threshold'),
            effectType: effectType as ZCBondEffectType,
            effectValue: number(raw.effectValue, 'combat.bonds[].effectValue', -1),
        };
    });
}

/** 转表 int 0/1 → bool；非 0/1 时原样返回（用于容错）。 */
export function refBool(value: unknown): boolean | undefined {
    if (value === 1 || value === '1' || value === true) return true;
    if (value === 0 || value === '0' || value === false) return false;
    return undefined;
}

/** 转表空串 → null；其余原样返回。 */
export function refNullable(value: unknown): unknown {
    return value === '' ? null : value;
}

/** kv 数组 [{key, value}] → 对象 { key: value }。 */
export function kvToObject(kv: Array<{ key: string; value: unknown }> | undefined): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const entry of kv ?? []) result[entry.key] = entry.value;
    return result;
}

/**
 * `pvpCard` 一行 → 归一化后的原始行（ref 里的 `1/0`、空串等换成运行时值）。
 *
 *  **必须先过这一步再交给 `parseCard`**：`parseCard` 的 `enabled` 判的是严格
 * `raw.enabled === true`，而 remoteRef 表里下发的是数字 `1`
 * （`enabled: refBool(row.enabled) ?? false` 就是为了把它变成布尔）。
 * 漏掉归一化会让 `.filter((card) => card.enabled)` 把整张表清空 ——
 * 而且**不报错**，只表现为「卡组为空、页面保留占位外观」。
 *
 * `loadPvpTables` 与卡牌阵容页（`CardLineupDecks`）共用本函数，
 * 避免同一张表的字段口径在两处漂移。
 */
export function normalizeCardRow(row: unknown): Record<string, unknown> {
    const raw = object(row, 'pvpCard[]');
    //  2026-09-20 起表里 `id` 是**整数**（`2002` / `68001`），而工程运行时的 id 一律按
    // **字符串**走（`hex.cardId`、存档、后端 `heroId` 关联都靠 `String()` 对齐）。
    // 所以这里就把类型归一掉，别让下游拿到 `number | string` 混合：
    // `id` 缺失时会退回 `name`（字符串），那就是混合的来源。
    //  保持「缺失即缺失」——`null` 不转成 `'null'`，留给 `parseCard` 的 `text()` 抛错，
    // 否则缺列会静默变成一张 id 叫 "undefined" 的卡。
    const id = refNullable(raw.id) ?? raw.name;
    return {
        ...raw,
        //  转表器**不会生成 `id`** —— `PVP-卡牌.xlsx` 里没有这一列，导出什么列就是什么列。
        // 而抽卡、`hex.cardId`、存档都按 `id` 走，缺了会整局卡在「cards[].id 必须是非空字符串」。
        // 缺列时退回 `name`（同一卡组内名字唯一），策划补上 `id` 列后自动以表为准。
        id: id == null ? id : String(id),
        unitId: refNullable(raw.unitId) == null ? null : String(raw.unitId),
        description: refNullable(raw.description),
        enabled: refBool(raw.enabled) ?? false,
    };
}

