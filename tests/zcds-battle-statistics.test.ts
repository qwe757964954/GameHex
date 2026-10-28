/**
 * 战斗统计上报（`CmdBattleStatisticsInfo`）的接线单测。
 *
 * ## 为什么单独一份
 *
 * 这套东西**错了不会报错**：字段是 `required uint32` / `repeated string`，随便填都能编出字节，
 * 服务端收到也照收 —— 只是统计对不上（比如把伤害记成"波次数"、或全归到 0 号单元）。
 * 所以这里钉三件事：
 *   ① **协议口径**（r862 服务端补的注释）：`eventType` 1=怪物波次 / 2=伤害统计，
 *      伤害统计的 kv key 固定 `harm`，`kv` 是 `[k, v]` 扁平**字符串**数组；
 *   ② **真能编码**：用真 proto json 走一遍 `CmdFinishBattleReqMsg` 编码 → 解码，
 *      证明载荷不会被 protobufjs 拒（数字塞进 `repeated string` 就是这一步炸的）；
 *   ③ **归属正确**：`unitId` 必须来自服务端单元 id（`buildSeatUnitIds`），
 *      且席位分配与排行榜（`buildSeatProfiles`）**逐席一致**。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import {
    ZC_BATTLE_STAT_DAMAGE_KEY,
    ZC_BATTLE_STAT_EVENT_TYPE,
    buildDamageStatistics,
    normalizeStatHarm,
    normalizeStatUnitId,
} from '../assets/script/app/battle/BattleStatisticsModel';
import { buildSeatProfiles, buildSeatUnitIds } from '../assets/script/app/zcds/model/ZCRankBoard';

const CMD = 'com.xkhy.tafang.cmd';

function loadRoot(): protobuf.Root {
    const schema = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
    return protobuf.Root.fromJSON(schema);
}

const root = loadRoot();

/** 剥掉注释再做源码形状断言（注释里正大光明写着"不要这么写"）。 */
function codeOf(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
}

// ============================================================================
// ① 协议口径
// ============================================================================

test('★协议：eventType 1=怪物波次 / 2=伤害统计，伤害 kv 的 key 固定 harm', () => {
    assert.equal(ZC_BATTLE_STAT_EVENT_TYPE.Wave, 1);
    assert.equal(ZC_BATTLE_STAT_EVENT_TYPE.Damage, 2, '伤害统计必须是 2 —— 1 是塔防波次');
    assert.equal(ZC_BATTLE_STAT_DAMAGE_KEY, 'harm');
});

test('协议真源：proto 注释仍写着这两条口径（服务端改口时这里先红）', () => {
    const proto = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    assert.match(proto, /事件类型1,\s*怪物波次/, 'eventType=1 的语义被改了？先对齐服务端');
    assert.match(proto, /事件类型2,\s*伤害统计/, 'eventType=2 的语义被改了？先对齐服务端');
    assert.match(proto, /k\s*固定为\s*harm/, '伤害统计的 kv key 已不是 harm');
});

test('运行时 protobuf 里 CmdBattleStatisticsInfo 字段号/类型与 proto 一致', () => {
    const stat = root.lookupType(`${CMD}.CmdBattleStatisticsInfo`);
    assert.deepEqual(Object.keys(stat.fields), ['unitId', 'eventType', 'frameId', 'kv']);
    assert.equal(stat.fields.unitId.id, 1);
    assert.equal(stat.fields.unitId.type, 'uint32');
    assert.equal(stat.fields.unitId.required, true);
    assert.equal(stat.fields.eventType.id, 2);
    assert.equal(stat.fields.eventType.required, true);
    assert.equal(stat.fields.frameId.id, 3);
    assert.equal(stat.fields.kv.id, 4);
    assert.equal(stat.fields.kv.repeated, true);
    // kv 是 string ⇒ 数字必须 String()，这条是下面那条编码用例的前提。
    assert.equal(stat.fields.kv.type, 'string');

    const finish = root.lookupType(`${CMD}.CmdFinishBattleReqMsg`);
    assert.equal(finish.fields.statisticsInfos.id, 4);
    assert.equal(finish.fields.statisticsInfos.repeated, true);
    assert.equal(finish.fields.statisticsInfos.resolvedType, stat);
});

// ============================================================================
// ② 真实编码往返
// ============================================================================

test('★编码：统计载荷能过真 proto（kv 全是字符串，解码逐字回来）', () => {
    const rows = buildDamageStatistics([
        { unitId: 68001, harm: 12345 },
        { unitId: 68002, harm: 0 },
    ]);
    const finish = root.lookupType(`${CMD}.CmdFinishBattleReqMsg`);
    const payload = {
        clientTickCount: 60,
        result: 1,
        statisticsInfos: rows,
    };
    // `required` 字段缺一个就抛；编得出来 = 形状对。
    const bytes = finish.encode(finish.create(payload)).finish();
    // `decode()` 回来的是 protobuf Message 实例（原型不同，deepEqual 会因原型差异失败）
    // ⇒ 先 `toObject()` 摊成纯对象再比。
    const decoded = finish.toObject(finish.decode(bytes), { defaults: true }) as unknown as {
        statisticsInfos: { unitId: number; eventType: number; frameId: number; kv: string[] }[];
    };
    assert.equal(decoded.statisticsInfos.length, 2);
    assert.deepEqual(
        decoded.statisticsInfos[0],
        { unitId: 68001, eventType: 2, frameId: 0, kv: ['harm', '12345'] },
        '★上报内容必须解析成「eventType=2 + harm=伤害总数」',
    );
    assert.deepEqual(decoded.statisticsInfos[1].kv, ['harm', '0'], 'harm 为 0 也要有一条（该单元确实没输出）');
    for (const row of decoded.statisticsInfos) {
        assert.equal(typeof row.kv[1], 'string', 'kv 是 repeated string，数字必须转字符串');
    }
});

test('数字塞进 repeated string 会被 protobufjs 拒 —— 这就是必须 String() 的原因', () => {
    const stat = root.lookupType(`${CMD}.CmdBattleStatisticsInfo`);
    assert.throws(
        () => stat.encode(stat.create({
            unitId: 1, eventType: 2, frameId: 0, kv: ['harm', 12345] as unknown as string[],
        })).finish(),
        /string/,
        'kv 塞 number 编不出来；若哪天编得出来说明协议字段变过，别再 String() 也一样',
    );
});

// ============================================================================
// ③ 组装口径
// ============================================================================

test('每个单元一条：eventType 恒 2、kv 恒两元、frameId 恒 0', () => {
    const rows = buildDamageStatistics([
        { unitId: 1, harm: 10 },
        { unitId: 2, harm: 20 },
        { unitId: 3, harm: 30 },
    ]);
    assert.equal(rows.length, 3, '2~4 人局要逐单元各一条，合成一条等于把伤害都记到同一人头上');
    for (const row of rows) {
        assert.equal(row.eventType, ZC_BATTLE_STAT_EVENT_TYPE.Damage);
        assert.equal(row.frameId, 0, '整局汇总额，不属于"某一帧触发"');
        assert.equal(row.kv.length, 2);
        assert.equal(row.kv[0], 'harm');
    }
    assert.deepEqual(rows.map((row) => row.unitId), [1, 2, 3]);
});

test('空输入 ⇒ 空数组（宁可不发，也不发一条 harm=0 的假数据）', () => {
    assert.deepEqual(buildDamageStatistics([]), []);
});

test('伤害/unitId 收敛：负数、NaN、小数、超界都不许打挂编码', () => {
    assert.equal(normalizeStatHarm(-5), 0);
    assert.equal(normalizeStatHarm(Number.NaN), 0);
    assert.equal(normalizeStatHarm(12.9), 12);
    assert.equal(normalizeStatHarm(0x1_0000_0000 + 7), 0xffffffff, 'uint32 上界');
    assert.equal(normalizeStatUnitId(-1), 0);
    assert.equal(normalizeStatUnitId(Number.POSITIVE_INFINITY), 0);
    assert.equal(normalizeStatUnitId(68001.7), 68001);
    // 走一遍组装，确认坏值不会以 "NaN" 这样的字符串出去
    assert.deepEqual(
        buildDamageStatistics([{ unitId: -1, harm: Number.NaN }])[0].kv,
        ['harm', '0'],
    );
});

// ============================================================================
// ④ 归属：与排行榜同一份席位分配
// ============================================================================

interface Seat {
    campId: number;
    roleId: string;
    name: string;
    avatarId: string;
    unitId?: number;
}

function seats(...rows: Seat[]): Seat[] {
    return rows;
}

test('★席位的 unitId 与 buildSeatProfiles 逐席一致（自己是 player，哪怕 campId 不是 1）', () => {
    const units = seats(
        { campId: 1, roleId: 'r1', name: '对手', avatarId: 'a1', unitId: 90001 },
        { campId: 2, roleId: 'self', name: '我', avatarId: 'a2', unitId: 90002 },
    );
    const profiles = buildSeatProfiles(units, 'self');
    const ids = buildSeatUnitIds(units, 'self');
    assert.deepEqual([...ids.keys()], [...profiles.keys()], '两表席位集合/顺序必须一致');
    assert.equal(ids.get('player'), 90002, '我自己在 campId=2，unitId 必须跟着我走');
    assert.equal(ids.get('enemy'), 90001);
});

test('4 人局：unitId 表也必须有 4 档（与排行榜同源，不许少人）', () => {
    const units = seats(
        { campId: 1, roleId: 'r1', name: '我', avatarId: 'a1', unitId: 1 },
        { campId: 2, roleId: 'r2', name: '乙', avatarId: 'a2', unitId: 2 },
        { campId: 3, roleId: 'r3', name: '丙', avatarId: 'a3', unitId: 3 },
        { campId: 4, roleId: 'r4', name: '丁', avatarId: 'a4', unitId: 4 },
    );
    const ids = buildSeatUnitIds(units, 'r1');
    assert.equal(ids.size, 4);
    assert.deepEqual(
        [...ids.entries()],
        [['player', 1], ['enemy', 2], ['enemy2', 3], ['enemy3', 4]],
    );
});

test('campId 非法 ⇒ 该席位跳过（不猜 unitId 属于谁）', () => {
    const ids = buildSeatUnitIds(
        seats(
            { campId: 0, roleId: 'x', name: '脏数据', avatarId: '', unitId: 7 },
            { campId: 1, roleId: 'r1', name: '我', avatarId: 'a1', unitId: 8 },
        ),
        'r1',
    );
    assert.equal(ids.size, 1);
    assert.equal(ids.get('player'), 8);
});

test('老回包没带 unitId ⇒ 收敛成 0（"不知道"，不是"0 号单元"）', () => {
    const ids = buildSeatUnitIds(seats({ campId: 1, roleId: 'r1', name: '我', avatarId: '' }), 'r1');
    assert.equal(ids.get('player'), 0);
});

// ============================================================================
// ⑤ 接线护栏（源码形状）
// ============================================================================

test('★ZCGame.buildStatistics 必须走 buildDamageStatistics，不许再自造 eventType / kv key', () => {
    const game = codeOf('assets/script/app/zcds/ZCGame.ts');
    assert.match(game, /buildDamageStatistics\(/, '结算上报必须复用统计模块（口径单一真源）');
    assert.doesNotMatch(game, /eventType:\s*1\b/, '★eventType=1 是塔防波次，报伤害是错的（r862 明确）');
    assert.doesNotMatch(game, /player_dealt|enemy_taken/, '★旧的四个自造 key 已被协议废弃');
});

test('结算上报把统计数据传给 finishBattle（漏传 = 前端白算一整局）', () => {
    const game = codeOf('assets/script/app/zcds/ZCGame.ts');
    assert.match(game, /finishBattle\(\s*state\.elapsedSeconds,\s*result,\s*commands,\s*this\.buildStatistics\(\)/);
    const service = codeOf('assets/script/app/battle/BattleStartService.ts');
    assert.match(service, /statisticsInfos:\s*statisticsInfos\.map\(/, '网络层必须把统计塞进请求载荷');
});

test('ProcedureGame 必须产出 seatUnitIds（否则 unitId 恒 0，服务端只能记到一个桶里）', () => {
    const proc = codeOf('assets/script/app/procedure/ProcedureGame.ts');
    assert.match(proc, /buildSeatUnitIds\(battle\.units/, '★席位 unitId 必须随 entry 交接');
    assert.match(proc, /seatUnitIds,/, 'entry 里要真的带上这张表');
    const entry = codeOf('assets/script/app/zcds/application/ZCGameEntry.ts');
    assert.match(entry, /readonly seatUnitIds\?/, 'entry 声明要与组装端一致');
});
