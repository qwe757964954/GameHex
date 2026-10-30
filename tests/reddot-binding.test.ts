/**
 * 红点（`@property` 名为 `redDot*`）的**「声明类型 ↔ prefab 里实际引用的对象」**对账。
 *
 * ## 起因（2026-09-28）
 *
 * 点开服庆典「详细排名」之外的另一条线：首充弹窗 `FirstRechargePage.onOpen` 抛
 * `TypeError: this.redDot.setRedDot is not a function`（`FirstRechargeTierTab.render`）。
 * 根因是 **`@property({ type: RedDot })` 声明的是组件，prefab 里绑的却是 cc.Node** ——
 * Cocos **不会**把 Node 自动转成组件，字段里就躺着一个 `cc.Node`，`setRedDot` 是 undefined。
 * 全项目一次扫出 **16 处**（首充 4 + 七日 11 + 共用 TabButton 1 条未绑），只有
 * `FirstRechargePage.buyRedDot` 一条是对的 —— 典型「对错混着」。
 *
 * ## 为什么必须按「声明」对账，而不是一律按 Node
 *
 * 本项目两套口径**并存**，都对（别去统一它们，改动面太大）：
 *
 * | 口径 | 声明 | 用法 | 出现处 |
 * |---|---|---|---|
 * | A | `@property({ type: Node })` | 只控 `active` / 自己 `getComponent` | 庆典 `OSTabButton` / `OSRankEntryButton`、挂机 `HangSweepButton` |
 * | B | `@property({ type: RedDot })` | 直接 `this.redDot.setRedDot(n)` | 首充、七日、`common/TabButton` |
 *
 * 所以判据是「声明 Node ⇒ 期望 `cc.Node`；声明 RedDot ⇒ 期望 RedDot 组件」。
 *
 * ## 跨 prefab 实例的正确形态（别误报）
 *
 * `common/TabButton.prefab` 里红点是 **RedDot.prefab 的嵌套实例**，跨实例引用落盘后
 * 组件字段**本来就是 `null`**，真正的引用在根 `cc.PrefabInfo.targetOverrides` 里
 * （`propertyPath = ['redDot']` + `targetInfo.localID`）⇒ 见到 `null` 必须先查这一层再判。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Cocos 的 uuid → 23 位压缩 cid（与 `tmp/cid_map_scan.mjs` 同一算法，这里内联以免测试依赖 tmp）。 */
function compressUuid(uuid: string): string | null {
    const s = String(uuid).replace(/-/g, '');
    if (s.length !== 32) return null;
    let out = s.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const a = parseInt(s[i], 16), b = parseInt(s[i + 1], 16), c = parseInt(s[i + 2], 16);
        out += B64[(a << 2) | (b >> 2)] + B64[((b & 3) << 4) | c];
    }
    return out;
}

const RED_DOT_CID = compressUuid(JSON.parse(readFileSync('assets/script/app/common/RedDot.ts.meta', 'utf8')).uuid)!;

/** 从 .ts 抓「@property 里字段名含 redDot（不分大小写）」的声明 ⇒ `{ 字段: 'Node' | 'RedDot' }`。 */
function redDotDeclsOf(tsPath: string): Array<{ field: string; kind: 'Node' | 'RedDot' }> {
    const src = readFileSync(tsPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
    const out: Array<{ field: string; kind: 'Node' | 'RedDot' }> = [];
    const re = /@property\(\{[^}]*type:\s*(Node|RedDot)[^}]*\}\)\s*\n\s*(?:private\s+|public\s+|protected\s+)?(\w+)\s*:\s*(Node|RedDot)/g;
    for (const m of src.matchAll(re)) {
        if (!/reddot/i.test(m[2])) continue;
        out.push({ field: m[2], kind: m[1] as 'Node' | 'RedDot' });
    }
    return out;
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const e of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, ext, out);
        else if (e.name.endsWith(ext)) out.push(p);
    }
    return out;
}

/** 脚本 cid → { 类名, 字段声明 }。 */
const decls = new Map<string, { cls: string; fields: Array<{ field: string; kind: 'Node' | 'RedDot' }> }>();
for (const ts of walk('assets/script', '.ts')) {
    const meta = ts + '.meta';
    if (!existsSync(meta)) continue;
    const fields = redDotDeclsOf(ts);
    if (!fields.length) continue;
    const cid = compressUuid(JSON.parse(readFileSync(meta, 'utf8')).uuid);
    if (cid) decls.set(cid, { cls: path.basename(ts, '.ts'), fields });
}

test('声明类型与 prefab 引用一一对应（绑成 Node 却声明组件 ⇒ setRedDot is not a function）', () => {
    assert.ok(decls.size >= 6, `至少要覆盖首充 / 七日 / TabButton / 庆典 / 挂机的红点字段，实际 ${decls.size}`);

    const bad: string[] = [];
    const unbound: string[] = [];
    let checked = 0;

    for (const prefab of walk(assetPath('ui'), '.prefab')) {
        const o = JSON.parse(readFileSync(prefab, 'utf8')) as Array<Record<string, any>>;
        // 根 PrefabInfo 的 targetOverrides（跨嵌套实例引用的正确形态）
        const rootNode = o.find((e) => e && e.__type__ === 'cc.Node' && e._parent == null) ?? o[1];
        const rootInfo = rootNode && rootNode._prefab ? o[rootNode._prefab.__id__] : null;
        const overridden = new Set<string>();
        for (const r of (rootInfo && rootInfo.targetOverrides) || []) {
            const info = o[r.__id__];
            if (!info || !Array.isArray(info.propertyPath)) continue;
            // 记下「source 组件 id → 属性名」
            overridden.add(`${info.source.__id__}:${info.propertyPath[0]}`);
        }

        o.forEach((comp, idx) => {
            if (!comp || typeof comp.__type__ !== 'string') return;
            const d = decls.get(comp.__type__);
            if (!d) return;
            for (const { field, kind } of d.fields) {
                const ref = comp[field];
                checked += 1;
                if (ref == null) {
                    if (overridden.has(`${idx}:${field}`)) continue;    // 跨实例引用：字段为 null 是对的
                    // ⚠️ 未绑**不一定**是 bug：`SevenDayPointBox` / `LeagueNorthExpeditionPage.challengeRedDot`
                    //    就是「prefab 里故意不建红点节点」，代码侧判空 / 有路径兜底 ⇒ 只列不断言。
                    unbound.push(`${prefab} ${d.cls}.${field}（声明 ${kind}）`);
                    continue;
                }
                const target = typeof ref.__id__ === 'number' ? o[ref.__id__] : null;
                const got = target ? String(target.__type__) : `非引用(${JSON.stringify(ref)})`;
                const want = kind === 'Node' ? 'cc.Node' : RED_DOT_CID;
                if (got !== want) bad.push(`${prefab} ${d.cls}.${field} 声明 ${kind} 但指向 ${got}`);
            }
        });
    }

    assert.deepEqual(bad, [], `红点引用绑错（共检查 ${checked} 条）：\n  ${bad.join('\n  ')}`);
    assert.ok(checked >= 20, `红点字段太少了（${checked}），正则大概是没匹配上`);
    if (unbound.length) console.log(`  [未绑 ${unbound.length} 条，代码侧须判空 / 有兜底]\n    ${unbound.join('\n    ')}`);
});
