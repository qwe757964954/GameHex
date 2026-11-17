#!/usr/bin/env node
/**
 * function-body-layout.mjs —— 函数体换行排版的 AST 检查。
 *
 * 存在理由：
 *   仓库里有一类排版回归 —— 函数签名与第一条语句挤在同一行，后续语句却正常缩进：
 *       foo(context: IXxxContext): void {        const target = ...;
 *           ...
 *       }
 *   它不会被 tsc / 任何现有护栏捕获，却让 diff 与 review 无法按行读。
 *   本工具用 TypeScript AST 判定两类形态，不做任何文本正则：
 *       A 类：函数体跨多行，但首句与左花括号同行  → 门禁阻断
 *       B 类：整个函数体在同一行                    → 仅报告，逐项判断
 *
 * 用法：
 *   node tools/verify/function-body-layout.mjs scan       全量扫描，列出 A 类；B 类给汇总
 *   node tools/verify/function-body-layout.mjs scan --json 机器可读输出
 *   node tools/verify/function-body-layout.mjs check      增量门禁：改动文件里不许新增 A 类
 *   node tools/verify/function-body-layout.mjs baseline   把当前 A 类快照写入 tmp/verify
 *   node tools/verify/function-body-layout.mjs compare <before> <after>  比较 AST 指纹（忽略空白/注释）
 *
 * 基线口径：按「文件 + 函数限定名 + 形参签名 + 同名序号」定位，不含行号；
 * 没有基线文件时回落到 VCS 中该文件的上一版（git show HEAD:<file> / svn cat）。
 *
 * 扫描范围：assets/script、tests、tools 下的 .ts/.js/.mjs/.cjs；
 * 排除第三方与生成代码、声明文件、library/temp/build/native 等产物。
 *
 * 约定：本文件是 .mjs 不是 .ts —— 工程 tsconfig 会扫全工程，
 * 放 .ts 会被全量编译扫进去；配套声明见 function-body-layout.d.mts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { changedFiles, norm } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASELINE = path.join(ROOT, 'tmp', 'verify', 'function-body-layout-baseline.json');

const SCAN_ROOTS = ['assets/script', 'tests', 'tools'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const DECLARATION_FILE_RE = /\.d\.(?:ts|mts|cts)$/i;

/**
 * 目录级排除。只按仓库相对路径前缀判断，避免误伤业务层的 `lib` 同名目录。
 * vscrollview 是引入的第三方滚动视图组件，保留上游排版，不纳入本仓风格治理。
 */
const EXCLUDED_PREFIXES = [
    { prefix: 'assets/script/lib/', reason: '第三方库与生成的 protobuf 静态协议（含 1.8MB protoCompiledStatic.ts）' },
    { prefix: 'assets/script/vscrollview/', reason: '第三方 VScrollView 组件，沿用上游排版' },
    { prefix: 'assets/script/app/generated/', reason: '协议/导表生成目录' },
];

/** 构建产物与依赖目录；即使被放进扫描根也不读。 */
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'library', 'temp', 'build', 'native', '.git', '__pycache__']);

// ---------------------------------------------------------------- 文件收集

function excludedReason(rel) {
    for (const item of EXCLUDED_PREFIXES) {
        if (rel.startsWith(item.prefix)) return item.reason;
    }
    for (const segment of rel.split('/')) {
        if (EXCLUDED_SEGMENTS.has(segment)) return `构建产物/依赖目录 ${segment}`;
    }
    if (DECLARATION_FILE_RE.test(rel)) return '声明文件（只有签名没有函数体）';
    return null;
}

function countFilesUnder(absDir) {
    let total = 0;
    const walk = (dir) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
            else if (entry.isFile()) total++;
        }
    };
    walk(absDir);
    return total;
}

/**
 * 收集扫描范围内的源码文件。
 * excluded 统计按原因聚合，供「扫描统计」交付时直接引用，不用事后手数。
 */
function collectSourceFiles() {
    const files = [];
    const excluded = { total: 0, byReason: {} };
    const bump = (reason, count) => {
        excluded.total += count;
        excluded.byReason[reason] = (excluded.byReason[reason] ?? 0) + count;
    };

    const walk = (absDir, relDir) => {
        let entries = [];
        try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const rel = norm(relDir ? `${relDir}/${entry.name}` : entry.name);
            if (entry.isDirectory()) {
                const reason = excludedReason(`${rel}/`);
                if (reason) {
                    bump(reason, countFilesUnder(path.join(absDir, entry.name)));
                    continue;
                }
                walk(path.join(absDir, entry.name), rel);
                continue;
            }
            if (!entry.isFile()) continue;
            const reason = excludedReason(rel);
            if (reason) { bump(reason, 1); continue; }
            const ext = path.extname(entry.name).toLowerCase();
            if (SOURCE_EXTENSIONS.has(ext)) files.push(rel);
            else bump('非 TS/JS 源码', 1);
        }
    };

    for (const root of SCAN_ROOTS) {
        const abs = path.join(ROOT, root);
        if (!fs.existsSync(abs)) continue;
        walk(abs, root);
    }
    return { files, excluded };
}

// ------------------------------------------------------------ AST 判定

function scriptKindOf(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return ext === '.js' || ext === '.mjs' || ext === '.cjs' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function isFunctionWithBlockBody(node) {
    const candidate = ts.isFunctionDeclaration(node)
        || ts.isMethodDeclaration(node)
        || ts.isConstructorDeclaration(node)
        || ts.isGetAccessorDeclaration(node)
        || ts.isSetAccessorDeclaration(node)
        || ts.isFunctionExpression(node)
        || ts.isArrowFunction(node);
    return candidate && Boolean(node.body) && ts.isBlock(node.body);
}

function kindTagOf(node) {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isGetAccessorDeclaration(node)) return 'get';
    if (ts.isSetAccessorDeclaration(node)) return 'set';
    if (ts.isMethodDeclaration(node)) return 'method';
    if (ts.isFunctionDeclaration(node)) return 'function';
    if (ts.isFunctionExpression(node)) return 'function-expression';
    if (ts.isArrowFunction(node)) return 'arrow';
    return 'function';
}

function ownLabel(node, sf) {
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        return `${ts.isGetAccessorDeclaration(node) ? 'get' : 'set'} ${node.name.getText(sf)}`;
    }
    if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name))) {
        return node.name.getText(sf);
    }
    return '';
}

/** 形如 `const f = () => {}` / `obj.f = function () {}`：名字由父节点提供，函数自身不再补 `<anonymous>`。 */
function parentProvidesName(node) {
    const parent = node.parent;
    if (!parent) return false;
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent))
        && parent.initializer === node) return true;
    if (ts.isBinaryExpression(parent) && parent.right === node) return true;
    if (ts.isExportAssignment(parent) && parent.expression === node) return true;
    return false;
}

/** 祖先里能提供限定名的节点；只认具名声明，不参与表达式。 */
function containerLabel(node, sf) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node)) {
        return node.name ? node.name.getText(sf) : '';
    }
    if (ts.isModuleDeclaration(node)) return node.name.getText(sf);
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) {
        return node.name ? node.name.getText(sf) : '';
    }
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        return `${ts.isGetAccessorDeclaration(node) ? 'get' : 'set'} ${node.name.getText(sf)}`;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
    if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) return node.name ? node.name.getText(sf) : '';
    return '';
}

function displayNameOf(node, sf) {
    const parts = [];
    const skipOwn = parentProvidesName(node);
    let cur = node;
    while (cur && !ts.isSourceFile(cur)) {
        if (cur === node) {
            const own = skipOwn ? '' : ownLabel(cur, sf);
            parts.push(own || '<anonymous>');
        } else {
            const label = containerLabel(cur, sf);
            if (label) parts.push(label);
        }
        cur = cur.parent;
    }
    return parts.reverse().join('.');
}

function paramsFingerprint(node, sf) {
    return node.parameters.map((p) => p.getText(sf).replace(/\s+/g, ' ').trim()).join(', ');
}

function lineOf(sf, pos) {
    return sf.getLineAndCharacterOfPosition(pos).line;
}

/**
 * 形态判定：
 *   左花括号所在行 vs 首句起始行。首句同行且闭合括号在更后面 ⇒ A；首句同行且整体一行 ⇒ B。
 * 空函数体（只有注释也算空）不参与判定 —— 规则只约束非空函数体。
 */
function bodyShape(body, sf) {
    if (!body.statements.length) return null;
    const openPos = body.getStart(sf);
    const closePos = body.getEnd() - 1;
    const firstPos = body.statements[0].getStart(sf);
    const openLine = lineOf(sf, openPos);
    const firstLine = lineOf(sf, firstPos);
    const closeLine = lineOf(sf, closePos);
    if (firstLine !== openLine) return null;
    return {
        category: closeLine === openLine ? 'B' : 'A',
        line: firstLine + 1,
        column: sf.getLineAndCharacterOfPosition(firstPos).character + 1,
        bodyStartLine: openLine + 1,
        bodyEndLine: closeLine + 1,
        statementCount: body.statements.length,
        bodyChars: body.getText(sf).replace(/\s+/g, ' ').trim().length,
        source: body.statements[0].getText(sf).replace(/\s+/g, ' ').trim().slice(0, 80),
    };
}

/**
 * 扫描一段源码文本。
 * 返回所有命中项；同文件内同名函数的序号按源码顺序分配，供基线按「文件+函数」定位，
 * 不依赖行号（行号只用于人读与修复定位）。
 */
function scanSource(text, file) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
    const findings = [];
    const ordinals = new Map();

    const visit = (node) => {
        if (isFunctionWithBlockBody(node)) {
            const name = displayNameOf(node, sf);
            const kindTag = kindTagOf(node);
            const params = paramsFingerprint(node, sf);
            const key = `${name}|${kindTag}|${params}`;
            const ordinal = ordinals.get(key) ?? 0;
            ordinals.set(key, ordinal + 1);
            const shape = bodyShape(node.body, sf);
            if (shape) {
                findings.push({
                    file: norm(file),
                    category: shape.category,
                    name,
                    kindTag,
                    params,
                    ordinal,
                    line: shape.line,
                    column: shape.column,
                    bodyStartLine: shape.bodyStartLine,
                    bodyEndLine: shape.bodyEndLine,
                    statementCount: shape.statementCount,
                    bodyChars: shape.bodyChars,
                    statementPreview: shape.source,
                    id: `${name}|${kindTag}|${params}|${ordinal}`,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return findings;
}

function scanFile(file) {
    const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return scanSource(fs.readFileSync(abs, 'utf8'), norm(file));
}

function scanRepo() {
    const collection = collectSourceFiles();
    const results = [];
    for (const file of collection.files) {
        try {
            results.push({ file, findings: scanFile(file) });
        } catch (error) {
            results.push({ file, findings: [], error: String(error && error.message ? error.message : error) });
        }
    }
    return { collection, results };
}

function summarize(results) {
    const a = [];
    const b = [];
    const unreadable = [];
    for (const item of results) {
        if (item.error) unreadable.push(item);
        for (const finding of item.findings) {
            if (finding.category === 'A') a.push(finding);
            else b.push(finding);
        }
    }
    return { a, b, unreadable };
}

// ---------------------------------------------------------------- 基线

function baselineKey(file) {
    return norm(file);
}

function withoutFile(finding) {
    return finding.id;
}

/** 读取基线快照：`{ files: { "路径": ["函数id", ...] } }`。缺失返回 null（由调用方回落 VCS）。 */
function loadBaseline(file = BASELINE) {
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const map = new Map();
        for (const [key, ids] of Object.entries(data.files ?? {})) {
            map.set(baselineKey(key), new Set(Array.isArray(ids) ? ids : []));
        }
        return map;
    } catch {
        return null;
    }
}

function saveBaseline(results, file = BASELINE) {
    const files = {};
    for (const item of results) {
        const a = item.findings.filter((f) => f.category === 'A');
        if (!a.length) continue;
        files[baselineKey(item.file)] = a.map(withoutFile).sort();
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
        generatedAt: new Date().toISOString(),
        scope: SCAN_ROOTS,
        files,
    }, null, 2) + '\n', 'utf8');
    return file;
}

/** VCS 中该文件的上一版内容；拿不到返回 null。 */
function previousSource(file) {
    const git = spawnSync('git', ['show', `HEAD:${norm(file)}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (git.status === 0) return git.stdout;
    const svn = spawnSync('svn', ['cat', norm(file)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (svn.status === 0) return svn.stdout;
    return null;
}

function previousViolationIds(file) {
    const text = previousSource(file);
    if (text == null) return null;
    return new Set(scanSource(text, file).filter((f) => f.category === 'A').map(withoutFile));
}

/**
 * 增量比较：只把「当前存在、基线里没有」的 A 类算新增。
 * baseline 为 null 时对每个文件回落上一版；上一版也拿不到（新文件或 VCS 不可用）时，
 * 该文件当前所有 A 类都按新增处理，并单独标记，避免「比较不了 = 通过」。
 */
function newViolations(current, baseline, previousIdsOf) {
    const additions = [];
    for (const finding of current) {
        if (finding.category !== 'A') continue;
        const file = baselineKey(finding.file);
        let baseIds;
        if (baseline) baseIds = baseline.get(file) ?? new Set();
        else baseIds = previousIdsOf(file);
        if (baseIds === null) {
            additions.push({ ...finding, reason: 'no-baseline' });
            continue;
        }
        if (!baseIds.has(withoutFile(finding))) additions.push({ ...finding, reason: 'new' });
    }
    return additions;
}

// ------------------------------------------------------------ AST 指纹对比

/**
 * AST 指纹：按语法树结构逐节点序列化（节点种类 + 叶子 token 原文），
 * 空白、换行与注释都是 trivia，不进指纹 —— 因此「排版前后指纹相同」等价于
 * 「只动了空白，没有改代码」。
 *
 * 不用裸 scanner：模板字符串 `${...}` 的中间 token 需要 reScanTemplateToken 才能续扫，
 * 直接 scan 会把闭合反引号当成新的模板开头，吞掉后续大段代码（实测会误报）。
 */
function syntaxFingerprint(text, fileName) {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
    const out = [];
    const walk = (node) => {
        const children = node.getChildren(sf);
        if (!children.length) {
            out.push(`${node.kind}:${node.getText(sf)}`);
            return;
        }
        out.push(`<${node.kind}>`);
        for (const child of children) walk(child);
        out.push(`</${node.kind}>`);
    };
    walk(sf);
    return out;
}

function compareSyntax(beforeText, afterText, fileName) {
    const before = syntaxFingerprint(beforeText, fileName);
    const after = syntaxFingerprint(afterText, fileName);
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
        if (before[i] !== after[i]) {
            return { equal: false, index: i, before: before[i] ?? null, after: after[i] ?? null };
        }
    }
    return { equal: true, index: -1, before: null, after: null };
}

// ---------------------------------------------------------------- CLI

/**
 * Git 侧改动集。`verify.mjs` 的 `changedFiles()` 优先 SVN（仓库是「父目录 SVN + 本目录 Git」双库），
 * 在 Git 工作树里改了但 SVN 未标记的文件会被漏掉；排版门禁取两边并集，保证「改了哪个函数就查哪个」。
 * `core.quotepath=false` 避免非 ASCII 路径被转义成八进制。
 */
function gitChangedFiles() {
    const result = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    const out = [];
    for (const line of result.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        // 形如 ` M path` / `?? path` / `R  old -> new`；重命名取新路径。
        const raw = line.slice(3).trim();
        const renamed = raw.includes(' -> ') ? raw.split(' -> ').pop() : raw;
        out.push(norm(renamed.replace(/^"(.*)"$/, '$1')));
    }
    return out;
}

function changedSourceFiles() {
    const candidates = [...changedFiles(), ...gitChangedFiles()]
        .map(norm)
        .filter((file) => {
            if (!file) return false;
            const inScope = SCAN_ROOTS.some((root) => file.startsWith(`${root}/`));
            if (!inScope) return false;
            if (!SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
            return !excludedReason(file);
        });
    return [...new Set(candidates)].filter((file) => fs.existsSync(path.join(ROOT, file)));
}

function formatFinding(finding) {
    return `${norm(finding.file)}:${finding.line}  ${finding.name}  [${finding.kindTag}]`;
}

function printScan(results, collection, options = {}) {
    const { a, b, unreadable } = summarize(results);
    const byRoot = {};
    for (const file of collection.files) {
        const root = SCAN_ROOTS.find((r) => file.startsWith(`${r}/`)) ?? 'other';
        byRoot[root] = (byRoot[root] ?? 0) + 1;
    }
    const reasonText = Object.entries(collection.excluded.byReason)
        .map(([reason, count]) => `${reason} ${count}`)
        .join('；');
    console.log(`[layout] 扫描根：${SCAN_ROOTS.join('、')}`);
    console.log(`[layout] 源码 ${collection.files.length} 个（${Object.entries(byRoot).map(([r, c]) => `${r} ${c}`).join(' / ')}）`);
    console.log(`[layout] 排除 ${collection.excluded.total} 个文件${reasonText ? `（${reasonText}）` : ''}`);
    if (unreadable.length) {
        console.log(`[layout] ⚠️ 无法读取 ${unreadable.length} 个文件`);
        for (const item of unreadable) console.log(`    ${item.file}: ${item.error}`);
    }
    console.log(`[layout] A 类（函数体跨行但首句与左花括号同行）：${a.length} 处 / ${new Set(a.map((f) => f.file)).size} 个文件`);
    if (options.listA !== false) {
        for (const finding of a) console.log(`    A  ${formatFinding(finding)}`);
    }
    console.log(`[layout] B 类（整个函数体同一行）：${b.length} 处 / ${new Set(b.map((f) => f.file)).size} 个文件（仅报告，不阻断）`);
    if (options.listB) {
        for (const finding of b) console.log(`    B  ${formatFinding(finding)}  ${finding.bodyEndLine === finding.bodyStartLine ? '' : ''}${finding.statementPreview}`);
    }
    return { a, b, unreadable };
}

function runCheck() {
    const files = changedSourceFiles();
    console.log(`[layout] 增量检查：改动源码 ${files.length} 个`);
    if (!files.length) {
        console.log('[layout] ✅ 改动集内没有需要检查的 TS/JS 源码');
        return 0;
    }
    const current = [];
    for (const file of files) {
        try { current.push(...scanFile(file).filter((f) => f.category === 'A')); } catch { /* 读不了的文件在 scan 模式里报 */ }
    }
    const baseline = loadBaseline();
    const additions = newViolations(current, baseline, previousViolationIds);
    console.log(`[layout] 当前 A 类 ${current.length} 处；基线来源：${baseline ? 'tmp/verify/function-body-layout-baseline.json' : 'VCS 上一版（未找到基线快照）'}`);
    if (!additions.length) {
        console.log('[layout] ✅ 没有新增「函数体首句未换行」');
        return 0;
    }
    console.log(`[layout] ❌ 新增 ${additions.length} 处：`);
    for (const finding of additions) {
        const hint = finding.reason === 'no-baseline' ? '（无可比基线，按新增处理）' : '';
        console.log(`    ${formatFinding(finding)}${hint}`);
        console.log(`        首句：${finding.statementPreview}`);
        console.log('        修法：左花括号后换行，函数体按所属层级缩进；只动换行与缩进。');
    }
    return 1;
}

function runCompare(beforeFile, afterFile) {
    if (!beforeFile || !afterFile) {
        console.error('用法：node tools/verify/function-body-layout.mjs compare <before> <after>');
        return 2;
    }
    const beforeText = fs.readFileSync(path.resolve(ROOT, beforeFile), 'utf8');
    const afterText = fs.readFileSync(path.resolve(ROOT, afterFile), 'utf8');
    const result = compareSyntax(beforeText, afterText, beforeFile);
    if (result.equal) {
        console.log(`[layout] ✅ AST 指纹完全一致（${syntaxFingerprint(beforeText, beforeFile).length} 个节点/叶 token）`);
        return 0;
    }
    console.log(`[layout] ❌ AST 指纹不一致：第 ${result.index} 项`);
    console.log(`    before: ${result.before}`);
    console.log(`    after : ${result.after}`);
    return 1;
}

function runCli(argv) {
    const mode = argv[2] || 'scan';
    if (mode === 'scan' || mode === 'full') {
        const { collection, results } = scanRepo();
        if (argv.includes('--json')) {
            const { a, b, unreadable } = summarize(results);
            console.log(JSON.stringify({ files: collection.files.length, excluded: collection.excluded, a, b, unreadable }, null, 2));
            return argv.includes('--fail') && a.length ? 1 : 0;
        }
        const { a } = printScan(results, collection, { listB: argv.includes('--list-b') });
        return argv.includes('--fail') && a.length ? 1 : 0;
    }
    if (mode === 'baseline') {
        const { results } = scanRepo();
        const file = saveBaseline(results);
        const { a } = summarize(results);
        console.log(`[layout] 基线已写入 ${norm(path.relative(ROOT, file))}（A 类 ${a.length} 处）`);
        return 0;
    }
    if (mode === 'check') return runCheck();
    if (mode === 'compare') return runCompare(argv[3], argv[4]);
    console.error(`未知模式：${mode}（可用：scan / check / baseline / compare）`);
    return 2;
}

export {
    SCAN_ROOTS,
    collectSourceFiles,
    scanSource,
    scanFile,
    scanRepo,
    summarize,
    loadBaseline,
    saveBaseline,
    newViolations,
    previousViolationIds,
    syntaxFingerprint,
    compareSyntax,
    runCli,
};

const invokedDirectly = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exit(runCli(process.argv));
