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
 *  ③ **资源**：15 帧与磁盘上的 `007-2-run_loop_05..19` 一一对应、不循环、不自播，
 *     且序列帧必须关掉 trimmed（每帧 trim 尺寸不同，开着整柱会逐帧抖）；
 *  ④ **装配**：特效在立绘上层且压在角色中心（下移 `FX_DROP_PX`）、旧值/新值都由控制器带进来、
 *     逐帧回调在关闭时收干净。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
    ENTRANCE_BLOCK_COUNT,
    ENTRANCE_DIRECTIONS,
    ENTRANCE_DURATION,
    ENTRANCE_TRAVEL,
    FX_DURATION,
    FX_FRAME_COUNT,
    LEVEL_POP_SCALE,
    PROGRESS_GROW,
    PROGRESS_HOLD,
    PROGRESS_POP_SCALE,
    PROGRESS_RESET,
    SHINE_DURATION,
    SHINE_SWEEP_EASE,
    buildCardUpgradedSchedule,
    entranceDirectionAt,
    entranceOffsetAt,
    levelScaleAt,
    progressPopScaleAt,
    progressRatioAt,
    progressZeroTextOf,
    shineOpacityAt,
    shineProgressAt,
    shineSweepAt,
} from '../assets/script/app/card/CardUpgradedTimeline.ts';
import { BUNDLE_DIRECTORIES, MAIN_PAGES_BUNDLE, bundleForPath } from '../assets/script/core/asset/BundleCatalog.ts';

const schedule = buildCardUpgradedSchedule();
const pageSource = readFileSync('assets/script/app/card/CardUpgradedPage.ts', 'utf8');
const controllerSource = readFileSync('assets/script/app/card/CardUpgradeController.ts', 'utf8');

const PRE_FAB = 'assets/bundles/main-pages/ui/card/CardUpgraded.prefab';
const FX_PREFAB = 'assets/bundles/main-pages/ui/card/CardUpgradeFx.prefab';
const FX_ANIM = 'assets/bundles/main-pages/ui/card/anim/CardUpgradeFx.anim';
const FRAME_DIR = 'assets/bundles/main-pages/image/card_effect_levelup';

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

test('入场一结束就落位；特效在立绘落位那一拍起播', () => {
    for (const { index } of entranceBlocks) {
        assert.equal(entranceOffsetAt(schedule, schedule.entranceEnd, index), 0,
            `第 ${index} 块在 entranceEnd 必须正好归零`);
    }
    // 立绘是第 2 块（序号 1），它落位 = 自己的起播（现在都是 0）+ 时长
    const heroLand = schedule.entrance[1] + ENTRANCE_DURATION;
    assert.ok(schedule.fxAt >= heroLand,
        `特效 ${schedule.fxAt}s 早于立绘落位 ${heroLand}s —— 会在滑行途中就炸开`);
    assert.ok(schedule.fxAt - heroLand < 0.2, '落位到起播之间不要拖太久');
    assert.equal(schedule.fxEnd - schedule.fxAt, FX_DURATION, '特效时长必须等于序列帧时长');
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
    assert.match(pageSource, /this\.createShineForFrame\(this\.frameLeft, 2,/);
    assert.match(pageSource, /this\.createShineForFrame\(this\.frameRight, 3,/);
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
// ③ 序列帧特效资源
// ============================================================

test('特效预制：不自播、关 trimmed、挂在 Sprite 上、引用同一份动画片段', () => {
    assert.ok(existsSync(FX_PREFAB), '缺少 CardUpgradeFx.prefab');
    const fx = JSON.parse(readFileSync(FX_PREFAB, 'utf8')) as Array<Record<string, any>>;
    const root = fx[1];
    const components = (root._components as { __id__: number }[]).map((ref) => fx[ref.__id__]);
    const sprite = components.find((item) => item.__type__ === 'cc.Sprite');
    const animation = components.find((item) => item.__type__ === 'cc.Animation');
    assert.ok(sprite, '根节点缺 cc.Sprite（序列帧没地方贴）');
    assert.ok(animation, '根节点缺 cc.Animation');
    assert.equal(animation.playOnLoad, false, '必须由页面在时间轴上显式 play，不许实例化就自播');
    assert.equal(sprite._sizeMode, 0, '尺寸必须走 CUSTOM，按 772×2214 原图算');
    assert.equal(sprite._isTrimmedMode, false,
        '15 帧的 trim 尺寸各不相同，开着 trimmed 会让整柱逐帧抖动');
    assert.equal(sprite._type, 0, '简单图，不要九宫格');

    const clipUuid = animation._clips[0].__uuid__;
    assert.equal(animation._defaultClip.__uuid__, clipUuid, 'defaultClip 必须与 clips[0] 一致，否则 play() 播空');
    const clipMeta = JSON.parse(readFileSync(FX_ANIM + '.meta', 'utf8'));
    assert.equal(clipMeta.uuid, clipUuid, '预制引用的动画片段 uuid 与 .anim.meta 对不上');

    // 锚点在底边：光柱立在角色脚下往上长
    const transform = components.find((item) => item.__type__ === 'cc.UITransform');
    assert.equal(transform._anchorPoint.y, 0, '锚点要在底边，否则光柱会以中心为原点往上下各长一半');
    assert.equal(transform._contentSize.width, 772);
    assert.equal(transform._contentSize.height, 2214);
});

test('动画片段：15 帧、逐帧引用磁盘上真实的序列帧、播 1 次不循环', () => {
    assert.ok(existsSync(FX_ANIM), '缺少 CardUpgradeFx.anim');
    const clip = JSON.parse(readFileSync(FX_ANIM, 'utf8')) as Record<string, any>;
    assert.equal(clip.__type__, 'cc.AnimationClip');
    assert.equal(clip.sample, 12);
    assert.equal(clip.wrapMode, 1, 'wrapMode 1 = Normal：播 1 次停住（需求要求只播 1 次）');
    assert.equal(clip._duration, FX_DURATION);

    const curve = clip._tracks[0]._channel._curve;
    const path = clip._tracks[0]._binding.path._paths;
    assert.equal(path[0].__type__, 'cc.animation.ComponentPath');
    assert.equal(path[0].component, 'cc.Sprite');
    assert.equal(path[1], 'spriteFrame', '驱动的必须是 Sprite.spriteFrame');

    assert.equal(curve._times.length, FX_FRAME_COUNT);
    assert.equal(curve._values.length, FX_FRAME_COUNT);
    for (let i = 1; i < curve._times.length; i++) {
        assert.ok(curve._times[i] > curve._times[i - 1], `第 ${i} 帧时间没有递增`);
    }

    // 逐帧 uuid == 磁盘上 007-2-run_loop_05..19 的 spriteFrame（顺序也要对）
    const expected = readdirSync(FRAME_DIR)
        .filter((name) => /^007-2-run_loop_\d+\.png\.meta$/.test(name))
        .map((name) => name.replace('.png.meta', ''))
        .sort()
        .map((base) => {
            const meta = JSON.parse(readFileSync(`${FRAME_DIR}/${base}.png.meta`, 'utf8'));
            return `${meta.uuid}@f9941`;
        });
    assert.equal(expected.length, FX_FRAME_COUNT, '磁盘上应该有 15 帧');
    assert.deepEqual(curve._values.map((value: { __uuid__: string }) => value.__uuid__), expected,
        '动画片段的帧序列与磁盘上的 05..19 必须一一对应（错位就是「播到一半闪空」）');
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
    // 光柱立在角色脚下，再整体下移 FX_DROP_PX（二改：让亮芯中心对住角色中心）
    assert.match(pageSource, /const footY = position\.y - \(transform \? transform\.height \* transform\.anchorY : 0\);/);
    assert.match(pageSource, /node\.setPosition\(position\.x, footY - FX_DROP_PX, 0\);/,
        '特效必须相对脚底再下移 FX_DROP_PX，否则光柱全飘在头顶');
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
    // 旧属性必须在 refresh（会换成新等级详情）之前抓
    assert.match(controllerSource, /const previousStats = model\.snapshot\.detail\?\.stats;/);
    assert.ok(controllerSource.indexOf('const previousStats = model.snapshot.detail?.stats;')
        < controllerSource.indexOf('await repository.upgradeHero(model.heroId, this)'),
    '旧属性必须在 upgradeHero 之前抓，否则拿到的是升级后的值，切换就成了「新值切新值」');
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
