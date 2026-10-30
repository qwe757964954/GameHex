import { componentControllerModule } from './helpers/controller-context';
/**
 * 「玩家点击界面」上报（`CmdGameViewClickReqMsg` / `CmdGameViewClickRspMsg`）的单测。
 *
 * 这条链路错了**全是零报错**：`mark` 传成 `MainTab.World = 6` 服务端照样回 `succ = 1`，
 * 只是记到了别的界面名下；把 `allowRetry` 留着，断线重连补发会给服务端多记几条假点击。
 * 所以钉五件事：
 *   ① 协议字段号/类型 + MessageId 已登记（没登记本地就发不出去）；
 *   ② `mark` 走**服务端编号**常量，且 2 不等于客户端 `MainTab.World = 6`；
 *   ③ 请求体只有 `mark`、不弹 loading、`allowRetry = false`；
 *   ④ `succ === 1` 才算成功，失败/超时/未连接一律 `false` 且**不 reject**；
 *   ⑤ 世界按钮点击传 2，其他可用底栏入口传 1，不在 `switchTab` 里上报。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import ts from 'typescript';
import { toCount, withTimeout } from '../assets/script/app/net/RequestGuard';
import { assetPath } from './helpers/asset-paths';

const CMD = 'com.xkhy.tafang.cmd';

function loadRoot(): protobuf.Root {
    return protobuf.Root.fromJSON(JSON.parse(readFileSync(assetPath('config/protoCompiled.json'), 'utf8')));
}

const root = loadRoot();

/** 剥掉注释再做源码形状断言（注释里正大光明写着"不要这么写"）。 */
function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

interface ISent {
    name: string;
    body: Record<string, unknown>;
    allowRetry: boolean;
    needLoading: boolean;
}

/**
 * 加载服务模块（`GameNet` 会拉进 `cc`，Node 里只能走 vm 转译 + 桩）。
 *
 * `succ` 三态（用 `hasOwnProperty` 区分，别用 `??`：「显式传 undefined」= 回包里缺这个字段，
 * 与「没传 ⇒ 默认成功」是两件事，混一起会把"缺 succ 也算成功"的 bug 测成绿的）：
 * - 不传 ⇒ 回 `{ succ: 1 }`
 * - `undefined` ⇒ 回 `{}`（字段缺失）
 * - `null` ⇒ 不回包
 * - 数字 ⇒ 回该数字
 */
function loadService(options: {
    connected?: boolean;
    succ?: number | null;
    hang?: boolean;
    reject?: boolean;
} = {}) {
    const sent: ISent[] = [];
    const hasSucc = Object.prototype.hasOwnProperty.call(options, 'succ');
    const requests = loadModule('assets/script/app/generated/requestMsg/RequestSystemMsg.ts', () => ({
        RequestMsg: class {
            allowRetry = true;
            constructor(public cmdReqMsg: Record<string, unknown>, _caller: unknown, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    const net = {
        isConnected: options.connected ?? true,
        async send(req: { getReqMsgProtoName(): string; cmdReqMsg: Record<string, unknown>; fCallback(rsp: unknown): void;
            allowRetry: boolean }, needLoading: boolean) {
            sent.push({ name: req.getReqMsgProtoName(), body: req.cmdReqMsg, allowRetry: req.allowRetry, needLoading });
            if (options.hang) return new Promise<boolean>(() => undefined);
            if (options.reject) throw new Error('send failed');
            if (options.succ === null) return true;
            if (!hasSucc) req.fCallback({ succ: 1 });
            else if (options.succ === undefined) req.fCallback({});
            else req.fCallback({ succ: options.succ });
            return true;
        },
    };
    const mod = loadModule('assets/script/app/main/GameViewClickService.ts', (name) => {
        if (name.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (name.endsWith('/RequestSystemMsg')) return requests;
        // `withTimeout` 收成 10ms：只验「超时 → false 且不 reject」这一个分支，不真的等 3 秒。
        if (name.endsWith('/RequestGuard')) {
            return {
                toCount,
                withTimeout: (promise: Promise<boolean>, _ms: number, fallback: () => boolean) =>
                    Promise.race([promise, new Promise<boolean>((resolve) => setTimeout(() => resolve(fallback()), 10))]),
            };
        }
        return {};
    });
    return { mod, sent };
}

function loadModule(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { exports, require: (name: string) => name.endsWith('/ComponentController') ? componentControllerModule() : require(name) });
    return exports;
}

// ============================================================================
// ① 协议
// ============================================================================

test('协议：请求 mark / 响应 succ 各一个 uint32，字段号与 proto 一致', () => {
    const req = root.lookupType(`${CMD}.CmdGameViewClickReqMsg`);
    const rsp = root.lookupType(`${CMD}.CmdGameViewClickRspMsg`);
    assert.deepEqual(Object.keys(req.fields), ['mark']);
    assert.equal(req.fields.mark.id, 1);
    assert.equal(req.fields.mark.type, 'uint32');
    assert.deepEqual(Object.keys(rsp.fields), ['succ']);
    assert.equal(rsp.fields.succ.id, 1);
    assert.equal(rsp.fields.succ.type, 'uint32');
});

test('★协议：MessageId 已登记（没登记本地就发不出去）', () => {
    const ids = root.lookupEnum(`${CMD}.MessageId`);
    assert.equal(ids.values.CmdGameViewClickRspMsg, 463153146);
});

test('编码往返：{ mark: 2 } 编得出、解得回', () => {
    const req = root.lookupType(`${CMD}.CmdGameViewClickReqMsg`);
    const decoded = req.toObject(req.decode(req.encode(req.create({ mark: 2 })).finish())) as { mark: number };
    assert.equal(decoded.mark, 2);
});

// ============================================================================
// ② mark 口径
// ============================================================================

test('★mark：世界 = 2，是服务端编号，不是 MainTab.World = 6', () => {
    const { mod } = loadService();
    const marks = mod.GAME_VIEW_MARK as { World: number };
    assert.equal(marks.World, 2);
    assert.notEqual(marks.World, 6, '★客户端 MainTab.World 是 6，两者没有对应关系，别拿下标填');
    assert.equal(mod.GAME_VIEW_CLICK_TIMEOUT_MS, 3000);
});

// ============================================================================
// ③ 请求形态
// ============================================================================

for (const mark of [1, 2]) test(`请求 mark=${mark}：只带 mark、不弹 loading、allowRetry=false`, async () => {
    const { mod, sent } = loadService({ succ: 1 });
    const ok = await (mod.reportGameViewClick as (mark: number, caller?: unknown) => Promise<boolean>)(mark, {});
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, 'CmdGameViewClickReqMsg');
    assert.deepEqual(Object.keys(sent[0].body), ['mark'], '载荷只有 mark');
    assert.equal(sent[0].body.mark, mark);
    assert.equal(sent[0].needLoading, false, '★埋点绝不能弹转圈');
    assert.equal(sent[0].allowRetry, false, '★埋点重发 = 服务端多记一次点击');
});

// ============================================================================
// ④ 结果口径
// ============================================================================

test('succ 只认 1：0 / 缺失 / 垃圾值都是失败', async () => {
    for (const succ of [0, 2, undefined, null]) {
        const { mod } = loadService({ succ: succ as number });
        const ok = await (mod.reportGameViewClick as (mark: number) => Promise<boolean>)(2);
        assert.equal(ok, false, `succ=${String(succ)} 不该算成功`);
    }
});

test('未连接：不发请求、直接 false、不抛', async () => {
    const { mod, sent } = loadService({ connected: false });
    assert.equal(await (mod.reportGameViewClick as (mark: number) => Promise<boolean>)(2), false);
    assert.equal(sent.length, 0, '断线时不该把请求塞进队列');
});

test('★超时/发送抛错：一律兑现 false，绝不 reject（埋点不许拖住切页）', async () => {
    const hang = loadService({ hang: true });
    assert.equal(await (hang.mod.reportGameViewClick as (mark: number) => Promise<boolean>)(2), false);
    const reject = loadService({ reject: true });
    assert.equal(await (reject.mod.reportGameViewClick as (mark: number) => Promise<boolean>)(2), false);
});

test('真实 withTimeout：永不兑现的请求也会兜底为 false', async () => {
    assert.equal(await withTimeout(new Promise<boolean>(() => undefined), 15, () => false), false);
});

// ============================================================================
// ⑤ 接线护栏
// ============================================================================

test('★MainTabHost：世界按钮点击时上报，且不在 switchTab 里上报（外部路由不是玩家点击）', () => {
    const host = codeOf('assets/script/app/main/MainTabHost.ts');
    assert.match(host, /reportGameViewClick\(GAME_VIEW_MARK\.World,\s*this\)/, '世界格点击必须上报 mark=2');
    assert.match(host, /type === MainTab\.World\)[\s\S]{0,400}reportGameViewClick/, '上报要挂在世界格的按钮回调里');
    // switchTab 内部不许出现上报：`switchToTab(6)`（活动跳转）也会走它，混进来就是假点击。
    const switchBody = host.slice(host.indexOf('async switchTab('), host.indexOf('activateBackgroundWarmup'));
    assert.doesNotMatch(switchBody, /reportGameViewClick/, '★switchTab 里不许上报（外部跳转不是玩家点击）');
});

test('底栏实际点击：世界报 2，其他可用入口报 1；初始化和路由跳转不上报', async () => {
    interface ITestButton {
        tabType: number;
        node: { position: { x: number } };
        enabled: boolean;
        select: (() => void) | null;
        setEnabled(enabled: boolean): void;
        bindSelect(select: (() => void) | null): void;
        bindRedDotExpr(): void;
    }
    interface ITestHost {
        navBar: { getComponentsInChildren(): ITestButton[] };
        switchTab(index: number): Promise<void>;
        switchToTab(index: number): void;
        onLoad(): void;
    }
    const buttons: ITestButton[] = [0, 1, 2, 3, 4, 5, 6].map((tabType) => ({
        tabType, node: { position: { x: tabType } }, enabled: false, select: null,
        setEnabled(enabled) { this.enabled = enabled; },
        bindSelect(select) { this.select = select; },
        bindRedDotExpr() {},
    }));
    const reports: Array<{ mark: number; caller: object }> = [];
    const { mod: service } = loadService();
    const hostModule = loadModule('assets/script/app/main/MainTabHost.ts', (name) => {
        if (name === 'cc') return {
            _decorator: {
                ccclass: () => (value: unknown) => value,
                property: () => () => undefined,
            },
            Component: class { isValid = true; scheduleOnce() {} },
        };
        if (name.endsWith('/GameViewClickService')) return {
            GAME_VIEW_MARK: service.GAME_VIEW_MARK,
            reportGameViewClick(mark: number, caller: object) {
                reports.push({ mark, caller });
                return new Promise<boolean>(() => undefined);
            },
        };
        if (name.endsWith('/MainTabItems')) return { mainTabItem: () => ({}) };
        if (name.endsWith('/BigMapEntry')) return { BigMapEntry: { shared: () => ({ close() {} }) } };
        return {};
    });
    const Host = hostModule.MainTabHost as new () => ITestHost;
    const host = new Host();
    host.navBar = { getComponentsInChildren: () => buttons };
    const switchTab = host.switchTab;
    const switches: number[] = [];
    host.switchTab = async (index) => { switches.push(index); };
    host.onLoad();
    assert.equal(reports.length, 0, '默认页初始化不算点击');
    switches.length = 0;

    for (const [tabType, mark] of [[0, 1], [1, 1], [2, 1], [3, 1], [5, 1], [6, 2]]) {
        const button = buttons[tabType];
        assert.equal(button.enabled, true);
        assert.ok(button.select);
        button.select();
        assert.equal(reports.length, 1, '一次点击只上报一次');
        assert.equal(reports[0].mark, mark, `入口 ${tabType} 的服务端编号`);
        assert.equal(reports[0].caller, host, '请求归属于真实宿主');
        assert.deepEqual(switches, [tabType], '上报未返回也立即切页');
        reports.length = 0;
        switches.length = 0;
    }
    assert.equal(buttons[4].enabled, false);
    assert.equal(buttons[4].select, null, '未开放的挑战入口不触发点击');
    host.switchTab = switchTab;
    Object.assign(host, { pagePath: () => null });
    host.switchToTab(0);
    await Promise.resolve();
    assert.equal(reports.length, 0, '程序跳转不计入点击');
});

test('请求封装注册在系统类请求里，协议名与 d.ts 一致', () => {
    const source = codeOf('assets/script/app/generated/requestMsg/RequestSystemMsg.ts');
    assert.match(source, /class RequestGameViewClick extends RequestMsg<CmdGameViewClickReqMsg, CmdGameViewClickRspMsg>/);
    assert.match(source, /return "CmdGameViewClickReqMsg"/);
});
