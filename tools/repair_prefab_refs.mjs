// 修 prefab 里「指向数组外」的 `_prefab` 引用（离线修资源，不参与运行时）。
//
// 症状：引擎加载时报
//   TypeError: Cannot read properties of undefined (reading '__type__')
//   at _deserialize / _deserializeAndAssignField
// 因为 `_prefab` 的 `__id__` 越界 ⇒ 反序列化拿到 `undefined` ⇒ 读它的 `__type__` 直接炸，
// 整个 prefab 加载失败（战斗里表现为「技能特效美术补栽后仍取不到，只能画通用短线」）。
//
// 成因：`tools/build_leidan_fx.py` / `tools/build_blink_fx.py` 把 `_prefab` 的下标**写死**成
// `7/9`，而实际 `cc.PrefabInfo` 在 `6/8`（差一）—— 现在两个脚本已改成末尾回填 `len(doc) - 1`。
//
// 修法故意保守：只处理「字段名以 `_prefab` 结尾、目标越界、且全文恰有一个 `cc.PrefabInfo`」
// 的情况，重指到那个 `cc.PrefabInfo`；其它形态一律只报告不改，避免猜错。
//
// 用法：
//   node tools/repair_prefab_refs.mjs            # 只报告
//   node tools/repair_prefab_refs.mjs --write    # 修并写回

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'assets';
const WRITE = process.argv.includes('--write');

function walkPrefabs(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walkPrefabs(path, out);
        } else if (entry.name.endsWith('.prefab')) {
            out.push(path);
        }
    }
    return out;
}

/** 收集越界引用：路径 -> id。只沿对象/数组走，`__id__` 只认数字。 */
function collectBadRefs(value, where, length, out) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectBadRefs(item, `${where}[${index}]`, length, out));
        return;
    }
    if (typeof value.__id__ === 'number') {
        if (value.__id__ < 0 || value.__id__ >= length) out.push({ where, holder: value, id: value.__id__ });
        return;
    }
    for (const key of Object.keys(value)) collectBadRefs(value[key], where ? `${where}.${key}` : key, length, out);
}

const files = walkPrefabs(ROOT);
let fixedFiles = 0;
const unresolved = [];

for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc)) continue;

    const bad = [];
    collectBadRefs(doc, '', doc.length, bad);
    if (bad.length === 0) continue;

    const infos = doc
        .map((entry, index) => (entry && entry.__type__ === 'cc.PrefabInfo' ? index : -1))
        .filter((index) => index >= 0);

    const shown = relative(process.cwd(), file).replace(/\\/g, '/');
    const fixable = bad.filter((item) => item.where.split('.').pop() === '_prefab' && infos.length === 1);
    for (const item of bad) {
        const tag = fixable.includes(item) ? 'FIX' : 'SKIP';
        console.log(`[${tag}] ${shown}  ${item.where} -> __id__ ${item.id}（数组长 ${doc.length}）`);
    }

    for (const item of fixable) {
        item.holder.__id__ = infos[0];
        console.log(`      ${item.where} 重指到 cc.PrefabInfo #${infos[0]}`);
    }
    if (fixable.length === 0) {
        unresolved.push(shown);
        continue;
    }
    fixedFiles += 1;
    if (WRITE) writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
}

console.log('---');
console.log(`扫描 prefab ${files.length} 个，越界 ${fixedFiles} 个文件${WRITE ? '已修并写回' : '（只报告，加 --write 才改）'}`);
if (unresolved.length) {
    console.log(`未能自动判断（需人工）：\n  ${unresolved.join('\n  ')}`);
    process.exitCode = 1;
}
