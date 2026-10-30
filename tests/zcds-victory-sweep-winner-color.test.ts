import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 结算「胜利方扫场」的颜色必须跟着**胜方席位**走（2026-10-28 用户口径）。
 *
 * > 「战斗中紫色方胜利，播放的结算胜利动画的地块颜色没有对应玩家的颜色，
 * >  结算胜利动画的颜色应该对应胜利玩家的颜色」
 *
 * 改前的整条链是断的：模型判完只留 `status`（**以我方视角**的 victory / defeat），
 * 视图拿它二分 —— `status === 'victory' ? Player : Enemy`。
 * 4 人局里"我方出局"可能是 2 号红方赢、也可能是 4 号紫方赢，两种 status 都是 `defeat`
 * ⇒ 紫方赢的局永远铺成红方色（`#fb4969` 鲑红，就是截图里那一片）。
 *
 * 现在胜方身份由 `ZCOutcomeSystem` 判出来 → `ZCGameModel.matchWinner` → `renderFrame.winner`
 * → `ZCGame.beginVictorySweep` → `ZCVictorySweep` → `ZCHexView.sweepFill(owner)` 取该席位本色。
 * 本用例钉住**这条链的每一环**，任何一环退回"二分"都会红。
 */

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
/** 去掉注释，避免守卫被文档里的示例代码误伤（也会误绿）。 */
const codeOf = (relative: string): string => read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const OUTCOME = 'assets/script/app/zcds/model/systems/ZCOutcomeSystem.ts';
const MODEL = 'assets/script/app/zcds/model/ZCGameModel.ts';
const FRAME = 'assets/script/app/zcds/model/ZCGameRenderFrame.ts';
const GAME = 'assets/script/app/zcds/ZCGame.ts';
const HEX = 'assets/script/app/zcds/view/ZCHexView.ts';
const SWEEP = 'assets/script/app/zcds/view/ZCVictorySweep.ts';

test('① 模型：判定结果带胜方身份，且以我方出局时取的是「还站着的对手」', () => {
    const body = codeOf(OUTCOME);
    assert.match(body, /readonly winner: ZCOwner \| null/,
        'IZCOutcomeResult 必须带 winner（status 是二值的，反推不出 4 人局里是谁赢）');
    // 我方归零那条：候选集必须按「该席位还有已开发地块」过滤，而不是写死 Enemy。
    assert.match(body, /context\.activeOwners\.filter\(\(owner\) => owner !== ZCOwner\.Player && developedCount\(owner\) > 0\)/,
        '我方出局时的胜方候选 = 还有已开发地块的对手集合');
    // 分数局：胜方就是四项领先的那一方。
    assert.match(body, /winner: best\.owner/, '分数结算的胜方必须跟四项头名一致');
});

test('② 模型：胜方落进 `matchWinner`，换局归零，并随渲染帧下发给视图', () => {
    const body = codeOf(MODEL);
    assert.match(body, /private matchWinner: ZCOwner \| null = null;/, '模型要有 matchWinner 字段');
    assert.match(body, /private finish\(status: Exclude<ZCGameStatus, 'playing'>, reason: string, winner: ZCOwner \| null\): void \{[\s\S]{0,160}?this\.matchWinner = winner;/,
        'finish 必须把胜方落盘（只记 status 就又把身份丢了）');
    assert.match(body, /winner: this\.matchWinner,/, 'renderFrame 必须带 winner');
    // 换局必须清空，否则下一局开局就带着上一局的胜方。
    const reset = body.slice(body.indexOf('reset(): void'));
    assert.match(reset.slice(0, 900), /this\.matchWinner = null;/,
        'reset() 里必须把 matchWinner 归零');
    // 反向守卫：不许再有"结算时只看 status"的旁路。
    assert.match(read(FRAME), /readonly winner: ZCOwner \| null;/, 'ZCGameRenderFrame 要声明 winner');
});

test('③ 视图：扫场用 `frame.winner` 上色，status 二分只留在兜底位', () => {
    const body = codeOf(GAME);
    assert.match(body, /const winner = frame\.winner \?\?/,
        'beginVictorySweep 必须以 frame.winner 为主，status 二分只能做兜底');
    // 出问题的老写法：只有 status 二分、完全没有 frame.winner。
    assert.doesNotMatch(body, /const winner = status === 'victory' \? ZCOwner\.Player : ZCOwner\.Enemy;/,
        '🔥 又回到「只看 status」了 —— 4 人局里紫方赢会铺成红方色');
});

test('④ 视图：扫场覆盖色按传入席位的本色取，不折成玩家 / 敌人两档', () => {
    const hex = codeOf(HEX);
    assert.match(hex, /if \(this\.sweepOwner !== null\) return this\.sweepFill\(this\.sweepOwner, this\.sweepMix, this\.sweepShimmer\);/,
        'sweepOwner 必须原样进 sweepFill');
    const fill = hex.slice(hex.indexOf('private sweepFill('), hex.indexOf('private renderContent('));
    assert.ok(fill.length > 0, '找不到 sweepFill');
    assert.doesNotMatch(fill, /ZCOwner\.Player/,
        'sweepFill 里不许出现玩家 / 敌人的二分判断（它只认传进来的 owner）');
    assert.match(fill, /this\.territoryFill\(owner, ZCHexView\.TERRITORY_FILL_ALPHA, true\)/,
        '深饱和色仍走 territoryFill(owner, ...)');
    assert.match(fill, /this\.territoryFill\(owner\)/, '回正终点的当前色同样按 owner 取');

    // 取色函数本身要覆盖 4 个席位（穷举表：新增席位会编译报错）。
    const theme = codeOf('assets/script/app/zcds/view/ZCTheme.ts');
    for (const owner of ['player:', 'enemy:', 'enemy2:', 'enemy3:']) {
        assert.match(theme, new RegExp(`${owner} ZC_CLIENT_COLORS\\.`),
            `FACTION_COLOR_BY_FACTION 缺 ${owner}`);
    }
});

test('⑤ 席位色互不相同：紫方（enemy3）与红方（enemy）必须是两个色相', () => {
    const { load } = loadViews();
    const theme = load('./ZCTheme');
    const enemy = theme.zcFactionColor('enemy');
    const enemy2 = theme.zcFactionColor('enemy2');
    const enemy3 = theme.zcFactionColor('enemy3');
    const player = theme.zcFactionColor('player');
    const hex = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    // 截图里那一片鲑红就是 enemy；紫方是 enemy3 —— 两者绝不能被映射到同一个颜色。
    assert.equal(hex(enemy), 'fb4969', '2 号席 = 鲑红');
    assert.equal(hex(enemy3), 'bd49fb', '4 号席 = 紫');
    assert.notEqual(hex(enemy), hex(enemy3), '红 / 紫必须是两个色');
    assert.notEqual(hex(enemy2), hex(enemy3), '黄 / 紫必须是两个色');
    assert.notEqual(hex(player), hex(enemy3), '我方（蓝紫）/ 紫方也必须是两个色');
    // 深色端也要跟着席位走（扫场铺的就是深饱和色），别只有浅色端换。
    const deepEnemy = theme.zcDeepFactionColor('enemy');
    const deepEnemy3 = theme.zcDeepFactionColor('enemy3');
    assert.notEqual(hex(deepEnemy), hex(deepEnemy3), '深饱和色端同样要按席位区分');
});

test('⑥ 扫场本体：把 winner 原样传给每一格（不经过任何映射）', () => {
    const body = codeOf(SWEEP);
    assert.match(body, /painted \? sweep\.winner : null/, '每格写入的必须是 winner 本身');
    assert.match(body, /winner: ZCOwner;/, '内部状态要存 winner 席位');
    // 反向守卫：扫场里不许出现"非我方即敌方"的折档。
    assert.doesNotMatch(body, /winner === ZCOwner\.Player \?/,
        '扫场只负责铺色，不该在颜色上做玩家 / 敌人二分（方向另算）');
});
