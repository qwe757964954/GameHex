import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TERRITORY_BATTLE_APPROACH_HOLD_UNTIL,
    TERRITORY_BATTLE_APPROACH_IN_SECONDS,
    TERRITORY_BATTLE_APPROACH_OUT_SECONDS,
    TERRITORY_BATTLE_APPROACH_SECONDS,
    TERRITORY_BATTLE_APPROACH_ZOOM,
    territoryBattleApproachFx,
} from '../assets/script/app/territory/model/TerritoryBattleApproach';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';

/**
 * 「首次解锁关卡 ⇒ 自动进战斗」的镜头过场（需求 2026-11-02）：
 * 「镜头推进（**类似宝箱第二档**奖励的效果），同时弹出提示条，文案【遭遇敌人，即将开始战斗】」。
 *
 * 判据分三层：
 *  ① 曲线（纯函数）：从原位起推、峰值 = 宝箱中档的 1.35、结束回 1，且 `done` 与总时长一致；
 *  ② 只在这条入口播：`handleUnlockThenBattle` 才带 `approach`，弹窗里自己按的「开始战斗」不带；
 *  ③ 接线：页面拿到 `approach` 才延迟跳转 + 弹提示条，视图真的推进同一套镜头基准。
 */

// ---------------------------------------------------------------------------
// ① 曲线
// ---------------------------------------------------------------------------

test('★★起点必须是"没推过"：t=0 时 scale=1 / focus=0（点下去那一帧不能突然放大）', () => {
    const fx = territoryBattleApproachFx(0);
    assert.equal(fx.scale, 1);
    assert.equal(fx.focus, 0);
    assert.equal(fx.done, false);
});

test('★★★推到位 = 宝箱第二档的倍率，且此时焦点压在屏幕正中（focus = 1）', () => {
    assert.equal(TERRITORY_BATTLE_APPROACH_ZOOM, 1.35, '用户口径「类似宝箱第二档」，第二档就是 1.35');
    const fx = territoryBattleApproachFx(TERRITORY_BATTLE_APPROACH_IN_SECONDS);
    assert.ok(Math.abs(fx.scale - TERRITORY_BATTLE_APPROACH_ZOOM) < 1e-9, `推到头应是 1.35，实际 ${fx.scale}`);
    assert.ok(Math.abs(fx.focus - 1) < 1e-9, '推到头 ⇒ 目标格摆到屏幕中心');
});

test('★★★保持段不抖：推到位后到收尾起点之间，倍率恒为 1.35', () => {
    const mid = (TERRITORY_BATTLE_APPROACH_IN_SECONDS + TERRITORY_BATTLE_APPROACH_HOLD_UNTIL) / 2;
    for (const t of [mid, TERRITORY_BATTLE_APPROACH_HOLD_UNTIL]) {
        assert.ok(Math.abs(territoryBattleApproachFx(t).scale - TERRITORY_BATTLE_APPROACH_ZOOM) < 1e-9,
            `t=${t} 应该在保持段里`);
    }
});

test('★★★结束必须回到 1：过场完就跳战斗页，带着放大的 content 走会"啪"地缩回去', () => {
    const fx = territoryBattleApproachFx(TERRITORY_BATTLE_APPROACH_SECONDS);
    assert.equal(fx.scale, 1, '总时长那一帧必须已经还原');
    assert.equal(fx.focus, 0);
    assert.equal(fx.done, true, 'done 与总时长同一个时刻，页面据此放手跳转');
    assert.equal(TERRITORY_BATTLE_APPROACH_HOLD_UNTIL + TERRITORY_BATTLE_APPROACH_OUT_SECONDS,
        TERRITORY_BATTLE_APPROACH_SECONDS, '保持点 + 收回时长必须等于总时长');
});

test('★★推入段单调、整段有界（1 ≤ scale ≤ 1.35），不会把地图推歪', () => {
    let previous = 0;
    for (let i = 0; i <= 120; i += 1) {
        const t = (i / 100) * TERRITORY_BATTLE_APPROACH_SECONDS;
        const fx = territoryBattleApproachFx(t);
        assert.ok(Number.isFinite(fx.scale) && Number.isFinite(fx.focus), `t=${t} 出现脏值`);
        assert.ok(fx.scale >= 1 - 1e-9 && fx.scale <= TERRITORY_BATTLE_APPROACH_ZOOM + 1e-9,
            `t=${t} 倍率越界：${fx.scale}`);
        assert.ok(fx.focus >= 0 && fx.focus <= 1 + 1e-9, `t=${t} 焦点越界：${fx.focus}`);
        if (t <= TERRITORY_BATTLE_APPROACH_IN_SECONDS) {
            assert.ok(fx.scale >= previous - 1e-9, `t=${t} 推入段不该回退`);
            previous = fx.scale;
        }
    }
});

test('★退场：播完之后 / 非法入参一律按原位（绝不把 NaN 写进节点缩放）', () => {
    for (const t of [TERRITORY_BATTLE_APPROACH_SECONDS + 0.001, 99, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const fx = territoryBattleApproachFx(t);
        assert.equal(fx.scale, 1, `t=${t} 必须给原位`);
        assert.equal(fx.focus, 0);
    }
});

test('过场时长够玩家读完那行提示条（≥1s），也没长到让人以为卡住（≤2s）', () => {
    assert.ok(TERRITORY_BATTLE_APPROACH_SECONDS >= 1 && TERRITORY_BATTLE_APPROACH_SECONDS <= 2);
});

// ---------------------------------------------------------------------------
// ② 文案
// ---------------------------------------------------------------------------

test('★★提示条文案与需求原文逐字一致', () => {
    assert.equal(TERRITORY_TEXTS.battleApproach, '遭遇敌人，即将开始战斗');
});

// ---------------------------------------------------------------------------
// ③ 接线
// ---------------------------------------------------------------------------

const modelSource = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
const mapViewSource = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const pageSource = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');

test('★★★只有「首次解锁直开」带 approach，弹窗里自己按的「开始战斗」不许拖 1.2 秒', () => {
    // 直开那条：`handleUnlockThenBattle` 的回包里必须是 `applyBattleStart(..., true)`。
    const unlockBody = modelSource.slice(modelSource.indexOf('private async handleUnlockThenBattle('));
    assert.ok(
        unlockBody.slice(0, unlockBody.indexOf('\n    }')).includes('this.applyBattleStart(site, stage, outcome.battle, true)'),
        '首次解锁直开没标记 approach ⇒ 页面不会播过场',
    );
    // 反查：全文里 `applyBattleStart(` 的调用只有这两处，且只有直开那一处带 `, true`。
    const calls = modelSource.match(/this\.applyBattleStart\([^)]*\)/g) ?? [];
    assert.equal(calls.length, 2, `applyBattleStart 调用点应为 2 处，实际 ${calls.length}`);
    assert.equal(calls.filter((call) => call.includes(', true')).length, 1, '只允许直开那一处带 approach');
});

test('★★navigate 载荷只在需要时才带可选字段（其余调用点保持原样，别污染老断言）', () => {
    // `approach`（首次解锁直开的推镜）与 `battleParams`（普通关交给匹配页发的开战参数）
    // 都是**按需**才带：无条件加进去（哪怕是 `approach: false`）会把 `deepEqual({ pve, battle })`
    // 这条老断言判成不相等。
    assert.ok(
        modelSource.includes("approach || battleParams\n            ? { pve, battle, approach, battleParams }\n            : { pve, battle }"),
        'navigateToBattle 应只在需要时加可选字段',
    );
});

test('★★★页面：拿到 approach 才延迟跳转，且跳转只有一个出口 `commitBattleNav`', () => {
    // 🔴 判据看的是**顺序**而不是"有没有 if"：`approach` 那条分支必须排在 `startBattleIntro()`
    //    之前 —— 云一旦先盖上来，地块生成和推镜这两段就全在云后面演（用户 2026-11-02：
    //    「① 首先播放关卡地块生成 → ② 镜头推进 + 提示条 → ③ 再播放云层的过渡动画」）。
    const approachAt = pageSource.indexOf('if (payload.approach) {');
    const introAt = pageSource.indexOf('if (this.startBattleIntro()) {', approachAt > 0 ? approachAt : 0);
    assert.ok(approachAt > 0, '没有 approach 分支 ⇒ 需求未接线');
    assert.ok(approachAt < introAt, '前奏必须排在整页过场之前，否则云会把前两段盖住');
    assert.ok(pageSource.includes('this.beginBattlePrelude(payload);'), 'approach 分支要把活交给前奏状态机');

    assert.ok(pageSource.includes('playBattleApproach(prelude.payload.pve.territoryCellId)'),
        '页面没让地图播镜头推进');
    assert.ok(pageSource.includes('FW.showTip(TERRITORY_TEXTS.battleApproach)'), '页面没弹那条提示条');
    // 播不了（格子不在视口 / 覆盖层没建）就不许白等一整段推镜。
    assert.ok(pageSource.includes('if (!started) prelude.elapsed = TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS;'),
        '推镜起不来时必须跳满这一段，别白等 1.2 秒');
    // 只有一处 ProcedureManager.navigate(GameRoute.Battle —— 延迟分支与直通分支共用它。
    const navCalls = pageSource.match(/kind: 'enterBattle'/g) ?? [];
    assert.equal(navCalls.length, 1, `战斗跳转应只剩一个出口，实际 ${navCalls.length} 处`);
});

test('★★★视图：过场必须纳入 `cameraBusy` 那条唯一收尾路径（否则第一帧就被还原）', () => {
    assert.ok(mapViewSource.includes('private stepBattleApproach(dt: number): void {'));
    assert.ok(mapViewSource.includes('this.stepBattleApproach(dt);'), 'update 没推进过场');
    assert.ok(mapViewSource.includes('|| this.battleApproach !== null;'),
        '`cameraBusy` 没把过场算进去 ⇒ 播完前就被 restoreChestCamera 按回原位');
    // 换章 / 页面销毁前要清掉，否则半路的 scale 会留在新图上。
    assert.ok(mapViewSource.includes('this.battleApproach = null;'));
});

test('★★过场与开箱共用同一套镜头基准（倍率/对焦喂给同一个 applyChestCamera）', () => {
    const playBody = mapViewSource.slice(mapViewSource.indexOf('playBattleApproach(cellId: number): boolean {'));
    const body = playBody.slice(0, playBody.indexOf('\n    }'));
    assert.ok(body.includes('this.captureChestCamera(point)'), '必须量基准，否则镜头会推到错误的位置');
    assert.ok(body.includes('this.applyChestCamera(1, 0, point)'), '起播帧要显式摆到原位');
    assert.ok(body.includes('this.setInputLocked(true)'), '推镜期间必须锁输入（地图是 ScrollView content）');
    assert.ok(mapViewSource.includes('this.applyChestCamera(fx.scale, fx.focus, approach.origin)'),
        '每帧必须把曲线的 (scale, focus) 喂给同一套镜头');
});
