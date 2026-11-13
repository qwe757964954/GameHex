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
 *   node tools/verify/verify.mjs defs        改动集内互相引用的符号是否都有导出
 *   node tools/verify/verify.mjs gate       提交前一键：route → defs → check，并归档原始输出
 *
 * VERIFY_CHANGED_FILES：换行分隔的改动文件列表，供 CI 传 PR diff；设置后优先于 svn/git status。
 *
 * 退出码：0 = 相对基线零新增；1 = 有新增；2 = 工具自身出错
 *
 * 约定：本文件是 .mjs 不是 .ts —— 工程 tsconfig 无 include，放 .ts 会被全量编译扫进去。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  // CI 里工作树是干净的，必须允许把 PR diff 显式喂进来；否则 route/defs 会查 0 个文件（假绿）。
  const injected = process.env.VERIFY_CHANGED_FILES;
  if (injected && injected.trim()) {
    return injected.split(/\r?\n/).map((l) => norm(l.trim())).filter(Boolean);
  }
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
    // 🔴 不是「含 tests/ 的表格就是路由表」：2026-11-13 新增 `docs/agent/测试基线红清单.md`，
    // 它每行都引用 `tests/*.test.ts`，被自动扫描当成 20 行路由表 —— 会让任意改动多跑一堆无关用例，
    // 且语义完全错（它是「谁红了」，不是「改哪儿跑哪儿」）。
    // 判据：真路由表的**路由键必须指向被测代码**（assets/ tools/ …），只引 tests/ 自身的不算。
    const routesSource = rows.some((r) => r.keys.some((k) => !k.startsWith('tests/')));
    if (!routesSource) continue;
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

// -------------------------------- 跨文件定义完整性（规则 402：中间态必须能跑）

const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
const EXPORT_DECL_RE = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

/** 源文件对外导出的具名符号；`export *` 不可判定，返回 null 让调用方跳过。 */
function exportedNamesOf(source) {
  if (/export\s+\*\s+from/.test(source)) return null;
  const names = new Set();
  for (const m of source.matchAll(EXPORT_DECL_RE)) names.add(m[1]);
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(source)) names.add('default');
  return names;
}

/**
 * 跨文件改动「先写定义再写调用点」的静态护栏。
 *
 * 只看 changedFiles 内**互相引用**的相对 import —— 这类组合正是同事整包提交时最容易只带一半的。
 * opts.read 可注入，便于用例构造夹具；opts.headOf(target) 返回该文件在 HEAD 版本的内容（可选，
 * 为 null 表示「HEAD 里还没有这个文件」，此时不做入库判断）。
 */
function checkDefinitions(changedFiles, opts = {}) {
  const read = opts.read || ((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const headOf = opts.headOf;
  const scope = new Set(changedFiles.map(norm).filter((f) => f.endsWith('.ts') || f.endsWith('.mjs')));
  const issues = [];
  let checked = 0;
  let skipped = 0;
  for (const file of [...scope].sort()) {
    let source;
    try { source = read(file); } catch { continue; }
    for (const m of source.matchAll(NAMED_IMPORT_RE)) {
      const target = resolveSpec(path.join(ROOT, file), m[2]);
      if (!target || !scope.has(target)) continue;
      let targetSource;
      try { targetSource = read(target); } catch { continue; }
      const exported = exportedNamesOf(targetSource);
      if (!exported) { skipped++; continue; }
      for (const raw of m[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (!name || name === 'default' || name.startsWith('*')) { skipped++; continue; }
        checked++;
        if (!exported.has(name)) {
          issues.push({ file, target, name, reason: '目标文件没有导出该符号' });
          continue;
        }
        if (headOf) {
          const head = headOf(target);
          if (head != null) {
            const headExported = exportedNamesOf(head);
            if (headExported && !headExported.has(name)) {
              issues.push({ file, target, name, reason: '定义尚未入库（HEAD 里没有），调用点先提交会跑不起来' });
            }
          }
        }
      }
    }
  }
  return { checked, skipped, issues };
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
 * 「源码文本 / 资源路径字面量」反向索引：`被引用的路径 → 引用它的 tests/*.test.ts`。
 *
 * 存在理由（2026-11-13 实测）：`reverseTestIndex` 只认 `import` 边，而工程里 113 个
 * **源码文本结构守卫**和 68 个**资源/配置完整性**用例根本不 import 目标，而是
 * `readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8')` 之后拿正则断言。
 * import 图看不见这类引用 ⇒ 改动这些源文件时**一个用例都不跑**，判据报「零新增」是假绿。
 *
 * 量化（2026-11-13 用 `selectTests` 本身跑全量 866 个源文件实测，非另行估算）：
 * import 传递可达 521 个（60.2%），并入字面量后 712 个（**82.2%**），
 * 其中 **191 个只被字面量引用**（并入前完全漏跑，如 `BattleStartService.ts`）。
 * 剩 154 个两者都不可达 —— 那是真的没有用例，不是索引问题。
 *
 * 只做单跳、不做传递闭包 —— 字面量本身就是直接引用，补闭包只会把选择集撑大。
 * 命中偏多（注释里提到某路径也算）是可接受方向：多跑用例是安全侧，漏跑才是判据失效。
 */
const ASSET_LITERAL_RE = /(?:assets|tools)\/[A-Za-z0-9_\-.\\/]+\.(?:ts|mjs|json|prefab|meta|png|jpg)/g;

let _pathRefs = null;
function pathRefIndex() {
  if (_pathRefs) return _pathRefs;
  _pathRefs = new Map();
  for (const test of listTestFiles()) {
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, test), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(ASSET_LITERAL_RE)) {
      const key = norm(m[0]);
      const list = _pathRefs.get(key) ?? [];
      if (!list.includes(test)) list.push(test);
      _pathRefs.set(key, list);
    }
  }
  return _pathRefs;
}

/**
 * 兜底推导：规范表没命中时用来兜住，避免出现「改了文件但一个用例都不跑」。
 * 实测 23 个改动文件里只有 2 个能命中老路由表，没有兜底的话 diff 路由形同虚设。
 *   1) import 反向可达：谁（直接或间接）import 了它 ⇒ 跑那些用例（**主判据**）
 *   1b) 路径字面量引用：谁把它当字符串读（源码文本守卫 / 资源校验）⇒ 跑那些用例
 *   2) 改动 tests/x.test.ts        → 跑它自己
 *   3) 改动 tests/ 下夹具/helper   → 跑所有 import 了它的用例
 *   4) 同名 manifestation：ZCUnitSystem.ts → tests/zcds-unit-system.test.ts
 *   5) feature 前缀：app/bigmap/…  → tests/bigmap-*.test.ts（超过阈值只提示不展开）
 *
 * 🔴 顺序说明：老版本把「规范表文本匹配」当主判据，结果表一搬家就全掉到兜底。
 * 现在 **import 反向可达优先**（它是机械事实，不随文档措辞变化），规范表只作为
 * 「额外多跑」的补充（可能覆盖 import 图看不到的资源/配置改动）。
 * 1b 是 2026-11-13 补的：只靠 import 图会让 274 个只被字面量引用的源文件永久漏跑。
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
  const pathRefs = pathRefIndex();
  const picked = new Set();
  const wide = [];
  const hits = [];
  for (const f of files) {
    // 1) import 反向可达 —— 机械事实，文档怎么改都不失效
    const importers = reverse.get(norm(f)) ?? [];
    // 1b) 路径字面量引用 —— 源码文本守卫 / 资源校验，import 图天生看不见
    const refs = pathRefs.get(norm(f)) ?? [];
    // 2) 规范表 / 同名 / feature 前缀 —— 补充（覆盖 import 图看不到的配置与资源）
    const matched = routes.filter((r) => matchRoute(r, f));
    const fb = fallbackTests(f);
    const derived = Array.isArray(fb) ? fb : fb.tests;
    if (!Array.isArray(fb) && fb.wide.length) wide.push(...fb.wide);

    hits.push({ file: f, importers, refs, routes: matched.map((r) => r.title), fallback: derived });
    for (const t of importers) picked.add(t);
    for (const t of refs) picked.add(t);
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

/**
 * 显式 TAP reporter，不依赖「非 TTY 时默认 tap」这一环境巧合。
 * 默认 spec reporter 不产出 `not ok N - 名称` 行，失败名单会被抓成空数组，
 * 于是「相对基线新增失败 0」恒真 —— 这类假绿比 -1/-1 更难发现。
 */
const TEST_RUNNER = 'npx tsx --test --test-reporter=tap';
function testCommand(spec) {
  return `${TEST_RUNNER} ${spec}`;
}

/** 三项汇总必须解析到且自洽；-1/-1/-1 表示根本没跑到用例，不是「没有失败」。 */
function tapSummaryOk(summary) {
  if (!summary) return false;
  const { tests, pass, fail } = summary;
  if (![tests, pass, fail].every((n) => Number.isInteger(n) && n >= 0)) return false;
  return pass + fail === tests;
}

/**
 * 把 spawnSync 结果归一成一次可判定的测试运行。
 * 退出码非 0 不等于采集失败：基线长期带红，有失败用例时 tsx --test 就返回 1，
 * 那是「正常的红」，仍要走基线差集；真异常是进程没起来（status null / spawn error）。
 */
function parseTestRun(r, cmd) {
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const parsed = parseTapFailed(out);
  return {
    ...parsed,
    cmd,
    exitCode: r.status,
    spawnFailed: r.status == null || Boolean(r.error),
    summaryOk: tapSummaryOk(parsed.summary),
  };
}

function runTests(files) {
  if (!files.length) {
    return { failures: [], summary: { tests: 0, pass: 0, fail: 0 }, cmd: '', exitCode: 0, spawnFailed: false, summaryOk: true };
  }
  const cmd = testCommand(files.map((f) => `"${norm(f)}"`).join(' '));
  return parseTestRun(run(cmd), cmd);
}

/**
 * 全量分批执行。
 *
 * 2026-11-09 实测：单进程并行跑 449 个测试文件会挂住（23m39s 不返回、worker CPU 0，
 * 两次流式诊断分别卡在 2146 / 959 项，位置不固定）；而 60 文件一批 15s 就能跑完并
 * 输出完整 TAP 汇总。每批独立进程 + 单批超时，任何一批不可信就整次判失败，
 * 绝不用半截数据去比基线。
 */
const FULL_TEST_BATCH_SIZE = 60;
const FULL_TEST_TIMEOUT_MS = 180000;

function collectTestFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(norm(path.relative(ROOT, full)));
    }
  };
  const root = path.join(ROOT, 'tests');
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

function splitTestBatches(files, size = FULL_TEST_BATCH_SIZE) {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`批大小非法：${size}`);
  const out = [];
  for (let i = 0; i < files.length; i += size) out.push(files.slice(i, i + size));
  return out;
}

/**
 * 分批采集器 —— full 与「路由命中集过大」的 check 共用。
 * 2026-11-11 实测：check 改动 14 文件时路由命中 200+ 个测试文件，单进程一次性跑挂住
 * ⇒ TAP -1/-1 ⇒ EXIT 2 判据作废。分批后每批独立进程 + 超时 + 重试，任何一批不可信
 * 整次判失败，绝不用半截数据比基线。
 */
function runBatchedTests(files, label) {
  const batches = splitTestBatches(files);
  if (!batches.length) {
    return { failures: [], summary: { tests: -1, pass: -1, fail: -1 }, cmd: label, exitCode: 0, spawnFailed: false, summaryOk: false };
  }
  const merged = { failures: [], summary: { tests: 0, pass: 0, fail: 0 }, cmd: label, exitCode: 0, spawnFailed: false, summaryOk: true };
  for (const batch of batches) {
    const cmd = testCommand(batch.map((f) => `"${norm(f)}"`).join(' '));
    const opts = { timeout: FULL_TEST_TIMEOUT_MS };
    let r = parseTestRun(run(cmd, opts), cmd);
    // 偶发的进程启动 / IO 抖动会让单批超时（实测同批单跑 15s、连跑两次都正常）。
    // 只重试一次并显式打日志；仍失败就整次判不可信，绝不拿半截数据比基线。
    if (r.spawnFailed || !r.summaryOk) {
      console.warn(`[verify] 批次采集异常（exitCode=${r.exitCode}），重试一次：${batch[0]} … ${batch[batch.length - 1]}`);
      r = parseTestRun(run(cmd, opts), cmd);
    }
    if (r.spawnFailed || !r.summaryOk) {
      return { ...r, cmd: `${label} → ${cmd}`, summaryOk: false };
    }
    merged.failures.push(...r.failures);
    merged.summary.tests += r.summary.tests;
    merged.summary.pass += r.summary.pass;
    merged.summary.fail += r.summary.fail;
  }
  merged.failures.sort();
  merged.summaryOk = tapSummaryOk(merged.summary);
  return merged;
}

function runAllTests() {
  const files = collectTestFiles();
  return runBatchedTests(files, `分批 ${Math.ceil(files.length / FULL_TEST_BATCH_SIZE)}×${FULL_TEST_BATCH_SIZE}`);
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

/**
 * 覆盖基线的留痕：谁、什么时候、把哪些红写进了快照、口径从多少变到多少。
 *
 * 没有这条记录时，「基线重算」是一个不可审计的单向动作：半天后没人说得清
 * 某条红是被修复了，还是被 accept 吞掉了。日志用 append，不随快照覆盖丢失。
 */
function appendAcceptLog(cur, prev, addedFailures, addedTsc) {
  // 可用 VERIFY_ACCEPT_LOG 指向别处：让「留痕逻辑」能在不覆盖真实快照的前提下被验证。
  const log = process.env.VERIFY_ACCEPT_LOG || path.join(ROOT, 'tmp', 'verify', 'baseline-accept.log');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const who = (() => {
    try { return os.userInfo().username; } catch { return 'unknown'; }
  })();
  const lines = [
    `[${new Date().toISOString()}] baseline 覆盖 by ${who}`,
    `  口径：${prev ? `${prev.summary?.tests ?? '?'} 用例 / ${prev.failures?.length ?? '?'} 失败 / tsc ${prev.tscTotal ?? '?'}` : '（无旧快照）'}`
      + ` → ${cur.summary?.tests ?? '?'} 用例 / ${cur.failures.length} 失败 / tsc ${cur.tscTotal}`,
    `  新增失败写入快照 ${addedFailures.length} 条${addedFailures.length ? '：' : ''}`,
    ...addedFailures.map((n) => `    - ${n}`),
    `  新增 tsc 写入快照 ${addedTsc.length} 条`,
    '',
  ];
  fs.appendFileSync(log, lines.join('\n') + '\n', 'utf8');
  return log;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 基线红哨兵：把 baseline.json 的失败用例名反查到测试文件，check 时一并跑。
 * 2026-11-11 实测：改动文件=2 时路由只跑 11 个用例、判据报「新增失败 0」，而同批
 * 5 个文件单跑是 123 用例 / 32 fail —— 红根本没跑，「零新增」是假绿。哨兵保证基线红
 * 始终在判据视野内；未跑到的部分在判据里显式声明，不冒充完整判据。
 */
function baselineSentinelFiles() {
  const base = loadBaseline();
  if (!base || !Array.isArray(base.failures) || !base.failures.length) return [];
  const names = base.failures.filter((n) => typeof n === 'string' && n.length >= 8);
  if (!names.length) return [];
  const out = new Set();
  for (const t of listTestFiles()) {
    let src;
    try { src = fs.readFileSync(path.join(ROOT, t), 'utf8'); } catch { continue; }
    if (names.some((n) => src.includes(n))) out.add(t);
  }
  return [...out].sort();
}

/** 失败用例名 → 包含它的 tests/*.test.ts（TAP 只给用例名，不给文件，只能反查）。 */
function attributeFailures(names) {
  const hits = new Map(names.map((n) => [n, []]));
  const pending = new Set();
  for (const n of names) {
    // 整个文件跑挂时，TAP 的 `not ok` 名字是**文件路径**而不是用例名（如
    // `tests\battle-runtime-controller.test.ts`）。按文本反查永远查不到 ——
    // 这类必须直接认成「它自己就是那个文件」，否则红清单里会挂一堆「未定位」。
    const m = /^tests[\\/].+\.test\.ts$/.exec(String(n).trim());
    // TAP 名字里的路径可能是 `tests\\x.test.ts`（双反斜杠），归一后要再压掉重复斜杠，
    // 否则表格里会出现 `tests//x.test.ts`。
    const rel = m ? norm(String(n).trim()).replace(/\/{2,}/g, '/') : null;
    if (rel && fs.existsSync(path.join(ROOT, rel))) { hits.set(n, [rel]); continue; }
    pending.add(n);
  }
  for (const t of listTestFiles()) {
    if (!pending.size) break;
    let src;
    try { src = fs.readFileSync(path.join(ROOT, t), 'utf8'); } catch { continue; }
    for (const n of [...pending]) {
      if (src.includes(n)) { hits.get(n).push(t); pending.delete(n); }
    }
  }
  return hits;
}

/** 文件的最后一次入库时间（拿不到就回空串）。 */
function lastChanged(file) {
  const r = run(`svn info --show-item last-changed-date "${norm(file)}"`);
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/**
 * 单跑复核：把「整文件级失败」分成真红与分批噪声。
 *
 * 2026-11-13 实测：`battle-runtime-controller.test.ts` 在 60 文件一批的全量跑里
 * 报 `not ok - tests\battle-runtime-controller.test.ts`（文件级，不是某条断言），
 * 单跑却 26/26 全绿 —— 批次超时 / 资源竞争，不是代码坏了。
 *
 * 红清单如果不区分这两者，就会把采集噪声写成「13 条红」，然后没人认领、也没人能修。
 * 单跑成本只有几秒（13 个文件量级），换来的是清单可信。
 */
function soloVerdicts(doneFiles) {
  const out = new Map();
  for (const f of doneFiles) {
    const r = parseTestRun(run(testCommand(`"${norm(f)}"`), { timeout: FULL_TEST_TIMEOUT_MS }), '');
    if (r.spawnFailed || !r.summaryOk) out.set(f, 'unknown');
    else out.set(f, r.summary.fail === 0 ? 'solo-green' : 'solo-red');
  }
  return out;
}

/**
 * 基线红清单：把「谁红了、红在哪个文件、是不是基线之后才出现的」落成可派工的表格。
 *
 * 存在理由：`baseline.json` 只有一个扁平的名字数组，97 条红没有 owner、没有归属域，
 * 结果是「红在那儿挂着，没人认领，重算基线时被一次性吞掉」。清单把名字变成
 * 「文件 + 是否基线新增 + 最后改动时间」，才谈得上分派。
 *
 * 默认重跑全量（清单必须反映当下，读旧基线等于自欺）。`--from-baseline` 只做离线归属，
 * 用于不想等 2 分钟时快速看基线里那批红落在哪些文件。
 */
function printRedList(argv) {
  const offline = argv.includes('--from-baseline');
  let names;
  let summary = null;
  if (offline) {
    const base = loadBaseline();
    if (!base) { console.error('❌ 没有基线，无法离线归属'); return 2; }
    names = base.failures ?? [];
    summary = base.summary ?? null;
  } else {
    const t = runAllTests();
    if (t.spawnFailed || !t.summaryOk) {
      console.error('❌ 采集失败，红清单不可信（退出码 2）');
      return 2;
    }
    names = t.failures;
    summary = t.summary;
  }

  const base = loadBaseline();
  const baseNames = new Set(offline ? [] : (base?.failures ?? []));
  const attributed = attributeFailures(names);

  // 只对「能定位到文件」的失败做单跑复核；定位不到的（名字是动态拼的）留给人工。
  const filesToCheck = [...new Set([...attributed.values()].flat())];
  const solo = offline ? new Map() : soloVerdicts(filesToCheck);

  console.log(`# 测试基线红清单\n`);
  console.log(`> 由 \`node tools/verify/verify.mjs reds${offline ? ' --from-baseline' : ''}\` 生成，勿手改数据行。`);
  console.log(`> 归属（owner）列由人工填写；修完后重跑本命令，行会自动消失。\n`);
  console.log(offline
    ? `数据源：\`tmp/verify/baseline.json\`（离线归属，可能已过时，未做单跑复核）\n`
    : `本次全量：${summary.tests} 条 / ${summary.pass} 通过 / **${summary.fail} 失败**\n`);
  console.log('| # | 用例 | 所属测试文件 | 单跑复核 | 基线里有没有 | 文件最后入库 | owner |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  names.forEach((n, i) => {
    const files = attributed.get(n) ?? [];
    const fileCell = files.length ? files.map((f) => `\`${f}\``).join('<br>') : '⚠️ 未定位';
    const verdict = (() => {
      if (offline) return '—';
      if (!files.length) return '—';
      const vs = files.map((f) => solo.get(f));
      if (vs.includes('solo-red')) return '单跑也红（**真红**）';
      if (vs.every((v) => v === 'solo-green')) return '单跑绿（批跑噪声）';
      return '未判定';
    })();
    const inBase = offline ? '—' : (baseNames.has(n) ? '有' : '**新增**');
    const when = files.length ? (lastChanged(files[0]) || '—') : '—';
    console.log(`| ${i + 1} | ${n} | ${fileCell} | ${verdict} | ${inBase} | ${when} | |`);
  });
  if (!names.length) console.log('| — | （无红色用例） | — | — | — | — | — |');
  return 0;
}


// ---------------------------------------------------------------------- CLI

function printRouteHits(sel, files) {
  const covered = (h) => h.importers.length || (h.refs ?? []).length || h.routes.length || h.fallback.length;
  const uncovered = sel.hits.filter((h) => !covered(h));
  console.log(`改动 ${files.length} 个文件\n`);
  for (const h of sel.hits) {
    console.log(`  ${norm(h.file)}`);
    if (h.importers.length) console.log(`      → import 可达：${h.importers.length} 个用例`);
    if ((h.refs ?? []).length) console.log(`      → 路径字面量引用：${h.refs.length} 个用例（${h.refs.slice(0, 3).join(', ')}${h.refs.length > 3 ? ' …' : ''}）`);
    if (h.routes.length) console.log(`      → 规范路由：${h.routes.join(' / ')}`);
    if (h.fallback.length) console.log(`      → 推导：${h.fallback.join(', ')}`);
    if (!covered(h)) {
      console.log(`      → ⚠️ 完全无覆盖：无 import、无字面量引用、无路由、无同名用例`);
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

// ------------------------------------------------------- 提交前一键门禁 + 归档

const GATE_STEPS = [
    { name: 'route', label: '路由覆盖' },
    { name: 'defs', label: '定义完整性' },
    { name: 'check', label: '相对基线零新增' },
];

/** 把门禁原始输出与判据汇总归档到 outputs/audit-<日期>/，并按需生成审查报告骨架。 */
function writeGateReport(files, outputs, bad, outDir = null) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const dir = outDir || path.join(ROOT, 'outputs', `audit-${day}`);
    fs.mkdirSync(dir, { recursive: true });

    const lines = [
        `# 提交前门禁记录 ${now.toLocaleString('zh-CN')}`,
        '',
        `> 由 \`node tools/verify/verify.mjs gate\` 自动生成。改动文件 ${files.length} 个。`,
        '> 共享工作副本时按[代码审查规范](../../docs/agent/代码审查规范.md) §2.1 手写「本轮改动白名单」，不要直接把 svn status 全量当本轮改动集。',
        '',
        '## 判据汇总',
        '',
        '| 门 | 命令 | 退出码 | 结果 |',
        '| --- | --- | --- | --- |',
        ...outputs.map((o) => `| ${o.label} | \`verify ${o.name}\` | ${o.code} | ${o.code === 0 ? 'PASS' : 'FAIL'} |`),
        '',
        `**结论：${bad ? `FAIL（${bad} 道门未过）` : 'PASS（三道门全过）'}**`,
        '',
        '## 改动文件（前 50 条）',
        '',
        ...files.slice(0, 50).map((f) => `- \`${norm(f)}\``),
        ...(files.length > 50 ? [`- …… 其余 ${files.length - 50} 个省略`] : []),
        '',
        '## 原始输出',
        '',
    ];
    for (const o of outputs) {
        lines.push(`### ${o.label}（verify ${o.name}，退出码 ${o.code}）`, '', '```text', o.out.trimEnd(), '```', '');
    }

    const report = path.join(dir, `gate-${time}.md`);
    fs.writeFileSync(report, lines.join('\n') + '\n', 'utf8');

    const skeleton = path.join(dir, '审查报告.md');
    if (!fs.existsSync(skeleton)) {
        const template = path.join(ROOT, 'docs', 'agent', '审查报告模板.md');
        if (fs.existsSync(template)) {
            fs.writeFileSync(skeleton, fs.readFileSync(template, 'utf8'), 'utf8');
        }
    }
    return report;
}

/** 提交前一键：逐道门跑一遍，汇总退出码并归档；任一门非 0 即不放行。 */
function runGate(files) {
    const script = norm(path.join(ROOT, 'tools', 'verify', 'verify.mjs'));
    const outputs = [];
    let bad = 0;
    for (const step of GATE_STEPS) {
        const r = run(`node "${script}" ${step.name}`);
        const out = `${r.stdout || ''}${r.stderr || ''}`;
        const code = r.status == null ? 2 : r.status;
        if (code !== 0) bad++;
        console.log(`[gate] ${step.label} (verify ${step.name}) → 退出码 ${code}`);
        outputs.push({ ...step, code, out });
    }
    const report = writeGateReport(files, outputs, bad);
    console.log(`[gate] 报告已归档 ${norm(path.relative(ROOT, report))}`);
    console.log(bad === 0 ? '✅ PASS：三道门全过' : `❌ FAIL：${bad} 道门未过（详见归档报告）`);
    return bad === 0 ? 0 : 1;
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

  if (mode === 'defs') {
    // 主流程的 files 只看 ts/json/prefab/meta；定义检查还要覆盖 tests → tools/**/*.mjs 这类组合。
    const defsFiles = changedFiles().filter((f) => /\.(ts|mjs)$/.test(f));
    const result = checkDefinitions(defsFiles);
    console.log(`[verify] 定义完整性：检查 ${result.checked} 个跨文件引用，跳过 ${result.skipped} 个`);
    if (!result.issues.length) {
      console.log('✅ 无缺失定义（改动集内互相引用的符号都能在目标文件找到导出）');
      return 0;
    }
    result.issues.forEach((i) => console.log(
      `   ❌ ${norm(i.file)} → ${norm(i.target)} 缺 ${i.name}：${i.reason}`));
    return 1;
  }

  if (mode === 'gate') {
    return runGate(files);
  }

  if (mode === 'reds') {
    return printRedList(process.argv);
  }

  /**
   * `run`：把全量用例跑一遍，只报结果、不比基线。
   *
   * 存在理由：`package.json` 原来的 `"test": "tsx --test tests/**\/*.test.ts"` 是**单进程**
   * 跑 496 个文件，实测会挂住（本文件 `runBatchedTests` 注释记着 449 文件 23m39s 不返回）。
   * 也就是说：文档推荐的第一条命令，恰好是唯一跑不完的那条。
   * 分批后同样内容 133s 跑完，且每批独立进程 + 超时重试，不会半截数据冒充完整结果。
   *
   * 与 `check` / `full` 的区别：**不读也不写基线**，退出码只看「有没有失败用例」。
   * 门禁语义留给 `check`（相对基线零新增）和 `gate`（多功能一键）。
   */
  if (mode === 'run') {
    const t = runAllTests();
    if (t.spawnFailed || !t.summaryOk) {
      console.error('\n❌ 采集失败：批次未正常结束，本次结果不可信（退出码 2）');
      if (t.spawnFailed) console.error(`   子进程未正常结束：exitCode=${t.exitCode}`);
      else console.error(`   TAP 汇总缺失或不一致：${JSON.stringify(t.summary)}`);
      console.error(`   命令：${t.cmd}`);
      return 2;
    }
    console.log(`\n[verify] 全量 ${t.summary.tests} 条：${t.summary.pass} 通过 / ${t.summary.fail} 失败`);
    t.failures.forEach((n) => console.log(`   ❌ ${n}`));
    if (!t.summary.fail) {
      console.log('\n✅ 全绿');
      return 0;
    }
    console.log('\n⚠️ 有失败用例（本模式不比基线；判「有没有引入回归」请用 npm run verify）');
    return 1;
  }

  if (!['check', 'full', 'baseline'].includes(mode)) {
    console.error(`未知模式：${mode}`);
    return 2;
  }

  const useFull = mode === 'full' || mode === 'baseline';
  const selection = useFull ? null : selectTests(files);
  const sentinels = useFull ? [] : baselineSentinelFiles();
  const picked = useFull ? [] : [...new Set([...selection.tests, ...sentinels])].sort();
  // 🔴 路由真源解析不出来 = 验收口径降级，此时任何 PASS 都不可信 ⇒ 不允许带病放行。
  const routeFail = !useFull && selection !== null && !selection.routeOk;

  console.log(`[verify] 模式=${mode}  改动文件=${files.length}  待跑用例=${useFull ? '全量' : picked.length}`);
  if (!useFull) {
    const extra = sentinels.filter((s) => !selection.tests.includes(s)).length;
    console.log(`[verify] 基线红哨兵：${sentinels.length} 个测试文件并入（路由未命中 ${extra} 个），防「没跑 ≠ 修好」`);
  }
  if (!useFull && selection) printRouteHits(selection, files);

  const t0 = Date.now();
  const t = useFull ? runAllTests()
    : picked.length > FULL_TEST_BATCH_SIZE
      ? runBatchedTests(picked, `check 分批 ${Math.ceil(picked.length / FULL_TEST_BATCH_SIZE)}×${FULL_TEST_BATCH_SIZE}`)
      : runTests(picked);
  const c = collectTsc();
  console.log(`[verify] 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[verify] 用例 ${t.summary.pass}/${t.summary.tests} 通过，${t.summary.fail} 失败；tsc(assets/script) ${c.total} 条`);

  // 🔴 采集器自检必须先于写基线 / 比基线：汇总不完整时失败名单可能是空的，
  // 此时「新增失败 0」恒真，任何 PASS 都不作数（2026-11-05 `verify full` 退出 0 却显示 -1/-1）。
  if (t.spawnFailed || !t.summaryOk) {
    console.error('\n❌ 中止：测试采集失败，本次「零新增」不作数（退出码 2）');
    if (t.spawnFailed) console.error(`   子进程未正常结束：exitCode=${t.exitCode}`);
    else console.error(`   TAP 汇总缺失或不一致：${JSON.stringify(t.summary)}`);
    console.error(`   命令：${t.cmd}`);
    return 2;
  }

  const cur = {
    mode: useFull ? 'full' : 'partial',
    failures: t.failures.sort(),
    tsc: c.fingerprints,
    tscTotal: c.total,
    summary: t.summary,
  };

  if (mode === 'baseline') {
    // 🔴 重算守护：baseline 无条件覆盖会把「这次新引入的回归」永久写进快照，
    // 之后所有人看到的「相对基线零新增」都是假的。口径可比（全量↔全量）时，
    // 只要新增失败 / 新增 tsc 就拒绝落盘，必须显式 VERIFY_BASELINE_ACCEPT=1 才覆盖。
    const prev = loadBaseline();
    const comparable = prev && prev.mode === cur.mode;
    const addedFailures = comparable ? diff(cur.failures, prev.failures).added : [];
    const addedTsc = comparable ? diff(cur.tsc, prev.tsc).added : [];
    const accept = process.env.VERIFY_BASELINE_ACCEPT === '1';
    if (comparable && (addedFailures.length || addedTsc.length) && !accept) {
      console.error(`\n❌ 拒绝写入基线：相对旧快照新增 ${addedFailures.length} 条失败用例、${addedTsc.length} 条 tsc 错误`);
      addedFailures.forEach((n) => console.error(`   ❌ ${n}`));
      addedTsc.slice(0, 20).forEach((n) => console.error(`   ❌ ${n}`));
      console.error('\n   若确认这些是「已接受的已知红」（例如新功能先带红入库），显式覆盖：');
      console.error('      VERIFY_BASELINE_ACCEPT=1 node tools/verify/verify.mjs baseline');
      console.error('   否则先修掉它们 —— 让基线吞掉回归，等于永久取消回归判据。');
      return 1;
    }
    if (comparable && (addedFailures.length || addedTsc.length)) {
      console.warn(`⚠️  已按 VERIFY_BASELINE_ACCEPT=1 覆盖：新增 ${addedFailures.length} 条失败 / ${addedTsc.length} 条 tsc 被写入基线`);
    }
    const acceptLog = appendAcceptLog(cur, prev, addedFailures, addedTsc);
    saveBaseline(cur);
    console.log(`\n✅ 基线已写入 ${norm(path.relative(ROOT, BASELINE))}`);
    console.log(`   留痕追加至 ${norm(path.relative(ROOT, acceptLog))}`);
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
    console.log(`ℹ️  基线为全量快照（${base.summary.tests} 用例）；本次覆盖 ${picked.length} 个测试文件，未跑到的基线红不计入判据。`);
    if (selection.wide.length) {
      console.log(`ℹ️  有 ${selection.wide.length} 个域超过路由展开上限 ${FEATURE_AUTORUN_LIMIT}，完整判据请跑：npm run verify:full`);
    }
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

export { runCli, printRouteHits, parseRoutes, parseRows, routeSources, matchRoute, selectTests, norm, changedFiles, runGate, writeGateReport, checkDefinitions, exportedNamesOf, testCommand, tapSummaryOk, parseTestRun, splitTestBatches, baselineSentinelFiles, runBatchedTests, attributeFailures, appendAcceptLog, soloVerdicts };

// 直接 `node tools/verify/verify.mjs …` 才跑 CLI；被 import 时只导出（供用例断言）。
const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(runCli(process.argv));
