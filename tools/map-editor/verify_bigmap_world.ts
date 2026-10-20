/**
 * 校验「已发布的布局」与「同种子生成的世界」差在哪。
 *
 * 用途有两个：
 * 1. **换数据源零回归**：第一份布局是从种子导出的，重建后必须逐格相同 —— 不一致说明导出/解析漏了东西；
 * 2. 策划改了图之后，跑一次就知道「到底动了哪几座城、几只怪」，比进游戏肉眼找快得多。
 *
 * 用法：
 *     npx tsx tools/map-editor/verify_bigmap_world.ts            # 默认 world_01
 *     npx tsx tools/map-editor/verify_bigmap_world.ts world_02
 *
 * 只读，不写任何文件。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BIGMAP_TABLE, parseBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapConfig';
import { buildBigMapWorldFromLayout, resolveBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';
import { buildBigMapWorld } from '../../assets/script/app/bigmap/model/BigMapWorld';

const here = dirname(resolve(process.argv[1] ?? join(process.cwd(), 'verify_bigmap_world.ts')));
const projectRoot = join(here, '..', '..');
const layoutId = process.argv[2] ?? 'world_01';

const tables: Record<string, unknown> = {};
for (const tableName of Object.values(BIGMAP_TABLE)) {
    tables[tableName] = JSON.parse(
        readFileSync(join(projectRoot, 'assets', 'remoteRef', `${tableName}.json`), 'utf8'),
    );
}
const config = parseBigMapConfig(tables);

const layoutPath = join(projectRoot, 'assets', 'resources', 'config', 'bigmap-maps', `${layoutId}.json`);
let raw: unknown;
try {
    raw = JSON.parse(readFileSync(layoutPath, 'utf8'));
} catch (error) {
    console.error(`读不到布局：${layoutPath}\n${(error as Error).message}`);
    process.exit(1);
}

const { layout, reason } = resolveBigMapLayout(raw, config);
if (!layout) {
    console.error(`布局不可用：${reason}`);
    process.exit(1);
}

const fromLayout = buildBigMapWorldFromLayout(config, layout);
const fromSeed = buildBigMapWorld(config, layout.terrainSeed);

const diffs: string[] = [];

if (fromLayout.rows !== fromSeed.rows || fromLayout.cols !== fromSeed.cols) {
    diffs.push(`尺寸：布局 ${fromLayout.rows}×${fromLayout.cols}，种子 ${fromSeed.rows}×${fromSeed.cols}`);
}

let terrainDiff = 0;
for (const tile of fromSeed.tiles) {
    if (fromLayout.tileById.get(tile.id)?.terrain !== tile.terrain) terrainDiff += 1;
}
if (terrainDiff > 0) diffs.push(`地形：${terrainDiff} 格不同`);

for (const site of fromSeed.cities.values()) {
    const other = fromLayout.cities.get(site.cityId);
    if (!other) { diffs.push(`城池 ${site.cityId}：布局里没有`); continue; }
    if (other.anchorHexId !== site.anchorHexId) {
        diffs.push(`城池 ${site.cityId}：锚点 ${site.anchorHexId} → ${other.anchorHexId}`);
    }
}
for (const cityId of fromLayout.cities.keys()) {
    if (!fromSeed.cities.has(cityId)) diffs.push(`城池 ${cityId}：布局里有、种子没有`);
}

if (fromLayout.monsters.length !== fromSeed.monsters.length) {
    diffs.push(`野怪数量：布局 ${fromLayout.monsters.length}，种子 ${fromSeed.monsters.length}`);
}
for (const site of fromSeed.monsters) {
    const other = fromLayout.monsters.find((item) => item.instanceId === site.instanceId);
    if (!other || other.anchorHexId !== site.anchorHexId) {
        diffs.push(`野怪 ${site.instanceId}：锚点 ${site.anchorHexId} → ${other?.anchorHexId ?? '缺失'}`);
    }
}

if (fromLayout.bases.length !== fromSeed.bases.length) {
    diffs.push(`基地数量：布局 ${fromLayout.bases.length}，种子 ${fromSeed.bases.length}`);
}

console.log(`布局：${layoutId}（${layout.rows}×${layout.columns}，布局版本 ${layout.layoutVersion}）`);
console.log(`城池 ${layout.cities.length} 座 / 野怪 ${layout.monsters.length} 只 / 基地 ${layout.bases.length} 个`
    + ` / 区块 ${layout.spawnZones.length} / 据点 ${layout.points.length} / 障碍 ${layout.blocked.length}`);
console.log(`地形手改 ${layout.terrainOverrides.length} 格，势力范围 ${layout.cities.reduce((sum, city) => sum + city.rangeHex.length, 0)} 格`);

if (diffs.length === 0) {
    console.log('\n与同种子生成的世界**完全一致** —— 换数据源零视觉回归。');
    process.exit(0);
}
console.log(`\n与种子世界有 ${diffs.length} 处差异（布局确实改过）：`);
for (const line of diffs.slice(0, 40)) console.log(`  - ${line}`);
if (diffs.length > 40) console.log(`  … 还有 ${diffs.length - 40} 处`);
process.exit(0);
