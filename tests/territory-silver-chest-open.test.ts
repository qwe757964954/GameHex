import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORY_SILVER_CHEST_POP_PEAK,
    TERRITORY_SILVER_CHEST_POP_SECONDS,
    territorySilverChestIconPop,
} from '../assets/script/app/territory/model/TerritorySilverChestOpen';
import { TERRITORY_SILVER_CHEST_REWARD_ID } from '../assets/script/app/territory/model/TerritoryMapConfig';
import {
    FakeColor,
    makeStationView,
    type StationRenderContent,
} from './helpers/territory-station-fixtures';

/**
 * 「银币宝箱」的**独立**打开动画（2026-11-10）。
 *
 * 用户原话：
 * > 「银币宝箱是独立的打开动画，不要用卡牌宝箱的打开动画，因为他们的图标不一致，
 * >   评估下能否根据现有的图制作类似卡牌碎片宝箱打开序列帧图，可以就开始画图制作动画，
 * >   不行的话就直接播放 icon 放大缩小的消失动画作为银币宝箱的打开动画即可。」
 *
 * **评估结论：做不了同款序列帧**。`tools/gen_chest_open_frames.py` 要的是同一只箱子的
 * 「闭合态 + 开盖态」两张整图；银币宝箱只有 `coinBox.png` 闭合态（没有开盖态 / 箱内衬 /
 * 箱盖内侧 / 分层源文件），`icon_baoxiang` 也只有闭合态。唯一齐全的那对是**黄铜藤蔓箱**
 * （`territory_fixed_resource_v1` + `chest_open_v1`），贴到蓝银金属箱上正是「图标不一致」。
 * ⇒ 采用兜底：icon 放大 → 缩小 → 消失。
 *
 * 这个文件钉四组：① 时间轴纯函数；② 两类宝箱的**配表判据**（别把判据写成「奖励里有没有银币」）；
 * ③ 站点视图的退场行为（快照帧 / 池化复用 / 播完收敛）；④ 分流结构守卫（不进 `playChestOpen`、
 * 奖励当场结算、不接管覆盖层）。
 *
 * ⚠️ 常量一律从**真实模块**取，抄一份数字进来就会变成"改了产品代码、用例还是绿的"。
 */

const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const MAP_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const MODEL_SRC = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
const PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');

/** 带画布尺寸的假帧，让 `applyIconPlacement` 走完整分支（不是「帧缺失」兜底）。 */
const frameA = {
    name: 'coinBox',
    originalSize: { width: 128, height: 128 },
    rect: { width: 100, height: 80 },
    offset: { x: 0, y: 0 },
};
const frameB = { ...frameA, name: 'nextBuilding' };

function content(cellId: number, icon: unknown): StationRenderContent {
    return {
        site: { cellId },
        icon,
        caption: '',
        tint: new FakeColor(255, 255, 255, 255),
        badge: '',
        interactive: false,
    };
}

// ============================================================
// 一、时间轴：1 → 1.3 → 0
// ============================================================

test('pop 曲线：1 → 1.3 → 0，0.4s 收工；非法 / 未起播一律原样', () => {
    const total = TERRITORY_SILVER_CHEST_POP_SECONDS;
    const peak = TERRITORY_SILVER_CHEST_POP_PEAK;
    assert.ok(total > 0 && peak > 1);
    assert.equal(territorySilverChestIconPop(0), 1);
    for (const bad of [-1, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(territorySilverChestIconPop(bad), 1, `${bad} 应回落起播帧（不要先闪一下没了）`);
    }
    assert.equal(territorySilverChestIconPop(total), 0, '到点必须完全消失');
    assert.equal(territorySilverChestIconPop(total + 10), 0);
});

test('pop 曲线：放大段单调增、缩小段单调减，峰值处接合，全程不越界', () => {
    const total = TERRITORY_SILVER_CHEST_POP_SECONDS;
    const peak = TERRITORY_SILVER_CHEST_POP_PEAK;
    // 峰值在 30%（`GROW_PORTION`）处，两段在这里接上，不能有跳变。
    assert.ok(Math.abs(territorySilverChestIconPop(total * 0.3) - peak) < 1e-9);
    assert.ok(Math.abs(territorySilverChestIconPop(total * 0.3000001) - peak) < 1e-6,
        '峰值两侧必须连续，否则会看到一帧跳变');

    let previous = territorySilverChestIconPop(0);
    for (let t = 0.01; t < total * 0.3; t += 0.01) {
        const current = territorySilverChestIconPop(t);
        assert.ok(current > previous, `${t}s 应还在放大：${previous} → ${current}`);
        previous = current;
    }
    previous = territorySilverChestIconPop(total * 0.31);
    for (let t = total * 0.32; t < total; t += 0.01) {
        const current = territorySilverChestIconPop(t);
        assert.ok(current < previous, `${t}s 应一路缩小：${previous} → ${current}`);
        previous = current;
    }
    for (let t = 0; t <= total; t += 0.005) {
        const value = territorySilverChestIconPop(t);
        assert.ok(value >= 0 && value <= peak + 1e-9, `${t}s 越界：${value}`);
    }
});

// ============================================================
// 二、两类宝箱的配表判据
// ============================================================

test('判据是 rewardId=1023（全表唯一只发银币的一组），且这些格都配 69020 coinBox', () => {
    assert.equal(TERRITORY_SILVER_CHEST_REWARD_ID, 1023);
    const rewards = JSON.parse(readFileSync('assets/remoteRef/levelMapGrideReward.json', 'utf8')) as {
        v: [number, { resId: number }[]][];
    };
    const groupOf = (id: number) => rewards.v.find(([rewardId]) => rewardId === id)?.[1] ?? [];
    assert.deepEqual([...new Set(groupOf(1023).map((row) => row.resId))], [7],
        '1023 这一组只发银币（resId=7）—— 这就是「银币宝箱」的名字来源');
    for (let id = 1016; id <= 1022; id += 1) {
        const ids = [...new Set(groupOf(id).map((row) => row.resId))];
        assert.ok(ids.length > 1 && ids.some((resId) => resId >= 19000),
            `${id} 是「银币 + 卡牌碎片等」的卡牌碎片宝箱，不能误判成银币宝箱`);
    }

    let total = 0;
    for (let chapter = 1; chapter <= 7; chapter += 1) {
        const path = `assets/resources/config/territory-maps/chapter_0${chapter}.json`;
        const map = JSON.parse(readFileSync(path, 'utf8')) as {
            sites: { type?: string; rewardId?: number; buildingId?: string }[];
        };
        for (const site of map.sites) {
            if (site.rewardId !== TERRITORY_SILVER_CHEST_REWARD_ID) continue;
            total += 1;
            assert.equal(site.type, 'fixedResource', `${path} 的银币宝箱必须是固定资源格`);
            assert.equal(site.buildingId, '69020',
                `${path} 的银币宝箱必须显式配 coinBox（69020），不能靠空串回退到 69005 黄箱子`);
        }
    }
    assert.equal(total, 148, '七章合计 148 个银币宝箱格（与 territory-building-id 同一口径）');
});

// ============================================================
// 三、站点视图：退场期间用快照帧顶替、播完收敛、池化复位
// ============================================================

test('领取回包把 icon 置 null 后，pop 仍用快照帧演完，播完才真正消失', () => {
    const { view, icon, iconSprite } = makeStationView();
    view.render(content(11, frameA));
    const base = icon.scale.x;
    assert.ok(base > 0 && base !== 1, '这条用例要让 applyIconPlacement 走完整分支');
    assert.equal(view.playSilverChestIconPop(), true);

    // 回包重绘：`stationRenderOf` 的 claimed 分支给 icon = null。
    view.render(content(11, null));
    assert.equal(iconSprite.spriteFrame, frameA, '退场期间必须用帧快照顶替，否则箱子先没了');
    assert.equal(iconSprite.enabled, true);

    const total = TERRITORY_SILVER_CHEST_POP_SECONDS;
    view.update(total * 0.3);
    assert.ok(Math.abs(icon.scale.x - base * TERRITORY_SILVER_CHEST_POP_PEAK) < 1e-9,
        `峰值帧应是基准 × ${TERRITORY_SILVER_CHEST_POP_PEAK}，实际 ${icon.scale.x}`);
    view.update(total * 0.4); // 累计 0.7 × total ⇒ 缩小段
    const shrink = territorySilverChestIconPop(total * 0.7);
    assert.ok(Math.abs(icon.scale.x - base * shrink) < 1e-9, '缩小段按真曲线走');
    assert.ok(icon.scale.x < base, '缩小段必须缩到比基准小');

    view.update(total); // 播完
    assert.equal(iconSprite.spriteFrame, null, '播完要把快照帧还回去');
    assert.equal(iconSprite.enabled, false, '播完宝箱必须真的消失');

    // 池化复用：同一节点借给下一格，不能带着 pop 系数 / 上一格的快照帧。
    view.render(content(12, frameB));
    assert.equal(iconSprite.spriteFrame, frameB);
    assert.ok(Math.abs(icon.scale.x - base) < 1e-9, '下一格的缩放不能残留 pop 系数');
});

test('pop 没播完就被借给别的格 ⇒ 立刻停表，别格不许闪出宝箱', () => {
    const { view, icon, iconSprite } = makeStationView();
    view.render(content(11, frameA));
    const base = icon.scale.x;
    assert.equal(view.playSilverChestIconPop(), true);
    view.update(TERRITORY_SILVER_CHEST_POP_SECONDS * 0.3);
    assert.ok(icon.scale.x > base);

    view.render(content(12, frameB));
    assert.equal(iconSprite.spriteFrame, frameB, '换格后立刻显示新格的图');
    assert.ok(Math.abs(icon.scale.x - base) < 1e-9, '换格必须把 pop 系数清零');
    view.update(TERRITORY_SILVER_CHEST_POP_SECONDS * 0.3);
    assert.equal(iconSprite.spriteFrame, frameB, '停表后 update 不许再把旧快照贴回来');
});

test('这一刻没有宝箱图 / 视图已销毁 ⇒ 不演，也不留半套状态', () => {
    const empty = makeStationView();
    empty.view.render(content(11, null));
    assert.equal(empty.view.playSilverChestIconPop(), false);
    empty.view.update(TERRITORY_SILVER_CHEST_POP_SECONDS);
    assert.equal(empty.iconSprite.spriteFrame, null);
    assert.equal(empty.iconSprite.enabled, false);

    const disposed = makeStationView();
    disposed.view.render(content(11, frameA));
    assert.equal(disposed.view.playSilverChestIconPop(), true);
    assert.doesNotThrow(() => disposed.view.dispose());
    assert.equal(disposed.view.playSilverChestIconPop(), false, 'dispose 后不能再起播');
    assert.doesNotThrow(() => disposed.view.update(1), 'dispose 后 update 不能写已销毁节点');
});

// ============================================================
// 四、分流结构守卫：银币宝箱绝不复用卡牌宝箱那套表演
// ============================================================

test('Presenter 只按 rewardId 打标；卡牌宝箱保持默认开箱调用不变', () => {
    assert.match(MODEL_SRC, /TERRITORY_SILVER_CHEST_REWARD_ID/);
    assert.match(MODEL_SRC, /showRewards\(result\.rewards, site\.cellId, \{ silverChest: true \}\)/,
        '银币宝箱要带 { silverChest: true }');
    assert.match(MODEL_SRC, /showRewards\(result\.rewards, site\.cellId\)/,
        '卡牌碎片宝箱仍走默认开箱（territory-cell-protocol / burst-density 钉着这串调用）');
    assert.match(MODEL_SRC, /readonly silverChest\?: boolean/, '表现契约里要有这个字段');
});

test('页面：银币宝箱不进 playChestOpen，奖励当场结算（不挂动画回调）', () => {
    const at = PAGE_SRC.indexOf('presentation?.silverChest === true');
    assert.ok(at > 0, 'presentRewards 里要有银币宝箱分支');
    const body = PAGE_SRC.slice(at, PAGE_SRC.indexOf('const tier =', at));
    assert.match(body, /playSilverChestOpen\(cellId\)/);
    assert.match(body, /settleRewards\(rewards, cellId, false\)/,
        '这次没有飞出图标带 +N，银币要照常飘字');
    assert.doesNotMatch(body, /playChestOpen|playChestThenSettle|territoryChestTierOfRewards|chest_seq/,
        '不许碰卡牌宝箱的三档表演 / 黄箱子开盖补帧');
    assert.doesNotMatch(body, /onDone|isChestPlaying|wireRewardCatch/,
        '奖励结算不许挂在动画回调上：换章 / 页面销毁会静默吞掉这批银币');
});

test('MapView 的银币宝箱入口只转发到站点自己的 Icon，不碰覆盖层 / 镜头 / 输入锁', () => {
    const at = MAP_SRC.indexOf('playSilverChestOpen(cellId: number): boolean {');
    assert.ok(at > 0);
    const body = MAP_SRC.slice(at, MAP_SRC.indexOf('\n    }', at));
    assert.match(body, /playSilverChestIconPop\(\)/);
    assert.doesNotMatch(body, /ensureOverlayHost|chestView|setInputLocked|captureChestCamera|chest_seq/,
        '独立动画必须活在站点节点上，别拉起卡牌宝箱那套全屏表演');
});

test('站点：pop 只写缩放，不建 tween / 不抢 UIOpacity 通道', () => {
    const at = STATION_SRC.indexOf('private stepSilverChestPop(');
    assert.ok(at > 0);
    const body = STATION_SRC.slice(at, STATION_SRC.indexOf('\n    private ', at + 10));
    assert.match(body, /territorySilverChestIconPop\(elapsed\)/);
    assert.match(body, /this\.writeIconScale\(\)/);
    assert.doesNotMatch(body, /tween|schedule|setTimeout|UIOpacity/,
        '缩到 0 就是消失；叠 UIOpacity 会与 setSpawnOpacity 抢同一颗节点');
    // 三个缩放因子相乘（归一基准 × 生成抖动 × pop），互不覆盖。
    const scaleAt = STATION_SRC.indexOf('private writeIconScale(): void {');
    const scaleBody = STATION_SRC.slice(scaleAt, STATION_SRC.indexOf('\n    }', scaleAt));
    assert.match(scaleBody, /iconBaseScale \* this\.buildingShakeX \* pop/);
});
