/**
 * BigMap 配置表 × `RefUtil` 压缩表契约的回归测试。
 *
 * 背景（2026-10-20 线上炸点）：`RefConfigService.getTable()` 只从 `RefUtil` 取数，
 * 而 `RefUtil.compressKeyRefDataFix()` **只在 `data.c === 1` 时**才把 `{k,v}` 解压成对象数组；
 * 没有 `c` 的表会原样返回 `{k,v}` 对象 → `getTable` 的 `Array.isArray()` 判假 → 返回 `[]`
 * → `parseBigMapConfig` 抛「配置表缺失或为空：bigmapWorld」。
 *
 * 为什么原来的单测逮不住：`helpers/bigmap-fixtures.ts` 直接读盘上的 `{k,v}` 喂给
 * `decompressBigMapRows`，**绕过了 `c==1` 这个门槛** —— 测的绿，真机照炸。
 *
 * 所以这里按**运行时口径**复算一遍：先模拟 `RefUtil` 的解压条件，再喂给同一个 parse 入口。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIGMAP_TABLE, parseBigMapConfig, type BigMapRawTables } from '../assets/script/app/bigmap/model/BigMapConfig';

const REF_UTIL_URL = new URL('../assets/script/framework/ref/RefUtil.ts', import.meta.url);

function readTableRaw(name: string): any {
    const url = new URL(`../assets/remoteRef/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, 'utf8'));
}

/**
 * `RefUtil.compressKeyRefDataFix` 的等价精简版 —— 只保留决定成败的那条分支：
 * `data.c === 1` 才展开 `{k,v}`，否则原样返回。
 */
function refUtilUnwrap(payload: any): any {
    if (!payload || typeof payload !== 'object' || payload.c !== 1) return payload;
    const keys: unknown[] = payload.k;
    const values: unknown[][] = payload.v;
    if (!Array.isArray(keys) || keys.length === 0 || !Array.isArray(values)) return payload;
    return values.map((row) => {
        const item: Record<string, unknown> = {};
        row.forEach((value, index) => { item[String(keys[index])] = value; });
        return item;
    });
}

test('12 张 BigMap 表都带 c:1，经 RefUtil 口径解压后是对象数组', () => {
    const bad: string[] = [];
    for (const name of Object.values(BIGMAP_TABLE)) {
        const raw = readTableRaw(name);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.c !== 1) {
            bad.push(`${name}(缺 c:1)`);
            continue;
        }
        const unwrapped = refUtilUnwrap(raw);
        if (!Array.isArray(unwrapped) || unwrapped.length === 0) bad.push(`${name}(解压后非数组或为空)`);
    }
    assert.deepEqual(bad, [], `这些表在运行时会被 RefConfigService 读成空数组：${bad.join('、')}`);
});

test('按运行时口径取到 12 张表后，parseBigMapConfig 不抛错', () => {
    const tables: Record<string, unknown> = {};
    for (const name of Object.values(BIGMAP_TABLE)) tables[name] = refUtilUnwrap(readTableRaw(name));
    const config = parseBigMapConfig(tables as BigMapRawTables);
    assert.equal(config.world.rows, 40);
    // 策划表 `baseBuilding`：每座田一个 id，共 23 行（旧推算表只有 8 行）。
    assert.equal(config.buildings.size, 23);
});

test('守卫：RefUtil 的解压门槛仍是 c == 1（口径漂移时本用例先红）', () => {
    const source = readFileSync(REF_UTIL_URL, 'utf8');
    assert.match(
        source,
        /data_\.c\s*==\s*1/,
        'RefUtil.compressKeyRefDataFix 的解压条件变了，上面的 refUtilUnwrap 需同步',
    );
});
