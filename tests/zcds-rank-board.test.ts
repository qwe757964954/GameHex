/**
 * 对局内排行榜数据层（`model/ZCRankBoard`）的回归网。
 *
 * 规则 78：本模块禁 `import 'cc'` ⇒ 这份用例能**在 Node 下真跑**，不是源码断言。
 *
 * 三段：
 *   A. 排序 —— 地块数降序；同分按席位序（稳定，不闪）。
 *   B. 「比赛中…」态—— 设计稿的一态，不是异常。
 *   C. 徽章/底板映射 —— 前三名有图，第四名起必须退化成数字。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildRankSeats,
    buildSeatProfiles,
    RANK_FALLBACK_NAMES,
    RANK_PLAYING_TEXT,
    RANK_SEAT_ORDER,
    compareRankSeats,
    rankBadgeKeyOf,
    rowBackgroundKeyOf,
    type IRankSeat,
} from '../assets/script/app/zcds/model/ZCRankBoard';
import type { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';

/** 后端席位的最小形状（对齐 `ZCBattleUnit` 里用到的字段）。 */
interface Seat {
    campId: number;
    roleId: string;
    name: string;
    avatarId: string;
}

function seats(...list: Seat[]): Seat[] {
    return list;
}

type Profiles = Map<ZCOwner, { name: string; headKey: string }>;

function profiles(entries: Partial<Record<ZCOwner, { name: string; headKey: string }>>): Profiles {
    return new Map(Object.entries(entries) as [ZCOwner, { name: string; headKey: string }][]);
}

/** 按 owner → 地块数造一个取数函数。 */
function counter(table: Partial<Record<ZCOwner, number>>): (owner: ZCOwner) => number {
    return (owner) => table[owner] ?? 0;
}

// ── A. 排序 ─────────────────────────────────────────────────────────────

test('排行按地块数降序，名次从 1 连续编号', () => {
    const seats = buildRankSeats(
        ['player', 'enemy'],
        counter({ player: 12, enemy: 30 }),
        profiles({}),
        false,
    );
    assert.equal(seats[0].owner, 'enemy');
    assert.equal(seats[0].rank, 1);
    assert.equal(seats[0].territoryCount, 30);
    assert.equal(seats[1].owner, 'player');
    assert.equal(seats[1].rank, 2);
});

test('同分时按席位序（player → enemy → enemy2 → enemy3），顺序稳定不闪', () => {
    // ⚠️ 稳定性不是"锦上添花"：虚拟列表按 index 现取行，
    // 同分顺序每帧变 ⇒ 行内容与节点错位 ⇒ 肉眼看到整列在跳。
    const owners: ZCOwner[] = ['enemy3', 'enemy2', 'enemy', 'player'];
    const counts: Record<ZCOwner, number> = { player: 7, enemy: 7, enemy2: 7, enemy3: 7 };
    const first = buildRankSeats(owners, counter(counts), profiles({}), false);
    assert.deepEqual(first.map((s) => s.owner), ['player', 'enemy', 'enemy2', 'enemy3']);
    // 换个完全不同的输入顺序，结果必须一致（纯排序，不依赖入参顺序）。
    const second = buildRankSeats(
        ['enemy', 'enemy3', 'player', 'enemy2'],
        counter(counts),
        profiles({}),
        false,
    );
    assert.deepEqual(second.map((s) => s.owner), first.map((s) => s.owner));
});

test('compareRankSeats 单独可测：降序 + 同分按席位序', () => {
    const base: IRankSeat = {
        owner: 'player', rank: 1, name: '', headKey: '', territoryCount: 5, isPlaying: false,
    };
    const more: IRankSeat = { ...base, owner: 'enemy', territoryCount: 9 };
    assert.ok(compareRankSeats(base, more) > 0, '地块少的排后面');
    assert.ok(compareRankSeats(more, base) < 0, '地块多的排前面');
    const later: IRankSeat = { ...base, owner: 'enemy2' };
    assert.ok(compareRankSeats(base, later) < 0, '同分时 player 在 enemy2 前');
});

// ── B. 「比赛中…」态 ────────────────────────────────────────────────────

test('对局进行中且 0 块 ⇒ isPlaying，且地块数为 0（不是"显示 0"由视图决定）', () => {
    const [seat] = buildRankSeats(['player'], counter({ player: 0 }), profiles({}), false);
    assert.equal(seat.isPlaying, true);
    assert.equal(seat.territoryCount, 0);
    // 文案是常量，视图直接用；这里钉住"不能被改成空串"。
    assert.equal(RANK_PLAYING_TEXT, '比赛中…');
});

test('对局结束后一律 isPlaying=false（结算界面还写「比赛中」是错的）', () => {
    const seats = buildRankSeats(
        ['player', 'enemy'],
        counter({ player: 0, enemy: 0 }),
        profiles({}),
        true,
    );
    assert.deepEqual(seats.map((s) => s.isPlaying), [false, false]);
});

test('有地块 ⇒ 不是比赛中态', () => {
    const [seat] = buildRankSeats(['player'], counter({ player: 3 }), profiles({}), false);
    assert.equal(seat.isPlaying, false);
});

// ── C. 徽章 / 底板映射 ──────────────────────────────────────────────────

test('名次徽章只有前三名有图，第四名起必须退化（不能拿第 3 张糊）', () => {
    assert.equal(rankBadgeKeyOf(1), 'icon_01');
    assert.equal(rankBadgeKeyOf(2), 'icon_02');
    assert.equal(rankBadgeKeyOf(3), 'icon_03');
    // ⚠️ 这条最容易漏：4~N 名返回空串，视图据此关徽章、显数字。
    assert.equal(rankBadgeKeyOf(4), '');
    assert.equal(rankBadgeKeyOf(10), '');
});

test('行底板：第一名单独高亮底，其余共用', () => {
    assert.equal(rowBackgroundKeyOf(1), 'phb_list_01');
    assert.equal(rowBackgroundKeyOf(2), 'phb_list_02');
    assert.equal(rowBackgroundKeyOf(4), 'phb_list_02');
});

// ── D. 档案与兜底 ───────────────────────────────────────────────────────

test('席位档案取名字与头像键；缺项用兜底名 + 空头像', () => {
    const seats = buildRankSeats(
        ['player', 'enemy'],
        counter({ player: 1, enemy: 2 }),
        profiles({ player: { name: '山猫', headKey: 'head_1001' } }),
        false,
    );
    const me = seats.find((s) => s.owner === 'player')!;
    const foe = seats.find((s) => s.owner === 'enemy')!;
    assert.equal(me.name, '山猫');
    assert.equal(me.headKey, 'head_1001');
    // enemy 没给档案 ⇒ 兜底名 + 空头像键（视图据此保留 prefab 默认头像，不清空）。
    assert.equal(foe.name, RANK_FALLBACK_NAMES.enemy);
    assert.equal(foe.headKey, '');
});

test('2~4 人局都要能排（席位序覆盖全部四种 owner）', () => {
    for (const owners of [
        ['player', 'enemy'],
        ['player', 'enemy', 'enemy2'],
        ['player', 'enemy', 'enemy2', 'enemy3'],
    ] as ZCOwner[][]) {
        const seats = buildRankSeats(owners, counter({}), profiles({}), false);
        assert.equal(seats.length, owners.length);
        assert.deepEqual(seats.map((s) => s.rank), seats.map((_, i) => i + 1));
    }
});

// ── E. 与真实席位序一致（防止两份常量漂移）─────────────────────────────

test('★RANK_SEAT_ORDER 必须与 ZC_OWNER_ORDER 一致（两份常量不许漂移）', () => {
    // 本模块刻意**不 import** ZC_OWNER_ORDER（规则 167：跨层值导入会让
    // zcds-view-fixtures 的 load 落进兜底分支报 ENOENT），代价就是要用这条钉住。
    const src = readFileSync('assets/script/app/zcds/model/ZCMapConfig.ts', 'utf8');
    const m = /ZC_OWNER_ORDER[^=]*=\s*\[([^\]]*)\]/.exec(src);
    assert.ok(m, 'ZCMapConfig 里找不到 ZC_OWNER_ORDER');
    const real = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    assert.deepEqual([...RANK_SEAT_ORDER], real, '★RANK_SEAT_ORDER 与 ZC_OWNER_ORDER 不一致 ⇒ 排序会错');
});

// ── F. 席位档案映射（buildSeatProfiles）────────────────────────────────
// 这段是「3~4 人局 enemy2/enemy3 被静默丢掉」的回归网。

test('F: 2 人局 ⇒ player + enemy 两档', () => {
    const profiles = buildSeatProfiles(
        seats(
            { campId: 1, roleId: 'r1', name: '山猫', avatarId: 'a1' },
            { campId: 2, roleId: 'r2', name: '敌方甲', avatarId: 'a2' },
        ),
        'r1',
    );
    assert.equal(profiles.size, 2);
    assert.equal(profiles.get('player')?.name, '山猫');
    assert.equal(profiles.get('enemy')?.name, '敌方甲');
});

test('★F: 4 人局 enemy2/enemy3 必须都有档（原实现只取 sorted[0]/[1] 会丢掉）', () => {
    const profiles = buildSeatProfiles(
        seats(
            { campId: 1, roleId: 'r1', name: '我', avatarId: 'a1' },
            { campId: 2, roleId: 'r2', name: '乙', avatarId: 'a2' },
            { campId: 3, roleId: 'r3', name: '丙', avatarId: 'a3' },
            { campId: 4, roleId: 'r4', name: '丁', avatarId: 'a4' },
        ),
        'r1',
    );
    // ⚠️ 这条是本组存在的理由：size 必须是 4。少一个就是 bug 复发。
    assert.equal(profiles.size, 4, '4 人局必须建出 4 档（enemy2/enemy3 不许被丢）');
    assert.equal(profiles.get('enemy2')?.name, '丙');
    assert.equal(profiles.get('enemy3')?.name, '丁');
});

test('F: 自己那一席映射到 player（哪怕 campId 不是 1）', () => {
    // 后端可能把自己放在任意 campId；`player` 槽必须是自己，
    // 否则排行榜第一行显示成别人的名字，而"我方"的配色/标识会错位。
    const profiles = buildSeatProfiles(
        seats(
            { campId: 2, roleId: 'r2', name: '我', avatarId: 'a1' },
            { campId: 1, roleId: 'r1', name: '乙', avatarId: 'a2' },
        ),
        'r2',
    );
    assert.equal(profiles.get('player')?.name, '我');
    // campId=1 的那位是敌方，占 enemy 槽。
    assert.equal(profiles.get('enemy')?.name, '乙');
});

test('F: campId 非法（0 / 越界）跳过，不猜它属于谁', () => {
    // 下标硬凑会在 campId 缺 1 时整体错位；`ownerForSection` 已做边界校验。
    const profiles = buildSeatProfiles(
        seats(
            { campId: 1, roleId: 'r1', name: '我', avatarId: 'a1' },
            { campId: 0, roleId: 'r0', name: '坏1', avatarId: 'x' },
            { campId: 9, roleId: 'r9', name: '坏2', avatarId: 'x' },
        ),
        'r1',
    );
    assert.equal(profiles.size, 1, '非法 campId 必须被跳过');
    assert.equal(profiles.get('player')?.name, '我');
});

test('F: 传进来的顺序打乱 ⇒ 结果不变（函数内自己按 campId 排）', () => {
    const ordered = buildSeatProfiles(
        seats(
            { campId: 1, roleId: 'r1', name: '甲', avatarId: 'a1' },
            { campId: 2, roleId: 'r2', name: '乙', avatarId: 'a2' },
            { campId: 3, roleId: 'r3', name: '丙', avatarId: 'a3' },
        ),
        'r1',
    );
    const shuffled = buildSeatProfiles(
        seats(
            { campId: 3, roleId: 'r3', name: '丙', avatarId: 'a3' },
            { campId: 1, roleId: 'r1', name: '甲', avatarId: 'a1' },
            { campId: 2, roleId: 'r2', name: '乙', avatarId: 'a2' },
        ),
        'r1',
    );
    assert.deepEqual([...shuffled.keys()], [...ordered.keys()]);
    assert.equal(shuffled.get('enemy2')?.name, '丙');
});

test('F: 名字/头像缺失 ⇒ 兜底名 + 空头像键（视图据此保留 prefab 默认）', () => {
    const profiles = buildSeatProfiles(
        seats({ campId: 1, roleId: 'r1', name: '', avatarId: '' }),
        'r1',
    );
    assert.equal(profiles.get('player')?.name, RANK_FALLBACK_NAMES.player);
    assert.equal(profiles.get('player')?.headKey, '');
});

test('F: selfRoleId 为 null（观战 / 未匹配到）⇒ 按 campId 顺序占槽，不硬塞 player', () => {
    const profiles = buildSeatProfiles(
        seats(
            { campId: 1, roleId: 'r1', name: '甲', avatarId: 'a1' },
            { campId: 2, roleId: 'r2', name: '乙', avatarId: 'a2' },
        ),
        null,
    );
    assert.equal(profiles.size, 2);
    assert.equal(profiles.get('player')?.name, '甲', '没有自己 ⇒ campId=1 占 player 槽');
    assert.equal(profiles.get('enemy')?.name, '乙');
});

test('F: 空 units ⇒ 空表（不抛，弹窗据此显示空榜）', () => {
    assert.equal(buildSeatProfiles([], 'r1').size, 0);
});
