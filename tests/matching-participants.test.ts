import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeBattleStart, type MatchProfileLookup } from '../assets/script/app/battle/BattleStartModel';
import { MATCH_SLOT_BARS, MATCH_SLOT_PILLS } from '../assets/script/app/ArtPaths';
import { EMPTY_HEAD_ART } from '../assets/script/app/HeadArtModel';
import {
    MATCH_MAX_PARTICIPANTS, MATCH_MIN_PARTICIPANTS, matchSlotCount, normalizeMatchSeats, resolveMatchSeats,
} from '../assets/script/app/matching/MatchSlots';
import { MatchingModel } from '../assets/script/app/matching/MatchingModel';
import { LOCAL_PLAYER } from '../assets/script/app/matching/MatchPool';

const PAGE = 'assets/script/app/matching/MatchingPage.ts';

function battleOf(entries: readonly { campId: number; roleId: string; name: string }[]) {
    return normalizeBattleStart({
        code: 1, battleId: '9001', seed: '7',
        unitInfos: entries.map((entry) => ({ campId: entry.campId, showInfo: { roleId: entry.roleId, name: entry.name } })),
    });
}

const two = [{ campId: 1, roleId: '1', name: '我' }, { campId: 2, roleId: '2', name: '甲' }];
const three = [...two, { campId: 3, roleId: '3', name: '乙' }];
const four = [...three, { campId: 4, roleId: '4', name: '丙' }];

function modelOf(selfRoleId: string, roomSeats: number | null = null) {
    return new MatchingModel(LOCAL_PLAYER, selfRoleId, null, roomSeats);
}

test('回包先到时保留有效结果，最低搜索时间到达才匹配成功', () => {
    const model = modelOf('1');
    const battle = battleOf(two);
    assert.equal(model.acceptBattleResult(battle), 'searching');
    assert.equal(model.battle, battle);
    assert.equal(model.snapshot().phase, 'searching');
    assert.equal(model.elapseMinimumSearchTime(), true);
    assert.equal(model.snapshot().phase, 'matched');
});

test('计时先到时继续搜索，接受有效回包才匹配成功', () => {
    const model = modelOf('1');
    assert.equal(model.elapseMinimumSearchTime(), false);
    assert.equal(model.snapshot().phase, 'searching');
    assert.equal(model.acceptBattleResult(battleOf(two)), 'matched');
    assert.equal(model.snapshot().phase, 'matched');
});

test('单人回包被拒绝，不保存结果或推进阶段', () => {
    const model = modelOf('1');
    const battle = battleOf(two.slice(0, 1));
    assert.ok(battle);
    model.elapseMinimumSearchTime();
    assert.equal(model.acceptBattleResult(battle), 'rejected');
    assert.equal(model.battle, null);
    assert.equal(model.snapshot().phase, 'searching');
    assert.equal(model.snapshot().opponents.length, 0);
});

test('重复回包和计时输入只推进一次，保留第一次接受的开战结果', () => {
    const model = modelOf('1');
    const battle = battleOf(two);
    assert.equal(model.acceptBattleResult(battle), 'searching');
    assert.equal(model.acceptBattleResult(battleOf(three)), 'ignored');
    assert.equal(model.elapseMinimumSearchTime(), true);
    assert.equal(model.elapseMinimumSearchTime(), false);
    assert.equal(model.acceptBattleResult(null), 'ignored');
    assert.equal(model.battle, battle);
    assert.equal(model.snapshot().phase, 'matched');
    assert.equal(model.snapshot().opponents.length, 1);
});

// ---------------------------------------------------------------- 人数 → 条数

test('预期席位未知时，按已确认参战人数展示 2 到 4 条', () => {
    for (const units of [2, 3, 4]) {
        assert.equal(matchSlotCount(null, units), units, `${units} 人局必须有 ${units} 条`);
    }
});

test('回包前：没有声明就按最小值铺（不猜 4）', () => {
    assert.equal(matchSlotCount(null, 0), MATCH_MIN_PARTICIPANTS, '一个数都不知道时只铺"我方 + 1 条搜索占位"');
    assert.equal(matchSlotCount(null, 3), 3, '已经知道 3 个人就是 3 条');
});

test('展示席位取预期席位与已确认参战人数的较大值', () => {
    assert.equal(matchSlotCount(4, 0), 4, '入口说 4 人，搜索阶段就铺 4 条');
    assert.equal(matchSlotCount(2, 4), 4, '服务端回了 4 个人，条数不能被入口的 2 压住');
    assert.equal(matchSlotCount(4, 2), 4, '服务端只回 2 个网络席位，但本地这局是 4 席 —— 按大的算');

    const model = modelOf('1', 4);
    model.elapseMinimumSearchTime();
    assert.equal(model.acceptBattleResult(battleOf(two)), 'matched');
    const state = model.snapshot();
    assert.equal(state.slots, 4);
    assert.equal(state.opponents.length, 1);
});

test('脏值一律当"不知道"，越界夹到 2~4', () => {
    for (const value of [undefined, null, 0, 1, 5, 9, -3, 'abc', NaN]) {
        assert.equal(normalizeMatchSeats(value), null, `${String(value)} 不该被当成人头数`);
    }
    assert.equal(normalizeMatchSeats(3), 3);
    assert.equal(normalizeMatchSeats(2.4), 2, '小数向下取整（协议里有脏值时别把 2 条画成 3 条）');
    assert.equal(normalizeMatchSeats('4'), 4, '协议/本地存储给的是字符串也要认');
    assert.equal(matchSlotCount(null, 9), MATCH_MAX_PARTICIPANTS, '再多人也只有 4 套槽位配色');
    assert.equal(matchSlotCount(null, 1), MATCH_MIN_PARTICIPANTS, '最少也要一条我方 + 一条对手位');
});

test('入口声明与本地固定人数：取较大者，都不知道 ⇒ null', () => {
    assert.equal(resolveMatchSeats(4, 2), 4);
    assert.equal(resolveMatchSeats(2, 4), 4);
    assert.equal(resolveMatchSeats(3, null), 3);
    assert.equal(resolveMatchSeats(undefined, 4), 4);
    assert.equal(resolveMatchSeats(undefined, undefined), null);
    assert.equal(resolveMatchSeats(9, 0), null, '两边都是脏值 ⇒ 不知道');
});

test('上限跟着槽位配色表走，不是写死的数字', () => {
    assert.equal(MATCH_SLOT_BARS.length, 4, '槽位配色只有 4 套（蓝 / 红 / 紫 / 黄）');
    assert.equal(MATCH_SLOT_PILLS.length, MATCH_SLOT_BARS.length, '数值底与条底图一一对应');
    assert.equal(MATCH_MAX_PARTICIPANTS, MATCH_SLOT_BARS.length, '上限必须等于配色表长度');
});

// ---------------------------------------------------------------- 模型快照

test('服务端阵容按顺序提供八张卡牌给每名玩家的信息条', () => {
    const lookup: MatchProfileLookup = {
        heroStats: () => [], gradeName: () => '', artifactName: () => '', artifactIcon: () => '',
        allArtifactIcons: () => [], headArt: EMPTY_HEAD_ART,
        cardInfo: heroId => ({ rarity: 'blue', roleIcon: '', headIcon: String(heroId), headRoot: 'head' }),
    };
    const model = new MatchingModel(LOCAL_PLAYER, '1', lookup);
    model.acceptBattleResult(normalizeBattleStart({ code: 1, battleId: '9001', seed: '7',
        unitInfos: two.map(({ campId, roleId, name }) => ({ campId, showInfo: { roleId, name },
            heroInfos: Array.from({ length: 8 }, (_, index) => ({ heroId: campId * 100 + index, level: 1 })) })),
    }));
    const { mine, opponents } = model.snapshot();
    assert.deepEqual(mine.cards.map(card => card.id), ['100', '101', '102', '103', '104', '105', '106', '107']);
    assert.deepEqual(opponents[0].cards.map(card => card.id), ['200', '201', '202', '203', '204', '205', '206', '207']);
});

test('四人局：我方之外的三个单元全部上屏，顺序跟服务端一致', () => {
    const model = modelOf('1');
    model.acceptBattleResult(battleOf(four));
    model.elapseMinimumSearchTime();
    const state = model.snapshot();
    assert.equal(state.mine.name, '我', '0 号槽位必须是我方');
    assert.deepEqual(state.opponents.map((player) => player.name), ['甲', '乙', '丙'],
        '席位一个都不能少（原来只取第一个敌对单元 ⇒ 4 人局只显示 2 条）');
    assert.equal(state.slots, 4);
});

test('三人局 / 两人局：条数跟着人数走', () => {
    const threeModel = modelOf('1');
    threeModel.acceptBattleResult(battleOf(three));
    assert.equal(threeModel.snapshot().slots, 3);
    assert.equal(threeModel.snapshot().opponents.length, 2);

    const twoModel = modelOf('1');
    twoModel.acceptBattleResult(battleOf(two));
    assert.equal(twoModel.snapshot().slots, 2);
    assert.equal(twoModel.snapshot().opponents.length, 1, '两人局不许凭空造人');
});

test('回包前：入口声明 4 人 ⇒ 快照就是 4 条（服务端还没到也一样）', () => {
    assert.equal(modelOf('1', 4).snapshot().slots, 4);
    assert.equal(modelOf('1', 3).snapshot().slots, 3);
    assert.equal(modelOf('1').snapshot().slots, MATCH_MIN_PARTICIPANTS, '什么都不知道时按最小值，不猜 4');
    assert.deepEqual(modelOf('1', 4).snapshot().opponents, [], '搜索阶段没有对手数据');
});

test('本机 roleId 匹配不上时退回 units[0] 当我方，且不把自己重复算进对手', () => {
    const model = modelOf('999');
    model.acceptBattleResult(battleOf(three));
    const state = model.snapshot();
    assert.equal(state.mine.name, '我', '匹配不上就按服务端顺序取第 0 个（与 splitBattleUnits 同口径）');
    assert.deepEqual(state.opponents.map((player) => player.name), ['甲', '乙'], '我方不许出现在对手里');
});

// ---------------------------------------------------------------- 视图侧不许再写数字

test('页面只按 `state.slots` 排，源码里不许再出现人数常量', () => {
    const code = readFileSync(PAGE, 'utf8');
    const render = code.slice(code.indexOf('render(state: IMatchingViewState)'), code.indexOf('update(): void'));
    assert.match(render, /this\.layout\(state\.slots\)/, '条数必须来自快照');
    assert.doesNotMatch(render, /layout\(\s*\d/, '不许在渲染里写数字');
    assert.doesNotMatch(code, /MAX_PARTICIPANTS/, '页面不该再持有"本局几个人"的常量（两轮都栽在这上面）');
    assert.doesNotMatch(render, /'searching' \? \d/, '搜索阶段也不许写死条数');
});
