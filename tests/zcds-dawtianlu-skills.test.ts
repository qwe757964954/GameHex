import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { buildZCClientCombatConfig } from '../assets/script/app/zcds/application/ZCClientCombatConfig';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { ZC_SELF_AURA_EFFECT_PREFAB_PATH } from '../assets/script/app/zcds/model/ZCSelfAuraFx';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';
import { withoutLineupCrit } from './helpers/lineup-crit';

/**
 * 大威天芦（68025）「天降神拳」（102504）落地：配表真值 + 强化那一击的运行期形态。
 *
 * 设计案原文：「向目标方向发射一个子弹类的攻击，该子弹移动速度 100px，持续 4 秒，
 * 根据等级对应最多伤害 5/7/9 个敌人，伤害分别是 300/500/700，每伤害 1 个敌人
 * 下个敌人受到伤害减少 50%」。
 *
 * 落到代码有三处「照字面写会静默失效」，这就是本用例要钉住的：
 *
 *  1. **「持续 4 秒」表达不了**。弹道寿命原来是 `距离 / 速度`，射程跟着目标远近变；
 *     大威天芦是近战（射程 45），强化那一击只会飞 0.45 秒。⇒ 新增
 *     `skillParamJson.projectileLifeSeconds`（`ZCAttackResolutionSystem` projectile 分支），
 *     并且**必须 `empowered` 才读**：计划行按 `unitId:pvpSkillId` 合并，102504 的参数
 *     和本卡普攻共用同一份 runtime，不设闸门会把普攻也改成 4 秒。
 *  2. **「5/7/9 个敌人」不等于 `pierceCount` 5/7/9**。`ZCPROJECTILE` 的循环是
 *     「命中 → 还有穿透次数就继续、否则消耗」，首目标不占穿透次数
 *     （玉林好汉「穿透 3 人」= pierceCount 3）。⇒ 要 5/7/9 个目标就得配 4/6/8。
 *  3. **300/500/700 是「普通伤害的百分比比率」**（2026-11-09 用户口径纠正）：
 *     `skillDamageRate` 乘的就是面板伤害，所以 `damageRate` 直接写 **3.0 / 5.0 / 7.0**。
 *     上一轮按「÷ 面板攻击 140」落成 2.14/3.57/5.00，已作废 —— 这是一条值得钉住的教训：
 *     设计案里的数字到底是「绝对值」还是「百分比」，必须先问清楚再换算。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare(): ZCMatchConfig {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('大威天芦：普攻换成自己的 30858，强化那一击是 30859「天降神拳」', () => {
    prepare();
    const skills = new Map(readRows('pvpSkill').map((row) => [Number(row.skillId), row]));

    const card = readRows('pvpCard').find((row) => Number(row.id) === 68025);
    assert.ok(card, '68025 必须在 pvpCard 里');
    assert.equal(Number(card!.unitSkillId), 30858,
        '必须换到自己的普攻行（原来借 30171 长枪兵普攻，改 30171 会连带改场上所有长枪兵）');

    const normal = skills.get(30858);
    assert.ok(normal, '30858 必须存在');
    assert.equal(normal!.mode, 'melee', '大威天芦本体是近战，普攻不出弹');
    assert.equal(normal!.trigger, 'every_n_attacks');
    assert.equal(Number(normal!.empoweredEvery), 8, '设计案「主动-累计普攻 8」');
    assert.equal(Number(normal!.empoweredSkillId), 30859);

    const fist = skills.get(30859);
    assert.ok(fist, '30859 必须存在');
    assert.equal(fist!.mode, 'projectile', '天降神拳是「子弹类的攻击」');
    assert.equal(Number(fist!.projectileSpeed), 100, '设计案「移动速度 100px」');
    assert.equal(fist!.effectPrefabPath,
        'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效', '表现描述「大拳飞冲」');
    // 强化行的 durationSeconds 是「命中后的持续区域」，不是弹道寿命 —— 留空才对。
    assert.equal(fist!.durationSeconds, null);
});

test('天降神拳：三档参数 = 300%/500%/700% 普通伤害，命中 5/7/9 人，每多一人 -50%', () => {
    prepare();
    const plans = withoutLineupCrit(readRows('pvpSkillPlan'))
        .filter((row) => String(row.unitId) === '68025');
    // 102501 / 192501 / 282501（蔓生连打三链）+ 102502（裂变暴击）+ 102503（无尘禁土）+ 102504（天降神拳），
    // 六条链 × 3 档 = 18 行。2026-11-10 删掉了 192502「裂变暴击·暴伤」那条（卡牌自身技能不再给暴击伤害），
    // 所以这里是 18 而不是原来的 21。
    // 68025 另有 50 行「全队暴击伤害增幅」（skillChainId 109001），不是这张卡的技能链，先剔掉。
    assert.equal(plans.length, 18, '六条链 × 3 档 = 18 行');

    // 18 行全部挂 30858：`sendAttack` 取运行时用的键是 `${unitId}:${profile.skillId}`，
    // 挂旧行 30171 会让参数进不去（校验器也会直接报错）。
    for (const row of plans) assert.equal(Number(row.pvpSkillId), 30858);

    const tiers = plans
        .filter((row) => Number(row.skillChainId) === 102504)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(tiers.length, 3, '102504 必须三档齐备');
    assert.deepEqual(tiers.map((row) => Number(row.unlockHeroLevel)), [0, 20, 25]);
    assert.deepEqual(tiers.map((row) => row.skillKind), ['active_attack', 'active_attack', 'active_attack']);

    const params = tiers.map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    //  2026-11-09 用户口径：300/500/700 是**普通伤害的百分比比率**，不再除面板攻击。
    assert.deepEqual(params.map((item) => item.damageRate), [3, 5, 7], '300% / 500% / 700% 普通伤害');
    assert.deepEqual(params.map((item) => item.pierceCount), [4, 6, 8], '首目标不占穿透次数 ⇒ 5/7/9 个目标');
    assert.deepEqual(params.map((item) => item.pierceFalloff), [0.5, 0.5, 0.5], '每多命中一人 -50%');
    //  2026-11-10 需求：「持续时间缩短 1 秒」⇒ 4 → 3（三档一起改；子弹大小走
    //  `ZCCombatEffectScale` 的 2.5 倍，不在表里）。
    assert.deepEqual(params.map((item) => item.projectileLifeSeconds), [3, 3, 3], '持续 3 秒');
});

test('天降神拳：升级描述与修改器引用（K 表）齐备', () => {
    const rows = readRows('armySkillLevelUp').filter((row) => Number(row.id) === 102504);
    assert.equal(rows.length, 3, '102504 三档');
    const byLevel = rows.sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
    assert.deepEqual(byLevel.map((row) => row.name), ['天降神拳', '天降神拳', '天降神拳']);
    assert.deepEqual(byLevel.map((row) => Number(row.unlockarmylevel)), [0, 20, 25]);
    // modfiy 由 pvpSkillPlan.modifierId 回填 —— 三档必须各自对上，否则卡牌详情页的
    // 「升级提升」列表读不到这一档。
    assert.deepEqual(byLevel.map((row) => (row.modfiy as number[])[0]), [94025041, 94025042, 94025043]);
    assert.ok(String(byLevel[2].desc).includes('700%'), 'III 级的描述要写成玩家看得懂的百分比');
});

// ── 二、计划行参数进运行时（68025 没有 pvpSkillBinding 行） ────────────────────

test('68025 没有 binding 行时，102504 的四条参数仍进得到 skillRuntime.parameters', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    assert.equal(readRows('pvpSkillBinding').some((row) => Number(row.pvpSkillId) === 30858), false,
        '前提变了：30858 现在有 binding 行，这条用例应改成走 merge 分支');

    const selected = withoutLineupCrit(selectZCSkillPlans('68025', 25, catalogs));
    // 全部 replace ⇒ 25 级每条「属性链」只留最高档。68025 现有 6 条链：
    // 102501/192501/282501（蔓生连打）+ 102502（裂变暴击）+ 102503（无尘禁土）+ 102504（天降神拳）。
    // 2026-11-10 删掉 192502「裂变暴击·暴伤」，所以是 6 条而不是 7 条。
    assert.equal(selected.length, 6, 'replace 语义下每条链只保留一档');
    assert.deepEqual(selected.map((row) => row.modifierId).sort(),
        [94025013, 94025023, 94025043, 94025053, 94925013, 95825013]);

    const loadout = compileZCCombatBuild({
        unitId: '68025', heroLevel: 25,
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');

    const runtime = compileZCMatchRuntime({
        ...config,
        ownerDecks: { [ZCOwner.Player]: [], [ZCOwner.Enemy]: [] },
        modifiers: { [ZCOwner.Player]: [loadout], [ZCOwner.Enemy]: [] },
    } as never);
    const skill = runtime.skillRuntime[ZCOwner.Player].get('68025:30858');
    assert.ok(skill, '68025:30858 必须建出运行时（否则 sendAttack 读不到任何参数）');
    assert.equal(skill!.parameters.damageRate, 7, 'III 级：700% 普通伤害');
    assert.equal(skill!.parameters.pierceCount, 8);
    assert.equal(skill!.parameters.pierceFalloff, 0.5);
    assert.equal(skill!.parameters.projectileLifeSeconds, 3, '2026-11-10：4 → 3 秒');
    // 同 key 的另一条链（102502 裂变暴击）的溅射参数不能被挤掉。
    assert.equal(skill!.parameters.splashDamageRate, 0.48);
    // 102503 无尘禁土的参数也并进同一份 runtime（`aura*` 与 `damageRate` 不撞键）。
    assert.equal(skill!.parameters.auraCooldown, 15);
    assert.equal(skill!.parameters.auraSeconds, 8, 'III 级持续 8 秒');
    assert.equal(skill!.parameters.auraRadius, 200, '2026-11-10：判定半径放大到 200 逻辑 px');
});

// ── 三、强化那一击的运行期形态 ────────────────────────────────────────────────

const ATTACK = 140;   // pvpCard 68025 的面板攻击

function buildMatch(): ZCMatchConfig {
    const captured = prepare();
    const catalogs = getZCModifierCatalogs();
    //  68025 没有 generalStar 行 ⇒ 不传星级（传了 compileZCGeneralStarLoadout 会抛）。
    const loadout = compileZCCombatBuild({
        unitId: '68025', heroLevel: 25,
    }, captured.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'))!;
    return {
        ...captured,
        rules: { ...captured.rules, combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000 },
        modifiers: { [ZCOwner.Player]: [loadout], [ZCOwner.Enemy]: [] },
        units: captured.units.map((definition) => (definition.unitId === '68025'
            ? { ...definition, attack: ATTACK, maxHp: 1000, moveSpeed: 0, bodyRadius: 4 }
            : { ...definition, maxHp: 1000, moveSpeed: 0 })),
    };
}

function makeUnit(unitId: string, id: number, owner: 'player' | 'enemy', x: number, y = 0): ZCUnitState {
    return {
        id, owner, unitId, cardId: owner === 'player' ? '68025' : '',
        tier: 1, sourceHexId: unitId === '' ? 0 : 1,
        // 血量给足：这条用例要连打 8 次，目标中途阵亡会让 `currentTarget` 变 null、计数不涨。
        targetHexId: null, progress: 0, hp: 100000, maxHp: 100000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 10000, waitUntil: 10000, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    } as ZCUnitState;
}

/** 打够 8 次出手，返回第 8 次（强化那一击）留下的弹道。 */
function attackUntilFist(config: ZCMatchConfig, targetX = 40) {
    const snapshot = ZCGameModel.createInitialState(() => .5, config);
    snapshot.units = [
        makeUnit('68025', 1, 'player', -80),
        makeUnit('68025', 2, 'enemy', targetX),
    ];
    snapshot.nextUnitId = 3;
    const model = new ZCGameModel(snapshot, () => .5, config);
    const source = (model as any).state.units[0] as ZCUnitState;
    source.targetUnitId = 2;
    const projectilesPerAttack: number[] = [];
    for (let index = 0; index < 8; index += 1) {
        (model as any).sendAttack(source);
        projectilesPerAttack.push(model.snapshot.projectiles.length);
    }
    return { model, projectilesPerAttack, projectiles: model.snapshot.projectiles };
}

test('前 7 次普攻不出弹，第 8 次打出 3 秒 / 穿透 8 次的重拳', () => {
    const config = buildMatch();
    const { projectiles, projectilesPerAttack } = attackUntilFist(config);

    assert.deepEqual(projectilesPerAttack.slice(0, 7), [0, 0, 0, 0, 0, 0, 0], '累计普攻未满 8 次不触发');
    assert.equal(projectiles.length, 1, '第 8 次出手必须是弹道');

    const fist = projectiles[0];
    assert.equal(fist.skillId, 30859);
    // 「持续 3 秒」（2026-11-10 由 4 缩 1 秒）：寿命不再由「到目标的距离 / 速度」决定
    // （120px / 100 = 1.2s）。
    assert.equal(fist.durationSeconds, 3);
    assert.ok(Math.abs(fist.velocityX - 100) < 1e-6, '弹速 100');
    assert.equal(fist.remainingPierces, 8, 'III 级：最多命中 9 个敌人 = 首目标 + 穿透 8 次');
    assert.equal(fist.pierceFalloff, 0.5, '每多命中一人伤害 -50%');
    // 140 × 7 = 980 是「面板 × 倍率」的裸值；实战还要过 `deckBonuses.unitAttackMultiplier`
    // （羁绊/成长）。这里钉「确实是 7 倍那一档」，不锁死羁绊那 8%，免得改羁绊就红。
    assert.ok(fist.baseDamage >= ATTACK * 7 && fist.baseDamage < ATTACK * 7 * 1.2,
        `III 级首击应 ≈980，实际 ${fist.baseDamage}`);
});

test('普攻那一发仍然是近战、不吃重拳参数（3 秒 / 穿透 8 次不外溢）', () => {
    const config = buildMatch();
    const snapshot = ZCGameModel.createInitialState(() => .5, config);
    snapshot.units = [
        makeUnit('68025', 1, 'player', -80),
        makeUnit('68025', 2, 'enemy', 40),
    ];
    snapshot.nextUnitId = 3;
    const model = new ZCGameModel(snapshot, () => .5, config);
    const source = (model as any).state.units[0] as ZCUnitState;
    source.targetUnitId = 2;
    (model as any).sendAttack(source);
    // 普攻是 melee ⇒ 一条弹道都不该有；短路在这里就证明 `projectileLifeSeconds`
    // 没有把近战那一发变成 3 秒的弹道。
    assert.equal(model.snapshot.projectiles.length, 0);
});

// ── 四、无尘禁土 102503（`self_aura`） ─────────────────────────────────────────

test('无尘禁土：三档 = 冷却 15 秒 / 持续 4·6·8 / 每秒 30·40·55%，III 级自身 +20%', () => {
    prepare();
    const tiers = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === 102503)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(tiers.length, 3, '102503 必须三档齐备');
    assert.deepEqual(tiers.map((row) => Number(row.unlockHeroLevel)), [9, 18, 24], '兵种 9 / 18 / 24 级解锁');
    assert.deepEqual(tiers.map((row) => row.skillKind), ['active_cd', 'active_cd', 'active_cd'], '主动-冷却');
    assert.deepEqual(tiers.map((row) => row.behaviorKey), ['self_aura', 'self_aura', 'self_aura']);
    // 必须挂 30858（该单位当前普攻行）：计划行的 `pvpSkillId` 与 `pvpCard.unitSkillId` 不一致时
    // 校验器直接报错，而且参数按 `unitId:pvpSkillId` 合并、挂错了就进不去 runtime。
    for (const row of tiers) assert.equal(Number(row.pvpSkillId), 30858);

    const params = tiers.map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(params.map((item) => item.auraCooldown), [15, 15, 15], '触发参数 15 秒');
    assert.deepEqual(params.map((item) => item.auraSeconds), [4, 6, 8]);
    assert.deepEqual(params.map((item) => item.auraInterval), [1, 1, 1], '「每秒」一跳');
    //  2026-11-10 需求：「判定范围和特效大小统一放大成 200px」⇒ 三档一起 60 → 200（逻辑 px）。
    assert.deepEqual(params.map((item) => item.auraRadius), [200, 200, 200], '判定半径 200 逻辑 px');
    assert.deepEqual(params.map((item) => item.auraDamageRate), [0.3, 0.4, 0.55]);
    // III 级才有「期间自身伤害提高 20%」⇒ I / II 级不许写这个键（写了就会白送 20%）。
    assert.deepEqual(params.map((item) => item.auraSelfDamagePct ?? 0), [0, 0, 20]);

    const kRows = readRows('armySkillLevelUp')
        .filter((row) => Number(row.id) === 102503)
        .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
    assert.deepEqual(kRows.map((row) => row.name), ['无尘禁土', '无尘禁土', '无尘禁土']);
    assert.deepEqual(kRows.map((row) => Number(row.unlockarmylevel)), [9, 18, 24]);
    assert.deepEqual(kRows.map((row) => (row.modfiy as number[])[0]), [94025051, 94025052, 94025053]);
});

test('无尘禁土：冷却 15 秒到点才在脚下开，8 秒后自动收，期间给本体挂 +20% 增伤', () => {
    const config = buildMatch();
    const snapshot = ZCGameModel.createInitialState(() => .5, config);
    snapshot.units = [
        makeUnit('68025', 1, 'player', -80),
        //  敌人在光环半径（200 × combatDistanceScale 1）之内，才能证明「每秒一跳」真的打到了人。
        makeUnit('68025', 2, 'enemy', -40),
    ];
    snapshot.nextUnitId = 3;
    const model = new ZCGameModel(snapshot, () => .5, config);
    const caster = (model as any).state.units[0] as ZCUnitState;
    caster.targetUnitId = 2;
    const enemy = (model as any).state.units[1] as ZCUnitState;
    const statusSystem = (model as any).statusSystem as { statModsOf(id: string): { damageRatePct?: number } };

    model.tick(0.1);
    assert.equal(typeof caster.auraReadyAt, 'number', '第一次推进只记下 readyAt');
    assert.equal(model.snapshot.groundZones.length, 0, '开局不立刻放');
    assert.equal(statusSystem.statModsOf('1').damageRatePct ?? 0, 0, 'CD 没到不挂增伤');

    //  走到光环开出来的那一拍（CD 15 秒；逐帧停，否则读到的是已经走了几秒的区域）
    for (let index = 0; index < 200 && !model.snapshot.groundZones.length; index += 1) model.tick(0.1);
    const zones = model.snapshot.groundZones;
    assert.equal(zones.length, 1, 'CD 到点必须开出一片区域（这一档只开一片，不是每帧一片）');
    assert.equal(zones[0].followUnitId, caster.id, '「跟随本体移动」= 记住本体，由区域系统每帧拍回坐标');
    assert.equal(zones[0].radius, 200, 'auraRadius 200 × combatDistanceScale 1');
    assert.ok(zones[0].remainingSeconds > 7.5 && zones[0].remainingSeconds <= 8, 'III 级持续 8 秒');
    assert.ok(model.snapshot.elapsedSeconds >= 15 && model.snapshot.elapsedSeconds < 16, '冷却 15 秒');
    assert.equal(zones[0].waveInterval, 1, '每秒一波');
    assert.equal(zones[0].effectPrefabPath, 'units/projectiles/持续光环伤害效果/持续光环伤害效果');
    assert.equal(statusSystem.statModsOf('1').damageRatePct, 20, 'III 级「期间自身伤害提高 20%」');
    assert.ok(zones[0].damage > 0, '每一波都要有伤害（倍率 0.55 × 面板）');

    //  8 秒到期自动收；此时还没到下一个 15 秒 CD，所以不会再生出第二片。
    //  「每秒打到谁」在 `zcds-ground-zone-system.test.ts` 里按区域系统直接钉
    //  （这条链路要 `hexIdAt` 落在真实格子上，模型级用例摆的坐标不一定在图内）。
    const hpBefore = enemy.hp;
    for (let index = 0; index < 90; index += 1) model.tick(0.1);
    assert.equal(model.snapshot.groundZones.length, 0, '到期必须收掉');
    assert.equal(statusSystem.statModsOf('1').damageRatePct ?? 0, 0, '增伤与光环同时到期');
    assert.ok(enemy.hp <= hpBefore, '光环不该给敌人回血');
    assert.ok(model.snapshot.elapsedSeconds < 30, '还没到下一个 CD，不该有第二片');
});

test('无尘禁土：光环特效路径进得了本局加载清单，没带这条行为就不加载', () => {
    //  `self_aura` 的光柱路径只登记在 `ZCSelfAuraFx` 的代码常量里（行为技能在 `pvpSkill`
    //  里没有造型槽）⇒ 不进 `buildZCVisualResourcePlan` 的清单就**不会被打包加载**，
    //  运行时 `effectVisualPrefabs.get()` 返回 null，表现为「每秒照常扣血、屏幕一次都不亮」。
    const unit = (unitId: string) => ({
        unitId,
        prefabPath: `units/${unitId}/${unitId}`,
        attackProfile: { effectPrefabPath: `units/projectiles/${unitId}_普攻/${unitId}_普攻` },
    });
    const adapters = {
        skillPlans: [
            { enabled: true, unitId: '68025', behaviorKey: 'self_aura' },
            { enabled: false, unitId: '68099', behaviorKey: 'self_aura' },
        ],
        textOverrides: new Map(),
    };

    const withAura = buildZCVisualResourcePlan([unit('68025')] as never, adapters as never);
    assert.ok(withAura.effectPaths.includes(ZC_SELF_AURA_EFFECT_PREFAB_PATH),
        '带无尘禁土的局必须加载这条光柱');

    const withoutAura = buildZCVisualResourcePlan([unit('68026')] as never, adapters as never);
    assert.equal(withoutAura.effectPaths.includes(ZC_SELF_AURA_EFFECT_PREFAB_PATH), false,
        '没带这条行为的兵不该吃这份加载');
    assert.equal(withoutAura.effectPaths.includes('units/projectiles/68099_普攻/68099_普攻'), false,
        'enabled=false 的计划不参与');
});

// ── 五、正式客户端构筑路径（2026-11-10 断点回归） ─────────────────────────────

/**
 * 「技能一个都不放」的根因回归：**没有 `generalStar` 行的卡，正式构筑路径会把整份技能计划丢掉**。
 *
 * `compileOwnerLoadouts` 原来的写法是「只有 `hasGeneral` 才传 `heroLevel`」，
 * 而 `compileZCCombatBuild` 只在 `heroLevel != null` 时才去编 `pvpSkillPlan`
 * ⇒ 68015~68035 这一批没有星级表行的卡，`skillRuntime` 里连 `${unitId}:30858}` 都没有，
 * `self_aura` 读不到 `auraCooldown`，战场上一片光环都不会出现、且不报任何错。
 *
 * 卡牌星级（`generalStar`）与技能解锁等级（`pvpSkillPlan.unlockHeroLevel`）是两张表，
 * 不能因为前者缺行就把后者一起丢掉 —— 这就是本用例要钉住的不变量。
 */
test('68025 没有 generalStar 行，正式构筑路径也必须编出技能计划', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    assert.equal(catalogs.generalStars.has('68025:1'), false,
        '前提变了：68025 现在有星级行，这条用例要改成换一张没星级行的卡来钉');

    const battle = {
        battleId: 'regression', seed: '1', version: '1',
        units: [
            {
                campId: 1, unitId: 101, roleId: 'self', serverId: 1, name: 'me', power: 1,
                avatarId: '', headFrameId: '', gradeId: 0, gradeScore: 0,
                heroIds: [68025], heroes: [{ heroId: 68025, level: 24 }],
                heroAttrs: [], buffs: [],
            },
            {
                campId: 2, unitId: 102, roleId: 'enemy', serverId: 2, name: 'enemy', power: 1,
                avatarId: '', headFrameId: '', gradeId: 0, gradeScore: 0,
                heroIds: [], heroes: [], heroAttrs: [], buffs: [],
            },
        ],
    };
    const result = buildZCClientCombatConfig(config, battle as never, 'self');
    const loadouts = result.config.modifiers?.[ZCOwner.Player] ?? [];
    assert.ok(loadouts.some((item) => item.targetUnitId === '68025' && item.sourceKey.startsWith('skillPlan:')),
        `68025 必须拿到 skillPlan loadout（实际：${loadouts.map((item) => item.sourceKey).join(' , ') || '空'}）`);

    const runtime = compileZCMatchRuntime(result.config as never)
        .skillRuntime[ZCOwner.Player].get('68025:30858');
    assert.ok(runtime, '68025:30858 运行时必须建出来');
    assert.equal(runtime!.parameters.auraCooldown, 15, '无尘禁土的触发冷却必须进得去（24 级已解锁）');
    assert.equal(runtime!.parameters.damageRate, 5, '24 级：天降神拳 II 级 500%');
});

// ── 六、成长表（`pvpUnitGrowth`）── 2026-11-10 改由 cardLevelUp 反推 ─────────────

/**
 * 68025 原来在 `pvpUnitGrowth` 里**一行都没有** ⇒ 兵种等级只解锁技能，一点属性都不加。
 *
 * 一度按 `技能设计案2.xlsx / 伤害参数` 补过「`attackRate = 0.08 × L`」（B3 每级成长率 8%，
 * L1 = 1.08 … L25 = 3.00）。2026-11-10 用户拍板改成**全量对齐 `cardLevelUp`**、比例列一律归 0
 * ⇒ 那条 8% 曲线作废，68025 的成长改由卡牌升级表接管：`attackFlat = attack(L) − attack(1)`。
 *
 * 这条用例钉两件事：曲线来源（`cardLevelUp`）与「接进构筑不是空转」。
 */
test('成长表补齐：68025 的 1~50 级按 cardLevelUp 反推，且真的进得来运行时', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const rows = readRows('pvpUnitGrowth').filter((row) => String(row.unitId) === '68025');
    assert.equal(rows.length, 50, '卡牌上限 50 级 ⇒ 成长行必须 1~50 级齐备');
    const levelUp = (level: number) => {
        const row = readRows('cardLevelUp').find((item) => String(item.id) === '68025'
            && Number(item.level) === level);
        const attr = (row?.attrList as Array<{ statId: string; value: number }> | undefined)
            ?.find((item) => item.statId === 'attack');
        return Number(attr?.value ?? 0);
    };
    const base = levelUp(1);
    const byLevel = new Map(rows.map((row) => [Number(row.level), row]));
    assert.equal(Number(byLevel.get(1)!.attackFlat), 0, 'L1 归零（单位基础值就等于卡牌 1 级）');
    assert.equal(Number(byLevel.get(25)!.attackFlat), levelUp(25) - base, 'L25 = 1430 − 140 = 1290');
    assert.equal(Number(byLevel.get(50)!.attackFlat), levelUp(50) - base, 'L50 = 5072 − 140 = 4932');
    //  比例列全 0：原来那条 8%/级 已被 cardLevelUp 取代，别两套口径混着来。
    for (const row of rows) {
        for (const column of ['attackRate', 'maxHpRate', 'moveSpeedRate', 'attackRangeFlat']) {
            assert.equal(Number(row[column]), 0, `${row.level} 级 ${column} 应为 0`);
        }
    }

    //  接进构筑：25 级与 50 级都要既有成长也有技能（两条 loadout 都要出）。
    for (const level of [25, 50]) {
        const loadouts = compileZCCombatBuild({ unitId: '68025', level, heroLevel: level },
            config.units, catalogs);
        const growth = loadouts.find((item) => item.sourceKey === `growth:68025:${level}`);
        assert.ok(growth, `${level} 级必须编出成长 loadout（实际：${loadouts.map((item) => item.sourceKey).join(' , ')}）`);
        //  2026-11-10 起攻击走 `add`（绝对值）而不是 `addRate`（比例）。
        const flat = growth!.typedModifiers.find((item) => item.statId === 'attack' && item.operation === 'add');
        assert.ok(flat, '攻击成长必须以 add 落进 unit 域');
        assert.equal(flat!.value, levelUp(level) - base, `${level} 级攻击 +${levelUp(level) - base}`);
        assert.ok(loadouts.some((item) => item.sourceKey.startsWith('skillPlan:')), '技能计划不该被成长挤掉');
    }
});

// ── 五、尺寸口径：判定与特效必须同尺寸（2026-11-10） ────────────────────────────

/**
 * 需求：「无尘禁土的技能判定范围和特效大小统一放大成 200px」「天降神拳子弹大小改大 2.5 倍」。
 *
 * 这条钉的是**两条数的一致性**，不是某个魔数：
 *   · 判定 —— `pvpSkillPlan.auraRadius`（逻辑 px）；
 *   · 视觉 —— `ZCCombatEffectScale` 的宿主倍率 × 预制体自带的可见宽。
 * 只改一边的后果是「看着大、打不到」（或反过来），本项目已经因为这类事返工过两次
 * （椰蛋战士·暴风、三叶小丑·飓风），所以这里按屏上 px 做交叉校验。
 */
test('无尘禁土 200px：判定半径与光柱视觉同尺寸；天降神拳子弹 ×2.5', () => {
    //  项目统一换算（docs §1.11，同 `镭射飞龙_导弹技能命中` 那条注释）：
    //  屏上 px = 逻辑 px × combatDistanceScale(0.3) × view/logical(2.5625)。
    const LOGIC_TO_SCREEN = 0.3 * 2.5625;
    const AURA_SKILL = ZC_SELF_AURA_EFFECT_PREFAB_PATH;
    const FIST = 'units/projectiles/大拳飞冲子弹类特效/大拳飞冲子弹类特效';

    // ① 判定：三档都必须是 200 逻辑 px
    const tiers = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === 102503)
        .map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    for (const params of tiers) {
        assert.equal(params.auraRadius, 200, '判定半径 200 逻辑 px');
    }
    const judgeDiameter = 200 * LOGIC_TO_SCREEN * 2;   // 307.5 屏上 px

    // ② 视觉：光柱 prefab 子节点 `offset` 烘焙 0.58、画布 256 ⇒ 可见宽 148.48 × 宿主倍率
    const auraVisible = 256 * 0.58;
    const auraScreen = auraVisible * zcCombatEffectNodeScaleOf(AURA_SKILL);
    assert.ok(Math.abs(auraScreen - judgeDiameter) / judgeDiameter < 0.005,
        `光柱屏上宽 ${auraScreen.toFixed(1)}px 必须贴近判定直径 ${judgeDiameter.toFixed(1)}px`
        + `（宿主倍率 ${zcCombatEffectNodeScaleOf(AURA_SKILL).toFixed(3)}）`);

    // ③ 拳体子弹：原 256×128 画布 + 0.6 烘焙 ⇒ 153.6 屏上；乘 2.5 后 384
    assert.equal(zcCombatEffectNodeScaleOf(FIST), 2.5, '子弹宿主倍率 2.5');
    assert.ok(Math.abs(256 * 0.6 * 2.5 - 384) < 1e-9);
});
