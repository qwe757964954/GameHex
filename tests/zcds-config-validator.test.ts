import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { validateSkillPipeline } from '../tools/config/validate_skill_pipeline.mjs';

const TABLES = [
    'pvpSkill', 'pvpCard', 'pvpAttrMap', 'pvpModifierOverride', 'pvpUnitGrowth',
    'pvpSkillBinding', 'pvpStatus', 'skillAttrModifier', 'generalStar', 'armySkillLevelUp',
    'skillAttr', 'skillView', 'skillEffect', 'skillBuff', 'pvpSkillPlan',
];

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(resolve('assets/remoteRef', `${name}.json`), 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return structuredClone(source);
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function fixture(): string {
    const directory = mkdtempSync(join(tmpdir(), 'zcds-config-validator-'));
    TABLES.forEach((name) => writeFileSync(
        join(directory, `${name}.json`), `${JSON.stringify(rows(name))}\n`, 'utf8',
    ));
    return directory;
}

test('技能导表校验覆盖老 Client 四表引用链', () => {
    const current = validateSkillPipeline(resolve('assets/remoteRef'));
    assert.equal(current.ok, true, current.errors.join('\n'));
    assert.equal(current.counts.skillEffect, rows('skillEffect').length);
    assert.match(current.warnings.join('\n'), /老 Client Buff.*仍禁用/);
});

test('pvpAttrMap 允许同义重复行，但拒绝同名冲突映射', () => {
    const directory = fixture();
    try {
        const attrMap = rows('pvpAttrMap');
        const mapped = attrMap.find((row) => row.statId && row.legacyKey);
        assert.ok(mapped);
        attrMap.push({ ...mapped, statId: mapped.statId === 'attack' ? 'maxHp' : 'attack' });
        writeFileSync(join(directory, 'pvpAttrMap.json'), `${JSON.stringify(attrMap)}\n`, 'utf8');
        const result = validateSkillPipeline(directory);
        assert.equal(result.ok, false);
        assert.match(result.errors.join('\n'), /pvpAttrMap\.legacyKey.*映射冲突/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('技能行为绑定必须指向目标单位当前普攻技能', () => {
    const directory = fixture();
    try {
        const bindings = rows('pvpSkillBinding');
        const binding = bindings.find((row) => row.targetUnitId === '68002' && row.pvpSkillId === 30171);
        assert.ok(binding);
        binding.pvpSkillId = 30181;
        writeFileSync(join(directory, 'pvpSkillBinding.json'), `${JSON.stringify(bindings)}\n`, 'utf8');

        const result = validateSkillPipeline(directory);
        assert.equal(result.ok, false);
        assert.match(result.errors.join('\n'), /pvpSkillBinding.*68002.*30181.*30171/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('旧升星技能绑定保留构筑映射并报告当前攻击不会触发', () => {
    const current = validateSkillPipeline(resolve('assets/remoteRef'));
    assert.match(current.warnings.join('\n'), /pvpSkillBinding.*68004.*仅供旧升星构筑/);
    assert.match(current.warnings.join('\n'), /pvpSkillBinding.*68005.*仅供旧升星构筑/);
});

test('技能升级计划必须引用目标单位当前普攻技能', () => {
    const directory = fixture();
    try {
        const plans = rows('pvpSkillPlan');
        const plan = plans.find((row) => row.enabled === 1 && row.unitId === '68001');
        assert.ok(plan);
        plan.pvpSkillId = 30151;
        writeFileSync(join(directory, 'pvpSkillPlan.json'), `${JSON.stringify(plans)}\n`, 'utf8');
        const result = validateSkillPipeline(directory);
        assert.equal(result.ok, false);
        assert.match(result.errors.join('\n'), /pvpSkillPlan.*68001.*30151.*30701/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('技能导表校验拦截老 Client 未注册行为和越权公式', () => {
    const directory = fixture();
    try {
        const skillEffects = rows('skillEffect');
        const group = skillEffects.find((row) => row.key === '长枪兵_普攻'
            && Array.isArray(row.effects)
            && (row.effects as Array<Record<string, unknown>>).some((effect) => effect.script === '基础伤害'));
        assert.ok(group && Array.isArray(group.effects));
        const effects = group.effects as Array<Record<string, unknown>>;
        const damage = effects.find((effect) => effect.script === '基础伤害');
        assert.ok(damage);
        damage.effect = { 基础伤害: 'globalThis.process()' };
        effects.push({ condiction: '默认', script: '任意代码', effect: {} });
        writeFileSync(join(directory, 'skillEffect.json'), `${JSON.stringify(skillEffects)}\n`, 'utf8');

        const result = validateSkillPipeline(directory);
        assert.equal(result.ok, false);
        assert.match(result.errors.join('\n'), /公式白名单外的代码/);
        assert.match(result.errors.join('\n'), /script 未进入 PVP 行为白名单：任意代码/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
