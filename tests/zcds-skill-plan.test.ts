import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs, parseZCModifierCatalogs, selectZCSkillPlans } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZC_MISSILE_DEBUG_HERO_LEVEL } from '../assets/script/app/zcds/ZCMissileSkillDiagnostics';
import { assetPath } from './helpers/asset-paths';
import { withoutLineupCrit } from './helpers/lineup-crit';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare() {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

test('技能 Range / All 通过现有参数袋编译，非法枚举在配置边界报错', () => {
    const config = prepare();
    const row = {
        enabled: 1, modifierId: 99000003, unitId: '68001', skillChainId: 100101, skillLevel: 1,
        unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30701,
        skillParamJson: '{"secondaryTargetMode":1,"strikeTargetMode":2}',
    };
    const catalogs = parseZCModifierCatalogs([], [], { pvpSkillPlan: [row] });
    const selected = selectZCSkillPlans('68001', 1, catalogs);
    assert.deepEqual(selected[0].skillParams, { secondaryTargetMode: 1, strikeTargetMode: 2 });
    assert.ok(compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, config.units, catalogs).length > 0);
    for (const value of [0, 3, -1, 1.5]) {
        assert.throws(() => parseZCModifierCatalogs([], [], {
            pvpSkillPlan: [{ ...row, skillParamJson: JSON.stringify({ secondaryTargetMode: value }) }],
        }), /Range\(1\).*All\(2\)/);
    }
});

test('英雄等级自动选择 accumulate/replace 技能升级档并编译被动属性', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const selected = withoutLineupCrit(selectZCSkillPlans('68001', 30, catalogs));
    //  100101「超视孢子」自 2026-11-16 起改成 `replace` 三档递进 14/18/24%：
    //  只取命中的最高档（91001013）。此前是 accumulate 三档同值 10%，会一次性选中三行。
    //  解锁等级自 2026-11-17 统一为「技能1 3/10/22、技能2 6/16/26、技能3 9/18/27、
    //  技能4 12/24/36」⇒ 要三条成长技能全到 III 档需 ≥27 级（100104 的 III 要 36，
    //  所以它停在 II）。这里取 30 级，正是「四格同时接近满档」的典型档位。
    assert.deepEqual(selected.map((row) => row.modifierId), [
        91001013,
        91001023,
        91001033,
        91001042,
    ]);
    const currentSkillId = config.units.find((item) => item.unitId === '68001')?.attackProfile?.skillId;
    assert.ok(currentSkillId);
    assert.ok(selected.every((row) => row.pvpSkillId === currentSkillId));

    const loadouts = compileZCCombatBuild({
        unitId: '68001', heroLevel: 30, generalStar: { generalId: 68001, star: 1 },
    }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    assert.equal(plan.typedModifiers.filter((item) => item.statId === 'attackRange').length, 1);
    //  100103 自 2026-11-17 起是「异种猎杀协议」（对蘑菇阵营增伤 + 暴击率 6%），不再加攻击，
    //  也不再挂 `hunger_slow_*` 减速状态 ⇒ 攻击只剩 100102 的那一条。
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'attack').map((item) => item.value),
        [0.12],
    );
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'counterCamp2').map((item) => item.value),
        [13],
        '对蘑菇阵营（ZC_CAMP_TRAITS 第 2 位）+13%',
    );
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'critRate').map((item) => item.value),
        [6],
    );
    //  换机制时旧状态必须一起摘掉：100103 以前挂 `hunger_slow_l3`（命中减速 2 秒），
    //  现在是纯数值被动，行上不该再有 statusId。`pvpStatus` 表里那条定义还在（别硬删），
    //  所以这里断言的是「计划行不再引用它」，不是「表里没有它」。
    assert.equal(selected.find((row) => row.skillChainId === 100103)?.statusId, undefined);
});

test('未达到解锁等级时不提前下发技能计划', () => {
    prepare();
    //  68001 的技能链首档要 3 级；「全队暴击伤害增幅」（109001）从 1 级起就按级累加，
    //  不属这条用例的语义，先剔掉。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68001', 2)), []);
});

test('首档要解锁等级，未到等级不下发；到档才逐格推进', () => {
    prepare();
    const catalogs = getZCModifierCatalogs();
    // 解锁等级自 2026-11-17 统一后，101301（槽 1）首档要 3 级、101302（槽 2）首档要 6 级，
    // 全表已经没有 unlock=0 的技能档 ⇒ 1 级一个技能都拿不到。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 1, catalogs)).map((row) => row.modifierId), []);
    // 14 级：101301 够 II 档（10），101302 还停在 L1（它的 II 档要 16），
    // 101303「孢爆箭」首档 9 级、II 档 18 ⇒ 停在 L1（2026-11-17 第 12 批落地）；
    // 101304「连射导弹」首档 12 级、II 档 24 ⇒ 也停在 L1（2026-11-18 第 16 批落地，
    // 它此前只有 K 表占位行，本批才进 J 表 ⇒ 这张期望表必须同步多一格）。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 14, catalogs)).map((row) => row.modifierId), [
        94013012, 94013021, 94013031, 94013041,
    ]);
    // 16 级：101302 也进 II 档（101304 仍停在 L1，它的 II 档要 24）。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 16, catalogs)).map((row) => row.modifierId), [
        94013012, 94013022, 94013031, 94013041,
    ]);
});


test('skillParamJson 的 mix.<statId> 编译成第二条单位属性（同条混搭）', () => {
    const config = prepare();
    const catalogs = parseZCModifierCatalogs([], [], {
        pvpSkillPlan: [{
            enabled: 1, modifierId: 99000001, unitId: '68001', skillChainId: 100101, skillLevel: 1,
            unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30701,
            statId: 'attack', operation: 'addRate', value: 0.14,
            skillParamJson: '{"mix.critRate.add":4,"mix.maxHp.addRate":0.06}',
        }],
    });
    const loadouts = compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    const mixed = new Map(plan.typedModifiers
        .filter((item) => item.sourceId === 99000001)
        .map((item) => [item.statId, item]));
    assert.equal(mixed.get('attack')?.value, 0.14, '主属性仍走 statId 那一格');
    assert.equal(mixed.get('critRate')?.operation, 'add', 'mix.<statId> 缺省 add');
    assert.equal(mixed.get('critRate')?.value, 4);
    assert.equal(mixed.get('maxHp')?.operation, 'addRate');
    assert.equal(mixed.get('maxHp')?.value, 0.06);
});

test('mix 键写错 statId 时直接抛错，不静默忽略', () => {
    const config = prepare();
    assert.throws(() => {
        const catalogs = parseZCModifierCatalogs([], [], {
            pvpSkillPlan: [{
                enabled: 1, modifierId: 99000002, unitId: '68001', skillChainId: 100101, skillLevel: 1,
                unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30701,
                skillParamJson: '{"mix.attackPct":10}',
            }],
        });
        compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, config.units, catalogs);
    }, /混搭/);
});

//  ── 武将技解锁门控（2026-11-19） ─────────────────────────────────────────────
//  用户口径：「所有的卡牌角色没有达到技能解锁以前，都不能释放技能」。
//  施放与否只看基表 `pvpSkill.empoweredEvery` / `empoweredSkillId`，与等级完全无关；
//  「几级解锁」只写在 `pvpSkillPlan` 上 ⇒ 没解锁的技能照样放，缺的只是参数。
//  规则：主链（`100000~109999`）里只要还有一条没解锁，这个单位的强化那一击就不许放。
//  实测依据：每卡最后一条主链是 `100x04`（解锁 12/24/36），它的参数正是那个武将技的行为参数。

/** 主链 id 区间，与 `ZCModifierRuntime.ZC_MAIN_CHAIN_*` 同口径 —— 这里从原始表独立算一遍。 */
function mainChainRows(unitId: string): Array<Record<string, unknown>> {
    return readRows('pvpSkillPlan').filter((row) => {
        const chainId = Number(row.skillChainId);
        return String(row.unitId) === unitId && Number(row.enabled) === 1
            && chainId >= 100000 && chainId < 110000;
    });
}

test('武将技解锁门控：全表每张卡的「强化那一击」都按主链解锁情况开关', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const units = new Set(config.units.map((unit) => unit.unitId));
    const cards = readRows('pvpCard').filter((row) => Number(row.enabled) === 1 && units.has(String(row.id)));
    assert.ok(cards.length > 20, `样本太少（${cards.length} 张），先确认配表加载成功`);

    let checked = 0;
    for (const card of cards) {
        const unitId = String(card.id);
        //  68010 镭射飞龙被 `ZC_MISSILE_DEBUG_HERO_LEVEL`（当前 24）抬高了技能计划筛选等级，
        //  低等级也会按 24 级编 ⇒ 门控结果与真实等级不符。这是调试开关的已知副作用，不是门控的漏洞；
        //  开关改回 0（上线前必做）之后本用例自动覆盖它，所以这里按开关值跳过而不是写死跳过。
        if (unitId === '68010' && ZC_MISSILE_DEBUG_HERO_LEVEL > 0) continue;
        const rows = mainChainRows(unitId);
        if (!rows.length) continue;
        for (const level of [1, 3, 6, 9, 12, 24, 36, 50]) {
            const loadout = compileZCCombatBuild({ unitId, heroLevel: level }, config.units, catalogs)
                .find((item) => item.empoweredBagKey);
            if (!loadout) continue;
            //  `replace` 模式按「链里最高已解锁档」生效 ⇒ 一条链只看它**最低**那档的解锁等级。
            //  按行比会把 `100101@22` 当成「22 级才解锁」，误判 12 级也该锁。
            const firstUnlock = new Map<number, number>();
            for (const row of rows) {
                const chainId = Number(row.skillChainId);
                const unlock = Number(row.unlockHeroLevel);
                const current = firstUnlock.get(chainId);
                if (current === undefined || unlock < current) firstUnlock.set(chainId, unlock);
            }
            const expected = [...firstUnlock.values()].some((unlock) => unlock > level);
            assert.equal(
                loadout.empoweredLocked === true, expected,
                `${unitId} @Lv${level}：` + [...firstUnlock].map(([id, unlock]) => `${id}@${unlock}`).join(' '),
            );
            checked += 1;
        }
    }
    assert.ok(checked > 100, `只验到 ${checked} 个组合，覆盖面不够`);
});

test('武将技解锁门控：椰蛋战士 12 级前锁、12 级起放；雷蕉同一条规则', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const lockedAt = (unitId: string, heroLevel: number): boolean => compileZCCombatBuild(
        { unitId, heroLevel }, config.units, catalogs,
    ).find((item) => item.empoweredBagKey)?.empoweredLocked === true;

    //  68005 椰蛋战士：暴风 100504 是 12 / 24 / 36 ⇒ 12 级前锁。
    assert.equal(lockedAt('68005', 8), true, '8 级不该放暴风');
    assert.equal(lockedAt('68005', 11), true, '11 级仍不该放暴风');
    assert.equal(lockedAt('68005', 12), false, '12 级解锁暴风');
    //  门控挂在该单位的普攻袋上（不是随便一条链的袋）。
    const bagKey = compileZCCombatBuild({ unitId: '68005', heroLevel: 8 }, config.units, catalogs)
        .find((item) => item.empoweredBagKey)?.empoweredBagKey;
    assert.equal(bagKey, '68005:30707', '门控写进椰蛋战士普攻袋');

    //  68022 雷蕉：主链 102201(3) / 102202(6) / 102203(9) / 102204(12) ⇒ 12 级起才放武将技。
    assert.equal(lockedAt('68022', 8), true, '8 级不该放武将技');
    assert.equal(lockedAt('68022', 11), true, '11 级仍锁（102204 要 12 级）');
    assert.equal(lockedAt('68022', 12), false, '12 级起放');
});
