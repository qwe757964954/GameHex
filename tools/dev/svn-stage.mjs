#!/usr/bin/env node
/**
 * tools/dev/svn-stage.mjs
 * 
 * SVN 增量改动暂存与零扫描提交辅助工具：
 * - add: 记录指定修改文件（自动关联 assets 伴生 .meta）
 * - pick: 秒级抓取工作区变动路径写入暂存单（0 分析、0 耗时）
 * - rm/remove: 移除暂存文件
 * - list/status: 查看暂存清单
 * - clear: 清空暂存清单
 * - commit: 纯中文校验 + 根目录卫生检查 + 调起 TortoiseProc 提交弹窗（支持 --all 一键对齐提交）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'tmp');
const STAGE_FILE = path.join(TMP_DIR, 'svn-staged.txt');
const TORTOISE_PROC = 'C:\\Program Files\\TortoiseSVN\\bin\\TortoiseProc.exe';

const IGNORE_PREFIXES = [
  'tmp/',
  '.codegraph/',
  '.superpowers/',
  '.codex-',
  '.creative-design/',
  '.skill_tmp/',
  '.trae/',
  '.workbuddy/',
  '.tmpwork/',
  'data/outputs/',
  '.git/',
  '.svn/',
  'logs/',
];

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

export function loadStagedFiles() {
  if (!fs.existsSync(STAGE_FILE)) {
    return [];
  }
  const buffer = fs.readFileSync(STAGE_FILE);
  if (buffer.length === 0) return [];

  let content = '';
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    // 兼容带 BOM 的 UTF-16LE
    content = buffer.subarray(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[1] === 0x00) {
    // 官方推荐无 BOM 的 UTF-16LE
    content = buffer.toString('utf16le');
  } else {
    // UTF-8
    content = buffer.toString('utf8');
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function saveStagedFiles(files) {
  ensureTmpDir();
  const unique = Array.from(new Set(files.map((f) => path.resolve(ROOT, f))));
  // TortoiseProc 官方规定：/pathfile 必须是 UTF-16 且无 BOM（严禁写入 0xFF 0xFE，否则会导致首字符被识别为非法字符触发 svn_dirent_is_absolute 断言崩溃）
  const content = Buffer.from(unique.join('\r\n'), 'utf16le');
  fs.writeFileSync(STAGE_FILE, content);
  return unique;
}

export function addFiles(inputPaths) {
  if (!inputPaths || inputPaths.length === 0) {
    console.error('用法: node tools/dev/svn-stage.mjs add <文件路径...>');
    process.exit(1);
  }

  const current = loadStagedFiles();
  const toAdd = [];

  for (const raw of inputPaths) {
    const fullPath = path.resolve(ROOT, raw);
    toAdd.push(fullPath);

    // Cocos 规范：若为 assets 下的非 .meta 文件，伴生 .meta 存在时一并暂存
    if (fullPath.includes(`${path.sep}assets${path.sep}`) && !fullPath.endsWith('.meta')) {
      const metaPath = `${fullPath}.meta`;
      if (fs.existsSync(metaPath)) {
        toAdd.push(metaPath);
      }
    }
  }

  const updated = saveStagedFiles([...current, ...toAdd]);
  console.log(`[SVN 暂存] 成功添加 ${toAdd.length} 项（含伴生 meta）。当前暂存总数: ${updated.length}`);
  return updated;
}

export function pickFiles(scope = '') {
  let output = '';
  try {
    output = execSync('git -c core.quotepath=false status --porcelain', { encoding: 'utf8' });
  } catch {
    try {
      output = execSync('svn status -q', { encoding: 'utf8' });
    } catch {
      output = '';
    }
  }

  const lines = output.split(/\r?\n/).filter(Boolean);
  const picked = [];

  for (const line of lines) {
    const match = line.match(/^.{1,2}\s+(.+)$/);
    if (!match) continue;
    let relPath = match[1].trim();
    if (relPath.includes('->')) {
      relPath = relPath.split('->')[1].trim();
    }
    const normalizedRel = relPath.replace(/\\/g, '/');
    if (IGNORE_PREFIXES.some((pre) => normalizedRel.startsWith(pre))) {
      continue;
    }
    if (scope && !normalizedRel.startsWith(scope.replace(/\\/g, '/'))) {
      continue;
    }

    const full = path.resolve(ROOT, relPath);
    picked.push(full);

    if (full.includes(`${path.sep}assets${path.sep}`) && !full.endsWith('.meta')) {
      const meta = `${full}.meta`;
      if (fs.existsSync(meta)) {
        picked.push(meta);
      }
    }
  }

  const updated = saveStagedFiles(picked);
  console.log(`[SVN 暂存] 已秒级对齐工作区变动：共抓取 ${updated.length} 项（含伴生 meta）。`);
  return updated;
}

export function removeFiles(inputPaths) {
  if (!inputPaths || inputPaths.length === 0) {
    console.error('用法: node tools/dev/svn-stage.mjs rm <文件路径...>');
    process.exit(1);
  }

  const current = loadStagedFiles();
  const removeSet = new Set(inputPaths.map((p) => path.resolve(ROOT, p)));

  for (const p of inputPaths) {
    const full = path.resolve(ROOT, p);
    removeSet.add(`${full}.meta`);
  }

  const remaining = current.filter((f) => !removeSet.has(f));
  saveStagedFiles(remaining);
  console.log(`[SVN 暂存] 已移除指定文件。当前暂存总数: ${remaining.length}`);
  return remaining;
}

export function listFiles() {
  const files = loadStagedFiles();
  if (files.length === 0) {
    console.log('[SVN 暂存] 当前暂存单为空。');
    return files;
  }
  console.log(`[SVN 暂存] 当前已记录 ${files.length} 个待提交文件:`);
  files.forEach((f, idx) => {
    const rel = path.relative(ROOT, f);
    console.log(`  ${idx + 1}. ${rel}`);
  });
  return files;
}

export function clearFiles() {
  if (fs.existsSync(STAGE_FILE)) {
    fs.unlinkSync(STAGE_FILE);
  }
  console.log('[SVN 暂存] 暂存清单已清空。');
}

export function commitFiles(args) {
  const isDryRun = args.includes('--dry-run');
  const isAll = args.includes('--all') || args.includes('-a');
  const cleanArgs = args.filter((a) => a !== '--dry-run' && a !== '--all' && a !== '-a');

  if (isAll) {
    console.log('[SVN 提交] 触发 --all 参数，正在秒级同步当前工作区所有改动路径...');
    pickFiles();
  }

  let logmsg = '';
  for (let i = 0; i < cleanArgs.length; i++) {
    if (cleanArgs[i] === '-m' || cleanArgs[i] === '--message') {
      logmsg = cleanArgs[i + 1] || '';
      break;
    } else if (!cleanArgs[i].startsWith('-')) {
      logmsg = cleanArgs[i];
      break;
    }
  }

  if (!logmsg || logmsg.trim().length === 0) {
    console.error('错误: 请提供纯中文提交日志，例如: -m "结算弹窗优化与奖励刷新逻辑修复"');
    process.exit(1);
  }

  // 纯中文检查（禁止英文或中英混排）
  if (/[a-zA-Z]/.test(logmsg)) {
    console.error(`错误: SVN 提交日志必须纯中文，禁止包含英文字符！当前日志: "${logmsg}"`);
    process.exit(1);
  }

  const files = loadStagedFiles();
  if (files.length === 0) {
    console.error('错误: 暂存单为空！请先通过 `add` / `pick` 添加，或使用 `commit --all` 自动抓取。');
    process.exit(1);
  }

  // 根目录卫生检查
  try {
    console.log('[检查] 正在执行根目录卫生检查...');
    execSync('node tools/check-root-hygiene.mjs', { stdio: 'inherit' });
  } catch (err) {
    console.error('错误: 根目录卫生检查未通过，提交已终止。');
    process.exit(1);
  }

  if (isDryRun) {
    console.log(`[DRY RUN] 校验通过：纯中文日志合规，根目录卫生通过，待提交文件 ${files.length} 项。未唤起 TortoiseProc。`);
    return;
  }

  if (!fs.existsSync(TORTOISE_PROC)) {
    console.error(`错误: 未找到 TortoiseProc.exe: ${TORTOISE_PROC}`);
    process.exit(1);
  }

  console.log(`[SVN 提交] 准备唤起 TortoiseProc 确认窗口...`);
  console.log(`- 待确认文件数: ${files.length}`);
  console.log(`- 提交日志: "${logmsg}"`);

  // 当路径总长度在安全限制内（< 2000 字符）时优先直传 /path（* 分隔），彻底绕过文件读写；长列表使用无 BOM 的 UTF-16LE /pathfile
  const pathArgString = files.join('*');
  const pathArgs = pathArgString.length < 2000
    ? [`/path:${pathArgString}`]
    : [`/pathfile:${STAGE_FILE}`];

  const proc = spawn(
    TORTOISE_PROC,
    [
      '/command:commit',
      ...pathArgs,
      `/logmsg:${logmsg}`,
      '/closeonend:2',
    ],
    { detached: true, stdio: 'ignore' }
  );
  proc.unref();

  console.log('\n======================================================');
  console.log(' TortoiseSVN 提交窗口已弹出，请在窗口中确认文件并点击【确定】！');
  console.log(' 提交完成后，可运行 `node tools/dev/svn-stage.mjs clear` 清空暂存单。');
  console.log('======================================================\n');
}

// CLI 执行入口
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isDirectRun || process.argv[1]?.endsWith('svn-stage.mjs')) {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'add':
      addFiles(rest);
      break;
    case 'pick':
      pickFiles(rest[0]);
      break;
    case 'rm':
    case 'remove':
      removeFiles(rest);
      break;
    case 'list':
    case 'status':
      listFiles();
      break;
    case 'clear':
      clearFiles();
      break;
    case 'commit':
      commitFiles(rest);
      break;
    default:
      console.log(`
SVN 改动暂存工具用法:
  node tools/dev/svn-stage.mjs add <file...>          添加文件（自动带上伴生 .meta）
  node tools/dev/svn-stage.mjs pick [scope]          秒级抓取工作区变动路径入单（0 深度分析）
  node tools/dev/svn-stage.mjs rm <file...>           移除已暂存文件
  node tools/dev/svn-stage.mjs list                  查看当前暂存清单
  node tools/dev/svn-stage.mjs clear                 清空暂存清单
  node tools/dev/svn-stage.mjs commit -m "日志"       调起 TortoiseProc 弹窗（校验纯中文与卫生）
  node tools/dev/svn-stage.mjs commit --all -m "日志" 秒级抓取全部改动并一键调起弹窗
`);
      break;
  }
}
