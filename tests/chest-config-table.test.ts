import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * 宝箱配置表（`X-新宝箱配置 .xlsx` 的「宝箱配置」sheet → `newTreasureBoxConfig`）守卫。
 *
 * 详情弹窗的「宝箱名」只认这张表的 `cardBoxName`，所以两份产物必须同时在位：
 * - `assets/remoteRef/*.json`：运行时走 `RefUtil` 读的那份（压缩表 `{k,v,c}`）
 * - `../doc/塔防数据配置/json/client/*.json`：用例夹具 / 服务端那份（纯数组）
 *
 * 两份**从来没有互校过**（一份走 bundle、一份走磁盘），漂移时零报错 —— 曾经
 * `cardBoxName` 只补了一半也全绿，表现就是详情里一直显示 `宝箱19001`。
 */

const RUNTIME = 'assets/remoteRef/newTreasureBoxConfig.json';
const FIXTURE = '../doc/塔防数据配置/json/client/newTreasureBoxConfig.json';
const KEY = 'cardBoxID';

type Row = Record<string, unknown>;

/** 复刻 `tools/ref/ref_compress_json.py` 的列压缩：`{k, v, c:1}` → 对象数组。 */
function decompress(raw: unknown): Row[] {
    const table = raw as { k: string[]; v: unknown[][]; c?: number };
    if (!Array.isArray(table?.k) || !Array.isArray(table?.v)) return raw as Row[];
    return table.v.map((cells) => Object.fromEntries(table.k.map((key, index) => [key, cells[index]])));
}

function load(): { runtime: Row[]; fixture: Row[] } {
    return {
        runtime: decompress(JSON.parse(readFileSync(RUNTIME, 'utf8'))),
        fixture: JSON.parse(readFileSync(FIXTURE, 'utf8')) as Row[],
    };
}

/** 结构比较：`json` 列是数组/对象，不能按引用比；对象键序不算差异，所以排序后再序列化。 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Row).sort()
            .map((key) => `${JSON.stringify(key)}:${canonical((value as Row)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

/** 按主键对齐后逐格比对；空值统一成 `null`（压缩表存 null、纯数组存省略键）。 */
function collectDrift(left: readonly Row[], right: readonly Row[]): string[] {
    const index = (rows: readonly Row[]) => new Map(rows.map((row) => [String(row[KEY]), row]));
    const a = index(left);
    const b = index(right);
    const issues: string[] = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        if (!a.has(id) || !b.has(id)) {
            issues.push(`${id}: 只有 ${a.has(id) ? RUNTIME : FIXTURE} 有这一行`);
            continue;
        }
        const leftRow = a.get(id) as Row;
        const rightRow = b.get(id) as Row;
        for (const key of new Set([...Object.keys(leftRow), ...Object.keys(rightRow)])) {
            if (canonical(leftRow[key]) !== canonical(rightRow[key])) {
                issues.push(`${id}.${key}: runtime=${canonical(leftRow[key])} fixture=${canonical(rightRow[key])}`);
            }
        }
    }
    return issues;
}

test('比对器自证：缺行 / 缺键 / 值不同都必须报出来，不能恒空', () => {
    const base: Row[] = [{ cardBoxID: 19001, cardBoxName: '幼苗初级箱' }];
    assert.deepEqual(collectDrift(base, base), []);
    const drift = collectDrift(base, [{ cardBoxID: 19001, cardBoxName: '青铜宝箱' }]);
    assert.equal(drift.length, 1, '值不同要报');
    assert.match(drift[0], /cardBoxName/);
    assert.equal(collectDrift(base, []).length, 1, '缺行要报');
    assert.equal(collectDrift(base, [{ cardBoxID: 19001 }]).length, 1, '缺键要报');
    assert.equal(collectDrift(base, [{ cardBoxID: 19002, cardBoxName: '幼苗初级箱' }]).length, 2, '主键对不上要报');
});

test('运行时表与用例夹具逐行逐列一致（含新加的 cardBoxName）', () => {
    const { runtime, fixture } = load();
    assert.ok(runtime.length > 0, `${RUNTIME} 读出 0 行`);
    const drift = collectDrift(runtime, fixture);
    assert.deepEqual(drift, [], `宝箱表两份产物漂移：\n${drift.join('\n')}`);
    // 反向防空转：两份都为空时上面的相等断言恒真
    assert.ok(fixture.length > 0, `${FIXTURE} 读出 0 行`);
    // 新列必须真的在 `k` 里 —— xlsx 填了值 ≠ 产物里有（r2 导出标记留空就整列静默消失）
    assert.ok('cardBoxName' in (runtime[0] ?? {}), `${RUNTIME} 的 k 里没有 cardBoxName`);
});

test('每个宝箱都有非空名称 —— 详情弹窗不靠 宝箱{id} 兜底', () => {
    for (const row of load().runtime) {
        const name = typeof row.cardBoxName === 'string' ? row.cardBoxName.trim() : '';
        assert.notEqual(name, '', `${row[KEY]} 缺 cardBoxName，详情会退化成 宝箱${row[KEY]}`);
    }
});
