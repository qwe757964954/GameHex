/**
 * 把当前 `BigMap-*` 配置生成的世界**导出成一份布局文件**，落到编辑器预设目录。
 *
 * 用途：M2 编辑器要有东西可加载。种子生成的世界就是第一张图的底稿 ——
 * 策划在它上面挪城、刷势力范围，而不是从空白 100×100 画起。
 *
 * 用法：
 *     npx tsx tools/map-editor/gen_bigmap_preset.ts [输出名] [种子]
 *     npx tsx tools/map-editor/gen_bigmap_preset.ts world_01 20261017
 *
 * 产物：`tools/map-editor/presets/bigmap/<名>.json`（**不进 assets** —— 运行时读的是发布后的
 * `assets/resources/config/bigmap-maps/`，由 M4 的 copy 脚本负责搬运）。
 *
 * ⚠️ 这个脚本只做导出，不改配置、不改存档。同参数重跑是幂等的。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BIGMAP_TABLE, parseBigMapConfig } from '../../assets/script/app/bigmap/model/BigMapConfig';
import { buildBigMapWorldFromLayout, exportBigMapLayout, parseBigMapLayout } from '../../assets/script/app/bigmap/model/BigMapLayout';
import { buildBigMapWorld, DEFAULT_BIGMAP_WORLD_SEED } from '../../assets/script/app/bigmap/model/BigMapWorld';

// 用 `process.argv[1]` 而不是 `import.meta.url`：工程的 tsconfig 没开 esnext module，
// `import.meta` 会报 TS1343（`tests/**` 里那 40 条就是这么来的）。这里不跟着加基线错误。
const here = dirname(resolve(process.argv[1] ?? join(process.cwd(), 'gen_bigmap_preset.ts')));
const projectRoot = join(here, '..', '..');

const outputName = process.argv[2] ?? 'world_01';
const seed = Number(process.argv[3] ?? DEFAULT_BIGMAP_WORLD_SEED);
if (!/^[A-Za-z0-9_-]+$/.test(outputName)) {
    throw new Error(`输出名只允许字母/数字/下划线/连字符，收到 ${outputName}`);
}
if (!Number.isInteger(seed)) {
    throw new Error(`种子必须是整数，收到 ${process.argv[3]}`);
}

const tables: Record<string, unknown> = {};
for (const tableName of Object.values(BIGMAP_TABLE)) {
    tables[tableName] = JSON.parse(
        readFileSync(join(projectRoot, 'assets', 'remoteRef', `${tableName}.json`), 'utf8'),
    );
}

const config = parseBigMapConfig(tables);
const world = buildBigMapWorld(config, seed);
const layout = exportBigMapLayout(world);

const targetDir = join(here, 'presets', 'bigmap');
mkdirSync(targetDir, { recursive: true });
const target = join(targetDir, `${outputName}.json`);
writeFileSync(target, `${JSON.stringify(layout, null, 2)}\n`, 'utf8');

// 写盘后立刻读回来重建一遍：这条自证比单测更贴近真实链路（JSON 序列化 + parse + build 全跑）。
// 少了它，「导出看着对、加载回来偏一格」要等 M2 编辑器才发现。
const reloaded = buildBigMapWorldFromLayout(config, parseBigMapLayout(JSON.parse(readFileSync(target, 'utf8'))));
if (reloaded.tiles.length !== world.tiles.length) {
    throw new Error(`往返后格子数不一致：${reloaded.tiles.length} vs ${world.tiles.length}`);
}
for (const tile of world.tiles) {
    const other = reloaded.tileById.get(tile.id);
    if (!other || other.terrain !== tile.terrain || other.ring !== tile.ring) {
        throw new Error(`往返后格 ${tile.id} 不一致：${JSON.stringify(other)} vs ${JSON.stringify(tile)}`);
    }
}
for (const site of world.cities.values()) {
    const other = reloaded.cities.get(site.cityId);
    if (!other || other.anchorHexId !== site.anchorHexId || other.hexIds.join(',') !== site.hexIds.join(',')) {
        throw new Error(`往返后城池 ${site.cityId} 落位不一致`);
    }
}
for (const site of world.monsters) {
    const other = reloaded.monsters.find((item) => item.instanceId === site.instanceId);
    if (!other || other.anchorHexId !== site.anchorHexId || other.hexIds.join(',') !== site.hexIds.join(',')) {
        throw new Error(`往返后野怪 ${site.instanceId} 落位不一致`);
    }
}
for (const base of world.bases) {
    const other = reloaded.bases.find((item) => item.baseId === base.baseId);
    if (!other || other.hexId !== base.hexId) throw new Error(`往返后基地 ${base.baseId} 不一致`);
}

const hexCount = layout.cities.reduce((sum, city) => sum + city.hexIds.length, 0);
const monsterHexCount = layout.monsters.reduce((sum, monster) => sum + monster.hexIds.length, 0);
console.log(`已导出 ${target}`);
console.log(`  尺寸 ${layout.rows}×${layout.columns}（${layout.rows * layout.columns} 格）· 种子 ${layout.terrainSeed}`);
console.log(`  城池 ${layout.cities.length} 座 / 占 ${hexCount} 格`);
console.log(`  野怪 ${layout.monsters.length} 只 / 占 ${monsterHexCount} 格`);
console.log(`  基地 ${layout.bases.length} 个（玩家 ${layout.bases.filter((base) => base.isPlayer).length}）`);
for (const city of layout.cities.slice(0, 3)) {
    console.log(`  示例：城 ${city.cityId} 锚点 ${city.anchorHexId} 环 ${city.ring} 占格 [${city.hexIds.join(',')}]`);
}
