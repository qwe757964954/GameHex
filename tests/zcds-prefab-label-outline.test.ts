import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 预制体卫生：**全工程不许出现 `cc.LabelOutline`**。
 *
 * 3.8.2 起 `cc.LabelOutline` 只剩一个纯转发空壳（`@deprecated since v3.8.2`）：
 *   `get/set color` → `label.outlineColor`、`get/set width` → `label.outlineWidth`、
 *   `onEnable()` → `label.enableOutline = true`、`onDisable()` → `label.enableOutline = false`。
 * 它自己已经**不再有 `_color`/`_width` 字段**（序列化出来是 `undefined`），所以：
 *   ① 写它的属性既不落盘也不生效，还不报错；
 *   ② 留在 prefab 里，编辑器每次 dump 节点（`encodeComponent`）都会去读那两个 getter，
 *      刷一片 `'LabelOutline.color/width' is deprecated`（2026-10-10 用户拿这几条来问的就是它）；
 *   ③ **删它的时候有坑**：`onDisable()` 会把 `label.enableOutline` 置 false
 *      ⇒ 删完必须把 Label 内建描边重新打开，否则描边静默消失。
 *
 * 约定：描边**只用 Label 内建** `enableOutline` / `outlineColor` / `outlineWidth`。
 * 同口径见 `tests/league.test.ts:570`、`tests/league-hall.test.ts:491`、`tests/league-hall-sub.test.ts:541`
 * （那三条覆盖 League 那几个；这条覆盖 `assets/resources/ui/**` 全部，避免只在某一批里守）。
 */
const UI_ROOT = 'assets/resources/ui';

function collectPrefabs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collectPrefabs(full, out);
        else if (entry.endsWith('.prefab')) out.push(full);
    }
    return out;
}

test('★预制体一律不许有已废弃的 cc.LabelOutline（描边走 Label 内建）', () => {
    const prefabs = collectPrefabs(UI_ROOT);
    assert.ok(prefabs.length >= 100, `扫到的 prefab 太少（${prefabs.length}）—— 目录结构可能变了`);

    const offenders: string[] = [];
    for (const file of prefabs) {
        let raw: unknown;
        try {
            raw = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            continue; // 非 JSON 的 .prefab 不是本用例的职责
        }
        if (!Array.isArray(raw)) continue;
        const count = raw.filter(
            (o) => !!o && typeof o === 'object' && (o as { __type__?: string }).__type__ === 'cc.LabelOutline',
        ).length;
        if (count > 0) offenders.push(`${file}(${count})`);
    }
    assert.deepEqual(offenders, [],
        `★这些 prefab 还挂着已废弃的 cc.LabelOutline：${offenders.join(', ')}（改挂到 Label 内建 enableOutline）`);
});
