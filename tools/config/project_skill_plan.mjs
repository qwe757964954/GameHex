import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function unpack(source) {
    if (Array.isArray(source)) return { rows: source, keys: null };
    if (source && Array.isArray(source.k) && Array.isArray(source.v)) {
        return {
            keys: source.k,
            rows: source.v.map((values) => Object.fromEntries(source.k.map((name, index) => [name, values[index]]))),
        };
    }
    throw new Error('JSON 既不是数组，也不是 {k,v} 压缩表');
}

function pack(source, rows, keys) {
    if (!keys) return rows;
    return { ...source, k: keys, v: rows.map((row) => keys.map((name) => row[name] ?? null)) };
}

function enabled(value) {
    return value === true || value === 1 || value === '1';
}

/** 将 J 表 pvpSkillPlan 的稳定 modifierId 回填到 K 表导出的 modfiy 列。 */
export function projectSkillPlan(directory) {
    const root = resolve(directory);
    const planPath = resolve(root, 'pvpSkillPlan.json');
    const armyPath = resolve(root, 'armySkillLevelUp.json');
    if (!existsSync(planPath)) return { linked: 0, skipped: true };
    if (!existsSync(armyPath)) throw new Error(`缺少 armySkillLevelUp.json：${armyPath}`);

    const planSource = JSON.parse(readFileSync(planPath, 'utf8'));
    const armySource = JSON.parse(readFileSync(armyPath, 'utf8'));
    const plan = unpack(planSource).rows.filter((row) => enabled(row.enabled));
    const army = unpack(armySource);
    const modifierByLevel = new Map(plan.map((row) => [
        `${Number(row.skillChainId)}:${Number(row.skillLevel)}`,
        Number(row.modifierId),
    ]));
    let linked = 0;
    for (const row of army.rows) {
        const modifierId = modifierByLevel.get(`${Number(row.id)}:${Number(row.skilllevel)}`);
        if (!Number.isSafeInteger(modifierId) || modifierId <= 0) continue;
        row.modfiy = [modifierId];
        linked += 1;
    }
    writeFileSync(armyPath, `${JSON.stringify(pack(armySource, army.rows, army.keys), null, 2)}\n`, 'utf8');
    return { linked, skipped: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = projectSkillPlan(process.argv[2] || resolve(process.cwd(), 'assets', 'remoteRef'));
    console.log(result.skipped ? '[技能投影] 无 pvpSkillPlan，跳过' : `[技能投影] 已关联 ${result.linked} 个 K 表技能等级修改器`);
}
