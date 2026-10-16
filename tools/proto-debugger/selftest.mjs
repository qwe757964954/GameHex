/**
 * 浏览器协议调试台 —— 运行时自测（node 侧）
 * =====================================================================
 * 直接 require 构建产物 proto-runtime.js（IIFE 挂 globalThis.ProtoRuntime），
 * 验证三条链路与游戏内 ProtoCoder 完全一致：
 *   1) 协议枚举：MessageId 枚举 → 可发送的 ReqMsg 列表（对齐 initMessage 逻辑）
 *   2) 发送封包：reqBody(encode) → ClientCmdData 组装 → 整体 encode → 回解校验
 *   3) 回包解码：ServerCmdData(result=true) → messageIds/splits 切 data → 逐条 decode
 *   4) 错误回包：ServerCmdData(result=false) → CmdTips 解码
 *
 * 用法：node tools/proto-debugger/selftest.mjs
 */

import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = resolve(HERE, 'proto-runtime.js');

// IIFE 的顶层 `var ProtoRuntime = ...` 只有放在全局上下文才会挂到 globalThis
const code = readFileSync(RUNTIME, 'utf8');
runInThisContext(code); // 产物本身无 eval/new Function（esbuild 输出不含）；此处仅自测加载
const ProtoRuntime = globalThis.ProtoRuntime;
if (!ProtoRuntime) {
    console.error('FAIL: ProtoRuntime 未挂到 globalThis');
    process.exit(1);
}

const root = ProtoRuntime.default;
const P = root.com.xkhy.tafang.cmd;       // 业务协议包
const N = root.com.cca.core.network.cmd;  // 网络协议包
const ok = (name, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
    if (!cond) process.exitCode = 1;
};

ok('协议包结构 com.xkhy.tafang.cmd', !!P && typeof P.MessageId === 'object');
ok('网络协议包 com.cca.core.network.cmd', !!(N && N.ClientCmdData && N.ServerCmdData));

// ---------------------------------------------------------------------------
// 1) 协议枚举（对齐 ProtoCoder.initMessage：键去 RspMsg 后缀 + ReqMsg）
// ---------------------------------------------------------------------------
const protocols = [];
const idToRsp = {};
for (const key of Object.keys(P.MessageId)) {
    const id = P.MessageId[key];
    const name = key.replace('RspMsg', '');
    if (name.endsWith('BroMsg') || name.endsWith('CacheAppMsg')) {
        idToRsp[id] = key; // 广播 / 缓存消息，响应名即枚举键
        continue;
    }
    const reqName = name + 'ReqMsg';
    const rspName = name + 'RspMsg';
    idToRsp[id] = rspName;
    if (P[reqName] && P[rspName]) protocols.push({ reqName, rspName, id });
}
ok(`可发送协议枚举（ReqMsg 齐全）`, protocols.length > 50, `共 ${protocols.length} 条`);
const names = protocols.slice(0, 12).map((p) => p.reqName).join(' / ');
console.log('  样例:', names, '…');

// ---------------------------------------------------------------------------
// 2) 发送封包：与 GameNet.createCmdClientData 同口径
// ---------------------------------------------------------------------------
function buildClientCmd(protoName, json, clientIndex) {
    const msgId = P.MessageId[protoName.replace(/ReqMsg$/, 'RspMsg')];
    if (msgId == null) throw new Error('未找到协议 ' + protoName);
    const body = P[protoName].encode(P[protoName].create(json || {})).finish();
    // 字段名与工程一致：pbjs static-module 把 proto 的 snake_case 转成了 camelCase
    return N.ClientCmdData.encode(N.ClientCmdData.create({
        messageId: msgId,
        clientIndex,
        data: body,
        appendData: null,
    })).finish();
}

function decodeClientCmd(bytes) {
    const data = N.ClientCmdData.decode(bytes);
    return { messageId: data.messageId, clientIndex: data.clientIndex, data: data.data };
}

const idx = 1;
// 空协议（心跳）
const hbBytes = buildClientCmd('CmdSystemSyncTimeReqMsg', {}, idx);
const hb = decodeClientCmd(hbBytes);
ok('心跳封包 CmdSystemSyncTimeReqMsg', hb.messageId === P.MessageId.CmdSystemSyncTimeRspMsg, 'messageId=' + hb.messageId);
ok('心跳封包 body 可解码', JSON.stringify(P.CmdSystemSyncTimeReqMsg.decode(hb.data)) === '{}');

// 带参协议（GM）
const gmBytes = buildClientCmd('CmdSystemGmReqMsg', { cmd: 'addItem 10001 1' }, idx + 1);
const gm = decodeClientCmd(gmBytes);
const gmBody = P.CmdSystemGmReqMsg.decode(gm.data);
ok('GM 封包 CmdSystemGmReqMsg', gm.messageId === P.MessageId.CmdSystemGmRspMsg && gmBody.cmd === 'addItem 10001 1',
    `cmd=${gmBody.cmd}`);

// int64 字段（CmdSystemSyncTimeRspMsg 的 serverTime 是 sint64）—— 写/读往返
const timeBody = P.CmdSystemSyncTimeRspMsg.encode(P.CmdSystemSyncTimeRspMsg.create({ serverTime: 1234567890123 })).finish();
const timeDecoded = P.CmdSystemSyncTimeRspMsg.decode(timeBody);
ok('int64 字段往返', timeDecoded.serverTime.toString() === '1234567890123', 'serverTime=' + timeDecoded.serverTime.toString());

// ---------------------------------------------------------------------------
// 3) 回包解码：ServerCmdData(result=true) → messageIds + splits 切 data
// ---------------------------------------------------------------------------
function decodeServer(bytes) {
    const scd = N.ServerCmdData.decode(bytes);
    const out = { result: scd.result, clientIndex: scd.clientIndex, list: [] };
    if (scd.result) {
        let last = 0;
        for (let i = 0; i < scd.messageIds.length; i++) {
            const msgId = scd.messageIds[i];
            const rspName = idToRsp[msgId];
            const seg = scd.data.subarray(last, scd.splits[i]);
            last = scd.splits[i];
            out.list.push({ msgId, rspName, data: rspName ? P[rspName].decode(seg) : null });
        }
    } else {
        out.tips = P.CmdTips.decode(scd.data);
    }
    return out;
}

// 模拟服务器回一条 GM 响应（body 随便给合法字段）
const rspBody = P.CmdSystemGmRspMsg.encode(P.CmdSystemGmRspMsg.create({})).finish();
const rspBytes = N.ServerCmdData.encode(N.ServerCmdData.create({
    clientIndex: idx,
    messageIds: [P.MessageId.CmdSystemGmRspMsg],
    splits: [rspBody.length],
    data: rspBody,
    result: true,
    compress: false,
})).finish();
const rsp = decodeServer(rspBytes);
ok('回包解码（多消息切分）', rsp.result === true && rsp.list.length === 1 && rsp.list[0].rspName === 'CmdSystemGmRspMsg',
    rsp.list[0].rspName + ' msgId=' + rsp.list[0].msgId);

// 多消息同包（广播 + 响应）
const bro = P.CmdSystemSyncTimeRspMsg.encode(P.CmdSystemSyncTimeRspMsg.create({ serverTime: 1 })).finish();
const multi = N.ServerCmdData.encode(N.ServerCmdData.create({
    clientIndex: 0,
    messageIds: [P.MessageId.CmdSystemSyncTimeRspMsg, P.MessageId.CmdSystemGmRspMsg],
    splits: [bro.length, bro.length + rspBody.length],
    data: Buffer.concat([bro, rspBody]),
    result: true,
    compress: false,
})).finish();
const multiDecoded = decodeServer(multi);
ok('回包多消息解码', multiDecoded.list.length === 2, multiDecoded.list.map((m) => m.rspName).join(' + '));

// ---------------------------------------------------------------------------
// 4) 错误回包：result=false → CmdTips
// ---------------------------------------------------------------------------
const tipsBody = P.CmdTips.encode(P.CmdTips.create({ content: 'error: Not logged in' })).finish();
const errBytes = N.ServerCmdData.encode(N.ServerCmdData.create({
    clientIndex: idx,
    messageIds: [P.MessageId.CmdSystemGmRspMsg],
    splits: [],
    data: tipsBody,
    result: false,
    compress: false,
})).finish();
const errDecoded = decodeServer(errBytes);
ok('错误回包 CmdTips', errDecoded.result === false && errDecoded.tips.content === 'error: Not logged in',
    'tips=' + errDecoded.tips.content);

// ---------------------------------------------------------------------------
console.log('');
console.log(process.exitCode ? '存在失败项' : '全部通过 ✅');
