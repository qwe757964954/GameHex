import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    zcOutcomeAnimationOf,
    zcOutcomeEffectSeconds,
    ZC_OUTCOME_LOSE_ANIMATION,
    ZC_OUTCOME_WIN_ANIMATION,
} from '../assets/script/app/zcds/model/ZCSettlementOutcomeStyle';
import {
    zcUiBannerCanvasWidthOf,
    zcUiBannerCenterOf,
    zcUiBannerClipSecondsOf,
    zcUiBannerScale,
    zcUiBannerTimeScale,
    ZC_UI_BANNER_WIDTH,
} from '../assets/script/app/zcds/model/ZCUISpineBannerStyle';

/**
 * 结算胜负 UI 特效（2026-11-25 需求）。
 *
 * 需求原文：「判定出胜负时，地块翻转的结算动画同步播放，胜利播放胜利 UI，失败播放失败 UI
 * 特效，特效需要匹配屏幕宽度 720px，填充整个宽度，持续的时间和地块翻转结算动画时间一致」。
 *
 * 「地块翻转的结算动画」= `ZCVictorySweep` 的三段式扫场。本批的三条硬口径：
 * ① 胜负各播哪一段；② 铺满 720 宽；③ 时长必须**等于**扫场时长（不是"播完就停"）。
 */

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const GAME_SOURCE = read('assets/script/app/zcds/ZCGame.ts');
const FX_SOURCE = read('assets/script/app/zcds/view/ZCUISpineBannerFx.ts');
const STYLE_SOURCE = read('assets/script/app/zcds/model/ZCUISpineBannerStyle.ts');
const WORLD_SOURCE = read('assets/script/app/zcds/view/ZCGameRenderWorld.ts');
const SWEEP_SOURCE = read('assets/script/app/zcds/view/ZCVictorySweep.ts');
const PLAN_SOURCE = read('assets/script/app/zcds/model/ZCGameResourcePlan.ts');
const SKEL = 'assets/bundles/battle/units/effects/胜利失败UI特效/ddz_sgfc_sl_ani.skel';

/* --------------------------------------------------- ① 胜负各播哪一段 */

test('① 胜利播 sl、失败播 sb，且两个名字在 .skel 里真的存在', () => {
    assert.equal(zcOutcomeAnimationOf('victory'), ZC_OUTCOME_WIN_ANIMATION);
    assert.equal(zcOutcomeAnimationOf('defeat'), ZC_OUTCOME_LOSE_ANIMATION);
    for (const other of ['playing', 'draw', '', null, undefined]) {
        assert.equal(zcOutcomeAnimationOf(other), '', `${String(other)} 不是胜负态，不该弹横幅`);
    }
    //  名字不能只活在常量里：骨架里搜不到 = 实机 `setAnimation` 静默不播（spine 找不到动画只打日志）。
    const binary = readFileSync(join(ROOT, SKEL));
    for (const name of [ZC_OUTCOME_WIN_ANIMATION, ZC_OUTCOME_LOSE_ANIMATION]) {
        assert.ok(binary.includes(Buffer.from(name, 'ascii')), `${SKEL} 里必须真有动画 ${name}`);
    }
    //  只有这两段：多出第三段说明美术换了骨架，`sb` / `sl` 的对应关系要重新确认。
    const found = (binary.toString('latin1').match(/ddz_sgfc_[a-z]+_ani/g) ?? []);
    assert.deepEqual([...new Set(found)].sort(), [ZC_OUTCOME_LOSE_ANIMATION, ZC_OUTCOME_WIN_ANIMATION].sort());
});

/* ------------------------------------------------ ② 铺满 720 屏宽 */

test('② 按画布宽折算到 720：横条不能被按高归一', () => {
    //  美术骨架画布 744×744、可见横幅 726×257 ⇒ 按高归一只有 ~340 宽，与"填充整个宽度"相反。
    assert.equal(ZC_UI_BANNER_WIDTH, 720);
    assert.equal(zcUiBannerScale(744), 720 / 744);
    assert.equal(zcUiBannerScale(720), 1);
    //  画布宽拿不到 / 非法：退回原尺寸，绝不能是 0（0 缩放在屏上就是没有）。
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
        assert.equal(zcUiBannerScale(bad), 1, `${String(bad)} 必须退回 1`);
    }
});

test('② 居中按父级内容矩形反算，不硬写 (0,0)', () => {
    assert.equal(zcUiBannerCenterOf(720, 0.5), 0);
    assert.equal(zcUiBannerCenterOf(720, 0), 360, '父级锚点在左下 ⇒ 中心是宽的一半');
    assert.equal(zcUiBannerCenterOf(1280, 1), -640);
    assert.equal(zcUiBannerCenterOf(Number.NaN, Number.NaN), 0, '非法入参不能产出 NaN 坐标');
    assert.match(FX_SOURCE, /zcUiBannerCenterOf\(transform\?\.width \?\? 0, transform\?\.anchorX \?\? 0\.5\)/);
    assert.match(FX_SOURCE, /zcUiBannerCenterOf\(transform\?\.height \?\? 0, transform\?\.anchorY \?\? 0\.5\)/);
});

/* ------------------------------------------- ③ 时长 = 扫场时长 */

test('③ 扫场总时长是唯一真源：`durationSeconds` 与 `isPlaying` 同界', () => {
    const { load } = loadViews();
    const { ZCVictorySweep } = load('./ZCVictorySweep');
    const view = { setSweepOwner(): void {} };
    const sweep = new ZCVictorySweep(new Map([[0, view]]), new Map([[7, 0]]));
    const map = [
        { id: 7, row: 1, x: 0, playable: true },
        { id: 9, row: 0, x: 0, playable: true },
    ];
    assert.equal(sweep.durationSeconds, 0, '没在播就是 0 —— 调用方据此判断"这段时长定义不出来"');
    assert.equal(sweep.start(map, 'player'), true);
    const total = sweep.durationSeconds;
    assert.ok(total > 0);
    //  真跑：差一点还在播，补满那一刻收手。特效的销毁时刻就按这条对齐。
    sweep.advance(total - 0.01);
    assert.equal(sweep.isPlaying, true);
    sweep.advance(0.01);
    assert.equal(sweep.isPlaying, false);
    sweep.clear();
    assert.equal(sweep.durationSeconds, 0, '清理后归零，下一局不会带着上一局的时长');
    //  两处必须共用 `victorySweepDuration`：自己另算一份就会和扫场收尾差上几百毫秒。
    assert.match(SWEEP_SOURCE, /get durationSeconds\(\): number \{\s*const sweep = this\.state;\s*return sweep \? victorySweepDuration\(sweep\.stepCount\) : 0;/);
    assert.match(SWEEP_SOURCE, /return sweep !== null && sweep\.elapsed < victorySweepDuration\(sweep\.stepCount\)/);
});

test('③ 渲染世界把这段时长暴露出去，ZCGame 起播时取它并折算成倍速', () => {
    assert.match(WORLD_SOURCE, /get victorySweepSeconds\(\): number \{\s*return this\.sweep\.durationSeconds;/);
    assert.match(GAME_SOURCE, /const seconds = zcOutcomeEffectSeconds\(this\.renderWorld\.victorySweepSeconds\);/);
    //  时长不是"能播多久"，而是"必须铺满多久"：timeScale = duration / clip。
    assert.equal(zcUiBannerTimeScale(1.6, 3.2), 2);
    assert.equal(zcUiBannerTimeScale(3.2, 1.6), 0.5);
    assert.equal(zcUiBannerTimeScale(1.6, 1.6), 1);
    //  片段时长取不到：按原速，别算出 NaN / Infinity 把 timeScale 打成静止。
    for (const bad of [0, -1, Number.NaN, null, undefined]) {
        assert.equal(zcUiBannerTimeScale(bad, 2), 1, `${String(bad)} 必须退回原速`);
    }
    assert.equal(zcUiBannerTimeScale(1.5, 0), 1, '扫场时长未知时也按原速');
    assert.match(FX_SOURCE, /skeleton\.timeScale = zcUiBannerTimeScale\(/);
    assert.match(FX_SOURCE, /skeleton\.setAnimation\(0, animation, skeleton\.loop\)/, '按 prefab 配置决定是否循环（不硬写）');
});

/* ------------------------------------------------------ ④ 接线顺序 */

test('④ 只有扫场真的开播才弹横幅，且与扫场同一处推进', () => {
    const start = GAME_SOURCE.indexOf('advanceSettlementPresentation(');
    const body = GAME_SOURCE.slice(start, start + 1400);
    assert.ok(body.indexOf('if (!this.beginVictorySweep(frame))') >= 0);
    //  顺序：先确认扫场开播（拿到时长），再起播特效，再推。
    assert.ok(
        body.indexOf('if (!this.beginVictorySweep(frame))') < body.indexOf('this.playOutcomeEffect(frame)'),
        '先判扫场再起播：整盘无可染格子时时长定义不出来，不能凭空播一段',
    );
    assert.match(body, /this\.advanceOutcomeEffect\(dt\);\s*return this\.renderWorld\.advanceVictorySweep\(frame, dt\);/);
    //  幂等：每帧都会调，靠 `this.outcomeEffect` 挡。
    assert.match(GAME_SOURCE, /private playOutcomeEffect\(frame: ZCGameRenderFrame\): void \{\s*if \(this\.outcomeEffect\) return;/);
    //  三条前置：状态是胜负、prefab 到货、时长有效。
    assert.match(GAME_SOURCE, /const animation = zcOutcomeAnimationOf\(frame\.snapshot\.status\);/);
    assert.match(GAME_SOURCE, /const prefab = this\.settlementOutcomePrefab;\s*if \(!prefab\) return;/);
    assert.match(GAME_SOURCE, /const seconds = zcOutcomeEffectSeconds\(this\.renderWorld\.victorySweepSeconds\);\s*if \(!seconds\) return;/);
});

test('④ 到点销毁；节点被外部销毁也当结束（不留一个死引用挡住下一局）', () => {
    const start = GAME_SOURCE.indexOf('private advanceOutcomeEffect(');
    const body = GAME_SOURCE.slice(start, start + 420);
    assert.match(body, /this\.outcomeEffectElapsed \+= Math\.max\(0, dt\)/);
    assert.match(body, /this\.outcomeEffectElapsed < this\.outcomeEffectSeconds && isZCUISpineBannerAlive\(effect\)/);
    assert.match(body, /destroyZCUISpineBanner\(effect\);\s*this\.outcomeEffect = null;/);
});

/* ------------------------------------------------------- ⑤ 资源链路 */

test('⑤ 胜负特效走 Prefab 主导：路径登记在资源计划里，按 Prefab 加载，预制体自带 720 宽缩放', () => {
    assert.match(
        PLAN_SOURCE,
        /settlementOutcome: `\$\{BATTLE_EFFECTS_DIRECTORY\}\/胜利失败UI特效\/胜利失败UI特效`/,
        '路径必须唯一声明在 ZC_BATTLE_FX_PATHS',
    );
    for (const name of ['ZC_BATTLE_COMMON_FX_PREFABS', 'ZC_BATTLE_COMMON_PREFABS']) {
        const start = PLAN_SOURCE.indexOf(`const ${name}`);
        assert.ok(start > 0, `ZCGameResourcePlan 必须保留 ${name}`);
        assert.doesNotMatch(
            PLAN_SOURCE.slice(start, start + 340),
            /settlementOutcome/,
            `${name} 是首包预热清单，结算横幅改为随开局异步加载，不应进入首包`,
        );
    }
    assert.match(GAME_SOURCE, /this\.loadBattlePrefab\(ZC_BATTLE_FX_PATHS\.settlementOutcome, '结算胜负特效'/);
    assert.match(GAME_SOURCE, /assets\.load\(path, Prefab,/, '必须按 Prefab 加载');
    assert.match(GAME_SOURCE, /this\.loadSettlementOutcomePrefab\(\);/);

    const fxCode = FX_SOURCE.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(fxCode, /new Node\(/, '必须从 prefab 实例化，不允许代码 new Node 兜底');
    assert.doesNotMatch(fxCode, /\.addComponent\(/, 'sp.Skeleton 必须挂在 prefab 上，不允许运行期 addComponent');

    const prefab = JSON.parse(read('assets/bundles/battle/units/effects/胜利失败UI特效/胜利失败UI特效.prefab')) as any[];
    const skelMeta = JSON.parse(read('assets/bundles/battle/units/effects/胜利失败UI特效/ddz_sgfc_sl_ani.skel.meta')) as { uuid: string };
    const rootNode = prefab.find((item) => item.__type__ === 'cc.Node');
    const skelComp = prefab.find((item) => item.__type__ === 'sp.Skeleton');
    assert.ok(rootNode && skelComp, '胜利失败UI特效.prefab 必须存在且挂载 sp.Skeleton');
    assert.equal(rootNode._layer, 33554432);
    assert.ok(Math.abs(rootNode._lscale.x - 720 / 744) < 1e-6, '720 宽适配缩放必须烘进 prefab');
    assert.equal(skelComp._skeletonData?.__uuid__, skelMeta.uuid);
    assert.equal(skelComp._premultipliedAlpha, false);
    assert.equal(skelComp.loop, false);
});

test('⑤ 画布宽与片段时长取不到时是 0（调用方据此退回保守值，不能当合法尺寸用）', () => {
    assert.equal(zcUiBannerCanvasWidthOf(null), 0);
    assert.equal(zcUiBannerClipSecondsOf(null, ZC_OUTCOME_WIN_ANIMATION), 0);
    //  假骨架：走同一条 `getRuntimeData` 出口（`_skeletonJson` 在 3.8.8 恒为 null，只能走它）。
    const fake = {
        getRuntimeData: () => ({
            width: 744,
            animations: [{ name: ZC_OUTCOME_WIN_ANIMATION, duration: 1.6 }],
        }),
    } as never;
    assert.equal(zcUiBannerCanvasWidthOf(fake), 744);
    assert.equal(zcUiBannerClipSecondsOf(fake, ZC_OUTCOME_WIN_ANIMATION), 1.6);
    assert.equal(zcUiBannerClipSecondsOf(fake, 'nope'), 0, '没有这段动画就是 0');
    //  会抛的实现（重建 / 释放过的数据）不能把结算打断。
    const throwing = { getRuntimeData: () => { throw new Error('released'); } } as never;
    assert.equal(zcUiBannerCanvasWidthOf(throwing), 0);
    assert.equal(zcUiBannerClipSecondsOf(throwing, ZC_OUTCOME_WIN_ANIMATION), 0);
    assert.match(STYLE_SOURCE, /data\.getRuntimeData\(true\)/);
});

/* --------------------------------------------------- ⑥ 层与收尾 */

test('⑥ 挂 HUD 根节点并置顶：挂在棋盘层会跟着镜头缩放，宽度就不受控了', () => {
    assert.match(FX_SOURCE, /applyLayerRecursive\(root, parent\.layer\);/, 'layer 必须跟随父级（否则不参与这个相机）');
    assert.match(FX_SOURCE, /root\.setParent\(parent\);/);
    assert.match(FX_SOURCE, /root\.setSiblingIndex\(parent\.children\.length - 1\)/, '横幅不能被 HUD 压住');
    assert.match(GAME_SOURCE, /createZCUISpineBannerNode\(prefab, animation, this\.hudView\.node, \{/,
        '挂在 HUD 根节点（720×1280 设计坐标）上，不是棋盘层');
    assert.match(GAME_SOURCE, /name: 'SettlementOutcomeFx'[\s\S]{0,120}durationSeconds: seconds/,
        '结算这条要把扫场时长传下去（原速播是开局那条的口径）');
    assert.doesNotMatch(GAME_SOURCE, /createZCUISpineBannerNode\([^)]*mapLayer/);
});

test('⑥ 退出时显式收（HUD 销毁是下一帧生效，先自己收一次）', () => {
    const start = GAME_SOURCE.indexOf('shutdown(): void {');
    const body = GAME_SOURCE.slice(start, start + 1200);
    assert.match(body, /if \(this\.outcomeEffect\) \{\s*destroyZCUISpineBanner\(this\.outcomeEffect\);\s*this\.outcomeEffect = null;/);
    assert.match(body, /this\.outcomeEffectSeconds = 0;/);
    assert.match(FX_SOURCE, /node\.skeleton\.clearTracks\(\)/, '先停播放再销毁，避免尾帧闪一下');
    assert.match(FX_SOURCE, /if \(node\.root\.isValid\) node\.root\.destroy\(\)/);
});
