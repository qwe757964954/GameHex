import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import Long from 'long';
import { ProtoCoder } from '../assets/script/framework/net/ProtoCoder';
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';

const schema = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
const root = protobuf.Root.fromJSON(schema);
const messages = schema.nested.com.nested.xkhy.nested.tafang.nested.cmd.nested;

test('随包静态模块覆盖 protoCompiled 中所有 SLG 消息及字段', () => {
    const compiled = protobufRoot.com.xkhy.tafang.cmd;
    for (const name of Object.keys(messages).filter((key) => /Slg/.test(key) && messages[key].fields)) {
        const type = compiled[name];
        assert.equal(typeof type?.encode, 'function', `${name} 未生成到运行时`);
        for (const field of Object.keys(messages[name].fields)) {
            assert.ok(field in type.prototype, `${name}.${field} 缺失`);
        }
    }
});

test('九组新增 SLG 请求可编码，响应与两组广播可按真实消息号解码', async () => {
    const coder = new ProtoCoder();
    await coder.init();
    const instanceId = 0xffffffff;
    const build = { buildInstId: instanceId, buildingId: 71002, position: 0, level: 1, state: 1, finishTime: 1234 };
    const queue = { queueId: 1, type: 1, buildInstId: instanceId };
    const cases = [
        ['CmdSlgActionUpdate', {}, { info: { nextRevertTime: 20 } }],
        ['CmdSlgGameInfo', {}, {}],
        ['CmdSlgBuildInfo', {}, { info: { builds: [build], queues: [queue], unlockQueue: 1 } }],
        ['CmdSlgBuild', { buildingId: 71002, position: 0, instant: 0 }, { build, queue }],
        ['CmdSlgBuildUpgrade', { buildInstId: instanceId, instant: 0 }, { build, queue }],
        ['CmdSlgBuildCancel', { buildInstId: instanceId }, { buildInstId: instanceId }],
        ['CmdSlgBuildMove', { buildInstId: instanceId, position: 0 }, { build }],
        ['CmdSlgBuildCollect', { buildInstIds: [instanceId] }, { builds: [build], tlCmdGoods: [{ resId: Long.fromInt(18501), number: '5' }] }],
        ['CmdSlgBuildUnlockQueue', { queueId: 2 }, { unlockQueue: 2 }],
    ] as const;
    for (const [stem, request, response] of cases) {
        const id = coder.getMessageId(`${stem}ReqMsg`);
        assert.ok(id > 0, `${stem} 未注册`);
        const type = root.lookupType(`com.xkhy.tafang.cmd.${stem}ReqMsg`);
        const decoded = type.decode(coder.encode(`${stem}ReqMsg`, request));
        if ('buildInstId' in request) assert.equal(decoded['buildInstId'], instanceId);
        if ('buildInstIds' in request) assert.deepEqual(decoded['buildInstIds'], [instanceId]);
        const rspType = root.lookupType(`com.xkhy.tafang.cmd.${stem}RspMsg`);
        const rsp = coder.decodeDataById(id, rspType.encode(response).finish());
        assert.ok(rsp);
        if ('build' in response) assert.equal(rsp.build.buildInstId, instanceId);
    }
    for (const [name, id] of [['CmdSlgGameInfoBroMsg', 1546899562], ['CmdSlgBuildInfoBroMsg', 1860748310]] as const) {
        assert.equal(coder.isBro(id), true);
        assert.equal(coder.getRspNameById(id), name);
        assert.ok(coder.decodeDataById(id, new Uint8Array()));
    }
});

test('建筑实例ID的协议源、JSON、类型和静态编解码均为uint32数字', () => {
    const compiled = protobufRoot.com.xkhy.tafang.cmd;
    const proto = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    const declarations = readFileSync('assets/script/app/generated/netProto/Cmd.d.ts', 'utf8');
    for (const name of ['SlgBuildInfo', 'SlgBuildQueueInfo', 'CmdSlgBuildUpgradeReqMsg', 'CmdSlgBuildCancelReqMsg',
        'CmdSlgBuildCancelRspMsg', 'CmdSlgBuildMoveReqMsg']) {
        const block = new RegExp(`message ${name}\\s*\\{([^}]+)\\}`).exec(proto);
        assert.match(block?.[1] ?? '', /(?:required|optional)\s+uint32\s+buildInstId\s*=/);
        assert.equal(messages[name].fields.buildInstId.type, 'uint32');
        const declaration = new RegExp(`declare class ${name}\\s*\\{([^}]+)\\}`).exec(declarations);
        assert.match(declaration?.[1] ?? '', /buildInstId\??:\s*(?:\(number\|null\)|number)/);
        assert.equal(compiled[name].prototype.buildInstId, 0, `${name} 的默认ID应为number`);
    }
    for (const id of [1, 0x80000000, 0xffffffff]) {
        for (const [name, value] of [
            ['SlgBuildInfo', { buildInstId: id, buildingId: 71001, position: 0, level: 1, state: 0 }],
            ['SlgBuildQueueInfo', { buildInstId: id, queueId: 1, type: 1 }],
        ] as const) {
            const type = compiled[name];
            const decoded = type.decode(type.encode(value).finish());
            assert.equal(typeof decoded.buildInstId, 'number');
            assert.equal(decoded.buildInstId, id);
        }
    }
});
