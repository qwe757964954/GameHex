import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 需求（2026-10-27）：**玩家被击杀后，HUD 左侧那一行的头像要按美术稿压黑**。
 *
 * 口径三条（对应三组用例）：
 *  1. 压黑走 `Sprite.color` **相乘**（保留原画明暗），不是盖半透明黑块，也不用 `UIOpacity`；
 *  2. 头像（`HeadIcon`）与席位圆盘（`HeadFrame`）**一起**压 —— 出局席位不该再靠席位色抢注意力；
 *  3. 名字仍然按席位色 —— 「这是谁」这条信息不能因为出局而丢。
 *
 * 判据与顶部四格的「红 X」同源（`territoryCountOf(owner) <= 0`），由 `ZCGameHUDView`
 * 通过 `paintPlayerRows` 的第三参注入；选点阶段是 `null` ⇒ 四行都不压黑。
 */
const ROOT = join(__dirname, '..');

/** 造一条玩家行：所有 `@property` 引用换成可观测的桩（口径同 `zcds-hud.test.ts`）。 */
function makeRow() {
    const { load, FakeNode, cc } = loadViews();
    const row = new (load('./ZCGameHudPlayerRow').ZCGameHudPlayerRow)();
    /** 每次写 `color` 计数：用来证明「只在状态翻转时写」，不是每帧重写。 */
    const sprite = () => {
        const target: any = {
            node: new FakeNode('sprite'),
            spriteFrame: null,
            color: new cc.Color(255, 255, 255, 255),
            colorWrites: 0,
        };
        return new Proxy(target, {
            set(object: any, key: string, value: any) {
                if (key === 'color') object.colorWrites += 1;
                object[key] = value;
                return true;
            },
        });
    };
    row.headFrame = sprite();
    row.headIcon = sprite();
    row.discRect = { setContentSize: () => {} } as any;
    row.headRect = { setContentSize: () => {} } as any;
    row.nameText = { string: '', color: null, node: new FakeNode('NameText') } as any;
    row.unitIcon = sprite();
    row.unitText = { string: '', node: new FakeNode('UnitText') } as any;
    row.buffA = sprite();
    row.buffB = sprite();
    // 四张圆盘图：席位 → 图的映射不参与本需求，给可辨识的占位符即可。
    row.disc01 = 'disc01' as any;
    row.disc02 = 'disc02' as any;
    row.disc03 = 'disc03' as any;
    row.disc04 = 'disc04' as any;
    const theme = load('./ZCTheme');
    const { ZCOwner } = load('../model/ZCMapConfig');
    return { row, theme, ZCOwner, cc };
}

function rowData(owner: any, dead: boolean) {
    return {
        owner,
        name: '山猫',
        head: null,
        unitText: '14/100',
        buffA: null,
        buffB: null,
        dead,
    };
}

const rgb = (color: any) => [color.r, color.g, color.b, color.a];

// ============================================================
// 一、常量口径：压得够深、仍能看出是谁
// ============================================================

test('压黑色是「深灰」：72/255 三通道相等、全不透明，明显暗于白（不是稍微压一点）', () => {
    const { load } = loadViews();
    const { ZC_HUD_DEAD_AVATAR_TINT } = load('./ZCTheme');

    assert.deepEqual(rgb(ZC_HUD_DEAD_AVATAR_TINT), [72, 72, 72, 255], '三通道相等才是"中性压黑"，带色偏就成了染色');
    // 亮度上限：美术稿上出局头像只剩轮廓。>0.35 就还是"亮"的，读不出"死了"。
    assert.ok(ZC_HUD_DEAD_AVATAR_TINT.r / 255 <= 0.35, '压黑要够深');
    // 下限：压成全黑就看不出是哪个头像了（头像图本身有暗部，乘 0 之后全糊成一块）。
    assert.ok(ZC_HUD_DEAD_AVATAR_TINT.r / 255 >= 0.2, '不能压到接近全黑');
});

test('机制：相乘压黑（改 Sprite.color），不盖黑块、不动 UIOpacity', () => {
    const rowSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameHudPlayerRow.ts'), 'utf8');
    const themeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCTheme.ts'), 'utf8');

    assert.match(rowSource, /this\.headFrame\.color = avatarTint;/, '圆盘也要压（只压头像会留下一个亮圈）');
    assert.match(rowSource, /this\.headIcon\.color = avatarTint;/, '头像压黑');
    assert.match(rowSource, /avatarTint = dead \? ZC_HUD_DEAD_AVATAR_TINT : ZC_CLIENT_COLORS\.white;/, '存活要能归位到白');
    // 反例守卫：盖黑块 / 调透明度都不是这条需求的做法（前者洗掉圆盘席位色且要多挂节点）。
    assert.ok(!/UIOpacity/.test(rowSource), '不许用 UIOpacity 做压黑（那会把名字一起压暗）');
    assert.ok(!/addChild\(.*[Dd]ead|CreateDeadMask|deadMask/.test(rowSource), '不许新增"黑块"节点');
    assert.match(themeSource, /export const ZC_HUD_DEAD_AVATAR_TINT = new Color\(72, 72, 72, 255\);/, '深浅只留一处可调');
});

// ============================================================
// 二、行为：只在状态翻转时写一次、头像与圆盘同步
// ============================================================

test('头像与圆盘一起压黑：出局瞬间两个都变 72，再切回存活都归白', () => {
    const { row, theme, ZCOwner } = makeRow();
    const dead = rgb(theme.ZC_HUD_DEAD_AVATAR_TINT);
    const white = rgb(theme.ZC_CLIENT_COLORS.white);

    row.render(rowData(ZCOwner.Enemy, false));
    assert.deepEqual(rgb(row.headFrame.color), white, '存活：圆盘不压');
    assert.deepEqual(rgb(row.headIcon.color), white, '存活：头像不压');

    row.render(rowData(ZCOwner.Enemy, true));
    assert.deepEqual(rgb(row.headFrame.color), dead, '出局：圆盘压黑');
    assert.deepEqual(rgb(row.headIcon.color), dead, '出局：头像压黑');

    row.render(rowData(ZCOwner.Enemy, false));
    assert.deepEqual(rgb(row.headFrame.color), white, '复归存活：圆盘回白');
    assert.deepEqual(rgb(row.headIcon.color), white, '复归存活：头像回白');
});

test('只在「翻转」时写颜色：状态没变的帧不重写（颜色是乘进顶点色的，每帧写会一直标脏材质）', () => {
    const { row, ZCOwner } = makeRow();

    row.render(rowData(ZCOwner.Enemy2, true));
    const afterFirst = row.headIcon.colorWrites;
    const afterFirstDisc = row.headFrame.colorWrites;
    assert.ok(afterFirst >= 1 && afterFirstDisc >= 1, '第一次渲染必须写（节点上原本是 prefab 默认值）');

    // 连刷 5 帧同一个状态：一次都不该再写。
    for (let i = 0; i < 5; i++) row.render(rowData(ZCOwner.Enemy2, true));
    assert.equal(row.headIcon.colorWrites, afterFirst, '状态没翻转就不许重写头像色');
    assert.equal(row.headFrame.colorWrites, afterFirstDisc, '状态没翻转就不许重写圆盘色');

    // 翻转一次只多写一次。
    row.render(rowData(ZCOwner.Enemy2, false));
    assert.equal(row.headIcon.colorWrites, afterFirst + 1, '翻转：写一次就够');
    assert.equal(row.headFrame.colorWrites, afterFirstDisc + 1, '翻转：写一次就够');
});

test('名字仍按席位色：出局只压头像/圆盘，读名字还能认出是谁', () => {
    const { row, theme, ZCOwner } = makeRow();
    const { zcFactionColor } = theme;

    row.render(rowData(ZCOwner.Enemy, true));
    assert.deepEqual(rgb(row.nameText.color), rgb(zcFactionColor(ZCOwner.Enemy)), '出局后名字色不变');

    // 换一席再验一次：名字色跟着**席位**走，不是固定值。
    row.render(rowData(ZCOwner.Enemy2, true));
    assert.deepEqual(rgb(row.nameText.color), rgb(zcFactionColor(ZCOwner.Enemy2)), '换席后名字用新席位色');
});

test('虚拟列表复用：同一条行从「出局席位」换成「存活席位」，颜色必须归位', () => {
    const { row, theme, ZCOwner } = makeRow();
    const white = rgb(theme.ZC_CLIENT_COLORS.white);

    row.render(rowData(ZCOwner.Enemy, true));
    // 复用给另一个还活着的席位（列表回收时会这样）。
    row.render(rowData(ZCOwner.Player, false));
    assert.deepEqual(rgb(row.headIcon.color), white, '复用到存活席位不能残留上一席的黑色');
    assert.deepEqual(rgb(row.headFrame.color), white, '圆盘同理');
});

// ============================================================
// 三、接线：出局判据从哪来（与顶部红 X 同源）
// ============================================================

test('接线：ZCGameHUDView 按「地块清零」判定出局，并与顶部四格用同一帧同一个数', () => {
    const hud = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameHUDView.ts'), 'utf8');
    const rowSource = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameHudPlayerRow.ts'), 'utf8');

    // 行侧：没传就按「没出局」处理；传了就用。
    assert.match(rowSource, /readonly dead: boolean;/, '行数据要带出局标记');
    assert.match(rowSource, /const dead = data\.dead === true;/, '非法值按存活处理');

    // 视图侧：第三参 + 判据复用 `counts`（就是顶部四格 `finished: count <= 0` 那个数）。
    assert.match(hud, /private rowDeadOf: \(\(owner: ZCOwner, index: number\) => boolean\) \| null = null;/);
    assert.match(hud, /deadOf\?: \(owner: ZCOwner, index: number\) => boolean,/, 'paintPlayerRows 要收第三参');
    assert.match(hud, /this\.rowDeadOf = deadOf \?\? null;/, '不传就当「还不知道」');
    assert.match(hud, /dead: this\.rowDeadOf\?\.\(owner, index\) \?\? false,/, '填行时取用');
    assert.match(hud, /_owner, index\) => \(counts\[index\] \?\? 0\) <= 0\)/,
        '判据必须复用同帧的 counts，别另调一遍 territoryCountOf');

    // 顶部四格的 finished 与它同源：两处都读同一个 `counts[i]`。
    assert.match(hud, /slot\.render\(\{ value: count, finished: count <= 0, leading: i === leadIndex \}\)/,
        '红 X 的判据别被改掉——两处必须同源');

    // 选点阶段：`setSeatProfiles` 只传 owners（没有 deadOf）⇒ 四行都不压黑。
    assert.match(hud, /this\.paintPlayerRows\(owners\);/, '选点阶段不带出局判据');
});
