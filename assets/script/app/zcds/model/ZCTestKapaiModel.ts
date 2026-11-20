import type { ZCAttackProfile, ZCDeckBonuses, ZCDeckCard, ZCUnitDefinition } from './ZCCombatCatalog';
import { rarityDisplayName, rarityRank, ZC_CARD_TYPE_NAMES, ZCCardType, ZCSkillTrigger } from './ZCCombatCatalog';
import type { ZCRuntimeRules } from './ZCGameRuntimeConfig';
import type { IZCRuntimeCatalogs } from './ZCRuntimeConfigStore';
import { ZCCombatSystem } from './systems/ZCCombatSystem';

/**
 * TestKapai 手动验证场景的纯数值层（零 `cc`，可直接被 Node 用例 import）。
 *
 * 两条硬口径：
 * 1. **战斗数值只从运行时编译配置来** —— `pvpCard` / `pvpSkill` / `pvpGlobal` 经
 *    `compilePvpTables` 后落在 `IZCRuntimeCatalogs` 上，本文件不复制任何表字段常量，
 *    也不自带默认数值。伤害一律调 `ZCCombatSystem.unitDamage`（真实公式），不另写一份。
 * 2. **界面版式归场景** —— 节点与位置由 `TestKapai.scene` 承载（Cocos MCP 创建），
 *    本文件只解析舞台倍率、配色和调试默认值；缺字段 / 类型不对时返回可展示的诊断，
 *    绝不静默兜底成"看着正常"的默认值。
 */

/* ------------------------------------------------------------------ *
 * 诊断
 * ------------------------------------------------------------------ */

export type ZCTestKapaiIssueLevel = 'error' | 'warn';

export interface ITestKapaiIssue {
    readonly level: ZCTestKapaiIssueLevel;
    /** 出错位置（`舞台 / viewScale`、`卡牌[豌豆游侠] / pvpSkill.damageRate`）。*/
    readonly scope: string;
    readonly detail: string;
}

export function formatZCTestKapaiIssue(issue: ITestKapaiIssue): string {
    return `[${issue.level === 'error' ? '错误' : '提示'}] ${issue.scope}：${issue.detail}`;
}

/* ------------------------------------------------------------------ *
 * 配置（config/testkapai.json）
 * ------------------------------------------------------------------ */

export interface ITestKapaiStageLayout {
    /**
     * 视图倍率：默认 2 倍用于看清细节，`scaleOptions` 里的 1.0 就是战场 1:1。
     *
     * 单位 = `69.4 / 骨架 canvas 高 × prefabSize × viewScale`，
     * 特效 = `zcEffectNodeScaleOf(path) × viewScale` —— 两者同乘一个数，比例才不会走样。
     */
    readonly viewScale: number;
    /** 可切换的视图倍率；必须包含 1.0（战场 1:1），否则"实战多大"无法核对。*/
    readonly scaleOptions: readonly number[];
    /** 单位脚点在舞台内的 y（舞台中心为 0）。*/
    readonly groundOffsetY: number;
    /** 我方单位相对舞台中心的 x。*/
    readonly unitOffsetX: number;
    /** 靶子相对舞台中心的 x；特效取两者中点，形成「施法 → 命中」的读法。*/
    readonly targetOffsetX: number;
    /** 特效中点锚相对舞台中心的 y。*/
    readonly effectOffsetY: number;
    readonly gridColor: string;
    readonly gridFillColor: string;
    readonly guideColor: string;
    readonly loadingColor: string;
    readonly errorColor: string;
}

export interface ITestKapaiPalette {
    readonly background: string;
    readonly panel: string;
    readonly panelAlt: string;
    readonly button: string;
    readonly buttonActive: string;
    readonly buttonDisabled: string;
    readonly text: string;
    readonly muted: string;
    readonly accent: string;
    readonly danger: string;
}

/** 覆盖项默认值（1 = 不改）。这些值只影响本次会话，退出即还原。*/
export interface ITestKapaiDebugDefaults {
    readonly modelScale: number;
    readonly effectScale: number;
    readonly damageRate: number;
}

export interface ITestKapaiDamageTestConfig {
    readonly targetMaxHp: number;
    readonly targetName: string;
}

export interface ITestKapaiConfig {
    readonly stage: ITestKapaiStageLayout;
    readonly palette: ITestKapaiPalette;
    readonly debug: ITestKapaiDebugDefaults;
    readonly damageTest: ITestKapaiDamageTestConfig;
}

/** 校验上下文：收集问题，不抛错 —— 场景要能"带着残缺配置把问题显示出来"。*/
class ConfigReader {
    constructor(private readonly root: Record<string, unknown>, private readonly issues: ITestKapaiIssue[]) {}

    section(key: string): Record<string, unknown> {
        const value = this.root[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            this.fail(key, `缺少配置段（应为对象）`);
            return {};
        }
        return value as Record<string, unknown>;
    }

    positive(obj: Record<string, unknown>, section: string, key: string): number {
        const value = obj[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            this.fail(`${section}.${key}`, `应为正数，实际 ${describe(value)}`);
            return 0;
        }
        return value;
    }

    /** 允许负数的坐标类数值（舞台内的相对偏移）。*/
    number(obj: Record<string, unknown>, section: string, key: string): number {
        const value = obj[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            this.fail(`${section}.${key}`, `应为有限数值，实际 ${describe(value)}`);
            return 0;
        }
        return value;
    }

    color(obj: Record<string, unknown>, section: string, key: string): string {
        const value = obj[key];
        if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
            this.fail(`${section}.${key}`, `应为 #RRGGBB 或 #RRGGBBAA，实际 ${describe(value)}`);
            return '#FF00FF';
        }
        return value;
    }

    text(obj: Record<string, unknown>, section: string, key: string): string {
        const value = obj[key];
        if (typeof value !== 'string' || value.length === 0) {
            this.fail(`${section}.${key}`, `应为非空字符串，实际 ${describe(value)}`);
            return '';
        }
        return value;
    }

    /** 视图倍率列表：至少两档，且必须有一档是 1.0（战场 1:1）。*/
    scaleOptions(obj: Record<string, unknown>, section: string, key: string): readonly number[] {
        const value = obj[key];
        if (!Array.isArray(value) || value.length < 2) {
            this.fail(`${section}.${key}`, `至少两档倍率，实际 ${describe(value)}`);
            return [];
        }
        const options: number[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const entry = value[index];
            if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
                this.fail(`${section}.${key}[${index}]`, `应为正数，实际 ${describe(entry)}`);
                continue;
            }
            options.push(entry);
        }
        if (!options.some((entry) => Math.abs(entry - 1) < 1e-6)) {
            this.fail(`${section}.${key}`, `缺少 1.0（战场 1:1）档，无法核对实战尺寸`);
        }
        return options;
    }

    private fail(scope: string, detail: string): void {
        this.issues.push({ level: 'error', scope: `配置 / ${scope}`, detail });
    }
}

function describe(value: unknown): string {
    if (value === undefined) return 'undefined（缺失）';
    if (value === null) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `数组(${value.length})`;
    return typeof value;
}

/**
 * 解析并校验 `config/testkapai.json`。
 *
 * 返回值里 `config` 永远非空（缺项填 0 / 占位色），这样场景可以先撑住骨架、再把
 * `issues` 原样显示在诊断条上；绘制前必须检查 `issues`，不要拿 0 倍率当有效尺寸。
 */
export function parseZCTestKapaiConfig(raw: unknown): { config: ITestKapaiConfig; issues: ITestKapaiIssue[] } {
    const issues: ITestKapaiIssue[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        issues.push({ level: 'error', scope: '配置', detail: `配置文件不是对象：${describe(raw)}` });
        return { config: EMPTY_TEST_KAPAI_CONFIG, issues };
    }
    const root = raw as Record<string, unknown>;
    const reader = new ConfigReader(root, issues);
    const stage = reader.section('stage');
    const palette = reader.section('palette');
    const debug = reader.section('debug');
    const damageTest = reader.section('damageTest');

    const config: ITestKapaiConfig = {
        stage: {
            viewScale: reader.positive(stage, 'stage', 'viewScale'),
            scaleOptions: reader.scaleOptions(stage, 'stage', 'scaleOptions'),
            groundOffsetY: reader.number(stage, 'stage', 'groundOffsetY'),
            unitOffsetX: reader.number(stage, 'stage', 'unitOffsetX'),
            targetOffsetX: reader.number(stage, 'stage', 'targetOffsetX'),
            effectOffsetY: reader.number(stage, 'stage', 'effectOffsetY'),
            gridColor: reader.color(stage, 'stage', 'gridColor'),
            gridFillColor: reader.color(stage, 'stage', 'gridFillColor'),
            guideColor: reader.color(stage, 'stage', 'guideColor'),
            loadingColor: reader.color(stage, 'stage', 'loadingColor'),
            errorColor: reader.color(stage, 'stage', 'errorColor'),
        },
        palette: {
            background: reader.color(palette, 'palette', 'background'),
            panel: reader.color(palette, 'palette', 'panel'),
            panelAlt: reader.color(palette, 'palette', 'panelAlt'),
            button: reader.color(palette, 'palette', 'button'),
            buttonActive: reader.color(palette, 'palette', 'buttonActive'),
            buttonDisabled: reader.color(palette, 'palette', 'buttonDisabled'),
            text: reader.color(palette, 'palette', 'text'),
            muted: reader.color(palette, 'palette', 'muted'),
            accent: reader.color(palette, 'palette', 'accent'),
            danger: reader.color(palette, 'palette', 'danger'),
        },
        debug: {
            modelScale: reader.positive(debug, 'debug', 'modelScale'),
            effectScale: reader.positive(debug, 'debug', 'effectScale'),
            damageRate: reader.positive(debug, 'debug', 'damageRate'),
        },
        damageTest: {
            targetMaxHp: reader.positive(damageTest, 'damageTest', 'targetMaxHp'),
            targetName: reader.text(damageTest, 'damageTest', 'targetName'),
        },
    };

    if (config.stage.unitOffsetX === config.stage.targetOffsetX) {
        issues.push({
            level: 'error',
            scope: '配置 / stage',
            detail: `unitOffsetX 与 targetOffsetX 相同（${config.stage.unitOffsetX}），模型会压在靶子上`,
        });
    }
    return { config, issues };
}

/** 校验失败时用来先撑住画面；任何尺寸为 0 的字段都不该被真正排版。*/
export const EMPTY_TEST_KAPAI_CONFIG: ITestKapaiConfig = {
    stage: {
        viewScale: 0, scaleOptions: [], groundOffsetY: 0, unitOffsetX: 0, targetOffsetX: 0,
        effectOffsetY: 0, gridColor: '#FF00FF', gridFillColor: '#FF00FF', guideColor: '#FF00FF',
        loadingColor: '#FF00FF', errorColor: '#FF00FF',
    },
    palette: {
        background: '#FF00FF', panel: '#FF00FF', panelAlt: '#FF00FF', button: '#FF00FF',
        buttonActive: '#FF00FF', buttonDisabled: '#FF00FF', text: '#FF00FF', muted: '#FF00FF',
        accent: '#FF00FF', danger: '#FF00FF',
    },
    debug: { modelScale: 0, effectScale: 0, damageRate: 0 },
    damageTest: { targetMaxHp: 0, targetName: '' },
};

/* ------------------------------------------------------------------ *
 * 卡牌与技能快照
 * ------------------------------------------------------------------ */

export class ZCTestKapaiRound {
    paused = false;
    private maxHp = 0;
    private _elapsed = 0;
    private _totalDamage = 0;
    private _castCount = 0;
    private _targetHp = 0;

    get elapsed(): number {
        return this._elapsed;
    }

    get totalDamage(): number {
        return this._totalDamage;
    }

    get castCount(): number {
        return this._castCount;
    }

    get targetHp(): number {
        return this._targetHp;
    }

    restart(maxHp: number): void {
        this.maxHp = maxHp;
        this._targetHp = maxHp;
        this._elapsed = 0;
        this._totalDamage = 0;
        this._castCount = 0;
        this.paused = false;
    }

    advance(dt: number): void {
        if (!this.paused) this._elapsed += dt;
    }

    hit(damage: number): { before: number; after: number; broke: boolean } | null {
        if (this.paused) return null;
        const before = this._targetHp;
        const after = Math.max(0, before - damage);
        const broke = after === 0;
        this._targetHp = broke ? this.maxHp : after;
        this._totalDamage += damage;
        this._castCount += 1;
        return { before, after, broke };
    }
}

export type ZCTestKapaiSkillKind = 'basic' | 'empowered' | 'secondary';

export interface ITestKapaiStat {
    readonly label: string;
    readonly value: string;
    /** 数值来源列名（`pvpCard.unitAttack` 这类），UI 上以小字显示，避免"数从哪来"说不清。*/
    readonly source: string;
}

/**
 * 一次伤害的乘数明细。字段与 `ZCCombatSystem.unitDamage` 一一对应，
 * 只用于展示"这个数怎么来的"，最终伤害仍由真实公式算出。
 */
export interface ITestKapaiDamageFactors {
    readonly attack: number;
    readonly tier: number;
    /** 克制乘数；验证台默认按中性目标取 1。*/
    readonly counter: number;
    readonly global: number;
    readonly skillRate: number;
}

export interface ITestKapaiSkill {
    readonly kind: ZCTestKapaiSkillKind;
    readonly skillId: number;
    readonly name: string;
    readonly mode: string;
    /**
     * 这个技能"多快能再放一次"（秒），按**真实节拍**取值，不是无脑用 `pvpSkill.cooldown`：
     * - 普攻：`pvpCard.unitAttackInterval`（`cooldown` 那一列记的是强化技间隔，不是普攻冷却）
     * - 强化技 `every_n_attacks`：0（改用 `attacksRequired` 计次）
     * - 强化技 `every_seconds` / 副轨：`pvpSkill.cooldown`
     */
    readonly cooldownSeconds: number;
    /** 强化技的普攻次数门槛（`pvpSkill.empoweredEvery`）；0 表示不按次数触发。*/
    readonly attacksRequired: number;
    /** `pvpSkill.damageRate`，缺省 1（与战斗逻辑同口径）。*/
    readonly damageRate: number;
    /** 按 `ZCCombatSystem.unitDamage` 复算的单次伤害（中性阵容 / 中性目标）。*/
    readonly damage: number;
    /** 该技能的品级与基础攻击，供调试覆盖时按真实公式复算。*/
    readonly tier: number;
    readonly attack: number;
    /** 伤害乘数明细，展示用；与 `damage` 同源。*/
    readonly factors: ITestKapaiDamageFactors;
    /** 范围半径（`pvpSkill.areaRadius`）；0 = 单体。*/
    readonly areaRadius: number;
    /** 强化这一击的触发说明（每 N 次普攻 / 每 X 秒）。*/
    readonly triggerText: string;
    /** 范围 / 波数 / 减速 / 弹速等摘要。*/
    readonly detail: string;
    /**
     * `pvpSkill.effectPrefabPath`（battle bundle 内的 `units/projectiles/...`）。
     * 舞台按 `zcEffectNodeScaleOf` 乘视图倍率播放，尺寸口径与战场一致。
     * 留空 = 这个技能没有登记特效，按钮只做数值演示。
    */
    readonly effectPrefabPath: string;
}

export interface ITestKapaiCard {
    readonly id: string;
    readonly name: string;
    readonly typeLabel: string;
    readonly rarityLabel: string;
    readonly rarityColorIndex: number;
    /** 卡面图标名：兵种取 `headIcon`，建筑取 `buildIcon`；都缺就空串。*/
    readonly iconName: string;
    /** 有兵种定义（能放技能）才为 true。*/
    readonly playable: boolean;
    /** `pvpCard.prefabSize`（无兵种按 1）；卡面上的体型示意按它缩放。*/
    readonly prefabSize: number;
    /** `pvpCard.unitPrefabPath`（`skel/<名>/<名>`，resources 包）；舞台按它加载 spine 模型。*/
    readonly unitPrefabPath: string;
    /** `pvpCard.unitAttackRange`（世界 px）；舞台据此画射程圈。*/
    readonly attackRange: number;
    /** `pvpCard.unitAttackInterval`（秒）；自动攻击的节拍。*/
    readonly attackInterval: number;
    /** 兵种定义（调试覆盖时按真实公式复算；建筑卡为 null）。*/
    readonly definition: ZCUnitDefinition | null;
    readonly stats: readonly ITestKapaiStat[];
    readonly skills: readonly ITestKapaiSkill[];
    /** 该卡自己的配置问题（不阻断其它卡）。*/
    readonly issues: readonly ITestKapaiIssue[];
}

export interface ITestKapaiCatalog {
    readonly cards: readonly ITestKapaiCard[];
    readonly issues: readonly ITestKapaiIssue[];
    /** 被过滤掉、不进切换列表的卡数（当前口径下是主城 / 金矿这类不出兵的建筑卡）。*/
    readonly hiddenCount: number;
}

/** 目录构建选项。*/
export interface ITestKapaiCatalogOptions {
    /**
     * 是否把建筑卡（主城 / 金矿 / 塔 / 城墙）也放进切换列表。
     *
     * 默认 `false`：「看卡牌与技能」这件事里，建筑卡没有兵种也没有技能行，
     * 占一个切换位只会让人多按几十下方向键。用例要验证建筑卡分支时显式传 `true`。
     */
    readonly includeBuildings?: boolean;
}

/** 攻关卡组默认加成：测试场景不模拟羁绊，乘数保持 1。*/
function neutralBonuses(): ZCDeckBonuses {
    return {
        activeBonds: [],
        unitHpMultiplier: 1,
        unitAttackMultiplier: 1,
        moveSpeedMultiplier: 1,
        towerAttackMultiplier: 1,
        incomeBonus: 0,
        spawnIntervalMultiplier: 1,
    };
}

function modeText(mode: string): string {
    if (mode === 'melee') return '近战';
    if (mode === 'projectile') return '弹道';
    if (mode === 'area') return '范围';
    return mode;
}

function triggerTextOf(profile: ZCAttackProfile): string {
    if (profile.trigger === 'every_n_attacks') {
        return profile.empoweredEvery ? `每 ${profile.empoweredEvery} 次普攻` : '每 N 次普攻（未配置次数）';
    }
    if (profile.trigger === 'every_seconds') {
        return profile.cooldown ? `每 ${profile.cooldown} 秒` : '每 X 秒（未配置间隔）';
    }
    return profile.empoweredEvery ? `每 ${profile.empoweredEvery} 次普攻` : '——';
}

function detailOf(profile: ZCAttackProfile): string {
    const parts: string[] = [];
    if (profile.areaRadius) parts.push(`半径 ${profile.areaRadius}`);
    if (profile.durationSeconds) parts.push(`持续 ${profile.durationSeconds}s`);
    if (profile.waves) parts.push(`${profile.waves} 波`);
    if (profile.slowRatio) parts.push(`减速 ${Math.round(profile.slowRatio * 100)}%`);
    if (profile.projectileSpeed) parts.push(`弹速 ${profile.projectileSpeed}`);
    if (profile.onHitStatusId) parts.push(`附加 ${profile.onHitStatusId}`);
    if (!parts.length) parts.push('单体');
    return parts.join(' · ');
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 100) / 100);
}

function statOrNull(label: string, value: number | undefined, source: string): ITestKapaiStat | null {
    if (value === undefined || !Number.isFinite(value)) return null;
    return { label, value: formatNumber(value), source };
}

/**
 * 构造一条可释放的技能行。
 *
 * `gate` 是**触发门槛的来源行**，不等于 `profile` 自己：
 * 强化那一击的 `empoweredEvery` / `trigger` / `cooldown` 都写在普攻行（`unit.attackProfile`）上，
 * 强化行（`empoweredProfile`）只带倍率与表现。取错行会让"每 N 次普攻"静默退化成可连点。
 */
function skillOf(
    kind: ZCTestKapaiSkillKind,
    profile: ZCAttackProfile,
    gate: ZCAttackProfile,
    unit: ZCUnitDefinition,
    rules: Readonly<ZCRuntimeRules>,
    tier: number,
    issues: ITestKapaiIssue[],
    cardName: string,
): ITestKapaiSkill {
    const rate = profile.damageRate === undefined ? 1 : profile.damageRate;
    if (!Number.isFinite(rate) || rate <= 0) {
        issues.push({
            level: 'warn',
            scope: `卡牌[${cardName}] / pvpSkill[${profile.skillId}].damageRate`,
            detail: `应为正数，实际 ${describe(profile.damageRate)}；伤害按 1 倍显示`,
        });
    }
    const cooldown = gate.cooldown === undefined ? 0 : gate.cooldown;
    if (!Number.isFinite(cooldown) || cooldown < 0) {
        issues.push({
            level: 'warn',
            scope: `卡牌[${cardName}] / pvpSkill[${gate.skillId}].cooldown`,
            detail: `应为非负数，实际 ${describe(gate.cooldown)}`,
        });
    }
    // 触发节拍按真实口径分流（别把 `cooldown` 一律当冷却用）：
    // 普攻看 `unitAttackInterval`；强化技先看普攻行的 `empoweredEvery` 计次，再退回 `cooldown`；
    // 副轨看自己的 `cooldown`。
    const every = gate.empoweredEvery === undefined ? 0 : gate.empoweredEvery;
    let cooldownSeconds = 0;
    let attacksRequired = 0;
    if (kind === 'basic') {
        cooldownSeconds = Number.isFinite(unit.attackInterval) && unit.attackInterval > 0 ? unit.attackInterval : 0;
    } else if (kind === 'empowered' && gate.trigger === ZCSkillTrigger.everyNAttacks && every > 0) {
        attacksRequired = Math.max(0, Math.floor(every));
    } else if (kind === 'empowered') {
        cooldownSeconds = Number.isFinite(cooldown) && cooldown > 0 ? cooldown : 0;
    } else {
        cooldownSeconds = Number.isFinite(profile.cooldown) && profile.cooldown > 0 ? profile.cooldown : 0;
    }
    if (kind === 'empowered' && gate.trigger === ZCSkillTrigger.everyNAttacks && every <= 0) {
        issues.push({
            level: 'warn',
            scope: `卡牌[${cardName}] / pvpSkill[${gate.skillId}].empoweredEvery`,
            detail: `按次数触发但次数为空（${describe(gate.empoweredEvery)}），按钮会退化成无门槛可连点`,
        });
    }
    // 真实公式：ZCCombatSystem.unitDamage（attack × 加成 × 品级 × 克制 × 全局倍率 × 技能倍率）。
    // 这里只把「本卡基础状态」代进去，不复制公式本体。
    const counter = 1;
    const factors: ITestKapaiDamageFactors = {
        attack: unit.attack,
        tier: 1 + (tier - 1) * rules.unitAttackPerTier,
        counter,
        global: rules.combatDamageMultiplier,
        skillRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    };
    const damage = ZCCombatSystem.unitDamage(
        { tier, neutralReinforcement: false },
        unit,
        neutralBonuses(),
        counter,
        rules,
        factors.skillRate,
    );
    return {
        kind,
        skillId: profile.skillId,
        name: profile.name,
        mode: profile.mode,
        cooldownSeconds,
        attacksRequired,
        damageRate: factors.skillRate,
        damage,
        tier,
        attack: unit.attack,
        factors,
        areaRadius: Number.isFinite(profile.areaRadius) && profile.areaRadius > 0 ? profile.areaRadius : 0,
        triggerText: triggerTextOf(gate),
        detail: detailOf(profile),
        effectPrefabPath: typeof profile.effectPrefabPath === 'string' ? profile.effectPrefabPath.trim() : '',
    };
}

/**
 * 应用调试覆盖后的乘数明细；`rateMultiplier` 乘在技能自身的 `damageRate` 上，1 = 不改。
 */
export function factorsOfSkill(skill: ITestKapaiSkill, rateMultiplier = 1): ITestKapaiDamageFactors {
    const rate = Number.isFinite(rateMultiplier) && rateMultiplier > 0 ? rateMultiplier : 1;
    return { ...skill.factors, skillRate: skill.damageRate * rate };
}

/**
 * 按调试覆盖值复算一次伤害（真实公式，不另写一份）。
 *
 * `rateMultiplier` 是调试条上的「伤害 ×N」，乘在技能自身的 `damageRate` 上；
 * 1 表示不改。返回值与 `skill.damage` 使用同一套乘数。
 */
export function damageOfSkill(
    skill: ITestKapaiSkill,
    definition: ZCUnitDefinition,
    rules: Readonly<ZCRuntimeRules>,
    rateMultiplier = 1,
): number {
    return ZCCombatSystem.unitDamage(
        { tier: skill.tier, neutralReinforcement: false },
        definition,
        neutralBonuses(),
        1,
        rules,
        factorsOfSkill(skill, rateMultiplier).skillRate,
    );
}

/**
 * 从运行时编译配置构建可切换的卡牌快照。
 *
 * 只读 `IZCRuntimeCatalogs`，不读全局单例 —— 用例可以直接喂合成目录，
 * 不必先把整个运行时配置装起来。
 */
export function buildZCTestKapaiCatalog(
    catalogs: Readonly<IZCRuntimeCatalogs>,
    options: ITestKapaiCatalogOptions = {},
): ITestKapaiCatalog {
    const issues: ITestKapaiIssue[] = [];
    const rules = catalogs.rules;
    if (!rules) {
        issues.push({ level: 'error', scope: '运行时配置', detail: 'rules 缺失（pvpGlobal 未装载）' });
        return { cards: [], issues, hiddenCount: 0 };
    }
    const sourceCards = catalogs.cards ?? [];
    const units = catalogs.units;
    if (!units) {
        issues.push({ level: 'error', scope: '运行时配置', detail: 'units 缺失（pvpCard / pvpSkill 未编译）' });
    }
    if (!sourceCards.length) {
        issues.push({ level: 'error', scope: '运行时配置', detail: 'pvpCard 没有任何已启用卡牌' });
    }
    const cards: ITestKapaiCard[] = [];
    let hiddenCount = 0;
    for (const card of sourceCards) {
        // 建筑卡（主城 / 金矿 / 塔 / 城墙）不出兵、没有技能行，默认不进切换列表。
        // 判定用 `type` 而不是「有没有兵种定义」：兵营卡若 unitId 配错，
        // 必须**留在列表里**把诊断显示出来，不能悄悄消失。
        if (!options.includeBuildings && isBuildingCard(card.type)) {
            hiddenCount += 1;
            continue;
        }
        const cardIssues: ITestKapaiIssue[] = [];
        cards.push(buildCard(card, units, rules, cardIssues, issues));
    }
    if (!cards.length) {
        issues.push({
            level: 'error',
            scope: '运行时配置',
            detail: hiddenCount > 0
                ? `过滤掉 ${hiddenCount} 张建筑卡后没有可展示的兵种卡（pvpCard 里没有已启用的兵营卡？）`
                : '没有可展示的卡牌',
        });
    }
    return { cards, issues, hiddenCount };
}

/** 建筑卡：不出兵，没有技能行（主城 / 金矿 / 防御塔 / 城墙）。*/
function isBuildingCard(type: ZCDeckCard['type']): boolean {
    return type === ZCCardType.Mine || type === ZCCardType.Tower
        || type === ZCCardType.Wall || type === ZCCardType.Hq;
}

function buildCard(
    card: ZCDeckCard,
    units: ReadonlyMap<string, ZCUnitDefinition> | undefined,
    rules: Readonly<ZCRuntimeRules>,
    cardIssues: ITestKapaiIssue[],
    globalIssues: ITestKapaiIssue[],
): ITestKapaiCard {
    const name = typeof card.name === 'string' ? card.name : '';
    if (!name) {
        cardIssues.push({ level: 'error', scope: `卡牌[${card.id}] / pvpCard.name`, detail: '名字为空，无法在切换栏标识这张卡' });
        globalIssues.push({ level: 'error', scope: `卡牌[${card.id}]`, detail: 'pvpCard.name 缺失' });
    }
    const typeLabel = ZC_CARD_TYPE_NAMES[card.type] ?? String(card.type);
    const rarityLabel = rarityDisplayName(card.rarity);
    if (!rarityLabel) {
        cardIssues.push({ level: 'warn', scope: `卡牌[${name || card.id}] / pvpCard.rarity`, detail: `未知品级 "${card.rarity}"，按最低档取色` });
    }
    const tier = Math.max(1, rarityRank(card.rarity));
    const unit = card.unitId && units ? units.get(card.unitId) : undefined;

    const stats: ITestKapaiStat[] = [];
    const skills: ITestKapaiSkill[] = [];

    if (card.type === ZCCardType.Barracks || card.unitId) {
        if (!card.unitId) {
            cardIssues.push({ level: 'error', scope: `卡牌[${name}] / pvpCard.unitId`, detail: '兵营卡没有 unitId，无法取到兵种定义' });
        } else if (!unit) {
            cardIssues.push({
                level: 'error',
                scope: `卡牌[${name}] / pvpCard.unitId`,
                detail: `unitId=${card.unitId} 在已编译兵种目录中不存在（检查 pvpCard.unitPrefabPath / unitSkillId）`,
            });
        }
    }

    if (unit) {
        if (!Number.isFinite(unit.attack) || unit.attack < 0) {
            cardIssues.push({ level: 'error', scope: `卡牌[${name}] / pvpCard.unitAttack`, detail: `应为非负数，实际 ${describe(unit.attack)}` });
        }
        if (!Number.isFinite(unit.maxHp) || unit.maxHp <= 0) {
            cardIssues.push({ level: 'error', scope: `卡牌[${name}] / pvpCard.unitMaxHp`, detail: `应为正数，实际 ${describe(unit.maxHp)}` });
        }
        for (const entry of [
            statOrNull('普攻伤害', unit.attack, 'pvpCard.unitAttack'),
            statOrNull('生命', unit.maxHp, 'pvpCard.unitMaxHp'),
            statOrNull('攻击间隔', unit.attackInterval, 'pvpCard.unitAttackInterval'),
            statOrNull('射程', unit.attackRange, 'pvpCard.unitAttackRange'),
            statOrNull('出兵周期', card.cycleSeconds, 'pvpCard.soilderAddTime'),
            statOrNull('每周期产量', card.cycleBaseValue, 'pvpCard.cycleBaseValue'),
            statOrNull('美术体型', unit.prefabSize, 'pvpCard.prefabSize'),
        ]) {
            if (entry) stats.push(entry);
        }
        skills.push(skillOf('basic', unit.attackProfile, unit.attackProfile, unit, rules, tier, cardIssues, name || card.id));
        if (unit.empoweredProfile) {
            skills.push(skillOf('empowered', unit.empoweredProfile, unit.attackProfile, unit, rules, tier, cardIssues, name || card.id));
        }
        if (unit.secondaryProfile) {
            skills.push(skillOf('secondary', unit.secondaryProfile, unit.secondaryProfile, unit, rules, tier, cardIssues, name || card.id));
        }
    } else {
        for (const entry of [
            statOrNull('建筑耐久', card.baseHp, 'pvpCard.baseHp'),
            statOrNull('建造耗时', card.buildSeconds, 'pvpCard.buildSeconds'),
            statOrNull('产金周期', card.cycleSeconds, 'pvpCard.goldDigTime'),
            statOrNull('每次产金', card.buildDigGoldNum, 'pvpCard.buildDigGoldNum'),
            statOrNull('每品级耐久', card.cyclePerTierValue, 'pvpCard.cyclePerTierValue'),
        ]) {
            if (entry) stats.push(entry);
        }
        if (!stats.length) {
            cardIssues.push({ level: 'error', scope: `卡牌[${name || card.id}]`, detail: '既没有兵种定义、也没有任何建筑数值列' });
        }
    }

    if (!stats.length) {
        globalIssues.push({ level: 'error', scope: `卡牌[${name || card.id}]`, detail: '没有任何可展示的数值行' });
    }

    return {
        id: card.id,
        name: name || card.id,
        typeLabel,
        rarityLabel: rarityLabel || '未知',
        // 色板按「档位」索引：tier 1=绿 … 4=金，与 `rarityRank` 顺序一致，0 号留给未知品级（灰）。
        rarityColorIndex: Math.max(0, Math.min(4, tier)),
        iconName: (card.headIcon ?? card.buildIcon ?? '').trim(),
        playable: !!unit && skills.length > 0,
        prefabSize: unit && Number.isFinite(unit.prefabSize) && unit.prefabSize > 0 ? unit.prefabSize : 1,
        unitPrefabPath: typeof card.unitPrefabPath === 'string' ? card.unitPrefabPath.trim() : '',
        attackRange: unit && Number.isFinite(unit.attackRange) && unit.attackRange > 0 ? unit.attackRange : 0,
        attackInterval: unit && Number.isFinite(unit.attackInterval) && unit.attackInterval > 0 ? unit.attackInterval : 0,
        definition: unit ?? null,
        stats,
        skills,
        issues: cardIssues,
    };
}
