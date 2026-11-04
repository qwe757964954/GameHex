/**
 * 战斗特效 prefab 的**存在性守卫**。
 *
 * ## 为什么需要它
 *
 * 弹道/技能特效的加载是**静默容错**的：`ZCGameLoader.loadVisualPrefabs` 用 `loadOptional`
 * 包住每一个路径，prefab 加载失败只打一条 warn 并跳过（Map 里没有这个键）；
 * 而 `ZCCombatEffectView.initialize(null, allowGeneric=false)` 在 `allowGenericEffects=false`
 * 的关卡里**什么都不画** —— 表现为「子弹/特效凭空看不见，且不报错」。
 * （2026-11-03 排查 68022「磁电菇子弹看不见」时，资产、配表、资源计划、视图逻辑全部健康，
 * 这类问题只能靠运行时日志分辨；把「引用的文件在不在磁盘上」变成静态断言后，
 * 配表写错路径、美术漏交 prefab、SVN 半合并这类根因在测试阶段就能拦下。）
 *
 * ## 覆盖的两个引用来源
 *
 * ① `assets/remoteRef/pvpSkill.json` 每一行的 `effectPrefabPath` / `impactEffectPrefabPath`；
 * ② `assets/script/app/zcds` 代码里登记的 `units/projectiles|effects/...` 字面量
 *    （导弹两件套 `MISSILE_FX_BY_UNIT`、飞行/朝向/淡出/缩放/锚点/光束各常量表 ——
 *    它们只存在于代码、pvpSkill 任何一行都不携带，2026-11-03 导弹特效消失的根因即此）。
 *
 * 断言口径：路径 P ⇒ `assets/bundles/battle/P.prefab` 必须存在（battle bundle 内按相对路径加载）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const BATTLE_ASSETS = join(PROJECT_ROOT, 'assets/bundles/battle');
const SCRIPT_DIR = join(PROJECT_ROOT, 'assets/script/app/zcds');

/** 读 remoteRef 的列存表（`{k, v}`）→ 行对象数组。与 tests/card-skill-list.test.ts 同一套。 */
function readPvpSkillRows(): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(join(PROJECT_ROOT, 'assets/remoteRef/pvpSkill.json'), 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    return source.v.map((row) => {
        const entry: Record<string, unknown> = {};
        source.k.forEach((key, index) => { entry[key] = row[index]; });
        return entry;
    });
}

/** 递归收集目录下全部 .ts 文件。 */
function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
        else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** 从配表里收集的特效路径。 */
function pathsFromTables(): Map<string, string> {
    const found = new Map<string, string>();
    for (const row of readPvpSkillRows()) {
        for (const column of ['effectPrefabPath', 'impactEffectPrefabPath'] as const) {
            const value = row[column];
            if (typeof value === 'string' && value.startsWith('units/')) {
                found.set(value, `pvpSkill#${row.skillId}.${column}`);
            }
        }
    }
    return found;
}

/** 从 zcds 源码字面量里收集的特效路径（覆盖只登记在代码常量表里的那批）。 */
function pathsFromSource(): Map<string, string> {
    const found = new Map<string, string>();
    const literal = /'((?:units|effects)\/(?:projectiles|effects|buildings)\/[A-Za-z0-9_\u4e00-\u9fff-]+\/[A-Za-z0-9_\u4e00-\u9fff-]+)'/g;
    for (const file of collectTsFiles(SCRIPT_DIR)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(literal)) {
            found.set(match[1], `source:${file.split(/[\\/]/).pop()}`);
        }
    }
    return found;
}

test('配表与代码引用的每个战斗特效 prefab 都必须真实存在（缺失 = 屏上静默隐形）', () => {
    const referenced = new Map<string, string>();
    for (const [path, source] of [...pathsFromTables(), ...pathsFromSource()]) {
        // 同一路径多处引用时只保留第一条出处，报告里够定位即可。
        if (!referenced.has(path)) referenced.set(path, source);
    }
    assert.ok(referenced.size > 40, `特效引用收集异常：只找到 ${referenced.size} 条，读表或正则可能失效`);

    const missing: string[] = [];
    for (const [path, source] of referenced) {
        if (!existsSync(join(BATTLE_ASSETS, `${path}.prefab`))) {
            missing.push(`${path}（引用自 ${source}）`);
        }
    }
    assert.deepEqual(missing, [], `以下特效 prefab 在 assets/bundles/battle 下不存在，运行时会静默隐形：\n${missing.join('\n')}`);
});
