import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const APP_ROOT = 'assets/script/app';
const CMD_DTS = readFileSync(`${APP_ROOT}/generated/netProto/Cmd.d.ts`, 'utf8');

function tsFiles(root: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (statSync(path).isDirectory()) out.push(...tsFiles(path));
        else if (name.endsWith('.ts')) out.push(path);
    }
    return out;
}

const files = tsFiles(APP_ROOT);
const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const requestSources = [...sources.entries()]
    .filter(([file]) => /Request.*Msg\.ts$/.test(file))
    .map(([, source]) => source)
    .join('\n');

function responseTypeOf(request: string): string | null {
    const match = requestSources.match(new RegExp(
        `class\\s+${request}\\s+extends\\s+RequestMsg<\\s*[^,>]+,\\s*([^>\\s]+)`,
        's',
    ));
    return match?.[1] ?? null;
}

function rewardFieldsOf(response: string): string[] {
    const block = CMD_DTS.match(new RegExp(`declare class\\s+${response}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
    return [...block.matchAll(/\b(tlCmdGoods|tlReward|tlRewards|rewards)\??\s*:/g)].map((match) => match[1]);
}

/* ------------------------------------------------------------------ *
 * 「某个 `new RequestXxx(...)` 构造点有没有接奖励弹窗」怎么判
 * ------------------------------------------------------------------ *
 * ⚠️ **不许退化成「按文件判」—— 会假绿**：
 * 旧版写的是 `ownerFiles.some(file => file.includes('FW.ShowReward') && …)` ——
 * 只要**同一个文件里任何一处**出现 `FW.ShowReward` + 字段名，这个文件拥有的**所有**请求
 * 就都被判成「已接」。实测踩过：给 `LeagueRepository.ts` 的**商店购买**接上弹窗之后，
 * 同一文件里 `RequestUnionBargain` / `RequestTaskUnionGetReward` /
 * `RequestTaskUnionGetProgressReward` / `RequestUnionActSweep` **这 4 条根本没接**
 * 的请求被一起「洗白」，测试由红转绿 —— **假绿**。
 *
 * 但「按构造点往后 N 个字符的窗口」也不对：本工程其实有**三种**接线写法，
 * 只有第一种把回调写在同一行里，后两种的 `FW.ShowReward` 落在窗口之外：
 *   A. 内联回调 —— `new RequestX(args, caller, (rsp) => { FW.ShowReward(rsp.tlCmdGoods) })`
 *   B. 先定义再引用 —— `const callback = (rsp) => { … FW.ShowReward(…) … };` … `new RequestX(args, caller, callback)`
 *      （`gift/GiftRepository`、`hang/HangRepository`、`celebration/CelebrationRepository`）
 *   C. 共用外壳 —— `this.writeRequest((cb) => new RequestX(args, caller, cb), label)`
 *      真正的 `FW.ShowReward` 写在**被调用的那个方法**里（`sevenDay/SevenDayRepository`）
 *
 * ⇒ 判定口径 = **「构造点所在的类成员函数体」**：
 *   ① 取大括号栈里**第 2 层**的块（第 1 层是 `class X { }` 本体 ⇒ 天然排除「整文件洗白」），
 *      看它自己有没有 `FW.ShowReward` + 奖励字段 —— 覆盖 A / B；
 *   ② 否则再看这个函数体里**调用的同文件方法**里有没有 —— 覆盖 C。
 *      ⚠️ 只跳**一跳**，且只认同文件的方法定义；再深就是过度设计了。
 * ------------------------------------------------------------------ */

/** 把注释 / 字符串字面量内容抹成空格（**长度不变**），这样按原索引做大括号配对就不会被带偏。 */
function maskOf(source: string): string {
    const out = source.split('');
    const n = source.length;
    const blank = (from: number, to: number): void => {
        for (let k = from; k < to && k < n; k += 1) if (source[k] !== '\n') out[k] = ' ';
    };
    /** `/` 前面若是运算符/左括号之类的「不可能是值」的位置，就认为它开的是正则字面量。 */
    const regexAllowed = (k: number): boolean => {
        let j = k - 1;
        while (j >= 0 && /\s/.test(source[j])) j -= 1;
        if (j < 0) return true;
        return '([{,;:!&|?=+-*%~^<>'.includes(source[j]);
    };
    let i = 0;
    while (i < n) {
        const c = source[i];
        const d = source[i + 1];
        if (c === '/' && d === '/') {
            let j = i;
            while (j < n && source[j] !== '\n') j += 1;
            blank(i, j);
            i = j;
        } else if (c === '/' && d === '*') {
            let j = i;
            while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j += 1;
            j = Math.min(n, j + 2);
            blank(i, j);
            i = j;
        } else if (c === '/' && regexAllowed(i)) {
            let j = i + 1;
            let inClass = false;
            while (j < n) {
                const ch = source[j];
                if (ch === '\\') { j += 2; continue; }
                if (ch === '\n') break;
                if (ch === '[') inClass = true;
                else if (ch === ']') inClass = false;
                else if (ch === '/' && !inClass) { j += 1; break; }
                j += 1;
            }
            blank(i, j);
            i = j;
        } else if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            while (j < n) {
                if (source[j] === '\\') { j += 2; continue; }
                if (source[j] === c) { j += 1; break; }
                if (source[j] === '\n' && c !== '`') break; // 单/双引号不跨行：当作未闭合，放弃
                j += 1;
            }
            blank(i, j);
            i = j;
        } else {
            i += 1;
        }
    }
    return out.join('');
}

/** `index` 之前**尚未闭合**的所有 `{` 的位置（外 → 内）。 */
function openBracesAt(mask: string, index: number): number[] {
    const stack: number[] = [];
    const end = Math.min(index, mask.length);
    for (let i = 0; i < end; i += 1) {
        if (mask[i] === '{') stack.push(i);
        else if (mask[i] === '}') stack.pop();
    }
    return stack;
}

/** 与 `mask[start]` 处 `{` 配对的 `}` 的位置。 */
function blockEndAt(mask: string, start: number): number {
    let depth = 0;
    for (let i = start; i < mask.length; i += 1) {
        if (mask[i] === '{') depth += 1;
        else if (mask[i] === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
    }
    return mask.length - 1;
}

/** 构造点所属的「类成员函数体」文本；大括号栈只有 1 层（非 class 文件）时就是那一层。 */
function memberScopeOf(source: string, mask: string, index: number): string {
    const stack = openBracesAt(mask, index);
    if (stack.length === 0) return source;
    const start = stack.length >= 2 ? stack[1] : stack[0];
    return source.slice(start, blockEndAt(mask, start) + 1);
}

/** 不是「函数调用」的同名语法（关键字 / 已被 `new` 吃掉的类名）。 */
const NOT_A_CALL = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'super',
    'do', 'else', 'in', 'of', 'case', 'void', 'delete', 'await', 'yield', 'throw',
    'instanceof', 'class', 'interface', 'import', 'export', 'extends', 'declare',
]);

/** 函数体里被调用的方法名（含 `this.foo(`；排除关键字与 `new Xxx(`）。 */
function calledNames(scope: string): string[] {
    const mask = maskOf(scope);
    const names = new Set<string>();
    const re = /([A-Za-z_$][\w$]*)\s*[(<]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(mask)) !== null) {
        const name = match[1];
        if (NOT_A_CALL.has(name)) continue;
        if (/new\s*$/.test(mask.slice(0, match.index))) continue;
        names.add(name);
    }
    return [...names];
}

/** 同文件里 `name(...) { … }` 的方法定义**（含签名与参数）**；找不到（或只是同名调用）返回 null。 */
function methodBodyOf(source: string, mask: string, name: string): string | null {
    const re = new RegExp(
        `(?:^|[\\s;}])(?:private\\s+|public\\s+|protected\\s+|static\\s+|async\\s+)*${name}\\s*[(<]`,
        'g',
    );
    let match: RegExpExecArray | null;
    while ((match = re.exec(mask)) !== null) {
        const from = match.index + match[0].length;
        for (let k = mask.indexOf('{', from); k >= 0; k = mask.indexOf('{', k + 1)) {
            const between = mask.slice(from, k).replace(/\s+/g, '');
            if (between.includes(';')) break;              // 已经跑到下一条语句 ⇒ 这是调用点，不是定义
            if (between.endsWith('=')) continue;           // 参数默认值里的对象字面量 `= {}`
            // ⚠️ 从**定义起点**（含签名）开始切：`LayerActivityRepository.writeRequest` 这类外壳
            //    把奖励字段做成参数 `rewardField: 'tlReward' | 'tlCmdGoods'`，
            //    只切函数体就会漏掉「字段名在这里出现过」这一事实。
            return source.slice(match.index, blockEndAt(mask, k) + 1);
        }
    }
    return null;
}

/** 一段代码里同时出现「弹窗出口」与「奖励字段」才算接上了。 */
const hasWiring = (text: string, rewardFields: string[]): boolean =>
    text.includes('FW.ShowReward') && rewardFields.some((field) => text.includes(field));

test('所有已使用、且响应带奖励列表的请求都接入 FW.ShowReward', () => {
    const masks = new Map<string, string>();
    for (const [file, source] of sources) masks.set(file, maskOf(source));

    const owners = new Map<string, string[]>();
    for (const [file] of sources) {
        if (file.includes(`${join('generated', 'netProto')}`)) continue;
        const mask = masks.get(file) ?? '';
        for (const match of mask.matchAll(/new\s+(Request[A-Za-z0-9_]+)/g)) {
            const list = owners.get(match[1]) ?? [];
            if (!list.includes(file)) list.push(file);
            owners.set(match[1], list);
        }
    }

    // GM 指令与 2.0 一致：回包字段用于调试命令返回，不自动弹奖励；批量 addItem 会连续回包，
    // 若接通会一口气堆几十个弹窗。因此它是唯一显式例外，不得把普通业务请求加进来。
    const intentionalExceptions = new Set(['RequestSystemGm']);

    // 「看广告」的 `showReward` 是**逐调用点**决定的（老端 `ModelRole.RequestWatchAdvert(type, showReward = true, id)`），
    // 所以只能按**文件**豁免，不能整条请求豁免：
    //   · 联盟任务  `LayerLeagueTask.ts:133` → `RequestWatchAdvert(AdType.unionTask, false, ref.resId)`
    //     —— 老端**有意不弹**（奖励走任务列表刷新），本端 `LeagueRepository.requestTaskAdvert` 忠实照做；
    //   · 扫荡 / 商店 / 铸造等 → 走默认 `true` ⇒ 必须弹（`HangRepository.watchAd` 已接，仍受本测试约束）。
    const fileExceptions: ReadonlyArray<{ request: string; file: string }> = [
        { request: 'RequestRoleWatchAdvert', file: join(APP_ROOT, 'league', 'LeagueRepository.ts') },
    ];

    const missing: string[] = [];

    for (const [request, ownerFiles] of owners) {
        const response = responseTypeOf(request);
        if (!response) continue;
        const rewardFields = rewardFieldsOf(response);
        if (rewardFields.length === 0 || intentionalExceptions.has(request)) continue;
        const exemptFiles = new Set(
            fileExceptions.filter((entry) => entry.request === request).map((entry) => entry.file),
        );

        for (const file of ownerFiles) {
            if (exemptFiles.has(file)) continue;
            const source = sources.get(file) ?? '';
            const mask = masks.get(file) ?? '';
            const sites: number[] = [];
            const re = new RegExp(`new\\s+${request}\\b`, 'g');
            let match: RegExpExecArray | null;
            while ((match = re.exec(mask)) !== null) sites.push(match.index);

            // ⚠️ 逐**构造点**判：每个点都要自己接上弹窗，别的点的接线不算数。
            const unwired = sites.filter((index) => {
                const scope = memberScopeOf(source, mask, index);
                if (hasWiring(scope, rewardFields)) return false;
                // 写法 C：真正的 `FW.ShowReward` 写在被这个函数体调用的同文件方法里。
                return !calledNames(scope).some((name) => {
                    const body = methodBodyOf(source, mask, name);
                    return body !== null && hasWiring(body, rewardFields);
                });
            });
            if (unwired.length > 0) {
                missing.push(
                    `${request} -> ${response} (${rewardFields.join('/')}) @ ${relative('.', file)}`
                    + `  [${unwired.length}/${sites.length} 个构造点未接弹窗]`,
                );
            }
        }
    }

    assert.deepEqual(missing, [], `以下奖励响应未接弹窗：\n${missing.join('\n')}`);
});

test('支付完成广播由组合根全局接入奖励弹窗', () => {
    const bootstrap = readFileSync(`${APP_ROOT}/bootstrap/ProcedureBootstrap.ts`, 'utf8');
    assert.match(bootstrap, /addEvent\('CmdRechargeBroMsg'/);
    assert.match(bootstrap, /cmdRecharge\?\.rewards\s*\?\?\s*\[\]/);
    assert.match(bootstrap, /FW\.ShowReward/);
    assert.match(bootstrap, /removeEvent\('CmdRechargeBroMsg'/);
});
