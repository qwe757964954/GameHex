/**
 * 个人信息模块（`assets/script/app/playerinfo/`）的单测。
 *
 * 覆盖三层：
 *
 * | 段 | 内容 | 为什么 |
 * |---|---|---|
 * | A | `PlayerInfoTable.writeFailText`（零 `cc`，规则 78） | 本轮修的「断线被说成『更换头像失败』」 |
 * | B | 头像列表几何 ↔ `ChangeHead.prefab` 静态摆位对账 | `PlayerInfoTable` 的注释一直指向本文件，此前**并不存在** |
 * | C | 四个调用点的**源码接线** + 反向守卫 | 不许再退回「offline / failed 共用一句」 |
 *
 * 背景（2026-09-28 山猫：「更换头像的时候，显示更换头像失败」）：
 *   `PlayerInfoRepository.send()` 第一句 `if (!net.isConnected) return 'offline'` —— 断线时
 *   请求**根本没发出去**，但旧代码把它和「发出去了没成功」一起说成「更换头像失败，请稍后重试」。
 *   实测（`tmp/_changehead_two_client_probe.mjs`）：同一账号开第二个客户端登录 ⇒ 第一个客户端的
 *   socket 被关 ⇒ 点「确认」`ms = 0` 返回 `'offline'` ⇒ 弹出那句「更换头像失败」，而服务端
 *   （`RoleChangeImgHandler` 反编译确认）**无条件成功**、压根没收到这条请求。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
    HEAD_ITEM_SLOT_COUNT,
    HEAD_ITEM_STEP_X,
    HEAD_ITEM_STEP_Y,
    headContentHeight,
    headSlotOffset,
    writeFailText,
} from '../assets/script/app/playerinfo/PlayerInfoTable';
import { PLAYER_INFO_TEXTS } from '../assets/script/app/playerinfo/PlayerInfoTexts';

const ROOT = 'assets/script/app/playerinfo';
const src = (file: string): string => readFileSync(`${ROOT}/${file}`, 'utf8');

/** 剥掉注释（反向断言前必须做，规则 104：注释里提到旧写法不算违规）。 */
function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

// ============================================================
// A. 写请求失败文案
// ============================================================

test('★ writeFailText：offline（没连上服务器）不能说成「xx 失败」', () => {
    // offline ⇒ 网络文案；failed / ok ⇒ 各功能自己的文案
    assert.equal(writeFailText('offline', PLAYER_INFO_TEXTS.changeHeadFailed), PLAYER_INFO_TEXTS.offlineTip);
    assert.equal(writeFailText('failed', PLAYER_INFO_TEXTS.changeHeadFailed), PLAYER_INFO_TEXTS.changeHeadFailed);
    // `'ok'` 不该走到这里，但行为要钉住（不能返回 undefined）
    assert.equal(writeFailText('ok', PLAYER_INFO_TEXTS.changeHeadFailed), PLAYER_INFO_TEXTS.changeHeadFailed);
});

test('⚠️ 两条文案必须真的不同 —— 否则「分开」是假的', () => {
    assert.ok(PLAYER_INFO_TEXTS.offlineTip.length > 0, 'offlineTip 不能是空串（Toast.show 会静默丢弃）');
    assert.notEqual(PLAYER_INFO_TEXTS.offlineTip, PLAYER_INFO_TEXTS.changeHeadFailed);
    assert.notEqual(PLAYER_INFO_TEXTS.offlineTip, PLAYER_INFO_TEXTS.renameRequestFailed);
    assert.notEqual(PLAYER_INFO_TEXTS.offlineTip, PLAYER_INFO_TEXTS.redeemFailed);
    assert.notEqual(PLAYER_INFO_TEXTS.offlineTip, PLAYER_INFO_TEXTS.otherLoadFailed);
});

test('writeFailText 透传任意「xx 失败」文案（不写死换头像那一套）', () => {
    for (const text of [
        PLAYER_INFO_TEXTS.changeHeadFailed,
        PLAYER_INFO_TEXTS.renameRequestFailed,
        PLAYER_INFO_TEXTS.redeemFailed,
        PLAYER_INFO_TEXTS.otherLoadFailed,
    ]) {
        assert.equal(writeFailText('failed', text), text);
    }
});

// ============================================================
// B. 头像列表几何 ↔ prefab 静态摆位
// ============================================================

const PREFAB = JSON.parse(readFileSync('assets/resources/ui/PlayerInfo/ChangeHead.prefab', 'utf8')) as any[];

test('★ 8 个槽位的位置 = headSlotOffset()（4 列 / 步进 131.4 / 128.7）', () => {
    const slots = PREFAB.filter((o) => o && o.__type__ === 'cc.Node' && /^Slot\d+$/.test(o._name ?? ''));
    assert.equal(slots.length, HEAD_ITEM_SLOT_COUNT, `prefab 里的槽位数应为 ${HEAD_ITEM_SLOT_COUNT}`);

    for (let i = 0; i < HEAD_ITEM_SLOT_COUNT; i += 1) {
        const node = slots.find((o) => o._name === `Slot${i + 1}`);
        assert.ok(node, `prefab 里缺 Slot${i + 1}`);
        const off = headSlotOffset(i);
        // ⚠️ cocos 的 y 向上，而 `headSlotOffset` 的口径是「内容容器内 y 向下为正」⇒ 取负
        assert.ok(near(node._lpos.x, off.x), `Slot${i + 1}.x 应 ${off.x}，实际 ${node._lpos.x}`);
        assert.ok(near(node._lpos.y, -off.y), `Slot${i + 1}.y 应 ${-off.y}，实际 ${node._lpos.y}`);
    }
});

test('几何常量：步进 = (123 + gap) × 0.9，槽位 = 4 × 2', () => {
    assert.ok(near(HEAD_ITEM_STEP_X, (123 + 23) * 0.9));
    assert.ok(near(HEAD_ITEM_STEP_Y, (123 + 20) * 0.9));
    assert.equal(HEAD_ITEM_SLOT_COUNT, 8);
});

test('headContentHeight：按行算，最后一行不留 lineGap', () => {
    // 20 张 ⇒ 5 行（4 列）…… `headContentHeight` 用 ceil(n / 4)
    assert.ok(near(headContentHeight(20), 5 * HEAD_ITEM_STEP_Y - (HEAD_ITEM_STEP_Y - 110.7)));
    assert.ok(near(headContentHeight(8), 2 * HEAD_ITEM_STEP_Y - (HEAD_ITEM_STEP_Y - 110.7)));
    assert.ok(near(headContentHeight(0), 110.7), '0 张也要留一行的高度（不能是 0）');
});

test('headSlotOffset 越界不炸（负数 / 非法值当 0）', () => {
    assert.deepEqual(headSlotOffset(-1), { x: 0, y: 0 });
    assert.deepEqual(headSlotOffset('x'), { x: 0, y: 0 });
});

// ============================================================
// C. 调用点接线（反向守卫）
// ============================================================

test('★ 四个失败提示都经 writeFailText（offline 与 failed 分开）', () => {
    const EXPECT: Array<[string, RegExp, string]> = [
        ['ChangeHeadPage.ts', /Toast\.show\(writeFailText\(result, PLAYER_INFO_TEXTS\.changeHeadFailed\)\)/, '换头像'],
        ['RenamePage.ts', /Toast\.show\(writeFailText\(result, PLAYER_INFO_TEXTS\.renameRequestFailed\)\)/, '改名'],
        ['PlayerInfoPage.ts', /Toast\.show\(writeFailText\(result, PLAYER_INFO_TEXTS\.redeemFailed\)\)/, '兑换码'],
        ['PlayerInfoOtherPage.ts', /Toast\.show\(writeFailText\(other\.status, PLAYER_INFO_TEXTS\.otherLoadFailed\)\)/, '他人信息'],
    ];
    const miss: string[] = [];
    for (const [file, re, label] of EXPECT) {
        if (!re.test(stripComments(src(file)))) miss.push(`${label}（${file}）`);
    }
    assert.deepEqual(miss, [], `这些调用点还没走 writeFailText：${miss.join('、')}`);
});

test('⚠️ 反向：不许再出现裸的失败文案（绕过 writeFailText）', () => {
    const BARE = ['changeHeadFailed', 'renameRequestFailed', 'redeemFailed', 'otherLoadFailed'];
    /**
     * 允许保留的裸用 —— 它的分支里**没有三态**（本地校验，不是请求结果），
     * 所以不能套 `writeFailText`。**加新的白名单之前先问：这处真的是本地校验吗？**
     */
    const ALLOWED: Record<string, Record<string, number>> = {
        // `PlayerInfoOtherPage.reload` 开头 `if (!this.roleId)`（入口没带目标玩家）
        'PlayerInfoOtherPage.ts': { otherLoadFailed: 1 },
    };

    const bad: string[] = [];
    for (const file of ['ChangeHeadPage.ts', 'RenamePage.ts', 'PlayerInfoPage.ts', 'PlayerInfoOtherPage.ts']) {
        const code = stripComments(src(file));
        for (const key of BARE) {
            const count = code.match(new RegExp(`Toast\\.show\\(PLAYER_INFO_TEXTS\\.${key}\\)`, 'g'))?.length ?? 0;
            const allowed = ALLOWED[file]?.[key] ?? 0;
            if (count > allowed) bad.push(`${file} → PLAYER_INFO_TEXTS.${key}（裸用 ${count} 处，只允许 ${allowed} 处）`);
        }
    }
    assert.deepEqual(bad, [], `这些地方又退回裸文案了：${bad.join('、')}`);
});

test('⚠️ 反向：`send()` 里 offline 必须早退（别把它并进 failed）', () => {
    const code = stripComments(readFileSync('assets/script/app/playerinfo/PlayerInfoRepository.ts', 'utf8'));
    assert.match(code, /if \(!net\.isConnected\) return 'offline'/, '`PlayerInfoRepository.send` 的 offline 早退没了');
});
