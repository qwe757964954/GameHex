/**
 * 「开始游戏」协议（`CmdStartBattleReqMsg` / `CmdStartBattleRspMsg`）的接入单测。
 *
 *  只 import **零引擎依赖**的模块：`BattleStartService`（经 `GameNet` 拉进 `cc`）、
 * `ProcedureMatching` / `MatchingPage`（`cc`/流程组件）在 Node 里 import 就炸，
 * 它们的口径用「读源码 + 断言关键写法」守住 —— 与 `formation-board.test.ts` /
 * `pvp-hero-interface.test.ts` 同一套做法。
 *
 * 被守住的五件事：
 *   ① **协议结构**：r238 加进来的 message 在运行时 protobuf 里真的存在，字段号/类型对得上
 *      （少一个字段，服务端回了也解不出来）。r259「战斗协议抽取」把请求的
 *      `battleType/battleParams` 抽成了 `CmdStartBattleInfo` 子消息 —— 结构断言与
 *      「网络层必须发嵌套载荷」两条用例就是这次改形的护栏；
 *   ② **「没有 Rsp 的 MessageId，请求就发不出去」这条机制** —— `ProtoCoder.initMessage()` 是
 *      用 `key.replace("RspMsg","")` 从 `MessageId` 反推请求名的。`CmdStartBattleRspMsg`
 *      在 r256 之前一直没登记（症状是 `GameNet` 打「不存在协议…MessageId 中没定义」），
 *      **现已补上 `= 1785200541`**；本用例直接用**真实的 `ProtoCoder` 类 + 真实的静态协议模块**
 *      跑一遍「编码 → 解码」，把它钉成回归护栏；
 *   ③ **协议不通不能把流程卡死**：请求必须兜硬超时、catch 后返回 `null`（不是 rethrow），
 *      匹配流程必须留 `pickLocalOpponent()` 兜底 —— 否则「开始游戏」会永远停在"正在寻找对手中"；
 *   ④ **边界校验**：`code != 1`、缺 `battleId`、`campId` 非法、`heroId` 重复/非法、
 *      `uint64` 走 `Long` —— 都不该把匹配/对局带崩；
 *   ⑤ **头像 id → 资源名**（2026-09-22）：`showInfo.img` 要经 `head` → `icon.json` **两层**
 *      才能变成 `resources.load` 认的资源名，且解出来的名字必须真的在 `HEAD_ART_ROOT`
 *      （`image/icon/head`）下有图。这条链任何一层断了都**不报错**（`loadMatchIcon` 只打一条
 *      warn、界面留着占位图），所以最后一跳用「读真表 + 查真目录」的方式钉死，不靠人眼。
 *      两层查表本身的实现/边界在 `HeadArtModel`（`tests/head-art-model.test.ts`），
 *      本文件只锁「`MatchProfileLookup` 把它接进来了」这一跳。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
// 真 ProtoCoder：`GameNet` 判"能不能发"用的就是它 + 真静态协议模块。
// 走**静态 import**（不用 `await import()`）：tsconfig 的 `--module` 不支持动态 import，会报 TS1323。
import { ProtoCoder } from '../assets/script/framework/net/ProtoCoder';
import {
    ZC_BATTLE_TYPE_PVP,
    applyUnitToPlayerView,
    buildMatchProfileLookup,
    normalizeBattleStart,
    normalizeBattleUnit,
    normalizeHeroIds,
    splitBattleUnits,
} from '../assets/script/app/battle/BattleStartModel';
import { toCount, toIdString, toPositiveInt, withTimeout } from '../assets/script/app/net/RequestGuard';
import * as ArtPaths from '../assets/script/app/ArtPaths';

const CMD = 'com.xkhy.tafang.cmd';

/**
 * `uint64` 字段在运行时是 protobufjs 自己那份 `Long`（`--force-long` 的产物）。
 * **不要 `import Long from 'long'`**：`long` 只是 protobufjs 的传递依赖（`package.json` 里没有它），
 * 直接 import 等于把别人的依赖树当自己的用 —— 将来 protobufjs 换实现，用例会以"模块找不到"的方式失败，
 * 而那时真正该报错的是"协议字段类型变了"。
 */
const Long = (protobuf.util as unknown as {
    Long: { fromString(value: string, unsigned?: boolean): unknown };
}).Long;

function loadRoot(): protobuf.Root {
    const schema = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
    return protobuf.Root.fromJSON(schema);
}

const root = loadRoot();

/**
 * 把注释剥掉再对源码做形状断言。
 *
 *  必须剥：代码里被**禁止**的写法常常正大光明出现在"不要这么写"的注释里
 *  （`BattleStartModel` 就写着「必须用 `Array.from` 而不是 `[...result.values()]`」），
 *  不剥注释的用例会被自己的文档绊倒。
 */
function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}


// ============================================================================
// ① 协议结构
// ============================================================================

test('运行时 protobuf 含开始战斗的 4 个 message，且字段号/类型与 proto 一致', () => {
    const req = root.lookupType(`${CMD}.CmdStartBattleReqMsg`);
    const rsp = root.lookupType(`${CMD}.CmdStartBattleRspMsg`);
    const unit = root.lookupType(`${CMD}.CmdBattleUnitInfo`);
    const show = root.lookupType(`${CMD}.CmdBattleUnitShowInfo`);
    const info = root.lookupType(`${CMD}.CmdStartBattleInfo`);

    // 请求：r259「战斗协议抽取」把平铺字段抽成了 `startBattleInfo` 子消息。
    //  这条断言就是那次改形的护栏 —— 以后再动形状，这里先红。
    assert.deepEqual(Object.keys(req.fields), ['startBattleInfo', 'version']);
    assert.equal(req.fields.startBattleInfo.id, 1);
    assert.equal(req.fields.version.id, 2);
    assert.equal(req.fields.startBattleInfo.required, true);
    assert.equal(req.fields.startBattleInfo.resolvedType, info);
    assert.deepEqual(Object.keys(info.fields), ['battleType', 'battleParams']);
    assert.equal(info.fields.battleType.id, 1);
    assert.equal(info.fields.battleType.required, true);
    assert.equal(info.fields.battleType.type, 'uint32');
    assert.equal(info.fields.battleParams.id, 2);
    assert.equal(info.fields.battleParams.repeated, true);
    assert.equal(info.fields.battleParams.type, 'string');

    // 响应：battleId / seed 是这一局的命根子，code 决定成功失败
    assert.deepEqual(Object.keys(rsp.fields), ['code', 'seed', 'version', 'battleId', 'startBattleInfo', 'unitInfos']);
    assert.equal(rsp.fields.code.id, 1);
    assert.equal(rsp.fields.seed.id, 2);
    assert.equal(rsp.fields.seed.type, 'uint64');
    assert.equal(rsp.fields.battleId.id, 4);
    assert.equal(rsp.fields.battleId.type, 'string');
    assert.equal(rsp.fields.startBattleInfo.id, 5);
    assert.equal(rsp.fields.startBattleInfo.resolvedType, info, 'r259 起回带的是 startBattleInfo，不再是 reqMsg');
    assert.equal(rsp.fields.unitInfos.id, 6);
    assert.equal(rsp.fields.unitInfos.repeated, true);
    assert.equal(rsp.fields.unitInfos.resolvedType, unit);

    // 战斗单元：showInfo 是必需的，缺了分不出该渲染到左边还是右边
    assert.deepEqual(Object.keys(unit.fields), ['showInfo', 'campId', 'heroInfos', 'artifactId', 'artifactLevel', 'unitId']);
    assert.equal(unit.fields.showInfo.resolvedType, show);
    assert.equal(unit.fields.campId.type, 'uint32');
    assert.equal(unit.fields.heroInfos.resolvedType, root.lookupType(`${CMD}.CmdPvpHeroInfo`));

    assert.deepEqual(
        Object.keys(show.fields),
        ['roleId', 'serverId', 'power', 'name', 'img', 'headFrame', 'gradeId', 'gradeScore'],
    );
    assert.equal(show.fields.roleId.type, 'uint64');
    assert.equal(show.fields.img.type, 'uint64');
});

test('开始战斗请求的编码口径（r259 抽子消息后，字段 1 是 message 不再是 uint32）', () => {
    const req = root.lookupType(`${CMD}.CmdStartBattleReqMsg`);
    // 内层 battleType=1001 → tag(0x08) + varint(0xE9 0x07) = 3 字节
    // 外层 startBattleInfo → tag(0x0A) + len(0x03) + 3 = 5 字节
    assert.equal(req.encode(req.create({ startBattleInfo: { battleType: ZC_BATTLE_TYPE_PVP } })).finish().byteLength, 5);
    // 再带一个 battleParams 元素 → 内层 +3（tag 0x12 + len 1 + 'a'）= 6，外层 = 2 + 6 = 8 字节
    assert.equal(
        req.encode(req.create({
            startBattleInfo: { battleType: ZC_BATTLE_TYPE_PVP, battleParams: ['a'] },
        })).finish().byteLength,
        8,
    );
    // 平铺写法在新协议下**根本编不出来**（required 的子消息为 null → 直接抛
    // `Cannot read properties of null (reading 'battleType')`）：
    // 这正是 r259 之后"点开始游戏拿不到服务端数据"的成因 —— 报错发生在发送前的编码里。
    assert.throws(
        () => req.encode(req.create({ battleType: ZC_BATTLE_TYPE_PVP } as any)).finish(),
        /reading 'battleType'/,
        '平铺载荷必须编不出来（编得出来就说明协议又变回去了）',
    );
});

test('网络层发的是嵌套载荷（不是平铺）—— r259 改形的直接护栏', () => {
    const service = codeOf('assets/script/app/battle/BattleStartService.ts');
    assert.match(service, /startBattleInfo:\s*\{\s*battleType/, '载荷必须嵌在 startBattleInfo 里');
    assert.doesNotMatch(service, /new RequestStartBattle\(\s*\{\s*battleType/, '平铺写法在 r259 之后是废包');
});

// ============================================================================
// ② 「没有 Rsp 的 MessageId，请求就发不出去」
// ============================================================================

test('请求名由 MessageId 的 *RspMsg 反推：没登记 Rsp 的 id 就发不出去', () => {
    const coder = readFileSync('assets/script/framework/net/ProtoCoder.ts', 'utf8');
    // 机制本身（不是某条协议的数值）：initMessage 去掉 "RspMsg" 得到裸名，addMessage 再拼回两个名字
    assert.match(coder, /name\s*=\s*key\.replace\(\s*"RspMsg"\s*,\s*""\s*\)/);
    assert.match(coder, /let reqName\s*=\s*name\s*\+\s*"ReqMsg"/);
    assert.match(coder, /t\._reqNameIdMap\[reqName\]\s*=\s*messageId/);
    // 发送前查的就是这张表，查不到 → getMessageId 返回 undefined → GameNet 拒发
    assert.match(coder, /t\._reqNameIdMap\[reqMsg\]/);
    assert.match(readFileSync('assets/script/app/net/GameNet.ts', 'utf8'), /不存在协议/);

    // 用真实规则从 MessageId 推一次「可发送的请求名集合」，
    // 一个已经跑通的协议必须能被推出来 —— 这是"我理解对了这条链"的证据。
    const messageId = root.lookupEnum(`${CMD}.MessageId`);
    const registered = Object.keys(messageId.values);
    const sendableReqNames = registered.map((name) => `${name.replace('RspMsg', '')}ReqMsg`);
    assert.ok(sendableReqNames.includes('CmdFormationInfoReqMsg'), '布阵请求应能从 MessageId 推出来');

    // 「开始战斗能否发送」= 「CmdStartBattleRspMsg 是否被登记」。
    //  r238 只加了 message，r256 才补上 id —— 现在是**硬断言**：
    //  谁把枚举里那行删了/改用别的名字，用例立刻变红（而不是等到点"开始游戏"才发现）。
    assert.ok(registered.includes('CmdStartBattleRspMsg'),
        'MessageId 必须登记 CmdStartBattleRspMsg：缺了这条请求发不出去');
});

// ---------------------------------------------------------------------------
// 真驱动 ProtoCoder：这才是"到底发不发得出去"的权威判定
//   上面读 JSON 只是近似 —— 运行时 `GameNet` 走的是 `ProtoCoder` + `protoCompiledStatic.ts`。
//   而这两个产物是**分开生成**的（static 由 `node tools/proto/gen_static_module.mjs` 单独产出，
//   `build_proto.bat` 里没有这一步），所以「json 对了」≠「能发」——必须单独守一道。
//   历史上正是这里出过事：proto/json 已在 18:36 刷新，static 还停在 17:55。
// ---------------------------------------------------------------------------

test('真 ProtoCoder + 真静态模块：CmdStartBattleReqMsg 已可编码（id 1785200541）', async () => {
    const coder = new ProtoCoder();
    await coder.init();

    // 这一句就是 `GameNet.createCmdClientData` 的判定依据：undefind → reject + 「不存在协议」
    const id = coder.getMessageId('CmdStartBattleReqMsg');
    assert.equal(typeof id, 'number', 'getMessageId 必须查得到：查不到就是"这条请求发不出去"');
    assert.equal(id, 1785200541, 'MessageId 登记值（协议改了要同步本条）');

    // 光有 id 没类，encode 时同样会炸
    assert.ok(coder.getProto(id) != null, 'reqMap[id] 必须是能编解码的类');
    // 响应得能反查名字，否则服务端回包会被 decodeDataById 静默丢掉
    assert.equal(coder.getRspNameById(id), 'CmdStartBattleRspMsg');

    // 真编一次：battleType=1001(uint32) 嵌在 startBattleInfo 里
    //  内层 tag(0x08)+varint(0xE9 0x07)=3；外层 tag(0x0A)+len(0x03)=2 → 5 字节
    const bytes = coder.encodeReqMgs('CmdStartBattleReqMsg', {
        startBattleInfo: { battleType: ZC_BATTLE_TYPE_PVP, battleParams: [] },
    });
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual(Array.from(bytes), [0x0A, 0x03, 0x08, 0xE9, 0x07]);
});

test('真 ProtoCoder 能解出服务端回包：code / seed / battleId / unitInfos', async () => {
    const coder = new ProtoCoder();
    await coder.init();
    const id = coder.getMessageId('CmdStartBattleReqMsg') as number;

    const rsp = root.lookupType(`${CMD}.CmdStartBattleRspMsg`);
    // ⚠️ 必须 fromObject 而不是 create：`create()` 只做赋值不做类型转换，
    //    给 uint64 字段塞十进制字符串（'10022'）会在 encode 时炸 `Cannot read properties of undefined (reading 'low')`。
    const payload = rsp.encode(rsp.fromObject({
        code: 1,
        seed: Long.fromString('18446744073709551615'),
        version: 'v1',
        battleId: 'battle-77',
        // startBattleInfo 是 required：服务端把请求原样回带（少了它 encode 直接抛 TypeError）
        startBattleInfo: { battleType: ZC_BATTLE_TYPE_PVP, battleParams: ['a'] },
        unitInfos: [
            { campId: 1, showInfo: { roleId: '10022', serverId: 1, name: '我', power: 1234 } },
            { campId: 2, showInfo: { roleId: '10088', serverId: 1, name: '对面', power: 4321 } },
        ],
    })).finish();

    const decoded = coder.decodeDataById(id, payload);
    assert.ok(decoded != null, 'decodeDataById 必须命中 rspMap，否则回包被静默丢弃');
    assert.equal(decoded.code, 1);
    assert.equal(decoded.battleId, 'battle-77');
    assert.deepEqual(Array.from(decoded.startBattleInfo.battleParams as string[]), ['a'], 'startBattleInfo 必须能解出来（回执）');
    // uint64 → Long：只经 toIdString 转字符串，别碰 number（超 2^53 会静默丢精度）
    assert.equal(toIdString(decoded.seed), '18446744073709551615');
    assert.equal(decoded.unitInfos.length, 2);
    assert.equal(toIdString(decoded.unitInfos[1].showInfo.roleId), '10088');
});

/**
 * 已知「Rsp 没登记 id」的请求（= 现在一定发不出去）。
 *
 * 只允许放**别人负责补**的协议；补上后**必须把名字从这里删掉**，否则这份清单会变成
 * "永久豁免"，新加的协议就算漏登记 id 也没人发现。
 * 现状：`CmdFormationSelectReqMsg`（`FormationService.selectFormation`，切阵型页签时调）
 * —— 与开战协议同一批漏的，r256 只补了开战，2026-09-21 仍缺。
 */
const KNOWN_UNSENDABLE = new Set(['CmdFormationSelectReqMsg']);

test('工程内所有请求类都能发出去（已知例外必须在清单里）', async () => {
    const coder = new ProtoCoder();
    await coder.init();

    const files = readdirSync('assets/script/app/generated/requestMsg').filter((f) => f.endsWith('.ts'));
    assert.ok(files.length > 0, '没扫到 requestMsg 目录，说明路径变了，这条用例已经失效');

    const actuallyUnsendable: string[] = [];
    const exemptions: string[] = [];
    for (const file of files) {
        const src = readFileSync(`assets/script/app/generated/requestMsg/${file}`, 'utf8');
        for (const match of src.matchAll(/return\s+'(Cmd\w+ReqMsg)'/g)) {
            const reqName = match[1];
            if (coder.getMessageId(reqName) != null) continue;
            if (KNOWN_UNSENDABLE.has(reqName)) {
                exemptions.push(reqName);
            } else {
                actuallyUnsendable.push(`${reqName} (${file})`);
            }
        }
    }

    assert.deepEqual(actuallyUnsendable, [],
        '这些请求类发不出去：MessageId 缺对应的 <Base>RspMsg，或 protoCompiledStatic.ts 没重建');
    // 例外一旦被补上就要从清单里删掉，这里反向盯住"清单过期"
    assert.deepEqual(exemptions, ['CmdFormationSelectReqMsg'],
        'KNOWN_UNSENDABLE 已过期：请把已补齐的名字移出清单');
});

// ============================================================================
// ③ 协议不通不能把流程卡死
// ============================================================================
test('开始战斗请求兜硬超时、永不 reject、失败返回 null', () => {
    const service = readFileSync('assets/script/app/battle/BattleStartService.ts', 'utf8');
    assert.match(service, /export const BATTLE_START_TIMEOUT_MS\s*=\s*\d+/, '必须有硬超时常量');
    assert.match(service, /withTimeout\(sendStartBattle\(/, '发送必须包在 withTimeout 里');
    // 未连接直接早退，不发包
    assert.match(service, /if \(!net\.isConnected\)/, '离线时不能发包（离线复现不出"悬着"的问题）');
    // GameNet 统一检查 MessageId；战斗服务只负责离线、超时和响应归一化。
    const gameNet = codeOf('assets/script/app/net/GameNet.ts');
    assert.match(gameNet, /getMessageId\(messageName\)/);
    assert.match(gameNet, /if \(!messageId\)/);
    // catch 里必须 return null（降级），不能 rethrow → 否则 awaitReady 会把流程带崩
    assert.match(service, /\}\s*catch\s*\(error\)\s*\{[\s\S]{0,400}?return null;/, 'catch 分支必须降级返回 null');
    assert.equal(/^\s*throw\s/m.test(codeOf('assets/script/app/battle/BattleStartService.ts')), false,
        '本层不允许抛出：契约是"永远兑现、永远不 reject"');
});

test('匹配流程保留本地对手兜底，且选人只走一次', () => {
    const procedure = readFileSync('assets/script/app/procedure/ProcedureMatching.ts', 'utf8');
    assert.match(procedure, /private pickOpponents\(\)/, '拿不到服务端数据仍要提供兜底对手');
    assert.match(procedure, /if \(!enemy\)/, '服务端没有对手时必须走兜底分支');
    assert.match(procedure, /awaitReady:\s*\(\)\s*=>/, '选人前必须等一次在途请求（保证展示与进局是同一份数据）');
    assert.match(procedure, /startBattle\(ZC_BATTLE_TYPE_PVP\)/, '「开始游戏」入口必须真的发这条协议');
    assert.match(procedure, /clearLastBattleStart\(\)/, '离开匹配必须清缓存，免得下一局复用上一局 battleId');

    const page = readFileSync('assets/script/app/matching/MatchingPage.ts', 'utf8');
    // 等待期间 phase 仍是 searching，update() 会每帧再进 finishSearch → 必须有守卫
    assert.match(page, /private finishing = false;/);
    assert.match(page, /this\.finishing = false;/, 'beginMatch 必须重置守卫');
    assert.match(page, /if \(!options \|\| this\.finishing\) return;/);
    assert.match(page, /this\.isValid/, 'await 之后必须确认组件还活着再回调');
});

// ============================================================================
// ④ 边界校验（纯函数）
// ============================================================================

const show = (over: Record<string, unknown> = {}) => ({
    roleId: Long.fromString('10001', true),
    serverId: 2,
    power: 27574,
    name: '对手甲',
    img: Long.fromString('900001', true),
    headFrame: Long.fromString('0', true),
    gradeId: 3,
    gradeScore: 120,
    ...over,
});

const unit = (over: Record<string, unknown> = {}) => ({
    showInfo: show(),
    campId: 1,
    heroInfos: [{ heroId: 101, level: 5 }],
    artifactId: 7,
    artifactLevel: 2,
    ...over,
});

const rsp = (over: Record<string, unknown> = {}) => ({
    code: 1,
    seed: Long.fromString('1234567890123456789', true),
    version: '1.0.0',
    battleId: '20260921_2_7_pvp',
    startBattleInfo: { battleType: ZC_BATTLE_TYPE_PVP, battleParams: [] },
    unitInfos: [unit(), unit({ campId: 2, showInfo: show({ roleId: Long.fromString('20002', true), name: '对手乙' }) })],
    ...over,
}) as unknown as CmdStartBattleRspMsg;

test('响应归一化：code != 1、缺 battleId、无单元 都判为不可用', () => {
    assert.equal(normalizeBattleStart(null), null);
    assert.equal(normalizeBattleStart(rsp({ code: 2 })), null, 'code=2 是"失败"');
    assert.equal(normalizeBattleStart(rsp({ battleId: '' })), null);
    assert.equal(normalizeBattleStart(rsp({ unitInfos: [] })), null);
    // 单元全非法 == 没有单元
    assert.equal(normalizeBattleStart(rsp({ unitInfos: [unit({ campId: 0 })] })), null);

    const ok = normalizeBattleStart(rsp())!;
    assert.equal(ok.battleId, '20260921_2_7_pvp');
    assert.equal(ok.seed, '1234567890123456789', 'uint64 必须走字符串，不能经 number 丢精度');
    assert.equal(ok.units.length, 2);
});

test('战斗单元归一化：campId 必需、heroId 去重且过滤非法', () => {
    assert.equal(normalizeBattleUnit(null), null);
    assert.equal(normalizeBattleUnit(unit({ campId: 0 }) as any), null);
    assert.equal(normalizeBattleUnit(unit({ campId: 'x' }) as any), null);
    assert.equal(normalizeBattleUnit(unit({ showInfo: undefined }) as any), null);

    const parsed = normalizeBattleUnit(unit({
        heroInfos: [{ heroId: 101, level: 1 }, { heroId: 101, level: 9 }, { heroId: 0, level: 3 }, { heroId: 202, level: 4 }],
    }) as any)!;
    assert.deepEqual(parsed.heroIds, [101, 202], '重复 heroId 只能上一次，0 要丢掉');
    assert.equal(parsed.roleId, '10001');
    assert.equal(parsed.avatarId, '900001');
    assert.equal(parsed.power, 27574);

    // 同一 campId 出现两条 → 后者覆盖，列表里只留一条
    const start = normalizeBattleStart(rsp({ unitInfos: [unit({ campId: 2 }), unit({ campId: 2, artifactId: 99 })] }))!;
    assert.equal(start.units.length, 1);
    assert.equal(start.units[0].artifactId, 99);
});

test('heroId 去重要用 Array.from 口径（构建期 Babel 展开会降级）', () => {
    const model = codeOf('assets/script/app/battle/BattleStartModel.ts');
    assert.equal(model.includes('[...'), false, '禁用展开运算符：loose 模式会降级成 [].concat(iterator)');
    assert.match(model, /Array\.from\(result\.values\(\)\)/);
});

test('敌我划分：先按本机 roleId 命中，命中不了才退回 campId 升序', () => {
    const units = normalizeBattleStart(rsp())!.units;
    assert.deepEqual(units.map((u) => u.campId), [1, 2], '归一化后按 campId 升序');

    const byRole = splitBattleUnits(units, '20002');
    assert.equal(byRole.mine?.roleId, '20002', 'roleId 命中时以它为准，不看 campId 先后');
    assert.equal(byRole.enemy?.roleId, '10001');

    const fallback = splitBattleUnits(units, undefined);
    assert.equal(fallback.mine?.campId, 1);
    assert.equal(fallback.enemy?.campId, 2);

    // roleId 没命中 → 退回 campId 升序（会 warn，但必须有结果，不能返回 null）
    const unmatched = splitBattleUnits(units, '99999');
    assert.equal(unmatched.mine?.campId, 1);
});

test('叠加到界面数据时只覆盖服务端确实给了的字段', () => {
    const base = { name: '本地对手', avatarIcon: 'img_people', power: 12345, rank: '白银', trophy: 3, artifactName: 'x', artifactIcon: 'icon_faqi', stats: [] };
    // 不传 lookup（老调用点）：段位 / 神器 / 头像一律不动，只覆盖 name / power / trophy。
    const merged = applyUnitToPlayerView(base, normalizeBattleUnit(unit() as any));
    assert.equal(merged.name, '对手甲', '昵称用服务端');
    assert.equal(merged.power, 27574, '战力用服务端');
    assert.equal(merged.avatarIcon, 'img_people', '没有 lookup 就解不出头像资源名，保留本地值而不是留空');
    assert.equal(merged.avatarRoot, undefined, '头像没换，根目录也不能被写上（否则名字/根错配 → 静默留白）');
    assert.equal(merged.rank, '白银');

    // unit 为 null（服务端没给）时原样返回
    assert.equal(applyUnitToPlayerView(base, null), base);
    // name/power 服务端没给 → 保留本地值
    const partial = applyUnitToPlayerView(base, normalizeBattleUnit(unit({ showInfo: show({ name: '', power: 0 }) }) as any));
    assert.equal(partial.name, '本地对手');
    assert.equal(partial.power, 12345);
});

test('段位/神器表 → id 解析器：查得到用表名，查不到给空串（调用方据此保留兜底）', () => {
    const lookup = buildMatchProfileLookup(
        [
            { gradeId: 1001, gradeName: '菜鸟护卫Ⅰ' },
            { gradeId: 1022, gradeName: '王牌护卫' },
            { gradeId: 0, gradeName: '脏数据' },
            { gradeId: 1002 },
        ],
        [{ artifactId: 69001, name: '希瓦的守护' }, { artifactId: 0, name: '' }],
    );
    assert.equal(lookup.gradeName(1001), '菜鸟护卫Ⅰ');
    assert.equal(lookup.gradeName(1022), '王牌护卫');
    assert.equal(lookup.gradeName(9999), '', '表里没有 → 空串（不是 undefined / "0"）');
    assert.equal(lookup.gradeName(0), '', 'id 非法的行不入表');
    assert.equal(lookup.artifactName(69001), '希瓦的守护');
    assert.equal(lookup.artifactName(69002), '');

    // 表缺失（读表失败 / 还没下发）也要能用，不抛
    const empty = buildMatchProfileLookup(null, undefined);
    assert.equal(empty.gradeName(1001), '');
    assert.equal(empty.artifactName(69001), '');
    assert.equal(empty.headArt.artName('70010'), '', '没给 head/icon 两列 → 头像恒空串（老调用点口径）');
});

test('MatchProfileLookup 接上了共用的头像解析器（两层查表本身见 head-art-model.test.ts）', () => {
    const lookup = buildMatchProfileLookup(
        null, null,
        [{ resId: 70002, type: 2, icon: '图标_头像_凯尔萨斯' }],
        [{ key: '图标_头像_凯尔萨斯', path: 'ui://图标/icon_hero_head_40010' }],
    );
    assert.equal(lookup.headArt.artName('70002'), 'icon_hero_head_40010', 'head+icon 两层接上了');
    // 缺表时**恒空串**（老调用点口径：没有头像数据 ≠ 头像错）
    assert.equal(buildMatchProfileLookup(null, undefined).headArt.artName('70010'), '');
});

test('服务端头像覆盖界面：连根目录一起换，同一次刷新不能出现名字/根错配', () => {
    const lookup = buildMatchProfileLookup(
        [{ gradeId: 1001, gradeName: '菜鸟护卫Ⅰ' }],
        [{ artifactId: 69001, name: '希瓦的守护' }],
        [{ resId: 70010, icon: '图标_头像_萨穆罗' }],
        [{ key: '图标_头像_萨穆罗', path: 'ui://图标/icon_hero_head_40018' }],
    );
    const base = {
        name: '本地对手', avatarIcon: 'img_people', power: 12345, rank: '白银', trophy: 3,
        artifactName: '本地神器', artifactIcon: 'icon_faqi', stats: [],
    };
    const withAvatar = applyUnitToPlayerView(
        base,
        normalizeBattleUnit(unit({ showInfo: show({ img: Long.fromString('70010', true) }) }) as any)!,
        lookup,
    );
    assert.equal(withAvatar.avatarIcon, 'icon_hero_head_40018', 'img(70010) 经两层表解出资源名');
    assert.equal(withAvatar.avatarRoot, ArtPaths.HEAD_ART_ROOT, '头像资源名与根目录必须成对换');
    assert.notEqual(withAvatar.avatarRoot, ArtPaths.MATCH_ART_ROOT, '服务端头像不在占位图那个目录里');

    // `img == 0`（平台头像）与「表里没有这个 id」都不该动头像 —— 也不该写 avatarRoot
    for (const img of ['0', '900001']) {
        const kept = applyUnitToPlayerView(
            base,
            normalizeBattleUnit(unit({ showInfo: show({ img: Long.fromString(img, true) }) }) as any)!,
            lookup,
        );
        assert.equal(kept.avatarIcon, 'img_people', `img=${img} 解不出资源名 → 保留占位图`);
        assert.equal(kept.avatarRoot, undefined, `img=${img} 没换头像就不能写根目录`);
    }
});

test('真表 + 磁盘：head 表 20 行都能解出资源名，且图确实导入到了 HEAD_ART_ROOT', () => {
    const read = (name: string): unknown => JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    // `head.json` 是行对象数组（老端那份原样转过来的），`icon.json` 是列式 {k, v}。
    const headRows = read('head') as { resId?: unknown; icon?: unknown }[];
    const iconRaw = read('icon') as { k: string[]; v: unknown[][] };
    assert.ok(Array.isArray(headRows) && headRows.length === 20, 'head 表应是 20 行（T-头像表.xlsx）');
    assert.equal(iconRaw.k[0], 'key');
    const iconRows = iconRaw.v.map((row) => ({ key: row[0], path: row[1] }));

    const lookup = buildMatchProfileLookup(null, null, headRows, iconRows);
    // 目录**从 `ArtPaths.HEAD_ART_ROOT` 取**，不写死字面量：这条链最容易出的错就是
    // 资源被挪了目录而 `HEAD_ART_ROOT` 没跟着改（或反过来），写死字面量就两边都不知道。
    const root = `assets/resources/${ArtPaths.HEAD_ART_ROOT}`;
    const imported = new Set(readdirSync(root));
    const missing: string[] = [];
    for (const row of headRows) {
        const id = String(row.resId);
        const art = lookup.headArt.artName(id);
        assert.ok(art, `head 表 ${id}（${row.icon}）必须能解出资源名`);
        if (!imported.has(`${art}.png`)) missing.push(`${id} → ${art}.png`);
    }
    assert.deepEqual(missing, [], `解出来的每一张都必须已在 ${root} 下（否则就是静默留白）`);
});

test('服务端个人信息参数覆盖界面：段位名 / 段位积分 / 神器名（id 经表解析）', () => {
    const lookup = buildMatchProfileLookup(
        [{ gradeId: 1001, gradeName: '菜鸟护卫Ⅰ' }],
        [{ artifactId: 69001, name: '希瓦的守护' }],
    );
    const base = {
        name: '本地对手', avatarIcon: 'img_people', power: 12345, rank: '白银', trophy: 3,
        artifactName: '本地神器', artifactIcon: 'icon_faqi', stats: [],
    };
    const withServer = normalizeBattleUnit(unit({
        artifactId: 69001,
        showInfo: show({ gradeId: 1001, gradeScore: 120 }),
    }) as any)!;

    const merged = applyUnitToPlayerView(base, withServer, lookup);
    assert.equal(merged.name, '对手甲', '昵称用服务端');
    assert.equal(merged.power, 27574, '战力用服务端');
    assert.equal(merged.rank, '菜鸟护卫Ⅰ', 'gradeId 走 grade 表换成段位名');
    assert.equal(merged.trophy, 120, '段位积分填奖杯位（服务端没有单独的奖杯字段）');
    assert.equal(merged.artifactName, '希瓦的守护', 'artifactId 走 pvpArtifact 表换成神器名');
    assert.equal(merged.avatarIcon, 'img_people', '头像给的是 id 且本工程无对应资源 → 保留本地值');

    // 不传 lookup（老调用点）：行为与以前一致，段位/神器保留本地值
    const withoutLookup = applyUnitToPlayerView(base, withServer);
    assert.equal(withoutLookup.rank, '白银');
    assert.equal(withoutLookup.artifactName, '本地神器');
    assert.equal(withoutLookup.trophy, 120, '段位积分不依赖表，有没有 lookup 都填');

    // 表里没这个 id → 保留本地值，不能把段位清成空串
    const unknown = applyUnitToPlayerView(base, normalizeBattleUnit(unit({
        showInfo: show({ gradeId: 9999 }),
    }) as any)!, lookup);
    assert.equal(unknown.rank, '白银');
});

test('Long 口径：toIdString 走字符串不丢精度，toCount 收敛非法值', () => {
    // 18446744073709551615 超过 Number.MAX_SAFE_INTEGER，走 number 会变成 18446744073709552000
    const max = Long.fromString('18446744073709551615', true);
    assert.equal(toIdString(max), '18446744073709551615');
    assert.equal(toIdString(Long.fromString('1234567890123456789', true)), '1234567890123456789');
    assert.equal(toIdString(123), '123');
    assert.equal(toIdString('abc'), 'abc');
    assert.equal(toIdString(undefined), '');
    assert.equal(toIdString(null), '');
    assert.equal(toIdString({}), '', '普通对象不能因为默认 toString 而变成 "[object Object]"');

    assert.equal(toCount(0), 0);
    assert.equal(toCount('7'), 7);
    assert.equal(toCount(Number.NaN), 0);
    assert.equal(toCount(undefined), 0);
    assert.equal(toCount(Long.fromString('300', false)), 300);

    assert.equal(toPositiveInt(5), 5);
    assert.equal(toPositiveInt(0), null);
    assert.equal(toPositiveInt(-1), null);
    assert.equal(toPositiveInt('3'), 3);
    assert.equal(toPositiveInt(undefined), null);
});

test('withTimeout 永远兑现：超时或 reject 都走 fallback', async () => {
    const never = new Promise<string>(() => { /* 永不兑现 */ });
    assert.equal(await withTimeout(never, 20, () => 'fallback'), 'fallback');

    const rejected = Promise.reject(new Error('boom'));
    assert.equal(await withTimeout(rejected, 1000, () => 'safe'), 'safe');

    // 正常兑现时不能等满超时，也不能被 fallback 覆盖
    assert.equal(await withTimeout(Promise.resolve('real'), 1000, () => 'fallback'), 'real');
});

test('battleType 取值已定：PVP 匹配局 = 1001，且集中一处', () => {
    // 已确认值（2026-09-21）。改它必须同时改这条断言 —— 值变了要让人看见，不能静默漂。
    assert.equal(ZC_BATTLE_TYPE_PVP, 1001);
    const model = readFileSync('assets/script/app/battle/BattleStartModel.ts', 'utf8');
    assert.match(model, /export const ZC_BATTLE_TYPE_PVP/, '取值必须集中一处，否则将来要满工程找字面量');
    // 调用点不许再出现裸字面量（Service 文件头的日志原文里那个 `battleType: 1` 是历史记录，
    // 所以只盯 ProcedureMatching 这个真正的调用点，别把注释也算进来）
    const caller = readFileSync('assets/script/app/procedure/ProcedureMatching.ts', 'utf8');
    assert.match(caller, /startBattle\(ZC_BATTLE_TYPE_PVP\)/, '发请求必须引用常量');
    assert.doesNotMatch(caller, /battleType\s*[:=]\s*\d/, '调用点不要散落字面量');
    // Service 的默认参数同样引用常量
    assert.match(
        readFileSync('assets/script/app/battle/BattleStartService.ts', 'utf8'),
        /battleType: number = ZC_BATTLE_TYPE_PVP/,
    );
});
