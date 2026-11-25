/**
 * 升级成功弹窗的「UI 表现动画」（2026-11-20 需求五条，同日二改三条）。
 *
 * 这一轮全是**时间轴 / 层级 / 资源引用**那类「跑起来只是不对味、控制台零报错」的改动：
 * 错峰写反了就是动画顺序颠倒，帧引用少一张就是播到一半闪空，
 * 光带各算各的时间就是「不同步」。所以用例分四处钉死：
 *
 *  ① **时序表**（`CardUpgradedTimeline`，纯函数）：全部同时起播（不再错峰）、
 *     每块在自己那个方向上第 0 帧就完整在屏幕外、换数字正好在放大峰值、
 *     换数值 == 刷光结束、进度条到点才退格；
 *  ② **同步**：只有一份刷光进度，三条光带共用，但**各扫各的框**（不是一个大的刷光）；
 *  ③ **资源**：`CardUpgradeFx` 是单节点 `sp.Skeleton`，绑 `resources/skel/ddz_cj_nextlevel`、
 *     播 1 次不自播；骨骼的 atlas 22 个区域齐全（少一张就是播到一半闪空、且零报错）；
 *  ④ **装配**：特效在立绘上层且压在角色中心（下移 `FX_DROP_PX`）、旧值/新值都由控制器带进来、
 *     逐帧回调在关闭时收干净。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    ENTRANCE_BLOCK_COUNT,
    ENTRANCE_DIRECTIONS,
    ENTRANCE_DURATION,
    ENTRANCE_TRAVEL,
    FX_DURATION,
    LEVEL_POP_SCALE,
    PROGRESS_BEAM_LAYERS,
    PROGRESS_GROW,
    PROGRESS_HOLD,
    PROGRESS_POP_SCALE,
    PROGRESS_RESET,
    SHINE_DURATION,
    SHINE_SWEEP_EASE,
    SLOT_BEAM_LAYERS,
    buildCardUpgradedSchedule,
    barGlowAt,
    entranceDirectionAt,
    entranceOffsetAt,
    heroGlowAt,
    levelScaleAt,
    progressPopScaleAt,
    progressRatioAt,
    progressZeroTextOf,
    shineEnvelopeAt,
    shineOpacityAt,
    shineProgressAt,
    shineSweepAt,
} from '../assets/script/app/card/CardUpgradedTimeline.ts';
import { BUNDLE_DIRECTORIES, MAIN_PAGES_BUNDLE, bundleForPath } from '../assets/script/core/asset/BundleCatalog.ts';

const schedule = buildCardUpgradedSchedule();
const pageSource = readFileSync('assets/script/app/card/CardUpgradedPage.ts', 'utf8');
const controllerSource = readFileSync('assets/script/app/card/CardUpgradeController.ts', 'utf8');
const previewSource = readFileSync('assets/script/app/card/CardUnitPreview.ts', 'utf8');

const PRE_FAB = 'assets/bundles/main-pages/ui/card/CardUpgraded.prefab';
const FX_PREFAB = 'assets/bundles/main-pages/ui/card/CardUpgradeFx.prefab';
const FRAME_DIR = 'assets/bundles/main-pages/image/card_effect_levelup';
/** 升级特效用到的骨骼（2026-11-25 起替代旧的 15 帧序列帧）。 */
const FX_SKEL_DIR = 'assets/resources/skel/ddz_cj_nextlevel';
const FX_SKEL_NAME = 'ddz_cj_nextlevel';
const FX_ANIMATION = 'ddz_cj_nextlevel';
/** 骨骼画布（`.skel` 的 x/y/width/height），prefab 的 UITransform 必须与它一致。 */
const FX_CANVAS = { width: 275.7550048828125, height: 600, anchorX: 0.49436096299886895, anchorY: 0.16295000712076824 };
/** prefab 里烘死的显示缩放：600×1.4=840，约等于立绘 426 高的两倍（旧序列帧是 885.6）。 */
const FX_SCALE = 1.4;
/** atlas 里的 22 个区域：4 层光 + 18 颗上升的光丝。 */
const FX_ATLAS_REGIONS = 22;

/** 设计分辨率 720×1610 ⇒ 上沿 +805、右沿 +360；越过去才算「完全在屏幕外」。 */
const SCREEN_TOP = 1610 / 2;
const SCREEN_RIGHT = 720 / 2;

const prefab = JSON.parse(readFileSync(PRE_FAB, 'utf8')) as Array<Record<string, any>>;
const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
const nodeNamed = (name: string): Record<string, any> => {
    const found = nodes.find((node) => node._name === name);
    assert.ok(found, `CardUpgraded.prefab 里找不到节点 ${name}`);
    return found!;
};
const sizeOf = (node: Record<string, any>): { width: number; height: number } => {
    const transform = (node._components ?? [])
        .map((ref: { __id__: number }) => prefab[ref.__id__])
        .find((component: Record<string, any>) => component?.__type__ === 'cc.UITransform');
    return { width: Number(transform._contentSize.width), height: Number(transform._contentSize.height) };
};

// ============================================================
// ① 时序表：五条需求的先后与间隔
// ============================================================

/**
 * 入场块表，与 `CardUpgradedPage.collectEntranceBlocks` 一一对应：
 * Header / 立绘（+影子）/ 等级 自上而下，属性区按 `Left*` / `Right*` 前缀拆左右两块，增益条自下。
 */
const entranceBlocks = (() => {
    const statsChildren = (nodeNamed('Stats')._children as { __id__: number }[])
        .map((ref) => prefab[ref.__id__]);
    const blocks: { node: Record<string, any>; index: number }[] = [
        { node: nodeNamed('Header'), index: 0 },
        { node: nodeNamed('Shadow'), index: 1 },
        { node: nodeNamed('Hero'), index: 1 },
        { node: nodeNamed('Level'), index: 2 },
    ];
    for (const child of statsChildren) {
        const name = String(child._name);
        if (name.startsWith('Left')) blocks.push({ node: child, index: 3 });
        else if (name.startsWith('Right')) blocks.push({ node: child, index: 4 });
    }
    blocks.push({ node: nodeNamed('Bonus'), index: 5 });
    return blocks;
})();

test('入场：所有块同时起播，各自从屏幕的不同方向滑进来', () => {
    assert.equal(schedule.entrance.length, ENTRANCE_BLOCK_COUNT);
    assert.equal(ENTRANCE_DIRECTIONS.length, ENTRANCE_BLOCK_COUNT, '方向表与块数必须一一对应');
    for (let i = 0; i < schedule.entrance.length; i++) {
        assert.equal(schedule.entrance[i], 0, `第 ${i} 块必须与第 0 帧同时起播（不许再错峰）`);
    }
    assert.equal(schedule.entranceEnd, ENTRANCE_DURATION, '同时入场 ⇒ 落位时刻只剩一个统一时长');

    // 上部三块同向（自上而下），左右属性各一方向，增益条自下 —— 四个方向都要用上
    assert.deepEqual(entranceDirectionAt(0), { x: 0, y: 1 }, 'Header 从上方来');
    assert.deepEqual(entranceDirectionAt(1), { x: 0, y: 1 }, '立绘从上方来');
    assert.deepEqual(entranceDirectionAt(2), { x: 0, y: 1 }, '等级从上方来');
    assert.deepEqual(entranceDirectionAt(3), { x: -1, y: 0 }, '属性左框从左侧来');
    assert.deepEqual(entranceDirectionAt(4), { x: 1, y: 0 }, '属性右框从右侧来');
    assert.deepEqual(entranceDirectionAt(5), { x: 0, y: -1 }, '增益条从下方来');
    const distinct = new Set(ENTRANCE_DIRECTIONS.map((d) => `${d.x},${d.y}`));
    assert.equal(distinct.size, 4, '「从不同位置入场」至少要真的用上四个方向');

    // 越界序号退回「从上方来」，不许返回 undefined 让调用方崩
    assert.deepEqual(entranceDirectionAt(99), { x: 0, y: 1 });

    // 每一块在 t=0 时都必须**完整**在自己那条轴的外侧（否则「从屏外来」就成了「原地淡入」）
    for (const { node, index } of entranceBlocks) {
        const offset = entranceOffsetAt(schedule, 0, index);
        assert.equal(offset, ENTRANCE_TRAVEL, 't=0 的行程必须是满额');
        const direction = entranceDirectionAt(index);
        const { width, height } = sizeOf(node);
        const centerX = Number(node._lpos.x) + direction.x * offset;
        const centerY = Number(node._lpos.y) + direction.y * offset;
        const name = String(node._name);
        if (direction.x !== 0) {
            const edge = direction.x > 0 ? centerX - width / 2 : centerX + width / 2;
            assert.ok(Math.abs(edge) >= SCREEN_RIGHT,
                `${name} 在 t=0 时横向还在屏幕内（边缘 x=${edge}），会先露一角`);
        } else {
            const edge = direction.y > 0 ? centerY - height / 2 : centerY + height / 2;
            assert.ok(direction.y > 0 ? edge >= SCREEN_TOP : edge <= -SCREEN_TOP,
                `${name} 在 t=0 时纵向还在屏幕内（边缘 y=${edge}），会先露一角`);
        }
    }
});

test('入场一结束就落位；光效改成与「本体叠色」同一拍起播', () => {
    for (const { index } of entranceBlocks) {
        assert.equal(entranceOffsetAt(schedule, schedule.entranceEnd, index), 0,
            `第 ${index} 块在 entranceEnd 必须正好归零`);
    }
    // 2026-11-25 用户：「升级界面的光效需要等待本体叠颜色同步播放，现在是角色加载动画就播放了」。
    // 所以光效不再挂「立绘落位」，而是挂到刷光那一拍 —— 起播时刻必须**精确相等**，差一帧就是「各亮各的」。
    assert.equal(schedule.fxAt, schedule.shineStart, '特效起播必须与刷光/本体叠色同拍');
    const heroLand = schedule.entrance[1] + ENTRANCE_DURATION;
    assert.ok(schedule.fxAt > heroLand + 0.5,
        `特效 ${schedule.fxAt}s 还在角色刚滑进来（${heroLand}s）附近 —— 这就是用户说的「加载动画就播放了」`);
    assert.ok(schedule.fxAt >= schedule.levelSettleEnd, '等级数字的回弹要演完，别叠在一起');
    assert.equal(schedule.fxEnd - schedule.fxAt, FX_DURATION, '特效时长必须等于 spine 动画时长（1.0s）');
});

test('起播那一刻本体还没上色，起播后才跟着刷光一起亮', () => {
    // 「同步播放」的判据：起播前一帧叠色为 0，起播那一帧进度也是 0（两者同一根时间轴）
    assert.equal(heroGlowAt(shineProgressAt(schedule, schedule.fxAt - 0.01)), 0,
        '起播前本体不许已经亮着');
    assert.equal(shineProgressAt(schedule, schedule.fxAt), 0, '起播与刷光起点是同一帧');
    assert.equal(heroGlowAt(0), 0, '刷光第 0 帧的叠色必须为 0（淡入的起点）');
    // 起播 0.1s 后本体已经亮起来，特效这时还在播（1.0s）⇒ 两件事真的同时发生
    const glowMid = heroGlowAt(shineProgressAt(schedule, schedule.fxAt + 0.1));
    assert.ok(glowMid > 0.6, `起播 0.1s 时本体只亮到 ${glowMid}，读不出「同步」`);
    assert.ok(schedule.fxAt + 0.1 < schedule.fxEnd, '此时特效必须还在播');
    // 视图侧：特挂由 `fxAt` 起播，本体叠色由同一个 shine 驱动 —— 没有第二根时间轴
    assert.match(pageSource, /if \(!this\.fxStarted && t >= timeline\.fxAt\)/);
    assert.match(pageSource, /this\.applyHeroGlow\(heroGlowAt\(shine\)\);/);
});

test('等级数字在放大峰值换字：换字时刻的倍数正好是峰值，之后落回 1', () => {
    assert.ok(schedule.levelPopAt < schedule.levelSwitchAt, '先放大再换字');
    assert.equal(levelScaleAt(schedule, schedule.levelPopAt), 1, '起跳瞬间还是原大');
    assert.ok(Math.abs(levelScaleAt(schedule, schedule.levelSwitchAt) - LEVEL_POP_SCALE) < 1e-9,
        `换字那一刻应正好是峰值 ${LEVEL_POP_SCALE}，实际 ${levelScaleAt(schedule, schedule.levelSwitchAt)}`);
    assert.equal(levelScaleAt(schedule, schedule.levelSettleEnd), 1, '回弹结束必须精确回到 1');
    // 峰值之后会过冲：中途有过比 1 小的值，才算「落下时带弹」
    let dipped = false;
    for (let t = schedule.levelSwitchAt; t <= schedule.levelSettleEnd; t += 0.01) {
        if (levelScaleAt(schedule, t) < 1) dipped = true;
    }
    assert.ok(dipped, '回弹要有一点过冲（看出「弹回来」），不能是单调收敛');
});

// ============================================================
// ② 同步：只有一份刷光进度
// ============================================================

test('三条刷光带共用同一份进度，但各扫各的框（不是一个大的刷光）', () => {
    assert.equal(schedule.valueSwitchAt, schedule.shineEnd,
        '「刷光动画结束，数值直接切换」⇒ 换值时刻必须就是刷光结束时刻');
    assert.equal(Math.round((schedule.shineEnd - schedule.shineStart) * 1000) / 1000, SHINE_DURATION);
    assert.ok(schedule.progressSettleAt > schedule.valueSwitchAt, '换档是刷光之后的事');

    // 刷光窗口内只有一个 0..1，窗口外一律 -1（视图据此把亮度归零）
    assert.equal(shineProgressAt(schedule, schedule.shineStart - 0.01), -1);
    assert.equal(shineProgressAt(schedule, schedule.shineStart), 0);
    assert.equal(shineProgressAt(schedule, schedule.shineEnd - 1e-6) > 0.99, true);
    assert.equal(shineProgressAt(schedule, schedule.shineEnd), -1);

    // 端到端包络：两端必须淡到 0，否则光带会在边缘「凭空出现 / 突然消失」
    assert.equal(shineOpacityAt(-1), 0);
    assert.equal(shineOpacityAt(0), 0);
    assert.equal(shineOpacityAt(1), 0);
    assert.equal(shineOpacityAt(0.5), 1);

    // 视图侧：所有光带都读同一个 shine 值，不许自己再算一遍
    assert.match(pageSource, /const shine = shineProgressAt\(timeline, t\);/,
        '刷光进度必须从时序表取一次');
    assert.match(pageSource, /for \(const streak of this\.shines\) this\.applyShine\(streak, shine\);/,
        '三条光带必须由同一个 shine 值驱动（这就是「所有刷光动画同步」）');
    assert.doesNotMatch(pageSource, /shineProgressAt\([^)]*\)[\s\S]{0,200}shineProgressAt\(/,
        '出现第二处 shineProgressAt 调用就说明有人在给自己算一份时间');

    // 「每个 UI 组件独立」的落点：属性区不再是 720 宽的一条大光带，而是左右框各一条
    assert.doesNotMatch(pageSource, /STATS_AREA_WIDTH/,
        '属性区整体扫光的常量应当已删掉（一条大光带 = 需求要拆掉的那个「大的刷光」）');
    assert.match(pageSource, /private createShineForFrame\(/,
        '左右属性框必须各自按自己的框建光带');
    assert.equal((pageSource.match(/this\.createShineForFrame\(/g) ?? []).length, 2,
        '属性左框、右框各一条：两条，不多不少');
    assert.match(pageSource, /this\.createShineForFrame\(this\.frameLeft, 2\)/);
    assert.match(pageSource, /this\.createShineForFrame\(this\.frameRight, 3\)/);
    // 每条的行程以「自己的框中心」为原点，不再一律从父节点 0 点起；位移过一道缓进快出
    assert.match(pageSource, /const x = streak\.centerX - streak\.travel \/ 2 \+ streak\.travel \* swept;/,
        '光带必须以框中心为原点扫过，否则左框那条会从整体中心开始');
    assert.match(pageSource, /const swept = shineSweepAt\(progress\);/,
        '位移要走缓进快出');
    assert.match(pageSource, /shineOpacityAt\(progress\)/,
        '亮度包络仍按线性进度，别跟着加速一起被压窄');
});

test('进度条：满格 → 顿一拍 → 清空归零 → 绿色从左往右涨到下一级', () => {
    // 满格段：换值之前一路满格（刷光要有东西可刷）。
    assert.equal(progressRatioAt(schedule, 0, 1, 0.5), 1);
    assert.equal(progressRatioAt(schedule, schedule.valueSwitchAt - 1e-6, 1, 0.5), 1,
        '刷光期间必须一直是满格，提前缩下去刷光就没东西可刷');
    // 顿一拍：换值那一刻仍是满格，`PROGRESS_HOLD` 之内不许动 —— 这是「消耗感」的起手。
    assert.equal(progressRatioAt(schedule, schedule.valueSwitchAt, 1, 0.5), 1, '起点不许跳变');
    assert.equal(progressRatioAt(schedule, schedule.valueSwitchAt + PROGRESS_HOLD - 1e-6, 1, 0.5), 1,
        '顿的那一拍里条不许动，否则「原本是满的」这件事玩家没看见');
    // 清空段：满格 → 0，中途必须是过渡值，末尾精确归零。
    const resetMid = progressRatioAt(schedule, schedule.valueSwitchAt + PROGRESS_HOLD + PROGRESS_RESET / 2, 1, 0.5);
    assert.ok(resetMid > 0 && resetMid < 1, `清空段中段必须是过渡值：${resetMid}`);
    assert.equal(progressRatioAt(schedule, schedule.progressResetAt, 1, 0.5), 0,
        '清空段终点必须精确归零 —— 这就是「新的进度条首先是空的」');
    // 涨格段：从 0 单调长到 `to`，也就是「按箭头方向从左往右涨」。
    const growQuarter = progressRatioAt(schedule, schedule.progressResetAt + PROGRESS_GROW / 4, 1, 0.5);
    assert.ok(growQuarter > 0 && growQuarter < 0.5, `涨格段要自 0 长起来：${growQuarter}`);
    assert.ok(Math.abs(progressRatioAt(schedule, schedule.progressSettleAt, 1, 0.5) - 0.5) < 1e-9,
        '涨格终点必须落在下一级的真实比例');
    assert.ok(Math.abs(schedule.progressResetAt - schedule.valueSwitchAt - PROGRESS_HOLD - PROGRESS_RESET) < 1e-6,
        '清空段 = 顿 + 清空');
    assert.ok(Math.abs(schedule.progressSettleAt - schedule.progressResetAt - PROGRESS_GROW) < 1e-6,
        '涨格段紧接在清空之后');

    // 整段「先降后升」：清空段一路下行、涨格段一路上行，中间不许反复。
    let previous = 1;
    for (let i = 0; i <= 20; i++) {
        const t = schedule.valueSwitchAt + PROGRESS_HOLD + (PROGRESS_RESET * i) / 20;
        const value = progressRatioAt(schedule, t, 1, 0.5);
        assert.ok(value <= previous + 1e-9, `清空段必须单调下行：t=${t} 涨回了 ${value}`);
        previous = value;
    }
    previous = 0;
    for (let i = 0; i <= 20; i++) {
        const t = schedule.progressResetAt + (PROGRESS_GROW * i) / 20;
        const value = progressRatioAt(schedule, t, 1, 0.5);
        assert.ok(value >= previous - 1e-9, `涨格段必须单调上行：t=${t} 掉回了 ${value}`);
        previous = value;
    }

    // 没有可消耗的空间就不演换档（满级 / `to >= from`）：否则会读成「升级把进度条洗了一遍」。
    assert.equal(progressRatioAt(schedule, schedule.progressSettleAt, 0.4, 1), 0.4);
    assert.equal(progressRatioAt(schedule, schedule.progressResetAt, 0.4, 0.4), 0.4);

    // 时长：清空要快（消耗的结果），涨格要够长（让人看清终点）。
    assert.ok(PROGRESS_RESET > 0 && PROGRESS_RESET <= 0.25, `清空太拖：${PROGRESS_RESET}`);
    assert.ok(PROGRESS_GROW >= 0.5, `涨格太快，看不出从左往右：${PROGRESS_GROW}`);
    assert.ok(PROGRESS_HOLD > 0, '换档前要有一拍顿');

    // 视图里宽度只由常量 × 比例得出
    assert.match(pageSource, /const FILL_TRACK_WIDTH = 436;/, '满格宽度基准丢了，比例就无从算起');
    assert.match(pageSource, /FILL_TRACK_WIDTH \* progressRatioAt\(/, '宽度必须由时序表比例乘出来');
});

test('数量文字跟着条走：换档当拍归零，涨格结束才显示新值', () => {
    assert.equal(progressZeroTextOf('40/80'), '0/80');
    assert.equal(progressZeroTextOf('0/78'), '0/78');
    assert.equal(progressZeroTextOf(''), '', '空串不许造出「0」这种半截文字');
    assert.equal(progressZeroTextOf(undefined), '');
    assert.equal(progressZeroTextOf('40'), '', '没有分母就不改文字');

    // 视图侧：两个端点各切一次，中间不逐帧插值（否则 0→40 之间会闪一串读数）。
    assert.match(pageSource, /const zero = progressZeroTextOf\(content\.nextProgressText\);/);
    assert.match(pageSource, /if \(zero\) this\.progressLabel\.string = zero;/);
    assert.match(pageSource, /if \(!this\.progressGrown && t >= timeline\.progressSettleAt\)/,
        '涨格结束那一拍要换成新值');
    assert.match(pageSource, /if \(next\) this\.progressLabel\.string = next;/);
});

test('进度条起点恒取满格：别再靠消耗行探测起点', () => {
    // 2026-11-20 用户：「升级的碎片进度动画在切换后，是从左往右填充」。
    // 探测式起点（`consumedRow` 在不在）一旦落空，`from` 就退化成下一级的真实比例：
    // 轻则 `from == to`、条完全不动，重则配合刷光读成「条自己在从左往右长」。
    // 能走到成功弹窗就说明本次是「攒够了才升」的，满格才是那一刻的事实。
    assert.match(controllerSource, /const progressTo = nextNeed > 0 \? nextRatio : ratio;/);
    assert.match(controllerSource, /const progressFrom = progressTo < 1 \? 1 : ratio;/,
        '起点必须是满格');
    assert.match(controllerSource, /progressRatio: progressFrom,/,
        '传给弹窗的比例必须是满格起点，不是当级的真实比例');
    assert.match(controllerSource, /progressText: trackNeed > 0 \? `\$\{trackOwned\}\/\$\{trackNeed\}` : ''/,
        '文字必须与条同源：起点满格时写 need/need，别写真实持有数');
});

test('数量文字在换数那一拍弹一下，收工回正', () => {
    // 条在缩短的同时数字动一下，才读得出「碎片被扣掉了」。
    assert.equal(progressPopScaleAt(schedule, schedule.valueSwitchAt - 1e-6), 1);
    assert.equal(progressPopScaleAt(schedule, schedule.valueSwitchAt), 1, '起点不跳变');
    const peak = Math.max(...[0.02, 0.05, 0.08, 0.1].map((d) => progressPopScaleAt(schedule, schedule.valueSwitchAt + d)));
    assert.ok(peak > PROGRESS_POP_SCALE - 1e-6, `弹跳峰值太小，看不出来：${peak}`);
    assert.ok(peak <= PROGRESS_POP_SCALE + 1e-9);
    assert.equal(progressPopScaleAt(schedule, schedule.progressSettleAt), 1, '弹完必须回正，别一直撑着');

    assert.match(pageSource, /const scale = progressPopScaleAt\(timeline, t\);/);
    assert.match(pageSource, /this\.progressLabel\.node\.setScale\(scale, scale, 1\);/);
    assert.match(pageSource, /if \(this\.progressLabel && this\.progressLabel\.isValid\) this\.progressLabel\.node\.setScale\(1, 1, 1\);/,
        '收工时要把数量文字的缩放回正，否则下次打开带着上一拍的缩放');
});

test('整条时间轴单调、有限，且终点收在最后一段动画之后', () => {
    // 特响起播刻意在「立绘落位」那一拍，此时后面两块还在滑 —— 所以它不与 entranceEnd 比先后。
    const chain = [
        'levelPopAt', 'levelSwitchAt', 'levelSettleEnd',
        'shineStart', 'shineEnd', 'valueSwitchAt', 'progressResetAt', 'progressSettleAt', 'end',
    ] as const;
    let previous = schedule.entranceEnd;
    for (const key of chain) {
        const value = schedule[key];
        assert.ok(Number.isFinite(value), `${key} 不是有限数：${value}`);
        assert.ok(value >= previous, `${key}=${value} 早于上一拍 ${previous}`);
        previous = value;
    }
    assert.ok(schedule.end >= Math.max(schedule.progressSettleAt, schedule.fxEnd));
    assert.ok(schedule.fxEnd > schedule.fxAt, '特效要有正时长');
});

// ============================================================
// ③ 升级特效资源（spine `ddz_cj_nextlevel`）
// ============================================================

test('特效预制：单节点 sp.Skeleton、绑 ddz_cj_nextlevel、播 1 次不自播', () => {
    assert.ok(existsSync(FX_PREFAB), '缺少 CardUpgradeFx.prefab');
    const fx = JSON.parse(readFileSync(FX_PREFAB, 'utf8')) as Array<Record<string, any>>;
    const nodes = fx.filter((item) => item.__type__ === 'cc.Node');
    assert.equal(nodes.length, 1, '特效预制只该有一个节点（sp.Skeleton 直接挂根节点）');
    const root = nodes[0];
    const components = (root._components as { __id__: number }[]).map((ref) => fx[ref.__id__]);
    assert.equal(components.filter((item) => item.__type__ === 'cc.Sprite').length, 0,
        '旧序列帧的 Sprite 必须摘掉，否则新特效底下还压着一张旧图');
    assert.equal(components.filter((item) => item.__type__ === 'cc.Animation').length, 0,
        '旧序列帧的 Animation 必须摘掉，否则页面拿 sp.Skeleton 之外的组件起播');

    const skeleton = components.find((item) => item.__type__ === 'sp.Skeleton');
    assert.ok(skeleton, '根节点缺 sp.Skeleton');
    assert.equal(skeleton.defaultAnimation, FX_ANIMATION, '默认动画必须指向骨骼里那条 1.0s 动画');
    assert.equal(skeleton.loop, false, '只播 1 次（升级特效播完就停）');
    assert.notEqual(skeleton.playOnLoad, true, '不许实例化就自播，起播时刻由时间轴给');

    const skelMeta = JSON.parse(readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.skel.meta`, 'utf8'));
    assert.equal(skeleton._skeletonData.__uuid__, skelMeta.uuid, 'SkeletonData 引用与 skel.meta 对不上');
    assert.equal(skeleton._skeletonData.__expectedType__, 'sp.SkeletonData');
    assert.ok(!('uuid' in skeleton._skeletonData),
        '引用必须落成 __uuid__：写成 {uuid} 反序列化会读成 null，运行时整条特效空白且零报错');

    assert.equal(root._layer, 33554432, 'layer 必须 UI_2D，落 DEFAULT 在 UI 相机下整棵不渲染');
    assert.equal(root._lscale.x, FX_SCALE);
    assert.equal(root._lscale.y, FX_SCALE);
    assert.equal(root._lscale.z, 1);

    const transform = components.find((item) => item.__type__ === 'cc.UITransform');
    assert.ok(transform, '缺 cc.UITransform');
    assert.equal(transform._contentSize.width, FX_CANVAS.width);
    assert.equal(transform._contentSize.height, FX_CANVAS.height);
    // 锚点由 Cocos 按骨骼 bounds 反算；`FX_DROP_PX` 的推导依赖这两个数，换图必须重算
    assert.ok(Math.abs(transform._anchorPoint.x - FX_CANVAS.anchorX) < 1e-9,
        `锚点 x 变了（骨骼 bounds 换过？）：${transform._anchorPoint.x}`);
    assert.ok(Math.abs(transform._anchorPoint.y - FX_CANVAS.anchorY) < 1e-9,
        `锚点 y 变了（骨骼 bounds 换过？）：${transform._anchorPoint.y}`);
});

test('骨骼资源：png/skel/atlas 同目录、atlas 22 个区域齐全、png 走 sprite-frame', () => {
    for (const ext of ['.png', '.skel', '.atlas.txt']) {
        assert.ok(existsSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}${ext}`), `缺少 ${FX_SKEL_NAME}${ext}`);
    }
    const skelMeta = JSON.parse(readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.skel.meta`, 'utf8'));
    const atlasMeta = JSON.parse(readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.atlas.txt.meta`, 'utf8'));
    assert.equal(skelMeta.userData.atlasUuid, atlasMeta.uuid, '.skel.meta 必须绑到同名的 .atlas.txt');
    const pngMeta = JSON.parse(readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.png.meta`, 'utf8'));
    assert.equal(pngMeta.userData.type, 'sprite-frame');
    assert.equal(pngMeta.userData.hasAlpha, true, '特效图必须带 alpha，否则图集是黑底');
    assert.equal(pngMeta.userData.fixAlphaTransparencyArtifacts, false);

    const atlas = readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.atlas.txt`, 'utf8').split(/\r?\n/);
    const regions = atlas.filter((line) => line.length > 0
        && !/^\s/.test(line) && !line.includes(':') && !/\.png$/i.test(line));
    assert.equal(regions.length, FX_ATLAS_REGIONS, `atlas 区域数变了：${regions.length}`);

    // 骨骼（二进制）里引用到的贴图名必须都能在 atlas 里找到，缺一张就是「播到一半闪空、控制台零报错」。
    // slot 表里还留着 `images/cj_dz_glow4` / `glow5` 两个历史名（不是区域名，实际挂的是 glow04），
    // 所以这里只校验真正按编号取的区域引用。
    const skelText = readFileSync(`${FX_SKEL_DIR}/${FX_SKEL_NAME}.skel`, 'latin1');
    const referenced = new Set(skelText.match(/images\/[A-Za-z0-9_]+/g) ?? []);
    const numbered = [...referenced].filter((name) => /^images\/(lizi_\d+|cj_dz_glow0\d)$/.test(name));
    const missing = numbered.filter((name) => !regions.includes(name));
    assert.deepEqual(missing, [], `骨骼引用了 atlas 里没有的区域：${missing.join(', ')}`);
    assert.equal(numbered.filter((name) => /lizi_/.test(name)).length, 18, '光丝应该是 18 帧');
    assert.equal(numbered.filter((name) => /glow0/.test(name)).length, 4, '光层应该是 4 张');
});

test('刷光条贴图存在且已登记到 main-pages 分包（漏了会落回 resources 报 Bundle doesn\'t contain）', () => {
    const shine = `${FRAME_DIR}/shine.png`;
    assert.ok(existsSync(shine), '缺少刷光条贴图 shine.png');
    assert.ok(existsSync(`${shine}.meta`), '缺少 shine.png.meta');
    assert.match(pageSource, /const SHINE_FRAME_PATH = 'image\/card_effect_levelup\/shine\/spriteFrame';/,
        '页面里的刷光条路径改了要同步这张用例');
    assert.equal(bundleForPath('image/card_effect_levelup/shine'), MAIN_PAGES_BUNDLE,
        'image/card_effect_levelup 没登记进 BUNDLE_DIRECTORIES');
    assert.ok(BUNDLE_DIRECTORIES[MAIN_PAGES_BUNDLE].includes('image/card_effect_levelup'));
});

// ============================================================
// ④ 装配：层级、数据、收尾
// ============================================================

test('特效压在角色上层、其它板块下层：紧跟立绘后一格插入', () => {
    assert.match(pageSource, /host\.insertChild\(node, Math\.min\(heroNode\.getSiblingIndex\(\) \+ 1, host\.children\.length\)\)/,
        '特效必须插在立绘的下一格：既压在角色上，又不盖住等级/属性/头部');
    // 特效原点不在矩形中心（spine 按 bounds 反算锚点），落位仍是「脚底再下移 FX_DROP_PX」
    assert.match(pageSource, /const footY = position\.y - \(transform \? transform\.height \* transform\.anchorY : 0\);/);
    assert.match(pageSource, /node\.setPosition\(position\.x, footY - FX_DROP_PX, 0\);/,
        '特效必须相对脚底再下移 FX_DROP_PX，否则光爆中心会跑到角色胸口以上');
    assert.match(pageSource, /export const FX_DROP_PX = 70;/, '下移量按需求取 70px');
    // 内容层里 Hero 之上还有 Stats/Level/Header/Bonus（层级顺序不能反）
    const content = nodeNamed('Content');
    const order = (content._children as { __id__: number }[]).map((ref) => prefab[ref.__id__]._name);
    assert.ok(order.indexOf('Hero') < order.indexOf('Stats'), 'Hero 必须在 Stats 之下');
    assert.ok(order.indexOf('Hero') < order.indexOf('Header'), 'Hero 必须在 Header 之下');
});

test('旧值/新值都在数据里：等级、属性、下一级材料，缺一项就少一段动画', () => {
    for (const field of ['previousLevelText', 'previousHpValue', 'previousAttackValue', 'nextProgressText', 'nextProgressRatio']) {
        assert.match(controllerSource, new RegExp(`${field}:`), `控制器没带 ${field}，对应那段动画会退化`);
        assert.match(
            readFileSync('assets/script/app/card/CardUpgradedPresentation.ts', 'utf8'),
            new RegExp(`${field}\\?:`),
            `ICardUpgradedContent 缺可选字段 ${field}`,
        );
    }
    // 满级升级用例直接验证提交前与刷新后属性，以及本次实际展示的增量。
    // 旧等级来自提交前的状态
    assert.match(controllerSource, /previousLevelText: consumed && consumed\.level > 0 \? `\$\{consumed\.level\}级` : undefined/);
});

test('逐帧回调在关闭/停用/销毁都收干净，且全程不建 cc.tween', () => {
    assert.match(pageSource, /protected onClose\(\): void \{\s*this\.stopAnimation\(\);/);
    assert.match(pageSource, /onDisable\(\): void \{\s*this\.stopAnimation\(\);/);
    assert.match(pageSource, /this\.unschedule\(this\.stepAnim\);/);
    assert.match(pageSource, /this\.schedule\(this\.stepAnim, 0\);/);
    assert.doesNotMatch(pageSource, /\btween\s*\(/, '弹窗节点会进对象池，tween 回收后还会跑到别人的节点上');
    // 资源作用域一换，刷光条 / 特效节点必须跟着销毁（否则 Batcher2D 拿到已释放的帧）
    assert.match(pageSource, /public _internalReleaseResources\(\): void \{\s*this\.destroyAnimationVisuals\(\);/);
    assert.match(pageSource, /this\.unschedule\(this\.stepAnim\);\s*this\.timeline = null;/);
});

test('预制体把三块入场节点都接上了（没接 = 那一块不参与入场）', () => {
    const composite = prefab.find((item) => String(item.__type__) === '55265S19GxIKKw8Zue0lnet');
    assert.ok(composite, '找不到 CardUpgradedPage 组件');
    for (const [field, name] of [['headerRoot', 'Header'], ['levelRoot', 'Level'], ['statsRoot', 'Stats']] as const) {
        const id = composite[field]?.__id__;
        assert.ok(typeof id === 'number', `组件缺 ${field}`);
        assert.equal(prefab[id]._name, name, `${field} 指向的不是 ${name}`);
    }
});

// ============================================================
// ⑤ 三改：刷光缓进快出 + 打开时不再等资源
// ============================================================

test('刷光位移缓进快出：前段慢、后段快，两头锚在 0 / 1', () => {
    assert.ok(SHINE_SWEEP_EASE > 1, '指数 ≤1 就不是缓进快出了');
    assert.equal(shineSweepAt(0), 0);
    assert.equal(shineSweepAt(1), 1);
    assert.equal(shineSweepAt(-1), 0, '越界要收敛，别让光带跑出框');
    assert.equal(shineSweepAt(2), 1);
    assert.ok(shineSweepAt(0.5) < 0.5, '中点的位移必须还没到半程（前半段走得慢）');

    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
        const value = shineSweepAt(p);
        assert.ok(value >= previous, `位移进度必须单调：p=${p}`);
        previous = value;
    }
    const firstHalf = shineSweepAt(0.5) - shineSweepAt(0);
    const secondHalf = shineSweepAt(1) - shineSweepAt(0.5);
    // 1.8 次幂时前半程只走 28.7%、后半程 71.3%（≈2.5 倍速度），这就是「缓进快出」的量感。
    assert.ok(secondHalf > firstHalf * 2.3, '后半程要明显更快，才看得见「快出」');
});

test('打开弹窗：先落数据再等资源，样例文案（椰蛋战士）不许停在屏幕上', () => {
    const start = pageSource.indexOf('protected onOpen(');
    assert.ok(start > 0, '找不到 onOpen');
    const body = pageSource.slice(start, pageSource.indexOf('protected onClose('));
    const renderAt = body.indexOf('this.render(userData);');
    const loadAt = body.indexOf('loadAnimationAssets()');
    assert.ok(renderAt > 0, 'onOpen 里必须同步 render —— 否则 prefab 自带的样例文案会停在屏幕上');
    assert.ok(loadAt > 0);
    assert.ok(renderAt < loadAt, 'render 必须排在启动资源加载之前（同一拍也行，别等完再画）');
    assert.doesNotMatch(body, /await this\.loadAnimationAssets\(\)/,
        'onOpen 不许 await 资源：PopupManager 会等这个 Promise，弹窗就「可交互」得更晚');
    assert.match(body, /if \(!this\.alive\) return;/, '迟到的资源回调必须先查存活');
    assert.match(body, /this\.ensureShines\(\);/, '资源到齐后要补建刷光带');

    // 特效资源晚到也要能补播：门闩只在真的播成之后才置位
    assert.match(pageSource, /if \(this\.playHeroFx\(\)\) this\.fxStarted = true;/,
        '资源没到就置门闩 ⇒ 这次特效直接丢掉');
    assert.match(pageSource, /else if \(t >= timeline\.fxAt \+ FX_RETRY_WINDOW\) this\.fxStarted = true;/,
        '重试要有窗口，别每帧空转');
});

// ============================================================
// ⑥ 刷光样式优化（2026-11-24）：本体发光 + 边缘发光 + 光柱加宽三色
// ============================================================

test('发光包络：三处发光共用同一个梯形，只是起落快慢不同', () => {
    // 端点必须收敛到 0：不收敛就是「凭空亮起 / 突然熄灭」
    for (const [name, fn] of [['光柱', shineOpacityAt], ['本体', heroGlowAt], ['边缘', barGlowAt]] as const) {
        assert.equal(fn(-1), 0, `${name}：没有刷光时必须全灭`);
        assert.equal(fn(0), 0, `${name}：起手那一帧不许跳亮`);
        assert.equal(fn(1), 0, `${name}：收手那一帧必须归零`);
        assert.equal(fn(0.5), 1, `${name}：中段必须是满亮`);
        assert.equal(fn(2), 0, `${name}：越界要收敛`);
    }
    // 起手快慢：边缘光最快、本体其次、光柱最慢（0.1 处本体已经亮过七成，光柱才一半）
    assert.ok(barGlowAt(0.05) > heroGlowAt(0.05), '边缘光要比本体起得快');
    assert.ok(heroGlowAt(0.05) > shineOpacityAt(0.05), '本体要比光柱起得快');
    // 收尾：本体/边缘是「缓落」，尾段比光柱暗（光柱是最后 18% 才猛掉，本体从 55% 就开始慢慢收）
    assert.ok(heroGlowAt(0.9) > 0 && heroGlowAt(0.9) < shineOpacityAt(0.9), '尾段本体是余辉，不是跟着光柱一起硬掉');
    assert.ok(barGlowAt(0.95) > heroGlowAt(0.95), '边缘光拖得最久');

    // 单调：进段升、出段降，中间不许回头
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.02) {
        const peak = Math.max(shineOpacityAt(p), heroGlowAt(p), barGlowAt(p));
        assert.ok(peak >= 0 && peak <= 1, `包络越界：p=${p} → ${peak}`);
        if (p <= 0.5) {
            assert.ok(heroGlowAt(p) >= previous - 1e-9, `本体进段必须单调：p=${p}`);
            previous = heroGlowAt(p);
        }
    }
    // 退化入参（淡入淡出占比 0）不许算出 NaN
    assert.ok(Number.isFinite(shineEnvelopeAt(0.5, 0, 0)));
    assert.equal(shineEnvelopeAt(0.5, 0, 0), 1);
});

test('进度条光柱：三层同轴、逐层收窄，色相由绿黄收到白热', () => {
    // 「光柱宽度增加」：改前是单层 120 宽，最外层必须明显更宽
    assert.ok(PROGRESS_BEAM_LAYERS.length >= 2, '要做出渐变至少两层');
    assert.ok(PROGRESS_BEAM_LAYERS[0].width >= 180,
        `最外层只有 ${PROGRESS_BEAM_LAYERS[0].width} 宽，读起来还是「一条细白线」`);
    // 最外层必须是径向柔光：`shine.png` 竖直方向没有渐变，撑高只会得到硬边矩形
    assert.equal(PROGRESS_BEAM_LAYERS[0].frame, 'glow', '最外层要用径向柔光，光柱上下两端才是软的');

    for (let i = 1; i < PROGRESS_BEAM_LAYERS.length; i++) {
        const outer = PROGRESS_BEAM_LAYERS[i - 1];
        const inner = PROGRESS_BEAM_LAYERS[i];
        assert.ok(inner.width < outer.width, `第 ${i} 层没有比外层窄，「渐变」就退化成一块实心`);
        const outerHeight = outer.height === 'area' ? Number.POSITIVE_INFINITY : outer.height;
        const innerHeight = inner.height === 'area' ? Number.POSITIVE_INFINITY : inner.height;
        assert.ok(innerHeight < outerHeight, `第 ${i} 层没有比外层矮`);
        assert.ok(inner.alpha >= outer.alpha - 1e-9, `第 ${i} 层要比外层更实`);
    }

    // 色相：外绿黄 → 内白。`min-max` 差值 = 彩度，彩度必须逐层下降
    const saturation = (rgb: readonly [number, number, number]): number =>
        Math.max(...rgb) - Math.min(...rgb);
    const outermost = PROGRESS_BEAM_LAYERS[0].rgb;
    assert.ok(outermost[1] > outermost[0] && outermost[0] > outermost[2],
        `最外层应是绿黄（g > r > b），实际 ${outermost.join('/')}`);
    assert.ok(outermost[1] - outermost[2] >= 60, `最外层不够「绿黄」：${outermost.join('/')}`);
    const innermost = PROGRESS_BEAM_LAYERS[PROGRESS_BEAM_LAYERS.length - 1].rgb;
    assert.ok(saturation(innermost) <= 16, `最内层应是白热（三通道接近），实际 ${innermost.join('/')}`);
    assert.ok(Math.min(...innermost) >= 230, `最内层不够白：${innermost.join('/')}`);
    for (let i = 1; i < PROGRESS_BEAM_LAYERS.length; i++) {
        assert.ok(saturation(PROGRESS_BEAM_LAYERS[i].rgb) < saturation(PROGRESS_BEAM_LAYERS[i - 1].rgb),
            `第 ${i} 层彩度没有继续收窄，横截面读不出渐变`);
    }
    for (const layer of PROGRESS_BEAM_LAYERS) {
        assert.ok(layer.alpha > 0 && layer.alpha <= 1, `层不透明度越界：${layer.alpha}`);
    }
});

test('属性框光柱：同样三层同轴，但走中性白（框底按品质换色，绿黄会撞）', () => {
    // 2026-11-25 用户：「属性条对要有对应属性样式的刷光效果，和进度刷光同步播放」。
    const saturation = (rgb: readonly [number, number, number]): number =>
        Math.max(...rgb) - Math.min(...rgb);
    assert.ok(SLOT_BEAM_LAYERS.length >= 2, '单层白带压在框上读不出「这道光是为这个框打的」');
    assert.equal(SLOT_BEAM_LAYERS[0].frame, 'glow', '最外层同样要径向柔光，否则上下两端是硬边');
    for (let i = 1; i < SLOT_BEAM_LAYERS.length; i++) {
        assert.ok(SLOT_BEAM_LAYERS[i].width < SLOT_BEAM_LAYERS[i - 1].width, `第 ${i} 层没有比外层窄`);
        assert.ok(SLOT_BEAM_LAYERS[i].alpha > SLOT_BEAM_LAYERS[i - 1].alpha, `第 ${i} 层没有比外层更实`);
    }
    // 🔴 关键：**中性白**。属性框底图按品质换色（金 / 蓝 / 紫 / 绿），彩度一高就会和金蓝紫框撞色。
    for (const layer of SLOT_BEAM_LAYERS) {
        assert.ok(saturation(layer.rgb) <= 16,
            `属性框光柱必须是中性白，实际 ${layer.rgb.join('/')}（彩度 ${saturation(layer.rgb)}）`);
        assert.ok(Math.min(...layer.rgb) >= 230, `属性框光柱不够白：${layer.rgb.join('/')}`);
    }
    // 主带贴框高（271×65 的属性框），换 prefab 尺寸不用回头改数字
    assert.equal(SLOT_BEAM_LAYERS[1].height, 'area', '主带高度要跟着框走，别钉死数字');
    // 最宽那层要明显比改前的 96 宽（那版一闪就没了），但别宽到盖住隔壁那个框
    assert.ok(SLOT_BEAM_LAYERS[0].width >= 120 && SLOT_BEAM_LAYERS[0].width <= 200,
        `外晕 ${SLOT_BEAM_LAYERS[0].width} 宽：太窄读不出光，太宽会糊到隔壁属性框`);
});

test('光柱按分层建节点：三层挂在同一个父节点上，位移只写父节点、亮度逐层写', () => {
    assert.match(pageSource, /for \(const spec of specs\) \{/, '必须按分层表逐层建 Sprite');
    assert.match(pageSource, /const layerHeight = spec\.height === 'area' \? height : spec\.height;/,
        "'area' 要落到目标区高度上");
    assert.match(pageSource, /layers\.push\(\{ sprite, opacity: layerOpacity, spec \}\);/);
    // 三层同轴：层节点都在父节点原点，位置只由父节点写 ⇒ 不可能各扫各的
    assert.match(pageSource, /layerNode\.setPosition\(0, 0, 0\);/);
    assert.match(pageSource, /const x = streak\.centerX - streak\.travel \/ 2 \+ streak\.travel \* swept;/);
    // 行程按最宽那层算：窄层要跟着宽层一起进出框
    assert.match(pageSource, /const streakWidth = specs\.reduce\(\(widest, spec\) => Math\.max\(widest, spec\.width\), 0\);/);
    // 层的相对亮度写在 sprite 颜色上，包络再乘到每层自己的 UIOpacity 上
    assert.match(pageSource, /sprite\.color = new Color\(spec\.rgb\[0\], spec\.rgb\[1\], spec\.rgb\[2\], Math\.round\(255 \* spec\.alpha\)\);/);
    assert.match(pageSource, /private applyShineAlpha\(streak: IShineStreak, byte: number\): void \{/);
    assert.match(pageSource, /if \(layer\.opacity\.isValid && layer\.opacity\.opacity !== byte\) layer\.opacity\.opacity = byte;/,
        '同一拍的亮度要写到每一层：三层的相对亮度靠 sprite 颜色区分，包络必须一致');
});

test('角色本体发光：剪影副本挂在立绘上、与本体锁相、放大一点点', () => {
    const preview = previewSource;
    // shader 只采样 alpha、输出顶点色 ⇒ 顶点色 = 纯色剪影（与巡逻宝箱 `ChestWhite` 同一套路）
    assert.match(pageSource, /const GLOW_COPY_SHADER_PATH = 'shaders\/unit-outline-copy';/);
    assert.ok(existsSync('assets/resources/shaders/unit-outline-copy.effect'),
        'shader 文件不在，本体发光会静默降级成「只有光晕」');
    assert.match(preview, /skeleton\.customMaterial = material;/);
    assert.match(preview, /skeleton\.premultipliedAlpha = true;/,
        'shader 按预乘口径输出（同 `ZCUnitView.attachOutlineCopy`），别依赖 prefab 上的勾选');
    // 放大一点点：同形状大一圈 ⇒ 那一圈就是外缘辉光
    assert.match(preview, /const GLOW_COPY_SCALE = 1\.0[0-9]+;/);
    assert.match(preview, /glow\.setScale\(scale\.x \* GLOW_COPY_SCALE/);
    // 骨架原点在脚底 ⇒ 绕原点放大等于「头顶白一坨、脚下不动」；要挪成绕中部才是四周等宽
    assert.match(preview, /const halfHeight = this\.sourceHeight \* Math\.abs\(scale\.y\) \* 0\.5;/);
    assert.match(preview, /const lift = Number\.isFinite\(halfHeight\) \? halfHeight \* \(GLOW_COPY_SCALE - 1\) : 0;/);
    assert.match(preview, /glow\.setPosition\(visual\.position\.x, visual\.position\.y - lift, visual\.position\.z\);/);
    // 颜色是白中带绿黄（用户：「颜色依旧使用与进度相似的白色或绿黄色」）
    assert.match(pageSource, /const HERO_GLOW_TINT = new Color\(236, 255, 206, 255\);/);
    // 骨架顶点色是乘算的（只能压暗），所以本体这一层必须是「另起一层纯色剪影」
    assert.match(pageSource, /this\.heroPreview\?\.attachGlow\(material, HERO_GLOW_TINT\)/);
    // 没有骨骼时用静态立绘兜底（同一张图 + 同一份材质）
    assert.match(pageSource, /this\.ensureHeroSpriteGlow\(material\)/);
});

test('剪影同步器由副本骨架持有', () => {
    const glowSource = readFileSync('assets/script/app/card/CardGlowSync.ts', 'utf8');
    assert.equal([...previewSource.matchAll(/@ccclass\(/g)].length, 1, '预览脚本只注册一个 Cocos 组件');
    assert.equal([...glowSource.matchAll(/@ccclass\(/g)].length, 1, '同步脚本只注册一个 Cocos 组件');
    assert.match(glowSource, /@ccclass\('CardGlowSync'\)/);
    assert.match(previewSource, /skeleton\.addComponent\(CardGlowSync\)\.bind\(/);
});


test('进度条边缘发光：柔光压在底条下面，比底条大一圈', () => {
    // 底条 442×32 ⇒ 光层 480×64：露在轮廓外那一圈才是「边缘在发光」
    assert.match(pageSource, /const BAR_GLOW_SIZE = \{ width: 480, height: 64 \} as const;/);
    assert.match(pageSource, /parent\.insertChild\(node, 0\);/, '边缘光必须插在底条之前（在它下面）');
    assert.match(pageSource, /const BAR_GLOW_X = -3;/,
        '底条在容器里不是正中（442 装在 450 里），光层要跟着它');
    assert.match(pageSource, /sprite\.color = new Color\(BAR_GLOW_TINT\.r, BAR_GLOW_TINT\.g, BAR_GLOW_TINT\.b, 255\);/);
    // 光晕在立绘**前一格**：托住角色，又不盖住等级/属性/头部
    assert.match(pageSource, /host\.insertChild\(node, Math\.min\(heroNode\.getSiblingIndex\(\), host\.children\.length\)\);/);
    assert.match(pageSource, /const HERO_HALO_SCALE = 1\.25;/);
});

test('三处发光都吃同一份刷光进度，收工归零、换作用域销毁', () => {
    assert.match(pageSource, /this\.applyHeroGlow\(heroGlowAt\(shine\)\);/);
    assert.match(pageSource, /this\.applyBarGlow\(barGlowAt\(shine\)\);/);
    assert.doesNotMatch(pageSource, /shineProgressAt\([^)]*\)[\s\S]{0,400}shineProgressAt\(/,
        '发光层不许自己再算一份刷光时间（第二套时间轴 = 不同步）');
    // 收工：两处亮度都要归零，否则下次打开带着上一次的余辉
    assert.match(pageSource, /this\.applyHeroGlow\(0\);\s*this\.applyBarGlow\(0\);/);
    // 作用域重建：边缘光 / 光晕 / 剪影副本 / 材质全部销毁
    assert.match(pageSource, /if \(this\.barGlow && this\.barGlow\.isValid\) this\.barGlow\.destroy\(\);/);
    assert.match(pageSource, /if \(this\.heroHalo && this\.heroHalo\.isValid\) this\.heroHalo\.destroy\(\);/);
    assert.match(pageSource, /this\.heroPreview\?\.clearGlow\(\);/);
    assert.match(pageSource, /this\.glowMaterial = null;/);
    // 柔光帧与剪影 shader 都在 main-pages / resources 里登记过（漏了就是「不显示 + 零报错」）
    assert.ok(existsSync('assets/bundles/main-pages/image/showReward/sr_glow.png'));
    assert.match(pageSource, /const GLOW_FRAME_PATH = 'image\/showReward\/sr_glow\/spriteFrame';/);
    assert.equal(bundleForPath('image/showReward/sr_glow'), MAIN_PAGES_BUNDLE);
    assert.ok(BUNDLE_DIRECTORIES[MAIN_PAGES_BUNDLE].includes('image/showReward'));
});
