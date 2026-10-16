import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

/**
 * zcds 日志统一开关的护栏。
 *
 * 背景：截图里一批 `[ZCCapture] 有我方兵但未占领` 每 60 拍刷一次、一次开局几百行，
 * 把真问题埋掉了。根因是日志开关**每个模块自己定义一个**（`ZC_CAPTURE_DIAGNOSTICS` /
 * `ZC_WALL_DIAGNOSTICS`），想静音得逐个文件去改、还漏得掉。
 *
 * 现在收成唯一真源 `assets/script/app/zcds/ZCDCLogSwitch.ts`，两档：
 * - `ZCDC_LOG_DIAGNOSTICS`（默认关）：逐帧 / 高频定位日志；
 * - `ZCDC_LOG_WARNINGS`（默认开）：加载失败 / 资源缺失 / 配置缺失告警。
 *
 * 本判据用 **AST** 而不是正则数括号：注释里出现的 `console.warn` 示例、行内的中文字符串、
 * 模板字符串跨行拼接都会让文本匹配误判；AST 天然只看真实语法节点（等价于先剥注释）。
 */

const ZCDS_ROOT = 'assets/script/app/zcds';
const SWITCH_FILE = join(ZCDS_ROOT, 'ZCDCLogSwitch.ts');
const SWITCHES = ['ZCDC_LOG_DIAGNOSTICS', 'ZCDC_LOG_WARNINGS'] as const;

/** 递归列出目录下所有 .ts（跳过 .d.ts 与 meta 噪声）。 */
function listTs(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listTs(full));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

interface ILogSite {
    readonly file: string;
    /** 1 基行号。 */
    readonly line: number;
    /** `所属方法::console.warn`；`<文件顶层>` 表示不在方法里。 */
    readonly method: string;
    /** 命中的开关名；空串 = 没挂开关。 */
    readonly switch: string;
    readonly head: string;
}

const CONSOLE_METHODS = /^(?:console|globalThis\.console)\.(?:log|warn|error|info|debug)$/;

/** 收集 zcds 下所有真实 `console.*` 调用点。 */
function collectConsoleCalls(file: string): ILogSite[] {
    const source = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const sites: ILogSite[] = [];

    /** 往父链上找命名一个方法/函数/访问器的祖先（用于报错信息里点名归属）。 */
    const ownerName = (node: ts.Node): string => {
        for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
            if (ts.isMethodDeclaration(cur) && cur.name.getText(sourceFile)) return cur.name.getText(sourceFile);
            if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.getText(sourceFile);
        }
        return '<文件顶层>';
    };

    /** 往父链上找这个调用点所挂的开关名；没挂返回空串。 */
    const switchOf = (node: ts.Node): string => {
        // ⚠️ TS 5.9 起 `IfStatement.condition` 改名 `expression` ⇒ 两个名字都读，别写死。
        const conditionText = (ifNode: ts.IfStatement): string => {
            const cond = (ifNode as ts.IfStatement & { expression?: ts.Expression }).expression
                ?? (ifNode as unknown as { condition?: ts.Expression }).condition;
            return cond ? cond.getText(sourceFile) : '';
        };
        const within = (outer: ts.Node, inner: ts.Node): boolean =>
            outer.getStart() <= inner.getStart() && inner.getEnd() <= outer.getEnd();

        for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
            // 形态一：`if (ZCDC_LOG_x) { … }` / `if (ZCDC_LOG_x) console.warn(…)`。
            // ⚠️ 只认 then 分支 —— 落在 `else` 里等于开关**关着**时才打，语义正好相反。
            if (ts.isIfStatement(cur) && within(cur.thenStatement, node)) {
                const cond = conditionText(cur);
                const hit = SWITCHES.find((name) => cond.includes(name));
                if (hit) return hit;
            }
            // 形态二：方法首行 `if (!ZCDC_LOG_x) return;` 早退，后面整段都是日志。
            if ((ts.isMethodDeclaration(cur) || ts.isFunctionDeclaration(cur) || ts.isGetAccessor(cur))
                && cur.body) {
                const body = cur.body.getText(sourceFile);
                const hit = SWITCHES.find((name) =>
                    new RegExp(`if\\s*\\(\\s*!\\s*${name}\\s*\\)\\s*return`).test(body));
                if (hit) return hit;
            }
        }
        return '';
    };

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && CONSOLE_METHODS.test(node.expression.getText(sourceFile))) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            sites.push({
                file,
                line: line + 1,
                method: `${ownerName(node)}::${node.expression.getText(sourceFile)}`,
                switch: switchOf(node),
                head: node.getText(sourceFile).slice(0, 90).replace(/\s+/g, ' '),
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return sites;
}

test('zcds 每一条 console 日志都必须落在统一开关（ZCDC_LOG_*）作用域内', () => {
    const files = listTs(ZCDS_ROOT).filter((file) => file !== SWITCH_FILE.replace(/\\/g, '/'));
    const all: ILogSite[] = files.flatMap(collectConsoleCalls);

    const violations = all.filter((site) => site.switch === '');
    assert.deepEqual(violations.map((site) => `${site.file}:${site.line} ${site.head}`), [],
        `有 ${violations.length} 条 zcds 日志没挂在 ZCDC_LOG_* 后面；新增日志请先选好档：\n  `
        + violations.map((s) => `${s.file}:${s.line}`).join('\n  '));

    // 防「全删了也算过」的空过：当前 zcds 有 30+ 条日志。
    assert.ok(all.length >= 25,
        `zcds 只扫到 ${all.length} 条日志，判据可能已经空过（源码被改动或日志被误删？）`);

    // 至少两类开关都要真的被用到，否则「统一」只是形式上建了个文件。
    const used = new Set(all.map((site) => site.switch));
    for (const name of SWITCHES) {
        assert.ok(used.has(name), `开关 ${name} 没有被任何日志使用（口径应删掉它，而不是留着空壳）`);
    }
});

test('日志开关是真源：两档常量、诊断档默认关、告警档默认开', () => {
    const source = readFileSync(SWITCH_FILE, 'utf8');
    // 诊断档默认关：它挂在每帧路径上，开着会刷屏（这正是本次要收口的症状）。
    assert.match(source, /export const ZCDC_LOG_DIAGNOSTICS = false;/,
        'ZCDC_LOG_DIAGNOSTICS 默认必须是 false');
    // 告警档默认开：关掉会让「美术没交 / 路径打错」静默降级，归因不到。
    assert.match(source, /export const ZCDC_LOG_WARNINGS = true;/,
        'ZCDC_LOG_WARNINGS 默认必须是 true');
    assert.match(source, /export const ZCDC_LOG_DIAGNOSTICS = (?:true|false);/,
        'ZCDC_LOG_DIAGNOSTICS 必须是可切换的 const');
    assert.match(source, /export const ZCDC_LOG_WARNINGS = (?:true|false);/,
        'ZCDC_LOG_WARNINGS 必须是可切换的 const');
});

test('旧的模块私有诊断开关必须已删除（避免两套开关并存）', () => {
    // `ZC_CAPTURE_DIAGNOSTICS` / `ZC_WALL_DIAGNOSTICS` 是本次收编前的两套私有开关。
    // 它们与统一开关并存时，「关掉诊断」只会关掉一半 ⇒ 用反向断言钉死。
    const files = listTs(ZCDS_ROOT)
        // ⚠️ 真源文件本身当然要 `const ZCDC_LOG_* =`，排除掉，否则这条断言会自己绊自己。
        .filter((file) => file.replace(/\\/g, '/') !== SWITCH_FILE.replace(/\\/g, '/'));
    for (const file of files) {
        const source = readFileSync(file, 'utf8');
        const stripped = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
        assert.doesNotMatch(stripped, /ZC_CAPTURE_DIAGNOSTICS|ZC_WALL_DIAGNOSTICS/,
            `${file} 还留着旧的私有诊断开关；请改用 ZCDCLogSwitch 的统一常量`);
        // 也不能自己再定义一个诊断开关常量。
        assert.doesNotMatch(stripped, /const\s+Z\w*_DIAGNOSTICS\s*=/,
            `${file} 又定义了一个新的私有 DIAGNOSTICS 开关；统一开关在 ZCDCLogSwitch.ts`);
    }
});
