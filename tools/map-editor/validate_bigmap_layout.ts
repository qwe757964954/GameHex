/**
 * 大地图布局的**权威校验 + 配置表对账**（命令行入口，给发布脚本和 CI 用）。
 *
 * 用法：
 *     npx tsx tools/map-editor/validate_bigmap_layout.ts <layout.json>
 *
 * 输出（stdout，始终是 JSON，供 python 解析）：
 *     成功：{ "ok": true, "layout": {...归一化后的布局...}, "warnings": [] }
 *     失败：{ "ok": false, "issues": ["..."] }
 * 退出码：0 成功 / 1 失败。
 *
 * 为什么不让 python 自己判：校验规则只有一份权威实现（`parseBigMapLayout`），
 * python 侧再抄一遍就是第三处漂移点。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';

const here = dirname(resolve(process.argv[1] ?? join(process.cwd(), 'validate_bigmap_layout.ts')));
const projectRoot = join(here, '..', '..');
const remoteRefDir = join(projectRoot, 'assets', 'remoteRef');

function fail(issues: string[]): never {
    console.log(JSON.stringify({ ok: false, issues }));
    process.exit(1);
}

function readRefIds(tableName: string, idField: string): Set<number> | null {
    try {
        const raw = JSON.parse(readFileSync(join(remoteRefDir, `${tableName}.json`), 'utf8'));
        if (!Array.isArray(raw?.k) || !Array.isArray(raw?.v)) return null;
        const keys = raw.k as string[];
        const index = keys.indexOf(idField);
        if (index < 0) return null;
        return new Set<number>(raw.v.map((row: unknown[]) => Number(row[index])));
    } catch {
        return null;
    }
}

const file = process.argv[2];
if (!file) fail(['用法：npx tsx tools/map-editor/validate_bigmap_layout.ts <layout.json>']);

let raw: unknown;
try {
    raw = JSON.parse(readFileSync(resolve(file), 'utf8'));
} catch (error) {
    fail([`读取失败：${(error as Error).message}`]);
}

let layout: ReturnType<typeof parseBigMapLayout>;
try {
    layout = parseBigMapLayout(raw);
} catch (error) {
    fail([(error as Error).message]);
}

const issues: string[] = [];
const warnings: string[] = [];

// 对账：布局里的 id 必须能在配置表里找到（否则进游戏是「图上有城、表里没数值」）。
const cityIds = readRefIds('BigMap-城池配置', 'cityId');
if (cityIds) {
    const missing = layout.cities.map((city) => city.cityId).filter((cityId) => !cityIds.has(cityId));
    if (missing.length > 0) issues.push(`布局里的城池 ${missing.join(',')} 不在 BigMap-城池配置 中`);
    const placed = new Set(layout.cities.map((city) => city.cityId));
    const unplaced = [...cityIds].filter((cityId) => !placed.has(cityId));
    if (unplaced.length > 0) warnings.push(`配置里有 ${unplaced.length} 座城没在图上：${unplaced.join(',')}`);
} else {
    warnings.push('读不到 BigMap-城池配置，跳过城池对账');
}

const monsterIds = readRefIds('BigMap-野怪配置', 'monsterId');
if (monsterIds) {
    const missing = [...new Set(layout.monsters.map((monster) => monster.monsterId))]
        .filter((monsterId) => !monsterIds.has(monsterId));
    if (missing.length > 0) issues.push(`布局里的野怪 ${missing.join(',')} 不在 BigMap-野怪配置 中`);
} else {
    warnings.push('读不到 BigMap-野怪配置，跳过野怪对账');
}

if (issues.length > 0) fail(issues);

console.log(JSON.stringify({ ok: true, layout, warnings }));
