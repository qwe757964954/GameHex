import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    ZC_BATTLE_START_ANIMATION,
    ZC_BATTLE_START_CENTER_OFFSET_Y,
    ZC_BATTLE_START_FALLBACK_SECONDS,
    ZC_BATTLE_START_STATIC_ANIMATION,
} from '../assets/script/app/zcds/model/ZCBattleStartStyle';
import { zcUiBannerCanvasWidthOf, zcUiBannerScale, ZC_UI_BANNER_WIDTH } from '../assets/script/app/zcds/model/ZCUISpineBannerStyle';

/**
 * 对局开始「开局对战」特效（2026-11-25 需求）。
 *
 * 需求原文：「对局开始进入到地图时，镜头最高还没开始推镜头时，播放一次对局开始特效，
 * 对局开始特效要填充满 720 宽的屏幕横度」。
 *
 * 拆成四条硬口径，本文件按它们分组：
 * ① 播哪一段（动画名必须是骨架里真的有的）；② 什么时候播（全景停留那 0.45s，推镜头开始就关窗）；
 * ③ 只播一次、播完收掉（横幅挂 HUD 根上，留着下一局会看到上一局的）；
 * ④ 铺满 720（按画布宽折算，与结算胜负特效共用一份口径）。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const HUD_SOURCE = read('assets/script/app/zcds/view/ZCGameHUDView.ts');
const GAME_SOURCE = read('assets/script/app/zcds/ZCGame.ts');
const PLAN_SOURCE = read('assets/script/app/zcds/model/ZCGameResourcePlan.ts');
const FX_SOURCE = read('assets/script/app/zcds/view/ZCUISpineBannerFx.ts');
const STYLE_SOURCE = read('assets/script/app/zcds/model/ZCUISpineBannerStyle.ts');
const SKEL = 'assets/bundles/battle/units/effects/开局对战UI特效/score_anim.skel';

/** `playMapIntro` 的函数体（到下一个方法声明为止）。 */
function playMapIntroBody(): string {
    const start = HUD_SOURCE.indexOf('private playMapIntro(): void {');
    assert.ok(start > 0, 'ZCGameHUDView 必须保留 playMapIntro');
    const end = HUD_SOURCE.indexOf('\n    private setBattleStartEffect', start);
    return HUD_SOURCE.slice(start, end > start ? end : start + 1800);
}

/** `playBattleStartEffect` 的函数体。 */
function playBattleStartEffectBody(): string {
    const start = HUD_SOURCE.indexOf('private playBattleStartEffect(): void {');
    assert.ok(start > 0, 'ZCGameHUDView 必须保留 playBattleStartEffect');
    return HUD_SOURCE.slice(start, start + 1100);
}

/* --------------------------------------------------- ① 播哪一段 */

test('① 动画名取自骨架本身，且骨架里只有这两段（改名 = 实机静默不播）', () => {
    const binary = readFileSync(join(ROOT, SKEL));
    //  spine 找不到动画只打日志、不抛 ⇒「名字对不对」只能用例钉住：扫二进制里的字符串表。
    for (const name of [ZC_BATTLE_START_ANIMATION, ZC_BATTLE_START_STATIC_ANIMATION]) {
        assert.ok(binary.includes(Buffer.from(name, 'ascii')), `${SKEL} 里必须真有动画 ${name}`);
    }
    const found = (binary.toString('latin1').match(/dzks_[A-Za-z0-9_]+/g) ?? []);
    assert.deepEqual(
        [...new Set(found)].sort(),
        [ZC_BATTLE_START_ANIMATION, ZC_BATTLE_START_STATIC_ANIMATION].sort(),
        '骨架换了 / 多了第三段 ⇒ 该播哪一条要重新确认',
    );
    //  正式流程只播入场那条；静态版是「常驻展示」的备选，不能被误用成开局动画。
    assert.notEqual(ZC_BATTLE_START_ANIMATION, ZC_BATTLE_START_STATIC_ANIMATION);
    assert.match(playBattleStartEffectBody(), /createZCUISpineBannerNode\(prefab, ZC_BATTLE_START_ANIMATION,/);
    assert.doesNotMatch(HUD_SOURCE, /createZCUISpineBannerNode\([^,]+,\s*ZC_BATTLE_START_STATIC_ANIMATION/);
});

test('① 竖直偏移只留一个出口，且不硬写进节点组装件', () => {
    assert.equal(typeof ZC_BATTLE_START_CENTER_OFFSET_Y, 'number');
    assert.ok(Number.isFinite(ZC_BATTLE_START_CENTER_OFFSET_Y));
    assert.match(playBattleStartEffectBody(), /centerY: ZC_BATTLE_START_CENTER_OFFSET_Y/);
    //  组装件必须按 options 走：「偏移」是各条横幅自己的事，通用件里不许出现开局专用常量。
    assert.doesNotMatch(FX_SOURCE, /ZC_BATTLE_START_/);
});

/* ------------------------------------- ② 什么时候播：全景停留那一拍 */

test('② 窗口在 playMapIntro 里开：镜头摆到全景之后、起 tween 之前', () => {
    const body = playMapIntroBody();
    const hold = body.indexOf('this.mapIntroHolding = true;');
    const play = body.indexOf('this.playBattleStartEffect();');
    const start = body.indexOf('this.mapIntroTween = tween(this.mapLayer)');
    assert.ok(hold > 0, '全景停留期必须自己开窗（不是靠 mapIntroPlaying）');
    assert.ok(play > hold, '先开窗再起播');
    assert.ok(start > play, '起播要在 tween 之前：同帧就播，别等第一帧 update');
    //  「镜头最高」= 全景倍率已经设好的那一段，不是入场动画中途。
    assert.ok(body.indexOf('this.mapLayer.setScale(overviewScale, overviewScale, 1);') < hold);
});

test('② 推镜头一开始就关窗（要的是最高点那一拍，不是入场全程）', () => {
    const body = playMapIntroBody();
    const close = body.indexOf('.call(() => { this.mapIntroHolding = false; })');
    const zoom = body.indexOf('.to(ZCGameHUDView.MAP_ZOOM_DURATION_SECONDS, {');
    assert.ok(close > 0, '关窗必须挂在 tween 上 —— 时间由 0.45s 停留常量决定');
    //  顺序：delay(停留) → 关窗 → 推镜头。关窗写在推镜头之后就等于全场都能播。
    assert.ok(body.indexOf('.delay(ZCGameHUDView.MAP_OVERVIEW_HOLD_SECONDS)') < close);
    assert.ok(close < zoom, '推镜头之前就要关窗');
    //  兜底：三条会掐断入场的路径也要关窗，否则窗口一直开着、补播会在推镜头之后触发。
    for (const anchor of [
        'private showSpawnSelectionMap(): void {',
        'setSpawnSelectionMode(active: boolean): void {',
    ]) {
        const at = HUD_SOURCE.indexOf(anchor);
        assert.ok(at > 0, `必须保留 ${anchor}`);
        assert.match(HUD_SOURCE.slice(at, at + 900), /this\.mapIntroHolding = false;/, `${anchor} 掐断入场时也要关窗`);
    }
    const reset = HUD_SOURCE.indexOf('\n    resetMapPosition(): void {');
    assert.match(HUD_SOURCE.slice(reset, reset + 900), /this\.mapIntroHolding = false;/);
});

test('② 起播的唯一入口自己再判一次窗口 + 幂等（外部乱调也不会在推镜头后补播）', () => {
    const body = playBattleStartEffectBody();
    assert.match(body, /if \(!this\.mapIntroHolding \|\| this\.battleStartPlayed\) return;/);
    assert.match(body, /const prefab = this\.battleStartPrefab;\s*if \(!prefab\) return;/, '预制体没到货就静默跳过');
});

/* ------------------------------------------- ③ 只播一次、播完收掉 */

test('③ 一局只播一次：置位在 create 之前，重复调用直接返回', () => {
    const body = playBattleStartEffectBody();
    const flag = body.indexOf('this.battleStartPlayed = true;');
    const create = body.indexOf('const banner = createZCUISpineBannerNode(');
    assert.ok(flag > 0 && create > flag, '先置位再建节点：中间抛错也不会下一帧再建一条');
    assert.match(HUD_SOURCE, /private battleStartPlayed = false;/);
});

test('③ playMapIntro 重开时复位：先收上一局残的，再清标记', () => {
    const body = playMapIntroBody();
    const clear = body.indexOf('this.clearBattleStartBanner();');
    const reset = body.indexOf('this.battleStartPlayed = false;');
    const play = body.indexOf('this.playBattleStartEffect();');
    assert.ok(clear > 0 && clear < play, '重开一局要先收上一局的横幅，否则会闪一下旧的「对战开始」');
    assert.ok(reset > 0 && reset < play);
});

test('③ 播完 scheduleOnce 收掉；时长读不出来时用兜底值，不能永久挂着', () => {
    const body = playBattleStartEffectBody();
    assert.match(
        body,
        /const clip = zcUiBannerClipSecondsOf\(banner\.skeleton\.skeletonData, ZC_BATTLE_START_ANIMATION\);\s*const life = clip > 0 \? clip \+ 0\.1 : ZC_BATTLE_START_FALLBACK_SECONDS;/,
        '按时长收（+0.1 让尾帧播完），读不到才退兜底',
    );
    assert.match(body, /this\.scheduleOnce\(\(\) => this\.clearBattleStartBanner\(banner\), life\);/,
        '只收本局那一条（下一局可能已经起了新的）');
    assert.ok(ZC_BATTLE_START_FALLBACK_SECONDS > 0, '兜底时长必须为正，0 等于立刻收');
    //  `clearBattleStartBanner(only)` 的 `only` 语义：不是自己那条就不动。
    assert.match(
        HUD_SOURCE,
        /const banner = this\.battleStartBanner;\s*if \(!banner \|\| \(only && banner !== only\)\) return;/,
    );
    assert.match(HUD_SOURCE, /if \(isZCUISpineBannerAlive\(banner\)\) destroyZCUISpineBanner\(banner\);/);
});

test('③ 预制体异步到货时补播；已退出（hudView 没了）就不碰', () => {
    assert.match(HUD_SOURCE, /setBattleStartEffect\(prefab: Prefab \| null\): void \{\s*this\.battleStartPrefab = prefab;\s*this\.playBattleStartEffect\(\);/,
        '到货即尝试补播（窗口还开着就播，关了就被 playBattleStartEffect 自己挡掉）');
    const loader = GAME_SOURCE.slice(GAME_SOURCE.indexOf('private loadBattleStartBanner(): void {'));
    assert.match(loader.slice(0, 700), /if \(!this\.hudView\) return;/, 'promise 在飞时可能已经退出对局');
    assert.match(loader.slice(0, 700), /this\.hudView\.setBattleStartEffect\(prefab\);/);
});

test('③ HUD 销毁时自己先收一次（引擎的 destroy 是下一帧生效）', () => {
    const start = HUD_SOURCE.indexOf('protected onDestroy(): void {');
    assert.ok(start > 0);
    const body = HUD_SOURCE.slice(start, start + 260);
    assert.match(body, /this\.clearBattleStartBanner\(\);/);
    assert.match(body, /this\.battleStartPrefab = null;/, '预制体引用也要放掉，否则整局资源跟着 HUD 一起泄漏');
});

/* --------------------------------------------------------- ④ 铺满 720 */

test('④ 按画布宽折算到 720：开局骨架 560 画布 / 558 可见宽', () => {
    assert.equal(ZC_UI_BANNER_WIDTH, 720);
    assert.equal(zcUiBannerScale(560), 720 / 560);
    //  可见横幅 `blue_line` 是 546×106、整体可见宽 558 ⇒ 折算后屏上约 717，基本满宽。
    const onScreen = 558 * zcUiBannerScale(560);
    assert.ok(onScreen >= 714 && onScreen <= 720, `屏上可见宽 ${onScreen.toFixed(1)} 必须贴近 720`);
    //  反例钉住「按高归一」的错法：拿可见横幅高度去凑 720，宽只剩 140 量级的一小截。
    const byHeight = 558 * (ZC_UI_BANNER_WIDTH / 106);
    assert.ok(byHeight > 3000, '这条只是说明按高归一的量级完全不对（不是可用口径）');
});

test('④ 开局那条不折算倍速：需求只说「播放一次」，不是「铺满多少秒」', () => {
    const body = playBattleStartEffectBody();
    assert.doesNotMatch(body, /durationSeconds:/, '传了 durationSeconds 就会被拉伸成整段填满扫场时长');
    //  通用件里 `durationSeconds` 缺省 = 原速；这条口径不能被反转。
    assert.match(FX_SOURCE, /options\.durationSeconds \?\? 0/);
    assert.match(STYLE_SOURCE, /if \(!\(durationSeconds > 0\)\) return 1;/);
    //  画布宽取不到时退回 1（不是 0）：0 缩放在屏上就是没有。
    assert.equal(zcUiBannerScale(0), 1);
    assert.equal(zcUiBannerCanvasWidthOf(null), 0);
});

/* --------------------------------------------------------- ⑤ 资源与接线 */

test('⑤ 开局横幅走 Prefab 主导：路径声明在资源计划里，按 Prefab 加载，预制体自带 720 宽缩放', () => {
    assert.match(
        PLAN_SOURCE,
        /battleStartBanner: `\$\{BATTLE_EFFECTS_DIRECTORY\}\/开局对战UI特效\/开局对战UI特效`/,
        '路径必须唯一声明在 ZC_BATTLE_FX_PATHS',
    );
    for (const name of ['ZC_BATTLE_COMMON_FX_PREFABS', 'ZC_BATTLE_COMMON_PREFABS']) {
        const start = PLAN_SOURCE.indexOf(`const ${name}`);
        assert.ok(start > 0, `ZCGameResourcePlan 必须保留 ${name}`);
        assert.doesNotMatch(
            PLAN_SOURCE.slice(start, start + 340),
            /battleStartBanner/,
            `${name} 是首包预热清单，开局横幅改为异步加载，不应进入首包`,
        );
    }
    assert.match(GAME_SOURCE, /this\.loadBattlePrefab\(ZC_BATTLE_FX_PATHS\.battleStartBanner, '开局对战特效'/);

    const prefab = JSON.parse(read('assets/bundles/battle/units/effects/开局对战UI特效/开局对战UI特效.prefab')) as any[];
    const skelMeta = JSON.parse(read('assets/bundles/battle/units/effects/开局对战UI特效/score_anim.skel.meta')) as { uuid: string };
    const rootNode = prefab.find((item) => item.__type__ === 'cc.Node');
    const skelComp = prefab.find((item) => item.__type__ === 'sp.Skeleton');
    assert.ok(rootNode && skelComp, '开局对战UI特效.prefab 必须存在且挂载 sp.Skeleton');
    assert.equal(rootNode._layer, 33554432);
    assert.ok(Math.abs(rootNode._lscale.x - 720 / 560) < 1e-6, '720 宽适配缩放必须烘进 prefab');
    assert.equal(skelComp._skeletonData?.__uuid__, skelMeta.uuid);
    assert.equal(skelComp._premultipliedAlpha, false);
    assert.equal(skelComp.defaultAnimation, ZC_BATTLE_START_ANIMATION);
    assert.equal(skelComp.loop, false);
});

test('⑤ 发起时机在 createGame 之前：HUD 的 initialize 会同帧跑 playMapIntro', () => {
    const load = GAME_SOURCE.indexOf('this.loadBattleStartBanner();');
    const create = GAME_SOURCE.indexOf('this.createGame(entry.resources, model, selection);');
    assert.ok(load > 0, 'ZCGame 必须在 initialize 里发起预加载');
    assert.ok(create > load, '晚一步就一定错过那 0.45s 的全景停留窗');
    //  同一份入口也把「资源作用域」摆好了：`preparedResources` 先赋值，加载走 `artResources`。
    assert.ok(GAME_SOURCE.indexOf('this.preparedResources = entry.resources;') < load);
});
