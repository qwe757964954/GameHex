import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canEnterServer,
    createClientInfo,
    joinUrl,
    LoginGateway,
    selectRecommendedServer,
    ServerInfoData,
    ServerStatus,
    withQuery,
} from '../assets/script/app/login/LoginProtocol';
import { ProtocolCodec } from '../assets/script/app/login/ProtocolCodec';
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';
import type { NetworkRequest, NetworkTransport } from '../assets/script/core/network/NetworkTransport';

const servers: ServerInfoData[] = [
    { serverId: '1', name: '一服', serverOpenTime: 100, status: ServerStatus.Recommend },
    { serverId: '2', name: '二服', serverOpenTime: 300, status: ServerStatus.Maintenance },
    { serverId: '3', name: '三服', serverOpenTime: 200, status: ServerStatus.New },
];

test('URL helpers preserve the legacy endpoint contract', () => {
    assert.equal(joinUrl('http://center/', '/center/action/login'), 'http://center/center/action/login');
    assert.equal(withQuery('http://center/login', { account: 'a+b', password: '中 文' }), 'http://center/login?account=a%2Bb&password=%E4%B8%AD%20%E6%96%87');
});

test('recommended server prefers recent and otherwise newest available', () => {
    assert.equal(selectRecommendedServer(servers, 1), 1);
    assert.equal(selectRecommendedServer(servers, 2), 3);
    assert.equal(canEnterServer(servers[1]).ok, false);
});

test('full server remains available to an existing role', () => {
    const full = { ...servers[0], status: ServerStatus.Full };
    assert.equal(canEnterServer(full).ok, false);
    assert.equal(canEnterServer(full, [1]).ok, true);
});

test('gateway follows account, recent-server and two-phase server login protocol', async () => {
    const urls: string[] = [];
    const gateway = new LoginGateway(async (url) => {
        urls.push(url);
        if (url.includes('/account/login')) return { result: true, content: { code: 'u1', token: 'tk', time: 10 } };
        return { result: true, content: { roleId: 7, token: 'tk', time: 10, selectServerId: 3, serverAddress: {} } };
    });
    const config = { url: 'http://center', backstageurl: 'http://cdn', channelCode: 0, isWss: false };
    const user = await gateway.loginAccount(config, 'demo', 'pw');
    await gateway.queryRecentServers(config, user);
    await gateway.loginServer(config, user, 3);
    await gateway.enterServer(config, user, 3);

    assert.match(urls[0], /center\/account\/login\?account=demo&password=pw/);
    assert.match(urls[1], /type=recentserverlist/);
    assert.match(urls[2], /type=sdkAndRoleList/);
    assert.match(urls[3], /type=roleLoginServer/);
});

test('gateway sends HTTP details through the NetworkTransport port', async () => {
    const requests: NetworkRequest[] = [];
    const transport: NetworkTransport = {
        async requestJson<T>(request: NetworkRequest): Promise<T> {
            requests.push(request);
            return { result: true, content: { code: 'u1', token: 'tk', time: 10 } } as T;
        },
    };
    const gateway = new LoginGateway(transport);
    await gateway.loginAccount({ url: 'http://center', backstageurl: 'http://cdn', channelCode: 0 }, 'demo', 'pw');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.match(requests[0].url, /center\/account\/login/);
});

test('随包 protobuf 静态模块包含信封与角色登录协议，且不含动态代码生成', () => {
    // 运行时走**随包的静态模块**（ProtoCoder / ProtocolCodec 都 import 它），
    // 不再走 protobufjs 的反射模式 —— 后者会调 Function(...)，微信小游戏禁用。
    const codec = new ProtocolCodec();
    const report = codec.validate();
    assert.equal(report.hasClientEnvelope, true);
    assert.equal(report.hasServerEnvelope, true);
    assert.equal(report.hasRoleLogin, true);
    assert.ok(report.requestCount > 50);
    assert.ok(report.responseCount > 50);
    assert.ok(codec.encodeRequest('CmdActivityLimitTimeInfoReqMsg', {}, 1).byteLength > 0);

    // 微信小游戏禁止动态执行 JS（eval / new Function，见官方 js-support 文档）。
    // 产物里一旦混进动态代码生成，ProtocolCodec 的**构造**就会抛
    // `Function(...) is not a function`，整个登录页走不下去。
    //
    // 只查「注释之后」的代码段：文件头的说明文字本身就在讲这件事，会把断言打成假阳性。
    const source = readFileSync('assets/script/lib/protobuf/protoCompiledStatic.ts', 'utf8');
    const code = source.replace(/^[\s\S]*?\*\//, '');
    assert.ok(code.length > 100000, `剥掉文件头后剩下的代码段太短（${code.length}），断言会失去意义`);
    assert.doesNotMatch(code, /\bcodegen\b/, '代码段里不允许出现 codegen');
    assert.doesNotMatch(code, /\bFunction\s*\(/, '代码段里不允许出现动态造函数');
    assert.doesNotMatch(code, /\beval\s*\(/, '代码段里不允许出现 eval(');
});

test('静态模块的协议覆盖不低于 config/protoCompiled.json（防生成产物过期）', () => {
    const schema = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
    const jsonCmd = schema.nested.com.nested.xkhy.nested.tafang.nested.cmd;
    const moduleCmd = (protobufRoot as any).com.xkhy.tafang.cmd;

    const jsonMessages: string[] = Object.keys(jsonCmd.nested).filter((name) => jsonCmd.nested[name].fields);
    assert.ok(jsonMessages.length > 100, `JSON 里的消息数异常：${jsonMessages.length}`);
    const missing = jsonMessages.filter((name) => typeof moduleCmd[name]?.encode !== 'function');
    assert.deepEqual(
        missing,
        [],
        '静态模块缺少 config/protoCompiled.json 里的消息，请重新执行 node tools/proto/gen_static_module.mjs',
    );
});

/** proto 字段名 snake_case → pbjs 生成代码里的 camelCase。 */
function protoFieldToCamel(name: string): string {
    return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 回归：拆 `LoginPage` → `LoginRoot` 时 `cmdClientInfo` 只留了 3 个字段，
 * 登录在「发完 CmdRoleLoginReqMsg」那一刻断掉（WS 握手成功、`链接成功` 已打印）。
 *
 * 守的是机制：`CmdClientInfo` 的 required 清单必须与 proto 同步。
 */
test('CmdClientInfo 工厂填满 proto 的全部 required 字段', () => {
    const source = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    const block = /message CmdClientInfo\s*\{([\s\S]*?)\n\}/.exec(source);
    assert.ok(block, 'client_proto/protoCompiled.proto 里找不到 message CmdClientInfo');
    const required = Array.from(block![1].matchAll(/required\s+\S+\s+(\w+)\s*=/g)).map((m) => protoFieldToCamel(m[1]));
    assert.ok(required.length >= 13, `proto 里 CmdClientInfo 的 required 只有 ${required.length} 个，解析规则可能失效`);

    const info = createClientInfo('0.6.0.0', 'tafang-internal');
    assert.deepEqual(
        required.filter((key) => !(key in info)),
        [],
        '工厂漏填了 required 字段',
    );
    for (const [key, value] of Object.entries(info)) {
        assert.equal(typeof value, 'string', `${key} 必须是字符串 —— undefined 会让 writer.string() 抛`);
    }
    assert.equal(info.versionName, '0.6.0.0');
    assert.equal(info.versionCode, '0.6.0.0');
    assert.equal(info.bigChannel, 'tafang-internal');
});

/**
 * 端到端复现真实发送路径：`CmdRoleLoginReqMsg.create(普通对象)` → `encode`。
 *
 * 业务层传的是**对象字面量**（不是 CmdClientInfo 实例），读不到 pbjs 原型上的 `""` 兜底；
 * `CmdRoleLoginReqMsg.encode` 对 `cmd_client_info` 无守卫递归，所以 required 缺一个就抛。
 */
test('CmdRoleLoginReqMsg 以普通对象编码成功，且漏字段必定抛 TypeError', () => {
    const cmd = (protobufRoot as any).com.xkhy.tafang.cmd;
    const param = {
        cmdClientInfo: createClientInfo('0.6.0.0', 'tafang-internal'),
        platform: 0,
        code: 'qwe110110',
        roleId: 10011,
        time: 1790135755466,
        token: 'tk',
        reconnect: false,
        openid: '',
        selectServerId: 1,
    };

    const msg = cmd.CmdRoleLoginReqMsg.create(param);
    const bytes: Uint8Array = cmd.CmdRoleLoginReqMsg.encode(msg).finish();
    assert.ok(bytes.byteLength > 0, '编码结果为空');

    const decoded = cmd.CmdRoleLoginReqMsg.decode(bytes);
    assert.equal(decoded.code, 'qwe110110');
    assert.equal(decoded.token, 'tk');
    assert.equal(decoded.cmdClientInfo.bigChannel, 'tafang-internal');
    assert.equal(decoded.cmdClientInfo.versionName, '0.6.0.0');

    // 反向：这正是 2026-09-23 线上断链的形态 —— 只填 3 个字段。
    assert.throws(
        () => {
            const broken = cmd.CmdRoleLoginReqMsg.create({
                ...param,
                cmdClientInfo: { versionName: '0.6.0.0', versionCode: '0.6.0.0', bigChannel: 'tafang-internal' },
            });
            cmd.CmdRoleLoginReqMsg.encode(broken).finish();
        },
        TypeError,
        '缺 required 字段必须抛 —— 若这里不抛，说明 pbjs 产物换了行为，整个结论链要重查',
    );
});
