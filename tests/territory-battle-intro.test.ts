import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

import {
    TERRITORY_BATTLE_INTRO_CELL_SCALE,
    TERRITORY_BATTLE_INTRO_COVER_ALPHA_MAX,
    TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN,
    TERRITORY_BATTLE_INTRO_COVER_ART_HEIGHT,
    TERRITORY_BATTLE_INTRO_COVER_ART_WIDTH,
    TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS,
    TERRITORY_BATTLE_INTRO_COVER_GAP_X,
    TERRITORY_BATTLE_INTRO_COVER_GAP_Y,
    TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
    TERRITORY_BATTLE_INTRO_COVER_SCALE_MAX,
    TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN,
    TERRITORY_BATTLE_INTRO_COVER_SPREAD,
    TERRITORY_BATTLE_INTRO_COVER_STAGGER,
    TERRITORY_BATTLE_INTRO_COVER_WIDTH,
    TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS,
    TERRITORY_BATTLE_INTRO_IN_SECONDS,
    TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO,
    TERRITORY_BATTLE_INTRO_OUT_SECONDS,
    TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS,
    TERRITORY_BATTLE_INTRO_TARGETS,
    TERRITORY_BATTLE_INTRO_UI_FADE_FROM,
    TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO,
    territoryBattleIntroCoverAlpha,
    territoryBattleIntroCoverFrameStep,
    territoryBattleIntroCoverPuffs,
    territoryBattleIntroDirVector,
    territoryBattleIntroHoldFx,
    territoryBattleIntroInFx,
    territoryBattleIntroInFxAt,
    territoryBattleIntroOutFx,
    territoryBattleIntroOutFxAt,
    territoryBattleIntroPushPx,
    type ITerritoryBattleIntroCover,
} from '../assets/script/app/territory/model/TerritoryBattleIntro';

/**
 * 「进入关卡战斗 / 匹配界面」的整页过场（需求 2026-11-02）：
 *
 * > 1. 界面所有 UI 向四周推出（下方往下、上面往上、两侧往左右）
 * > 2. 地块同时变透明变小隐藏，云层往中间移动遮挡地块
 * > 3. 云层静止等待服务器回调，进入匹配 / 战场时再向四周散开变透明
 *
 * 判据分四层：
 *  ① 曲线：`out` 三段同时收敛、`hold` 与 `out` 末帧**逐字段相同**、`in` 只让云动；
 *  ② 云层：云团真的盖住视口（按合成不透明度逐点验，不是"摆一堆看着像"），
 *     且每朵的倍率 / 浓度 / 起走延迟 / 镜像 / 待机相位都真的错落（全都一样 = 贴纸）；
 *  ③ 云盖层真代码沙箱：`apply` 写出来的位置 = 云团 × spread、逐朵 alpha 按延迟淡，
 *     `step` 按 `步进 + 每朵相位` 换帧；
 *  ④ 接线：谁起演、谁释放、谁收工、宝箱匹配怎么接进来，以及"地图缩着就没人还原"这类
 *     半截状态的守卫。
 */

const INTRO_MODEL = 'assets/script/app/territory/model/TerritoryBattleIntro.ts';
const COVER_VIEW = 'assets/script/app/territory/view/TerritoryBattleCover.ts';
const MAP_VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const MAIN_PAGE = 'assets/script/app/main/MainPage.ts';
const COMPOSITION = 'assets/script/app/bootstrap/main/MainPageComposition.ts';
const HUD_VIEW = 'assets/script/app/territory/view/TerritoryBattleIntroHud.ts';

/** 读源码并**剥掉注释**：判据里常出现"不用 tween"这种字样，注释命中就是假绿。 */
function stripped(path: string): string {
    const source = readFileSync(path, 'utf8');
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const near = (a: number, b: number, epsilon = 1e-9): boolean => Math.abs(a - b) <= epsilon;

// ---------------------------------------------------------------------------
// ① 曲线
// ---------------------------------------------------------------------------

test('★★★t=0 必须"什么都没动"：UI 在原位、地块满倍率、云全在画面外', () => {
    const fx = territoryBattleIntroOutFx(0);
    assert.equal(fx.uiPush, 0, '点下去那一帧 UI 不能先跳一下');
    assert.equal(fx.uiOpacity, 1);
    assert.equal(fx.cellScale, 1);
    assert.equal(fx.cellOpacity, 1);
    assert.equal(fx.coverSpread, TERRITORY_BATTLE_INTRO_COVER_SPREAD, '起手云在画面外');
    assert.equal(fx.coverOpacity, 0);
    assert.equal(fx.done, false);
});

test('★★★`hold` 与 `out` 末帧逐字段相同（三段之间不许有跳变）', () => {
    const end = territoryBattleIntroOutFx(TERRITORY_BATTLE_INTRO_OUT_SECONDS);
    const hold = territoryBattleIntroHoldFx();
    assert.deepEqual({ ...hold, done: end.done }, { ...end });
    assert.equal(hold.done, false, '`hold` 不是"播完"，它要一直等到回包');
    // 合拢到位 = 云铺满、地块隐、UI 推出
    assert.equal(hold.coverSpread, 1);
    assert.equal(hold.coverOpacity, 1);
    assert.equal(hold.cellOpacity, 0);
    assert.equal(hold.uiPush, 1);
    assert.equal(hold.uiOpacity, 0);
});

test('★★★`out` 段四件事同时收敛：UI 推出、UI 淡出、地块缩小、云合拢（全部单调）', () => {
    let previous = territoryBattleIntroOutFx(0);
    for (let step = 1; step <= 40; step += 1) {
        const fx = territoryBattleIntroOutFx((step / 40) * TERRITORY_BATTLE_INTRO_OUT_SECONDS);
        for (const key of ['uiPush', 'coverOpacity'] as const) {
            assert.ok(fx[key] >= previous[key] - 1e-12, `${key} 必须单调不减（step ${step}）`);
        }
        // 地块缩小 / 云收拢 / UI 淡出都是"越来越小"的方向。
        for (const key of ['uiOpacity', 'cellScale', 'cellOpacity', 'coverSpread'] as const) {
            assert.ok(fx[key] <= previous[key] + 1e-12, `${key} 必须单调不增（step ${step}）`);
        }
        previous = fx;
    }
    assert.ok(near(previous.cellScale, TERRITORY_BATTLE_INTRO_CELL_SCALE, 1e-9), '收尾刚好缩到 0.8');
});

test('★★UI 前 40% 只位移不淡：一上来就淡会读成"闪一下没了"，与"推出"矛盾', () => {
    const before = territoryBattleIntroOutFxAt(TERRITORY_BATTLE_INTRO_UI_FADE_FROM * 0.99);
    assert.equal(before.uiOpacity, 1, '淡出起点之前必须全不透明');
    assert.ok(before.uiPush > 0, '但这时候已经在位移了');
    const after = territoryBattleIntroOutFxAt(TERRITORY_BATTLE_INTRO_UI_FADE_FROM + 0.01);
    assert.ok(after.uiOpacity < 1, '过了起点才开始淡');
});

test('★★★地块必须**真的变小**（用户原话是"变透明**变小**隐藏"，只透不缩不算做完）', () => {
    assert.ok(TERRITORY_BATTLE_INTRO_CELL_SCALE < 0.95,
        `收尾倍率 ${TERRITORY_BATTLE_INTRO_CELL_SCALE} 太小看不出"变小"，手感区间是 0.7~0.9`);
    assert.ok(TERRITORY_BATTLE_INTRO_CELL_SCALE > 0.6, '缩过半会读成"地图塌了"，而不是"藏起来"');
    const quarter = territoryBattleIntroOutFx(TERRITORY_BATTLE_INTRO_OUT_SECONDS * 0.5);
    assert.ok(quarter.cellScale < 1, '一半进度时就应该已经在缩了');
    assert.ok(quarter.cellOpacity > 0 && quarter.cellOpacity < 1, '且这时候还没透完（透与缩不是同一段）');
});

test('★★★`in` 段只让云动：UI 与地块恒在末态（散场不许把它们放回来）', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const fx = territoryBattleIntroInFxAt(p);
        assert.equal(fx.uiPush, 1);
        assert.equal(fx.uiOpacity, 0);
        assert.equal(fx.cellScale, TERRITORY_BATTLE_INTRO_CELL_SCALE);
        assert.equal(fx.cellOpacity, 0);
        // 散场的"变透明"是**逐团**淡的，整层不透明度不许跟着降 ——
        // 整层一起降会读成"整屏闪一下"，与参考图的"一块块散"相反。
        assert.equal(fx.coverOpacity, 1, '整层不许在 in 段一起淡');
    }
    const start = territoryBattleIntroInFx(0);
    assert.equal(start.coverSpread, 1, '从"就位"起手');
    assert.equal(start.coverOpacity, 1);
    assert.equal(start.coverRelease, 0, '还没开始散');
    const end = territoryBattleIntroInFx(TERRITORY_BATTLE_INTRO_IN_SECONDS);
    assert.equal(end.coverSpread, TERRITORY_BATTLE_INTRO_COVER_SPREAD, '散到画面外');
    assert.equal(end.coverRelease, 1, '散场进度必须走到 1（否则最后那批云淡不完）');
    assert.equal(end.done, true);
});

test('★★★`out` / `hold` 段不许有"团先淡"：那一段是显形 + 就位，散场才逐团淡', () => {
    for (const p of [0, 0.3, 0.7, 1]) {
        assert.equal(territoryBattleIntroOutFxAt(p).coverRelease, 0);
    }
    assert.equal(territoryBattleIntroHoldFx().coverRelease, 0);
    // 云团原样 —— 起手那几帧如果就按延迟淡，画面会读成"云还没盖上来就在化"
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    for (const puff of puffs) assert.equal(territoryBattleIntroCoverAlpha(puff, 0), puff.alpha);
});

test('★★★散开"先咬住、后甩开"：云位移是缓入，前 1/4 进度几乎没动', () => {
    const quarter = territoryBattleIntroInFxAt(0.25);
    const moved = (quarter.coverSpread - 1) / (TERRITORY_BATTLE_INTRO_COVER_SPREAD - 1);
    assert.ok(moved < 0.1, `前 1/4 只该走 6.25%，实际 ${(moved * 100).toFixed(1)}%`);
    const half = territoryBattleIntroInFxAt(0.5);
    const halfMoved = (half.coverSpread - 1) / (TERRITORY_BATTLE_INTRO_COVER_SPREAD - 1);
    assert.ok(halfMoved < 0.35, '一半进度也才 1/4 路程 —— 云要"静止"到最后才散');
});

test('★★★跳转时刻早于播完：等播完才跳会露出"没有 UI、地块也透明"的空白帧', () => {
    assert.ok(TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO > 0 && TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO < 1);
    let first = -1;
    for (let step = 0; step <= 100; step += 1) {
        const p = step / 100;
        const fx = territoryBattleIntroInFxAt(p);
        if (fx.navigate && first < 0) first = p;
        if (first >= 0) assert.equal(fx.navigate, true, 'navigate 一旦为真就必须持续为真（不许抖）');
    }
    assert.ok(first >= 0 && first <= TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO + 0.011, `首帧应为 ${TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO}`);
    assert.ok(first < 1, '必须在播完之前起跳');
    // `out` 段永不起跳（这时候还在合拢，跳了玩家会看见半个过场）
    for (const p of [0, 0.5, 1]) assert.equal(territoryBattleIntroOutFxAt(p).navigate, false);
});

test('★★推出距离按视口长边算；脏参数给 0（宁可只淡不推，也不甩到几十万像素外）', () => {
    assert.equal(territoryBattleIntroPushPx(750, 1334), 1334 * TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO);
    assert.equal(territoryBattleIntroPushPx(1334, 750), 1334 * TERRITORY_BATTLE_INTRO_UI_PUSH_RATIO);
    for (const bad of [[0, 0], [-1, 100], [NaN, 100], [Infinity, 100]]) {
        assert.equal(territoryBattleIntroPushPx(bad[0], bad[1]), 0, `脏参数 ${bad} 应为 0`);
    }
});

test('★脏时间一律当 0 / 收尾态，绝不产出 NaN（NaN 写进缩放 = 整层消失且零报错）', () => {
    for (const bad of [NaN, -1, -0.001]) {
        const out = territoryBattleIntroOutFx(bad);
        assert.ok(Number.isFinite(out.uiPush) && Number.isFinite(out.cellScale) && Number.isFinite(out.coverSpread));
        assert.equal(out.uiPush, 0);
        const into = territoryBattleIntroInFx(bad);
        assert.ok(Number.isFinite(into.coverSpread) && Number.isFinite(into.coverOpacity));
        assert.equal(into.coverSpread, 1);
    }
    // 超时 / 超长也夹住
    assert.equal(territoryBattleIntroOutFx(999).uiPush, 1);
    assert.equal(territoryBattleIntroInFx(999).coverRelease, 1, '散场必须散干净（逐团 alpha 归零）');
});

// ---------------------------------------------------------------------------
// ② 云层：真的盖住视口，且每朵都长得不一样
// ---------------------------------------------------------------------------

/**
 * `cloud_idle_0` 的**轮廓近似**：实测是两个硬边形状 —— 云体（不透明）+ 影子（alpha 61/255）。
 *
 * 用例读不到 PNG（`node:test` 里没有解码器），所以按实测轮廓建一个解析模型；
 * **真实贴图**的逐点合成由 `tools/scan_cloud_cover.py` 离线验（1080×1920 上 170 团、
 * 最低遮挡 0.961、平均 0.999）。两者只差"云体内部的硬边空档"，不影响下面这条判据的结论。
 */
const CLOUD_BODY = { cx: 0, cy: -62, rx: 100, ry: 60, alpha: 1 };
const CLOUD_SHADOW = { cx: 0, cy: 25, rx: 99, ry: 45, alpha: 61 / 255 };

/** 贴图坐标（原点 = 图心，单位 = 原始 px）上的 alpha。 */
function cloudArtAlpha(u: number, v: number): number {
    let best = 0;
    for (const part of [CLOUD_BODY, CLOUD_SHADOW]) {
        const dx = (u - part.cx) / part.rx;
        const dy = (v - part.cy) / part.ry;
        if (dx * dx + dy * dy <= 1) best = Math.max(best, part.alpha);
    }
    return best;
}

/** 与渲染同口径的遮挡率：一朵云在 (x, y) 处的 alpha × 自己的基准不透明度，多朵按 `1 - Π(1 - a)` 合成。 */
function coverageOf(width: number, height: number): { worst: number; at: string } {
    const puffs = territoryBattleIntroCoverPuffs(width, height);
    const covered = (x: number, y: number): number => {
        let kept = 1;
        for (const puff of puffs) {
            const w = TERRITORY_BATTLE_INTRO_COVER_WIDTH * puff.scale;
            const h = TERRITORY_BATTLE_INTRO_COVER_HEIGHT * puff.scale;
            const dx = x - puff.x;
            const dy = y - puff.y;
            if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) continue;
            const u = (dx / w) * TERRITORY_BATTLE_INTRO_COVER_ART_WIDTH * (puff.flip ? -1 : 1);
            const v = -(dy / h) * TERRITORY_BATTLE_INTRO_COVER_ART_HEIGHT;
            const alpha = cloudArtAlpha(u, v) * puff.alpha;
            if (alpha <= 0) continue;
            kept *= 1 - alpha;
        }
        return 1 - kept;
    };
    let worst = 1;
    let at = '';
    for (let y = -height / 2; y <= height / 2; y += 30) {
        for (let x = -width / 2; x <= width / 2; x += 30) {
            const value = covered(x, y);
            if (value < worst) {
                worst = value;
                at = `(${x}, ${y})`;
            }
        }
    }
    return { worst, at };
}

test('★★★云层必须"盖严整屏"：按 alpha 合成算，任意采样点的遮挡率都要够', () => {
    // 两种视口都要验：竖屏是常态，1080×1920 是最坏情况（团数最多、边缘最容易漏）。
    for (const [width, height] of [[750, 1334], [1080, 1920]]) {
        const { worst, at } = coverageOf(width, height);
        assert.ok(worst >= 0.9,
            `${width}×${height} 最薄的那一点只有 ${(worst * 100).toFixed(0)}% 遮挡（${at}），地块会透出来`);
    }
});

test('★★★间距与云体尺寸是硬约束：间距一旦跨过云体就会漏出底色', () => {
    const smallest = TERRITORY_BATTLE_INTRO_COVER_WIDTH * TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN;
    assert.ok(TERRITORY_BATTLE_INTRO_COVER_GAP_X < smallest,
        `横向间距 ${TERRITORY_BATTLE_INTRO_COVER_GAP_X} 必须小于最小云体宽度 ${smallest}`);
    const smallestY = TERRITORY_BATTLE_INTRO_COVER_HEIGHT * TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN;
    assert.ok(TERRITORY_BATTLE_INTRO_COVER_GAP_Y < smallestY,
        `纵向间距 ${TERRITORY_BATTLE_INTRO_COVER_GAP_Y} 必须小于最小云体高度 ${smallestY}`);
    // 显示尺寸与原图**同比例**：不同比例 ⇒ 云被拉扁/拉长（贴图是画好的，不能靠节点改形状）。
    assert.ok(near(
        TERRITORY_BATTLE_INTRO_COVER_WIDTH / TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
        TERRITORY_BATTLE_INTRO_COVER_ART_WIDTH / TERRITORY_BATTLE_INTRO_COVER_ART_HEIGHT,
        1e-6,
    ), '显示尺寸必须与原图同比例');
    // 放大倍率别过 2.5：再大双线性采样会把云体的明暗交界糊成一片灰。
    assert.ok(TERRITORY_BATTLE_INTRO_COVER_WIDTH / TERRITORY_BATTLE_INTRO_COVER_ART_WIDTH <= 2.5,
        '放大倍率超过 2.5 会把云糊掉');
});

test('★★★"贴纸"与"云"的分水岭：倍率 / 浓度 / 延迟 / 镜像 / 相位必须真的错落', () => {
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    for (const puff of puffs) {
        assert.ok(puff.scale >= TERRITORY_BATTLE_INTRO_COVER_SCALE_MIN
            && puff.scale <= TERRITORY_BATTLE_INTRO_COVER_SCALE_MAX, `倍率越界：${puff.scale}`);
        assert.ok(puff.alpha >= TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN
            && puff.alpha <= TERRITORY_BATTLE_INTRO_COVER_ALPHA_MAX, `浓度越界：${puff.alpha}`);
        assert.ok(puff.delay >= 0 && puff.delay <= TERRITORY_BATTLE_INTRO_COVER_STAGGER,
            `起走延迟越界：${puff.delay}`);
    }
    // 单朵接近不透明（要的是"盖住"而不是"透出来"），但也别全是 1 —— 全是 1 就是一张不透明的板。
    assert.ok(TERRITORY_BATTLE_INTRO_COVER_ALPHA_MAX <= 1, '浓度不许超过 1');
    assert.ok(TERRITORY_BATTLE_INTRO_COVER_ALPHA_MIN < 1, '全都不透明 ⇒ 云与云之间没有叠影');
    // 各维度的**分布**都要拉开（全都等于中位数 ⇒ 一屏同款云朵）
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
    assert.ok(spread(puffs.map((puff) => puff.scale)) > 0.2, '倍率几乎一样 ⇒ 一眼看出是同一个贴图');
    assert.ok(spread(puffs.map((puff) => puff.delay)) > 0.3, '延迟几乎一样 ⇒ 整屏一起淡，不是"一块块散"');
    // 镜像必须**两边都有**：全朝一个方向 = 翻了个寂寞（云本来就没有正反之分）
    const flipped = puffs.filter((puff) => puff.flip).length;
    assert.ok(flipped > puffs.length * 0.3 && flipped < puffs.length * 0.7,
        `镜像比例 ${flipped}/${puffs.length} 失衡`);
    // 待机相位要**五种都有**：同一瞬间屏幕上只有一种云形 = 170 个一模一样的贴图。
    const phases = new Set(puffs.map((puff) => puff.frame));
    assert.equal(phases.size, 5, `只用到 ${phases.size} 个相位`);
    // 位置也要抖开：落在整数格点上的团不能太多（齐整矩形一眼就是程序摆的）
    const onGrid = puffs.filter((puff) => Math.abs(puff.y - Math.round(puff.y)) < 0.01
        && Math.abs(puff.x - Math.round(puff.x)) < 0.01).length;
    assert.ok(onGrid < puffs.length * 0.2, `有 ${onGrid}/${puffs.length} 团恰好落在整格点上`);
});

test('★★★确定性：同一视口两次得到的云层必须一模一样', () => {
    // 用 `Math.random()` 的话，同一场过场播两遍长得不一样（读成"地图在抖"），
    // 而且上面那些覆盖率判据都会变成偶尔红。
    const first = territoryBattleIntroCoverPuffs(750, 1334);
    const second = territoryBattleIntroCoverPuffs(750, 1334);
    assert.deepEqual(first, second);
    const other = territoryBattleIntroCoverPuffs(1334, 750);
    assert.notDeepEqual(first, other, '转屏后必须重铺，不许沿用旧点阵');
});

test('★★★待机循环：按帧长步进，脏值不产 NaN，五帧都要轮得到', () => {
    assert.equal(territoryBattleIntroCoverFrameStep(0), 0);
    assert.equal(territoryBattleIntroCoverFrameStep(TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS * 0.99), 0,
        '不满一帧不许跳');
    assert.equal(territoryBattleIntroCoverFrameStep(TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS), 1);
    assert.equal(territoryBattleIntroCoverFrameStep(TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS * 5), 5);
    for (const bad of [NaN, -1, -Infinity]) {
        assert.equal(territoryBattleIntroCoverFrameStep(bad), 0, `${bad} 应当当成 0`);
    }
    assert.ok(Number.isFinite(territoryBattleIntroCoverFrameStep(Infinity)) === false
        || Number.isInteger(territoryBattleIntroCoverFrameStep(Infinity)));
    // 速度：一轮（5 帧）要短到"盯着看能看出它在动"，又不能快到"云在抽搐"。
    const loop = TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS * 5;
    assert.ok(loop >= 0.5 && loop <= 1.5, `一轮 ${loop}s 不在 0.5~1.5s 之间`);
});

test('★★★散场逐朵淡：早走的先没、晚走的后没，但到 1 必须全淡干净', () => {
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    const early = puffs.reduce((best, puff) => (puff.delay < best.delay ? puff : best), puffs[0]);
    const late = puffs.reduce((best, puff) => (puff.delay > best.delay ? puff : best), puffs[0]);
    const half = territoryBattleIntroCoverAlpha(early, 0.5);
    const lateHalf = territoryBattleIntroCoverAlpha(late, 0.5);
    assert.ok(half < lateHalf, '延迟小的那朵在同一个进度下必须先淡');
    assert.ok(lateHalf > 0, '延迟最大的那朵在半程时还没开始走（"静止等待"才读得出来）');
    // 每一朵都必须单调不增，且在 progress = 1 时归零
    for (const puff of puffs) {
        let previous = territoryBattleIntroCoverAlpha(puff, 0);
        for (let step = 1; step <= 20; step += 1) {
            const value = territoryBattleIntroCoverAlpha(puff, step / 20);
            assert.ok(value <= previous + 1e-12, '淡出不许回弹');
            previous = value;
        }
        assert.equal(territoryBattleIntroCoverAlpha(puff, 1), 0, `延迟 ${puff.delay} 的云到进度 1 还没淡完`);
    }
    // 脏值：release 是 NaN 当作没开始；云团对象为空要给 0，不许抛
    assert.equal(territoryBattleIntroCoverAlpha(puffs[0], NaN), puffs[0].alpha);
    assert.equal(territoryBattleIntroCoverAlpha(null as never, 0.5), 0);
});

test('★脏视口 ⇒ 空云层（视图据此跳过整个盖层，而不是摆一堆 NaN 位置的节点）', () => {
    for (const bad of [[0, 100], [100, 0], [-1, -1], [NaN, 100]]) {
        assert.deepEqual(territoryBattleIntroCoverPuffs(bad[0], bad[1]), []);
    }
});

// ---------------------------------------------------------------------------
// ③ 云盖层：真代码沙箱（只有 cc 是桩）
// ---------------------------------------------------------------------------

class FakeNode {
    name: string;
    layer = 0;
    active = true;
    parent: FakeNode | null = null;
    children: FakeNode[] = [];
    position = { x: 0, y: 0, z: 0 };
    destroyed = false;
    private readonly components: unknown[] = [];

    constructor(name = '') {
        this.name = name;
    }

    get isValid(): boolean {
        return !this.destroyed;
    }

    setParent(parent: FakeNode): void {
        this.parent = parent;
        parent.children.push(this);
    }

    setSiblingIndex(index: number): void {
        const siblings = this.parent?.children;
        if (!siblings) return;
        const current = siblings.indexOf(this);
        if (current >= 0) siblings.splice(current, 1);
        siblings.splice(index, 0, this);
    }

    addComponent(type: new (...args: never[]) => unknown): unknown {
        const component = new (type as new () => { node?: FakeNode })();
        component.node = this;
        this.components.push(component);
        return component;
    }

    getComponent<T>(type: new (...args: never[]) => T): T | null {
        return (this.components.find((item) => item instanceof (type as never)) as T) ?? null;
    }

    setPosition(x: number, y: number, z = 0): void {
        this.position = { x, y, z };
    }

    scale = { x: 1, y: 1, z: 1 };

    setScale(x: number, y: number, z = 1): void {
        this.scale = { x, y, z };
    }

    destroy(): void {
        this.destroyed = true;
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
            this.parent = null;
        }
    }
}

class FakeUITransform {
    node: FakeNode | null = null;
    width = 0;
    height = 0;

    setContentSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }
}

class FakeUIOpacity {
    node: FakeNode | null = null;
    opacity = 255;
}

/** 引擎 `Color` 的最小实现（只需 `a` 通道 + `equals/set`，与 `UIRenderer.color` 同语义）。 */
class FakeColor {
    r: number;
    g: number;
    b: number;
    a: number;

    constructor(r = 255, g = 255, b = 255, a = 255) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    equals(other: FakeColor): boolean {
        return !!other && this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a;
    }

    set(other: FakeColor): void {
        this.r = other.r;
        this.g = other.g;
        this.b = other.b;
        this.a = other.a;
    }
}

class FakeSprite {
    static SizeMode = { RAW: 2, CUSTOM: 0, TRIMMED: 1 };
    node: FakeNode | null = null;
    spriteFrame: unknown = null;
    trim = true;
    /** 与引擎默认一致（`SizeMode.TRIMMED`）：写成 0 会让"有没有设 CUSTOM"这条判据假绿。 */
    sizeMode = 1;
    private _color = new FakeColor();

    get color(): FakeColor {
        return this._color;
    }

    /** 与引擎一致：**值相等就早退**（所以复用同一个 `Color` 实例是安全的）。 */
    set color(value: FakeColor) {
        if (this._color.equals(value)) return;
        this._color.set(value);
    }
}

/** 假云帧：`cloud_idle_0..4` 的替身（只当"五个不一样的帧"用，像素由真美术负责）。 */
type FakeFrame = { name: string; isValid: boolean; refs: number; addRef(): void; decRef(): void };

const fakeFrames = (count = 5, prefix = 'cloud_idle_'): FakeFrame[] =>
    Array.from({ length: count }, (_, index) => ({
        name: `${prefix}${index}`,
        isValid: true,
        refs: 0,
        addRef(this: FakeFrame) { this.refs += 1; },
        decRef(this: FakeFrame) { this.refs -= 1; },
    }));

const FAKE_CLOUD_FRAMES = fakeFrames();

/** 把 `TerritoryBattleCover.ts` 转译后塞进沙箱（真代码，只有 `cc` 是桩）。 */
function loadCoverClass(): new (host: FakeNode, frames?: readonly unknown[]) => {
    setFrames(frames: readonly unknown[]): void;
    build(width: number, height: number): boolean;
    step(dt: number): void;
    tick(dt: number): void;
    setBaseStep(step: number): void;
    startRelease(): number;
    apply(spread: number, opacity: number, release?: number): void;
    clear(): void;
    destroy(): void;
    dispose(): void;
    readonly count: number;
    readonly built: boolean;
    readonly frameStep: number;
    readonly layerNode: FakeNode | null;
} {
    const code = ts.transpileModule(readFileSync(COVER_VIEW, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports,
        require: (id: string) => {
            if (id === 'cc') {
                return {
                    Node: FakeNode,
                    Sprite: FakeSprite,
                    Color: FakeColor,
                    UIOpacity: FakeUIOpacity,
                    UITransform: FakeUITransform,
                };
            }
            // 曲线 / 云团用**真模块**：模型改了这里立刻跟着变，不抄常量。
            if (id.endsWith('/TerritoryBattleIntro')) {
                return {
                    TERRITORY_BATTLE_INTRO_COVER_WIDTH,
                    TERRITORY_BATTLE_INTRO_COVER_HEIGHT,
                    TERRITORY_BATTLE_INTRO_COVER_SPREAD,
                    TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS,
                    TERRITORY_BATTLE_INTRO_IN_SECONDS,
                    TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO,
                    territoryBattleIntroCoverAlpha,
                    territoryBattleIntroCoverFrameStep,
                    territoryBattleIntroCoverPuffs,
                    territoryBattleIntroInFx,
                };
            }
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return exports.TerritoryBattleCover as never;
}

function makeCover(
    frames: readonly unknown[] = FAKE_CLOUD_FRAMES,
): { host: FakeNode; cover: ReturnType<typeof loadCoverClass> extends new (h: FakeNode, f?: readonly unknown[]) => infer T ? T : never } {
    const CoverClass = loadCoverClass();
    const host = new FakeNode('TerritoryOverlay');
    return { host, cover: new CoverClass(host, frames) };
}

test('★★★`apply` 写出来的位置 = 云团 × spread、逐朵 alpha = 各自浓度，整层只有一个 UIOpacity', () => {
    const { host, cover } = makeCover();
    assert.equal(cover.build(750, 1334), true);
    const layer = cover.layerNode;
    assert.ok(layer, '必须建出云盖层');
    assert.equal(layer.name, 'BattleIntroCover');
    assert.equal(layer.children.length, cover.count);
    // 整层一个 `UIOpacity`（不是逐朵一个：那是一百多次标脏 / 帧）
    const layerOpacity = layer.getComponent(FakeUIOpacity);
    assert.ok(layerOpacity, '云层必须挂 UIOpacity');
    for (const child of layer.children) {
        assert.equal(child.getComponent(FakeUIOpacity), null, '每朵云不许自己挂 UIOpacity');
    }
    // 就位（spread = 1）⇒ 位置 = 云团原值，alpha = 各自浓度
    cover.apply(1, 1);
    assert.equal(layerOpacity.opacity, 255);
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    for (let index = 0; index < puffs.length; index += 1) {
        const child = layer.children[index];
        assert.equal(child.position.x, Math.round(puffs[index].x));
        assert.equal(child.position.y, Math.round(puffs[index].y));
        // 每朵自己的不透明度写在自己的 `color.a` 上（整层淡是另一件事）
        assert.equal((child.getComponent(FakeSprite) as FakeSprite).color.a,
            Math.round(puffs[index].alpha * 255), `第 ${index} 朵的浓度没写对`);
        // 倍率逐朵不一样 —— 一样大就是"贴纸"；镜像靠 `scaleX` 取负实现。
        assert.equal(Math.abs(child.scale.x), puffs[index].scale);
        assert.equal(child.scale.y, puffs[index].scale);
        assert.equal(child.scale.x < 0, puffs[index].flip, '镜像没写对');
    }
    // 盖层只能画**注入的云帧**（页面异步加载，视图不许自己造/自己 load）。
    // ⚠️ 2026-11-02 晚上起注入的是**云体** `cloud_body_*`（不是 `cloud_idle_*` 合并图，
    //    那个会把整屏压灰）—— 但视图这边不关心是哪套，只认"注入进来的帧"。
    const firstSprite = layer.children[0].getComponent(FakeSprite) as FakeSprite;
    assert.ok(FAKE_CLOUD_FRAMES.includes(firstSprite.spriteFrame as never), '盖层必须用注入的云帧');
    // 🔴 节点尺寸必须是**显示尺寸**（260×312），不是位图尺寸（200×240）：
    //    跟着位图走就小 1/4 ⇒ 间距按 260×312 算的云层会漏缝（实机才看得出来）。
    const transform = layer.children[0].getComponent(FakeUITransform) as FakeUITransform;
    assert.equal(transform.width, TERRITORY_BATTLE_INTRO_COVER_WIDTH);
    assert.equal(transform.height, TERRITORY_BATTLE_INTRO_COVER_HEIGHT);
    assert.equal(firstSprite.sizeMode, 0, '必须是 CUSTOM(0)：按节点尺寸拉伸那张 200×240 的位图');
    assert.notEqual(firstSprite.sizeMode, 2, 'RAW 会让节点跟位图走');
    // 散开（spread = 2）⇒ 位置 = 云团 × 2（"向四周散开"就是这一条）
    cover.apply(2, 0.5);
    assert.equal(layerOpacity.opacity, 128);
    assert.equal(layer.children[0].position.x, Math.round(puffs[0].x * 2));
    assert.equal(layer.children[0].position.y, Math.round(puffs[0].y * 2));
    // 层在覆盖层的**最后一位**（画在其他覆盖层内容之上）
    assert.equal(host.children[host.children.length - 1], layer);
});

test('★★★`step` 只换帧、不动位置：整层踩同一个节拍，但每朵的形态按自己的相位错开', () => {
    const { cover } = makeCover();
    cover.build(750, 1334);
    const layer = cover.layerNode;
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    const frameOf = (index: number): unknown => (layer.children[index].getComponent(FakeSprite) as FakeSprite).spriteFrame;
    // 建层那一帧就得把帧填上：否则 `out` 段前 0.18s 是一片空白
    for (let index = 0; index < puffs.length; index += 1) {
        assert.ok(frameOf(index), `第 ${index} 朵建出来时没有帧`);
    }
    // 同一瞬间必须**同时存在多种云形**（全用一帧 = 一百多个一模一样的贴图）
    assert.ok(new Set(layer.children.map((_, index) => frameOf(index))).size >= 4,
        '整屏都是同一朵云');
    // 相位是固定的：步进相同 ⇒ 每朵的帧号只按自己的 `frame` 平移
    const before = puffs.map((_, index) => frameOf(index));
    cover.step(TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS * 0.5);
    assert.equal(cover.frameStep, 0, '不满一帧不许跳');
    // 位置一帧都不许动（静止等待靠的就是"位置定住"）
    const positions = layer.children.map((child) => `${child.position.x},${child.position.y}`);
    cover.step(TERRITORY_BATTLE_INTRO_COVER_FRAME_SECONDS);
    assert.equal(cover.frameStep, 1);
    assert.deepEqual(layer.children.map((child) => `${child.position.x},${child.position.y}`), positions,
        '待机循环只许换帧，不许挪位置');
    for (let index = 0; index < puffs.length; index += 1) {
        const expected = FAKE_CLOUD_FRAMES[(1 + puffs[index].frame) % FAKE_CLOUD_FRAMES.length];
        assert.equal(frameOf(index), expected, `第 ${index} 朵的帧号算错了`);
        assert.notEqual(frameOf(index), before[index], `第 ${index} 朵没有跟着换帧`);
    }
    // 同一帧步进里重复调不再写（否则每帧一百多次 `spriteFrame` 赋值、整棵树标脏）
    const stepBefore = cover.frameStep;
    cover.step(0);
    assert.equal(cover.frameStep, stepBefore);
});

test('★★★`release` 段逐朵淡：整层不动，各朵按自己的延迟先后没影（一块块散）', () => {
    const { cover } = makeCover();
    cover.build(750, 1334);
    const layer = cover.layerNode;
    const layerOpacity = layer.getComponent(FakeUIOpacity);
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    const alphaOf = (index: number): number => (layer.children[index].getComponent(FakeSprite) as FakeSprite).color.a;
    const before = puffs.map((_, index) => alphaOf(index));
    cover.apply(1, 1, 0.5);
    const during = puffs.map((_, index) => alphaOf(index));
    for (let index = 0; index < puffs.length; index += 1) {
        assert.ok(during[index] <= before[index], '淡出不许变浓');
        assert.equal(during[index], Math.round(territoryBattleIntroCoverAlpha(puffs[index], 0.5) * 255));
    }
    // 同一个进度下，不同朵剩下的浓度必须**不一样**（否则就是整屏一起淡）
    assert.ok(new Set(during).size > 5, `半程时只剩 ${new Set(during).size} 种浓度 ⇒ 全屏一起淡了`);
    // 整层不透明度**不参与**散场（否则"一块块散"又变回"整屏闪一下"）
    assert.equal(layerOpacity.opacity, 255);
    // 散场走完 ⇒ 一朵不剩
    cover.apply(TERRITORY_BATTLE_INTRO_COVER_SPREAD, 1, 1);
    for (let index = 0; index < puffs.length; index += 1) assert.equal(alphaOf(index), 0);
});

test('★★★云层不透明度只认 0~1；脏值当 0（NaN ⇒ 整层不可见，但不会再往下传）', () => {
    const { cover } = makeCover();
    cover.build(750, 1334);
    const layer = cover.layerNode;
    const opacity = layer.getComponent(FakeUIOpacity);
    cover.apply(1, 1.5);
    assert.equal(opacity.opacity, 255);
    cover.apply(1, -0.5);
    assert.equal(opacity.opacity, 0);
    cover.apply(Number.NaN, Number.NaN, Number.NaN);
    assert.equal(opacity.opacity, 0);
    assert.ok(Number.isFinite(layer.children[0].position.x), '脏 spread 不能把位置写成 NaN');
    assert.ok(Number.isFinite((layer.children[0].getComponent(FakeSprite) as FakeSprite).color.a),
        '脏 release 不能把 alpha 写成 NaN');
});

test('★★没有云就不建层：一帧都拿不到时 `build` 必须返回 false（调用方据此放弃整页过场）', () => {
    // 没有贴图的精灵画出来是透明的 ⇒ "盖住地块"这件事不存在 ⇒ 宁可退回推镜过场。
    const { host, cover } = makeCover([]);
    assert.equal(cover.build(750, 1334), false);
    assert.equal(cover.count, 0);
    assert.equal(host.children.length, 0, '不许留下一个空层');
    // 帧晚到（异步加载）⇒ `setFrames` 后补建，不用等下一次过场
    cover.setFrames(FAKE_CLOUD_FRAMES);
    assert.equal(cover.build(750, 1334), true);
    assert.ok(cover.count > 0);
});

test('★★收工只藏起来：同一尺寸再演不重建节点（避免"每次开战都新建一百多个节点"）', () => {
    const { host, cover } = makeCover();
    cover.build(750, 1334);
    const count = cover.count;
    const layer = cover.layerNode;
    cover.clear();
    assert.equal(layer.active, false, '收工应把层藏起来');
    assert.equal(host.children.length, 1, '层节点留着复用');
    assert.equal(cover.build(750, 1334), true);
    assert.equal(layer.active, true);
    assert.equal(cover.count, count, '同尺寸不重建');
    // 换尺寸（转屏 / 长屏）⇒ 重建
    cover.build(1334, 750);
    assert.notEqual(cover.count, count);
});

test('★★★盖层自己持有注入的帧引用：跨流程交接时「云比页面活得久」', () => {
    // 2026-11-03 实机：匹配成功切战场，首帧绘制完渲染管线整屏报
    // `frame should not be invalid, it may have been released`（`getGFXTexture` 空指针）。
    // 真因：云的 `SpriteFrame` 属于匹配页/领地页那个资源作用域，页面 `onLeave` 一 `dispose()`
    // 就把帧 `decRef` 掉；而云已经被搬到 `Canvas` 上继续画 ⇒ 图被回收，Sprite 还在提交。
    const frames = fakeFrames(3);
    const { cover } = makeCover(frames);
    assert.deepEqual(frames.map((frame) => frame.refs), [1, 1, 1], '构造时就要持住这几帧');

    // 同一批再设一次（资源晚到会重贴一次）：不许重复 +1，否则永远卸不掉。
    cover.setFrames(frames);
    assert.deepEqual(frames.map((frame) => frame.refs), [1, 1, 1], '重复设同一批不能重复计数');

    // 换一批：旧的还回去、新的持起来。
    const next = fakeFrames(2, 'cloud_body_');
    cover.setFrames(next);
    assert.deepEqual(frames.map((frame) => frame.refs), [0, 0, 0], '换帧要把旧的还回去');
    assert.deepEqual(next.map((frame) => frame.refs), [1, 1], '新的一批要持起来');

    // `destroy` 只销毁节点（`build` 换视口时先 destroy 再重建，帧还要接着用）。
    cover.build(750, 1334);
    cover.destroy();
    assert.deepEqual(next.map((frame) => frame.refs), [1, 1], 'destroy 不能还引用');

    // `dispose` 才是"这个盖层真不要了"。
    cover.dispose();
    assert.deepEqual(next.map((frame) => frame.refs), [0, 0], 'dispose 要还清');
    cover.dispose();
    assert.deepEqual(next.map((frame) => frame.refs), [0, 0], 'dispose 必须幂等（减成负数就再也回收不了）');
});

// ---------------------------------------------------------------------------
// ④ 接线
// ---------------------------------------------------------------------------

test('★★★方向表：四个方向都有意义，节点名不重复，且完全没有"往上推"的旧顶栏', () => {
    const names = new Set<string>();
    for (const target of TERRITORY_BATTLE_INTRO_TARGETS) {
        assert.ok(!names.has(target.name), `节点名重复：${target.name}`);
        names.add(target.name);
    }
    // 用户口径：下方往下、上方往上、两侧往左右
    const byDir = (dir: string): string[] => TERRITORY_BATTLE_INTRO_TARGETS
        .filter((target) => target.dir === dir).map((target) => target.name);
    assert.deepEqual(byDir('down').sort(), ['BeginGame', 'BottomHud', 'BottomNav'].sort(), '底部三件一起往下');
    assert.ok(byDir('left').includes('PlayerCard'), '左上玩家卡往左');
    assert.ok(byDir('right').includes('ResBarLayer'), '右上资源条往右');
    assert.ok(byDir('right').includes('ChestBar'), '右下宝箱栏往右');
    assert.equal(byDir('up').length, 0, '没有"整体往上推"的顶栏（顶栏要拆左右，见注释）');
    // 向量与方向一一对应
    assert.deepEqual(territoryBattleIntroDirVector('left'), { x: -1, y: 0 });
    assert.deepEqual(territoryBattleIntroDirVector('right'), { x: 1, y: 0 });
    assert.deepEqual(territoryBattleIntroDirVector('up'), { x: 0, y: 1 });
    assert.deepEqual(territoryBattleIntroDirVector('down'), { x: 0, y: -1 });
    assert.deepEqual(territoryBattleIntroDirVector('nonsense' as never), { x: 0, y: -1 }, '脏值往下飞，不许静止');
});

test('★★★地图侧：起演必须锁输入 + 盖层用**注入的云帧**，且 `cameraBusy` 认得这套过场', () => {
    const source = stripped(MAP_VIEW);
    const begin = source.slice(source.indexOf('beginBattleIntro(): boolean'), source.indexOf('applyBattleIntro('));
    assert.ok(begin.includes('this.setInputLocked(true)'), '过场期间地图不许拖（拖着走格心就对不上了）');
    assert.ok(begin.includes('this.battleCloudFrames'),
        '盖层的帧必须来自注入（`setBattleCloudFrames`）—— 页面异步加载，视图不许自己去 load');
    assert.ok(!begin.includes('clouds.') && !begin.includes('idleSpriteFrame'),
        '盖层不许借**地图**那套未解锁云（`clouds`）：那套按解锁进度一朵朵盖格子，状态全归它管');
    // 帧可能晚到（异步加载）⇒ 每次起演都重贴一次，别只信构造时那一份。
    assert.ok(begin.includes('setFrames(this.battleCloudFrames)'), '已建过层时要补帧，否则资源晚到就永远没图');
    assert.ok(begin.includes('if (!this.chestCameraActive) this.captureChestCamera(center)'),
        '基准只量一次：已经推过镜再量会把地图停在被推过的位置');
    // 🔴 半截状态守卫：过场在演时不许 `update` 里的收尾把地图还原。
    //    表达式活在 `cameraBusyLocked` 里（`update` 只剩一句 `const cameraBusy = this.cameraBusyLocked;`），
    //    所以要顺着 getter 看它认不认这套过场。
    const update = source.slice(source.indexOf('update(dt: number): void'));
    assert.ok(update.includes('const cameraBusy = this.cameraBusyLocked;'),
        '`update` 必须先取那唯一一份"镜头在忙"的判据');
    const busyGetter = source.slice(source.indexOf('private get cameraBusyLocked(): boolean'));
    const busy = busyGetter.slice(0, busyGetter.indexOf('\n    }'));
    assert.ok(busy.includes('this.battleIntroActive'), '`cameraBusy` 漏了它 ⇒ 第一帧就把地图还原回去');
    assert.ok(busy.includes('this.chestView?.isPlaying === true'), '开箱那条也不能丢');
    assert.ok(busy.includes('this.battleApproach !== null'), '前奏的推镜同样在写同一个镜头基准');
    // 收工顺序：先还原地图再放开输入锁（滚动容器要按 content 真实尺寸算边界）
    const end = source.slice(source.indexOf('endBattleIntro(): void'), source.indexOf('isBattleIntroPlaying'));
    assert.ok(end.indexOf('this.restoreChestCamera()') < end.indexOf('this.setInputLocked(false)'),
        '还原必须在放开输入锁之前');
});

test('★★★没有云就不演：云盖层一朵都建不出来时，整页过场必须放弃（否则露一片空底色）', () => {
    const source = stripped(MAP_VIEW);
    const begin = source.slice(source.indexOf('beginBattleIntro(): boolean'), source.indexOf('applyBattleIntro('));
    assert.ok(begin.includes('this.battleCover.count > 0'), '必须检查云盖层真的建出了云');
    assert.ok(begin.includes('this.restoreChestCamera()'), '放弃时要把已经量过的镜头基准清掉');
    // 放弃必须在"锁输入 / 标记在演"之前：否则会留下一个锁着、却没人推进的页面
    assert.ok(begin.indexOf('return false') < begin.indexOf('this.setInputLocked(true)'),
        '`return false` 的几条出口必须都在锁输入之前');
    assert.ok(begin.indexOf('return false') < begin.indexOf('this.battleIntroActive = true'),
        '同理，也不能先把"在演"的标志立起来');
});

test('★★★页面侧：`out → hold → in` 三段真的接上了，且 `in` 段只跳一次', () => {
    const source = stripped(PAGE);
    const update = source.slice(source.indexOf('    update(dt: number): void'), source.indexOf('private startBattleIntro'));
    assert.ok(update.includes("intro.phase === 'out'"), '缺 out 段');
    assert.ok(update.includes("intro.phase === 'hold'"), '缺 hold 段（"云层静止等回包"就是这一段）');
    assert.ok(update.includes('territoryBattleIntroHoldFx()'), 'hold 的定格帧要显式写一次');
    assert.ok(update.includes('TERRITORY_BATTLE_INTRO_HOLD_MAX_SECONDS'), 'hold 必须有超时兜底，否则整页卡死');
    assert.ok(update.includes('intro.navigated'), '跳转必须只发生一次');
    assert.ok(update.includes('this.commitBattleNav(intro.nav)'), '`in` 段该跳的是记下来的那条去向');
    // `out` 段到达回包时**不许**立刻切 `in`：云还没盖住就散开，等于什么也没发生
    const release = source.slice(source.indexOf('releaseBattleIntro('), source.indexOf('finishBattleIntro('));
    assert.ok(!release.includes("phase = 'in'"), '回包到达只许记下来，切段由 update 按阶段决定');
});

test('★★★谁起演、谁收工：开战请求在途就起、被拒/超时立刻复位', () => {
    const source = stripped(PAGE);
    // 起演：按「开战校验」这条请求的文案认（别的请求各有各的文案）。
    // 🔴 唯一的例外是「首次解锁直开」：那一路（`payload.approach`）回包后还要先播
    //    「地块生成 → 推镜 + 提示条」，云留到最后才盖 —— 这里提前盖上去，前两段就全在云后面演。
    assert.ok(source.includes('payload.text === TERRITORY_TEXTS.busyBattle && payload.approach !== true && this.startBattleIntro()'),
        '请求在途时要先把云合拢起来，否则"等回包"这一段根本不存在（直开那一路除外，交给前奏）');
    // 被拒 / 资源不足 ⇒ 提示到达时复位（没有"反向过场"，见注释）
    const tip = source.slice(source.indexOf('private onShowTip'), source.indexOf('private onShowRewards'));
    assert.ok(tip.includes('if (this.battleIntro && !this.battleIntro.navigated) this.finishBattleIntro()'),
        '提示到达必须复位，否则玩家被云盖住出不来（已经开始跳转的那条不复位，页面马上就不在了）');
    // 收工：HUD 复位 + 地图那半复位（两者都在 `restoreBattleIntroScene` 里）
    const restore = source.slice(source.indexOf('restoreBattleIntroScene(hud'),
        source.indexOf('private writeBattleIntroFx'));
    assert.ok(restore.includes('releaseIntroHud(handle)'), 'HUD 必须回到开演那一刻的基准位置');
    assert.ok(restore.includes('this.mapView.endBattleIntro()'), '地图那半也要收');
});

test('★★★跳转之后**不许把主界面弹回来**：预加载还没完，弹回来等于过场白做，但要留兜底', () => {
    const source = stripped(PAGE);
    const update = source.slice(source.indexOf('    update(dt: number): void'), source.indexOf('private startBattleIntro'));
    assert.ok(update.includes('if (intro.navigated) this.abandonBattleIntro()'),
        '已跳转 ⇒ 走"不还原"那条');
    const abandon = source.slice(source.indexOf('private abandonBattleIntro(): void'),
        source.indexOf('private restoreBattleIntroScene'));
    assert.ok(abandon.length > 0, '找不到 `abandonBattleIntro` 的实现');
    assert.ok(!abandon.includes('releaseIntroHud('), '跳转后不许把 HUD 摆回去（会整片闪回主界面）');
    assert.ok(!abandon.includes('endBattleIntro()'), '同理，地块也不许还原');
    assert.ok(abandon.includes('TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS'),
        '必须留兜底：流程真没切走时把界面还回去，否则玩家对着空屏');
    assert.ok(abandon.includes('this.scheduleOnce('), '兜底挂在页面组件上：跳转成功 ⇒ 页面销毁 ⇒ 回调不执行');
    // 兜底时限要明显长于 `in` 段（否则等于"播完立刻弹回"）
    assert.ok(TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS > TERRITORY_BATTLE_INTRO_IN_SECONDS * 2,
        '兜底时限必须明显长于散场时长');
});

test('★★★页面不许自己搭 UI：给 HUD 挂 `UIOpacity` 的活必须在视图层', () => {
    const source = stripped(PAGE);
    // `tests/territory-page-split.test.ts` 的架构守卫：页面上出现这两个就红。
    for (const banned of ['new Node(', 'addComponent(']) {
        assert.equal(source.includes(banned), false, `页面里出现了 ${banned}（应交给视图层 / prefab）`);
    }
    const hud = readFileSync(HUD_VIEW, 'utf8');
    assert.ok(hud.includes('node.getComponent(UIOpacity)'), '视图层先复用节点上已有的 UIOpacity');
    assert.ok(hud.includes('node.addComponent(UIOpacity)'), '没有才补一个');
    assert.ok(hud.includes('if (handle.added) handle.opacity.destroy()'),
        '只许删自己加的那个（prefab 自带的删了就是永久半透明）');
    assert.ok(hud.includes('node.setPosition(handle.base)'), '收工必须回到基准位置，不是回 (0,0)');
});

test('★★★从弹窗开战：必须先关弹窗，再演过场（用户 2026-11-02 实测反馈）', () => {
    const source = stripped(PAGE);
    const start = source.slice(source.indexOf('private startBattleIntro(): boolean'),
        source.indexOf('closeBattleIntroPopups(): void'));
    // 起演那一刻就要把挡在前面的弹窗收掉：不关的话 `out`（UI 推出 + 云合拢）整段在它后面，
    // 玩家只看得见最后那点云散 —— 这就是"过场好像没播"的原因。
    assert.ok(start.includes('this.closeBattleIntroPopups()'), '起演必须关弹窗');
    // 顺序：先确认过场播得了（`beginBattleIntro`），再关弹窗（播不了别白关玩家正在看的窗），
    // 最后才是立状态、写第一帧。
    assert.ok(start.indexOf('this.mapView.beginBattleIntro()') < start.indexOf('this.closeBattleIntroPopups()'),
        '先确认能演，再关弹窗');
    assert.ok(start.indexOf('this.closeBattleIntroPopups()') < start.indexOf('this.battleIntro = {'),
        '关弹窗必须在"开始演"之前');
    // 三件挡路的都关：关卡界面 / 关卡提示 / 玩家关卡面板
    const close = source.slice(source.indexOf('closeBattleIntroPopups(): void'),
        source.indexOf('playMatchingIntro(entry: IMatchingEntryParams)'));
    for (const name of ['LevelInfoPanel', 'LevelTipPanel', 'playerStagePanel']) {
        assert.ok(close.includes(name), `关弹窗清单漏了 ${name}`);
    }
});

test('★★★过场接手后不许再叠全屏 loading：它在弹窗层最上面，会把 out / hold 整段盖掉', () => {
    const source = stripped(PAGE);
    const busy = source.slice(source.indexOf('private onSetBusy'), source.indexOf('// ============'));
    assert.ok(busy.length > 0, '找不到 onSetBusy');
    // 起演成功 ⇒ 直接 return，不许走到 `LoadingPopup.show`
    assert.ok(busy.includes('this.battleBusyHiddenLoading = true;'),
        '要记下"这一次没弹 loading"，否则收尾会多减一次全局引用计数');
    const takeOver = busy.indexOf('this.battleBusyHiddenLoading = true;');
    assert.ok(busy.indexOf('LoadingPopup.show(payload.text);') > takeOver,
        '`LoadingPopup.show` 必须在"过场接手"的 return 之后（也就是真的没演时才弹）');
    assert.ok(busy.includes('if (this.battleBusyHiddenLoading) {'), '收尾要配对掉没 show 过的那一次');
    const release = busy.slice(busy.indexOf('if (this.battleBusyHiddenLoading) {'));
    assert.ok(release.indexOf('this.battleBusyHiddenLoading = false;') < release.indexOf('LoadingPopup.hide();'),
        '先清标志再决定 hide');
});

test('★★过场播不了就直走：不许云盖住一个不动的画面，也不许白等一段推镜', () => {
    const source = stripped(PAGE);
    // 只切到 `beginBattlePrelude` 为止：前奏那段里也有推镜（那是它自己的第二段），
    // 混进来会把这条判据骗过去。
    const navigate = source.slice(source.indexOf('private onNavigateToBattle'), source.indexOf('private beginBattlePrelude'));
    assert.ok(navigate.length > 0, '找不到 onNavigateToBattle 的实现');
    // ① 手按开战：先试整页过场。
    assert.ok(navigate.includes('if (this.startBattleIntro())'), '先试整页过场');
    // ② 播不了（云美术没加载上 / 拿不到地图中心）⇒ 没有任何云被盖上去，
    //    这里再补一段推镜只是把开战时间往后拖 1.2 秒，玩家还是看不到"过场"这个信息。
    //    ⇒ 直接走。（"至少有一段表演"这条诉求由首次解锁直开的前奏承担，见 stepBattlePrelude。）
    const tail = navigate.slice(navigate.indexOf('if (this.startBattleIntro())'));
    assert.ok(tail.includes('this.commitBattleNav({ route: \'battle\', payload });'),
        '播不了必须无延迟地直走');
    assert.ok(!tail.includes('playBattleApproach('), '播不了时不要再补一段推镜（只会白等 1.2 秒）');
    // ③ 前奏那条路里推镜真起不来时，必须**跳满**这一段时长而不是原地等，同样不许白等。
    const prelude = source.slice(source.indexOf('private stepBattlePrelude('),
        source.indexOf('commitBattleNav(nav: ITerritoryBattleIntroNav)'));
    assert.ok(prelude.includes('if (!started) prelude.elapsed = TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS;'),
        '推镜起不来要直接跳满，别白等');
});

// ---------------------------------------------------------------------------
// ⑤ 宝箱匹配也走同一套过场（用户 2026-11-02 追加：「宝箱匹配也要接」）
// ---------------------------------------------------------------------------

test('★★★宝箱栏的「战斗」格必须走整页过场，且过场接手后不许再自己跳一次', () => {
    const source = stripped(MAIN_PAGE);
    const action = source.slice(source.indexOf('private async onChestAction'), source.indexOf('private async openChestDetail'));
    assert.ok(action.length > 0, '找不到 onChestAction 的实现');
    assert.ok(action.includes('playMatchingIntro(entry)'), '宝箱匹配必须交给过场（否则这一路永远没有过场）');
    // 顺序：先问过场，过场不接才自己跳 —— 反过来的话 `return` 之后过场永远没机会
    assert.ok(action.indexOf('playMatchingIntro(') < action.indexOf('ProcedureManager.navigate(GameRoute.Matching'),
        '必须"过场优先、直跳兜底"');
    assert.ok(/if \(this\.territoryMap\?\.playMatchingIntro\(entry\)\) return;/.test(action),
        '过场接手了就必须 return（同一个入口跳两次 = 两份匹配请求）');
});

test('★★★过场要认得"去匹配"这条去向：与去战场共用一个 `commitBattleNav`', () => {
    const page = stripped(PAGE);
    assert.ok(page.includes("readonly route: 'matching'"), '去向表里必须有 matching');
    assert.ok(page.includes('playMatchingIntro(entry: IMatchingEntryParams): boolean'), '过场入口');
    const commit = page.slice(page.indexOf('commitBattleNav(nav: ITerritoryBattleIntroNav)'),
        page.indexOf('private onShowTip'));
    assert.ok(commit.includes("nav.route === 'matching'"), '`commitBattleNav` 要按去向分流');
    assert.ok(commit.includes('ProcedureManager.navigate(GameRoute.Matching, nav.entry)'),
        '匹配那条走 `GameRoute.Matching`');
    assert.ok(commit.includes("kind: 'enterBattle', payload: nav.payload"), '战场那条保持原样');
    // 匹配没有在途请求 ⇒ 起演那一刻就把去向记下来（`hold` 立刻结束），
    // 否则会白等 3 秒超时（云静止 3 秒，玩家以为卡死）。
    const start = page.slice(page.indexOf('playMatchingIntro(entry: IMatchingEntryParams): boolean'),
        page.indexOf('private releaseBattleIntro'));
    assert.ok(start.includes("this.releaseBattleIntro({ route: 'matching', entry })"),
        '匹配是本地跳转，起演就要把去向交给过场');
    // 已经在演（领地开战等回包中）⇒ 吞掉这一下，别把两条流程撞在一起
    assert.ok(start.includes('if (this.battleIntro) return true'), '过场在演时不许再起第二条');
});

test('★★★普通关 / 首领关按 `pve.mode` 分流：`mode` 不在 payload 顶层（取错就永远直进战场）', () => {
    // 🔴 这条是**实机 bug** 的回归判据：`mode` 挂在 `pve` 里（见 `ITerritoryBattleNavParams`），
    //    写成 `nav.payload.mode` 编译能过（`strict: false`）、运行时恒 `undefined` ⇒
    //    条件永远不成立 ⇒ 普通关照样直进战场，正是用户报的「点击关卡后没有进到匹配界面」。
    const page = stripped(PAGE);
    const commit = page.slice(page.indexOf('commitBattleNav(nav: ITerritoryBattleIntroNav)'),
        page.indexOf('private onShowTip'));
    assert.ok(commit.includes("nav.payload.pve.mode === 'match'"), '分流判据必须取 `pve.mode`');
    assert.ok(!commit.includes('nav.payload.mode'), '`mode` 不在 payload 顶层，取它永远是 undefined');
    // 普通关那条必须把三样一起交给匹配页：战斗类型、开战参数、关卡载荷。
    assert.ok(commit.includes('battleType: ZC_BATTLE_TYPE_CHAPTER'), '匹配页要知道这是章节战斗');
    assert.ok(commit.includes('battleParams: nav.payload.battleParams'), '开战参数要交出去（匹配页负责发请求）');
    assert.ok(commit.includes('pve: nav.payload.pve'), '`pve` 必须原样透传（否则打完不回写领地进度）');
    // 首领关（defence）仍然直进战场，且必须带上服务端那份 `battle`。
    assert.ok(commit.includes("kind: 'enterBattle', payload: nav.payload"), '首领关直进战场');
});

test('★★★宿主必须把领地地图交给主城页（否则宝箱匹配永远走不到过场）', () => {
    const source = stripped(COMPOSITION);
    assert.ok(source.includes('main.territoryMap = territory'), 'composition 要接线');
    const page = stripped(MAIN_PAGE);
    assert.ok(page.includes('territoryMap: MainTerritoryMap | null = null'), '主城页要留这个字段');
    assert.ok(!page.includes('new TerritoryBattleCover'), '主城页不许自己搭一套过场（视图归地图页）');
});

test('★过场常量不许写回页面/视图（曲线只在 model 里，改手感只改一处）', () => {
    const model = readFileSync(INTRO_MODEL, 'utf8');
    for (const name of ['TERRITORY_BATTLE_INTRO_OUT_SECONDS', 'TERRITORY_BATTLE_INTRO_IN_SECONDS',
        'TERRITORY_BATTLE_INTRO_CELL_SCALE', 'TERRITORY_BATTLE_INTRO_COVER_SPREAD']) {
        assert.ok(model.includes(`export const ${name}`), `${name} 应在 model 里导出`);
    }
    for (const path of [PAGE, COVER_VIEW]) {
        const source = stripped(path);
        assert.ok(!/0\.55|0\.45/.test(source), `${path} 里不该出现过场时长字面量`);
    }
});

// ---------------------------------------------------------------------------
// ⑥ 流程没接手：回包到了却没进战斗（用户 2026-11-02 实测反馈）
// ---------------------------------------------------------------------------

/**
 * 实测现象：「雾静止等回包，但是没有进入战斗，又重新返回了领地界面」。
 *
 * 链路（两层各一处，缺一不可）：
 *  1. 过场起演时关掉关卡界面 ⇒ 弹窗 `onClose` 发 `closeDetail` ⇒ model 把它读成
 *     「玩家放弃这一格」⇒ 换交互号 ⇒ 在途的开战回包被 `runCellWrite` 判成过期丢掉
 *     ⇒ 根本没有 `navigate`。**这条由 territory-presenter 的行为用例兜。**
 *  2. 就算 `navigate` 发出去了，流程预加载失败时以前是静默的：只有一条控制台警告，
 *     玩家那边等 1.5s 兜底把界面弹回来，看起来像"点了没反应"。
 */
test('★★★关弹窗之前必须先声明「这是过场关的」：否则在途开战回包会被判成玩家放弃', () => {
    const source = stripped(PAGE);
    const close = source.slice(source.indexOf('closeBattleIntroPopups(): void'),
        source.indexOf('playMatchingIntro(entry: IMatchingEntryParams)'));
    assert.ok(close.length > 0, '找不到 closeBattleIntroPopups 的实现');
    assert.ok(close.includes("this.sendIntent({ kind: 'keepBattleRequest' })"),
        '关弹窗前必须发 keepBattleRequest（让 model 别把这次关窗当成"玩家放弃"）');
    assert.ok(close.indexOf("kind: 'keepBattleRequest'") < close.indexOf('this.closePopup(LevelInfoPanel)'),
        '顺序：先声明，再关窗 —— 反过来的话 closeDetail 已经把交互号换了');
});

test('★★★跳转发出后要盯「流程切换落定」：没接手就当场收尾 + 提示，不许静默等兜底', () => {
    const source = stripped(PAGE);
    const commit = source.slice(source.indexOf('commitBattleNav(nav: ITerritoryBattleIntroNav)'),
        source.indexOf('private closeBattleIntroPopups'));
    assert.ok(commit.length > 0, '找不到 commitBattleNav 的实现');
    assert.ok(commit.includes('this.watchBattleSwitch()'), '发完跳转要开始盯切换结果');
    assert.ok(commit.lastIndexOf('ProcedureManager.navigate') < commit.indexOf('this.watchBattleSwitch()'),
        '订阅必须在 navigate 之后：changeProcedure 开头的 cancelPendingSwitch 会把上一次切换的失败同步播出来');

    const watch = source.slice(source.indexOf('private watchBattleSwitch()'),
        source.indexOf('private stopBattleSwitchWatch()'));
    assert.ok(watch.includes('ProcedureManager.onSwitchSettled'), '要用框架的落定钩子，不要自己轮询');
    assert.ok(watch.includes('this.battleIntroLeftover = null'), '切走了就作废待还原现场，别让兜底定时器把 UI 弹回来');
    assert.ok(watch.includes('this.failBattleIntro('), '没切走要当场收尾（而不是等定时器）');

    const fail = source.slice(source.indexOf('private failBattleIntro(reason: string)'),
        source.indexOf('private restoreBattleIntroScene'));
    assert.ok(fail.includes('this.restoreBattleIntroScene(hud)'), '要把主界面还回去');
    assert.ok(fail.includes("this.sendIntent({ kind: 'cancelBattleStart' })"),
        '不复位在途开战态的话「开始战斗」会变成死按钮');
    assert.ok(fail.includes('FW.showTip(TERRITORY_TEXTS.battleEnterFailed)'), '必须告诉玩家为什么没进去');
    // HUD 句柄两种时机都要找得到：`in` 段没播完（battleIntro 还在）或已交给 abandon（只剩 leftover）
    assert.ok(fail.indexOf('this.battleIntro?.hud') >= 0 && fail.indexOf('this.battleIntroLeftover?.hud') >= 0,
        '两种时机都要能拿到 HUD 句柄，否则被推出去的底栏永远回不来');
});

test('★★兜底定时器只留一条死局：正常失败走落定回调，它也走同一套收尾', () => {
    const source = stripped(PAGE);
    const abandon = source.slice(source.indexOf('private abandonBattleIntro()'),
        source.indexOf('private restoreBattleIntroScene'));
    assert.ok(abandon.includes('this.scheduleOnce('), '兜底定时器还在（防切换被永久挂起）');
    assert.ok(abandon.includes('this.failBattleIntro('),
        '兜底也要走同一套收尾：不然玩家既没有提示，按钮也还是死的');
    assert.ok(TERRITORY_BATTLE_INTRO_RESTORE_FALLBACK_SECONDS > TERRITORY_BATTLE_INTRO_IN_SECONDS,
        '兜底窗口要长于一次 `in`，否则正常的慢切换会被它误伤');
});

test('★★★跨流程交接：`setBaseStep` 接着同一步、`startRelease` 之后自己散完并藏起来', () => {
    const { cover } = makeCover();
    assert.equal(cover.build(750, 1334), true);
    const layer = cover.layerNode;
    assert.ok(layer);
    const puffs = territoryBattleIntroCoverPuffs(750, 1334);
    const frameOf = (index: number): unknown =>
        (layer.children[index].getComponent(FakeSprite) as FakeSprite).spriteFrame;

    // ① 步进可以"接着走"：领地页切走时走到第几步，匹配页就从第几步开始。
    //    不接的话，切过去那一帧每朵云的形态会同时换一次 —— 整屏"抖一下"。
    cover.setBaseStep(3);
    assert.equal(cover.frameStep, 3);
    for (let index = 0; index < puffs.length; index += 1) {
        const expected = FAKE_CLOUD_FRAMES[(3 + puffs[index].frame) % FAKE_CLOUD_FRAMES.length];
        assert.equal(frameOf(index), expected, `第 ${index} 朵没接上步进`);
    }
    cover.setBaseStep(NaN);
    assert.equal(cover.frameStep, 0, '脏步进当 0');

    // ② 散场自驱：返回"过多久该发起跳转"（散到 60% 切场景，最后 40% 与战场首帧重叠）
    cover.apply(1, 1, 0);
    assert.equal(cover.startRelease(),
        TERRITORY_BATTLE_INTRO_IN_SECONDS * TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO);
    cover.tick(TERRITORY_BATTLE_INTRO_IN_SECONDS * 0.5);
    assert.ok(Math.abs(layer.children[0].position.x) > Math.abs(Math.round(puffs[0].x)),
        '散场时云必须往外走');

    // ③ 走完必须自己藏起来：否则匹配页上会永远挂着一屏云（那时已经没有界面盖着它了）
    for (let index = 0; index < 40; index += 1) cover.tick(1 / 60);
    assert.equal(layer.active, false, '散完没藏起来');
});

// ---------------------------------------------------------------------------
// ⑥ 连续开战（2026-11-04 实机：首领关第一波能进、第二波进不去）
// ---------------------------------------------------------------------------

test('★★★busy 起演的过场必须收得下回包那条 navigate：不许拿 battleApproachPending 判重', () => {
    const source = stripped(PAGE);
    const start = source.indexOf('private onNavigateToBattle');
    const end = source.indexOf('private beginBattlePrelude');
    assert.ok(start > 0 && end > start, '找不到 onNavigateToBattle 的实现（切片为空不许判绿）');
    const navigate = source.slice(start, end);
    assert.ok(!/if \(this\.battleApproachPending\) return;/.test(navigate),
        '请求在途时 startBattleIntro 已把门闩置 true，用它判重会吞掉回包后第一条 navigate');
    assert.ok(navigate.includes('this.battleIntro?.nav'), '要按「本次过场是否已拿到去向」判重');
    assert.ok(navigate.includes('this.battlePrelude'), '前奏在跑时仍要挡住迟到回包');
    // 守卫不能挡在「把 nav 交给过场」之前：否则过场永远等不到去向、3s 后判取消。
    assert.ok(navigate.indexOf('this.releaseBattleIntro') > navigate.indexOf('if (this.battleIntro)'),
        '过场已起演时必须把回包的去向交给它');
});

test('★★★流程切走落定后要复位过场门闩（成功路径不复位 ⇒ 页面复用时第二次开战静默失效）', () => {
    const source = stripped(PAGE);
    const start = source.indexOf('private watchBattleSwitch()');
    const end = source.indexOf('private stopBattleSwitchWatch()');
    assert.ok(start > 0 && end > start, '找不到 watchBattleSwitch 的实现（切片为空不许判绿）');
    const watch = source.slice(start, end);
    const from = watch.indexOf('if (entered)');
    const to = watch.indexOf('this.failBattleIntro');
    assert.ok(from > 0 && to > from, '找不到 entered 分支');
    const entered = watch.slice(from, to);
    assert.ok(entered.includes('this.battleApproachPending = false;'), '成功落定必须复位一次性门闩');
});

test('★前奏仍要立起 battleApproachPending（修守卫不许顺手删掉前奏的并发判据）', () => {
    const source = stripped(PAGE);
    const start = source.indexOf('private beginBattlePrelude');
    const end = source.indexOf('private stepBattlePrelude');
    assert.ok(start > 0 && end > start, '找不到 beginBattlePrelude 的实现');
    assert.ok(source.slice(start, end).includes('this.battleApproachPending = true'));
});
