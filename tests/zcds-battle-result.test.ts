/**
 * 章节战斗结算广播（`CmdBattleResultBroMsg` 1002 → `CmdChapterBattleResultInfo`）的守卫。
 *
 * ## 盯住哪四类东西（错了会不会报错）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `BattleResultTable` 的纯口径（battleType 认不认、`cmdGoods`/`treasureId` 归一化） | 静默 —— 广播被当成别的战斗类型丢掉 / 奖励格全空 |
 * | B | `BattleResultService` 的订阅与等待器（到货 / 超时 / 重复等待 / 解码失败 / 空 bytes） | 静默 —— 结算页永远没有奖励，或结算页被一个永不兑现的 Promise **卡死** |
 * | C | `ZCGame` 的接线（进对局挂订阅、章节局等广播再弹） | 静默 —— 订阅晚一步 ⇒ 丢包；或根本没人调 |
 * | D | 换算链是否**真复用**（结算页与「获得奖励」弹窗共用 `RewardFrames`） | 两份换算各自漂移，改一处漏一处 |
 *
 * ## 为什么能直接 `import`
 *
 * `BattleResultTable` 的 import 链上只有类型化的 `cc`（`HeadArtModel` 是 `import type`）
 * ⇒ Node 可直接 import；`BattleResultService` 带 `GameNet` / `ProtoMgr`，用 `load()` 桩起来。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { toCount } from '../assets/script/app/net/RequestGuard';
import * as BattleResultTable from '../assets/script/app/battle/BattleResultTable';
import { BATTLE_RESULT_WAIT_MS, chapterBattleResultOf, isChapterBattleResult } from '../assets/script/app/battle/BattleResultTable';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_BATTLE_TYPE_PVP } from '../assets/script/app/battle/BattleStartModel';
// 真 protobuf 静态模块（与运行时同一个）：用**真字节**验一遍，不靠手搓对象。
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';

const SERVICE = 'assets/script/app/battle/BattleResultService.ts';

/** 运行时那个 proto 包（`ProtoCoder.protoPackage` 同款路径）。 */
const cmd = (protobufRoot as any).com.xkhy.tafang.cmd;

/** 编一条**真** `CmdChapterBattleResultInfo` 字节（`number` 是 string 字段，别传数字）。 */
function encodeChapterInfo(goods: ReadonlyArray<{ resId: number; number: string }>, treasureId: number): Uint8Array {
    const rows = goods.map((one) => cmd.CmdGoods.create(one));
    return cmd.CmdChapterBattleResultInfo.encode(
        cmd.CmdChapterBattleResultInfo.create({ cmdGoods: rows, treasureId }),
    ).finish();
}

/** 真解码（`ProtoMgr.decodeDataByName` 走的就是这一步）。 */
const decodeChapterInfo = (bytes: Uint8Array): unknown =>
    cmd.CmdChapterBattleResultInfo.decode(bytes);

/** 与工程其它用例同款的「转译 + 新 realm 执行」加载器；额外补 `setTimeout`（服务里有超时定时器）。 */
function load(file: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        setTimeout,
        clearTimeout,
        require: (name: string) => {
            assert.ok(name in dependencies, `未桩的依赖：${name}`);
            return dependencies[name];
        },
    };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, context);
    return context.exports;
}

/** 装一个 Service，返回它 + 拿到广播回调的句柄。 */
function serviceFixture(decoder?: (bytes: unknown, name: string) => unknown) {
    const added: Array<{ name: string; fire: (msg: unknown) => void }> = [];
    let decodeCalls = 0;
    let decodeResult: unknown = null;
    let decodeThrows = false;
    const service = load(SERVICE, {
        '../../framework/net/ProtoMgr': {
            ProtoMgr: { get: () => ({ decodeDataByName: (name: string, bytes: unknown) => {
                decodeCalls += 1;
                if (decoder) return decoder(bytes, name);
                if (decodeThrows) throw new Error('decode 炸了');
                return decodeResult;
            } }) },
        },
        '../net/GameNet': {
            GameNet: { instance: { addEvent: (name: string, _caller: unknown, fn: (msg: unknown) => void) => {
                added.push({ name, fire: fn });
            } } },
        },
        '../net/RequestGuard': { toCount },
        './BattleResultTable': BattleResultTable,
        './BattleStartModel': { ZC_BATTLE_TYPE_CHAPTER },
    });
    return {
        BattleResultService: service.BattleResultService,
        added,
        countDecode: () => decodeCalls,
        setDecode: (value: unknown) => { decodeResult = value; decodeThrows = false; },
        setDecodeThrows: () => { decodeThrows = true; },
    };
}

/** 造一条 1002 广播。 */
const chapterBroadcast = (bytes: Uint8Array) => ({ battleType: 1002, code: 1, dataBytes: bytes });

// ============================================================
// A. 纯口径
// ============================================================

test('A1 battleType 只认 1002：1001（匹配局）与脏值一律不算章节结算', () => {
    assert.equal(ZC_BATTLE_TYPE_CHAPTER, 1002);
    assert.equal(ZC_BATTLE_TYPE_PVP, 1001);
    assert.equal(isChapterBattleResult(1002), true);
    assert.equal(isChapterBattleResult(1001), false, '匹配局的结算本轮没接，必须被挡掉');
    assert.equal(isChapterBattleResult(0), false);
    assert.equal(isChapterBattleResult(Number.NaN), false);
    assert.equal(isChapterBattleResult(undefined as unknown as number), false);
});

test('A2 chapterBattleResultOf：取 cmdGoods 与 treasureId，非法行丢掉而不是抛错', () => {
    const result = chapterBattleResultOf({
        cmdGoods: [
            { resId: 18003, number: 10 },
            { resId: '18005', number: '2' },   // 字符串数字（uint64 常见形态）
            { resId: 0, number: 1 },           // 非法：resId<=0 ⇒ 丢
            null,                              // 非法：非对象 ⇒ 丢
        ],
        treasureId: 19001,
    });
    assert.equal(result.goods.length, 2, '只留两条合法奖励');
    assert.equal(result.goods[0].resId, 18003);
    assert.equal(result.goods[0].number, 10);
    assert.equal(result.goods[1].resId, 18005);
    assert.equal(result.goods[1].number, 2);
    assert.equal(result.treasureId, 19001);
});

test('A3 chapterBattleResultOf：形状不对返回「空奖励」而不是 null（上层只有一支）', () => {
    for (const raw of [null, undefined, 0, 'x', []]) {
        const result = chapterBattleResultOf(raw);
        assert.equal(result.goods.length, 0);
        assert.equal(result.treasureId, 0);
    }
    // 字段缺省 ⇒ 空奖励 + 宝箱 0（`optional treasureId` 服务端可以不填）
    const bare = chapterBattleResultOf({});
    assert.equal(bare.goods.length, 0);
    assert.equal(bare.treasureId, 0);
});

test('A4 等待超时是正数常量（结算页拿它兜底，0 会让页面永远没奖励）', () => {
    assert.ok(BATTLE_RESULT_WAIT_MS > 0);
    assert.ok(Number.isFinite(BATTLE_RESULT_WAIT_MS));
});

test('A5 真 protobuf 字节（resId 是 Long、number 是 string）→ 归一化正确', () => {
    const bytes = encodeChapterInfo([{ resId: 18003, number: '10' }, { resId: 18005, number: '2' }], 19001);
    assert.ok(bytes.length > 0);
    const decoded = decodeChapterInfo(bytes);
    // 先钉住「服务端原型」本身：resId 解出来是 Long 对象（这正是 toCount 存在的理由）
    assert.equal(typeof (decoded as any).cmdGoods[0].resId, 'object');
    assert.equal(typeof (decoded as any).cmdGoods[0].number, 'string');

    const result = chapterBattleResultOf(decoded);
    assert.equal(result.goods.length, 2);
    assert.equal(result.goods[0].resId, 18003, 'Long → number');
    assert.equal(result.goods[0].number, 10, 'string → number');
    assert.equal(result.goods[1].resId, 18005);
    assert.equal(result.goods[1].number, 2);
    assert.equal(result.treasureId, 19001);
    // 空奖励 + 宝箱 0 也能编码/解码（服务端没奖励时可发空包）
    const bare = chapterBattleResultOf(decodeChapterInfo(encodeChapterInfo([], 0)));
    assert.equal(bare.goods.length, 0);
    assert.equal(bare.treasureId, 0);
});

// ============================================================
// B. 订阅与等待器
// ============================================================

test('B1 订阅幂等：重复 ensureListening 只挂一条监听', () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    f.BattleResultService.ensureListening();
    f.BattleResultService.ensureListening();
    assert.equal(f.added.length, 1, '叠监听会让同一个包被处理多次');
    assert.equal(f.added[0].name, 'CmdBattleResultBroMsg');
});

test('B2 广播到达 ⇒ 等待器拿到解码后的结果', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    f.setDecode({ cmdGoods: [{ resId: 18003, number: 10 }], treasureId: 19001 });
    const waiting = f.BattleResultService.waitForChapterResult(1000);
    f.added[0].fire(chapterBroadcast(new Uint8Array([1, 2, 3])));
    const result = await waiting;
    assert.ok(result, '必须拿到结果，不能等到超时');
    assert.equal(result.goods.length, 1);
    assert.equal(result.goods[0].resId, 18003);
    assert.equal(result.treasureId, 19001);
    assert.equal(f.countDecode(), 1, 'dataBytes 必须真解一次');
});

test('B3 非 1002 的广播被忽略（不改现有行为，也不叫醒等待器）', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    f.setDecode({ cmdGoods: [{ resId: 18003, number: 1 }], treasureId: 0 });
    const waiting = f.BattleResultService.waitForChapterResult(30);
    f.added[0].fire({ battleType: 1001, code: 1, dataBytes: new Uint8Array([9]) });
    assert.equal(await waiting, null, '1002 之外的广播不该叫醒它');
    assert.equal(f.countDecode(), 0, '别的类型连解都不该解');
});

test('B4 超时兑现 null（结算页照弹，不能被卡死）', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const result = await f.BattleResultService.waitForChapterResult(20);
    assert.equal(result, null);
});

test('B5 重复等待：旧的立刻按「没等到」兑现，不悬着', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const first = f.BattleResultService.waitForChapterResult(1000);
    const second = f.BattleResultService.waitForChapterResult(1000);
    assert.equal(await first, null, '上一轮等待器必须被兑现，否则调用方 await 永悬');
    f.setDecode({ cmdGoods: [], treasureId: 0 });
    f.added[0].fire(chapterBroadcast(new Uint8Array([1])));
    assert.ok(await second);
});

test('B6 dataBytes 空 / 解码抛错 ⇒ 空结果（广播到了就别再白等一个超时）', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const empty = f.BattleResultService.waitForChapterResult(1000);
    f.added[0].fire(chapterBroadcast(new Uint8Array([])));
    const emptyResult = await empty;
    assert.ok(emptyResult, '空 bytes 也算「到了」');
    assert.equal(emptyResult.goods.length, 0);
    assert.equal(f.countDecode(), 0, '空 bytes 不必去解');

    f.setDecodeThrows();
    const broken = f.BattleResultService.waitForChapterResult(1000);
    f.added[0].fire(chapterBroadcast(new Uint8Array([7])));
    const brokenResult = await broken;
    assert.ok(brokenResult, '解码失败也要兑现（不能 reject / 不能悬着）');
    assert.equal(brokenResult.goods.length, 0);
});

test('B7 没人等的时候广播不残留（不许被下一局吃掉）', () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    f.setDecode({ cmdGoods: [{ resId: 18003, number: 99 }], treasureId: 7 });
    f.added[0].fire(chapterBroadcast(new Uint8Array([1])));
    // 立刻开始等：不该拿到「上一局那一条」（本服务刻意不缓存）
    return f.BattleResultService.waitForChapterResult(20).then((result: unknown) => {
        assert.equal(result, null, '不缓存历史广播，否则连开两局会静默串数据');
    });
});

test('B8 🔴 真字节端到端：广播 → 真解码 → 奖励（服务侧不靠手搓对象）', async () => {
    const f = serviceFixture(decodeChapterInfo);   // ← 用真 protobuf 解码，不是桩
    f.BattleResultService.ensureListening();
    const waiting = f.BattleResultService.waitForChapterResult(1000);
    f.added[0].fire(chapterBroadcast(encodeChapterInfo(
        [{ resId: 18003, number: '10' }, { resId: 18005, number: '2' }, { resId: 18007, number: '1' }],
        19001,
    )));
    const result = await waiting;
    assert.ok(result, '真字节必须能走通');
    assert.equal(result.goods.length, 3);
    assert.equal(result.goods.map((g: any) => g.resId).join(','), '18003,18005,18007');
    assert.equal(result.goods.map((g: any) => g.number).join(','), '10,2,1');
    assert.equal(result.treasureId, 19001);
    assert.equal(f.countDecode(), 1);
});

test('B9 章节结算广播保留服务端胜负码', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const waiting = f.BattleResultService.waitForChapterResult(1000);
    f.added[0].fire({ battleType: 1002, code: 2, dataBytes: new Uint8Array([]) });
    assert.equal((await waiting)?.code, 2);
});

test('B10 非法胜负码不能确认本地领地胜利', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const waiting = f.BattleResultService.waitForChapterResult(20);
    f.added[0].fire({ battleType: 1002, code: 0, dataBytes: new Uint8Array([]) });
    assert.equal(await waiting, null);
});

// ============================================================
// C. ZCGame 接线（源码文本）
// ============================================================

const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const compositionSource = readFileSync('assets/script/app/bootstrap/battle/BattleComposition.ts', 'utf8');
const runtimeSource = readFileSync('assets/script/app/zcds/application/ZCBattleRuntimeController.ts', 'utf8');
const settlementSource = readFileSync('assets/script/app/zcds/application/ZCBattleSettlementController.ts', 'utf8');
const pageSource = readFileSync('assets/script/app/zcds/ui/ZCSettlementPage.ts', 'utf8');

test('C1 组合层在运行期启动前订阅结果广播', () => {
    const listening = compositionSource.indexOf('BattleResultService.ensureListening()');
    const runtime = compositionSource.indexOf('new ZCBattleRuntimeController(');
    assert.ok(listening >= 0 && runtime > listening);
    assert.doesNotMatch(gameSource, /BattleResultService|finishBattle/);
});

test('C2 结算等待和奖励解析位于控制器与组合层，匹配局不等待', () => {
    assert.match(runtimeSource, /battleType: entry\.battleType \?\? entry\.slgBattleType \?\? \(entry\.pveContext \? ZC_BATTLE_TYPE_CHAPTER : null\)/);
    assert.match(settlementSource, /request\.battleType === null \? null : this\.services\.results\.waitResult/);
    assert.match(compositionSource, /resolveCmdGoodsFrames\(result\.goods, resources\)/);
    assert.match(compositionSource, /resId: reward\.resId, amount: reward\.number/);
    assert.ok(settlementSource.indexOf('await pending') < settlementSource.indexOf('await this.open()'));
});

/**
 * C7 —— 结算等广播认的是「入口声明」的 battleType，不是从 pve 猜出来的。
 *
 * 宝箱栏「开始战斗」走匹配（`battleType = 1002` + 子类型 2），既没有 `pve` 也不是 SLG；
 * 原来 `entry.slgBattleType ?? (pveContext ? 1002 : null)` 在这一路恒为 null
 * ⇒ 不调 `waitResult` ⇒ 结算页奖励区全空，**日志里一条错都没有**。
 * 所以三处必须同时成立：匹配组合层透传 → builder 收敛成一个字段 → 运行时直接用它。
 */
test('C7 匹配入口（宝箱战斗）的 battleType 必须一路透传到结算', () => {
    const matchingSource = readFileSync('assets/script/app/bootstrap/matching/MatchingComposition.ts', 'utf8');
    const builderSource = readFileSync('assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', 'utf8');
    const entrySource = readFileSync('assets/script/app/zcds/application/ZCGameEntry.ts', 'utf8');
    assert.match(matchingSource, /params: \{ pve: params\?\.pve, selfRoleId: identity\?\.roleId, battleType: params\?\.battleType \}/,
        '匹配组合层丢了这个字段 ⇒ 宝箱战斗结算无奖励');
    assert.match(builderSource, /battleType: entry\?\.battleType \?\? entry\?\.slgBattleType \?\? null/);
    assert.match(entrySource, /readonly battleType\?: number \| null;/, 'IZCGameEntry 要带上收敛后的 battleType');
    assert.match(entrySource, /battleType\?: number;/, 'ZCGameEntryParams 要能接收入口的协议 battleType');
});

test('C3 换算链真复用：结算页与奖励弹窗共用一份 RewardFrames', () => {
    const frames = readFileSync('assets/script/app/showReward/RewardFrames.ts', 'utf8');
    assert.match(frames, /export async function resolveCmdGoodsFrames/);
    assert.match(frames, /rewardEntryOf\(one, tables\.items, tables\.resources\)/);
    assert.match(frames, /const suffix = qualityFrameSuffixOf\(entry\.quality\)/);
    assert.match(frames, /loadQualityFrameArt\(suffix\)/);
    assert.match(frames, /loadControllerRewardFrame\(resources, idFramePathOf\(qualityFrameArtPath\(suffix\)\)\)/);
    // 「获得奖励」弹窗改走共用件：不许再自己 getRefAllAsync('item')
    const rewardPage = readFileSync('assets/script/app/showReward/ShowRewardPage.ts', 'utf8');
    assert.doesNotMatch(rewardPage, /getRefAllAsync\('item'\)/, '两处各自拉表 = 两份换算迟早漂移');
    assert.match(rewardPage, /loadRewardFrames\(sorted\)/);
    assert.match(rewardPage, /loadRewardGoodsTables\(\)/);
});

test('C4 结算页不许自己再拉奖励表 / 解析 CmdGoods（数据由 ZCGame 注入）', () => {
    assert.doesNotMatch(pageSource, /getRefAllAsync|parseCmdGoodsList|CmdGoods/,
        '结算页只吃 ZCGame 注入的 IZCSettlementReward[]');
    assert.match(pageSource, /readonly rewards\?: readonly IZCSettlementReward\[\]/);
    // ★ 奖励格统一走公共 `ui/common/RewardItem.prefab`（`RewardItemView` 自己解析图标/品质框/数量）
    assert.match(pageSource, /import \{ RewardItemView, type IRewardItemData \} from '\.\.\/\.\.\/common\/RewardItemView'/);
    assert.doesNotMatch(pageSource, /GoodsBox/, '结算页不再自带奖励格实现');
});

test('C5 先等待再完成上报，章节局与撤退均不跳过上报', () => {
    const wait = settlementSource.indexOf('this.services.results.waitResult(');
    assert.ok(wait >= 0 && wait < settlementSource.indexOf('this.services.results.finish('));
    assert.match(compositionSource, /request\.localVictory \? BATTLE_RESULT_WIN : BATTLE_RESULT_LOSE/);
    assert.doesNotMatch(settlementSource, /if \(.*pve.*\).*return/);
});

test('SLG 两种结果按对应协议解码：1003 奖励，1004 战功与奖励，其他类型不能唤醒等待器', async () => {
    for (const [battleType, messageName] of [[1003, 'CmdSlgMonsterBattleResultInfo'], [1004, 'CmdSlgCampBattleResultInfo']] as const) {
        const decodedNames: string[] = [];
        const f = serviceFixture((bytes, name) => {
            decodedNames.push(name);
            return cmd[name].decode(bytes);
        });
        f.BattleResultService.ensureListening();
        const waiting = f.BattleResultService.waitForBattleResult(battleType, 1000);
        f.added[0].fire({ battleType: battleType === 1003 ? 1004 : 1003, code: 1, dataBytes: new Uint8Array([1]) });
        assert.equal(f.countDecode(), 0);
        const bytes = cmd[messageName].encode(cmd[messageName].create({
            cmdGoods: [{ resId: 18003, number: '7' }], warScore: 1234,
        })).finish();
        f.added[0].fire({ battleType, code: 2, dataBytes: bytes });
        const result = await waiting;
        assert.equal(result.code, 2);
        assert.equal(result.goods[0].resId, 18003);
        assert.equal(result.goods[0].number, 7);
        assert.equal(result.treasureId, 0);
        assert.equal(result.warScore, battleType === 1004 ? 1234 : undefined);
        assert.deepEqual(decodedNames, [messageName]);
    }
});

test('SLG 无奖励/零战功、超时、重复等待与取消不会串进下一场章节结算', async () => {
    const f = serviceFixture();
    f.BattleResultService.ensureListening();
    const first = f.BattleResultService.waitForBattleResult(1004, 1000);
    const second = f.BattleResultService.waitForBattleResult(1003, 20);
    assert.equal(await first, null);
    assert.equal(await second, null);
    const empty = f.BattleResultService.waitForBattleResult(1004, 1000);
    f.added[0].fire({ battleType: 1004, code: 1, dataBytes: new Uint8Array() });
    assert.equal((await empty).warScore, undefined, '未下发战功时保持未知，不补造 0');
    f.setDecode({ warScore: 0, cmdGoods: [] });
    const zero = f.BattleResultService.waitForBattleResult(1004, 1000);
    f.added[0].fire({ battleType: 1004, code: 1, dataBytes: new Uint8Array([1]) });
    assert.equal((await zero).warScore, 0);
    const chapter = f.BattleResultService.waitForChapterResult(20);
    f.added[0].fire({ battleType: 1004, code: 1, dataBytes: new Uint8Array([1]) });
    assert.equal(await chapter, null);
});

test('据点结算真实字节未携带 optional warScore 时，不把 protobuf 原型默认零当成已下发', async () => {
    const f = serviceFixture((bytes, name) => cmd[name].decode(bytes));
    f.BattleResultService.ensureListening();
    const waiting = f.BattleResultService.waitForBattleResult(1004, 1000);
    const bytes = cmd.CmdSlgCampBattleResultInfo.encode(cmd.CmdSlgCampBattleResultInfo.create({
        cmdGoods: [{ resId: 18003, number: '1' }],
    })).finish();
    f.added[0].fire({ battleType: 1004, code: 1, dataBytes: bytes });
    const result = await waiting;
    assert.equal(result.goods.length, 1);
    assert.equal(result.warScore, undefined);
});

test('C6 仅服务端结果驱动领地回写，退出后不消费迟到结果', () => {
    assert.match(settlementSource, /if \(result && this\.host\.hasPveContext\)/);
    assert.match(settlementSource, /emit\(ZC_BATTLE_EVENTS\.PVE_RESULT, \{ owner: this\.host\.owner, victory: result\.code === 1 \}\)/);
    const guard = settlementSource.indexOf('if (this.isDisposed) return;');
    assert.ok(guard >= 0 && guard < settlementSource.indexOf('emit(ZC_BATTLE_EVENTS.PVE_RESULT'));
});

test('结算等待按真实 caller 取消，旧局取消不解除新局等待', async () => {
    const { BattleResultService: service } = serviceFixture();
    const oldOwner = {}, newOwner = {};
    const old = service.waitForBattleResult(1002, 10000, oldOwner);
    const current = service.waitForBattleResult(1002, 10000, newOwner);
    assert.equal(await old, null);
    let resolved = false; void current.then(() => { resolved = true; });
    service.cancelWait(oldOwner); await Promise.resolve();
    assert.equal(resolved, false);
    service.cancelWait(newOwner); assert.equal(await current, null);
});
