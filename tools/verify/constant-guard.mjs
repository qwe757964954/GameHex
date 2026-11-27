#!/usr/bin/env node
/**
 * constant-guard.mjs —— 常量泛滥治理的只读结构门禁。
 *
 * 存在理由：
 *   《工程常量泛滥治理方案》的 Phase 1～3 是「减法」，但没有护栏时减法会被后续迭代
 *   按同样的习惯再加回来（死导出、裸色号、原子碎裂、跨 feature 复制真源）。本工具把
 *   方案 §3 的五层真源与 §4 Phase 4 的四条拦截规则固化成可执行的增量门禁。
 *
 * 口径：**存量建基线、增量零新增**。
 *   基线 `tools/verify/constant-baseline.json` 是当前工作副本的违规指纹快照（随仓库走，
 *   保证另一台机器判定一致）；`check` 只把「不在基线里」的违规算作新增。
 *   基线是净额快照，不包含行号：删掉一条旧违规再加一条新违规、但指纹不同 → 仍算新增。
 *
 * 用法：
 *   node tools/verify/constant-guard.mjs check     增量门禁（改动文件 vs 基线）
 *   node tools/verify/constant-guard.mjs audit     全仓现状统计（复核方案数据口径）
 *   node tools/verify/constant-guard.mjs audit --json
 *   node tools/verify/constant-guard.mjs baseline  重算存量基线（清理完成或接纳存量后执行）
 *
 * 环境变量：VERIFY_CHANGED_FILES（换行分隔改动文件），优先于 svn/git status。
 * 退出码：0 通过 / 1 有新增违规 / 2 工具自身出错（含基线缺失）。
 *
 * 约定：本文件是 .mjs 不是 .ts —— 工程 tsconfig 无 include，放 .ts 会被全量编译扫进去。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { changedFiles, norm } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BASELINE = path.join(HERE, 'constant-baseline.json');

const SOURCE_ROOTS = ['assets/script'];
const REFERENCE_ROOTS = ['assets/script', 'tests', 'tools'];
const SOURCE_EXTENSIONS = new Set(['.ts']);
const DECLARATION_FILE_RE = /\.d\.(?:ts|mts|cts)$/i;

/** 生成代码与第三方不参与治理，也不作为「生产消费者」计数。 */
const EXCLUDED_PREFIXES = [
    'assets/script/lib/',
    'assets/script/vscrollview/',
    'assets/script/app/generated/',
];
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'library', 'temp', 'build', 'native', '.git', '__pycache__']);

/** L3 跨模块真源：这些文件的导出天然是公共契约，不按「仅文件内消费」判定。 */
const CANONICAL_FILES = new Set([
    'assets/script/core/config/TableNames.ts',
    'assets/script/app/ArtPaths.ts',
    'assets/script/core/asset/BundleCatalog.ts',
    'assets/script/core/time/TimeMs.ts',
    'assets/script/core/time/Timeouts.ts',
    'assets/script/app/net/Timeouts.ts',
    'assets/script/core/hex/HexGridLayout.ts',
]);

const APP_PREFIX = 'assets/script/app/';

/** 规则元数据：code → 标题与默认严重级。warn 只报告，不阻断。 */
export const RULES = {
    C1: { title: '新增死导出（全仓零引用）', severity: 'error' },
    C2: { title: '新增过度导出（仅本文件消费）', severity: 'error' },
    C3: { title: '新增与公共真源同值常量', severity: 'error' },
    C4: { title: '非 Theme 文件新增裸 new Color', severity: 'error' },
    C5: { title: '新增非 const enum', severity: 'error' },
    C6: { title: '导出的对象/数组字面量未冻结', severity: 'error' },
    C7: { title: 'model 层出现 UI 样式文件或字号/色号', severity: 'error' },
    C8: { title: '跨 feature 直连其他模块的 Art/Texts', severity: 'error' },
    C9: { title: '单文件原子导出超预算', severity: 'warn' },
    C10: { title: '跨文件导出同名常量', severity: 'warn' },
    C11: { title: '唯测试/工具引用的导出', severity: 'error' },
};

const ATOMIC_EXPORT_BUDGET = 15;

// ---------------------------------------------------------------- 基础工具

function excludedReason(rel) {
    for (const prefix of EXCLUDED_PREFIXES) {
        if (rel.startsWith(prefix)) return prefix;
    }
    for (const segment of rel.split('/')) {
        if (EXCLUDED_SEGMENTS.has(segment)) return segment;
    }
    if (DECLARATION_FILE_RE.test(rel)) return 'declaration';
    return null;
}

function walkFiles(root, relRoot, out = []) {
    const absRoot = path.join(root, relRoot);
    if (!fs.existsSync(absRoot)) return out;
    const stack = [absRoot];
    while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const target = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
                stack.push(target);
                continue;
            }
            if (!entry.isFile()) continue;
            const rel = norm(path.relative(root, target));
            if (excludedReason(rel)) continue;
            if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
            out.push(rel);
        }
    }
    return out;
}

function collectFiles(root, roots) {
    return roots.flatMap((relRoot) => walkFiles(root, relRoot));
}

function readText(root, rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function lineOf(sf, node) {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function hasModifier(node, kind) {
    const modifiers = node.modifiers;
    return Boolean(modifiers && modifiers.some((item) => item.kind === kind));
}

// ---------------------------------------------------------------- 引用统计

/**
 * 只统计给定符号名的词法出现次数，按「文件 → 次数」返回。
 * 词法而非 AST：导出常量的消费方式（import、`Mod.X`、注释里的引用）都落在文本上，
 * 用 AST 反而会漏掉 `import * as Mod` 的间接消费。
 */
export function countReferences(root, names) {
    const counts = new Map();
    for (const name of names) counts.set(name, new Map());
    const files = collectFiles(root, REFERENCE_ROOTS);
    for (const rel of files) {
        const text = readText(root, rel);
        const tokens = text.match(/[A-Za-z0-9_$]+/g) || [];
        for (const token of tokens) {
            const bucket = counts.get(token);
            if (!bucket) continue;
            bucket.set(rel, (bucket.get(rel) || 0) + 1);
        }
    }
    return counts;
}

function externalCountOf(counts, name, ownFile, scope) {
    const bucket = counts.get(name);
    if (!bucket) return 0;
    let total = 0;
    for (const [file, hits] of bucket) {
        if (file === ownFile) continue;
        if (scope && !scope(file)) continue;
        total += hits;
    }
    return total;
}

// ---------------------------------------------------------------- 单文件规则

function commentLine(trimmed) {
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function literalValue(initializer) {
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (ts.isNumericLiteral(initializer)) return initializer.text;
    return null;
}

function collectExportConsts(sf, text) {
    const entries = [];
    for (const statement of sf.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            entries.push({
                name: declaration.name.text,
                line: lineOf(sf, declaration),
                initializer: declaration.initializer || null,
                value: literalValue(declaration.initializer),
                statementKind: statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'let',
            });
        }
    }
    return entries;
}

function unfrozenInitializer(initializer) {
    if (!initializer) return false;
    if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) return false;
    if (ts.isCallExpression(initializer)) {
        const callee = initializer.expression.getText();
        if (callee.endsWith('Object.freeze')) return false;
    }
    return ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer);
}

/**
 * 解析单个源码文件的结构类规则（C1/C2/C4/C5/C6/C7/C8）。
 * `context.externalCounts`：名字 → 其他文件出现次数；缺省视为 0。
 */
export function analyzeSource(relFile, text, context = {}) {
    const externalCounts = context.externalCounts || new Map();
    const productionCounts = context.productionCounts || externalCounts;
    const violations = [];
    const sf = ts.createSourceFile(relFile, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const exports = collectExportConsts(sf, text);
    const ownText = text;

    const add = (rule, line, symbol, message) => {
        violations.push({
            rule,
            severity: RULES[rule].severity,
            file: relFile,
            line,
            symbol,
            message,
            fingerprint: `${rule}|${relFile}|${symbol}`,
        });
    };

    // C1 / C2 —— 死导出与过度导出
    const canonical = CANONICAL_FILES.has(relFile);
    for (const entry of exports) {
        if (canonical) continue;
        const own = (ownText.match(new RegExp(`\\b${escapeRegExp(entry.name)}\\b`, 'g')) || []).length - 1;
        const external = externalCounts.get(entry.name) || 0;
        const production = productionCounts.get(entry.name) || 0;
        if (external > 0 && production === 0) {
            add('C11', entry.line, entry.name, `${entry.name} 仅被测试/工具引用；生产零消费，删除或显式标注为对账真源`);
            continue;
        }
        if (external > 0) continue;
        const usedAsTypeSource = new RegExp(`typeof\\s+${escapeRegExp(entry.name)}\\b`).test(ownText);
        if (own <= 0) {
            add('C1', entry.line, entry.name, `${entry.name} 在 assets/script、tests、tools 均零引用；删除或并入使用方`);
        } else if (!usedAsTypeSource) {
            add('C2', entry.line, entry.name, `${entry.name} 仅本文件消费；去掉 export，按 L5 就近内聚`);
        }
    }

    // C4 —— 颜色 Token
    if (!/Theme\.ts$/.test(relFile)) {
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const trimmed = lines[index].trim();
            if (!trimmed.includes('new Color(') || commentLine(trimmed)) continue;
            add('C4', index + 1, trimmed.replace(/\s+/g, ' '), '静态颜色应在模块 *Theme.ts 内以 Object.freeze(new Color(...)) 预实例化');
        }
    }

    // C5 —— 自有 enum
    for (const statement of sf.statements) {
        if (!ts.isEnumDeclaration(statement)) continue;
        const isConst = hasModifier(statement, ts.SyntaxKind.ConstKeyword);
        if (isConst) continue;
        add('C5', lineOf(sf, statement), statement.name.text, `enum ${statement.name.text} 应改为 as const 字典 + 联合类型`);
    }

    // C6 —— 导出字面量冻结
    for (const entry of exports) {
        if (!unfrozenInitializer(entry.initializer)) continue;
        add('C6', entry.line, entry.name, `${entry.name} 的导出字面量需 as const 或 Object.freeze`);
    }

    // C7 —— MVC 归属
    if (/\/model\//.test(relFile)) {
        if (/Style\.ts$/.test(relFile)) {
            add('C7', 1, path.basename(relFile), 'UI 样式文件不得放 model/；迁到 view/ 或 ui/');
        }
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const trimmed = lines[index].trim();
            if (commentLine(trimmed)) continue;
            if (/\bfontSize\b/.test(trimmed) || /#[0-9a-fA-F]{3,8}\b/.test(trimmed)) {
                add('C7', index + 1, trimmed.replace(/\s+/g, ' '), 'model/ 不得承载 UI 字号与色号；改为 view 层 token');
            }
        }
    }

    // C8 —— 跨 feature 直连 Art/Texts
    const importerFeature = featureOf(relFile);
    if (importerFeature) {
        for (const statement of sf.statements) {
            if (!ts.isImportDeclaration(statement)) continue;
            if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
            const specifier = statement.moduleSpecifier.text;
            if (!specifier.startsWith('.')) continue;
            const joined = norm(path.posix.join(path.posix.dirname(relFile), specifier));
            const target = joined.endsWith('.ts') ? joined : `${joined}.ts`;
            const targetFeature = featureOf(target);
            if (!targetFeature || targetFeature === importerFeature || targetFeature === 'common') continue;
            if (!/(Art|Texts)\.ts$/.test(target)) continue;
            add('C8', lineOf(sf, statement), target, `跨 feature 直连 ${targetFeature} 的 ${path.posix.basename(target)}；公共部分应上移到 app/common`);
        }
    }

    return violations;
}

function featureOf(relFile) {
    if (!relFile.startsWith(APP_PREFIX)) return null;
    const rest = relFile.slice(APP_PREFIX.length);
    const slash = rest.indexOf('/');
    return slash < 0 ? null : rest.slice(0, slash);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- 跨文件规则

/** 词法抽取导出常量（含字面量值），供 C3/C10 的跨文件索引；AST 太慢，这里只做声明行匹配。 */
export function lexicalExportEntries(relFile, text) {
    const entries = [];
    const re = /^export\s+const\s+([A-Za-z0-9_$]+)(?:\s*:\s*[^=]+)?\s*=\s*('([^']*)'|"([^"]*)"|(\d+))\s*;/gm;
    for (const match of text.matchAll(re)) {
        const line = text.slice(0, match.index).split('\n').length;
        const value = match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : match[5]);
        entries.push({ name: match[1], value, line, file: relFile });
    }
    return entries;
}

/** C3/C10：与公共真源同值、跨文件同名。返回按 file 归集的违规。 */
export function duplicateViolations(files) {
    const violations = [];
    const nameOwners = new Map();
    const valueOwners = new Map();
    const entriesByFile = new Map();

    for (const file of files) {
        const entries = lexicalExportEntries(file.rel, file.text);
        entriesByFile.set(file.rel, entries);
        for (const entry of entries) {
            if (!nameOwners.has(entry.name)) nameOwners.set(entry.name, new Set());
            nameOwners.get(entry.name).add(entry.file);
            if (entry.value === undefined) continue;
            if (!valueOwners.has(entry.value)) valueOwners.set(entry.value, new Set());
            valueOwners.get(entry.value).add(`${entry.file}|${entry.name}`);
        }
    }

    const push = (rule, file, line, symbol, message) => {
        violations.push({
            rule,
            severity: RULES[rule].severity,
            file,
            line,
            symbol,
            message,
            fingerprint: `${rule}|${file}|${symbol}`,
        });
    };

    for (const [relFile, entries] of entriesByFile) {
        const isCanonical = CANONICAL_FILES.has(relFile);
        for (const entry of entries) {
            if (!isCanonical && entry.value !== undefined) {
                const owners = valueOwners.get(entry.value) || new Set();
                const canonicalOwners = [...owners].filter((owner) => {
                    const ownerFile = owner.split('|')[0];
                    return CANONICAL_FILES.has(ownerFile) && ownerFile !== relFile;
                });
                if (canonicalOwners.length) {
                    push('C3', relFile, entry.line, entry.name, `值 ${JSON.stringify(entry.value)} 已在 ${canonicalOwners.join('、')} 定义；复用公共真源`);
                    continue;
                }
            }
            const owners = nameOwners.get(entry.name) || new Set();
            if (owners.size > 1 && !isCanonical) {
                const others = [...owners].filter((owner) => owner !== relFile);
                push('C10', relFile, entry.line, entry.name, `与 ${others.join('、')} 同名导出；确认是否应复用同一真源`);
            }
        }
    }
    return violations;
}

// ---------------------------------------------------------------- 仓库级编排

function sourceFilesOf(root) {
    return collectFiles(root, SOURCE_ROOTS);
}

function analyzeRepository(root, options = {}) {
    const targets = options.onlyFiles || sourceFilesOf(root);
    const texts = new Map();
    for (const rel of targets) {
        const abs = path.join(root, rel);
        if (!fs.existsSync(abs)) continue;
        texts.set(rel, readText(root, rel));
    }
    const names = new Set();
    for (const [rel, text] of texts) {
        for (const entry of collectExportConsts(ts.createSourceFile(rel, text, ts.ScriptTarget.ES2020, true), text)) {
            names.add(entry.name);
        }
    }
    const refCounts = countReferences(root, names);

    const violations = [];
    const productionScope = (file) => file.startsWith('assets/script/');
    for (const [rel, text] of texts) {
        const externalCounts = new Map();
        const productionCounts = new Map();
        for (const name of names) {
            externalCounts.set(name, externalCountOf(refCounts, name, rel));
            productionCounts.set(name, externalCountOf(refCounts, name, rel, productionScope));
        }
        violations.push(...analyzeSource(rel, text, { externalCounts, productionCounts }));
    }

    const allForDuplicates = sourceFilesOf(root).map((rel) => ({ rel, text: readText(root, rel) }));
    violations.push(...duplicateViolations(allForDuplicates).filter((item) => texts.has(item.file)));

    return { files: [...texts.keys()], violations, exportCounts: exportCountsOf(texts) };
}

function exportCountsOf(texts) {
    const counts = new Map();
    for (const [rel, text] of texts) {
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2020, true);
        counts.set(rel, collectExportConsts(sf, text).length);
    }
    return counts;
}

/** C9：原子导出预算。存量文件只在明显增长时提示；新文件超预算直接提示。 */
export function atomicWarnings(exportCounts, baselineFiles) {
    const warnings = [];
    for (const [file, count] of exportCounts) {
        if (count <= ATOMIC_EXPORT_BUDGET) continue;
        if (CANONICAL_FILES.has(file)) continue;
        if (!baselineFiles) {
            warnings.push({ rule: 'C9', severity: 'warn', file, line: 1, symbol: file,
                message: `${count} 个扁平 export const；聚合为冻结字典`, fingerprint: `C9|${file}` });
            continue;
        }
        const previous = baselineFiles.get(file);
        if (previous === undefined) {
            warnings.push({ rule: 'C9', severity: 'warn', file, line: 1, symbol: file,
                message: `新文件有 ${count} 个扁平 export const；聚合为冻结字典`, fingerprint: `C9|${file}` });
            continue;
        }
        if (count - previous > ATOMIC_EXPORT_BUDGET) {
            warnings.push({ rule: 'C9', severity: 'warn', file, line: 1, symbol: file,
                message: `扁平 export const 由 ${previous} 增至 ${count}；聚合为冻结字典`, fingerprint: `C9|${file}` });
        }
    }
    return warnings;
}

// ---------------------------------------------------------------- 基线

export function loadBaseline(file = BASELINE) {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fingerprints = new Set();
    if (raw.groups) {
        for (const [rule, byFile] of Object.entries(raw.groups)) {
            for (const [pathname, symbols] of Object.entries(byFile)) {
                for (const symbol of symbols) fingerprints.add(`${rule}|${pathname}|${symbol}`);
            }
        }
    }
    for (const item of raw.fingerprints || []) fingerprints.add(item);
    return {
        fingerprints,
        files: new Map(Object.entries(raw.files || {})),
    };
}

export function saveBaseline(root, exportCounts, violations, file = BASELINE) {
    // 按 rule → file → symbol 分组落盘：指纹里的路径只出现一次，1600+ 条基线从 ~250KB 压到 ~60KB。
    const groups = {};
    for (const item of violations) {
        const first = item.fingerprint.indexOf('|');
        const second = item.fingerprint.indexOf('|', first + 1);
        const rule = item.fingerprint.slice(0, first);
        const pathname = item.fingerprint.slice(first + 1, second);
        const symbol = item.fingerprint.slice(second + 1);
        if (!groups[rule]) groups[rule] = {};
        if (!groups[rule][pathname]) groups[rule][pathname] = [];
        groups[rule][pathname].push(symbol);
    }
    const sortedGroups = {};
    for (const rule of Object.keys(groups).sort()) {
        sortedGroups[rule] = {};
        for (const pathname of Object.keys(groups[rule]).sort()) {
            sortedGroups[rule][pathname] = [...new Set(groups[rule][pathname])].sort();
        }
    }
    const files = Object.fromEntries(
        [...exportCounts].filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)),
    );
    const payload = {
        note: '存量常量违规基线（净额快照，无行号）。重算：node tools/verify/constant-guard.mjs baseline',
        version: 2,
        files,
        groups: sortedGroups,
    };
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return file;
}

export function newViolations(current, baseline) {
    if (!baseline) return current;
    return current.filter((item) => !baseline.fingerprints.has(item.fingerprint));
}

// ---------------------------------------------------------------- 改动集

export function changedSourceFiles(root) {
    return changedFiles()
        .map((item) => norm(item))
        .filter((rel) => rel.startsWith('assets/script/'))
        .filter((rel) => SOURCE_EXTENSIONS.has(path.posix.extname(rel)))
        .filter((rel) => !excludedReason(rel))
        .filter((rel) => fs.existsSync(path.join(root, rel)));
}

// ---------------------------------------------------------------- 输出

function formatViolation(item) {
    return `[${item.rule}] ${item.file}:${item.line} ${item.message}`;
}

function auditReport(root) {
    const all = analyzeRepository(root);
    const warnings = atomicWarnings(all.exportCounts, null);
    const byRule = {};
    for (const item of all.violations) byRule[item.rule] = (byRule[item.rule] || 0) + 1;
    const colorOutsideTheme = all.violations.filter((item) => item.rule === 'C4').length;
    return {
        files: all.files.length,
        exportConst: [...all.exportCounts.values()].reduce((sum, count) => sum + count, 0),
        byRule,
        colorOutsideTheme,
        warnings: warnings.length,
        violations: all.violations,
        atomic: warnings,
    };
}

function printAudit(report, asJson) {
    if (asJson) {
        process.stdout.write(`${JSON.stringify({
            files: report.files,
            exportConst: report.exportConst,
            byRule: report.byRule,
            atomicWarnings: report.warnings,
        }, null, 2)}\n`);
        return;
    }
    console.log(`[constant] 扫描 ${report.files} 个非生成源码文件，export const ${report.exportConst} 个`);
    for (const [code, meta] of Object.entries(RULES)) {
        const count = report.byRule[code] || 0;
        if (!count) continue;
        console.log(`[constant] ${code} ${meta.title}：${count}`);
    }
    for (const item of report.atomic.slice(0, 10)) console.log(`[constant] ${formatViolation(item)}`);
}

export function runCli(argv, root = ROOT) {
    const [command = 'check', ...flags] = argv;
    if (command === 'audit') {
        printAudit(auditReport(root), flags.includes('--json'));
        return 0;
    }
    if (command === 'baseline') {
        const all = analyzeRepository(root);
        const warnings = atomicWarnings(all.exportCounts, null);
        const file = saveBaseline(root, all.exportCounts, [...all.violations, ...warnings]);
        console.log(`[constant] 基线已写入 ${norm(path.relative(root, file))}：${all.violations.length} 条违规 / ${all.exportCounts.size} 个文件`);
        return 0;
    }
    if (command !== 'check') {
        console.error(`[constant] 未知命令 ${command}；可用 check / audit / baseline`);
        return 2;
    }

    const baseline = loadBaseline();
    if (!baseline) {
        console.error('[constant] 基线缺失：先执行 node tools/verify/constant-guard.mjs baseline');
        return 2;
    }
    const files = changedSourceFiles(root);
    if (!files.length) {
        console.log('[constant] 改动集内没有 assets/script 源码，跳过');
        return 0;
    }
    const current = analyzeRepository(root, { onlyFiles: files });
    const warnings = atomicWarnings(
        new Map(files.map((rel) => [rel, current.exportCounts.get(rel) || 0])),
        baseline.files,
    );
    const fresh = newViolations([...current.violations, ...warnings], baseline);
    const freshErrors = fresh.filter((item) => item.severity === 'error');
    console.log(`[constant] 改动源码 ${files.length} 个；基线 ${baseline.fingerprints.size} 条`);
    for (const item of fresh) console.log(`[constant] ${formatViolation(item)}`);
    if (freshErrors.length) {
        console.error(`[constant] ❌ 新增常量违规 ${freshErrors.length} 条`);
        return 1;
    }
    console.log('[constant] ✅ 没有新增常量违规');
    return 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === path.resolve(fileURLToPath(import.meta.url))) {
    process.exitCode = runCli(process.argv.slice(2));
}
