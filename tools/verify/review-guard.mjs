#!/usr/bin/env node
/**
 * review-guard.mjs —— 04:00 合并审查自动化的只读守卫（真源，可入库）
 *
 *   node tools/verify/review-guard.mjs check-docs
 *   node tools/verify/review-guard.mjs begin <runId> [--inject=<relpath>]
 *   node tools/verify/review-guard.mjs end    <runId>
 *   node tools/verify/review-guard.mjs restore <runId> [--only=<relpath>] [--confirm]
 *   node tools/verify/review-guard.mjs verify-report <报告路径>
 *
 * 子命令职责：
 *  - check-docs    ：校验 prompt 引用的 7 份规范路径，并检查守卫真源是否入库（风险 2/3）。
 *  - begin/end     ：svn status --xml + 文本文件 hash 对比，检测审查期间源码写入（风险 1）。
 *                    begin 额外备份受保护文本文件，供 restore 使用；end 输出墙钟耗时。
 *  - restore       ：默认 DRY-RUN 只列可恢复清单；显式 --confirm 才从备份写回（代码层闸门）。
 *  - verify-report ：核对首轮审查报告的必填段落，缺一项即退出 1（风险 3 的可执行门禁）。
 *  - --inject      ：纯内存变异，零工程写入，用于红/绿自证。
 *
 * 退出码：0 = CLEAN / 通过；1 = VIOLATION / 缺失 / 报告不全；2 = 工具自身出错。
 * ⚠️ 仍是「检测 + 可逆恢复」，不是「硬阻止」：平台没有工具权限白名单字段。
 *
 * 🔴 Windows 坑：svn status 纯文本走本地代码页，中文路径两次解码不一致会误报 VIOLATION；
 *    必须用 --xml（UTF-8）解析 entry path，不要比较纯文本整行。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');           // tools/verify -> 仓库根
const GUARD_DIR = path.join(ROOT, 'tmp', 'review-guard');
const SELF_REL = 'tools/verify/review-guard.mjs';

const ALLOW_PREFIXES = ['outputs/', 'tmp/', '.workbuddy/'];
const REQUIRED_DOCS = [
  'AGENTS.md',
  'docs/agent/代码审查规范.md',
  'docs/agent/规范路由与最小验证.md',
  'docs/agent/MVC设计规范.md',
  'docs/agent/单例与状态作用域.md',
  'docs/agent/版本库约定.md',
  'docs/agent/开发细则.md',
];
const TEXT_EXT = new Set(['.ts', '.mts', '.js', '.mjs', '.json', '.md', '.prefab', '.meta',
  '.scene', '.xml', '.yaml', '.yml', '.txt', '.py', '.proto', '.fire']);
const MAX_HASH_BYTES = 2 * 1024 * 1024;

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const isProtected = (rel) => !ALLOW_PREFIXES.some(a => rel.startsWith(a));

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function svnEntries() {
  const r = spawnSync('svn', ['status', '--xml'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    console.error(`[guard] svn status --xml 失败：${r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}`}`);
    process.exit(2);
  }
  const out = [];
  for (const block of r.stdout.split(/<entry\s+path="/).slice(1)) {
    const q = block.indexOf('"');
    if (q < 0) continue;
    const rel = norm(decodeXml(block.slice(0, q)));
    const item = /<wc-status[^>]*\bitem="([^"]+)"/.exec(block)?.[1] ?? 'unknown';
    out.push({ rel, sig: `${item} ${rel}` });
  }
  return out;
}

function readIfHashable(rel) {
  const abs = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size > MAX_HASH_BYTES) return null;
  if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) return null;
  try { return fs.readFileSync(abs); } catch { return null; }
}

function hashBuf(buf) { return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16); }

function snapshot(inject, extraPaths = [], backupDir = null) {
  const entries = svnEntries();
  const rels = [...new Set([...entries.map(e => e.rel), ...extraPaths.map(norm)])];
  const hashes = {}, backups = {};
  let n = 0;
  for (const rel of rels) {
    const injected = inject && norm(inject) === rel;
    const buf = injected ? null : readIfHashable(rel);
    hashes[rel] = injected ? 'FORCED_CHANGE_FOR_SELFTEST' : (buf ? hashBuf(buf) : null);
    // 只备份受保护、可哈希的文本文件，供 verify/restore 使用
    if (backupDir && buf && isProtected(rel)) {
      const dest = path.join(backupDir, `${String(n++).padStart(3, '0')}.bak`);
      fs.writeFileSync(dest, buf);
      backups[rel] = { file: dest, hash: hashes[rel] };
    }
  }
  return { ts: Date.now(), sigs: entries.map(e => e.sig), hashes, backups };
}

function runFile(runId) {
  if (!/^[A-Za-z0-9_.-]+$/.test(runId)) {
    console.error('[guard] runId 只允许字母数字 _ . -'); process.exit(2);
  }
  return path.join(GUARD_DIR, `${runId}.json`);
}

function loadRun(runId) {
  const file = runFile(runId);
  if (!fs.existsSync(file)) { console.error(`[guard] 找不到 begin 快照：${file}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkDocs() {
  const missing = REQUIRED_DOCS.filter(p => !fs.existsSync(path.join(ROOT, p)));
  console.log(`[guard] 规范路径校验：${REQUIRED_DOCS.length - missing.length}/${REQUIRED_DOCS.length} 存在`);
  if (missing.length) {
    for (const p of missing) console.log(`  ❌ 缺失：${p}`);
    console.log('  → 按 AGENTS.md 的「按需读取」表重新定位，并在报告里标注规范路径失配。');
    process.exit(1);
  }
  for (const p of REQUIRED_DOCS) console.log(`  ✅ ${p}`);

  const info = spawnSync('svn', ['info', SELF_REL], { cwd: ROOT, encoding: 'utf8' });
  const tracked = info.status === 0;
  console.log(`[guard] 守卫真源入库状态：${tracked ? '已纳入版本控制' : '未纳入（svn status 里应为 ? 未跟踪）'}`);
  if (!tracked) {
    console.log('  ⚠️ 换机前需人工执行 svn add 并提交；本脚本不代执行任何版本库操作。');
    console.log(`  → 建议命令：svn add ${SELF_REL}（提交按钮人工点）`);
  }
  process.exit(0);
}

function cmdBegin(runId, inject) {
  const file = runFile(runId);
  const backupDir = path.join(GUARD_DIR, `${runId}.backup`);
  fs.mkdirSync(GUARD_DIR, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  const snap = snapshot(inject, inject ? [inject] : [], backupDir);
  fs.writeFileSync(file, JSON.stringify({ runId, inject: inject ?? null, ...snap }, null, 2), 'utf8');
  console.log(`[guard] begin ${runId}：采集 ${Object.keys(snap.hashes).length} 条 status 条目，备份 ${Object.keys(snap.backups).length} 个受保护文本文件`);
  console.log(`[guard] 快照：${file}`);
  if (inject) console.log(`[guard] ⚠️ 内存注入变异：${inject}（未写任何工程文件）`);
}

function cmdEnd(runId) {
  const before = loadRun(runId);
  const after = snapshot(null, Object.keys(before.hashes));

  const bSigs = new Set(before.sigs), aSigs = new Set(after.sigs);
  const added = [...aSigs].filter(s => !bSigs.has(s));
  const removed = [...bSigs].filter(s => !aSigs.has(s));
  const changed = [];
  for (const [rel, h] of Object.entries(before.hashes)) {
    const h2 = after.hashes[rel];
    if (h !== null && h2 !== undefined && h !== h2) changed.push(rel);
  }

  const label = (s) => s.slice(s.indexOf(' ') + 1);
  const candidates = [...added.map(label), ...removed.map(label), ...changed];
  const violations = [...new Set(candidates)].filter(p => p && isProtected(p));
  const allowed = [...new Set(candidates)].filter(p => p && !isProtected(p));

  console.log(`[guard] end ${runId}：墙钟 ${((after.ts - before.ts) / 1000).toFixed(2)}s`);
  console.log(`[guard] status 新增 ${added.length} / 消失 ${removed.length} / 内容变化 ${changed.length}`);
  for (const s of added) console.log(`  + ${s}`);
  for (const s of removed) console.log(`  - ${s}`);
  if (allowed.length) console.log(`[guard] 允许范围内写入（不判违规）：${allowed.join(', ')}`);
  if (violations.length) {
    for (const p of violations) console.log(`  ❌ 受保护路径发生变化：${p}`);
    console.log('[guard] VERDICT: VIOLATION —— 本次审查结论无效，须人工复核。');
    console.log(`[guard] 可恢复清单（DRY-RUN，不写文件）：node ${SELF_REL} restore ${runId}`);
    console.log('[guard] ⚠️ 变化也可能来自同事并行改动，未经人工确认不得执行 --confirm。');
    process.exit(1);
  }
  console.log('[guard] VERDICT: CLEAN —— 审查期间零源码写入（同事并行改动会在此列出，人工判读）。');
  console.log('[guard] trace 采集：轮数 / 工具链 / 实际 usage 由审查报告填写；本脚本只提供墙钟耗时，无 usage 时标「未采集」。');
}

function cmdRestore(runId, confirm, only) {
  // 硬闸门：共享工作副本里同事随时在改，批量 --confirm 会覆盖他人工作 ⇒ 必须限定单文件
  if (confirm && !only) {
    console.error('[guard] 拒绝批量恢复：--confirm 必须配合 --only=<单个路径>，避免覆盖同事并行改动。');
    process.exit(2);
  }
  const before = loadRun(runId);
  const after = snapshot(null, Object.keys(before.hashes));
  const changed = Object.entries(before.hashes).filter(([rel, h]) =>
    h !== null && isProtected(rel)
    && (!only || norm(rel) === norm(only))
    && after.hashes[rel] !== undefined && after.hashes[rel] !== h);
  console.log(`[guard] restore ${runId}：${changed.length} 个受保护文件内容发生变化${only ? `（限定 ${only}）` : '（全量清单）'}`);
  for (const [rel, h] of changed) {
    const bk = before.backups[rel];
    console.log(`  ${rel}  ${h} -> ${after.hashes[rel]}  备份=${bk ? bk.file : '无（不可恢复）'}`);
  }
  if (!confirm) {
    console.log('[guard] DRY-RUN：未写任何文件。确认这些变化均由审查 agent 造成后，加 --only=<路径> --confirm 才执行恢复。');
    console.log('[guard] ⚠️ 若变化来自同事并行改动，切勿恢复；--confirm 必须限定单个文件，批量恢复被代码层拒绝。');
    process.exit(0);
  }
  let n = 0;
  for (const [rel] of changed) {
    const bk = before.backups[rel];
    if (!bk || !fs.existsSync(bk.file)) { console.log(`  ⏭ 跳过（无备份）：${rel}`); continue; }
    fs.copyFileSync(bk.file, path.join(ROOT, rel));
    console.log(`  ✅ 已恢复：${rel}`); n++;
  }
  console.log(`[guard] restore 完成：${n} 个文件写回（仅依据 begin 快照，未触碰其他路径）。`);
}

const REPORT_CHECKS = [
  ['规范路径校验', 'check-docs 输出'],
  ['[guard] begin', 'begin 快照'],
  ['VERDICT: CLEAN', 'end 守卫结论'],
  ['新增失败用例', '判据 1：零新增失败'],
  ['新增 tsc', '判据 2：零新增 tsc'],
  ['完全无覆盖', '判据 3：无覆盖文件 0'],
  ['成本与 trace', 'trace 段'],
  ['轮数', 'trace：轮数'],
  ['工具链', 'trace：工具链'],
  ['墙钟', 'trace：墙钟'],
  ['usage', 'trace：实际 usage 或标未采集'],
  ['未覆盖风险', '未覆盖风险段'],
  ['P0', '意见汇总含 P0 计数'],
];

function cmdVerifyReport(reportPath) {
  const abs = path.isAbsolute(reportPath) ? reportPath : path.join(ROOT, reportPath);
  if (!fs.existsSync(abs)) { console.error(`[guard] 报告不存在：${abs}`); process.exit(2); }
  const text = fs.readFileSync(abs, 'utf8');
  if (text.includes('VERDICT: VIOLATION')) {
    console.log('[guard] ❌ 报告里出现 VERDICT: VIOLATION —— 该次审查结论无效，禁止放行。');
    process.exit(1);
  }
  const missing = REPORT_CHECKS.filter(([needle]) => !text.includes(needle));
  for (const [needle, why] of REPORT_CHECKS)
    console.log(`  ${text.includes(needle) ? '✅' : '❌'} ${why}`);
  console.log(`[guard] 首轮核对：${REPORT_CHECKS.length - missing.length}/${REPORT_CHECKS.length} 项齐全`);
  if (missing.length) {
    for (const [, why] of missing) console.log(`  ❌ 缺失：${why}`);
    process.exit(1);
  }
  console.log('[guard] VERDICT: REPORT_OK —— 报告结构完整，仍需人工判读内容质量。');
}

const [cmd, arg, ...rest] = process.argv.slice(2);
if (cmd === 'check-docs') checkDocs();
else if (cmd === 'begin') {
  if (!arg) { console.error('用法：begin <runId> [--inject=<relpath>]'); process.exit(2); }
  cmdBegin(arg, rest.find(a => a.startsWith('--inject='))?.slice('--inject='.length));
} else if (cmd === 'end') {
  if (!arg) { console.error('用法：end <runId>'); process.exit(2); }
  cmdEnd(arg);
} else if (cmd === 'restore') {
  if (!arg) { console.error('用法：restore <runId> [--only=<relpath>] [--confirm]'); process.exit(2); }
  cmdRestore(arg, rest.includes('--confirm'),
    rest.find(a => a.startsWith('--only='))?.slice('--only='.length));
} else if (cmd === 'verify-report') {
  if (!arg) { console.error('用法：verify-report <报告路径>'); process.exit(2); }
  cmdVerifyReport(arg);
} else {
  console.error('用法：check-docs | begin <runId> | end <runId> | restore <runId> [--only=<relpath>] [--confirm] | verify-report <路径>');
  process.exit(2);
}
