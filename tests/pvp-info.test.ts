import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchProfileLookup } from '../assets/script/app/battle/BattleStartModel';
import { applyPvpInfoToPlayerView, normalizePvpInfo } from '../assets/script/app/battle/PvpInfoModel';
import type { ZCPvpInfo } from '../assets/script/app/battle/PvpInfoModel';
import type { MatchPlayerData } from '../assets/script/app/matching/MatchTypes';

/**
 * `CmdPvpInfoReqMsg / RspMsg` 的纯函数口径。
 *
 * 这是「匹配过程中显示自己的个人信息」目前**唯一通的那条数据源**
 * （`CmdStartBattleRspMsg.unitInfos` 服务端还没实现），所以它的边界口径值得单测钉死：
 * 拿不到就返回 `null` 让调用方保留本地值，而不是返回一个"空对象"把界面清成 0/空串。
 */

const BASE: MatchPlayerData = {
    name: '本机昵称',
    avatarIcon: 'img_people',
    power: 27574,
    rank: '本地段位',
    trophy: 27,
    artifactName: '本地神器',
    artifactIcon: 'icon_faqi',
    stats: [],
};

const lookup = buildMatchProfileLookup(
    [{ gradeId: 1001, gradeName: '菜鸟护卫Ⅰ' }],
    [{ artifactId: 69001, name: '希瓦的守护' }],
);

test('normalizePvpInfo：拿不到 info 返回 null（不要把空响应当成"段位 0"）', () => {
    assert.equal(normalizePvpInfo(null), null);
    assert.equal(normalizePvpInfo(undefined), null);
    assert.equal(normalizePvpInfo({} as CmdPvpInfoRspMsg), null);
});

test('normalizePvpInfo：字段齐全时逐列取出，uint32 的 Long 形状也收得住', () => {
    assert.deepEqual(
        normalizePvpInfo({ info: { grade: 1001, score: 0, winCount: 3, gradeRewardTag: 2 } } as unknown as CmdPvpInfoRspMsg),
        { grade: 1001, score: 0, winCount: 3, gradeRewardTag: 2 },
    );
    // protobufjs 里缺省字段可能是 undefined（`--no-convert`），一律收敛成 0 而不是 NaN
    assert.deepEqual(
        normalizePvpInfo({ info: {} } as unknown as CmdPvpInfoRspMsg),
        { grade: 0, score: 0, winCount: 0, gradeRewardTag: 0 },
    );
    // 真机上 uint32 经 Long 传过来的形状
    const longLike = { low: 1001, high: 0, unsigned: true };
    assert.equal(normalizePvpInfo({ info: { grade: longLike } } as unknown as CmdPvpInfoRspMsg)?.grade, 1001);
});

test('applyPvpInfoToPlayerView：info 为 null 时原样返回，绝不把界面清空', () => {
    const out = applyPvpInfoToPlayerView(BASE, null, lookup);
    assert.deepEqual(out, BASE);
});

test('applyPvpInfoToPlayerView：grade 是 id → 查表换段位名；查不到保留原值', () => {
    const info: ZCPvpInfo = { grade: 1001, score: 0, winCount: 0, gradeRewardTag: 0 };
    assert.equal(applyPvpInfoToPlayerView(BASE, info, lookup).rank, '菜鸟护卫Ⅰ');
    // 不传 lookup（表没读进来）→ 保留本地段位名，不能变空串
    assert.equal(applyPvpInfoToPlayerView(BASE, info, null).rank, '本地段位');
    // grade 是表里没有的 id → 同上
    assert.equal(applyPvpInfoToPlayerView(BASE, { ...info, grade: 9999 }, lookup).rank, '本地段位');
});

test('applyPvpInfoToPlayerView：score 为 0 时保留原奖杯数，> 0 才覆盖', () => {
    const zero: ZCPvpInfo = { grade: 1001, score: 0, winCount: 0, gradeRewardTag: 0 };
    assert.equal(applyPvpInfoToPlayerView(BASE, zero, lookup).trophy, 27, '0 分不是有效显示值');
    assert.equal(applyPvpInfoToPlayerView(BASE, { ...zero, score: 88 }, lookup).trophy, 88);
});

test('applyPvpInfoToPlayerView：本接口没有的列一律保留本地值', () => {
    const info: ZCPvpInfo = { grade: 1001, score: 88, winCount: 5, gradeRewardTag: 0 };
    const out = applyPvpInfoToPlayerView(BASE, info, lookup);
    assert.equal(out.name, '本机昵称', 'PVP 信息里没有昵称');
    assert.equal(out.power, 27574, 'PVP 信息里没有战力');
    assert.equal(out.artifactName, '本地神器', 'PVP 信息里没有神器');
    assert.equal(out.avatarIcon, 'img_people', 'PVP 信息里没有头像');
    assert.deepEqual(out.stats, BASE.stats, '连胜不硬塞进 stats —— 图标口径未定');
});
