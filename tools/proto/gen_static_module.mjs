/**
 * 生成「微信小游戏 / 原生」可用的 protobuf 静态模块
 * =========================================================================
 *
 * 为什么需要这个脚本
 * ------------------
 * protobufjs 的**反射模式**（`Root.fromJSON()` / `lookupType().encode()`）会调用
 * `util.codegen()`，而 codegen 内部是 `Function.apply(...)` / `Function(src)()`。
 * 微信小游戏禁止动态执行 JS（`eval` / `new Function` 都不可用）：
 *   https://developers.weixin.qq.com/minigame/dev/guide/runtime/js-support
 * 于是原来的写法在微信里连**构造**都会抛：
 *   TypeError: Function(...) is not a function
 *   at util/codegen ← Type.get(generateConstructor) ← Field.resolve ← resolveAll
 * 实测：只跑一次 `Root.fromJSON(schema)` 就命中 649 次 codegen。
 *
 * `pbjs -t static-module` 产出的是**预先写死的** encode / decode / create，
 * 完全不碰 codegen，因此在这类环境里可用。
 *
 * 输入与开关
 * ----------
 * 与 `client_proto/build_proto.bat` 的第一步**完全一致**，只把 `--wrap closure`
 * 换成 `--wrap es6`，好让它成为 ESM 模块（`export default $root`），
 * 而不是挂 `window.protobuf` / `window.protobufRoot` 的 2.4 时代插件脚本。
 *
 * 用法（在工程根目录）
 * --------------------
 *   node tools/proto/gen_static_module.mjs            # 生成
 *   node tools/proto/gen_static_module.mjs --dry-run  # 只报告，不写文件
 *
 * 产物：`assets/script/lib/protobuf/protoCompiledStatic.ts`
 * （放在 `lib/` 而不是 `app/generated/`，因为 framework 层要 import 它，
 *   不能让 framework 反向依赖 app。）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PBJS = resolve(ROOT, 'node_modules/protobufjs-cli/bin/pbjs');
const OUT_JS = resolve(ROOT, 'tmp/pbgen/_gen_static_module.generated.js');
const OUT_TS = resolve(ROOT, 'assets/script/lib/protobuf/protoCompiledStatic.ts');

/** 与 build_proto.bat 第一步同口径；只把 wrap 换成 es6。 */
const INPUTS = ['client_proto/protoCompiled.proto', 'client_proto/protoNet.proto'];
const PBJS_ARGS = [
    '--target', 'static-module',
    '--wrap', 'es6',
    '--force-long',
    '--force-message',
    '--no-verify',
    '--no-convert',
    '--no-delimited',
    '--no-service',
];

const HEADER = `// @ts-nocheck
/**
 * 【自动生成，请勿手改】protobuf 静态模块
 * =====================================================================
 * 由 tools/proto/gen_static_module.mjs 生成，重新生成：
 *     node tools/proto/gen_static_module.mjs
 *
 * 为什么不用 protobufjs 的反射模式（Root.fromJSON + lookupType().encode）：
 * codegen 是运行时用 \`Function(...)\` 现场造函数的，而微信小游戏禁止动态执行 JS
 * （https://developers.weixin.qq.com/minigame/dev/guide/runtime/js-support），
 * 会在构造阶段就抛 \`Function(...) is not a function\`。
 * 本文件是 pbjs 预生成的 encode/decode/create，**全文件 0 处 codegen / 0 处 Function(**，
 * 因此浏览器、原生、微信小游戏都能跑。
 *
 * 输入：${INPUTS.join(' + ')}
 * 参数：pbjs ${PBJS_ARGS.join(' ')}
 * 运行时：protobufjs/minimal（无 codegen）
 *
 * 用法：
 *     import protobufRoot from '../../lib/protobuf/protoCompiledStatic';
 *     protobufRoot.com.xkhy.tafang.cmd.CmdRoleLoginReqMsg
 */
`;

function stripComments(src) {
    let out = '';
    let i = 0;
    let mode = 'code';
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (mode === 'code') {
            if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { mode = c; out += c; i++; continue; }
            out += c; i++; continue;
        }
        if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } i++; continue; }
        if (mode === 'block') {
            if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; }
            if (c === '\n') out += '\n';
            i++; continue;
        }
        if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
        if (c === mode) { mode = 'code'; out += c; i++; continue; }
        out += c; i++;
    }
    return out;
}

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';

// ---------------------------------------------------------------------------
// 1) 跑 pbjs
// ---------------------------------------------------------------------------
if (!existsSync(PBJS)) {
    console.error(`找不到 pbjs：${PBJS}\n请先在工程根目录执行 npm install。`);
    process.exit(1);
}
mkdirSync(dirname(OUT_JS), { recursive: true });

console.log('[1/4] pbjs 生成中…');
const res = spawnSync(process.execPath, [PBJS, ...PBJS_ARGS, '--out', OUT_JS, ...INPUTS], {
    cwd: ROOT,
    stdio: 'inherit',
});
if (res.status !== 0) {
    console.error(`pbjs 失败，退出码 ${res.status}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// 2) 后处理：默认导入（与工程里已验证的写法一致）+ 去注释 + 压空白
// ---------------------------------------------------------------------------
console.log('[2/4] 后处理…');
let code = readFileSync(OUT_JS, 'utf8');
const before = code.length;

// 工程里 `import protobuf from 'protobufjs/light.js'` 是已验证可用的写法；
// 子路径要带扩展名，且用默认导入（CJS 包的 module.exports 就是那个对象）。
const NS_IMPORT = 'import * as $protobuf from "protobufjs/minimal";';
if (!code.includes(NS_IMPORT)) {
    console.error(`未找到预期导入语句，pbjs 输出格式可能变了：${NS_IMPORT}`);
    process.exit(1);
}
code = code.replace(NS_IMPORT, "import $protobuf from 'protobufjs/minimal.js';");

code = stripComments(code);
code = code.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

// ---------------------------------------------------------------------------
// 3) 自检：产物里不允许出现动态代码生成，且必须导出 root
// ---------------------------------------------------------------------------
console.log('[3/4] 自检…');
const problems = [];
const count = (re) => (code.match(re) || []).length;
if (count(/codegen/g)) problems.push(`含 codegen ${count(/codegen/g)} 处`);
if (count(/Function\s*\(/g)) problems.push(`含 Function( ${count(/Function\s*\(/g)} 处`);
if (count(/eval\s*\(/g)) problems.push(`含 eval( ${count(/eval\s*\(/g)} 处`);
if (!code.includes('export { $root as default };')) problems.push('缺少 `export { $root as default }`');
if (!code.includes("from 'protobufjs/minimal.js'")) problems.push('未改用 protobufjs/minimal.js');
const typeCount = count(/\.encode = function/g);
if (typeCount < 100) problems.push(`encode 函数只有 ${typeCount} 个，疑似输入不对`);
if (problems.length) {
    console.error('自检未通过：\n  - ' + problems.join('\n  - '));
    process.exit(1);
}

const output = HEADER + code + '\n';
const outputPath = process.argv.includes('--dry-run') ? OUT_TS.replace(/\.ts$/, '.dryrun.ts') : OUT_TS;
writeFileSync(outputPath, output, 'utf8');

// ---------------------------------------------------------------------------
// 4) 报告
// ---------------------------------------------------------------------------
console.log('[4/4] 完成');
console.log(`  类型数（encode 函数）: ${typeCount}`);
console.log(`  pbjs 原始输出        : ${mb(before)}`);
console.log(`  写入文件             : ${mb(output.length)}  (去注释 + 压空白)`);
console.log(`  输出                 : ${outputPath}`);
console.log(`  动态代码生成检查     : codegen 0 / Function( 0 / eval( 0  ✅`);
