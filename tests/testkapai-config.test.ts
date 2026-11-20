import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckCard, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCRuntimeRules } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    buildZCTestKapaiCatalog, damageOfSkill, factorsOfSkill, parseZCTestKapaiConfig,
} from '../assets/script/app/zcds/model/ZCTestKapaiModel';
import type { IZCRuntimeCatalogs } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { ZCCombatSystem } from '../assets/script/app/zcds/model/systems/ZCCombatSystem';

const rules = {
    unitAttackPerTier: 0.16,
    combatDamageMultiplier: 1.2,
} as ZCRuntimeRules;

function attack(over: Partial<ZCAttackProfile> = {}): ZCAttackProfile {
    return { skillId: 1, name: '普攻', mode: 'melee', ...over } as ZCAttackProfile;
}

function unit(over: Partial<ZCUnitDefinition> = {}): ZCUnitDefinition {
    return {
        unitId: '68001',
        name: '测试兵',
        maxHp: 40,
        attack: 12,
        moveSpeed: 28,
        attackRange: 260,
        attackInterval: 2,
        attackDuration: 0.7,
        attackHitTime: 0.3,
        bodyRadius: 26,
        spawnSeconds: 10,
        flying: false,
        canAttackAir: false,
        hero: true,
        prefabPath: 'skel/demo/demo',
        prefabSize: 0.8,
        attackProfile: attack({ skillId: 30701 }),
        ...over,
    } as ZCUnitDefinition;
}

function card(over: Partial<ZCDeckCard> = {}): ZCDeckCard & { enabled: boolean } {
    return {
        id: '68001',
        name: '测试兵',
        type: 2,
        rarity: 'green',
        unitId: '68001',
        baseHp: 120,
        cycleSeconds: 10,
        cycleBaseValue: 2,
        enabled: true,
        ...over,
    } as ZCDeckCard & { enabled: boolean };
}

function catalogsOf(cards: (ZCDeckCard & { enabled: boolean })[], units: ZCUnitDefinition[]): IZCRuntimeCatalogs {
    return {
        cards,
        units: new Map(units.map((entry) => [entry.unitId, entry])),
        rules,
    } as IZCRuntimeCatalogs;
}

/* ------------------------------------------------------------------ *
 * 配置（舞台与调试参数；版式归场景）
 * ------------------------------------------------------------------ */

test('仓库里的 testkapai.json 能完整解析，且舞台倍率 / 调色板 / 调试默认值齐全', () => {
    const raw = JSON.parse(readFileSync('assets/resources/config/testkapai.json', 'utf8'));
    const { config, issues } = parseZCTestKapaiConfig(raw);
    assert.deepEqual(issues, []);
    // 视图默认 2 倍看清细节，但必须保留 1.0 档核对战场 1:1。
    assert.equal(config.stage.viewScale, 2);
    assert.equal(config.stage.scaleOptions.includes(1), true);
    assert.equal(config.stage.targetOffsetX - config.stage.unitOffsetX > 0, true);
    assert.equal(config.damageTest.targetMaxHp, 1200);
    assert.equal(config.debug.damageRate, 1);
    assert.equal(config.palette.accent.startsWith('#'), true);
});

test('配置缺字段 / 类型不对时给出可定位的诊断，而不是静默取默认值', () => {
    const broken = {
        stage: {
            viewScale: 0,
            scaleOptions: [2, 4.2],
            groundOffsetY: 0,
            unitOffsetX: 10,
            targetOffsetX: 10,
            effectOffsetY: 0,
            gridColor: 'not-a-color',
            gridFillColor: '#111A28D9',
            guideColor: '#6E8299',
            loadingColor: '#8FA6C0',
            errorColor: '#FF7A7A',
        },
        palette: {},
        debug: {},
        damageTest: { targetMaxHp: -1, targetName: '' },
    };
    const { issues } = parseZCTestKapaiConfig(broken);
    const scopes = issues.map((issue) => issue.scope);
    assert.equal(issues.every((issue) => issue.level === 'error'), true);
    assert.equal(scopes.some((scope) => scope.includes('stage.viewScale')), true);
    assert.equal(scopes.some((scope) => scope.includes('stage.scaleOptions')), true);
    assert.equal(scopes.some((scope) => scope.includes('palette.background')), true);
    assert.equal(scopes.some((scope) => scope.includes('palette.accent')), true);
    assert.equal(scopes.some((scope) => scope.includes('damageTest.targetName')), true);
    assert.equal(scopes.some((scope) => scope.includes('debug.damageRate')), true);
    // 模型与靶子放在同一点，画面上会直接叠住，属于配置错误。
    assert.equal(scopes.some((scope) => scope === '配置 / stage'), true);
});

test('视图倍率列表必须保留 1.0，且非法档位要点名下标', () => {
    const raw = JSON.parse(readFileSync('assets/resources/config/testkapai.json', 'utf8'));
    raw.stage.scaleOptions = [2, 'x'];
    const { issues: missingOne } = parseZCTestKapaiConfig(raw);
    assert.equal(missingOne.some((issue) => issue.detail.includes('缺少 1.0')), true);

    const invalid = JSON.parse(readFileSync('assets/resources/config/testkapai.json', 'utf8'));
    invalid.stage.scaleOptions = [1, 'x'];
    const { issues: badEntry } = parseZCTestKapaiConfig(invalid);
    assert.equal(badEntry.some((issue) => issue.scope === '配置 / stage.scaleOptions[1]'), true);
});

/* ------------------------------------------------------------------ *
 * 数值与技能门槛
 * ------------------------------------------------------------------ */

test('技能伤害直接复用 ZCCombatSystem.unitDamage，不另立公式', () => {
    const definition = unit({ attack: 130 });
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ rarity: 'gold' })], [definition]));
    const skill = catalog.cards[0].skills[0];
    const expected = ZCCombatSystem.unitDamage({ tier: 4, neutralReinforcement: false }, definition, {
        activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
        towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
    }, 1, rules, 1);
    assert.equal(skill.damage, expected);
    // 金卡 tier=4：130 × (1+3×0.16) × 1.2 = 130 × 1.48 × 1.2 = 230.88 → round 231
    assert.equal(skill.damage, 231);
});

test('伤害明细的乘数复算回原值；调试 ×2 必须正好翻倍', () => {
    const definition = unit({ attack: 130, attackProfile: attack({ skillId: 30701, damageRate: 1.5 }) });
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ rarity: 'gold' })], [definition]));
    const skill = catalog.cards[0].skills[0];
    const factors = factorsOfSkill(skill, 1);
    assert.equal(Math.round(factors.attack * factors.tier * factors.counter * factors.global * factors.skillRate), skill.damage);
    const expectedDouble = ZCCombatSystem.unitDamage({ tier: 4, neutralReinforcement: false }, definition, {
        activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
        towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
    }, 1, rules, skill.damageRate * 2);
    assert.equal(damageOfSkill(skill, definition, rules, 2), expectedDouble);
    // 倍率翻倍后只允许取整带来的 ±1 差，不允许公式漂移。
    assert.equal(Math.abs(expectedDouble - skill.damage * 2) <= 1, true);
    assert.equal(factorsOfSkill(skill, 2).skillRate, skill.damageRate * 2);
});

test('普攻节拍取 pvpCard.unitAttackInterval，而不是 pvpSkill.cooldown', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf(
        [card()],
        [unit({ attackInterval: 1.8, attackProfile: attack({ skillId: 30701, cooldown: 15 }) })],
    ));
    const basic = catalog.cards[0].skills[0];
    assert.equal(basic.kind, 'basic');
    assert.equal(basic.cooldownSeconds, 1.8);
});

test('按次数触发的强化技：门槛取自普攻行的 empoweredEvery', () => {
    const definition = unit({
        attackProfile: attack({
            skillId: 30704,
            trigger: 'every_n_attacks',
            empoweredEvery: 5,
            empoweredSkillId: 30847,
        }),
        empoweredProfile: attack({ skillId: 30847, name: '强化一击', damageRate: 2.4 }),
    });
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card()], [definition]));
    const empowered = catalog.cards[0].skills.find((skill) => skill.kind === 'empowered');
    assert.equal(!!empowered, true);
    assert.equal(empowered!.attacksRequired, 5);
    assert.equal(empowered!.cooldownSeconds, 0);
    assert.equal(empowered!.damageRate, 2.4);
});

test('按时间触发的强化技：用普攻行的 cooldown 当冷却，不再套 empoweredEvery', () => {
    const definition = unit({
        attackProfile: attack({
            skillId: 30701,
            trigger: 'every_seconds',
            cooldown: 15,
            empoweredEvery: 12,
            empoweredSkillId: 30801,
        }),
        empoweredProfile: attack({ skillId: 30801, name: '机关枪', damageRate: 0.8 }),
    });
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card()], [definition]));
    const empowered = catalog.cards[0].skills.find((skill) => skill.kind === 'empowered');
    assert.equal(!!empowered, true);
    assert.equal(empowered!.attacksRequired, 0);
    assert.equal(empowered!.cooldownSeconds, 15);
});

test('建筑卡默认不进切换列表：主城 / 金矿按 type 过滤，并统计隐藏数量', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([
        card({ id: '2002', name: '主城', type: 5, rarity: 'green', unitId: undefined }),
        card({ id: '2001', name: '金矿', type: 1, rarity: 'green', unitId: undefined }),
        card({ id: '68001' }),
    ], [unit()]));
    assert.deepEqual(catalog.cards.map((entry) => entry.id), ['68001']);
    assert.equal(catalog.hiddenCount, 2);
    assert.deepEqual(catalog.issues, []);
});

test('建筑卡显式纳入时才展示建筑数值行（用例 / 调试用）', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([
        card({ id: '2002', name: '主城', type: 5, rarity: 'green', unitId: undefined, baseHp: 1500, cycleSeconds: 6, buildDigGoldNum: 10, cyclePerTierValue: 4 }),
    ], []), { includeBuildings: true });
    const hq = catalog.cards[0];
    assert.equal(hq.skills.length, 0);
    assert.equal(hq.playable, false);
    assert.deepEqual(hq.stats.map((stat) => stat.label), ['建筑耐久', '产金周期', '每次产金', '每品级耐久']);
    assert.deepEqual(hq.stats.map((stat) => stat.source), [
        'pvpCard.baseHp', 'pvpCard.goldDigTime', 'pvpCard.buildDigGoldNum', 'pvpCard.cyclePerTierValue',
    ]);
});

test('兵营卡 unitId 配错时必须留在列表里报错，不能像建筑卡一样被过滤掉', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ unitId: '99999' })], []));
    assert.equal(catalog.cards.length, 1);
    assert.equal(catalog.hiddenCount, 0);
    assert.equal(catalog.cards[0].issues.some((issue) => issue.scope.includes('pvpCard.unitId')), true);
});

/* ------------------------------------------------------------------ *
 * 配置缺失 / 字段异常的可读诊断
 * ------------------------------------------------------------------ */

test('兵营卡的 unitId 在兵种目录里找不到时，诊断点名是哪张卡哪个字段', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ unitId: '99999' })], []));
    const detail = catalog.cards[0].issues.map((issue) => `${issue.scope}|${issue.detail}`).join('\n');
    assert.equal(detail.includes('pvpCard.unitId'), true);
    assert.equal(detail.includes('99999'), true);
});

test('兵营卡缺 unitId 时同样指名报错，而不是显示成"无技能的空卡"', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ unitId: undefined })], []));
    const detail = catalog.cards[0].issues.map((issue) => issue.detail).join('\n');
    assert.equal(detail.includes('没有 unitId'), true);
});

test('runtime rules 缺失时整份目录不可用，并给出根因', () => {
    const catalog = buildZCTestKapaiCatalog({ cards: [], units: new Map(), rules: undefined } as unknown as IZCRuntimeCatalogs);
    assert.equal(catalog.cards.length, 0);
    assert.equal(catalog.issues.some((issue) => issue.scope === '运行时配置' && issue.detail.includes('rules')), true);
});

test('rarity 非法时按最低档取色并留提示，不静默变色', () => {
    const definition = unit();
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card({ rarity: 'unknown' })], [definition]));
    const entry = catalog.cards[0];
    assert.equal(entry.rarityLabel, '未知');
    assert.equal(entry.rarityColorIndex, 1);
    assert.equal(entry.issues.some((issue) => issue.scope.includes('pvpCard.rarity')), true);
});

/* ------------------------------------------------------------------ *
 * 舞台素材路径（模型与特效都必须能追到配置列）
 * ------------------------------------------------------------------ */

test('卡牌带上 unitPrefabPath，舞台按它加载 spine 模型', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf(
        [card({ unitPrefabPath: 'skel/豌豆射手/豌豆射手' })],
        [unit()],
    ));
    assert.equal(catalog.cards[0].unitPrefabPath, 'skel/豌豆射手/豌豆射手');
});

test('技能带上 effectPrefabPath，舞台按它播放 `pvpSkill.effectPrefabPath` 特效', () => {
    const definition = unit({
        attackProfile: attack({
            skillId: 30701,
            effectPrefabPath: 'units/projectiles/豌豆游侠_普攻/豌豆游侠_普攻',
        }),
    });
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card()], [definition]));
    assert.equal(
        catalog.cards[0].skills[0].effectPrefabPath,
        'units/projectiles/豌豆游侠_普攻/豌豆游侠_普攻',
    );
});

test('技能没登记特效时留空串，调用方据此提示「仅演示数值」而不是静默不播', () => {
    const catalog = buildZCTestKapaiCatalog(catalogsOf([card()], [unit()]));
    assert.equal(catalog.cards[0].skills[0].effectPrefabPath, '');
});
