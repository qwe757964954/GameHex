/**
 * 「章节切换转场」的回归网（2026-11-04）。
 *
 * 需求原文：
 *
 * > 「增加一个章节的切换动画，镜头快速上移，移动到新章节的位置，将新章节居中，
 * >   玩家只能通过章节按钮播放切换动画，回到已通过的章节」
 *
 * 三层判据：
 * 1. **纯曲线**（`model/TerritoryChapterSwitch`）—— 时长 / 位移方向 / 退化兜底；
 * 2. **触发源** —— 只有玩家点章节按钮才发命令（自动推进不许发，这是用户的原话）；
 * 3. **接线** —— 页面/视图里那几根线一根都不能少（少一根就是"点了没动画"或"云永远盖着"）。
 *
 * ⚠️ 为什么要守源码：这段演出的零件散在四个文件里（模型发命令、页面跑时间轴、
 *   地图视图写位移、云视图出云），任何一处漏改都只表现为"没动画"，不会报错。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    TERRITORY_CHAPTER_SWITCH_COVER_SECONDS,
    TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS,
    TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS,
    TERRITORY_CHAPTER_SWITCH_RISE_RATIO,
    TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS,
    territoryChapterSwitchCoverProgress,
    territoryChapterSwitchLeadProgress,
    territoryChapterSwitchReadyToReveal,
    territoryChapterSwitchRevealOffset,
    territoryChapterSwitchRevealProgress,
    territoryChapterSwitchRise,
    territoryChapterSwitchSinkDistance,
    territoryChapterSwitchSinkOffset,
    territoryChapterSwitchTotalSeconds,
    territoryChapterSwitchWanted,
} from '../assets/script/app/territory/model/TerritoryChapterSwitch';
import { territoryCloudClearAction } from '../assets/script/app/territory/model/TerritoryCloud';

const ROOT = path.resolve(import.meta.dirname, '..');
/** 行尾归一化：SVN 合并后部分文件是 CRLF，接线断言都按 `\n` 写。 */
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

// ============================================================
// ① 纯曲线
// ============================================================

test('★★★整段演出在 1 秒以内：用户要的是"快速上移"，不是一段过场剧', () => {
    const total = territoryChapterSwitchTotalSeconds();
    assert.ok(total > 0.5, `太快读不出位移方向（实际 ${total}s）`);
    assert.ok(total <= 1, `太慢，玩家点章节只是想换一章看看（实际 ${total}s）`);
    assert.equal(total, TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS
        + TERRITORY_CHAPTER_SWITCH_COVER_SECONDS
        + TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS);
});

test('★★★相机先行 0.1s：云还没出来就先动（2026-11-05 用户口径）', () => {
    // 「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」
    assert.equal(TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS, 0.1);
    assert.ok(TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS < TERRITORY_CHAPTER_SWITCH_COVER_SECONDS / 2,
        '先行段必须明显短于合拢段 —— 它是"一瞬间被带走"，不是一段镜头');
    // 进度曲线：首帧 0、末帧 1、脏值不炸。
    assert.equal(territoryChapterSwitchLeadProgress(0), 0);
    assert.equal(territoryChapterSwitchLeadProgress(TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS), 1);
    assert.equal(territoryChapterSwitchLeadProgress(999), 1, '超时不外溢');
    assert.equal(territoryChapterSwitchLeadProgress(Number.NaN), 0);
    // 先行段走完时，相机就停在最终的下沉位置（合拢段不再动）。
    const rise = territoryChapterSwitchRise(1000);
    assert.equal(territoryChapterSwitchSinkOffset(1, rise), territoryChapterSwitchSinkDistance(rise));
    assert.ok(territoryChapterSwitchSinkDistance(rise) < 0, '世界下移 = 镜头上移');
});

test('★★进度曲线：首帧 0、末帧 1，中段单调，脏值不炸', () => {
    assert.equal(territoryChapterSwitchCoverProgress(0), 0);
    assert.equal(territoryChapterSwitchCoverProgress(TERRITORY_CHAPTER_SWITCH_COVER_SECONDS), 1);
    assert.equal(territoryChapterSwitchCoverProgress(999), 1, '超时不外溢');
    assert.equal(territoryChapterSwitchCoverProgress(Number.NaN), 0, 'NaN 不许写进插值');
    assert.equal(territoryChapterSwitchCoverProgress(-1), 0);

    assert.equal(territoryChapterSwitchRevealProgress(0), 0);
    assert.equal(territoryChapterSwitchRevealProgress(TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS), 1);

    let previous = -1;
    for (let step = 0; step <= 10; step += 1) {
        const progress = territoryChapterSwitchCoverProgress(TERRITORY_CHAPTER_SWITCH_COVER_SECONDS * step / 10);
        assert.ok(progress >= previous, '合拢进度必须单调不减');
        previous = progress;
    }
});

test('★★★位移方向：相机先行段世界往下走（镜头上移），揭幕段新章从上方落回居中', () => {
    const rise = territoryChapterSwitchRise(1000);
    assert.equal(rise, 1000 * TERRITORY_CHAPTER_SWITCH_RISE_RATIO);

    // 先行段：0 → 负值（世界下移），整段**连续下行**、中途不回弹。
    assert.equal(territoryChapterSwitchSinkOffset(0, rise), 0, '第一帧画面不许动');
    assert.ok(territoryChapterSwitchSinkOffset(0.5, rise) < 0, '中段必须在下移');
    assert.ok(territoryChapterSwitchSinkOffset(1, rise) < territoryChapterSwitchSinkOffset(0.5, rise),
        '整段是一次连续的上行，收到 0 会读成"走了一下又退回去"');
    assert.ok(Math.abs(territoryChapterSwitchSinkOffset(1, rise)) < rise, '下沉幅度必须是 rise 的一小部分，别露底边');

    // 揭幕段：+rise → 0（新章从上方落回居中，用户要的「将新章节居中」就是末帧）。
    assert.equal(territoryChapterSwitchRevealOffset(0, rise), rise);
    assert.ok(territoryChapterSwitchRevealOffset(0.5, rise) < rise && territoryChapterSwitchRevealOffset(0.5, rise) > 0);
    assert.equal(territoryChapterSwitchRevealOffset(1, rise), 0);
});

test('★★★视口高度拿不到 ⇒ 位移退化 0（只演云），绝不把地图推到回不来的地方', () => {
    assert.equal(territoryChapterSwitchRise(0), 0);
    assert.equal(territoryChapterSwitchRise(-100), 0);
    assert.equal(territoryChapterSwitchRise(Number.NaN), 0);
    assert.equal(territoryChapterSwitchSinkOffset(0.5, Number.NaN), 0);
    assert.equal(territoryChapterSwitchRevealOffset(0.5, 0), 0);
});

test('★★★同章 / 非法章号不播转场（否则会白白把云合拢一次）', () => {
    assert.equal(territoryChapterSwitchWanted(1, 2), true);
    assert.equal(territoryChapterSwitchWanted(2, 1), true, '回到已通过的章节也要播');
    assert.equal(territoryChapterSwitchWanted(1, 1), false);
    assert.equal(territoryChapterSwitchWanted(0, 2), false);
    assert.equal(territoryChapterSwitchWanted(Number.NaN, 2), false);
});

test('★★★揭幕判据看「已渲染的章号」，不是「模型当前章号」', () => {
    // 模型在 `loadChapter` 一开头就把 `chapterId` 改了，那时地图还是旧的 ——
    // 按 state 判就会在旧图上揭幕（玩家看到"上移了一下，还是老地图"）。
    assert.equal(territoryChapterSwitchReadyToReveal(1, 2), false);
    assert.equal(territoryChapterSwitchReadyToReveal(2, 2), true);
});

test('★★等加载有上限：云盖着不动的画面安全，但不能无限等', () => {
    assert.ok(TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS >= 2, '太短：弱网下正常加载都会被判超时');
    assert.ok(TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS <= 12, '太长：加载失败时云会盖很久');
});

// ============================================================
// ② 触发源：只有玩家点章节按钮
// ============================================================

test('★★★模型只在「玩家点章节」那两条路上发 chapterSwitch，自动推进不发', () => {
    const model = read('assets/script/app/territory/application/TerritoryModel.ts');
    // 发命令的地方只有 `announceChapterSwitch` 一处。
    const publishAt = model.match(/this\.publish\(\{ kind: 'chapterSwitch'/g) ?? [];
    assert.equal(publishAt.length, 1, `chapterSwitch 只允许一个发出口（实际 ${publishAt.length}）`);
    // 调用点只有 `switchChapter` / `selectChapter` 两处。
    const calls = model.match(/this\.announceChapterSwitch\(/g) ?? [];
    assert.equal(calls.length, 2, `announceChapterSwitch 只该被 switchChapter / selectChapter 调（实际 ${calls.length}）`);

    const switchBody = model.slice(model.indexOf('    switchChapter(offset: number): void {'));
    assert.ok(switchBody.slice(0, switchBody.indexOf('\n    }')).includes('this.announceChapterSwitch(nextChapter)'),
        '翻页切章必须发命令（否则点了章节按钮没动画）');

    const selectBody = model.slice(model.indexOf('    selectChapter(chapterId: number): void {'));
    assert.ok(selectBody.slice(0, selectBody.indexOf('\n    }')).includes('this.announceChapterSwitch(chapterId)'),
        '章节选择弹窗选章必须发命令（含回到已通过的章节）');

    // 🔴 自动推进那条路**不许**发：用户原话「玩家只能通过章节按钮播放切换动画」。
    const advanceBody = model.slice(model.indexOf('    private advanceCompletedChapter(): void {'));
    const advance = advanceBody.slice(0, advanceBody.indexOf('\n    }'));
    assert.ok(!advance.includes('announceChapterSwitch'), '通关后自动进下一章不许播转场');
    assert.match(advance, /void this\.loadChapter\(nextChapter\)/, '自动推进仍然是直接加载');
});

test('★★★命令走的是视图命令通道（页面才收得到）', () => {
    const model = read('assets/script/app/territory/application/TerritoryModel.ts');
    const output = model.slice(model.indexOf('export type TerritoryModelOutput ='),
        model.indexOf('export class TerritoryModel'));
    assert.match(output, /readonly kind: 'chapterSwitch'/, '模型输出里没有这一条 ⇒ 页面永远收不到');
    assert.match(output, /readonly fromChapterId: number/);
    assert.match(output, /readonly toChapterId: number/);

    // 视图命令通道 = 模型输出**减去** `changed` / `navigate`；`chapterSwitch` 不在排除名单里，
    // 所以它天然从这条通道走（排除名单多一个，页面就收不到了）。
    const events = read('assets/script/app/territory/application/TerritoryEvents.ts');
    assert.match(events, /Exclude<TerritoryModelOutput, \{ readonly kind: 'changed' \| 'navigate' \}>/);
    assert.doesNotMatch(events, /kind: 'changed' \| 'navigate' \| 'chapterSwitch'/);
});

// ============================================================
// ③ 接线：页面 / 地图视图 / 云视图
// ============================================================

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const MAP_VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const CLOUD_VIEW = 'assets/script/app/territory/view/TerritoryCloudView.ts';
const MODEL = 'assets/script/app/territory/application/TerritoryModel.ts';

test('★★★页面：命令进来就起演；四段状态机里的判据都用了纯函数', () => {
    const page = read(PAGE);
    assert.match(page, /case 'chapterSwitch': this\.beginChapterSwitch\(command\.fromChapterId, command\.toChapterId\); break;/);

    const begin = page.slice(page.indexOf('    private beginChapterSwitch('));
    const beginBody = begin.slice(0, begin.indexOf('\n    }\n'));
    assert.match(beginBody, /territoryChapterSwitchWanted\(fromChapterId, toChapterId\)/, '同章不许白合拢一次云');
    assert.match(beginBody, /beginChapterSwitch\(\)/, '起手必须让地图视图把云盖层建出来');
    assert.match(beginBody, /territoryChapterSwitchRise\(height\)/, '落位距离按视口高度算');
    // 2026-11-05：起手是**相机先行**，不是直接合拢。
    assert.match(beginBody, /phase: 'lead'/, '第一段必须是相机先行，不许直接开始盖云');
    assert.match(beginBody, /this\.writeChapterSwitchLead\(0\)/, '第一帧写"云在画面外、地图没动"的原样');

    const stepAt = page.indexOf('    private stepChapterSwitch(step: number): void {');
    const stepBody = page.slice(stepAt, page.indexOf('\n    }\n', stepAt));
    // 段序：lead 必须在 cover 之前，且 lead 走完才切 cover。
    const leadAt = stepBody.indexOf("if (transition.phase === 'lead')");
    const coverAt = stepBody.indexOf("if (transition.phase === 'cover')");
    assert.ok(leadAt > 0, '没有相机先行段 ⇒ 云和位移又挤在一起了');
    assert.ok(leadAt < coverAt, '先行段必须排在合拢段之前');
    assert.match(stepBody.slice(leadAt, coverAt), /territoryChapterSwitchLeadProgress\(transition\.elapsed\)/);
    assert.match(stepBody.slice(leadAt, coverAt), /this\.writeChapterSwitchLead\(progress\)/);
    assert.match(stepBody.slice(leadAt, coverAt), /transition\.phase = 'cover';/);

    assert.match(stepBody, /territoryChapterSwitchCoverProgress\(transition\.elapsed\)/);
    assert.match(stepBody, /territoryChapterSwitchRevealProgress\(transition\.elapsed\)/);
    assert.match(stepBody, /territoryChapterSwitchReadyToReveal\(this\.lastRenderedChapter, transition\.to\)/,
        '揭幕必须看"已渲染的章号"，否则会在旧图上揭幕');
    assert.match(stepBody, /TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS/, '等加载必须有超时收场');
    assert.match(stepBody, /this\.endChapterSwitch\(\)/);
    // `update` 里必须真的推进它，否则永远停在合拢第一帧。
    assert.match(page, /if \(this\.chapterSwitch\) \{\n            this\.stepChapterSwitch\(step\);/);
});

test('★★★页面：先行段只有位移（云还在画面外），合拢段相机停下不动', () => {
    const page = read(PAGE);
    const lead = page.slice(page.indexOf('    private writeChapterSwitchLead(progress: number): void {'));
    const leadBody = lead.slice(0, lead.indexOf('\n    }\n'));
    // 云：`out(0)` 的原样 + 透明度 0 —— 这一段玩家不该看见任何云。
    assert.match(leadBody, /territoryBattleIntroOutFxAt\(0\)/);
    assert.match(leadBody, /applyChapterSwitchCover\(fx\.coverSpread, 0, 0\)/);
    assert.match(leadBody, /setChapterSwitchOffset\(territoryChapterSwitchSinkOffset\(progress, transition\.rise\)\)/);

    const cover = page.slice(page.indexOf('    private writeChapterSwitchFx(coverProgress: number, revealProgress?: number): void {'));
    const coverBody = cover.slice(0, cover.indexOf('\n    }\n'));
    // 合拢段写**常量**位移：按进度再插值一次会从 0 重算，画面往回弹。
    assert.match(coverBody, /setChapterSwitchOffset\(territoryChapterSwitchSinkDistance\(transition\.rise\)\)/);
    assert.doesNotMatch(coverBody, /setChapterSwitchOffset\(territoryChapterSwitchSinkOffset\(/,
        '合拢段不许再按 coverProgress 插值位移（相机在先行段就到位了）');
});

test('★★★页面：整章云散没演完之前不许换图（否则 syncGrid 把演出掐断）', () => {
    const page = read(PAGE);
    const render = page.slice(page.indexOf('    private renderAll(): void {'));
    const renderBody = render.slice(0, render.indexOf('\n    }\n'));
    // 判据必须在 `lastRenderedChapter = state.chapterId` **之前**（在之后就已经换完了）。
    const guardAt = renderBody.indexOf('this.mapView?.chapterClearPlaying');
    const stampAt = renderBody.indexOf('this.lastRenderedChapter = state.chapterId');
    assert.ok(guardAt > 0, '没判「云散还在演」 ⇒ 通关那一下的演出又被掐掉');
    assert.ok(guardAt < stampAt, '压住的判定必须排在「记住已经渲染的章号」之前');
    assert.match(renderBody, /this\.chapterSwapPending = true;/, '压住之后必须留个标记，否则永远补不上');

    // `update` 里补画（排在所有早退之前）。
    const update = page.slice(page.indexOf('    update(dt: number): void {'));
    const updateBody = update.slice(0, update.indexOf('\n        const prelude = this.battlePrelude;'));
    assert.match(updateBody, /if \(this\.chapterSwapPending\) \{/);
    assert.match(updateBody, /this\.renderAll\(\);/);
    assert.ok(updateBody.indexOf('chapterSwapPending') < updateBody.indexOf('stepChapterSwitch'),
        '先补画新章、再推进转场（转场要等新章画上来才揭幕）');
});

test('★★★页面：通关要让地图知道（新口径下「全图都打通」可能永远不成立）', () => {
    const page = read(PAGE);
    assert.match(page, /chapterCleared: state\.chapterCleared,/);
    const view = read(MAP_VIEW);
    const sync = view.slice(view.indexOf('    private syncClouds('));
    const syncBody = sync.slice(0, sync.indexOf('\n    }\n'));
    // 🔴 顺序是硬要求：`sync` 每帧都会重算「该不该有雾」，先把状态写进去它才认。
    const forceAt = syncBody.indexOf('this.clouds.setChapterCleared(input.chapterCleared');
    const syncAt = syncBody.indexOf('this.clouds.sync(');
    assert.ok(forceAt > 0, '地图没接这条 ⇒ 通关后雾不散');
    assert.ok(forceAt < syncAt, '散雾状态必须写在 `sync` 之前，否则下一帧就把雾复原回来');
    // 章节号一起传：散雾只给首次通关演，视图要靠它认出「换章、基线重起」（2026-11-05）。
    assert.match(syncBody, /setChapterCleared\(input\.chapterCleared, input\.chapterClearPending\)/);
});

test('★★★云视图：「通关散雾」是每帧写入的状态，`sync` 得认它（否则雾会一闪一闪）', () => {
    const cloud = read(CLOUD_VIEW);
    const set = cloud.slice(cloud.indexOf('    setChapterCleared(cleared: boolean, animate: boolean): void {'));
    const setBody = set.slice(0, set.indexOf('\n    }\n'));
    assert.match(setBody, /this\.dismissForced = true;/, '只做一次性动作的话，下一次 `sync` 就把它复原了');
    // `false` 必须能撤掉标记：两章布局键相同时 `syncGrid` 会早退、不重建云，
    // 粘住的旧标记会让新一章的雾一上来就是散的。
    assert.match(setBody, /if \(!cleared\) \{\n            this\.dismissForced = false;\n            return;\n        \}/);
    // `sync` 的判据里必须有它。
    const sync = cloud.slice(cloud.indexOf('    sync(\n'));
    assert.match(sync.slice(0, sync.indexOf('this.syncKeepOut(')),
        /if \(this\.dismissForced \|\| this\.isMapCleared\(revealed\)\)/);
    // 换章 / 收起要清掉（新一章有它自己的雾）。
    const reset = cloud.slice(cloud.indexOf('    reset(): void {'));
    assert.match(reset.slice(0, reset.indexOf('\n    }\n')), /this\.dismissForced = false;/);
});

test('★★★「通过的动画只有首次通关播放」，切回已通过的章节不许再演一遍（2026-11-05）', () => {
    // ── 判据是纯函数，直接按行为验 ──
    // 没通关：不动。
    assert.equal(territoryCloudClearAction(false, false, false), 'none');
    assert.equal(territoryCloudClearAction(false, true, false), 'none', 'animate 只是"刚打通"，没通就还是不动');
    // 首次通关（模型给的一次性边沿）：演。
    assert.equal(territoryCloudClearAction(true, true, false), 'animate');
    // 切回已通过的章节：`cleared` 仍为 true，但 `animate` 为 false ⇒ 直接收掉、不演。
    assert.equal(territoryCloudClearAction(true, false, false), 'instant',
        '只看 cleared 就会"一进本章雾自己演一遍散场"');
    // 已经在演（或已淡完）：幂等，不重启。
    assert.equal(territoryCloudClearAction(true, true, true), 'none');
    assert.equal(territoryCloudClearAction(true, false, true), 'none');

    // ── 接线：视图只执行判据，不再自己猜"换章了没有" ──
    const cloud = read(CLOUD_VIEW);
    assert.match(cloud, /setChapterCleared\(cleared: boolean, animate: boolean\): void \{/);
    const set = cloud.slice(cloud.indexOf('    setChapterCleared(cleared: boolean, animate: boolean): void {'));
    const setBody = set.slice(0, set.indexOf('\n    }\n'));
    assert.match(setBody, /territoryCloudClearAction\(/);
    assert.match(setBody, /if \(action === 'animate'\) this\.startDismiss\(\);/);
    assert.match(setBody, /else if \(action === 'instant'\) this\.dismissFillNow\(\);/);
    assert.ok(!/clearedChapterId|clearedSeen/.test(cloud),
        '基线的活归模型（`chapterClearPending`），视图别再自己记"上一拍通没通"');

    // 瞬收只写**终态**：不拉镜头、不编波次，且必须把铺满层关掉。
    const now = cloud.slice(cloud.indexOf('    private dismissFillNow(): void {'));
    const nowBody = now.slice(0, now.indexOf('\n    }\n'));
    assert.match(nowBody, /this\.dollyElapsed = -1;/);
    assert.match(nowBody, /this\.fillFadeElapsed = -1;/);
    assert.match(nowBody, /this\.fillDismissed = true;/);
    assert.match(nowBody, /this\.applyFillActive\(\);/);

    // 瞬收之后 `dismissing` 必须是 false —— 否则页面会一直"等云散完"、永远不换图。
    const dismissing = cloud.slice(cloud.indexOf('    get dismissing(): boolean {'));
    assert.match(dismissing.slice(0, dismissing.indexOf('\n    }\n')),
        /this\.fillFadeElapsed >= 0 && !this\.fillDismissed/);

    // ── 模型：边沿在**动手之前**取（`wasComplete`），且必须赶在广播之前置位 ──
    const model = read(MODEL);
    assert.match(model, /readonly chapterClearPending: boolean;/);
    assert.match(model, /private chapterClearPending = false;/);
    const note = model.slice(model.indexOf('    private noteChapterJustCleared(wasComplete: boolean): void {'));
    const noteBody = note.slice(0, note.indexOf('\n    }\n'));
    assert.match(noteBody, /if \(wasComplete\) return;/, '进章节就已经通着 ⇒ 不许置位');
    assert.match(noteBody, /if \(!this\.chapterCompletion\(\)\.complete\) return;/);
    assert.match(noteBody, /this\.chapterClearPending = true;/);
    // 换章要清（新章有它自己的命）。
    const load = model.slice(model.indexOf('    private async loadChapter('));
    assert.match(load.slice(0, load.indexOf('    // ============================================================')),
        /this\.chapterClearPending = false;/);
    // 通道只有一条：`emitStateChange` 发完就消费（不消费会被每次重绘重演一遍）。
    const emit = model.slice(model.indexOf('    private emitStateChange(): void {'));
    const emitBody = emit.slice(0, emit.indexOf('\n    }\n'));
    assert.ok(emitBody.indexOf('this.publish(') < emitBody.indexOf('this.chapterClearPending = false'),
        '"发出去的那一拍"才算消费，先发后清');
});

test('★★★云视图：能报「还在演」、也能被通关强行收掉', () => {
    const cloud = read(CLOUD_VIEW);
    assert.match(cloud, /get dismissing\(\): boolean \{/);
    // 还在演 = 拉远段 或 铺满层淡出段（淡完 `fillDismissed` 才算收工）。
    const dismissing = cloud.slice(cloud.indexOf('    get dismissing(): boolean {'));
    const body = dismissing.slice(0, dismissing.indexOf('\n    }\n'));
    assert.match(body, /this\.dollyElapsed >= 0/);
    assert.match(body, /this\.fillFadeElapsed >= 0 && !this\.fillDismissed/);
    assert.match(cloud, /setChapterCleared\(cleared: boolean, animate: boolean\): void \{/);
    // 幂等：已经在演就别重启（每帧的 `renderMap` 都会走到这里）。
    const dismiss = cloud.slice(cloud.indexOf('    setChapterCleared(cleared: boolean, animate: boolean): void {'));
    assert.match(dismiss.slice(0, dismiss.indexOf('\n    }\n')),
        /this\.fillDismissed \|\| this\.fillFadeElapsed >= 0 \|\| this\.dollyElapsed >= 0,/);
});

test('★★★地图视图：转场必须能建云、写位移、收工归位，且不许与整页过场撞车', () => {
    const view = read(MAP_VIEW);
    const begin = view.slice(view.indexOf('    beginChapterSwitch(): boolean {'));
    const beginBody = begin.slice(0, begin.indexOf('\n    }\n'));
    assert.match(beginBody, /if \(this\.battleIntroActive \|\| this\.battleApproach !== null\) return false;/,
        '整页过场 / 推镜过场在演时不抢同一层云与同一个 MapLayer');
    assert.match(beginBody, /this\.battleCover\.count <= 0/, '云美术没加载上 ⇒ 演不了，别盖空白');
    assert.match(beginBody, /this\.setChapterSwitchActive\(true\)/);

    const end = view.slice(view.indexOf('    endChapterSwitch(): void {'));
    const endBody = end.slice(0, end.indexOf('\n    }\n'));
    assert.match(endBody, /this\.battleCover\?\.clear\(\)/);
    assert.match(endBody, /this\.resetChapterSwitchOffset\(\)/, '收工必须把地图放回原位');
    assert.match(endBody, /this\.setChapterSwitchActive\(false\)/, '收工必须解锁输入');

    // 位移只写 `MapLayer` 的 y；有别的镜头在演时让位（同一个节点，抢起来会把地图停偏）。
    const offset = view.slice(view.indexOf('    setChapterSwitchOffset(offset: number): void {'));
    const offsetBody = offset.slice(0, offset.indexOf('\n    }\n'));
    assert.match(offsetBody, /if \(!this\.node\?\.isValid \|\| this\.chestCameraActive\) return;/);
    assert.match(offsetBody, /this\.chapterSwitchRestY = this\.node\.position\.y;/, '基点只量一次');

    // 输入锁不能被 `update` 的自动解锁放掉。
    assert.match(view, /!this\.chapterSwitchActive\) \{/);
});

test('★★★换章重建网格时把转场位移归零（新图要按自己的基准摆）', () => {
    const view = read(MAP_VIEW);
    const grid = view.slice(view.indexOf('    private syncGrid(input: ITerritoryMapRenderInput): void {'));
    const body = grid.slice(0, grid.indexOf('\n    }\n'));
    const order = body.indexOf('this.resetChapterSwitchOffset()');
    assert.ok(order > 0, '换章不归零 ⇒ 新章第一帧是歪的');
    assert.ok(body.indexOf('this.restoreChestCamera()') < order, '先还镜头基准，再归零转场位移');
    // 云仍然要在换章时复位：这就是"演出必须演完才换图"的根因，别顺手删掉。
    assert.match(body, /this\.clouds\.reset\(\);/, 'syncGrid 换章复位云是正确行为，「压住换图」才是解法');
});
