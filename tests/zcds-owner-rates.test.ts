/** 服务端 buff 解析、阵营倍率和静态属性编译回归。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { battleBuffRatio, parseBattleBuffs } from '../assets/script/app/battle/BattleStartModel';
import { getAllUnitDefinitions, type ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { resolveZCUnitDefinition } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    ownerRatesOf,
    ZC_BATTLE_RATE_KEYS,
} from '../assets/script/app/zcds/application/ZCClientCombatConfig';

/** `assets/remoteRef` 里既有行对象数组、也有旧的 `{k,v}` 列存，两种都认。 */
function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

loadPvpTables({
    pvpGlobal: readPvpRows('pvpGlobal') as ZCPvpTables['pvpGlobal'],
    pvpArtifact: readPvpRows('pvpArtifact'),
    pvpCard: readPvpRows('pvpCard'),
    pvpSkill: readPvpRows('pvpSkill'),
    pvpCounter: readPvpRows('pvpCounter'),
    pvpBond: readPvpRows('pvpBond'),
    pvpTile: readPvpRows('pvpTile'),
    pvpPity: readPvpRows('pvpPity'),
    pvpTileGen: readPvpRows('pvpTileGen'),
    pvpTileGenParams: readPvpRows('pvpTileGenParams') as ZCPvpTables['pvpTileGenParams'],
    pvpBaseTeamWeight: readPvpRows('pvpBaseTeamWeight'),
} as ZCPvpTables);

const unitDefinitions = getAllUnitDefinitions();
const sampleUnit: ZCUnitDefinition = unitDefinitions[0];
const otherUnit: ZCUnitDefinition = unitDefinitions[1] ?? sampleUnit;

/**
 * 只填 `compileZCMatchRuntime` 真会读的字段。
 *
 * `rules` / `map` / `tiles` 一个都不读（那条链只看 units / decks / modifiers），
 * 所以给 `never` 强转 —— 也顺带当"编译器没有偷偷读更多配置"的护栏。
 */
function matchConfig(over: Partial<ZCMatchConfig> = {}): ZCMatchConfig {
    return {
        map: {} as never,
        rules: {} as never,
        playerDeck: [],
        enemyDeck: [],
        units: [sampleUnit, otherUnit],
        bonds: [],
        counters: [],
        tiles: {} as never,
        tileWeights: [],
        goldPity: 1,
        ...over,
    };
}

/** 造一个服务端单元（只填 ownerRates 编译用得到的字段）。 */
function battleUnit(buffs: string[][]) {
    return {
        campId: 1,
        unitId: 1,
        roleId: '1',
        serverId: 0,
        name: '测试',
        power: 0,
        avatarId: '0',
        headFrameId: '0',
        gradeId: 0,
        gradeScore: 0,
        heroIds: [],
        artifactId: 0,
        artifactLevel: 0,
        buffs: buffs.map((flat, index) => ({ source: index + 1, entries: parseFlat(flat) })),
    } as never;
}

function parseFlat(flat: string[]) {
    return parseBattleBuffs([{ source: 1, buffs: flat } as never])[0]?.entries ?? [];
}

test('真实下发形态：key 是属性名，numeric 解析成数，value 保留原文', () => {
    const entries = parseFlat(['levelAttackRatio', '0.8', 'levelHpRatio', '0.8']);
    assert.deepEqual(
        entries.map((entry) => [entry.key, entry.value, entry.numeric]),
        [
            ['levelAttackRatio', '0.8', 0.8],
            ['levelHpRatio', '0.8', 0.8],
        ],
        'key 必须是字符串属性名 —— 按数字解析会把整条 buff 丢光（零报错）',
    );

    // 非数字 value：条目保留、numeric 为 null（不是 0、不是 NaN）
    const text = parseFlat(['levelAttackRatio', 'abc']);
    assert.equal(text.length, 1);
    assert.equal(text[0].numeric, null);
    assert.equal(text[0].value, 'abc');
});

test('battleBuffRatio：同 key 跨来源累乘，一处都没有返回 null', () => {
    const buffs = parseBattleBuffs([
        { source: 1, buffs: ['levelHpRatio', '0.8'] },
        { source: 2, buffs: ['levelHpRatio', '1.5', 'levelAttackRatio', '2'] },
    ] as never);
    // 浮点累乘：0.8 × 1.5 = 1.2000000000000002，别用严格相等钉字面量
    const hpRatio = battleBuffRatio(buffs, 'levelHpRatio');
    assert.ok(hpRatio !== null && Math.abs(hpRatio - 1.2) < 1e-9, `0.8 × 1.5 应≈1.2，实际 ${hpRatio}（不按 source 去重）`);
    assert.equal(battleBuffRatio(buffs, 'levelAttackRatio'), 2);
    assert.equal(battleBuffRatio(buffs, 'levelCost'), null, '没下发 ⇒ null，不能是 1');
    assert.equal(battleBuffRatio([], 'levelHpRatio'), null);
    // 只有非数值时不参与累乘（否则 NaN 会污染整条倍率）
    assert.equal(
        battleBuffRatio(parseBattleBuffs([{ source: 1, buffs: ['levelHpRatio', 'x'] }] as never), 'levelHpRatio'),
        null,
    );
});

test('ownerRatesOf：只保留服务端字段，不补缺失倍率', () => {
    assert.deepEqual(ownerRatesOf(battleUnit([['levelAttackRatio', '0.8', 'levelHpRatio', '0.5']])), {
        hpRate: 0.5,
        attackRate: 0.8,
    });
    // 只给攻击：生命字段保持缺失。
    assert.deepEqual(ownerRatesOf(battleUnit([['levelAttackRatio', '2']])), { attackRate: 2 });
    // 无关 key / 空 buffs / 没有 unit
    assert.equal(ownerRatesOf(battleUnit([['levelCost', '5']])), undefined);
    assert.equal(ownerRatesOf(battleUnit([])), undefined);
    assert.equal(ownerRatesOf(undefined), undefined);
    // key 常量与协议里的拼写必须一致（拼错 = 永远匹配不上，零报错）
    assert.equal(ZC_BATTLE_RATE_KEYS.attack, 'levelAttackRatio');
    assert.equal(ZC_BATTLE_RATE_KEYS.hp, 'levelHpRatio');
});

test('阵营倍率在普通成长之后相乘，不覆盖技能参数', () => {
    const growth = {
        sourceKey: 'growth', sourceKind: 'growth' as const, targetUnitId: sampleUnit.unitId,
        appliedModifierIds: [], rawAttributes: { skillDamage: 123 },
        statPatch: { attackFlat: 10, attackPct: 50, maxHpFlat: 20 },
        typedModifiers: [], skillPlans: [], breakdown: [], effects: [], unsupportedAttributes: [], configHash: 'test',
    };
    const extra = { ...growth, rawAttributes: { skillDuration: 3 }, statPatch: {} };
    const rates = ownerRatesOf(battleUnit([['levelAttackRatio', '0.8', 'levelHpRatio', '0.5']]));
    const compiled = compileZCMatchRuntime(matchConfig({
        modifiers: { player: [growth, extra] },
        ownerRates: { player: rates },
    }));
    const grown = resolveZCUnitDefinition(sampleUnit, [growth, extra]);
    const actual = compiled.effectiveDefinitions.player.get(sampleUnit.unitId)!;
    assert.equal(actual.attack, grown.attack * 0.8);
    assert.equal(actual.maxHp, grown.maxHp * 0.5);
    assert.deepEqual(compiled.legacyAttributes.player.get(sampleUnit.unitId), { skillDamage: 123, skillDuration: 3 });
    assert.equal(compiled.effectiveDefinitions.enemy.get(sampleUnit.unitId), sampleUnit);
    const other = compiled.effectiveDefinitions.player.get(otherUnit.unitId)!;
    assert.equal(other.attack, otherUnit.attack * 0.8, '阵营倍率也覆盖卡组之外的单位');
});

test('缺失字段不修改对应属性，攻击零倍率按服务端生效', () => {
    const scaled = resolveZCUnitDefinition(sampleUnit, [], { attackRate: 0 });
    assert.equal(scaled.attack, 0);
    assert.equal(scaled.maxHp, sampleUnit.maxHp);
    assert.equal(resolveZCUnitDefinition(sampleUnit, []), sampleUnit);
});

test('非法服务端倍率报错，不改成本地值或单位倍率', () => {
    assert.throws(() => ownerRatesOf(battleUnit([['levelHpRatio', '0']])), /生命倍率无效/);
    assert.throws(() => ownerRatesOf(battleUnit([['levelAttackRatio', '-3']])), /攻击倍率无效/);
    assert.throws(() => ownerRatesOf(battleUnit([
        ['levelAttackRatio', '1e308'], ['levelAttackRatio', '1e308'],
    ])), /攻击倍率无效/);
});
