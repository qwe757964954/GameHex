/**
 * 生成「浏览器协议调试台」运行时 bundle
 * =====================================================================
 *
 * 干什么
 * ------
 * 工程里的协议静态模块 `assets/script/lib/protobuf/protoCompiledStatic.ts`
 * 是 pbjs 预生成的 encode/decode/create（0 codegen / 0 Function(），
 * 天然适合浏览器。它唯一的外部依赖是 `protobufjs/minimal.js`（CJS）。
 *
 * 本脚本用 esbuild 把「protobufjs/minimal + 协议静态模块」打成单个 IIFE
 * 文件 `proto-runtime.js`（挂全局 `ProtoRuntime`），让 `index.html` 直接
 * 双击打开即可用 —— file:// 下不能跑 ESM，必须单文件无外部依赖。
 *
 * 用法（工程根目录）
 * ------------------
 *   node tools/proto-debugger/gen_debug_runtime.mjs
 *
 * 输入：assets/script/lib/protobuf/protoCompiledStatic.ts（若协议表有更新，
 *      先跑 node tools/proto/gen_static_module.mjs 重新生成它）
 * 输出：tools/proto-debugger/proto-runtime.js
 *
 * 全局导出形态（IIFE global-name）：
 *   ProtoRuntime.default  -> $root（含 com.xkhy.tafang.cmd / com.cca.core.network.cmd）
 *   ProtoRuntime.com      -> 同名具名导出
 */

import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = resolve(ROOT, 'assets/script/lib/protobuf/protoCompiledStatic.ts');
const OUT = resolve(ROOT, 'tools/proto-debugger/proto-runtime.js');

if (!existsSync(ENTRY)) {
    console.error(`找不到协议静态模块：${ENTRY}\n请先运行 node tools/proto/gen_static_module.mjs 生成。`);
    process.exit(1);
}

const BANNER = `/* 自动生成，请勿手改 —— tools/proto-debugger/gen_debug_runtime.mjs
 * 浏览器协议调试台运行时：protobufjs/minimal + 全量协议静态模块。
 * 全局导出：ProtoRuntime.default / ProtoRuntime.com
 * 协议包：
 *   ProtoRuntime.default.com.xkhy.tafang.cmd           业务协议（CmdXxxReqMsg 等）
 *   ProtoRuntime.default.com.cca.core.network.cmd     网络协议（ClientCmdData / ServerCmdData）
 */`;

mkdirSync(dirname(OUT), { recursive: true });

const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'ProtoRuntime',
    platform: 'browser',
    target: ['es2018'],
    banner: { js: BANNER },
    write: false,
    minify: false,
    logLevel: 'warning',
});

const code = result.outputFiles[0].text;
writeFileSync(OUT, code, 'utf8');

const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
console.log('[proto-debugger] 构建完成');
console.log('  输出       :', OUT);
console.log('  大小       :', mb(code.length));
console.log('  全局变量   : ProtoRuntime（ProtoRuntime.default.com.xkhy.tafang.cmd 等）');
