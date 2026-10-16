/**
 * 「布阵」面板接入阵型协议（`CmdFormationInfo` / `CmdFormationOp`）与卡池长按拖拽上阵的单测。
 *
 *  只 import **零引擎依赖**的模块：`FormationService`（经 `GameNet` 拉进 `cc`）、
 * `LineupBoardPage` / `LineupBoardCard`（`cc` 组件）在 Node 里 import 就炸，
 * 它们的口径用「读源码 + 断言关键写法」守住 —— 与 `pvp-hero-interface.test.ts` 同一套做法。
 *
 * 被守住的五个曾经容易写错的点：
 *   ① `CmdFormationInfo` 的 `heroId` 是**数字**数组、`pvpCard.id` 是**字符串**，
 *      对齐时必须 `String(heroId)`（同工程 `normalizeCardRow` 的口径）；
 *   ② 「没有后端数据」≠「后端说这一格是空的」：前者三格都用本地卡组，后者必须留空；
 *   ③ 拖拽松手时引擎可能派发的是 `TOUCH_CANCEL`（手指已经离开卡片矩形），
 *      所以「松手上阵」只能挂全局 `input` 监听，不能只听节点上的 `TOUCH_END`；
 *   ④ 阵型请求必须**兜硬超时**：`GameNet.send` 没有按请求的超时，服务端不回包时
 *      请求永远悬着，而它挂在 `loadBoard` 的 `Promise.all` 上 → 整块面板停在 prefab
 *      占位外观（站台空、计数 0、卡池空白），且**离线复现不出来**（离线根本不发请求）；
 *   ⑤ 保存必须带 `select = 1`：卡牌阵容页的八卡读的是**服务端选中阵型**，而切页签那套
 *      独立的选中请求已经没有调用方 → 保存是同步选中状态的唯一时机。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import { LineupBoardPresenter } from '../assets/script/app/card/CardPresenters';
import { normalizeFormations, withTimeout } from '../assets/script/app/card/FormationModel';
import { LineupDraftStore } from '../assets/script/app/card/LineupDraftStore';
import { buildPresetDecks, presetFormationId, resolveSelectedDeck } from '../assets/script/app/card/LineupPresets';

const card = (id: string) => ({ id, name: id, rarity: '绿' }) as any;

test('运行时 protobuf 包含阵型请求、响应与消息号', () => {
    const schema = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
    const root = protobuf.Root.fromJSON(schema);
    const messageId = root.lookupEnum('com.xkhy.tafang.cmd.MessageId');

    assert.equal(messageId.values.CmdFormationInfoRspMsg, 1211220072);
    assert.equal(messageId.values.CmdFormationOpRspMsg, 1506971931);

    // 请求体是空消息：编码出来必须 0 字节（多了字段说明表结构变了）
    const infoReq = root.lookupType('com.xkhy.tafang.cmd.CmdFormationInfoReqMsg');
    assert.equal(infoReq.encode(infoReq.create({})).finish().byteLength, 0);

    const infoRsp = root.lookupType('com.xkhy.tafang.cmd.CmdFormationInfoRspMsg');
    const bytes = infoRsp.encode(infoRsp.create({
        infos: [{ formationId: 2, heroId: [68001, 68003] }],
    })).finish();
    const decoded = infoRsp.decode(bytes) as unknown as {
        infos: Array<{ formationId: number; heroId: number[] }>;
    };
    assert.deepEqual(decoded.infos.map((entry) => [entry.formationId, entry.heroId]), [[2, [68001, 68003]]]);

    const opReq = root.lookupType('com.xkhy.tafang.cmd.CmdFormationOpReqMsg');
    const emptyOp = opReq.decode(opReq.encode(opReq.create({ info: { formationId: 1, heroId: [] } })).finish());
    assert.equal(emptyOp.info.formationId, 1);
    // 「一键下阵」就是把空列表发上去 —— 服务端按 formationId 覆盖，不是增量操作
    assert.equal(emptyOp.info.heroId.length, 0);

    const opRsp = root.lookupType('com.xkhy.tafang.cmd.CmdFormationOpRspMsg');
    const echoed = opRsp.decode(opRsp.encode(opRsp.create({
        info: { formationId: 4, heroId: [68009, 68010] },
    })).finish()) as unknown as { info: { formationId: number; heroId: number[] } };
    assert.deepEqual([echoed.info.formationId, echoed.info.heroId], [4, [68009, 68010]]);
});

test('阵型响应逐条边界校验：非法项丢掉、同 id 去重、按 formationId 升序', () => {
    const result = normalizeFormations([
        { formationId: 3, heroId: [68005, 68005, 0, -1, 68006] },
        { formationId: 1, heroId: [68001] },
        { formationId: 3, heroId: [68009] }, // 同一个 formationId 后出现者覆盖
        { formationId: 0, heroId: [68002] }, // id 不是正整数 → 整条丢掉
        null,
        { formationId: 2 }, // heroId 缺省 → 当成空列表，不是丢弃
    ] as any);

    assert.deepEqual(result.map((entry) => [entry.formationId, entry.heroIds]), [
        [1, [68001]],
        [2, []],
        [3, [68009]],
    ]);
});

test('页签下标与 formationId 的口径只有一处定义', () => {
    assert.equal(presetFormationId(0), 1);
    assert.equal(presetFormationId(3), 4);
    assert.equal(presetFormationId(-2), 1);

    const store = new LineupDraftStore([card('1')], 8, 4, 0);
    assert.equal(store.formationIdOf(2), 3);
    assert.equal(store.selectedFormationId, 1);
    store.selectPreset(3);
    assert.equal(store.selectedFormationId, 4);
});

test('LineupDraftStore 各方案用各自的初始卡组，互不串扰', () => {
    const store = new LineupDraftStore(
        [card('1'), card('2')],
        8,
        3,
        0,
        [[card('1')], [card('2'), card('3')], []],
    );

    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['1']);
    store.selectPreset(1);
    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['2', '3']);
    store.selectPreset(2);
    assert.deepEqual(store.snapshot().cards, []);

    // 改方案 0 不能影响方案 1
    store.selectPreset(0);
    store.put(card('9'), 0);
    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['9', '1']);
    store.selectPreset(1);
    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['2', '3']);
});

test('buildPresetDecks：没有后端数据用本地卡组，有数据就按 formationId 逐格取', () => {
    const deck = [card('68001'), card('68002')];
    const pool = [card('68003')];

    const local = buildPresetDecks({ deck, pool, formations: null }, 3);
    assert.equal(local.length, 3);
    assert.ok(local.every((cards) => cards === deck), '没有后端数据时三格都用本地卡组');

    const server = buildPresetDecks({
        deck,
        pool,
        formations: [
            { formationId: 1, heroIds: [68002, 68001] },
            { formationId: 3, heroIds: [68003] },
        ],
    }, 3);
    assert.deepEqual(server[0].map((entry) => entry.id), ['68002', '68001']);
    // 服务端没回 formationId 2：这一格就是空的，不许拿别人的卡去填
    assert.deepEqual(server[1], []);
    assert.deepEqual(server[2].map((entry) => entry.id), ['68003']);

    // 本地卡表里没有的 heroId 跳过（告警），但已有的照常保留
    const partial = buildPresetDecks({
        deck,
        pool,
        formations: [{ formationId: 1, heroIds: [68001, 999999] }],
    }, 1);
    assert.deepEqual(partial[0].map((entry) => entry.id), ['68001']);

    // 页签数量下限是 1，不能因为 prefab 异常就返回空数组
    assert.equal(buildPresetDecks({ deck, pool, formations: null }, 0).length, 1);
});

test('resolveSelectedDeck：只认选中那条阵型，「没有数据」与「选中的是空阵型」分得很清', () => {
    const deck = [card('68001'), card('68002')];
    const pool = [card('68003')];

    // 没有后端数据 → null（调用方退回本地卡组）
    assert.equal(resolveSelectedDeck({ deck, pool, formations: null }), null);
    // 有数据但服务端还没记过选中 → 同样是 null
    assert.equal(resolveSelectedDeck({
        deck,
        pool,
        formations: [
            { formationId: 1, heroIds: [68001], selected: false },
            { formationId: 2, heroIds: [68002], selected: false },
        ],
    }), null, '一条都没选中 = 没有可用的阵型数据');

    // 选中那条按 heroIds 顺序取卡；别的阵型不参与
    const picked = resolveSelectedDeck({
        deck,
        pool,
        formations: [
            { formationId: 1, heroIds: [68001], selected: false },
            { formationId: 3, heroIds: [68003, 68002], selected: true },
        ],
    });
    assert.deepEqual(picked?.map((entry) => entry.id), ['68003', '68002']);

    //  ★ 选中的是空阵型 → **空数组**，不是 null。
    //  玩家一键下阵后保存就是这个状态，页面该显示空站台；并进 null 会退回本地八卡，
    //  看起来像「下阵没生效」。
    assert.deepEqual(
        resolveSelectedDeck({ deck, pool, formations: [{ formationId: 1, heroIds: [], selected: true }] }),
        [],
        '选中的阵型是空的 = 有效值（空数组），不能并进 null',
    );

    // 本地卡表里没有的 heroId 跳过（告警），已有的照常保留
    const partial = resolveSelectedDeck({
        deck,
        pool,
        formations: [{ formationId: 1, heroIds: [68001, 999999], selected: true }],
    });
    assert.deepEqual(partial?.map((entry) => entry.id), ['68001']);
});

test('保存阵型即「选中」：Op 请求必须带 select = 1', () => {
    //  卡牌阵容页的八卡读的是服务端「选中阵型」（`resolveSelectedDeck`），
    //  而切页签那套独立的 `CmdFormationSelectReqMsg` 已经没有调用方了
    //  （`LineupBoardPage.selectPreset` 里那段被注释掉），所以保存是同步选中状态的唯一时机。
    //  改回 0 的话：卡存住了、出阵阵型没变 → 玩家保存完关掉面板，界面还是旧阵容。
    const service = readFileSync('assets/script/app/card/FormationService.ts', 'utf8');
    assert.match(service, /info: \{ formationId, heroId: heroIds, select: 1 \}/);
    assert.doesNotMatch(service, /select: 0/);
});

test('LineupBoardPresenter：刷新时按阵型组各页签草稿，提交走 repository.saveFormation', async () => {
    const deck = [card('68001')];
    const calls: Array<[number, number[]]> = [];
    const repository = {
        loadBoard: async () => ({
            deck,
            pool: [card('68002')],
            heroLevels: new Map<string, number>(),
            heroLevelCaps: new Map<string, number>(),
            formations: [{ formationId: 2, heroIds: [68002] }],
        }),
        saveFormation: async (formationId: number, heroIds: readonly number[]) => {
            calls.push([formationId, [...heroIds]]);
            return { kind: 'success', formation: { formationId, heroIds: [...heroIds] } };
        },
    } as any;

    const presenter = new LineupBoardPresenter(repository);
    let presented: any = null;
    await presenter.refresh(true, 2, 0, {
        isAlive: () => true,
        presentBoard: (data) => { presented = data; },
    });

    // 页签 0 → formationId 1，服务端没回 → 空；页签 1 → formationId 2 → 一张卡
    assert.deepEqual(presented.draft.snapshot().cards.map((entry: any) => entry.id), []);
    presented.draft.selectPreset(1);
    assert.deepEqual(presented.draft.snapshot().cards.map((entry: any) => entry.id), ['68002']);

    const result = await presenter.submit(2, [68002]);
    assert.equal(result.kind, 'success');
    assert.deepEqual(calls, [[2, [68002]]]);
});

test('协议名、Repository 接线与两条引擎约束在源码里被写死（改了会回归）', () => {
    const request = readFileSync('assets/script/app/generated/requestMsg/RequestFormationMsg.ts', 'utf8');
    assert.match(request, /return ['"]CmdFormationInfoReqMsg['"]/);
    assert.match(request, /return ['"]CmdFormationOpReqMsg['"]/);

    const service = readFileSync('assets/script/app/card/FormationService.ts', 'utf8');
    assert.match(service, /new RequestFormationInfo\(/);
    assert.match(service, /new RequestFormationOp\(/);
    assert.match(service, /applyFormation\(formation\)/);

    const repository = readFileSync('assets/script/app/card/CardRepository.ts', 'utf8');
    assert.match(repository, /fetchFormations\(\)/);
    assert.match(repository, /formations \};/);

    const board = readFileSync('assets/script/app/card/LineupBoardPage.ts', 'utf8');
    assert.match(board, /implements IBoardCardDragHost/);
    assert.match(board, /this\.presenter\.submit\(formationId, heroIds, this\)/);
    assert.match(board, /draft\.formationIdOf\(this\.presetIndex\)/);
    // 克隆体必须在挂进场景之前禁用，否则它自己会变成可点/可拖的目标
    assert.match(board, /view\.enabled = false/);
    // 克隆体要压在等一切之上：挂到弹窗根节点并置为最后一个子节点
    assert.match(board, /ghost\.setSiblingIndex\(Math\.max\(0, this\.node\.children\.length - 1\)\)/);

    const cardView = readFileSync('assets/script/app/card/LineupBoardCard.ts', 'utf8');
    // 松手可能派发成 TOUCH_CANCEL（手指早已离开卡片矩形）→ 收尾必须挂全局监听
    assert.match(cardView, /input\.on\(Input\.EventType\.TOUCH_END/);
    assert.match(cardView, /input\.on\(Input\.EventType\.TOUCH_CANCEL/);
    // 不阻断冒泡的话祖先节点 PoolList 上的 VirtualScrollView 会跟着手指一起滚
    assert.match(cardView, /event\.propagationStopped = true/);

    // 阵型请求必须兜硬超时：`GameNet.send` 没有按请求的超时，服务端不回包就永远悬着，
    // 而它挂在 `loadBoard` 的 `Promise.all` 上 → 整块面板停在 prefab 占位外观（真机踩过）。
    assert.match(service, /withTimeout\(inflight, FORMATION_REQUEST_TIMEOUT_MS/);
    // 保存同理：不兜的话按钮永远停在「保存中」，再也点不动。
    assert.match(service, /withTimeout\(\s*sendFormationOp\(/);
    assert.match(service, /FORMATION_SAVE_TIMEOUT_MS/);
});

test('withTimeout：服务端不回包时用兜底值兑现，绝不让数据加载悬死', async () => {
    // 这是「真机整屏空白」的根因：永不兑现的请求。
    const never = new Promise<readonly string[] | null>(() => { /* 永不 settle */ });

    const value = await withTimeout(never, 20, () => null);
    assert.equal(value, null, '超时后必须用 fallback 顶上');

    // 正常回包时不该被超时值覆盖（这里 fallback 会返回一个一眼能认出来的假值）。
    const fast = await withTimeout(Promise.resolve(['ok']), 5_000, () => ['TIMEOUT']);
    assert.deepEqual(fast, ['ok']);

    // 原 Promise reject 也要落到 fallback，而不是把异常抛给调用方。
    const rejected = await withTimeout(Promise.reject(new Error('boom')), 5_000, () => ['FALLBACK']);
    assert.deepEqual(rejected, ['FALLBACK']);

    // 极端参数（负数）不该抛，按 0ms 立即兑现。
    const clamped = await withTimeout(never, -1, () => ['NOW']);
    assert.deepEqual(clamped, ['NOW']);
});
