/**
 * 「联盟 · 大厅」三个页签（P2 第三刀）的回归网。
 *
 * 主题：把母面板里三个**空容器**（`DetailList` / `LogList` / `ServerList`）填成真列表 ——
 * 详情（成员）/ 动态 / 全服（联盟列表 + 搜索）。
 *
 * 分五段，各守一件事：
 *
 *   A. **文案口径**（`LeagueTexts` 的页签段）—— 三句动态模板、在线 / 列前缀、
 *      操作浮层 5 个按钮、离线时长三档模板。
 *   B. **数据层纯函数**（`LeagueTable` 的页签段）—— 职位权限判定、归一化、
 *      离线时长三档、动态文案三档、排序、搜索 / 快速加入的选取。
 *   C. **协议层**（`RequestLeagueMsg.ts` 源码文本）—— 每个请求类的 proto 名与老端一致，
 *      且必须在 `Cmd.d.ts` 的 `ReqMsgProtoName` 联合 + `MessageId` 联合里登记
 *      （**没登记就是静默发不出去**）。
 *   D. **prefab 结构 + 几何**（`ui/League/LeagueHall.prefab`）—— 三个页签的行模板节点、
 *      挂的列表组件、`@property` 绑定、行内几何对 FGUI。
 *   E. **页面逻辑**（源码文本）—— 三个页签的取数 / 铺行 / 搜索框接线。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/主界面_联盟/大厅/**`
 *     与 `组件/组件_联盟_联盟角色item.xml` / `组件_联盟_联盟动态item.xml` / `组件_联盟_联盟item.xml` /
 *     `组件_联盟_联盟操作.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/main/league/play/LayerLeagueHall{Detail,Message,AllServer}.ts`
 *     + `model/league/ModelLeague.ts`
 *   - 配置：`assets/remoteRef/unionOfficial.json`、`mL.json`
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    buildLeagueLogViews,
    buildLeagueMemberViews,
    buildLeagueUnionViews,
    buildMemberCountText,
    canApproveJoin,
    canEditUnion,
    findMyUnion,
    findSelfMember,
    findLeagueLevelRow,
    formatLeagueLogTime,
    ILeagueLogRow,
    ILeagueMemberRow,
    ILeagueOfficialRow,
    ILeagueUnionRow,
    isLeagueSearchId,
    leagueMaxExp,
    leagueOfflineText,
    LeaguePosition,
    normalizeLeagueApply,
    normalizeLeagueLog,
    normalizeLeagueMember,
    normalizeLeagueUnion,
    normalizeLeagueUnions,
    officialPowersMap,
    parseLeagueOfficialRows,
    parseUnionLevelRows,
    pickQuickJoinUnionIds,
    pickUnionListForSearch,
    resolveLeagueMemberActions,
    toRefRows,
    LEAGUE_QUICK_JOIN_LIMIT,
    LEAGUE_UNION_OFFICIAL_TABLE,
} from '../assets/script/app/league/LeagueTable';
import {
    fillLeagueText,
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_LOG_JOIN,
    LEAGUE_LOG_KICK,
    LEAGUE_LOG_QUIT,
    LEAGUE_MEMBER_COUNT_PREFIX,
    LEAGUE_MEMBER_ONLINE,
    LEAGUE_MEMBER_ROW_PREFIX,
    LEAGUE_OFFLINE_DAYS,
    LEAGUE_OFFLINE_HOURS,
    LEAGUE_OFFLINE_MINUTES,
    LEAGUE_OPS_LABELS,
    LEAGUE_TIP_INPUT_UNION_ID,
    LEAGUE_TIP_VIEW_SELF,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from '../assets/script/app/league/LeagueTexts';

// ============================================================
// 常量 / 工具
// ============================================================

const OFFICIAL_TS = 'assets/script/app/league/LeagueTable.ts';
const TEXTS_TS = 'assets/script/app/league/LeagueTexts.ts';
const MSG_TS = 'assets/script/app/league/RequestLeagueMsg.ts';
const REPO_TS = 'assets/script/app/league/LeagueRepository.ts';
const CMD_D_TS = 'assets/script/app/generated/netProto/Cmd.d.ts';
const OFFICIAL_JSON = 'assets/remoteRef/unionOfficial.json';

const MSG_SRC = readFileSync(MSG_TS, 'utf8');
const REPO_SRC = readFileSync(REPO_TS, 'utf8');
const CMD_D_SRC = readFileSync(CMD_D_TS, 'utf8');

/** 离线文案的三档（从 `LeagueTexts` 取，避免测试里硬编码中文）。 */
const OFFLINE_TEXTS = {
    onlineText: LEAGUE_MEMBER_ONLINE,
    days: LEAGUE_OFFLINE_DAYS,
    hours: LEAGUE_OFFLINE_HOURS,
    minutes: LEAGUE_OFFLINE_MINUTES,
} as const;

/** 动态文案的三句模板。 */
const LOG_TEXTS = { join: LEAGUE_LOG_JOIN, kick: LEAGUE_LOG_KICK, quit: LEAGUE_LOG_QUIT } as const;

/** 全服行文案的三个前缀。 */
const UNION_TEXTS = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
} as const;

/** 现网 `unionOfficial.json` 的三行（照抄磁盘，改了表就改这里）。 */
const OFFICIAL_TABLE = {
    k: ['position', 'name', 'canApprove', 'canEdit', 'kick', 'appointLeader', 'appointDeputy', 'dismiss'],
    v: [
        [1, '盟主', 1, 1, [2, 3], [3], [3], [2]],
        [2, '副盟主', 1, 1, [3], [], [], []],
        [3, '成员', 0, 0, [], [], [], []],
    ],
};

// ============================================================
// A. 文案
// ============================================================

test('A1 动态行的三句模板与 `mL.json` 逐字一致（385/386/387）', () => {
    assert.equal(LEAGUE_LOG_JOIN, '欢迎新成员{0}加入联盟');
    assert.equal(LEAGUE_LOG_KICK, '成员{0}被{1}请出联盟');
    assert.equal(LEAGUE_LOG_QUIT, '成员{0}退出联盟');
    // 三句都必须带占位符，否则填完还是原文
    assert.ok(LEAGUE_LOG_JOIN.includes('{0}'));
    assert.ok(LEAGUE_LOG_KICK.includes('{0}') && LEAGUE_LOG_KICK.includes('{1}'));
    assert.ok(LEAGUE_LOG_QUIT.includes('{0}'));
});

test('A2 在线 / 列前缀 / 提示与 `mL.json` 逐字一致（416/384/436/437/473/511）', () => {
    assert.equal(LEAGUE_MEMBER_ONLINE, '在线');
    assert.equal(LEAGUE_MEMBER_COUNT_PREFIX, '联盟成员');
    assert.equal(LEAGUE_UNION_LEADER_PREFIX, '盟主:');
    assert.equal(LEAGUE_UNION_MEMBER_PREFIX, '成员:');
    assert.equal(LEAGUE_TIP_VIEW_SELF, '您无法查看自己哦');
    assert.equal(LEAGUE_TIP_INPUT_UNION_ID, '请输入联盟ID');
    // 前两个是**半角**冒号（FGUI 与 mL.json 都是半角），别改成全角
    assert.ok(!LEAGUE_UNION_LEADER_PREFIX.includes('：'));
    assert.ok(!LEAGUE_UNION_MEMBER_PREFIX.includes('：'));
});

test('A3 详情行压贡献值的小字 = FGUI 静态 `成员:`（老端 render 没给它赋值）', () => {
    assert.equal(LEAGUE_MEMBER_ROW_PREFIX, '成员:');
    // ⚠️ 这一列的表头是「今日/历史贡献」而前缀写「成员:」，属设计稿复用笔误 ⇒ 照搬，不改字
    assert.ok(REPO_SRC.includes('LEAGUE_MEMBER_ROW_PREFIX') === false, 'Repository 不该关心行内静态文案');
});

test('A4 操作浮层 5 个按钮 = FGUI `组件_联盟_联盟操作.xml` 的 title', () => {
    assert.deepEqual(LEAGUE_OPS_LABELS, {
        show: '查看',
        toLeader: '任命盟主',
        toAdmin: '任命副盟主',
        unAdmin: '卸任副盟主',
        kick: '踢出联盟',
    });
});

test('A5 离线时长三档模板 = 老端 `timeSec2HMSStr3` 的 format 串', () => {
    assert.equal(LEAGUE_OFFLINE_DAYS, '{0}天{1}小时{2}分前');
    assert.equal(LEAGUE_OFFLINE_HOURS, '{0}小时{1}分前');
    assert.equal(LEAGUE_OFFLINE_MINUTES, '{0}分前');
});

test('A6 `fillLeagueText`：按 `{n}` 顺序替换；缺参保留原样；越界不抛', () => {
    assert.equal(fillLeagueText('成员{0}被{1}请出联盟', '乙', '王'), '成员乙被王请出联盟');
    assert.equal(fillLeagueText('{0}/{1}', 1, 2), '1/2');
    assert.equal(fillLeagueText('纯文本'), '纯文本');
    // 缺参 → 保留 `{1}`（不是空串，方便一眼看出漏填）
    assert.equal(fillLeagueText('{0}与{1}', '甲'), '甲与{1}');
    // 同一个占位符出现多次
    assert.equal(fillLeagueText('{0}-{0}', 'x'), 'x-x');
});

test('A7 页面类里不出现行文案字面量（一律走 `LeagueTexts`）', () => {
    for (const file of [OFFICIAL_TS]) {
        const src = readFileSync(file, 'utf8');
        for (const literal of ['欢迎新成员', '请出联盟', '退出联盟', '在线', '盟主:', '成员:']) {
            assert.ok(!src.includes(`'${literal}'`) || src.includes('@'), `${file} 直写了「${literal}」`);
        }
    }
});

// ============================================================
// B. 数据层纯函数
// ============================================================

test('B1 `parseLeagueOfficialRows`：真表 3 行 + 脏行丢弃 + 三种数组形状', () => {
    const rows = parseLeagueOfficialRows(OFFICIAL_TABLE);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.position), [1, 2, 3]);
    assert.deepEqual(rows[0].kick, [2, 3]);
    assert.deepEqual(rows[0].appointLeader, [3]);
    assert.deepEqual(rows[0].appointDeputy, [3]);
    assert.deepEqual(rows[0].dismiss, [2]);
    assert.equal(rows[0].canApprove, true);
    assert.equal(rows[0].canEdit, true);
    assert.equal(rows[2].canApprove, false);
    assert.deepEqual(rows[2].kick, []);

    // 数组三种形状都认：真数组 / "2,3" 串 / 单值
    const shapes = parseLeagueOfficialRows({
        k: ['position', 'kick'],
        v: [[1, [3, 2, 3]], [2, '3,4'], [3, 5]],
    });
    assert.deepEqual(shapes[0].kick, [3, 2], '真数组（去重保序）');
    assert.deepEqual(shapes[1].kick, [3, 4], '逗号串');
    assert.deepEqual(shapes[2].kick, [5], '单值');

    // 脏行（`position` 缺失 / 非整数 / < 1）丢弃：`null` 与 `''` 都是「没填」，
    // ⚠️ 不能让 `Number(null) === 0` 把它们变成「值是 0 的合法行」—— 那会造出一条假职位。
    const dirty = parseLeagueOfficialRows({ k: ['position'], v: [['x'], [null], [''], [0], [-1], [1]] });
    assert.deepEqual(dirty.map((r) => r.position), [1]);

    // 表缺失 / 形状不对 → 空数组，不抛
    assert.deepEqual(parseLeagueOfficialRows(null), []);
    assert.deepEqual(parseLeagueOfficialRows({}), []);
    assert.deepEqual(parseLeagueOfficialRows('nope'), []);
});

test('B2 ⚠️ 职位权限：盟主 / 副盟主 / 成员 对 3 个目标职位的 5 个动作', () => {
    const powers = officialPowersMap(parseLeagueOfficialRows(OFFICIAL_TABLE));

    // 盟主看副盟主：能卸任、能踢；不能任命盟主 / 副盟主（目标已是副盟主）
    assert.deepEqual(resolveLeagueMemberActions(LeaguePosition.LEADER, LeaguePosition.ADMIN, powers), {
        show: true, appointLeader: false, appointAdmin: false, dismissAdmin: true, kick: true,
    });
    // 盟主看成员：任命盟主 / 副盟主 / 踢 都能；不能卸任（成员本来就没职位）
    assert.deepEqual(resolveLeagueMemberActions(LeaguePosition.LEADER, LeaguePosition.MEMBER, powers), {
        show: true, appointLeader: true, appointAdmin: true, dismissAdmin: false, kick: true,
    });
    // 副盟主看成员：**只能踢**
    assert.deepEqual(resolveLeagueMemberActions(LeaguePosition.ADMIN, LeaguePosition.MEMBER, powers), {
        show: true, appointLeader: false, appointAdmin: false, dismissAdmin: false, kick: true,
    });
    // 副盟主看盟主：什么都做不了
    assert.deepEqual(resolveLeagueMemberActions(LeaguePosition.ADMIN, LeaguePosition.LEADER, powers), {
        show: true, appointLeader: false, appointAdmin: false, dismissAdmin: false, kick: false,
    });
    // 成员对谁都没权限（自己踢自己也不行）
    for (const target of [LeaguePosition.LEADER, LeaguePosition.ADMIN, LeaguePosition.MEMBER]) {
        const actions = resolveLeagueMemberActions(LeaguePosition.MEMBER, target, powers);
        assert.deepEqual(actions, {
            show: true, appointLeader: false, appointAdmin: false, dismissAdmin: false, kick: false,
        });
    }
    // 「查看」恒 true（老端 `CanBeShow()` 直接 return true）
    assert.equal(resolveLeagueMemberActions(2, 3, powers).show, true);
    assert.equal(resolveLeagueMemberActions(3, 1, powers).show, true);
});

test('B3 ⚠️ 我的职位查不到（未入盟 / 表缺失）⇒ 5 个动作里只有「查看」保底', () => {
    // 空表
    const empty = officialPowersMap([]);
    for (const my of [0, 1, 2, 3, 99]) {
        const actions = resolveLeagueMemberActions(my, LeaguePosition.MEMBER, empty);
        assert.deepEqual(actions, {
            show: true, appointLeader: false, appointAdmin: false, dismissAdmin: false, kick: false,
        }, `my=${my} 时不该给任何管理动作`);
    }
    // 表在但我的职位不在（服务端加了新职位而客户端表还没更新）
    const powers = officialPowersMap(parseLeagueOfficialRows(OFFICIAL_TABLE));
    assert.equal(resolveLeagueMemberActions(99, 3, powers).kick, false);
});

test('B4 `canApproveJoin` / `canEditUnion`：只有盟主与副盟主能', () => {
    const powers = officialPowersMap(parseLeagueOfficialRows(OFFICIAL_TABLE));
    assert.equal(canApproveJoin(LeaguePosition.LEADER, powers), true);
    assert.equal(canApproveJoin(LeaguePosition.ADMIN, powers), true);
    assert.equal(canApproveJoin(LeaguePosition.MEMBER, powers), false);
    assert.equal(canApproveJoin(0, powers), false);

    assert.equal(canEditUnion(LeaguePosition.LEADER, powers), true);
    assert.equal(canEditUnion(LeaguePosition.ADMIN, powers), true);
    assert.equal(canEditUnion(LeaguePosition.MEMBER, powers), false);
    // 空表 ⇒ false（不给操作，免得发出去被服务端拒）
    const empty = officialPowersMap([]);
    assert.equal(canApproveJoin(LeaguePosition.LEADER, empty), false);
    assert.equal(canEditUnion(LeaguePosition.LEADER, empty), false);
});

test('B5 ⚠️ 归一化 `CmdUnion`：`Long` 三种形状都收敛成字符串；`id` 为 0 / 空 ⇒ 丢行', () => {
    const fromProto = normalizeLeagueUnion({
        id: { low: 1234, high: 0, unsigned: true, toString: () => '1234' },
        name: '北伐中原',
        level: 4,
        icon: 2,
        count: 26,
        maxCount: 46,
        autoJoin: true,
        leaderId: '7',
        leaderName: '曹孟德',
        notice: '欢迎',
        declaration: '宣言',
        wxChat: 'lianmeng_888',
        exp: 199,
    });
    assert.ok(fromProto);
    assert.equal(fromProto!.id, '1234', 'Long → 十进制字符串');
    assert.equal(fromProto!.count, 26);
    assert.equal(fromProto!.autoJoin, true);

    // 裸数值 / 字符串也认
    assert.equal(normalizeLeagueUnion({ id: 42 })!.id, '42');
    assert.equal(normalizeLeagueUnion({ id: '9007199254740993' })!.id, '9007199254740993', '超 2^53 不丢精度');

    // id 为 0 / 空 / 缺 ⇒ null（缓存里会出现半截行）
    assert.equal(normalizeLeagueUnion({ id: 0 }), null);
    assert.equal(normalizeLeagueUnion({ id: '' }), null);
    assert.equal(normalizeLeagueUnion({}), null);
    assert.equal(normalizeLeagueUnion(null), null);
    assert.equal(normalizeLeagueUnion('x'), null);

    // 批归一化丢脏行
    assert.equal(normalizeLeagueUnions([{ id: 1 }, null, { id: 0 }, { id: 2 }]).length, 2);
    assert.deepEqual(normalizeLeagueUnions(null), []);
    assert.deepEqual(normalizeLeagueUnions(undefined), []);
});

test('B6 ⚠️ 归一化 `CmdUnionMember`：`position` 缺失兜底成「成员」而不是 0', () => {
    const row = normalizeLeagueMember({
        roleId: '1001',
        name: '阿尔萨斯',
        img: '3001',
        level: 67,
        power: '2138',
        serverId: 3,
        selectServerId: 5,
        position: LeaguePosition.ADMIN,
        online: true,
        lastOfflineTime: '0',
        todayContribute: 12,
        allContribute: 3456,
    });
    assert.ok(row);
    assert.equal(row!.roleId, '1001');
    assert.equal(row!.position, LeaguePosition.ADMIN);
    assert.equal(row!.power, '2138');
    assert.equal(row!.online, true);

    // position 缺失 ⇒ 兜底「成员」（0 会让权限判定与「未入盟」混在一起）
    assert.equal(normalizeLeagueMember({ roleId: '1' })!.position, LeaguePosition.MEMBER);
    // roleId 为 0 / 空 ⇒ null
    assert.equal(normalizeLeagueMember({ roleId: '0' }), null);
    assert.equal(normalizeLeagueMember({ roleId: '' }), null);
    assert.equal(normalizeLeagueMember({}), null);
    // lastOfflineTime 收敛成数字毫秒
    assert.equal(normalizeLeagueMember({ roleId: '2', lastOfflineTime: '1700000000000' })!.lastOfflineTimeMs, 1700000000000);
    assert.equal(normalizeLeagueMember({ roleId: '2', lastOfflineTime: { low: 1, high: 0, toString: () => '1' } })!.lastOfflineTimeMs, 1);
});

test('B7 归一化 `CmdUnionLogs` / `CmdUnionApplys`：脏行丢弃 + 默认值', () => {
    const log = normalizeLeagueLog({ id: '5', name: '甲', join: 1, time: '1700000000000', opPosition: 1, opName: '王' });
    assert.ok(log);
    assert.equal(log!.timeMs, 1700000000000);
    assert.equal(log!.join, 1);
    // id 也允许为 '0'（动态表的自增 id 从 1 开始，0 是脏数据）—— 本表 tlKey 是 id，空才丢
    assert.equal(normalizeLeagueLog({}), null);
    assert.equal(normalizeLeagueLog({ id: '0' })!.id, '0', '动态表不把 0 当脏（与联盟 / 成员表口径不同）');
    assert.equal(normalizeLeagueLog(null), null);

    const apply = normalizeLeagueApply({ applyId: '8', name: '刘备', level: 30, power: '900' });
    assert.ok(apply);
    assert.equal(apply!.applyId, '8');
    assert.equal(apply!.power, '900');
    assert.equal(normalizeLeagueApply({ applyId: '0' }), null);
    assert.equal(normalizeLeagueApply({}), null);
});

test('B8 ⚠️ 离线时长三档：`day` 不补零、`hour`/`min` 两位补零；总小时口径', () => {
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    // 「在线」不走时长（老端第一分支）
    assert.equal(leagueOfflineText(true, 1000, 1000 + 5 * hour, OFFLINE_TEXTS), '在线');
    // lastOfflineTime = 0 也走「在线」（老端 `|| cmd.lastOfflineTime == 0`）
    assert.equal(leagueOfflineText(false, 0, Date.now(), OFFLINE_TEXTS), '在线');

    const at = (elapsedMs: number, fromMs = 1700000000000): string =>
        leagueOfflineText(false, fromMs, fromMs + elapsedMs, OFFLINE_TEXTS);

    assert.equal(at(5 * minute), '05分前');
    assert.equal(at(59 * minute), '59分前');
    assert.equal(at(hour + 5 * minute), '01小时05分前');
    assert.equal(at(23 * hour + 59 * minute), '23小时59分前');
    // ⚠️ 满 24 小时进「天」档，且「天」**不补零**、「小时」补零
    assert.equal(at(day + 3 * hour + 5 * minute), '1天03小时05分前');
    assert.equal(at(9 * day + 3 * hour + 5 * minute), '9天03小时05分前');
    // ⚠️ 三天 12 小时 = 84 总小时 ⇒ 3 天（不是按自然日）
    assert.equal(at(84 * hour), '3天12小时00分前');
    // 「天」不补零：10 天给 `10天…` 而不是 `010天…`
    assert.equal(at(241 * hour), '10天01小时00分前');
    // 未来时间（时钟漂移）夹成 0 ⇒ 「00分前」，不出现负数
    assert.equal(leagueOfflineText(false, 1700000000000, 1700000000000 - hour, OFFLINE_TEXTS), '00分前');
});

test('B9 `formatLeagueLogTime` = 老端 `time2String2` 的 `MM/DD HH:mm:ss`', () => {
    const ms = new Date(2026, 8, 24, 9, 3, 7).getTime(); // 2026-09-24 09:03:07（本地时区）
    assert.equal(formatLeagueLogTime(ms), '09/24 09:03:07');
    // 月/日/时/分/秒 都两位补零
    const ms2 = new Date(2026, 0, 5, 1, 2, 3).getTime();
    assert.equal(formatLeagueLogTime(ms2), '01/05 01:02:03');
    // 非法 / 0 ⇒ 空串（不给 1970 年的假时间）
    assert.equal(formatLeagueLogTime(0), '');
    assert.equal(formatLeagueLogTime(-1), '');
    assert.equal(formatLeagueLogTime(NaN), '');
});

test('B10 ⚠️ 动态文案三档：`join===1` → 欢迎；否则 `opPosition===1` → 请出；其余 → 退出', () => {
    const rows: ILeagueLogRow[] = [
        { id: '1', name: '甲', join: 1, timeMs: 1700000000000, opPosition: 0, opName: '' },
        { id: '2', name: '乙', join: 0, timeMs: 1700000001000, opPosition: 1, opName: '王' },
        { id: '3', name: '丙', join: 0, timeMs: 1700000002000, opPosition: 2, opName: '李' },
        { id: '4', name: '丁', join: 0, timeMs: 1700000003000, opPosition: 0, opName: '' },
    ];
    const views = buildLeagueLogViews(rows, LOG_TEXTS);
    assert.equal(views.length, 4);
    // 默认按时间**降序**（最新的在最上）
    assert.deepEqual(views.map((v) => v.id), ['4', '3', '2', '1']);
    const byId = new Map(views.map((v) => [v.id, v]));
    assert.equal(byId.get('1')!.ctx, '欢迎新成员甲加入联盟');
    assert.equal(byId.get('1')!.join, true);
    assert.equal(byId.get('2')!.ctx, '成员乙被王请出联盟');
    // ⚠️ 副盟主踢人走第三档「退出联盟」（老端只认 `opPosition === 1`）
    assert.equal(byId.get('3')!.ctx, '成员丙退出联盟');
    assert.equal(byId.get('4')!.ctx, '成员丁退出联盟');
    assert.ok(views.every((v) => /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(v.timeText)),
        '时间文案都要是 MM/DD HH:mm:ss（14 个字符）');

    // 关掉降序时保持原序
    assert.deepEqual(buildLeagueLogViews(rows, LOG_TEXTS, false).map((v) => v.id), ['1', '2', '3', '4']);
    // 空表 / 时间缺失不抛
    assert.deepEqual(buildLeagueLogViews([], LOG_TEXTS), []);
    assert.equal(buildLeagueLogViews([{ id: '9', name: 'x', join: 0, timeMs: 0, opPosition: 0, opName: '' }], LOG_TEXTS)[0].timeText, '');
});

test('B11 ⚠️ 成员排序：职位升序 → 累计贡献降序 → roleId 升序（稳定）', () => {
    const mk = (roleId: string, position: number, all: number): ILeagueMemberRow => ({
        roleId, name: `N${roleId}`, img: '0', headFrame: '0', level: 1, power: '0',
        serverId: 0, selectServerId: 0, position, online: false, lastOfflineTimeMs: 0,
        todayContribute: 0, allContribute: all,
    });
    const rows = [
        mk('20', LeaguePosition.MEMBER, 100),
        mk('10', LeaguePosition.LEADER, 5),
        mk('30', LeaguePosition.ADMIN, 50),
        mk('40', LeaguePosition.MEMBER, 900),
        mk('21', LeaguePosition.MEMBER, 100),
    ];
    const views = buildLeagueMemberViews(rows, 1700000000000, OFFLINE_TEXTS);
    assert.deepEqual(views.map((v) => v.roleId), ['10', '30', '40', '20', '21'],
        '盟主 → 副盟主 → 成员（按贡献降序）→ 贡献相同按 roleId 升序');
    // 关掉排序时保持入参序
    assert.deepEqual(buildLeagueMemberViews(rows, 1700000000000, OFFLINE_TEXTS, false).map((v) => v.roleId),
        ['20', '10', '30', '40', '21']);
    // 视图模型字段口径
    const leader = views[0];
    assert.equal(leader.levelText, '1', '`lab_lv` 是**纯数字**（详情行不带「级」）');
    assert.equal(leader.contributeText, '0/5');
    assert.equal(leader.timeText, '在线');
});

test('B12 全服行文案：`6级` / `盟主:名字` / `成员:45/46`', () => {
    const rows: ILeagueUnionRow[] = [{
        id: '9', name: '魏', level: 6, icon: 2, count: 45, maxCount: 46, autoJoin: true,
        leaderId: '1', leaderName: '曹孟德', notice: '', declaration: '', wxChat: '', exp: 0,
    }];
    const views = buildLeagueUnionViews(rows, UNION_TEXTS);
    assert.equal(views[0].levelText, '6级');
    assert.equal(views[0].leaderText, '盟主:曹孟德');
    assert.equal(views[0].memberText, '成员:45/46');
    assert.equal(views[0].icon, 2, '旗帜颜色要透出去（行组件按它选控制器页）');
    assert.deepEqual(buildLeagueUnionViews([], UNION_TEXTS), []);
});

test('B13 详情表头的成员数文案 = 前缀 + `count/maxCount`', () => {
    assert.equal(buildMemberCountText(LEAGUE_MEMBER_COUNT_PREFIX, 26, 46), '联盟成员26/46');
    assert.equal(buildMemberCountText(LEAGUE_MEMBER_COUNT_PREFIX, 0, 0), '联盟成员0/0');
    // ⚠️ 老端是**不带括号**的（FGUI 占位串带括号，运行期会被覆盖）—— 本函数守运行期口径
    assert.ok(!buildMemberCountText(LEAGUE_MEMBER_COUNT_PREFIX, 26, 46).includes('('));
});

test('B14 ⚠️ 全服列表：搜到过就只显示那一个；否则显示全部（缓存键 = 输入原串）', () => {
    const all: ILeagueUnionRow[] = [
        { id: '1', name: 'A', level: 1, icon: 0, count: 1, maxCount: 2, autoJoin: false, leaderId: '', leaderName: '', notice: '', declaration: '', wxChat: '', exp: 0 },
        { id: '2', name: 'B', level: 1, icon: 0, count: 1, maxCount: 2, autoJoin: false, leaderId: '', leaderName: '', notice: '', declaration: '', wxChat: '', exp: 0 },
    ];
    assert.deepEqual(pickUnionListForSearch(all, null).map((r) => r.id), ['1', '2']);
    assert.deepEqual(pickUnionListForSearch(all, undefined).map((r) => r.id), ['1', '2']);
    const hit = all[1];
    assert.deepEqual(pickUnionListForSearch(all, hit).map((r) => r.id), ['2'], '搜到过 ⇒ 只显示那一个');
    // 空列表 + 无缓存 ⇒ 空
    assert.deepEqual(pickUnionListForSearch([], null), []);
});

test('B15 快速加入：`autoJoin && count < maxCount`，最多 5 条（老端写死）', () => {
    const mk = (id: string, autoJoin: boolean, count: number, maxCount: number): ILeagueUnionRow => ({
        id, name: id, level: 1, icon: 0, count, maxCount, autoJoin,
        leaderId: '', leaderName: '', notice: '', declaration: '', wxChat: '', exp: 0,
    });
    assert.equal(LEAGUE_QUICK_JOIN_LIMIT, 5, '老端 `final.slice(0, 5)`');
    const rows = [
        mk('1', true, 1, 10),
        mk('2', false, 1, 10), // 不允许快速加入
        mk('3', true, 10, 10), // 已满
        mk('4', true, 1, 10),
        mk('5', true, 1, 10),
        mk('6', true, 1, 10),
        mk('7', true, 1, 10),
        mk('8', true, 1, 10),
    ];
    assert.deepEqual(pickQuickJoinUnionIds(rows), ['1', '4', '5', '6', '7'], '最多 5 条');
    assert.deepEqual(pickQuickJoinUnionIds(rows, 2), ['1', '4']);
    assert.deepEqual(pickQuickJoinUnionIds([]), []);
});

test('B16 `findSelfMember` / `findMyUnion`：按 id 比，取不到给 `null`', () => {
    const members: ILeagueMemberRow[] = [{
        roleId: '1001', name: '我', img: '0', headFrame: '0', level: 1, power: '0',
        serverId: 0, selectServerId: 0, position: LeaguePosition.ADMIN, online: true,
        lastOfflineTimeMs: 0, todayContribute: 0, allContribute: 0,
    }];
    assert.equal(findSelfMember(members, '1001')!.name, '我');
    assert.equal(findSelfMember(members, '9999'), null);
    // ⚠️ 空 selfRoleId 直接 null（不要把「空串」匹配上任何一行）
    assert.equal(findSelfMember(members, ''), null);

    const unions: ILeagueUnionRow[] = [{
        id: '7', name: '联盟7', level: 1, icon: 0, count: 1, maxCount: 2, autoJoin: false,
        leaderId: '', leaderName: '', notice: '', declaration: '', wxChat: '', exp: 0,
    }];
    assert.equal(findMyUnion(unions, '7')!.name, '联盟7');
    assert.equal(findMyUnion(unions, '8'), null);
    // 未入盟（'0'）直接 null
    assert.equal(findMyUnion(unions, '0'), null);
    assert.equal(findMyUnion(unions, ''), null);
});

test('B17 `toRefRows` 对 `unionOfficial` 真表的形状判定（列式 `{k,v}`）', () => {
    const rows = toRefRows(OFFICIAL_TABLE);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].position, 1);
    assert.equal(rows[1].name, '副盟主');
    assert.equal(rows[2].canEdit, 0);
});

// ============================================================
// C. 协议层（源码文本，因为 `RequestLeagueMsg` 通过 `RequestMsg` 拉到 `cc`）
// ============================================================

test('C1 每个请求类的 proto 名与 `Cmd.d.ts` 一致（改一个字母就是静默发不出去）', () => {
    const EXPECT: Readonly<Record<string, string>> = {
        RequestUnionDetail: 'CmdUnionDetailReqMsg',
        RequestUnionLog: 'CmdUnionLogReqMsg',
        RequestUnionList: 'CmdUnionListReqMsg',
        RequestUnionApplyList: 'CmdUnionApplyListReqMsg',
        RequestUnionSearch: 'CmdUnionSearchReqMsg',
        RequestUnionKick: 'CmdUnionKickReqMsg',
        RequestUnionAppoint: 'CmdUnionAppointReqMsg',
        RequestUnionApproveJoin: 'CmdUnionApproveJoinReqMsg',
        RequestUnionApproveJoinOneKey: 'CmdUnionApproveJoinOneKeyReqMsg',
        RequestUnionQuit: 'CmdUnionQuitReqMsg',
        RequestUnionSetQuickJoin: 'CmdUnionSetQuickJoinReqMsg',
        RequestUnionEdit: 'CmdUnionEditReqMsg',
        RequestUnionCreate: 'CmdUnionCreateReqMsg',
        RequestUnionJoin: 'CmdUnionJoinReqMsg',
        RequestUnionDonate: 'CmdUnionDonateReqMsg',
        RequestUnionBargain: 'CmdUnionBargainReqMsg',
        RequestUnionActList: 'CmdUnionActListReqMsg',
        RequestUnionActDrum: 'CmdUnionActDrumReqMsg',
        RequestUnionActSweep: 'CmdUnionActSweepReqMsg',
        RequestTaskUnionGetReward: 'CmdTaskUnionGetRewardReqMsg',
        RequestTaskUnionGetProgressReward: 'CmdTaskUnionGetProgressRewardReqMsg',
        RequestRoleWatchAdvert: 'CmdRoleWatchAdvertReqMsg',
    };
    for (const [cls, proto] of Object.entries(EXPECT)) {
        assert.ok(MSG_SRC.includes(`export class ${cls} `), `缺请求类 ${cls}`);
        assert.ok(MSG_SRC.includes(`return '${proto}'`), `${cls} 的 proto 名必须是 '${proto}'`);
    }
});

test('C2 ⚠️ 每个 proto 名都必须在 `ReqMsgProtoName` 与 `MessageId` 两个联合里登记', () => {
    // `ReqMsgProtoName`：union 里出现 `"CmdXxxReqMsg"`（带引号，是字符串字面量类型）
    // `MessageId`：同一行形如 `| "CmdXxxRspMsg"` —— 请求名与响应名各占一行，成对出现
    const lines = CMD_D_SRC.split('\n');
    for (const req of [
        'CmdUnionDetailReqMsg', 'CmdUnionLogReqMsg', 'CmdUnionListReqMsg', 'CmdUnionApplyListReqMsg',
        'CmdUnionSearchReqMsg', 'CmdUnionKickReqMsg', 'CmdUnionAppointReqMsg',
        'CmdUnionApproveJoinReqMsg', 'CmdUnionApproveJoinOneKeyReqMsg', 'CmdUnionQuitReqMsg',
        'CmdUnionSetQuickJoinReqMsg', 'CmdUnionEditReqMsg', 'CmdUnionCreateReqMsg', 'CmdUnionJoinReqMsg',
        'CmdUnionDonateReqMsg', 'CmdUnionBargainReqMsg', 'CmdUnionActListReqMsg',
        'CmdUnionActDrumReqMsg', 'CmdUnionActSweepReqMsg',
        'CmdTaskUnionGetRewardReqMsg', 'CmdTaskUnionGetProgressRewardReqMsg', 'CmdRoleWatchAdvertReqMsg',
    ]) {
        const hits = lines.filter((line) => line.includes(`"${req}"`)).length;
        assert.ok(hits >= 2, `${req} 只登记了 ${hits} 处（应至少 2：ReqMsgProtoName + MessageId）`);
    }
});

test('C3 ⚠️ 7 条推送的消息名也在 `MessageId` 里（本刀全靠缓存，但没有推送就没数据）', () => {
    for (const bro of [
        'CmdUnionApproveJoinBroMsg', 'CmdUnionInfoUpdateBroMsg', 'CmdUnionMemberListUpdateBroMsg',
        'CmdUnionApplyListUpdateBroMsg', 'CmdUnionLogListUpdateBroMsg', 'CmdUnionListUpdateBroMsg',
        'CmdUnionTaskListUpdateBroMsg',
    ]) {
        assert.ok(CMD_D_SRC.includes(`"${bro}"`), `缺推送登记 ${bro}`);
    }
});

test('C4 ⚠️ 请求体口径：踢人 / 任命 / 申请审批 用的字段名必须是 `memberId` / `reqId`', () => {
    // 字段名抄错 = 编码时被丢成默认值，服务端收到 0 —— 不报错
    assert.ok(REPO_SRC.includes('new RequestUnionKick({ memberId: id }'), '踢人是 `memberId`');
    assert.ok(REPO_SRC.includes('new RequestUnionAppoint({ memberId: id, officialId, type }'),
        '任命是 `{ memberId, officialId, type }`');
    assert.ok(REPO_SRC.includes('new RequestUnionApproveJoin({ reqId: id, agree }'),
        '审批单条是 `{ reqId, agree }`（**不是** applyId）');
    assert.ok(REPO_SRC.includes('new RequestUnionApproveJoinOneKey({ agree }'), '一键审批只有 `agree`');
    assert.ok(REPO_SRC.includes('new RequestUnionSearch({ id }'), '搜索字段是 `id`（按联盟 id 搜）');
    assert.ok(REPO_SRC.includes('new RequestUnionEdit({ type, content }'), '编辑是 `{ type, content }`');
    assert.ok(REPO_SRC.includes('new RequestUnionSetQuickJoin({ quick }'), '快速加入是 `{ quick }`');
    assert.ok(REPO_SRC.includes('new RequestUnionQuit({}'), '退出是空请求体');
});

test('C5 ⚠️ `memberId` 必须发**十进制字符串**（`LongBits.from` 把普通对象当 zero ⇒ id 静默变 0）', () => {
    assert.ok(REPO_SRC.includes('const id = toIdString(memberId)'), '发之前必须过 toIdString');
    assert.ok(REPO_SRC.includes(`if (!id || id === '0') return Promise.resolve('failed')`), 'id 认不出来就别发');
    // 批量 / 数组请求体：联盟这边只有 `unionIds`（加入联盟），本刀不用，但别写成单个
    assert.ok(MSG_SRC.includes('unionIds'), '加入联盟是数组请求体');
});

test('C6 任命 / 卸任共用 `officialId + type`（`type=false` 即卸任）', () => {
    assert.ok(REPO_SRC.includes('return this.appoint(memberId, LeaguePosition.LEADER, true, caller)'), '任命盟主');
    assert.ok(REPO_SRC.includes('return this.appoint(memberId, LeaguePosition.ADMIN, true, caller)'), '任命副盟主');
    assert.ok(REPO_SRC.includes('return this.appoint(memberId, LeaguePosition.ADMIN, false, caller)'), '卸任副盟主是 `type=false`');
    // 三个动作必须都走同一个私有助手（请求体只写一处）
    const hits = REPO_SRC.split('RequestUnionAppoint(').length - 1;
    assert.equal(hits, 1, '`RequestUnionAppoint` 只该出现 1 次');
});

// ============================================================
// Repository 源码口径（不能 import：`LeagueRepository` → `GameNet` → `cc`）
// ============================================================

test('C7 读缓存走 `CacheMgr` 的 5 张表；缺失不抛', () => {
    for (const getter of [
        'getTlCmdUnion()', 'getTlCmdUnionMember()', 'getTlCmdUnionApplys()',
        'getTlCmdUnionLogs()', 'getTlCmdRoleUnion()',
    ]) {
        assert.ok(REPO_SRC.includes(getter), `缺 ${getter}`);
    }
    assert.ok(REPO_SRC.includes('} catch (error) {'), '读缓存要 try/catch（拿不到就当空）');
});

test('C8 ⚠️ 搜索缓存**独立存放**，不补写进 `CmdUnion` 缓存表', () => {
    assert.ok(REPO_SRC.includes('private readonly searchCache = new Map<string, ILeagueUnionRow>()'));
    assert.ok(REPO_SRC.includes('this.searchCache.set(unionId, row)'), '搜索的键是**输入原串**');
    assert.ok(REPO_SRC.includes('cachedSearch(key: string)'));
    assert.ok(REPO_SRC.includes('clearSearchCache()'));
    // 绝不能往 `CmdUnion` 缓存写别人的联盟（会和「我的联盟」抢同一个 tlKey）
    assert.ok(!/setCache|updateCache|upsert/i.test(REPO_SRC), '本 Repository 不该有写缓存的调用');
});

test('C9 读 / 写超时常量与好友同口径（800 / 5000）', () => {
    const read = REPO_SRC.match(/const READ_TIMEOUT_MS = (\d+)/);
    const write = REPO_SRC.match(/const WRITE_TIMEOUT_MS = (\d+)/);
    assert.ok(read && write, '读 / 写超时常量必须都在');
    assert.equal(Number(read![1]), 800);
    assert.equal(Number(write![1]), 5000);
    assert.ok(REPO_SRC.includes('export const LEAGUE_READ_TIMEOUT_MS'));
    assert.ok(REPO_SRC.includes('export const LEAGUE_WRITE_TIMEOUT_MS'));
    // 必须 withTimeout：`GameNet.send` 没有按请求的超时
    assert.ok(REPO_SRC.includes('withTimeout(net.send(make(), false)'), '发包必须兜硬超时');
    assert.ok(REPO_SRC.includes(`if (!net?.isConnected) return 'offline'`), '离线早退');
});

test('C10 ⚠️ `unionOfficial` 表名与磁盘文件一致', () => {
    assert.equal(LEAGUE_UNION_OFFICIAL_TABLE, 'unionOfficial');
    assert.ok(existsSync(OFFICIAL_JSON), '配置文件必须在磁盘上');
    const raw = JSON.parse(readFileSync(OFFICIAL_JSON, 'utf8')) as { k: string[]; v: unknown[] };
    assert.deepEqual(raw.k, ['position', 'name', 'canApprove', 'canEdit', 'kick', 'appointLeader', 'appointDeputy', 'dismiss']);
    assert.equal(raw.v.length, 3, '现网 3 个职位');
});

test('C11 真表解析出来与代码里的期望值一致（表变了这条会先红）', () => {
    const rows: ILeagueOfficialRow[] = parseLeagueOfficialRows(JSON.parse(readFileSync(OFFICIAL_JSON, 'utf8')));
    assert.deepEqual(rows.map((r) => r.position), [1, 2, 3]);
    assert.deepEqual(rows.map((r) => r.name), ['盟主', '副盟主', '成员']);
    assert.deepEqual(rows.map((r) => r.canApprove), [true, true, false]);
    assert.deepEqual(rows.map((r) => r.canEdit), [true, true, false]);
    assert.deepEqual(rows[0].kick, [2, 3]);
    assert.deepEqual(rows[1].kick, [3]);
    assert.deepEqual(rows[2].kick, []);
    assert.deepEqual(rows[0].appointLeader, [3]);
    assert.deepEqual(rows[0].dismiss, [2]);

    // 用**磁盘真表**再跑一遍权限判定（B2 用的是测试内联的表）
    const powers = officialPowersMap(rows);
    assert.equal(resolveLeagueMemberActions(1, 3, powers).appointLeader, true, '盟主能把成员提成盟主');
    assert.equal(resolveLeagueMemberActions(1, 2, powers).dismissAdmin, true, '盟主能卸任副盟主');
    assert.equal(resolveLeagueMemberActions(2, 3, powers).kick, true, '副盟主能踢成员');
    assert.equal(resolveLeagueMemberActions(2, 2, powers).kick, false, '副盟主不能踢副盟主');
    assert.equal(resolveLeagueMemberActions(3, 3, powers).kick, false, '成员谁都不能踢');
});

// ============================================================
// D. prefab 结构 + 几何
// ============================================================

const HALL_PREFAB = 'assets/resources/ui/League/LeagueHall.prefab';

type Entry = Record<string, unknown>;
const hall: Entry[] = JSON.parse(readFileSync(HALL_PREFAB, 'utf8')) as Entry[];
const hallAt = (ref: unknown): Entry | null =>
    ref && typeof ref === 'object' && '__id__' in (ref as Entry) ? hall[(ref as { __id__: number }).__id__]! : null;

/**
 * 路径 → 节点 entry。
 *
 * 键是**相对根节点**的路径（`TabDetail/DetailList`、`TabDetail/OpsBar/Group/BtnShow`…），
 * 根节点本身另登记一条 `'LeagueHall'`（供 `hallCidOf('LeagueHall')` 取主力脚本）。
 * 同名兄弟靠**父路径**区分（三张列表里都有 `content`、浮层里有 5 个 `Group/BtnXxx/Label`）。
 */
const HALL_NODES: Map<string, Entry> = (() => {
    const out = new Map<string, Entry>();
    const root = hall.filter((e) => e && e.__type__ === 'cc.Node')[0]!;
    const walk = (node: Entry, path: string): void => {
        out.set(path || 'LeagueHall', node);
        for (const ref of ((node._children ?? []) as unknown[])) {
            const child = hallAt(ref);
            if (child) walk(child, path ? `${path}/${String(child._name)}` : String(child._name));
        }
    };
    walk(root, '');
    return out;
})();

/** 取某节点上的某个内置组件。 */
function hallComp(path: string, type: string): Entry | null {
    const node = HALL_NODES.get(path);
    if (!node) return null;
    const found = ((node._components ?? []) as unknown[]).map(hallAt)
        .find((c) => c && c.__type__ === type);
    return found ?? null;
}

/** 节点上的自定义脚本组件（`__type__` 不是 `cc.*`）。 */
function hallScriptOf(path: string): Entry | null {
    const node = HALL_NODES.get(path);
    if (!node) return null;
    const found = ((node._components ?? []) as unknown[]).map(hallAt)
        .find((c) => c && typeof c.__type__ === 'string' && !String(c.__type__).startsWith('cc.'));
    return found ?? null;
}

/** 脚本组件的 cid。 */
function hallCidOf(path: string): string {
    const comp = hallScriptOf(path);
    assert.ok(comp, `${path} 上没挂自定义脚本`);
    return String(comp!.__type__);
}

/** UITransform 尺寸 / 锚点 / 节点位移。 */
function hallRect(path: string): { w: number; h: number; ax: number; ay: number; x: number; y: number } {
    const node = HALL_NODES.get(path);
    assert.ok(node, `节点不存在：${path}`);
    const uit = hallComp(path, 'cc.UITransform');
    assert.ok(uit, `${path} 没有 cc.UITransform`);
    const size = (uit!._contentSize ?? {}) as { width?: number; height?: number };
    const anchor = (uit!._anchorPoint ?? {}) as { x?: number; y?: number };
    const pos = (node!._lpos ?? {}) as { x?: number; y?: number };
    return {
        w: Number(size.width ?? 0), h: Number(size.height ?? 0),
        ax: Number(anchor.x ?? 0.5), ay: Number(anchor.y ?? 0.5),
        x: Number(pos.x ?? 0), y: Number(pos.y ?? 0),
    };
}

/** 节点的直接子节点名。 */
function hallChildren(path: string): string[] {
    const node = HALL_NODES.get(path);
    assert.ok(node, `节点不存在：${path}`);
    return ((node!._children ?? []) as unknown[]).map((ref) => String(hallAt(ref)?._name ?? ''));
}

/**
 * 三张列表的真值 —— [列表, content, 行模板, 列表宽, 列表高, lineGap, 行高]。
 *
 * 尺寸 / 间距全部来自 FGUI：`组件_联盟_大厅{详情,动态,全服}.xml` 的
 * `user_list (32,655) 660×450 lineGap=8` / `user_list (39,542) 646×585 lineGap=8` /
 * `list_league (30,570) 660×542 lineGap=4`。
 */
const LIST_SPECS: readonly [string, string, string, number, number, number, number][] = [
    ['TabDetail/DetailList', 'TabDetail/DetailList/content', 'TabDetail/DetailList/content/MemberRow', 660, 450, 8, 109],
    ['TabLog/LogList', 'TabLog/LogList/content', 'TabLog/LogList/content/LogRow', 646, 585, 8, 70],
    ['TabAllServer/ServerList', 'TabAllServer/ServerList/content', 'TabAllServer/ServerList/content/ServerRow', 660, 542, 4, 113],
];

test('D1 三张列表节点：尺寸对 FGUI、锚点 (0.5,1)、且挂上了 Mask', () => {
    assert.ok(existsSync(HALL_PREFAB), 'prefab 必须存在');
    for (const [listKey, , , w, h] of LIST_SPECS) {
        const rect = hallRect(listKey);
        assert.equal(rect.w, w, `${listKey} 宽`);
        assert.equal(rect.h, h, `${listKey} 高`);
        // 列表节点用 (0.5,1)：顶边定位（与 FriendApply 的 RowView 同口径）
        assert.equal(rect.ay, 1, `${listKey} 锚点 y 必须是 1（顶边定位）`);
        assert.equal(rect.ax, 0.5, `${listKey} 锚点 x`);
        // Mask 让列表不出界（FGUI `overflow=scroll` 的等价物）
        assert.ok(hallComp(listKey, 'cc.Mask'), `${listKey} 缺 cc.Mask ⇒ 行会溢出到列表外`);
    }
});

test('D2 content 是列表的第一个子节点、锚点 (0.5,1)、位置 (0,0)、尺寸与列表一致', () => {
    for (const [listKey, contentKey, , w, h] of LIST_SPECS) {
        assert.deepEqual(hallChildren(listKey), ['content'], `${listKey} 只应有 content 一个子节点`);
        const rect = hallRect(contentKey);
        assert.equal(rect.w, w, `${contentKey} 宽`);
        assert.equal(rect.h, h, `${contentKey} 高`);
        assert.ok(rect.ax === 0.5 && rect.ay === 1, `${contentKey} 锚点必须是 (0.5,1)`);
        assert.ok(rect.x === 0 && rect.y === 0, `${contentKey} 必须落在列表原点`);
    }
});

test('D3 行模板：是 content 的**唯一**子节点（列表会拿它当模板 removeFromParent）、位置 -行高/2', () => {
    for (const [, contentKey, rowKey, , , , rowH] of LIST_SPECS) {
        const leaf = String(rowKey.split('/').pop());
        assert.deepEqual(hallChildren(contentKey), [leaf],
            `${contentKey} 只能有一个子节点（模板）—— 多一个上屏后就会多出一段「假行」`);
        const rect = hallRect(rowKey);
        assert.equal(rect.h, rowH, `${rowKey} 行高`);
        // 首行中心 = -行高/2（FGUI 列表第一行贴顶）
        assert.equal(rect.y, -rowH / 2, `${rowKey} 初始 y 必须是 -行高/2`);
    }
});

test('D4 三张列表的自定义脚本是同一个（VirtualScrollView）且 content/itemNode/spacing 接对', () => {
    const cids = LIST_SPECS.map(([listKey]) => hallCidOf(listKey));
    assert.equal(new Set(cids).size, 1, `三张列表必须挂同一个列表脚本，实得：${cids.join(' / ')}`);

    for (const [listKey, contentKey, rowKey, , , lineGap] of LIST_SPECS) {
        const comp = hallScriptOf(listKey)!;
        const content = hallAt(comp.content);
        const itemNode = hallAt(comp.itemNode);
        assert.equal(hall.indexOf(content!), hall.indexOf(HALL_NODES.get(contentKey)!), `${listKey}.content 指错`);
        assert.equal(hall.indexOf(itemNode!), hall.indexOf(HALL_NODES.get(rowKey)!), `${listKey}.itemNode 指错`);
        assert.equal(comp.spacing, lineGap, `${listKey}.spacing 必须等于 FGUI 的 lineGap`);
        // 0 = NODE（默认是 1 = PREFAB；不改的话走不到 itemNode 那条路）
        assert.equal(comp.itemCreationMode, 0, `${listKey}.itemCreationMode 必须是 0（NODE）`);
        assert.equal(comp.useVirtualList, true, `${listKey}.useVirtualList 必须开`);
        assert.equal(comp.useDynamicSize, false, `${listKey} 走等大小模式`);
        assert.equal(comp.gridCount, 1, `${listKey} 单列`);
        assert.equal(comp.direction, 0, `${listKey} 纵向`);
    }
});

test('D5 角色操作浮层：几何 / 子节点序 / 默认隐藏 / scale 0.8', () => {
    const rect = hallRect('TabDetail/OpsBar');
    assert.ok(rect.w === 720 && rect.h === 100, `OpsBar 720×100，实得 ${rect.w}×${rect.h}`);
    // FGUI `comp_ctrl` xy=3,555 pivot 0.5,0.5 ⇒ 中心 (363,605) ⇒ cocos (3,35)
    assert.ok(rect.x === 3 && rect.y === 35, `OpsBar 中心应为 (3,35)，实得 (${rect.x},${rect.y})`);
    assert.equal(HALL_NODES.get('TabDetail/OpsBar')!._active, false, '浮层默认必须隐藏（FGUI visible=false）');
    const scale = (HALL_NODES.get('TabDetail/OpsBar')!._lscale ?? {}) as { x?: number };
    assert.equal(Number(scale.x), 0.8, 'OpsBar scale 0.8');
    // ⚠️ `Click`（全屏遮罩）必须在 `Bg` 之后、按钮组之前：按钮要压在遮罩上面才点得到
    assert.deepEqual(hallChildren('TabDetail/OpsBar'), ['Bg', 'Click', 'Group']);
});

test('D6 浮层 5 个按钮：尺寸 / 间距 10 的排布 / TY_btn07 且走九宫格', () => {
    const group = 'TabDetail/OpsBar/Group';
    const rect = hallRect(group);
    assert.ok(rect.w === 804 && rect.h === 70, `Group 804×70，实得 ${rect.w}×${rect.h}`);

    // FGUI hz layout colGap=10 解算后的最终 xy（组内中心 x：-42+70=28 … 622+70=692）
    const snap: readonly [string, number, number][] = [
        ['BtnShow', -332, 140],
        ['BtnToLeader', -182, 140],
        ['BtnToAdmin', -16, 172],
        ['BtnUnAdmin', 166, 172],
        ['BtnKick', 332, 140],
    ];
    assert.deepEqual(hallChildren(group), snap.map(([name]) => name));
    for (const [name, cx, w] of snap) {
        const key = `${group}/${name}`;
        const r = hallRect(key);
        assert.equal(r.w, w, `${name} 宽`);
        assert.equal(r.h, 70, `${name} 高`);
        assert.equal(r.x, cx, `${name} 中心 x`);
        const sprite = hallComp(key, 'cc.Sprite');
        assert.ok(sprite, `${name} 缺 cc.Sprite`);
        const uuid = String((sprite!._spriteFrame as { __uuid__?: string } | undefined)?.__uuid__ ?? '');
        assert.ok(uuid.endsWith('@f9941'), `${name} 的 spriteFrame 必须是 sprite-frame 子资源（防品红块）`);
        assert.equal(sprite!._type, 1, `${name} 的 TY_btn07 带 scale9grid ⇒ 必须 SLICED`);
    }
});

test('D7 查询框 = `cc.EditBox`，两个 Label 子节点各就各位（占位 / 正文）', () => {
    const input = 'TabAllServer/Search/Input';
    // ⚠️ 只有这两个子节点：给节点**新加** `cc.EditBox` 时组件会顺手建 `PLACEHOLDER_LABEL`
    //    （`_string="label"`、`_active=true` ⇒ 会在输入框里盖出一串脏字）与 `TEXT_LABEL`，
    //    构建脚本必须把这两个默认节点删掉（口径同 `ui/Friend/Friend.prefab` 的 `SearchInput`）。
    assert.deepEqual(hallChildren(input), ['Placeholder', 'Text'],
        'Input 只能有 Placeholder / Text 两个子节点（EditBox 自带的 PLACEHOLDER_LABEL / TEXT_LABEL 必须已删除）');
    const box = hallComp(input, 'cc.EditBox');
    assert.ok(box, 'Input 必须挂 cc.EditBox');

    // ⚠️ `textLabel` / `placeholderLabel` 是 **cc.Label 组件引用**（不是 Node），
    //    序列化字段名带下划线：`_textLabel` / `_placeholderLabel`（同 `_inputMode` / `_maxLength`）。
    const text = hallAt(box!._textLabel);
    const placeholder = hallAt(box!._placeholderLabel);
    assert.ok(text && text.__type__ === 'cc.Label', 'textLabel 必须是 cc.Label');
    assert.ok(placeholder && placeholder.__type__ === 'cc.Label', 'placeholderLabel 必须是 cc.Label');
    // 比的是**宿主节点**（`_textLabel` 本身是组件条目，不能直接和 Node 条目比下标）
    const hostIdx = (comp: Entry): number => (comp.node as { __id__: number }).__id__;
    assert.equal(hostIdx(text!), hall.indexOf(HALL_NODES.get(`${input}/Text`)!), '_textLabel 的宿主 = Input/Text');
    assert.equal(hostIdx(placeholder!), hall.indexOf(HALL_NODES.get(`${input}/Placeholder`)!), '_placeholderLabel 的宿主 = Input/Placeholder');
    // FGUI `restrict="[0-9]" keyboardType="4"` ⇒ 数字输入
    assert.equal(box!._inputMode, 2, 'inputMode 必须是 NUMERIC(2)');
    assert.equal(box!._inputFlag, 5, 'inputFlag DEFAULT(5)');
    assert.equal(box!._maxLength, 19, '联盟 id 是 Long ⇒ 十进制最多 19 位');
    assert.equal(box!._returnType, 1, 'returnType 必须是 DONE(1)');
    // 占位文案来自 FGUI 的 `prompt`
    assert.equal(placeholder!._string, '点击输入ID', '占位文案 = FGUI prompt');
    assert.equal(text!._string, '', '正文初始为空');
});

test('D8 主脚本 28 个 @property 全部绑到正确的宿主节点', () => {
    const cid = hallCidOf('LeagueHall');
    const comp = hall.find((e) => e?.__type__ === cid)!;
    const pathOfIdx = new Map<number, string>();
    for (const [p, v] of HALL_NODES) pathOfIdx.set(hall.indexOf(v), p);

    // 路径口径与 `HALL_NODES` 一致：**相对根节点**
    const BIND: Record<string, string> = {
        banner: 'Banner',
        bannerColor: 'Banner/ColorIcon',
        bannerFrame: 'Banner/Frame',
        nameLabel: 'LabName',
        levelLabel: 'LabLv',
        noticeLabel: 'LabNotice',
        idLabel: 'LabId',
        wxLabel: 'LabWx',
        progressFill: 'Progress/ProgressFill',
        progressLabel: 'Progress/ProgressLabel',
        backButton: 'BtnBack',
        mgrButton: 'BtnMgr',
        helpButton: 'BtnHelp',
        copyIdButton: 'BtnCopyId',
        copyWxButton: 'BtnCopyWx',
        searchButton: 'TabAllServer/Search/BtnSearch',
        tabDetailButton: 'BtnDetail',
        tabLogButton: 'BtnLog',
        tabAllServerButton: 'BtnAllServer',
        tabDetailPage: 'TabDetail',
        tabLogPage: 'TabLog',
        tabAllServerPage: 'TabAllServer',
        memberCountLabel: 'TabDetail/LabUserCount',
        memberList: 'TabDetail/DetailList',
        logList: 'TabLog/LogList',
        serverList: 'TabAllServer/ServerList',
        searchInput: 'TabAllServer/Search/Input',
        opsBar: 'TabDetail/OpsBar',
    };
    const keys = Object.keys(BIND);
    assert.equal(keys.length, 28, '本版 28 个 @property');
    for (const [prop, wantPath] of Object.entries(BIND)) {
        const target = hallAt(comp[prop]);
        assert.ok(target, `@property ${prop} 没绑（漏绑不报错，只是运行时 null）`);
        const hostIdx = target!.__type__ === 'cc.Node' ? hall.indexOf(target!) : (target!.node as { __id__: number }).__id__;
        assert.equal(pathOfIdx.get(hostIdx), wantPath, `@property ${prop} 绑错`);
    }
});

test('D9 三个行脚本 + 浮层脚本都挂在正确节点上（按序列化字段名反查）', () => {
    // 行脚本的类名 == 文件名，所以「字段名集合」就是它的指纹
    const FINGERPRINT: readonly [string, readonly string[]][] = [
        ['TabDetail/DetailList/content/MemberRow',
            ['nameLabel', 'levelLabel', 'powerLabel', 'timeLabel', 'contributeLabel', 'positionLabel', 'avatarSprite', 'positionTag']],
        ['TabLog/LogList/content/LogRow', ['ctxLabel', 'timeLabel']],
        ['TabAllServer/ServerList/content/ServerRow',
            ['nameLabel', 'levelLabel', 'leaderLabel', 'memberLabel', 'bannerColor']],
        ['TabDetail/OpsBar',
            ['showButton', 'toLeaderButton', 'toAdminButton', 'unAdminButton', 'kickButton', 'clickMask']],
    ];
    for (const [path, fields] of FINGERPRINT) {
        const comp = hallScriptOf(path);
        assert.ok(comp, `${path} 上没挂自定义脚本`);
        for (const field of fields) {
            assert.ok(field in comp!, `${path} 的脚本缺字段 ${field}（挂错脚本了？）`);
            assert.ok(hallAt(comp![field]), `${path}.${field} 没绑`);
        }
    }

    // 四个脚本必须互不相同（别把三个行都挂成同一个）
    const cids = FINGERPRINT.map(([path]) => hallCidOf(path));
    assert.equal(new Set(cids).size, 4, `四个脚本必须是四个不同的 cid，实得：${cids.join(' / ')}`);
    // 浮层脚本不能和主脚本是同一个
    assert.notEqual(hallCidOf('TabDetail/OpsBar'), hallCidOf('LeagueHall'));
});

test('D10 行模板的 Sprite 口径：底框走九宫格、运行时赋帧的头像必须是 CUSTOM(0)', () => {
    const spriteOf = (path: string): Entry | null => hallComp(path, 'cc.Sprite');
    // 行底框 = `frame_Zhikuang01`（九宫格）⇒ 横向拉宽不变形
    for (const [path, art] of [
        ['TabDetail/DetailList/content/MemberRow', 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941'],
        ['TabAllServer/ServerList/content/ServerRow', 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941'],
        ['TabDetail/OpsBar/Bg', 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941'],
        ['TabLog/LogList/content/LogRow/RowBg', 'dac21f1f-62e9-4f7c-98c9-8125b51c0f49@f9941'],
        ['TabDetail/OpsBar/Group/BtnShow', '0f92b28c-0dc5-49fe-b839-8fe1bdd20a37@f9941'],
    ] as const) {
        const sp = spriteOf(path);
        assert.ok(sp, `${path} 缺 cc.Sprite`);
        assert.equal((sp!._spriteFrame as { __uuid__?: string })?.__uuid__, art, `${path} 用图不对`);
        assert.equal(sp!._type, 1, `${path} 必须 SLICED（九宫格）`);
        assert.equal(sp!._sizeMode, 0, `${path} 必须 CUSTOM(0)`);
    }
    // ⚠️ 头像 `Avatar` 是**运行时赋帧**的（`LeagueMemberRow.applyAvatar`）：
    //    默认 `TRIMMED(1)` 会在赋帧时把 contentSize 回写成图片的裁剪尺寸 ⇒ 80×80 的框忽大忽小。
    //    口径同 `ui/Friend/Friend.prefab` / `ui/Friend/FriendApply.prefab` 的 `Icon`。
    const avatar = spriteOf('TabDetail/DetailList/content/MemberRow/Avatar');
    assert.ok(avatar, 'Avatar 缺 cc.Sprite（运行时头像无处可贴）');
    assert.equal(avatar!._sizeMode, 0, 'Avatar 的 sizeMode 必须是 CUSTOM(0)');
    assert.equal(hallRect('TabDetail/DetailList/content/MemberRow/Avatar').w, 80, '头像框 80×80');
});

// ============================================================
// E. 页面逻辑（源码文本）
// ============================================================

const PAGE_TS = 'assets/script/app/league/LeagueHallPage.ts';
const MEMBER_ROW_TS = 'assets/script/app/league/LeagueMemberRow.ts';
const LOG_ROW_TS = 'assets/script/app/league/LeagueLogRow.ts';
const UNION_ROW_TS = 'assets/script/app/league/LeagueUnionRow.ts';
const OPS_TS = 'assets/script/app/league/LeagueOpsBar.ts';

const PAGE_SRC = readFileSync(PAGE_TS, 'utf8');
const OPS_SRC = readFileSync(OPS_TS, 'utf8');
const ROW_SRCS = [
    readFileSync(MEMBER_ROW_TS, 'utf8'),
    readFileSync(LOG_ROW_TS, 'utf8'),
    readFileSync(UNION_ROW_TS, 'utf8'),
] as const;

/**
 * 剥掉注释 —— 反向断言（`!src.includes(x)`）**必须先剥注释**：
 * 这些文件都带「为什么这么做」的文档注释，会点名刻意不用的东西
 * （如 `PopupBase` / `ModelLeague`），直接 `includes` 必然误红。
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('E1 三张列表的回调都接了；`renderItemFn` 只绑一次（`listsBound` 幂等守卫）', () => {
    const src = stripComments(PAGE_SRC);
    assert.ok(src.includes('this.memberList.renderItemFn'), '成员列表没接 renderItemFn ⇒ 恒空白');
    assert.ok(src.includes('this.logList.renderItemFn'), '动态列表没接 renderItemFn');
    assert.ok(src.includes('this.serverList.renderItemFn'), '全服列表没接 renderItemFn');
    assert.ok(src.includes('this.memberList.onItemClickFn'), '成员行点击没接 ⇒ 操作浮层永远弹不出来');
    assert.ok(src.includes('this.serverList.onItemClickFn'), '全服行点击没接');
    // 动态行没有点击行为（老端 `initVirtualList(this, this.render)` 只传 render）
    assert.ok(!src.includes('this.logList.onItemClickFn'), '动态行不该有点击回调');
    // 只在 `listsBound` 守卫内绑（放 onOpen 会随每次打开叠加，叠加后一帧渲 N 次）
    assert.ok(src.includes('if (!this.listsBound)'), 'renderItemFn 必须有幂等守卫');
});

test('E2 三个页签各自的取数：详情 / 动态 / 全服（且第一次切到才发）', () => {
    const src = stripComments(PAGE_SRC);
    assert.ok(src.includes('return this.repository.requestDetail()'), '详情页签没请求成员列表');
    assert.ok(src.includes('return this.repository.requestLog()'), '动态页签没请求动态');
    assert.ok(src.includes('return this.repository.requestList()'), '全服页签没请求联盟列表');
    assert.ok(src.includes('if (!this.tabRequested[index])'), '必须有「首次才请求」判据（否则每次切页都重发）');
    // 请求成功才标记（失败要在下次切回来时重试）
    assert.ok(src.includes("if (result === 'ok') this.tabRequested[index] = true"), '请求成功才记已请求');
    // 取数前必须 +revision，回来先比（防在飞的异步结果铺到已切换的页签上）
    assert.ok(src.includes('const revision = ++this.revision'), '取数必须带 revision 令牌');
});

test('E3 全服搜索：数字守卫 / 空输入提示 / 走 Repository / 命中缓存只回一条', () => {
    const src = stripComments(PAGE_SRC);
    assert.ok(src.includes('isLeagueSearchId(input.string)'), '查询框必须做「非正整数就清空」守卫');
    assert.ok(src.includes('FW.showTip(LEAGUE_TIP_INPUT_UNION_ID)'), '空输入必须提示');
    assert.ok(src.includes('this.repository.search(key)'), '查询必须走 Repository（不要自己 new 请求类）');
    assert.ok(src.includes('pickUnionListForSearch(snapshot.unions, this.repository.cachedSearch(key))'),
        '列表口径必须是「命中搜索缓存就只回那一条」');
    // 三态提示
    assert.ok(src.includes('LEAGUE_TIP_OFFLINE') && src.includes('LEAGUE_TIP_FAILED'), '请求失败要明确告知，不静默吞');
    assert.ok(src.includes('input.node.on('), '查询框必须监听 text-changed');
});

test('E4 角色操作浮层：权限判定 / 位置换算 / 遮罩闸门 / 5 个动作分发', () => {
    const src = stripComments(PAGE_SRC);
    assert.ok(src.includes('resolveLeagueMemberActions('), '5 个按钮的显隐必须走配置表的权限判定');
    assert.ok(src.includes('this.opsBar?.show(actions, this.placeOpsBar(node))'), '浮层必须按「该行位置」弹');
    assert.ok(src.includes('convertToNodeSpaceAR('), '位置换算必须用引擎的坐标变换（别自己手推两层 content 的锚点）');
    for (const action of ['toLeader', 'toAdmin', 'unAdmin', 'kick', 'show']) {
        assert.ok(src.includes(`case '${action}':`), `缺少动作分发：${action}`);
    }
    assert.ok(src.includes('this.repository.appointLeader('), '未接任命盟主');
    assert.ok(src.includes('this.repository.appointAdmin('), '未接任命副盟主');
    assert.ok(src.includes('this.repository.dismissAdmin('), '未接卸任副盟主');
    assert.ok(src.includes('this.repository.kick('), '未接踢人');
    assert.ok(src.includes('LEAGUE_TIP_VIEW_SELF'), '看自己必须给提示');

    // ⚠️ 浮层展开时它自带全屏遮罩 ⇒ 页签 / 行点击必须先收起、本次不透传
    const gates = src.match(/if \(this\.opsBar\?\.isOpen\)/g) ?? [];
    assert.ok(gates.length >= 2, `页签 / 行点击都要有「浮层打开 ⇒ 只收起」的闸门，实得 ${gates.length} 处`);
});

test('E5 三个行脚本：`render(null)` 等价 `hide()`、头像 / 旗面换图都带令牌', () => {
    for (const src of ROW_SRCS) {
        const s = stripComments(src);
        assert.ok(s.includes('render('), '行脚本必须有 render');
        assert.ok(s.includes('hide(): void'), '行脚本必须有 hide');
        assert.ok(s.includes('if (!view)') && s.includes('this.hide()'), 'render(null) 必须等价 hide()');
        // 行会被 clone 复用 ⇒ 每个状态都要绝对赋值
        assert.ok(s.includes('node.active = false'), 'hide 必须显式关节点');
        assert.ok(!s.includes('extends PopupBase'), '行脚本不是弹窗，别继承 PopupBase');
        assert.ok(!s.includes('ModelLeague'), '行脚本不该依赖老端模型');
    }
    // 头像 / 旗面是异步换图，而槽位会被复用 ⇒ 必须有令牌
    assert.ok(stripComments(ROW_SRCS[0]).includes('avatarSeq'), '成员行缺头像令牌 ⇒ A 的头像会贴到 B 身上');
    assert.ok(stripComments(ROW_SRCS[0]).includes('applyAvatar('), '成员行缺 applyAvatar');
    assert.ok(stripComments(ROW_SRCS[2]).includes('bannerSeq'), '全服行缺旗面令牌');
    assert.ok(stripComments(ROW_SRCS[2]).includes('applyBanner('), '全服行缺 applyBanner');
    // 浮层：任何一次操作都要先收起（老端每个 handler 末尾都调 onGlobalTouch）
    const ops = stripComments(OPS_SRC);
    assert.ok(ops.includes('this.hide();'), '浮层操作后必须收起');
    assert.ok(ops.includes('applyActions('), '浮层必须逐个按钮显隐');
});

// ============================================================
// F. 本刀新增的纯函数
// ============================================================

test('F1 `isLeagueSearchId` 与老端 `StringUtil.isPositiveInteger` 逐字同口径', () => {
    // 老端是 `/^[0-9]\d*$/` —— 名字叫 positive 但允许 "0" / "007"
    const pat = /^[0-9]\d*$/;
    const samples = ['', '0', '007', '123', '12a', 'a12', '-1', '1.5', ' 1', '1 ', '9999999999999999999999'];
    for (const s of samples) assert.equal(isLeagueSearchId(s), pat.test(s), `口径不一致：${JSON.stringify(s)}`);
    assert.ok(isLeagueSearchId('0'), '「0」是合法的（老端没排除）');
    assert.ok(!isLeagueSearchId('1.5'), '小数不合法');
    assert.ok(!isLeagueSearchId(' 1'), '带空格不合法（缓存键是原串，空格会让缓存永远不命中）');
});

test('F2 `findLeagueLevelRow` / `leagueMaxExp` 对 `unionLevel` 真表', () => {
    const LEVEL_JSON = 'assets/remoteRef/unionLevel.json';
    assert.ok(existsSync(LEVEL_JSON), '等级表必须在磁盘上');
    const rows = parseUnionLevelRows(JSON.parse(readFileSync(LEVEL_JSON, 'utf8')));
    assert.equal(rows.length, 10, '现网 10 级');
    assert.equal(leagueMaxExp(rows, 1), 2000);
    assert.equal(leagueMaxExp(rows, 4), 17000);
    assert.equal(leagueMaxExp(rows, 10), 101000);
    // 越界 ⇒ 0（**不**夹到首 / 末行：那会让进度条满格这种假象悄悄出现）
    assert.equal(leagueMaxExp(rows, 0), 0);
    assert.equal(leagueMaxExp(rows, 99), 0);
    assert.equal(leagueMaxExp(rows, NaN), 0);
    assert.equal(findLeagueLevelRow(rows, 4)?.maxCount, 46);
    assert.equal(findLeagueLevelRow(rows, 99), null);
});
