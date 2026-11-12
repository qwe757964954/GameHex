/**
 * prefab 引用完整性守卫：`__id__` 不许越界，`_prefab` 必须真的指到 `cc.PrefabInfo`。
 *
 * ## 为什么有这个文件
 *
 * 2026-11-09 实机报「战斗中的特效加载失败」：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading '__type__')
 *     at _deserialize / _deserializeAndAssignField / _deserializeFirClass …
 * [ZCGameRenderWorld] 技能特效美术补栽后仍取不到，只能画通用短线（3s 仍未到账…）
 *        units/projectiles/雷弹攻击/雷弹攻击
 * ```
 *
 * 真因不在加载代码，而在**资源本身**：`雷弹攻击.prefab` 的数组只有 7 个条目（下标 0~6），
 * 根节点的 `_prefab` 却写着 `{"__id__": 7}` —— 差一。引擎反序列化把 `__id__` 直接当数组下标取，
 * 拿到 `undefined` 后再读 `.__type__` 就抛错，**整个 prefab 加载失败**，于是只剩程序化兜底短线。
 *
 * 三个文件同时中招（`雷弹攻击` / `雷弹命中` / `瞬间移动特效`），成因是
 * `tools/build_leidan_fx.py` / `tools/build_blink_fx.py` 把 `_prefab` 的下标**写死**成 `7 / 9`，
 * 而真实的 `cc.PrefabInfo` 在 `6 / 8`。两个脚本已改成末尾回填 `len(doc) - 1`；
 * 这个守卫负责「下次又有人写死 / 又有人手改 prefab」时当场变红。
 *
 * ## 为什么不是「只查那三个文件」
 *
 * 这类错误**不报文件名、只报一堆 `_deserialize` 栈**，从日志反推要翻半天；
 * 而全量扫描 260 个 prefab 只要几十毫秒。所以按「所有 prefab」扫，不做白名单。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

interface IPrefabEntry {
    __type__?: string;
    [key: string]: unknown;
}

/** 递归列出 `assets` 下所有 `.prefab`（跳过引擎生成目录，它们不是源码）。 */
function collectPrefabs(dir = 'assets', out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'library' || entry.name === 'temp' || entry.name === 'build') continue;
            collectPrefabs(path, out);
        } else if (entry.name.endsWith('.prefab')) {
            out.push(path);
        }
    }
    return out;
}

/**
 * 收集越界的 `__id__`：返回 `{ where, id }` 列表。
 *
 * 只沿对象/数组走，`__id__` 只认数字 —— 字符串里的 `"__id__"` 不是引用。
 */
function outOfRangeRefs(value: unknown, where: string, length: number, out: Array<{ where: string; id: number }>): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => outOfRangeRefs(item, `${where}[${index}]`, length, out));
        return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.__id__ === 'number') {
        const id = record.__id__;
        if (id < 0 || id >= length) out.push({ where, id });
        return;
    }
    for (const key of Object.keys(record)) {
        outOfRangeRefs(record[key], where ? `${where}.${key}` : key, length, out);
    }
}

const PREFAB_FILES = collectPrefabs();

test('扫描范围有效：能扫到战斗里的特效 prefab（防目录改名后守卫变空转）', () => {
    assert.ok(PREFAB_FILES.length > 200, `只扫到 ${PREFAB_FILES.length} 个 prefab，路径规则是不是失效了`);
    const normalized = PREFAB_FILES.map((file) => file.replace(/\\/g, '/'));
    for (const probe of [
        'assets/bundles/battle/units/projectiles/雷弹攻击/雷弹攻击.prefab',
        'assets/bundles/battle/units/projectiles/雷弹命中/雷弹命中.prefab',
        'assets/bundles/battle/units/projectiles/瞬间移动特效/瞬间移动特效.prefab',
    ]) {
        assert.ok(normalized.includes(probe), `清单里没有 ${probe}`);
    }
});

test('所有 prefab 的 `__id__` 都不越界（越界 = 引擎 `_deserialize` 读 undefined.__type__ 必炸）', () => {
    const broken: string[] = [];
    for (const file of PREFAB_FILES) {
        const shown = relative('.', file).replace(/\\/g, '/');
        let doc: unknown;
        try {
            doc = JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
            broken.push(`${shown}: JSON 解析失败 —— ${(error as Error).message}`);
            continue;
        }
        if (!Array.isArray(doc)) continue;
        const bad: Array<{ where: string; id: number }> = [];
        outOfRangeRefs(doc, '', doc.length, bad);
        for (const item of bad) {
            broken.push(`${shown}: ${item.where} 的 __id__ ${item.id} 越界（数组长 ${doc.length}）`);
        }
    }
    assert.deepEqual(broken, [], `prefab 里有指向数组外的引用：\n  ${broken.join('\n  ')}`);
});

test('根节点的 `_prefab` 必须指到 `cc.PrefabInfo`（只判「在范围内」拦不住指错格）', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const file of PREFAB_FILES) {
        const shown = relative('.', file).replace(/\\/g, '/');
        const doc = JSON.parse(readFileSync(file, 'utf8')) as IPrefabEntry[];
        if (!Array.isArray(doc)) continue;
        const prefab = doc[0];
        if (!prefab || prefab.__type__ !== 'cc.Prefab') continue;
        const rootId = (prefab.data as { __id__?: number } | undefined)?.__id__ ?? 1;
        const root = doc[rootId];
        assert.ok(root, `${shown}: cc.Prefab.data 指向 ${rootId}，越界`);
        if (root.__type__ !== 'cc.Node') continue;
        const ref = (root._prefab as { __id__?: number } | undefined)?.__id__;
        assert.equal(typeof ref, 'number', `${shown}: 根节点缺 _prefab 引用`);
        const target = doc[ref as number];
        checked += 1;
        if (!target || target.__type__ !== 'cc.PrefabInfo') {
            wrong.push(`${shown}: 根节点 _prefab -> #${String(ref)}，实际是 ${target ? String(target.__type__) : '越界'}`);
            continue;
        }
        // PrefabInfo 必须回指同一个根节点，且 asset 指向 cc.Prefab（两条都反了说明索引错位）
        assert.equal((target.root as { __id__?: number }).__id__, rootId, `${shown}: PrefabInfo.root 没回指根节点`);
        assert.equal((target.asset as { __id__?: number }).__id__, 0, `${shown}: PrefabInfo.asset 没指向 cc.Prefab`);
    }
    assert.ok(checked > 200, `只校验到 ${checked} 个 prefab 根节点，遍历没走全`);
    assert.deepEqual(wrong, [], `根节点 _prefab 指错了：\n  ${wrong.join('\n  ')}`);
});
