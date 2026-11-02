#!/usr/bin/env node
/**
 * verify.mjs —— Demo3.8 验收流水线
 *
 * 存在理由：
 *   本工程基线长期带红（全量用例 4294 中 166 失败、assets/script 下 tsc 269 条错误），
 *   "跑一遍看绿不绿" 已经失去判定力 —— 改完之后没人能回答"这次改动引入回归了吗"。
 *   唯一有效判据是「相对基线是否新增」，本脚本把这条口径固化成命令。
 *
 * 用法：
 *   node tools/verify/verify.mjs route       只打印"你动了这些文件 → 该跑这些用例"（不执行）
 *   node tools/verify/verify.mjs check       跑 diff 命中的最小用例集 + tsc，对比基线（推荐，快）
 *   node tools/verify/verify.mjs full        全量用例 + tsc，对比基线
 *   node tools/verify/verify.mjs baseline    重算并落盘基线快照
 *
 * 退出码：0 = 相对基线零新增；1 = 有新增；2 = 工具自身出错
 *
 * 约定：本文件是 .mjs 不是 .ts —— 工程 tsconfig 无 include，放 .ts 会被全量编译扫进去。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASELINE = path.join(ROOT, 'tmp', 'verify', 'baseline.json');

/**
 * 路由表真源。历史教训：这张表 2026-10-31 从 AGENTS.md 整体迁到 docs/agent/ 下，
 * 任何硬编码单一路径的护栏都会在搬家当天静默失效（表现为"路由命中数突降到 0"）。
 * 所以这里扫多个候选；真源再搬一次，只需往数组里加一行。
 */
const ROUTE_SOURCES = ['AGENTS.md', 'docs/agent/规范路由与最小验证.md', 'docs/agent/规范路由与最小验证表.md'];

/**
 * 路由表候选源 = 显式清单 ∪ 自动扫描（根目录 `*.md` + `docs/**\/*.md`）。
 *
 * 只靠清单不够：这张表历史上已经整体搬过一次家（`AGENTS.md` → `docs/agent/`），
 * 搬家不会通知工具。自动扫描让「新放一份规范表」自动被看见，清单只负责排序优先。
 */
function routeSources() {
  const seen = new Set(ROUTE_SOURCES.map(norm));
  const out = ROUTE_SOURCES.slice();
  const push = (rel) => {
    const key = norm(rel);
    if (!seen.has(key) && key.endsWith('.md')) { seen.add(key); out.push(key); }
  };
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile()) push(entry.name);
  }
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full, depth + 1);
      else push(path.relative(ROOT, full));
    }
  };
  const docsDir = path.join(ROOT, 'docs');
  if (fs.existsSync(docsDir)) walk(docsDir, 0);
  return out;
}

const norm = (p) => p.replace(/\\/g, '/');
const run = (cmd, opts = {}) =>
  spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, ...opts });

// ---------------------------------------------------------------- 改动文件

function changedFiles() {
  const svn = run('svn status');
  if (svn.status === 0 && svn.stdout.trim()) {
    return svn.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => norm(l.split(/\s+/).slice(1).join(' ')));
  }
  const git = run('git status --porcelain');
  if (git.status === 0 && git.stdout.trim()) {
    return git.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => norm(l.slice(3)));
  }
  return [];
}

// ------------------------------------------------- AGENTS.md 路由表 → 规则

/** 反引号 token + 裸路径片段 ⇒ 匹配键（见 `keysOf` 注释）。 */
function keysOf(text) {
  const keys = [];
  const src = String(text);
  for (const m of src.matchAll(/`([^`]+)`/g)) keys.push(norm(m[1].trim()));
  // 不带反引号的路径片段（表头或说明里直接写了 `assets/script/app/...`）
  for (const p of src.matchAll(/(?:assets|tools|tests|docs|extensions)\/[^\s`、,，；;)|]+/g)) keys.push(norm(p[0]));
  return keys.filter(Boolean);
}

/**
 * 把「命中路径 / 目录 | 功能 | 规范章节 | 最小验证命令」这类表解析成 (matchKey -> tests[])。
 *
 * 🔴 **结构识别，不认表头措辞**（2026-10-31 修）：
 * 老版本靠匹配表头文字「涉及模块 / 目录」来定位表格，而这行字随规范文档一起被改写过
 * （新版第一列叫「命中路径（glob，机器读）」）⇒ 解析到 0 行 ⇒ 路由表整体静默失效，
 * 只剩兜底推导在跑（表现为「待跑用例数从设计值掉到 52」），而工具还照样打印 PASS。
 * 现在改成：把连续的 `|` 行切成块，**挑 `tests/*.test.ts` 命中行最多的那块**当路由表，
 * 表头/分隔行因为没有 `tests/` 引用自动被跳过 ⇒ 表头怎么改名都不影响。
 */
function parseRows(lines) {
  const blocks = [];
  let cur = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('|')) { cur.push(line); continue; }
    if (cur.length) { blocks.push(cur); cur = []; }
  }
  if (cur.length) blocks.push(cur);

  let best = [];
  for (const block of blocks) {
    const rows = [];
    for (const line of block) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.length < 3) continue;
      // 分隔行：所有格子都是 --- / :--: 之类
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

      const joined = cells.join(' ');
      const tests = [...joined.matchAll(/(tests\/[\w\-./]+?\.test\.ts)/g)].map((m) => m[1]);
      if (!tests.length) continue; // 表头行 / 无绑定入口的行

      const keys = new Set();
      for (const col of cells) for (const k of keysOf(col)) keys.add(k);
      rows.push({
        title: cells[cells.length - 3]?.replace(/[`*]/g, '').slice(0, 40) ?? '',
        paths: cells[0],
        keys: [...keys],
        tests: [...new Set(tests)],
      });
    }
    if (rows.length > best.length) best = rows;
  }
  return best;
}

function parseRoutes() {
  const all = [];
  const found = [];
  for (const rel of routeSources()) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const r = parseRows(text.split(/\r?\n/));
    if (r.length) { found.push(`${rel}(${r.length})`); all.push(...r); }
  }
  const ok = all.length > 0;
  if (!ok) {
    console.error('❌ 路由真源全部失效：没有在任何候选 md 里解析到「带 tests/*.test.ts 的表格」。');
    console.error(`   已扫：${routeSources().length} 个候选（根目录 *.md + docs/**/*.md）`);
    console.error('   → 规范表多半又搬家 / 改列名了，跑 `node tools/verify/verify.mjs route` 看命中。');
  } else if (typeof process !== 'undefined' && process.env.VERIFY_DEBUG) {
    console.error(`[debug] 路由源：${found.join(' + ')}`);
  }
  return { rows: all, ok, sources: found };
}

function matchRoute(row, file) {
  const f = norm(file);
  const base = path.basename(f);
  for (const k of row.keys) {
    // glob 尾巴：`assets/script/app/zcds/**` ⇒ 前缀包含即命中
    const clean = k.replace(/\*+$/, '').replace(/\/$/, '');
    if (!clean) continue;
    if (clean.includes('/')) { if (f.includes(clean)) return true; }
    else if (base.includes(clean)) return true;
  }
  return false;
}

let _testFiles = null;
function listTestFiles() {
  if (!_testFiles) {
    _testFiles = fs
      .readdirSync(path.join(ROOT, 'tests'))
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => `tests/${f}`);
  }
  return _testFiles;
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ------------------------------------------- import 可达图（比规范表更硬的判据）

const SPEC_RE = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;

function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
    try { if (fs.statSync(cand).isFile()) return norm(path.relative(ROOT, cand)); } catch {}
  }
  return null;
}

let _importsOf = null;
/** `file → 它直接 import 的仓库内文件集合`（按需建，跑一次就缓存）。 */
function importsOf(file) {
  if (!_importsOf) _importsOf = new Map();
  const cached = _importsOf.get(file);
  if (cached) return cached;
  const out = new Set();
  let text = '';
  try { text = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch {}
  for (const m of text.matchAll(SPEC_RE)) {
    const hit = resolveSpec(path.join(ROOT, file), m[1]);
    if (hit) out.add(hit);
  }
  _importsOf.set(file, out);
  return out;
}

let _reachable = null;
/** `sourceFile → 能到达它的 tests/*.test.ts 列表`（反向可达）。 */
function reverseTestIndex() {
  if (_reachable) return _reachable;
  _reachable = new Map();
  for (const test of listTestFiles()) {
    const seen = new Set([test]);
    const stack = [test];
    while (stack.length) {
      const cur = stack.pop();
      for (const next of importsOf(cur)) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    for (const file of seen) {
      const list = _reachable.get(file) ?? [];
      list.push(test);
      _reachable.set(file, list);
    }
  }
  return _reachable;
}

/**
 * 兜底推导：规范表没命中时用来兜住，避免出现「改了文件但一个用例都不跑」。
 * 实测 23 个改动文件里只有 2 个能命中老路由表，没有兜底的话 diff 路由形同虚设。
 *   1) import 反向可达：谁（直接或间接）import 了它 ⇒ 跑那些用例（**主判据**）
 *   2) 改动 tests/x.test.ts        → 跑它自己
 *   3) 改动 tests/ 下夹具/helper   → 跑所有 import 了它的用例
 *   4) 同名 manifestation：ZCUnitSystem.ts → tests/zcds-unit-system.test.ts
 *   5) feature 前缀：app/bigmap/…  → tests/bigmap-*.test.ts（超过阈值只提示不展开）
 *
 * 🔴 顺序说明：老版本把「规范表文本匹配」当主判据，结果表一搬家就全掉到兜底。
 * 现在 **import 反向可达优先**（它是机械事实，不随文档措辞变化），规范表只作为
 * 「额外多跑」的补充（可能覆盖 import 图看不到的资源/配置改动）。
 */
const FEATURE_AUTORUN_LIMIT = 12;

function fallbackTests(file) {
  const f = norm(file);
  const out = new Set();
  const wide = [];

  if (f.startsWith('tests/') && f.endsWith('.test.ts')) {
    out.add(f);
  } else if (f.startsWith('tests/')) {
    const stem = path.basename(f).replace(/\.ts$/, '');
    for (const t of listTestFiles()) {
      try {
        if (fs.readFileSync(path.join(ROOT, t), 'utf8').includes(stem)) out.add(t);
      } catch {}
    }
    return [...out];
  }

  const baseRaw = path.basename(f).replace(/\.ts$/, '');
  for (const key of new Set([squash(baseRaw), squash(baseRaw.replace(/^ZC/, ''))])) {
    if (key.length < 8) continue;
    for (const t of listTestFiles()) {
      if (squash(path.basename(t, '.test.ts')).includes(key)) out.add(t);
    }
  }

  const m = /^assets\/script\/(?:app|core|platform|framework)\/([^/]+)\//.exec(f);
  if (m) {
    const prefixed = listTestFiles().filter((t) => squash(path.basename(t)).startsWith(squash(m[1])));
    if (prefixed.length && prefixed.length <= FEATURE_AUTORUN_LIMIT) prefixed.forEach((t) => out.add(t));
    else if (prefixed.length) wide.push(`${m[1]} 域共 ${prefixed.length} 个用例，超限请直接跑 full`);
  }
  return { tests: [...out], wide };
}

function selectTests(files) {
  const { rows: routes, ok: routeOk, sources } = parseRoutes();
  const reverse = reverseTestIndex();
  const picked = new Set();
  const wide = [];
  const hits = [];
  for (const f of files) {
    // 1) import 反向可达 —— 机械事实，文档怎么改都不失效
    const importers = reverse.get(norm(f)) ?? [];
    // 2) 规范表 / 同名 / feature 前缀 —— 补充（覆盖 import 图看不到的配置与资源）
    const matched = routes.filter((r) => matchRoute(r, f));
    const fb = fallbackTests(f);
    const derived = Array.isArray(fb) ? fb : fb.tests;
    if (!Array.isArray(fb) && fb.wide.length) wide.push(...fb.wide);

    hits.push({ file: f, importers, routes: matched.map((r) => r.title), fallback: derived });
    for (const t of importers) picked.add(t);
    for (const t of derived) picked.add(t);
    for (const r of matched) for (const t of r.tests) picked.add(t);
  }
  return {
    tests: [...picked].filter((t) => fs.existsSync(path.join(ROOT, t))).sort(),
    hits,
    wide: [...new Set(wide)],
    routeOk,
    routeSources: sources,
  };
}

// ------------------------------------------------------------------ 采集器

function parseTapFailed(stdout) {
  const names = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^not ok \d+ - (.*)$/.exec(line) || /^not ok \d+ (.*)$/.exec(line);
    if (m) names.push(m[1].trim());
  }
  const sum = { tests: -1, pass: -1, fail: -1 };
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^# (tests|pass|fail)\s+(\d+)/.exec(line);
    if (m) sum[m[1]] = Number(m[2]);
  }
  return { failures: names, summary: sum };
}

function runTests(files) {
  if (!files.length) return { failures: [], summary: { tests: 0, pass: 0, fail: 0 }, cmd: '' };
  const cmd = `npx tsx --test ${files.map((f) => `"${norm(f)}"`).join(' ')}`;
  const r = run(cmd);
  return { ...parseTapFailed(r.stdout || ''), cmd };
}

function runAllTests() {
  const cmd = 'npx tsx --test "tests/**/*.test.ts"';
  const r = run(cmd);
  return { ...parseTapFailed(r.stdout || ''), cmd };
}

/**
 * tsc 错误指纹刻意不含行列号 —— 文件头部增删一行会让全部 269 条错的行号整体位移，
 * 含行列号的 key 会虚报成"269 条新增"，判据直接失效。
 */
function collectTsc() {
  const r = run('npx tsc --noEmit');
  const out = (r.stdout || '') + (r.stderr || '');
  const set = new Set();
  let total = 0;
  for (const line of out.split(/\r?\n/)) {
    if (!/^assets\/script\//.test(line)) continue;
    const m = /^([\w\-./\\]+)\((\d+),(\d+)\):\s+(error TS\d+):\s*(.*)$/.exec(line);
    if (!m) continue;
    total++;
    set.add(`${norm(m[1])}|${m[4]}|${m[5].trim().slice(0, 120)}`);
  }
  return { fingerprints: [...set].sort(), total };
}

// --------------------------------------------------------------------- 差集

const diff = (cur, base) => ({
  added: cur.filter((x) => !base.includes(x)),
  gone: base.filter((x) => !cur.includes(x)),
});

function saveBaseline(cur) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ ts: new Date().toISOString(), ...cur }, null, 2), 'utf8');
}
function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------- CLI

function printRouteHits(sel, files) {
  const uncovered = sel.hits.filter((h) => !h.importers.length && !h.routes.length && !h.fallback.length);
  console.log(`改动 ${files.length} 个文件\n`);
  for (const h of sel.hits) {
    console.log(`  ${norm(h.file)}`);
    if (h.importers.length) console.log(`      → import 可达：${h.importers.length} 个用例`);
    if (h.routes.length) console.log(`      → 规范路由：${h.routes.join(' / ')}`);
    if (h.fallback.length) console.log(`      → 推导：${h.fallback.join(', ')}`);
    if (!h.importers.length && !h.routes.length && !h.fallback.length) {
      console.log(`      → ⚠️ 完全无覆盖：无 import、无路由、无同名用例`);
    }
  }
  if (sel.wide.length) {
    console.log('\n⚠️ 需要全量：');
    sel.wide.forEach((w) => console.log(`   ${w}`));
  }
  if (sel.routeSources.length) console.log(`\n路由真源：${sel.routeSources.join(' + ')}`);
  // 🔴 「改了但一个用例都没跑」必须显式汇总出来：这才是 reviewer 真正要的信号，
  // 淹没在每个文件的缩进行里等于没报。
  if (uncovered.length) {
    console.log(`\n⚠️ 完全无覆盖的改动文件 ${uncovered.length} 个（改了它们不会有任何用例跑）：`);
    uncovered.forEach((h) => console.log(`   ${norm(h.file)}`));
  }
  return uncovered.length;
}

/** CLI 主体，返回退出码（0 零新增 / 1 有新增 / 2 工具自身出错）。 */
function runCli(argv) {
  const mode = argv[2] || 'check';
  const files = changedFiles().filter((f) => /\.(ts|json|prefab|meta)$/.test(f));

  if (mode === 'route') {
    const sel = selectTests(files);
    printRouteHits(sel, files);
    console.log(`\n应跑 ${sel.tests.length} 个用例：`);
    sel.tests.forEach((t) => console.log(`  ${t}`));
    return sel.routeOk ? 0 : 2;
  }

  if (!['check', 'full', 'baseline'].includes(mode)) {
    console.error(`未知模式：${mode}`);
    return 2;
  }

  const useFull = mode === 'full' || mode === 'baseline';
  const selection = useFull ? null : selectTests(files);
  const picked = useFull ? [] : selection.tests;
  // 🔴 路由真源解析不出来 = 验收口径降级，此时任何 PASS 都不可信 ⇒ 不允许带病放行。
  const routeFail = !useFull && selection !== null && !selection.routeOk;

  console.log(`[verify] 模式=${mode}  改动文件=${files.length}  待跑用例=${useFull ? '全量' : picked.length}`);
  if (!useFull && selection) printRouteHits(selection, files);

  const t0 = Date.now();
  const t = useFull ? runAllTests() : runTests(picked);
  const c = collectTsc();
  console.log(`[verify] 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[verify] 用例 ${t.summary.pass}/${t.summary.tests} 通过，${t.summary.fail} 失败；tsc(assets/script) ${c.total} 条`);

  const cur = {
    mode: useFull ? 'full' : 'partial',
    failures: t.failures.sort(),
    tsc: c.fingerprints,
    tscTotal: c.total,
    summary: t.summary,
  };

  if (mode === 'baseline') {
    saveBaseline(cur);
    console.log(`\n✅ 基线已写入 ${norm(path.relative(ROOT, BASELINE))}`);
  console.log(`   失败用例 ${cur.failures.length} 条 · tsc ${cur.tscTotal} 条`);
    return 0;
  }

  const base = loadBaseline();
  if (!base) {
    console.error(`\n❌ 没有基线。先跑：node tools/verify/verify.mjs baseline`);
    return 2;
  }

  if (useFull && base.mode !== 'full') {
    console.warn(`⚠️  基线是 partial 快照（${base.summary.tests} 条用例），与全量口径不可比`);
  }
  if (!useFull && base.mode === 'full') {
    console.log(`ℹ️  基线为全量快照；本次按路由只跑子集，只看「新增」不看「消失」`);
  }

  const failures = useFull ? diff(cur.failures, base.failures) : { added: diff(cur.failures, base.failures).added, gone: [] };
  const tscDiff = useFull ? diff(cur.tsc, base.tsc) : { added: diff(cur.tsc, base.tsc).added, gone: [] };

  console.log('\n———— 判据 ————');
  console.log(`新增失败用例：${failures.added.length}`);
  failures.added.forEach((n) => console.log(`   ❌ ${n}`));
  if (failures.gone.length) {
    console.log(`已修复（基线红、现在绿）：${failures.gone.length}`);
    failures.gone.slice(0, 20).forEach((n) => console.log(`   ✅ ${n}`));
  }
  console.log(`新增 tsc 错误：${tscDiff.added.length}`);
  tscDiff.added.slice(0, 30).forEach((n) => console.log(`   ❌ ${n}`));
  if (tscDiff.gone.length) console.log(`消失 tsc 错误：${tscDiff.gone.length}`);
  console.log(`tsc 总数：基线 ${base.tscTotal} → 现在 ${cur.tscTotal}（Δ ${cur.tscTotal - base.tscTotal}）`);

  const bad = failures.added.length + tscDiff.added.length;
  if (routeFail) {
    console.log('\n❌ 中止：路由真源解析失败，本次「零新增」不作数（退出码 2）');
    return 2;
  }
  console.log(bad === 0 ? '\n✅ PASS：相对基线零新增' : `\n❌ FAIL：${bad} 条新增`);
  return bad === 0 ? 0 : 1;
}

export { runCli, printRouteHits, parseRoutes, parseRows, routeSources, matchRoute, selectTests, norm };

// 直接 `node tools/verify/verify.mjs …` 才跑 CLI；被 import 时只导出（供用例断言）。
const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(runCli(process.argv));
