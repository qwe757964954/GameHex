import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadViews } from './helpers/zcds-view-fixtures';
import { ZC_NEUTRAL_REWARD_TOTAL_SECONDS } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';

installZCNeutralTestCatalog();

const ROOT = join(__dirname, '..');
const BURST_DIR = 'assets/bundles/battle/image/effects/artifact_claim_burst';

// ============================================================
// 一、序列帧资源：18 帧、按名可排序、每张都带 .meta
// ============================================================

test('资源：`artifact_claim_burst` 落地 18 帧 PNG，且每张都有 .meta', () => {
    const dir = join(ROOT, BURST_DIR);
    assert.ok(existsSync(dir), `序列帧目录必须存在：${BURST_DIR}`);
    const all = readdirSync(dir);
    const pngs = all.filter((name) => name.endsWith('.png')).sort();
    assert.equal(pngs.length, 18, '蓝色爆炸原稿 18 帧（`032 SLBLJS levelup-1_00..17`）');
    // 🔴 走 MCP import 才会生成 meta；`cp` 进 assets 只有图没有 meta，
    //    运行时 `loadDir` 会静默拿到空数组（零报错，特效就是不出现）。
    for (const png of pngs) {
        assert.ok(all.includes(`${png}.meta`), `${png} 缺 .meta（必须用 MCP import 导入）`);
    }
    // 加载器是「扫全目录按名排序」，命名必须两位补零且连续。
    assert.deepEqual(pngs.slice(0, 3), [
        'artifact_claim_burst_00.png',
        'artifact_claim_burst_01.png',
        'artifact_claim_burst_02.png',
    ]);
    assert.equal(pngs[17], 'artifact_claim_burst_17.png', '最后一张是 _17');
});

test('接线：ArtPaths → Loader → PreparedResources → ZCGame → 渲染层 → 特效类', () => {
    const artPaths = readFileSync(join(ROOT, 'assets/script/app/ArtPaths.ts'), 'utf8');
    assert.match(artPaths, /export const ARTIFACT_CLAIM_BURST_ART_ROOT = `\$\{ART_ROOT\}\/effects\/artifact_claim_burst`/,
        '路径真源落在 ArtPaths，别在 loader / 视图里另写一份');

    const loader = readFileSync(join(ROOT, 'assets/script/app/zcds/application/ZCGameLoader.ts'), 'utf8');
    assert.match(loader, /ARTIFACT_CLAIM_BURST_ART_ROOT/, 'loader 要引 ArtPaths 的常量');
    assert.match(loader, /artifactClaimBurstFrames:\s*readonly SpriteFrame\[\]/, 'prepared 要有帧字段');
    assert.match(loader, /loadArtifactClaimBurstFrames\(scope\)/, 'prepared 装配时要真的去加载');
    assert.match(loader, /artifactClaimBurstFrames,\s*\n\s*decorFrames,/, 'return 里要带上它');

    const game = readFileSync(join(ROOT, 'assets/script/app/zcds/ZCGame.ts'), 'utf8');
    assert.match(game, /artifactClaimBurstFrames:\s*prepared\.artifactClaimBurstFrames/, 'ZCGame 要把它递给渲染层');

    const world = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCGameRenderWorld.ts'), 'utf8');
    assert.match(world, /artifactClaimBurstFrames\?: readonly SpriteFrame\[\]/, '渲染层 options 要收这个字段');
    assert.match(world, /options\.artifactClaimBurstFrames \?\? \[\]/, '渲染层要把它转给特效类');
});

// ============================================================
// 二、纯函数：帧序号 / 时间窗 / 尾段淡出
// ============================================================

test('纯函数：18 帧 ÷ 24fps = 0.75s，帧序号按时间单调推进', () => {
    const { load } = loadViews();
    const {
        artifactClaimBurstTotalSeconds,
        artifactClaimBurstFrame,
        ZC_ARTIFACT_CLAIM_BURST_FPS,
        ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS,
    } = load('./ZCNeutralRewardFx');

    assert.equal(ZC_ARTIFACT_CLAIM_BURST_FPS, 24);
    assert.equal(artifactClaimBurstTotalSeconds(18), 18 / 24, '总时长 = 帧数 / 帧率');
    assert.equal(artifactClaimBurstTotalSeconds(0), 0, '没帧 ⇒ 0（不播）');
    assert.equal(artifactClaimBurstTotalSeconds(Number.NaN), 0, '脏帧数不放大成 NaN 时长');

    // 起点前 / 结束后：不可见（左闭右开）。
    assert.equal(artifactClaimBurstFrame(18, 2, 1.99).visible, false, '起点前不显示');
    assert.equal(artifactClaimBurstFrame(18, 2, 2 + 0.75).visible, false, '到点即收');

    // 起点：第 0 帧、全不透明。
    const first = artifactClaimBurstFrame(18, 2, 2);
    assert.equal(first.visible, true);
    assert.equal(first.index, 0);
    assert.equal(first.opacity, 1);

    // 逐帧推进：index = floor(local × 24)，且永不越界。
    let previous = -1;
    for (let step = 0; step < 18; step += 1) {
        const local = (step + 0.5) / ZC_ARTIFACT_CLAIM_BURST_FPS;
        const frame = artifactClaimBurstFrame(18, 2, 2 + local);
        assert.equal(frame.index, step, `第 ${step} 帧的时间片应取到下标 ${step}`);
        assert.ok(frame.index > previous, '帧序号单调递增');
        previous = frame.index;
    }
    assert.equal(artifactClaimBurstFrame(18, 2, 2 + 0.7499).index, 17, '最后一帧不被截断');

    // 尾段线性淡出（防末帧硬切），其余时间全不透明。
    const tail = artifactClaimBurstFrame(18, 2, 2 + 0.75 - ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS / 2);
    assert.ok(tail.opacity > 0.4 && tail.opacity < 0.6, `收尾中透明度应过半（实际 ${tail.opacity}）`);
    assert.equal(artifactClaimBurstFrame(18, 2, 2 + 0.3).opacity, 1, '中段不淡出');
});

test('纯函数：同一 (startedAt, now) 结果可复现（逐帧渲染不会抖）', () => {
    const { load } = loadViews();
    const { artifactClaimBurstFrame } = load('./ZCNeutralRewardFx');
    for (const local of [0, 0.13, 0.5, 0.74]) {
        assert.deepEqual(
            artifactClaimBurstFrame(18, 5, 5 + local),
            artifactClaimBurstFrame(18, 5, 5 + local),
            `local=${local} 两次调用必须逐值相等`,
        );
    }
});

// ============================================================
// 三、特效类：节点结构 / 位置钉格心 / 换帧 / 无帧兼容
// ============================================================

const START = { x: 100, y: 200 };
const TARGETS = { goldCounter: { x: 500, y: 50 }, artifactSlot: { x: 600, y: 50 } };
const resolveStart = () => START;

function fakeFrames(count: number) {
    return Array.from({ length: count }, (_, index) => ({ name: `burst_${index}` }));
}

function artifactEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 1, hexId: 3, itemId: ZC_TEST_ITEM.MixedCharge, owner: 'player', gold: 0, artifactCharge: 1,
        startedAt: 0, durationSeconds: ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
        ...overrides,
    };
}

/** 一次 `loadViews()` 生成的 cc 桩只能配一套 FX —— 混用两份会让组件类型对不上。 */
function makeFx(frames: readonly unknown[] | null) {
    const view = loadViews();
    const { ZCNeutralRewardFx } = view.load('./ZCNeutralRewardFx');
    const host = new view.FakeNode('HudRoot');
    const fx = frames === null
        ? new ZCNeutralRewardFx(host, null, null)
        : new ZCNeutralRewardFx(host, null, null, frames);
    return { fx, host, cc: view.cc, view };
}

function burstNodeOf(host: any) {
    return host.children[0].children.find((child: any) => child.name === 'ArtifactClaimBurst');
}

test('神器领取：爆炸 + 飞行图标两个子节点，爆炸钉在格心不跟飞', () => {
    const frames = fakeFrames(18);
    const { fx, host } = makeFx(frames);
    fx.render([artifactEvent()], 0.1, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    const root = host.children[0];
    assert.equal(root.children.length, 2, '爆炸 + 神器图标');

    const burst = burstNodeOf(host);
    const flying = root.children.find((child: any) => child.name !== 'ArtifactClaimBurst');
    assert.ok(burst, '爆炸节点存在');
    assert.ok(flying, '飞行图标节点存在');
    // 爆炸先建 ⇒ 压在底层（飞行图标从它上面掠过）。
    assert.equal(root.children[0], burst, '爆炸在子节点序首位（底层）');
    assert.deepEqual({ x: burst.position.x, y: burst.position.y }, START, '爆炸落在格心');

    // 推进到飞行中段：图标位移了，爆炸原地不动。
    fx.render([artifactEvent()], 0.3, resolveStart, TARGETS);
    assert.notEqual(flying.position.x, START.x, '神器图标在飞');
    assert.deepEqual({ x: burst.position.x, y: burst.position.y }, START, '爆炸位置恒定');
    assert.equal(burst.active, true, '0.3s 时爆炸仍在播');
});

test('爆炸屏上边长 90px（0.6 × 150、不超一格），问号态的六边形 Spine 尺寸不动', () => {
    const view = loadViews();
    const { ZC_ARTIFACT_CLAIM_BURST_SIZE } = view.load('./ZCNeutralRewardFx');
    // 2026-10-27 用户口径「缩小成 0.6，不超过一个单元格的大小」：150 → 90。
    assert.equal(ZC_ARTIFACT_CLAIM_BURST_SIZE, 90, '0.6 × 旧值 150');
    // 上限取最紧的那个格子口径：顶面 123×90（`core/hex/HexGridLayout`）、地砖脚印 130×119。
    assert.ok(ZC_ARTIFACT_CLAIM_BURST_SIZE <= 123, '爆炸不许超过一格顶面宽 123');

    const cc = view.cc;
    const { fx, host } = makeFx(fakeFrames(18));
    fx.render([artifactEvent()], 0.1, resolveStart, TARGETS);
    const burst = burstNodeOf(host);
    const size = burst.getComponent(cc.UITransform).contentSize;
    assert.deepEqual(
        { width: size.width, height: size.height },
        { width: ZC_ARTIFACT_CLAIM_BURST_SIZE, height: ZC_ARTIFACT_CLAIM_BURST_SIZE },
        '屏上按常量的正方形给（Sprite 是 CUSTOM + trim=false），别按原图的 300 像素',
    );

    // 🔴 上面那条 contentSize 断言**单独存在时是假绿** —— 夹具里的 `cc.Sprite` 是个空类，
    //    不模拟「赋 spriteFrame 时按 TRIMMED 回写尺寸」这条引擎行为（真引擎会），
    //    所以「先 setContentSize、再赋图、最后才 CUSTOM」这种顺序在桩里照样能过，
    //    实机上却永远是原图 300×300 —— 2026-10-27 用户「水花没有改小」就是这么来的。
    //    因此这里再钉一次**赋值顺序**：尺寸是 CUSTOM 之后才定的。
    const fxSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/view/ZCNeutralRewardFx.ts'), 'utf8');
    const createSprite = fxSrc.slice(fxSrc.indexOf('private createSprite('));
    const body = createSprite.slice(0, createSprite.indexOf('\n    }'));
    const modeAt = body.indexOf('sprite.sizeMode = Sprite.SizeMode.CUSTOM');
    const frameAt = body.indexOf('sprite.spriteFrame = frame');
    const sizeAt = body.indexOf('transform.setContentSize(size, size)');
    assert.ok(modeAt > 0, 'createSprite 必须显式把 sizeMode 设成 CUSTOM');
    assert.ok(frameAt > 0, 'createSprite 必须赋 spriteFrame');
    assert.ok(modeAt < frameAt,
        '🔥 顺序反了：必须先 CUSTOM 再赋 spriteFrame。TRIMMED（出厂值）会在赋图那一刻'
        + '把 contentSize 回写成原图尺寸，之后设 CUSTOM **不会**把尺寸还回来 ⇒ 常量彻底失效');
    assert.ok(sizeAt > frameAt,
        '兜底那次 setContentSize 必须在赋图之后（放在赋图之前等于没写）');
    // 反向守卫：不许再回到「先 setContentSize + 赋图、后 CUSTOM」的老写法。
    assert.doesNotMatch(body, /sprite\.spriteFrame = frame;\s*sprite\.sizeMode/,
        '老写法（赋图 → CUSTOM）会被引擎静默回写成原图尺寸');

    // 问号状态 = `ArtifactHexSpine`（六边形底 + 指示器，Spine 循环动画），尺寸只存在 prefab 上、
    // 代码一行都不写（`ZCHexView` 只切显隐与动画名）—— 2026-10-27 明确「保持原大小」。
    const hexPrefab = JSON.parse(readFileSync(join(ROOT, 'assets/bundles/battle/ui/game/ZCGameHex.prefab'), 'utf8'));
    const spineNode = hexPrefab.find((o: any) => o.__type__ === 'cc.Node' && o._name === 'ArtifactHexSpine');
    assert.ok(spineNode, '地块 prefab 里必须有 ArtifactHexSpine（问号态美术）');
    const spineUiRef = spineNode._components
        .find((ref: any) => hexPrefab[ref.__id__].__type__ === 'cc.UITransform');
    const spineSize = hexPrefab[spineUiRef.__id__]._contentSize;
    assert.equal(spineSize.width, 168, '问号态宽度不许跟着爆炸一起缩');
    assert.ok(Math.abs(spineSize.height - 166.8) < 0.01, `问号态高度保持 166.8（实际 ${spineSize.height}）`);
});

test('神器领取：爆炸按 24fps 换帧，播完隐藏但事件仍在（飞行还没落地）', () => {
    const frames = fakeFrames(18);
    const { fx, host, cc, view } = makeFx(frames);
    const { ZC_ARTIFACT_CLAIM_BURST_FPS, artifactClaimBurstFrame } = view.load('./ZCNeutralRewardFx');

    fx.render([artifactEvent()], 0, resolveStart, TARGETS);
    const burst = burstNodeOf(host);
    const sprite = burst.getComponent(cc.Sprite);
    assert.ok(sprite, '爆炸节点挂着 Sprite');
    assert.equal(sprite.spriteFrame, frames[0], '首帧＝序列第 0 张');

    // 第 5 帧的时间片：spriteFrame 必须是纯函数算出的那一张。
    const at5 = 5 / ZC_ARTIFACT_CLAIM_BURST_FPS + 0.001;
    fx.render([artifactEvent()], at5, resolveStart, TARGETS);
    assert.equal(
        sprite.spriteFrame,
        frames[artifactClaimBurstFrame(18, 0, at5).index],
        '换帧下标由 artifactClaimBurstFrame 决定',
    );
    assert.equal(burst.active, true);
    assert.equal(sprite.trim, false, 'CUSTOM 尺寸 + 不裁边（600 画布四周留白不能被切）');

    // 0.75s 爆炸结束；神器飞行到 0.8s 才落地 ⇒ 此刻 root 仍存活、爆炸自身隐藏。
    fx.render([artifactEvent()], 0.76, resolveStart, TARGETS);
    assert.equal(burst.active, false, '爆炸播完即隐藏');
    assert.equal(host.children[0].active, true, '飞行图标还在，root 不能被一起关掉');
    assert.equal(fx.size, 1, '事件未过期，条目仍在');
});

test('神器领取：没配序列帧时退回老表现（只有飞行图标），不报错', () => {
    const { fx, host } = makeFx(null);
    fx.render([artifactEvent()], 0.1, resolveStart, TARGETS);
    assert.equal(fx.size, 1);
    assert.equal(host.children[0].children.length, 1, '只有神器图标，没有爆炸节点');
    assert.equal(host.children[0].children[0].active, true);
});

test('金币 / 非玩家：不建爆炸节点（爆炸只给玩家领神器那一拍）', () => {
    const frames = fakeFrames(18);
    const { fx, host } = makeFx(frames);
    const goldEvent = {
        id: 1, hexId: 3, itemId: ZC_TEST_ITEM.Gold, owner: 'player', gold: 50, artifactCharge: 0,
        startedAt: 0, durationSeconds: ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
    };
    // 金币事件：6 金币 + 1 label，没有爆炸。
    fx.render([goldEvent], 0.1, resolveStart, TARGETS);
    const goldRoot = host.children[0];
    assert.equal(
        goldRoot.children.some((child: any) => child.name === 'ArtifactClaimBurst'),
        false,
        '金币不炸',
    );

    // 非玩家领神器：整条跳过（目标在玩家 HUD 上，不给对方播）。
    // ⚠️ 渲染层每帧传的是**全量存活队列**，分两次 render 会把上一条当过期销毁 ——
    //    所以第二次必须把金币那条一起带上。
    fx.render([goldEvent, artifactEvent({ id: 2, owner: 'enemy' })], 0.1, resolveStart, TARGETS);
    assert.equal(host.children.length, 1, '只有金币那一个 root');
    assert.equal(fx.size, 1, '敌方领神器不入条目');
});

test('clear：换局销毁爆炸节点，不残留', () => {
    const frames = fakeFrames(18);
    const { fx, host } = makeFx(frames);
    fx.render([artifactEvent()], 0.1, resolveStart, TARGETS);
    assert.equal(host.children.length, 1);
    fx.clear();
    assert.equal(fx.size, 0);
    assert.equal(host.children.length, 0, '爆炸节点随 root 一起销毁');
});
