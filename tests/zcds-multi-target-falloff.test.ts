import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { zcBulletDamageScale } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

/**
 * 2026-11-14 用户口径：**普攻衍生的多目标伤害必须递减、初值低于普攻**。
 *
 * 原话：「技能设计中的处决机制先从卡牌中移除，处决机制只能留在其他的养成系统中，
 * 普通攻击带来的穿透类 / 分裂子弹 / 溅射 的伤害设计上需要遵循 多个目标递减的机制，
 * 初始值必须低于普通攻击，主要形成大面积的造成伤害的效果，但是数值不能太大」。
 *
 * 具体口径（三条都落在配表 `pvpSkillPlan.skillParamJson`，缺省全 0 = 存量逐字不变）：
 *   · 穿透 `normalPierceFalloff = 0.4`：首次 60%，每多穿一个 ×0.6 ⇒ 60% / 36% / 21.6%
 *   · 溅射 `splashFalloff = 0.3`：基准 20% / 26% / 32%，同一爆点第 2 个目标起每次 ×0.7
 *   · 多弹 `bulletFalloff = 0.4`：第 1 颗 100%（就是普攻本体），第 2 颗起 ×0.6
 *
 * 本文件钉的是**配表真值与公式**这两层；运行时那一段（逐颗 `baseDamage` 乘系数）走
 * `zcBulletDamageScale`，所以公式本身单独测，避免依赖整局模拟。
 */

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClientRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`../doc/塔防数据配置/json/client/${name}.json`, 'utf8'));
}

function params(row: Record<string, unknown>): Record<string, number> {
    const raw = row.skillParamJson;
    return raw ? JSON.parse(String(raw)) as Record<string, number> : {};
}

// ── 一、公式 ──────────────────────────────────────────────────────────────────

test('多弹递减公式：第 1 颗是普攻本体，第 2 颗起 ×0.6', () => {
    //  本体 1 颗 + 多打 2 颗（满档 bulletNum +2）
    assert.equal(zcBulletDamageScale(0, 1, 0.4), 1);
    assert.equal(zcBulletDamageScale(1, 1, 0.4), 0.6);
    assert.ok(Math.abs(zcBulletDamageScale(2, 1, 0.4) - 0.36) < 1e-9);
    //  额外部分总额 96%，整轮 196%（原来是 300%）
    const total = [0, 1, 2].reduce((sum, index) => sum + zcBulletDamageScale(index, 1, 0.4), 0);
    assert.ok(Math.abs(total - 1.96) < 1e-9, `满档总额应为 196%，实际 ${total}`);
});

test('多弹递减公式：缺省 0 时每颗同额（存量单位逐字不变）', () => {
    for (const index of [0, 1, 2, 5]) {
        assert.equal(zcBulletDamageScale(index, 1, 0), 1);
    }
});

test('多弹递减公式：「本体」多于 1 颗时，本体的每一颗都不吃递减', () => {
    //  本体 2 颗 + 多打 1 颗：前两颗仍是 100%，第 3 颗才是额外弹
    assert.equal(zcBulletDamageScale(0, 2, 0.4), 1);
    assert.equal(zcBulletDamageScale(1, 2, 0.4), 1);
    assert.equal(zcBulletDamageScale(2, 2, 0.4), 0.6);
});

test('多弹递减公式：固定颗数（凤凰降临 4 颗）不吃递减', () => {
    //  `baseProjectileCount === projectileCount` ⇒ 没有额外弹
    for (const index of [0, 1, 2, 3]) {
        assert.equal(zcBulletDamageScale(index, 4, 0.4), 1);
    }
});

// ── 二、配表真值（两份产物互校） ────────────────────────────────────────────────

test('多弹：9 条链的 bulletNum 行都带 bulletFalloff，三档 0.4 / 0.35 / 0.3（两份产物一致）', () => {
    //  2026-11-17 第 5 批：逐档 `extraBulletDamage` 没有消费点，改用 `bulletFalloff` 逼近 ——
    //  第 2 颗 = (1 - falloff)，三档分别 36% / 42% / 49%；文案写「约为第 1 发的 60/65/70%」。
    const expected: Record<number, number> = { 1: 0.4, 2: 0.35, 3: 0.3 };
    for (const rows of [readRows('pvpSkillPlan'), readClientRows('pvpSkillPlan')]) {
        const bullets = rows.filter((row) => String(row.statId ?? '') === 'bulletNum');
        assert.equal(bullets.length, 27, '9 条链 × 3 档');
        for (const row of bullets) {
            const tier = Number(row.skillLevel);
            assert.equal(params(row).bulletFalloff, expected[tier],
                `${row.modifierId} L${tier} 的 bulletFalloff`);
            assert.ok(Number(row.value) > 0, 'bulletNum 必须是正数才有额外弹');
        }
    }
});

test('普攻穿透：6 行都带 normalPierceFalloff 0.4，且不再误写成 pierceCount', () => {
    //  5 条链 → 3 条：101301 / 102402 的穿透是旧机制（穿甲苔刺），第 5 批按设计案换成多弹后清掉了。
    //  3 条链 → 2 条：100701 也在第 7 批整条换成「破阵投枪」（`normalPierceCount` 那套清空，
    //  改由 `lancePierceCount` 表达），只剩 100801 / 103501。
    for (const rows of [readRows('pvpSkillPlan'), readClientRows('pvpSkillPlan')]) {
        const pierce = rows.filter((row) => params(row).normalPierceCount != null);
        assert.equal(pierce.length, 6, '2 条链 × 3 档');
        for (const row of pierce) {
            assert.equal(params(row).normalPierceFalloff, 0.4, `${row.modifierId} 缺衰减`);
            assert.equal(params(row).pierceCount, undefined,
                'pierceCount 只服务「强化那一击」，普攻写它等于没配');
        }
    }
});

test('溅射：42 行按品级分档，同爆点第 2 个起 ×0.7，三档都低于普攻', () => {
    //  2026-11-16 技能设计案 V5：溅射基准改由设计案 L1~L3 定价，随「被动重设计」分批落地。
    //  本表按**当前配表快照**钉住，每落地一批就同步一次；新增链必须在这里登记档位，
    //  否则会被 DEFAULT_BAND 兜住而看不出漏配。
    //  2026-11-17 第四批（克制条 20 条）：101302 / 102202 的「爆囊扩散」改成职业猎杀协议，
    //  溅射能力被设计案收走 ⇒ 16 链降到 14 链。
    const BANDS: Record<string, readonly [number, number, number]> = {
        100802: [0.50, 0.54, 0.58],
        100902: [0.50, 0.54, 0.58],
        101002: [0.50, 0.55, 0.60],
        101501: [0.50, 0.54, 0.58],
        101502: [0.32, 0.40, 0.48],
        101601: [0.50, 0.55, 0.60],
        //  2026-11-17 第 8 批：「巨囊弹体」按设计案 L1~L3 改成 30/34/38
        //  （原来那组 30/38/46 是旧「爆囊扩散」的档位）。
        101602: [0.30, 0.34, 0.38],
        //  2026-11-17 第 9 批：101702「噬血蔓延」按设计案 L 列（Q2 裁定）改成 40/44/48，
        //  原 12/16/20 是旧「爆囊扩散」的档位；同批把主链换成 `lifestealRate`。
        101702: [0.40, 0.44, 0.48],
        102502: [0.20, 0.26, 0.32],
        102602: [0.50, 0.55, 0.60],
        102701: [0.20, 0.26, 0.32],
        103202: [0.50, 0.54, 0.58],
        103301: [0.32, 0.40, 0.48],
        103402: [0.50, 0.55, 0.60],
    };
    const DEFAULT_BAND: readonly [number, number, number] = [0.2, 0.26, 0.32];
    for (const rows of [readRows('pvpSkillPlan'), readClientRows('pvpSkillPlan')]) {
        const splash = rows.filter((row) => params(row).splashDamageRate != null);
        assert.equal(splash.length, 42, '14 条链 × 3 档');
        for (const row of splash) {
            const band = BANDS[String(row.skillChainId)] ?? DEFAULT_BAND;
            const rate = params(row).splashDamageRate;
            assert.equal(rate, band[Number(row.skillLevel) - 1],
                `${row.modifierId}（链 ${row.skillChainId}）基准值`);
            assert.ok(rate < 1, '初始值必须低于普通攻击（100%）');
            assert.equal(params(row).splashFalloff, 0.3, `${row.modifierId} 缺递减`);
        }
    }
});

// ── 三、处决只留在其他养成系统 ─────────────────────────────────────────────────

test('处决：卡牌链路的 pvpSkillPlan 一条 executeChance 都不许有', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClientRows('pvpSkillPlan')]) {
        const leftovers = rows.filter((row) => params(row).executeChance != null);
        assert.deepEqual(leftovers.map((row) => row.modifierId), [],
            '处决只能由其他养成系统提供，卡牌链路（枯萎收割 102401/103502）已移除');
        const described = rows.filter((row) => String(row.desc ?? '').includes('处决残血目标'));
        assert.deepEqual(described.map((row) => row.modifierId), [], '描述里的处决句也要删');
    }
});

test('处决：卡牌技能升级表（armySkillLevelUp）描述里不留处决句', () => {
    for (const rows of [readRows('armySkillLevelUp'), readClientRows('armySkillLevelUp')]) {
        const hit = rows.filter((row) => String(row.desc ?? '').includes('处决'));
        assert.deepEqual(hit.map((row) => row.id), []);
    }
});
