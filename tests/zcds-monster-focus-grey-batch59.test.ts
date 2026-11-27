import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    zcMonsterFocusSpineVisualOf,
} from '../assets/script/app/zcds/model/ZCMonsterPresentation';

/**
 * 野怪集火按钮的灰色跟谁走（2026-11-26 第 59 批）。
 *
 * 需求原文：「按钮也需要是灰色的」—— 第 58 批把野怪本体的「叠透明」改成「只压亮」之后，
 * 未激活的野怪身体变暗了，但头顶那颗集火按钮还是亮的，一眼看过去像"这只怪能点"。
 *
 * 口径拆成两件互不相干的事：
 *   灰（`idle` / `locked`）⇒ 跟**野怪三态**走，未激活就压灰；
 *   定格（`locked`）        ⇒ 跟**解锁**走，这一下点不出结果才停帧。
 * 所以「解锁了但野怪没激活」= 循环播放 + 仍然压灰，这三档缺一档就会退回"解锁即白"。
 */

const read = (path: string): string => readFileSync(path, 'utf8');
const VIEW_SOURCE = read('assets/script/app/zcds/view/ZCHexView.ts');

/** 只截 `renderMonsterFocus` + `applyMonsterFocusSpine` 两段：别让文件里别处的同名调用混进来。 */
function viewFocusSection(): string {
    const start = VIEW_SOURCE.indexOf('    renderMonsterFocus(');
    assert.ok(start >= 0, 'ZCHexView 里必须有 renderMonsterFocus');
    const end = VIEW_SOURCE.indexOf('    initialize(', start);
    assert.ok(end > start, 'renderMonsterFocus 之后必须紧接 initialize');
    return VIEW_SOURCE.slice(start, end);
}

test('① 三档：未解锁一律定格，解锁后灰不灰只看野怪三态', () => {
    //  未解锁：哪怕这只怪已经被别人打醒了（`awake` / `captured`），按钮也是 `locked`。
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: false, tintState: 'awake' }), 'locked');
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: false, tintState: 'sleep' }), 'locked');
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: false, tintState: 'captured' }), 'locked');
    //  解锁后只有「未激活」才灰。
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: true, tintState: 'sleep' }), 'idle');
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: true, tintState: 'awake' }), 'active');
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: true, tintState: 'captured' }), 'active');
    //  三态算不出来（不是野怪格 / 数据还没就绪）⇒ 当已激活处理：按钮本就不显示，别顺手染灰。
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: true, tintState: null }), 'active');
    assert.equal(zcMonsterFocusSpineVisualOf({ unlocked: false, tintState: null }), 'locked');
});

test('② 视图侧走的是同一条三态判据，不是"解锁就白"', () => {
    const section = viewFocusSection();
    assert.match(section, /zcMonsterTintStateOf\(\{/,
        '按钮颜色必须复用野怪身体那份三态判据（`zcMonsterTintStateOf`），否则按钮和身体两套灰');
    assert.match(section, /applyMonsterFocusSpine\(zcMonsterFocusSpineVisualOf\(\{ unlocked, tintState \}\)\)/,
        '档位必须由「解锁 + 三态」合算，不能只传 unlocked');
    //  旧写法（把"解锁"直接当"变亮"）不许回来。
    const legacy = /unlocked\s*\?\s*Color\.WHITE|monsterFocusSpineLocked/;
    assert.equal(legacy.test(section), false, '`unlocked ? 白 : 灰` 的旧判法已下线');
});

test('③ 两档灰共用同一个颜色，亮度用乘算压，不许靠 alpha 变透', () => {
    const tint = VIEW_SOURCE.match(/const MONSTER_FOCUS_DIM_TINT = new Color\((\d+), (\d+), (\d+), (\d+)\)/);
    assert.ok(tint, '压灰色必须是一个具名常量（locked / idle 共用）');
    const [, r, g, b, a] = tint;
    assert.equal(a, '255',
        '🔴 alpha 必须是 255：spine 顶点色改了 alpha 是整只变透（第 58 批用户已否掉）');
    //  灰而不是单纯变暗：三通道都压下去，且互不拉开色相（这里刻意偏冷，蓝比红高 18，
    //  所以容差给到 ±20 —— 再大就成"染色"了）。
    for (const channel of [r, g, b]) assert.ok(Number(channel) < 200, '得真的压下去');
    assert.ok(Math.abs(Number(r) - Number(b)) <= 20 && Math.abs(Number(g) - Number(b)) <= 20,
        `压灰色必须落在中性灰附近，实际 (${r}, ${g}, ${b})`);
    //  `locked` 与 `idle` 都落在这一支上，`active` 才回白。
    const section = viewFocusSection();
    assert.match(section, /spine\.color = visual === 'active' \? Color\.WHITE : MONSTER_FOCUS_DIM_TINT/,
        '两档灰必须走同一个三元式');
    //  定格那一支也要自己压一次：定格分支不经过上面那行。
    const lockedBranch = section.slice(section.indexOf("if (visual !== 'locked')"));
    assert.match(lockedBranch, /spine\.color = MONSTER_FOCUS_DIM_TINT/,
        '定格分支必须显式压灰（它走的是另一条 return 路径）');
});

test('④ 定格只跟"解锁"翻转：三态变化不能把循环态打回定格', () => {
    const section = viewFocusSection();
    //  定格分支在 `applyMonsterFocusSpine` 的 else 里，进入条件是 `visual === 'locked'`，
    //  而 `locked` 只可能来自 `!unlocked` —— 这条链路是"灰能变、定格不能因为变灰而重来"的根基。
    assert.match(section, /if \(visual !== 'locked'\) \{/,
        '非锁定档必须走循环分支，不能掉进定格');
    assert.match(section, /spine\.timeScale = 1;/,
        '循环分支要把倍速拉回 1（从定格恢复时必须能跑起来）');
    //  档位没变就别碰动画：全量渲染每帧都进来，重播会让动画永远停在第 1 帧。
    assert.match(section, /if \(this\.monsterFocusSpineVisual === visual\) return;/,
        '同档位必须早退，否则每帧重播');
});
