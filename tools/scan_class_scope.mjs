/**
 * 类作用域泄漏扫描器（配合 docs/AI架构与代码规范.md §6.2 第 12 条）。
 *
 * 扫描 zcds 下每个模块级 const/function（含 enum），统计全工程
 * （assets/script + tests）消费它的「文件 / 类」，输出：
 *  - 仅被 1 个类消费、却放在模块级（尤其 export）的符号 ⇒ 违规候选
 *  - 被 ≥2 类或跨文件消费的符号 ⇒ 合法共享
 *
 * 用法：node tools/scan_class_scope.mjs
 * 结果是静态文本分析，候选需人工复核（注释/同名子串会造成误报）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ZCDS_ROOT = path.join('assets', 'script', 'app', 'zcds');
const SEARCH_ROOTS = [path.join('assets', 'script'), 'tests'];

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.name.endsWith('.ts')) {
            out.push(full);
        }
    }
    return out;
}

const zcdsFiles = walk(ZCDS_ROOT);
const allFiles = [...new Set(SEARCH_ROOTS.flatMap((root) => walk(root)))];

/**
 * 解析单文件：返回模块级声明与类块行范围。
 * 用逐行大括号深度近似（字符串/注释干扰对本扫描可接受，候选会人工复核）。
 */
function parseFile(file) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    const classes = [];
    const declarations = [];
    let depth = 0;
    const classStack = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (depth === 0) {
            const decl = /^\s*(export\s+)?(const|function|enum)\s+([A-Za-z0-9_]+)/.exec(line);
            if (decl) {
                declarations.push({
                    name: decl[3],
                    kind: decl[2],
                    exported: !!decl[1],
                    line: i,
                });
            }
            const cls = /^\s*(export\s+)?(abstract\s+)?class\s+([A-Za-z0-9_]+)/.exec(line);
            if (cls) classStack.push({ name: cls[3], start: i, baseDepth: 0 });
        }
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        depth += opens - closes;
        while (classStack.length && depth <= classStack[classStack.length - 1].baseDepth) {
            const cls = classStack.pop();
            classes.push({ name: cls.name, start: cls.start, end: i });
        }
    }
    for (const cls of classStack) classes.push({ name: cls.name, start: cls.start, end: lines.length - 1 });
    return { lines, classes, declarations };
}

const parsed = new Map();
for (const file of allFiles) parsed.set(file, parseFile(file));

/** 行号 → 所在类名（不在类内返回 null）。 */
function classAtLine(info, lineNo) {
    const hit = info.classes.find((c) => lineNo >= c.start && lineNo <= c.end);
    return hit ? hit.name : null;
}

const results = [];
for (const file of zcdsFiles) {
    const info = parsed.get(file);
    for (const decl of info.declarations) {
        const token = new RegExp(`\\b${decl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        const consumers = new Map(); // key: file|class → refs
        for (const other of allFiles) {
            const otherInfo = parsed.get(other);
            for (let i = 0; i < otherInfo.lines.length; i += 1) {
                const text = otherInfo.lines[i];
                if (!token.test(text)) continue;
                // 跳过声明行本身
                if (other === file && i === decl.line) continue;
                const cls = classAtLine(otherInfo, i);
                const key = `${other}${cls ? `#${cls}` : '#<module>'}`;
                consumers.set(key, (consumers.get(key) ?? 0) + 1);
            }
        }
        const classSet = new Set();
        const fileSet = new Set();
        for (const key of consumers.keys()) {
            const [f, clsPart] = key.split('#');
            fileSet.add(f);
            if (clsPart !== '<module>') classSet.add(`${f}#${clsPart}`);
        }
        results.push({
            symbol: decl.name,
            kind: decl.kind,
            declared: file,
            exported: decl.exported,
            refs: Array.from(consumers.keys()),
            consumingClasses: classSet.size,
            consumingFiles: fileSet.size,
        });
    }
}

// 分类：
//  - A 类：含类文件里的模块级符号，仅被 1 个类消费（同文件），应内聚 private
//  - B 类：符号被别处（跨文件）的 1 个类消费，属导出 API 漂移，应搬到消费类
//  - 纯模块文件（无类）内部的模块级互调：设计如此，不统计
const classCountByFile = new Map();
for (const [file, info] of parsed) classCountByFile.set(file, info.classes.length);

const violationsA = [];
const violationsB = [];
const moduleOnly = [];
for (const r of results) {
    if (r.consumingClasses === 1 && r.consumingFiles === 1) {
        // 唯一消费文件就是声明文件 ⇒ A（内聚到本文件的类）；否则 ⇒ B（搬到消费类）
        const onlyFile = r.refs[0].split('#')[0];
        if (onlyFile === r.declared) violationsA.push(r);
        else violationsB.push(r);
    } else if (r.consumingClasses === 0 && r.consumingFiles === 1) {
        const declaredHasClass = classCountByFile.get(r.declared) > 0;
        if (declaredHasClass) moduleOnly.push(r);
        // 纯模块文件内部互调不报
    }
}

const rel = (p) => p.replace(/\\/g, '/');
const show = (r) => `  - ${r.exported ? '[export]' : '[file]  '} ${r.kind} ${r.symbol}  (${rel(r.declared)})
      → ${r.refs.map(rel).join(', ')}`;

console.log(`# 扫描 zcds 模块级 const/function/enum：${results.length} 个符号`);
console.log(`\n## A 类违规（含类文件，仅 1 个类消费，应内聚 private）：${violationsA.length}`);
for (const r of violationsA.sort((a, b) => rel(a.declared).localeCompare(rel(b.declared)))) console.log(show(r));
console.log(`\n## B 类违规（导出符号仅被另一文件的 1 个类消费，应搬到消费类）：${violationsB.length}`);
for (const r of violationsB.sort((a, b) => rel(a.declared).localeCompare(rel(b.declared)))) console.log(show(r));
console.log(`\n## 含类文件中仅模块级使用（无类消费，人工确认）：${moduleOnly.length}`);
for (const r of moduleOnly.sort((a, b) => rel(a.declared).localeCompare(rel(b.declared)))) console.log(show(r));
const shared = results.filter((r) => r.consumingClasses >= 2 || r.consumingFiles >= 2);
console.log(`\n## 合法共享（≥2 类或跨文件）：${shared.length}`);
