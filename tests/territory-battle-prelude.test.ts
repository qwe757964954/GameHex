import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TERRITORY_BATTLE_APPROACH_SECONDS,
    TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS,
    TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS,
    TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS,
    TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS,
    territoryBattlePreludeApproachSettled,
    territoryBattlePreludeSpawnSettled,
} from '../assets/script/app/territory/model/TerritoryBattleApproach';
import {
    TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_SPAWN_SECONDS,
} from '../assets/script/app/territory/model/TerritoryHexSpawn';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';

/**
 * 「首次触发战斗要保留关卡地块生成的效果」（用户 2026-11-02 原话）：
 *
 * > 1. 首先播放关卡地块生成
 * > 2. 镜头推进，播放触发战斗提示条
 * > 3. 再播放云层的过渡动画
 *
 * 判据分三层：
 *  ① 纯函数：两段的"播完了吗"；
 *  ② 页面：三段必须**按这个顺序**串起来，谁先谁后是这条需求的本体；
 *  ③ 锁与 `busy`：前奏那段没有镜头动画（地块生成），必须靠独立的锁撑住；
 *     而首次解锁直开这一路的 `busy` **不许**提前起整页过场（否则云把前两段盖掉）。
 */

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const MAP_VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const MODEL = 'assets/script/app/territory/application/TerritoryModel.ts';

/** 读源码并剥掉注释：判据里的字样常出现在解释性注释里，注释命中就是假绿。 */
function stripped(path: string): string {
    return readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const pageSource = stripped(PAGE);
const mapViewSource = stripped(MAP_VIEW);
const modelSource = stripped(MODEL);

const near = (a: number, b: number, epsilon = 1e-9): boolean => Math.abs(a - b) <= epsilon;

// ---------------------------------------------------------------------------
// ① 常量与纯函数
// ---------------------------------------------------------------------------

test('★★★时序常量：地块生成那段的上限必须真的盖得住「单格 + 错峰」的最坏情况', () => {
    // 最坏一批：最后一格比别人晚 `STAGGER_MAX` 起播，还要播满一整段 `SPAWN_SECONDS`。
    const worst = TERRITORY_HEX_SPAWN_SECONDS + TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS;
    assert.ok(TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS >= worst,
        `兜底上限 ${TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS}s 盖不住最坏 ${worst}s ⇒ 地块还在长就被推进第二段`);
    // 宽限期只用来区分"还没起播"和"这一局没有新地块"，必须远小于一整格动画。
    assert.ok(TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS > 0, '没有宽限期 ⇒ 收到命令那一帧就认成"没有新地块"');
    assert.ok(TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS < TERRITORY_HEX_SPAWN_SECONDS / 2,
        '宽限期太长 ⇒ 每局开局都白等');
    // 第二段的判定窗口 = 推镜本身 + 一点点尾巴（收尾那一帧才写回原位）。
    assert.ok(near(TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS,
        TERRITORY_BATTLE_APPROACH_SECONDS + TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS),
    '第二段窗口必须就是推镜时长 + 尾巴，别自己另写一个数');
    assert.ok(TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS > 0
        && TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS < 0.2,
    '尾巴要短：只够收尾那一帧，不许变成"白等一段"');
});

test('★★★第一段：宽限期里 remaining=0 表示「还没起播」，不是「没有新地块」', () => {
    const grace = TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS;
    // 收到解锁回包的那一帧：`hexSpawn` 还没起播（重绘在 `finally` 里）⇒ 不能认成"播完了"。
    assert.equal(territoryBattlePreludeSpawnSettled(0, 0, false), false, '第 0 帧就放行 ⇒ 地块生成被跳过');
    assert.equal(territoryBattlePreludeSpawnSettled(grace / 2, 0, false), false, '宽限期内一律等');
    // 宽限期过完还是 0 ⇒ 这一局确实没有新地块（本次只开战、没解锁新格）。
    assert.equal(territoryBattlePreludeSpawnSettled(grace, 0, false), true, '宽限期过完就该放行');
    assert.equal(territoryBattlePreludeSpawnSettled(grace * 3, 0, false), true);
});

test('★★★第一段：只要见过地块在播，就必须等它播完（宽限期不适用）', () => {
    const grace = TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS;
    // 起播之后：剩多少等多少，一帧都不许提前走。
    assert.equal(territoryBattlePreludeSpawnSettled(grace * 2, 0.4, true), false, '还在播就走 ⇒ 地块长一半');
    assert.equal(territoryBattlePreludeSpawnSettled(grace * 2, 0.001, true), false);
    assert.equal(territoryBattlePreludeSpawnSettled(grace * 2, 0, true), true, '播完了立刻走，不等宽限期');
    // 没"见过"但 remaining>0（起播发生在宽限期之内的正常情况）：同样要等。
    assert.equal(territoryBattlePreludeSpawnSettled(grace, 0.3, false), false);
});

test('★★★兜底与脏值：任何情况下都不许把玩家永远卡在第一段', () => {
    const cap = TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS;
    assert.equal(territoryBattlePreludeSpawnSettled(cap, 9, true), true, '到了上限必须放行，哪怕还剩一大截');
    assert.equal(territoryBattlePreludeSpawnSettled(cap + 10, 9, true), true);
    // 脏值一律当 0 / 当"没在播"，不许 NaN 传染成"永远 false"。
    assert.equal(territoryBattlePreludeSpawnSettled(Number.NaN, Number.NaN, false), false);
    assert.equal(territoryBattlePreludeSpawnSettled(Number.NaN, 0, false), false);
    assert.equal(territoryBattlePreludeSpawnSettled(-1, 0.2, true), false);
    assert.equal(territoryBattlePreludeSpawnSettled(TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS,
        -1, false), true, '负的剩余时长当 0');
});

test('★★★第二段：推镜还在播就一直等，播完还要等满窗口（收尾那一帧才写回原位）', () => {
    const window = TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS;
    assert.equal(territoryBattlePreludeApproachSettled(0, true), false);
    assert.equal(territoryBattlePreludeApproachSettled(window * 2, true), false, '还在播 ⇒ 不许进第三段（云会盖在推过的镜头上）');
    assert.equal(territoryBattlePreludeApproachSettled(window / 2, false), false, '播完了但没到窗口 ⇒ 等收尾');
    assert.equal(territoryBattlePreludeApproachSettled(window, false), true);
    assert.equal(territoryBattlePreludeApproachSettled(Number.NaN, false), false, '脏值不许当成"早就播完了"');
    assert.equal(territoryBattlePreludeApproachSettled(-1, false), false);
});

// ---------------------------------------------------------------------------
// ② 页面：三段顺序
// ---------------------------------------------------------------------------

test('★★★三段必须按序串：地块生成 → 推镜 + 提示条 → 云层过场', () => {
    const begin = pageSource.indexOf('private stepBattlePrelude(');
    assert.ok(begin > 0, '缺前奏状态机 `stepBattlePrelude`');
    const step = pageSource.slice(begin, pageSource.indexOf('commitBattleNav(nav: ITerritoryBattleIntroNav)'));
    const spawnAt = step.indexOf("prelude.stage === 'spawn'");
    const spawnSettledAt = step.indexOf('territoryBattlePreludeSpawnSettled(');
    const approachAt = step.indexOf("prelude.stage = 'approach'");
    const tipAt = step.indexOf('FW.showTip(TERRITORY_TEXTS.battleApproach)');
    const playAt = step.indexOf('playBattleApproach(');
    const introAt = step.indexOf('this.startBattleIntro()');
    const navAt = step.indexOf('this.commitBattleNav(nav)');
    const approachSettledAt = step.indexOf('territoryBattlePreludeApproachSettled(');
    for (const [name, at] of [['spawn 段', spawnAt], ['第一段判定', spawnSettledAt], ['approach 段', approachAt],
        ['提示条', tipAt], ['推镜', playAt], ['第二段判定', approachSettledAt], ['云层过场', introAt],
        ['收尾跳转', navAt]] as const) {
        assert.ok(at > 0, `找不到 ${name}`);
    }
    // ① → ②：地块生成那段必须先判完；② → ③：推镜那段也必须先判完。
    assert.ok(spawnAt < spawnSettledAt && spawnSettledAt < approachAt, '第一段没判完就进第二段');
    assert.ok(approachAt < tipAt, '第二段一起手就要弹提示条（"镜头推进，播放触发战斗提示条"是同一刻）');
    // 提示条与推镜都属于**第二段内**：都要排在第二段的"播完了吗"判定之前。
    assert.ok(tipAt < approachSettledAt && playAt < approachSettledAt, '提示条/推镜跑到第二段外面了');
    assert.ok(approachAt < introAt, '云层过场必须排在推镜之后 —— 这就是这条需求的本体');
    // 第三段收尾才允许跳转，且跳转只有一个出口。
    assert.ok(introAt < navAt, '先把过场演起来，再交去向');
    assert.equal(pageSource.match(/kind: 'enterBattle'/g)?.length, 1,
        '战斗跳转必须只有一个出口');
});

test('★★★前奏期间不许开整页过场：云一旦盖上，前两段就全在云后面演', () => {
    const begin = pageSource.slice(pageSource.indexOf('private beginBattlePrelude('),
        pageSource.indexOf('private stepBattlePrelude('));
    assert.ok(begin.length > 0, '找不到 `beginBattlePrelude`');
    assert.ok(!begin.includes('startBattleIntro()'), '前奏起手就开过场 ⇒ 云把地块生成整段盖住');
    assert.ok(begin.includes('this.battleApproachPending = true'), '前奏期间要挡住第二条 navigate');
    assert.ok(begin.includes('this.closeBattleIntroPopups()'), '弹窗必须先关（与整页过场同一口径）');
    // 极端并发：别的开战请求已经把云盖上了 ⇒ 前两段补不了，但也不能干等
    // （过场的 `hold` 在等 `nav`，不交出去要硬等 3s 再判取消）。
    assert.ok(begin.includes('if (this.battleIntro) {') && begin.includes('this.releaseBattleIntro({ route: \'battle\', payload });'),
        '过场已经在演时要把去向交出去，不许让前奏空等');
    // `busy` 那一路：首次解锁直开不许提前起演过场（别的开战请求照旧）。
    assert.ok(pageSource.includes('payload.approach !== true && this.startBattleIntro()'),
        '`busy` 必须给直开这一路留例外，否则回包还没到云就盖上了');
});

test('★★★`update` 里前奏优先：它在跑就不许同时推进整页过场（两套都在写镜头）', () => {
    const update = pageSource.slice(pageSource.indexOf('    update(dt: number): void'),
        pageSource.indexOf('private startBattleIntro'));
    assert.ok(update.length > 0, '找不到页面的 `update`');
    const preludeAt = update.indexOf('this.stepBattlePrelude(prelude, step)');
    const introAt = update.indexOf('const intro = this.battleIntro');
    assert.ok(preludeAt > 0, '`update` 没推进前奏 ⇒ 三段一段都不会播');
    assert.ok(introAt > 0, '`update` 没推进整页过场');
    assert.ok(preludeAt < introAt, '前奏要排在过场之前判');
    // 前奏那一段必须 `return`：同一帧里推进两套镜头会互相覆盖。
    const afterPrelude = update.slice(preludeAt);
    assert.ok(afterPrelude.slice(0, afterPrelude.indexOf('}')).includes('return'),
        '前奏跑着的时候要 `return`，不许顺手再推一遍过场');
});

// ---------------------------------------------------------------------------
// ③ 锁与 `busy` 载荷
// ---------------------------------------------------------------------------

test('★★★第一段没有镜头动画，必须靠前奏那把锁撑住（否则下一帧就被自动解锁）', () => {
    const setLock = mapViewSource.slice(mapViewSource.indexOf('setPreludeLock(locked: boolean): void {'));
    const body = setLock.slice(0, setLock.indexOf('\n    }'));
    assert.ok(body.includes('this.preludeLocked = locked === true;'), '缺那把锁的字段');
    assert.ok(body.includes('if (this.preludeLocked) this.setInputLocked(true);'), '上锁要顺手锁输入');
    assert.ok(body.includes('else if (this.inputLocked && !this.cameraBusyLocked) this.setInputLocked(false);'),
        '解锁不许无条件放行：镜头还在忙时要留给它自己收');
    // 自动解锁那条判据必须认得这把锁（2026-11-04 起还要认得切章转场那把）。
    assert.ok(/if \(this\.inputLocked && !cameraBusy && !this\.preludeLocked && !this\.chapterSwitchActive\) \{/
        .test(mapViewSource), '`update` 的自动解锁漏了 `preludeLocked` ⇒ 地块生成那 0.7s 玩家能点地图');
    // 🔴 两把页面锁是并列的：谁在演都不许自动解锁。少一个条件，对应那段空窗就会被放掉。
    assert.ok(mapViewSource.includes('!this.preludeLocked && !this.chapterSwitchActive'),
        '切章转场的锁也必须进"自动解锁"的排除名单');
    // 页面上开关必须成对：起手开、收尾关、中断也关。
    assert.ok(pageSource.includes('this.mapView?.setPreludeLock(true)'), '前奏起手没上锁');
    const step = pageSource.slice(pageSource.indexOf('private stepBattlePrelude('));
    assert.ok(step.slice(0, step.indexOf('this.commitBattleNav(nav)')).includes('this.mapView?.setPreludeLock(false)'),
        '前奏收尾没解锁');
    const abort = pageSource.slice(pageSource.indexOf('private abortBattlePrelude(): void'));
    assert.ok(abort.slice(0, abort.indexOf('\n    }')).includes('this.mapView?.setPreludeLock(false)'),
        '中断（被拒/超时）没解锁 ⇒ 玩家被永久锁在地图上');
});

test('★★★剩余时长要从地块生成那只时钟读，不许页面自己算', () => {
    assert.ok(mapViewSource.includes('hexSpawnRemainingSeconds(): number {'), '视图缺 `hexSpawnRemainingSeconds`');
    const at = mapViewSource.indexOf('hexSpawnRemainingSeconds(): number {');
    const body = mapViewSource.slice(at, mapViewSource.indexOf('\n    }', at));
    assert.ok(body.includes('this.hexSpawn.remainingSeconds()'), '必须读生成动画自己的时钟（页面算不准）');
    assert.ok(pageSource.includes('mapView?.hexSpawnRemainingSeconds()'), '页面没去问"还要播多久"');
    // `remainingSeconds` 取的是**最长**那一格的剩余，不是最后一格。
    const spawnView = stripped('assets/script/app/territory/view/TerritoryHexSpawn.ts');
    const remainAt = spawnView.indexOf('remainingSeconds(): number {');
    assert.ok(remainAt > 0, '缺 `remainingSeconds`');
    const remain = spawnView.slice(remainAt, spawnView.indexOf('\n    }', remainAt));
    // 2026-11 起单格时长挂在 `active.timing` 上（普通档 / 胜利档两套），
    // 所以剩余 = 该格的 `timing.seconds` 减已播 —— 别再回头用全局常量。
    assert.ok(remain.includes('active.timing.seconds - active.elapsed'),
        '剩余时长要按**这一格**的档位时长减已播（普通档 / 胜利档时长不同）');
    assert.ok(remain.includes('if (left > remaining) remaining = left;'), '必须取最大值（错峰时最后一格才最晚收）');
});

test('★★★`busy` 载荷要带 `approach`：首次解锁直开那一路，model 层就得说清"别盖云"', () => {
    // model 侧：`enterBusy(text, approach)` → `setBusy(busy, text, approach)` → 载荷带 `approach`。
    assert.ok(modelSource.includes('private enterBusy(text: string, approach = false): () => void {'),
        '`enterBusy` 不认识 approach ⇒ 载荷永远带不出去');
    assert.ok(modelSource.includes('this.setBusy(true, text, approach)'), '`enterBusy` 没把 approach 传下去');
    assert.ok(modelSource.includes('payload: approach ? { busy, text, approach } : { busy, text }'),
        '只在需要时才加字段（无条件加 `approach: false` 会把老断言判成不相等）');
    // 只有「首次解锁直开」那一处把 `approachBusy` 传成 true。
    const body = modelSource.slice(modelSource.indexOf('private async handleUnlockThenBattle('));
    assert.ok(body.slice(0, body.indexOf('\n    }')).includes('true,'), '直开那一路没把 approach 传给 `runCellWrite`');
    assert.equal((modelSource.match(/approachBusy = false,/) ?? []).length, 1, '`runCellWrite` 的默认值应只有一处');
    // 页面侧：读到 `approach` 就把活交给前奏（不自己排定时器）。
    assert.ok(pageSource.includes('if (payload.approach) {'), '页面没认 approach');
    assert.ok(pageSource.includes('this.beginBattlePrelude(payload);'), 'approach 分支要交给前奏状态机');
    // 提示条文案（需求原文）。
    assert.equal(TERRITORY_TEXTS.battleApproach, '遭遇敌人，即将开始战斗');
});
