/**
 * `tools/verify/verify.mjs` 的**路由解析守卫**。
 *
 * 为什么要专门钉它：这张「规范路由与最小验证」表 2026-10-31 刚从 `AGENTS.md` 整体搬到
 * `docs/agent/` 下，搬的同时表头措辞也改了（第一列从「涉及模块 / 目录」变成
 * 「命中路径（glob，机器读）」）。老解析器**靠匹配表头文字**来定位表格 ⇒ 命中数掉到 0 ⇒
 * 路由整体静默失效、只剩兜底推导在跑，而工具照样打印 PASS。
 *
 * 本用例钉三件事：表能解析出来、路径 glob 能命中源码文件、以及**改表头措辞不影响解析**。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoutes, parseRows, matchRoute, routeSources, selectTests } from '../tools/verify/verify.mjs';

const ROOT = join(__dirname, '..');
const TABLE = join(ROOT, 'docs', 'agent', '规范路由与最小验证.md');

test('路由真源解析成功：规范表能解析出行，且不止「兜底推导」在兜着', () => {
    const { ok, rows, sources } = parseRoutes();
    assert.equal(ok, true, '路由表必须能解析出行，否则 check 的「零新增」是降级口径');
    assert.ok(rows.length >= 30, `路由行数应 ≥30，实际 ${rows.length}`);
    assert.ok(sources.some((s) => s.includes('规范路由与最小验证')),
        `路由真源里必须含规范表，实际：${sources.join(' | ')}`);
});

test('规范表第一列的路径 glob 能命中源码改动文件', () => {
    const { rows } = parseRoutes();
    const bigmap = rows.find((r) => r.paths.includes('assets/script/app/bigmap/**'));
    assert.ok(bigmap, '规范表必须有绑定 `assets/script/app/bigmap/**` 的行');
    assert.ok(bigmap.tests.includes('tests/bigmap-world.test.ts'),
        `该行必须绑定 bigmap 用例，实际：${bigmap.tests.join(', ')}`);

    assert.equal(matchRoute(bigmap, 'assets/script/app/bigmap/view/BigMapPage.ts'), true);
    assert.equal(matchRoute(bigmap, 'assets/script/app/bigmap/model/BigMapBase.ts'), true);
    assert.equal(matchRoute(bigmap, 'assets/script/app/league/LeaguePage.ts'), false);
});

test('解析走结构识别：表头措辞被改写后仍能解析出同样的行数', () => {
    const original = readFileSync(TABLE, 'utf8').split(/\r?\n/);
    const before = parseRows(original);

    const renamed = original.map((line) =>
        line.includes('功能 / 改动范围') ? line.replace('功能 / 改动范围', '随便换个列名') : line);
    assert.notEqual(renamed.join('\n'), original.join('\n'), '前置：表头确实被改了');
    const after = parseRows(renamed);

    assert.equal(after.length, before.length, '表头措辞不应影响解析结果');
    assert.deepEqual(after.map((r) => r.tests), before.map((r) => r.tests), '绑定用例不应随表头措辞变化');
});

test('改动文件能被路由到用例：bigmap 源码 ⇒ bigmap 用例集', () => {
    const selection = selectTests(['assets/script/app/bigmap/view/BigMapPage.ts']);
    assert.equal(selection.routeOk, true);
    assert.ok(selection.tests.some((t) => t.startsWith('tests/bigmap')),
        `应路由到 bigmap 用例，实际：${selection.tests.slice(0, 5).join(', ')}`);
});
