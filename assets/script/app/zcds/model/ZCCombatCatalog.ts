/**
 * 《占城大师》战斗卡牌目录。
 * 人物与基础数值裁剪自 client 的 army/general/monster 表，规则层按三分钟竖屏对局缩放。
 */

/** 单位标识 = pvpCard.json 卡行 unitId 列。一律以表 id 为准，客户端不自带兵种命名。 */
export type ZCUnitId = string;

/**
 * 技能强化（大招）触发方式，值域与 pvpSkillBinding.trigger 一致。
 * 两种节拍都要能配：每 N 次普攻 / 每 X 秒。
 */
export const ZCSkillTrigger = {
    everyNAttacks: 'every_n_attacks',
    everySeconds: 'every_seconds',
} as const;
export type ZCSkillTrigger = typeof ZCSkillTrigger[keyof typeof ZCSkillTrigger];

/** 出手方式 / 战斗事件类型：近战 · 弹道 · 范围（`ZCAttackProfile.mode` 与 `ZCCombatEvent.type` 共用）。 */
export const ZCCombatEventType = {
    Melee: 'melee',
    Projectile: 'projectile',
    Area: 'area',
} as const;
export type ZCCombatEventType = typeof ZCCombatEventType[keyof typeof ZCCombatEventType];

/** 普攻档案。逻辑层消费技能 id/命中/强化计数，表现层消费特效 Prefab。 */
export interface ZCAttackProfile {
    skillId: number;
    name: string;
    mode: ZCCombatEventType;
    effectKey?: string;
    projectileKey?: string;
    projectileSpeed?: number;
    collisionRadius?: number;
    areaRadius?: number;
    empoweredEvery?: number;
    empoweredSkillId?: number;
    /** 强化触发方式；留空按次数。 */
    trigger?: ZCSkillTrigger;
    /** trigger=every_seconds 的时间间隔（秒）。 */
    cooldown?: number;
    /** 伤害倍率：最终伤害 = 基准伤害 × 本值；普攻/技能行各自携带。 */
    damageRate?: number;
    effectPrefabPath?: string;
    /** area 持续秒数；0=一次性。 */
    durationSeconds?: number;
    waves?: number;
    slowRatio?: number;
    /** 命中单位后施加的状态 id（pvpStatus.statusId）；不填=不施加。直伤/弹道命中均生效。 */
    onHitStatusId?: string;
    /** 旧客户端公式组（兼容旧配置；由 skillView.hurt / exHurt 解析而来）。 */
    legacyEffectKeys?: readonly string[];
}

export interface ZCUnitDefinition {
    unitId: ZCUnitId;
    name: string;
    maxHp: number;
    attack: number;
    moveSpeed: number;
    attackRange: number;
    attackInterval: number;
    attackDuration: number;
    attackHitTime: number;
    bodyRadius: number;
    spawnSeconds: number;
    flying: boolean;
    canAttackAir: boolean;
    hero: boolean;
    prefabPath: string;
    /**
     * 兵种美术的等比缩放系数（`pvpCard.prefabSize`，策划按美术实际体量配 0.8~1.2）。
     *
     * **必填、解析层永远给值**（表里留空按 1 兜底）：它直接乘进战场单位的美术缩放，
     * 缺省成可选会让每个消费方都要写一遍 `?? 1`，而漏一处就是「有的兵放大、有的兵没放大」。
     *
     *  与 `SPINE_CANVAS_TARGET_HEIGHT`（`ZCUnitView`）**不是同一个东西**：
     * 那是把 spine 骨架 canvas 归一到序列帧画布的**技术性**补偿（每个 spine 都不同），
     * 这里是策划给的**表现性**系数（在归一之后叠加）。两者相乘，顺序不能反。
     */
    prefabSize: number;
    attackProfile: ZCAttackProfile;
    /** 强化那击对应技能行档案；未配置强化时 undefined。 */
    empoweredProfile?: ZCAttackProfile;
}

/**
 * 卡牌类型：1=金矿 2=兵营 3=防御塔 4=城墙 5=主城。
 * 城墙是边的属性（wallHp），不占 hex.building。
 *
 * 能量名用英文（不用中文 key），中文只留在 `ZC_CARD_TYPE_NAMES` 里作文案。
 */
export const ZCCardType = {
    Mine: 1,
    Barracks: 2,
    Tower: 3,
    Wall: 4,
    Hq: 5,
} as const;
export type ZCCardType = (typeof ZCCardType)[keyof typeof ZCCardType];

/** 卡类型 → 中文名；仅用于玩家可见文案。 */
export const ZC_CARD_TYPE_NAMES = {
    [ZCCardType.Mine]: '金矿',
    [ZCCardType.Barracks]: '兵营',
    [ZCCardType.Tower]: '防御塔',
    [ZCCardType.Wall]: '城墙',
    [ZCCardType.Hq]: '主城',
} as const satisfies Readonly<Record<ZCCardType, string>>;

export type ZCCardBuilding = 'mine' | 'barracks' | 'tower' | 'hq';

/** 集合判定而非区间：加/删类型自动跟随，不用同步上界。 */
const ZC_CARD_TYPE_VALUES: ReadonlySet<number> = new Set(Object.values(ZCCardType));

export function isZCCardType(value: unknown): value is ZCCardType {
    return typeof value === 'number' && ZC_CARD_TYPE_VALUES.has(value);
}

/** 卡类型 → 建筑类型；城墙不落地，返回 null。 */
export function cardTypeToBuilding(type: ZCCardType): ZCCardBuilding | null {
    if (type === ZCCardType.Wall) return null;
    if (type === ZCCardType.Mine) return 'mine';
    if (type === ZCCardType.Barracks) return 'barracks';
    if (type === ZCCardType.Tower) return 'tower';
    return 'hq';
}

export type ZCCardRarity = '绿' | '蓝' | '紫' | '金';

/**
 * 卡牌标签两维：attack（职业）、camp（阵营）。
 * 这两组值是表里原字符串，表里改词表时这里、pvpCounter、pvpBond 三处一起改。
 */
export type ZCAttackTrait = '射手' | '坦克' | '法师' | '战士';
export type ZCCampTrait = '花果' | '蘑菇' | '盆栽' | '僵尸';

export interface ZCCardTraits {
    attack: ZCAttackTrait;
    camp: ZCCampTrait;
}

export interface ZCDeckCard {
    id: string;
    name: string;
    type: ZCCardType;
    rarity: ZCCardRarity;
    /**
     * 本卡产出兵种的引用。只有兵营卡填，建筑卡必须留空
     * （findUnplayableDeckCards 用 unitId==null 认建筑卡）。
     */
    unitId?: ZCUnitId;
    /** 本卡兵种的 resources 预制体路径；阵容上阵预览与对局使用同一资产。 */
    unitPrefabPath?: string;
    traits?: ZCCardTraits;
    buildSeconds?: number;
    cycleSeconds?: number;
    /** 建筑耐久基础值，与 unitId 指向的兵种血量无关。 */
    baseHp?: number;
    cycleBaseValue?: number;
    /** 每品级追加的建筑耐久。 */
    cyclePerTierValue?: number;
    /** 建筑每次产金数量（固定值，不随品级变）。 */
    buildDigGoldNum?: number;
    /**
     * 卡牌头像，值是 icon.json 图标名（不是资源名）。
     * 包名决定目录（兵种头像 cardHead / 玩家头像 head），用 HeadArt.loadHeadIconFrame 加载。
     * 留空 = 暂无头像。
     */
    headIcon?: string;
    /**
     * 建筑外观图名（`resources/image/buildings` 下的图片名，不含扩展名）。
     * 兵营/主城的专属外观；留空由视图按建筑类型回退通用图。
     */
    buildIcon?: string;
    /**
     * 该卡的技能编号列表（`pvpCard.skillList`，顺序即 UI 顺序）。
     *
     * 编号与后端 `CmdPvpHeroSkillInfo.id` / 技能升级请求体的 `skillId` 同一套，
     * 技能名与各档解锁等级在 `armySkillLevelUp`（见 `card/CardSkillList`）。
     * 留空 = 这张卡没有技能（主城 / 金矿），**不是**"还没加载"。
     */
    skillIds?: readonly number[];
}

/** 本地 PVP 卡牌目录；正式对局会按后端阵容收窄英雄卡，并保留系统卡。 */
let playerDeck: readonly ZCDeckCard[] = [];
let enemyDeck: readonly ZCDeckCard[] = [];

export function getPlayerDeck(): readonly ZCDeckCard[] {
    return playerDeck;
}

export function getEnemyDeck(): readonly ZCDeckCard[] {
    return enemyDeck;
}

/**
 * 按卡牌 id 取该卡配置的建筑外观图名（buildIcon）。
 *
 * 只查当前本地卡牌目录（玩家 / PVE 敌方）；未配 buildIcon 或卡不在目录中返回空串，
 * 由视图按建筑类型回退通用图。
 */
export function getCardBuildIcon(cardId: string | null | undefined): string {
    if (!cardId) return '';
    for (const card of playerDeck) {
        if (card.id === cardId) return card.buildIcon ?? '';
    }
    for (const card of enemyDeck) {
        if (card.id === cardId) return card.buildIcon ?? '';
    }
    return '';
}

export const ZC_RARITY_RANK: Readonly<Record<ZCCardRarity, number>> = { 绿: 1, 蓝: 2, 紫: 3, 金: 4 };

/** 品级（1..4）→ 品级键，ZC_RARITY_RANK 反表，两表一起改。 */
export const ZC_RARITY_BY_RANK: readonly ZCCardRarity[] = ['绿', '蓝', '紫', '金'];

/** 品级 → 展示中文名（绿=普通、蓝=稀有、紫=史诗、金=传说）。 */
export const ZC_RARITY_NAMES: Readonly<Record<ZCCardRarity, string>> = {
    绿: '普通', 蓝: '稀有', 紫: '史诗', 金: '传说',
};

export function rarityNameOfTier(tier: number): string {
    const rarity = ZC_RARITY_BY_RANK[tier - 1];
    return rarity ? ZC_RARITY_NAMES[rarity] : '';
}

/** 问号地块运气评语，按品级；蓝品级刻意无文案（all-random 抽不到蓝卡）。 */
export const ZC_LUCK_TEXTS: Readonly<Record<number, string>> = {
    1: '小有收获',
    3: '大吉大利',
    4: '欧皇降临',
};

export function luckTextOfTier(tier: number): string {
    return ZC_LUCK_TEXTS[tier] ?? '';
}

type ZCTraitKey = keyof ZCCardTraits;
export interface ZCCounterRule {
    trait: ZCTraitKey;
    attacker: string;
    defender: string;
    damageMultiplier: number;
}

let counterRules: readonly ZCCounterRule[] = [];

export function getCounterRules(): readonly ZCCounterRule[] {
    return counterRules;
}

/** 四维任一形成克制时取最高倍率；金矿不参与。 */
export function cardCounterMultiplier(attacker?: ZCDeckCard, defender?: ZCDeckCard, rules = counterRules): number {
    if (!attacker?.traits || !defender?.traits) return 1;
    const a = attacker.traits;
    const d = defender.traits;
    return rules.reduce((multiplier, rule) => (
        a[rule.trait] === rule.attacker && d[rule.trait] === rule.defender
            ? Math.max(multiplier, rule.damageMultiplier)
            : multiplier
    ), 1);
}

export interface ZCDeckBonuses {
    activeBonds: string[];
    unitHpMultiplier: number;
    unitAttackMultiplier: number;
    moveSpeedMultiplier: number;
    towerAttackMultiplier: number;
    incomeBonus: number;
    spawnIntervalMultiplier: number;
}

export type ZCBondEffectType =
    | 'unitHp'
    | 'unitAttack'
    | 'spawnInterval'
    | 'moveSpeed'
    | 'income'
    | 'towerAttack';

export interface ZCBondRule {
    id: string;
    name: string;
    trait: keyof ZCCardTraits;
    /** 目标标签值；'any' = 任一相同标签计数。 */
    target: string;
    threshold: number;
    effectType: ZCBondEffectType;
    effectValue: number;
}

let bondRules: readonly ZCBondRule[] = [];

export function setBondRules(rules: readonly ZCBondRule[]): void {
    bondRules = rules;
}

export function getBondRules(): readonly ZCBondRule[] {
    return bondRules;
}

/** 由八卡阵容按 pvpBond 规则实时计算羁绊。 */
export function calculateDeckBonuses(deck: readonly ZCDeckCard[], rules = bondRules): ZCDeckBonuses {
    const cards = deck.filter((card) => card.traits);
    const count = (key: keyof ZCCardTraits, value: string) => cards.filter((card) => card.traits?.[key] === value).length;
    const result: ZCDeckBonuses = {
        activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
        moveSpeedMultiplier: 1, towerAttackMultiplier: 1,
        incomeBonus: 0, spawnIntervalMultiplier: 1,
    };
    for (const rule of rules) {
        const matched = rule.target === 'any'
            ? Math.max(0, ...Array.from(new Set(cards.map((card) => card.traits?.[rule.trait] ?? '')), (value) => count(rule.trait, value)))
            : count(rule.trait, rule.target);
        if (matched < rule.threshold) continue;
        result.activeBonds.push(rule.name);
        switch (rule.effectType) {
            case 'unitHp': result.unitHpMultiplier += rule.effectValue; break;
            case 'unitAttack': result.unitAttackMultiplier += rule.effectValue; break;
            case 'spawnInterval': result.spawnIntervalMultiplier += rule.effectValue; break;
            case 'moveSpeed': result.moveSpeedMultiplier += rule.effectValue; break;
            case 'income': result.incomeBonus += rule.effectValue; break;
            case 'towerAttack': result.towerAttackMultiplier += rule.effectValue; break;
        }
    }
    return result;
}

//#region PVP 单位目录
/** 单位目录按 unitId 索引，只装可上场行（配了 Prefab 与普攻技能；建筑行跳过）。 */
let unitCatalog: ReadonlyMap<ZCUnitId, ZCUnitDefinition> | null = null;

/**
 * 全量卡目录：按 `pvpCard.id` 索引，**装所有 enabled 行**（含主城、含不在任何一方卡组里的行）。
 *
 *  为什么不能只用 `ZCGameModel.cardById`：它查的是「四方卡组的并集」，而正式局的卡组由后端
 *  `CmdStartBattleRspMsg.unitInfos` 收窄（见 `ZCClientCombatConfig.buildBattleDeck`）。
 * 中立资源点的奖励卡（表 `neutralResource.rewardCardId`，如 68001豌豆游侠）是**配置指定**的，
 * 不保证在任何人本次上场的卡组里 —— 所以必须有一份不收窄的全量目录给它查。
 */
let cardCatalog: ReadonlyMap<string, ZCDeckCard> | null = null;

export function setUnitCatalog(value: ReadonlyMap<ZCUnitId, ZCUnitDefinition> | null): void {
    unitCatalog = value;
}

/**
 * 查全量卡目录。
 *
 *  取不到返回 `null`（**不抛错**）：奖励发放是玩法表现，查不到卡就不发这一项，
 *  不该让整局对局崩在领奖那一刻。配置真错了要靠 `pvp_card_check.py` 那类守卫暴露，不靠这里。
 */
export function findCatalogCard(cardId: string | null | undefined): ZCDeckCard | null {
    if (!cardId) return null;
    return cardCatalog?.get(String(cardId)) ?? null;
}

export function setCardCatalog(value: ReadonlyMap<string, ZCDeckCard> | null): void {
    cardCatalog = value;
}

export function setRuntimeDecks(player: readonly ZCDeckCard[], enemy: readonly ZCDeckCard[]): void {
    playerDeck = player;
    enemyDeck = enemy;
}

export function setCounterRules(rules: readonly ZCCounterRule[]): void {
    counterRules = [...rules];
}

export function hasUnitDefinition(unitId: ZCUnitId): boolean {
    return unitCatalog?.has(unitId) === true;
}

/** 取单位定义：数值/Prefab 由 pvpCard 单位列提供，技能由 pvpSkill 提供。不完整时抛错，不兜底。 */
export function resolveUnitDefinition(unitId: ZCUnitId): ZCUnitDefinition {
    const definition = unitCatalog?.get(unitId);
    if (!definition || definition.maxHp == null || definition.attack == null || !definition.prefabPath || !definition.attackProfile) {
        throw new Error(`[ZCCombatCatalog] 单位 ${unitId} 的 PVP 配置不完整`);
    }
    return definition;
}

/** 全部可上场单位定义，供批量加载 Prefab。 */
export function getAllUnitDefinitions(): ZCUnitDefinition[] {
    return unitCatalog ? Array.from(unitCatalog.values()) : [];
}
//#endregion
