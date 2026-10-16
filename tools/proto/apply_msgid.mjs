#!/usr/bin/env node
/**
 * 「补 MessageId」一键工具
 * ---------------------------------------------------------------------------
 * 背景（2026-09-21 实测）：
 *   `enum MessageId` 只登记 `*RspMsg` / `*BroMsg`，请求名由 `replace("RspMsg","")+"ReqMsg"` 反推；
 *   漏登记的协议客户端**本地就发不出去**（`GameNet` 打「不存在协议 XxxReqMsg：MessageId 中没定义」并 reject）。
 *   而 id **不可本地推算**（293 条对 crc32/javaHash/fnv1a/murmur3/md5/sha1 × 前缀 × 后缀 ≈8000 组合穷举，
 *   只有 22 条 `*BroMsg` 命中 `javaHash(name)`，248 条 `*RspMsg` 零命中）→ **必须由协议维护者给号**。
 *
 * 这个脚本负责「拿到号之后」的全部机械动作，避免手改三处文件出错：
 *   ① `client_proto/protoCompiled.proto` 的 `enum MessageId` 插一行
 *   ② `assets/resources/config/protoCompiled.json` 的 `...MessageId.values` 插一行（保持缩进，diff 只 +1 行）
 *   ③ （可选）跑 `build_proto.bat` + `tools/proto/gen_static_module.mjs` 重建 static 协议包
 *
 * 用法：
 *   # 只体检：三处各自有没有这条
 *   node tools/proto/apply_msgid.mjs --name CmdStartBattleRspMsg --check
 *   # 干跑：打印将要插入的位置（不写盘）
 *   node tools/proto/apply_msgid.mjs --name CmdStartBattleRspMsg --id 123456789
 *   # 真写 + 重建 static
 *   node tools/proto/apply_msgid.mjs --name CmdStartBattleRspMsg --id 123456789 --write --gens
 *
 * 可加 `--proto/--json/--static` 覆盖路径（用于在 tmp 副本上验证，不动工程文件）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJ = resolve(HERE, '..', '..');

function arg(name, fallback = null) {
    const i = process.argv.indexOf('--' + name);
    if (i === -1) return fallback;
    const next = process.argv[i + 1];
    return next && !next.startsWith('--') ? next : true;
}
const has = (name) => process.argv.includes('--' + name);

const NAME = arg('name');
const ID = arg('id');
const DO_WRITE = has('write');
const DO_GENS = has('gens');
const DO_CHECK = has('check');

const P_PROTO = resolve(arg('proto') ? String(arg('proto')) : join(PROJ, 'client_proto', 'protoCompiled.proto'));
const P_JSON = resolve(arg('json') ? String(arg('json')) : join(PROJ, 'assets', 'resources', 'config', 'protoCompiled.json'));
const P_STATIC = resolve(arg('static') ? String(arg('static')) : join(PROJ, 'assets', 'script', 'lib', 'protobuf', 'protoCompiledStatic.ts'));

if (!NAME) {
    console.error('用法: node tools/proto/apply_msgid.mjs --name CmdXxxRspMsg [--id 123456789] [--write] [--gens] [--check]');
    process.exit(2);
}
if (!NAME.endsWith('RspMsg')) {
    console.error(`⚠️  ${NAME} 不是 *RspMsg：MessageId 只登记 RspMsg/BroMsg，请求名由 RspMsg 反推，别登记请求名。`);
    process.exit(2);
}
if (!DO_CHECK && !/^\d+$/.test(String(ID))) {
    console.error('缺少 --id <整数>（或改用 --check 只体检）');
    process.exit(2);
}
const ID_NUM = Number(ID);
if (!DO_CHECK && !(ID_NUM > 0 && ID_NUM <= 0xFFFFFFFF)) {
    console.error('id 必须落在 (0, 2^32] 内');
    process.exit(2);
}

const read = (p) => readFileSync(p, 'utf8');
const status = [];

// ---------------------------------------------------------------- ① proto
/**
 * 找与 `open` 处 `{` 配对的 `}` —— 必须跳过注释和字符串。
 * ⚠️ 不能直接 `indexOf('}')`：这个 proto 里到处是"粘"在注释里的旧协议片段
 * （如 `... avatar = 9; //头像}message CmdRoleRegisterRspMsg {...`），
 * 第一个 `}` 就在注释里 → 会把新条目插到枚举中间。
 */
function findBlockClose(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 1;
            continue;
        }
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

let protoSrc = read(P_PROTO);
const enumHead = protoSrc.match(/\n(\s*)enum\s+MessageId\s*\{/);
if (!enumHead) {
    console.error('❌ proto 里找不到 enum MessageId');
    process.exit(1);
}
const enumOpen = protoSrc.indexOf('{', enumHead.index);
const enumClose = findBlockClose(protoSrc, enumOpen);
if (enumClose === -1) {
    console.error('❌ proto 里 enum MessageId 的闭合 } 没找到');
    process.exit(1);
}
const enumBody = protoSrc.slice(enumOpen + 1, enumClose);
const entryRe = new RegExp('^\\s*' + NAME + '\\s*=\\s*(\\d+)\\s*;', 'm');
const inProto = entryRe.exec(enumBody);
status.push(['proto(enum MessageId)', inProto ? `有 → ${inProto[1]}` : `缺（枚举共 ${(enumBody.match(/^\s*\w+\s*=\s*\d+\s*;/gm) || []).length} 条）`, !!inProto]);

// 取最后一条的缩进，插在枚举**末尾**（保持文件风格）
const lines = enumBody.split('\n');
const lastEntry = [...lines].reverse().find((l) => /^\s*\w+\s*=\s*\d+\s*;/.test(l));
const indent = lastEntry ? lastEntry.match(/^\s*/)[0] : '\t';
const insertLine = `${indent}${NAME} = ${ID_NUM};`;
const pad = enumBody.endsWith('\n') ? '' : '\n';
// ⚠️ 幂等：已存在就不插入。原来无条件插入，导致「三处齐备后再跑 --write 只重建 static」
// 会在 proto/json 里各留下一条**重复**条目（json 重复键会被解析成后者覆盖前者）。
const newProto = inProto
    ? protoSrc
    : protoSrc.slice(0, enumClose) + pad + insertLine + '\n' + protoSrc.slice(enumClose);

// ---------------------------------------------------------------- ② json
let jsonSrc = read(P_JSON);
// ⚠️ 不能用 `"NAME":` 判存在：message 定义也是 `"CmdXxxRspMsg": {`，会误判成"有"。
// 权威判据 = 解析后 MessageId.values 里有没有这个键。
function findValues(obj) {
    if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            if (k === 'MessageId' && v && v.values) return v.values;
            const r = findValues(v);
            if (r) return r;
        }
    }
    return null;
}
const jsonObj = JSON.parse(jsonSrc);
const valuesBefore = findValues(jsonObj);
const inJson = !!(valuesBefore && NAME in valuesBefore);
status.push([`json(MessageId.values)`, inJson ? `有 → ${valuesBefore[NAME]}` : `缺（共 ${valuesBefore ? Object.keys(valuesBefore).length : '?'} 条）`, inJson]);
// 找到 "MessageId": { "values": {  之后的第一条，取它的缩进
const jAnchor = /("MessageId"\s*:\s*\{\s*"values"\s*:\s*\{\s*\n)(\s+)("[^"]+"\s*:\s*\d+)/;
const jm = jAnchor.exec(jsonSrc);
let newJson = jsonSrc;
if (inJson) {
    // 幂等：已有就原样保留（见上面 proto 段的说明）
} else if (jm) {
    newJson = jsonSrc.replace(jAnchor, `$1$2"${NAME}": ${ID_NUM},\n$2$3`);
} else {
    console.error('❌ json 里找不到 MessageId.values 锚点，需手工处理');
    process.exit(1);
}

// ---------------------------------------------------------------- ③ static
// static 模块里枚举长这样（pbjs static 输出）：
//   cmd.MessageId = (function() { const valuesById = {}, values = Object.create(valuesById);
//   values[valuesById[1731012380] = "CmdTakeDayChallengeActRewardRspMsg"] = 1731012380; ...
const staticSrc = read(P_STATIC);
const staticEntryRe = new RegExp('valuesById\\[\\d+\\]\\s*=\\s*"' + NAME + '"');
const inStatic = staticEntryRe.test(staticSrc);
status.push(['static(protoCompiledStatic.ts)', inStatic ? '有' : '缺（--write 会补号；更稳是 --gens 重建）', inStatic]);
// ⚠️ 只补枚举号 ≠ 能发！static 是 pbjs 整份产物，还得有 message 的 create/encode/decode。
// 2026-09-22 实测踩过：proto/json 都有号，static 里 `CmdFinishBattle*` **一个字都没有**
// （枚举、message 全缺）→ 运行时 MessageId 查不到 → 「不存在协议 CmdFinishBattleReqMsg」。
const staticBase = NAME.replace(/RspMsg$/, '');
const staticMsgRe = new RegExp('cmd\\.' + staticBase + 'ReqMsg = ');
const inStaticMsg = staticMsgRe.test(staticSrc);
if (inStatic && !inStaticMsg) {
    status.push(['static(message 定义)', `⚠️ 枚举有号但 ${staticBase}ReqMsg 的 create/encode/decode 缺失 → 必须 --gens 整份重建`, false]);
}
const sAnchor = /(const valuesById = \{\}, values = Object\.create\(valuesById\);\n)/;
let newStatic = staticSrc;
if (inStatic) {
    // 幂等：已有就不改。注意 static 是**整份重建**更稳（--gens），手插只保证枚举有号、
    // 不保证 message 的 create/encode/decode 也在 —— 缺了照样编不出包。
} else if (sAnchor.test(staticSrc)) {
    newStatic = staticSrc.replace(sAnchor, `$1values[valuesById[${ID_NUM}] = "${NAME}"] = ${ID_NUM};\n`);
} else {
    console.error('❌ static 里找不到 valuesById 锚点（用 --gens 重建更稳）');
    process.exit(1);
}

// ------------------------------------------------- ④ id 冲突硬失败
// 同一个协议名两个号 = 报文发出去服务端认不出。三处里任何一处已登记了**不同的**号，
// 都说明「拿到的号」和「库里在用的号」不是一回事，必须人工核对，不能静默覆盖或跳过。
if (!DO_CHECK) {
    const conflicts = [];
    if (inProto && Number(inProto[1]) !== ID_NUM) conflicts.push(`proto(enum MessageId) 里已登记 ${inProto[1]}`);
    if (inJson && Number(valuesBefore[NAME]) !== ID_NUM) conflicts.push(`json(MessageId.values) 里已登记 ${valuesBefore[NAME]}`);
    if (conflicts.length) {
        console.error(`❌ ${NAME} 已存在且 id 与 --id ${ID_NUM} 不一致：\n  - ${conflicts.join('\n  - ')}\n请先核对哪个号是对的（三处必须统一），再决定用哪个 --id 跑。`);
        process.exit(1);
    }
}

console.log(`协议名: ${NAME}`);
console.log('三处现状:');
for (const [k, v] of status) console.log(`  - ${k}: ${v}`);

// ⚠️ 不能用 console.log 的字符串判断（带 `→ 值` 就不等于「有」），用第三列的布尔
if (DO_CHECK) {
    const all = status.every((s) => s[2]);
    console.log(all ? '\n✅ 三处齐备：这条协议可以发了' : '\n❌ 还有缺失：缺一处就发不出去（GameNet 会 reject）');
    process.exit(all ? 0 : 1);
}

console.log('\n将插入:');
console.log(`  [proto ] ${inProto ? `（已有 ${inProto[1]}，跳过）` : insertLine}`);
console.log(`  [json  ] ${inJson ? `（已有 ${valuesBefore[NAME]}，跳过）` : `${jm ? jm[2] : ''}"${NAME}": ${ID_NUM},`}`);
console.log(`  [static] ${inStatic ? (inStaticMsg ? '（枚举 + message 定义均已有，跳过）' : '（枚举已有，但 message 定义缺失 → 必须 --gens 整份重建）') : `values[valuesById[${ID_NUM}] = "${NAME}"] = ${ID_NUM};`}`);

if (!DO_WRITE) {
    console.log('\n(干跑：没有写盘。加 --write 才真写，加 --gens 顺带重建 static)');
    process.exit(0);
}

const written = [];
if (newProto !== protoSrc) { writeFileSync(P_PROTO, newProto, 'utf8'); written.push('proto'); }
if (newJson !== jsonSrc) { writeFileSync(P_JSON, newJson, 'utf8'); written.push('json'); }
if (newStatic !== staticSrc) { writeFileSync(P_STATIC, newStatic, 'utf8'); written.push('static'); }
console.log(written.length
    ? `\n✅ 已写入：${written.join(' + ')}`
    : '\n✅ 三处都已有该条目，无文件改动（幂等跳过）。如需重建 static 请用 --gens。');

// 写完全局复核：三处都要能读出来，json 必须仍可解析、条数 +1
function protoEntry(src, name) {
    const head = src.match(/\n(\s*)enum\s+MessageId\s*\{/);
    const open = src.indexOf('{', head.index);
    const close = findBlockClose(src, open);
    const m = new RegExp('^\\s*' + name + '\\s*=\\s*(\\d+)\\s*;', 'm').exec(src.slice(open + 1, close));
    return m ? m[1] : null;
}
const afterObj = JSON.parse(read(P_JSON));
const vals = findValues(afterObj);
console.log(`   json   仍可解析 ✓  MessageId.values 共 ${Object.keys(vals).length} 条，${NAME} = ${vals[NAME]}`);
console.log(`   proto  里 ${NAME} = ${protoEntry(read(P_PROTO), NAME)}`);
console.log(`   static 里已登记 = ${staticEntryRe.test(read(P_STATIC))}`);
console.log('   （原始条数 293 → 现在应为 294）');

if (DO_GENS) {
    console.log('\n--- build_proto.bat ---');
    const bat = spawnSync('cmd', ['/c', 'build_proto.bat'], { cwd: join(PROJ, 'client_proto'), stdio: 'inherit' });
    if (bat.status !== 0) { console.error('❌ build_proto.bat 失败'); process.exit(1); }
    console.log('\n--- gen_static_module.mjs ---');
    const gen = spawnSync('node', [join(PROJ, 'tools', 'proto', 'gen_static_module.mjs')], { cwd: PROJ, stdio: 'inherit' });
    if (gen.status !== 0) { console.error('❌ gen_static_module.mjs 失败'); process.exit(1); }
    console.log('\n✅ static 协议包已重建。别忘了编辑器里 asset_system refresh db://assets/script。');
}
