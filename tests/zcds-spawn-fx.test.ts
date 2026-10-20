import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 单位出生特效（`assets/resources/units/effects/出生特效/`）的资产与接线守卫。
 *
 * 这套特效的每个关键配置都**不报错、只是静默失效**，所以逐条钉死：
 *  - `layer` 落 DEFAULT(1073741824)⇒ UI_2D 相机下完全看不见；
 *  - `sizeMode` 不是 RAW(2) ⇒ 引擎按 trim 后的 rect 重算尺寸，而各帧的 trim 包围盒
 *    各不相同 ⇒ 动画播放时**忽大忽小地抖**；
 *  - `trim=true` ⇒ 又按 SpriteFrame 的 trim 区渲染，位置也开始跳；
 *  - `Animation._clips` 为空 ⇒ `play(defaultClip.name)` 找不到 clip；
 *  - 帧数不足 ⇒ 动画被截断。
 *
 * ## 素材来源与口径（2026-10-14 二次更换：植物叶片那套）
 *
 * 源目录 `zarts/art/植物占领世界美术/特效/出生特效`（`vfx_skill_applecheek_01_03-start_01..24.png`）：
 *  - **24 帧**，画布统一 **266×330**（叶片从地面往上冒 + 底部光斑，首尾帧是淡光斑）；
 *  - 帧按**原始像素**原地覆盖进 `atlas/出生特效_spawn_01..24.png`（uuid 不动），
 *    第 25 张是第 24 帧的**重复副本**，只为保持「文件数 25 + 帧号连续」稳定，`clip` 不用它；
 *  - 旧口径（老端 `sc` 那套 208×376 / 16 帧）的整目录备份在 `tmp/_spawnfx_bak/`。
 *
 * 落到 Demo 的口径：
 * **24 帧全用、sample 12、wrapMode 1(once)、`_duration = 2.0`** ⇒ 24/12 = 2.0s。
 * 🔴 2026-10-19 起**播放时锁总时长 1.25s**（`SPAWN_FX_TARGET_SECONDS`，speed = 2.0/1.25 = 1.6×），
 * 存活时长同步按 1.25s 算 —— 资产的 `_duration` 仍是美术原速 2.0，别去改它（改了是截断不是加速）。
 *
 * ## 尺寸为什么是「帧 266×330 + `_lscale 0.4144`」
 * 帧按**原始像素**落地，显示尺寸交给 `_lscale` ⇒ 屏上 **110.2×136.8**。这个值被两条既有约束夹出来
 * （见 `EXPECTED_SCALE` 的注释）：宽度 < 112（地块面宽，否则盖邻格）、高度是人物可见高 67.27 的 2~3 倍。
 * **不要重采样成显示尺寸** —— 保留原始像素零插值损失，也让「改显示大小」只动一个数。
 * ⚠️ `sizeMode` 必须是 **RAW(2)**：各帧 `trim` 包围盒不同，CUSTOM 会按 trim rect 拉伸 ⇒ 动画忽大忽小地抖。
 */


const FX_ROOT = 'assets/resources/units/effects/出生特效';
const PREFAB_PATH = `${FX_ROOT}/出生特效.prefab`;
const ANIM_PATH = `${FX_ROOT}/anim/出生特效.anim`;
const ATLAS_DIR = `${FX_ROOT}/atlas`;

/**
 * 帧的原始尺寸（美术给的序列帧画布；**不是**游戏里的显示尺寸 —— 显示 = 它 × prefab `_lscale`）。
 */
const EXPECTED_FRAME_WIDTH = 266;
const EXPECTED_FRAME_HEIGHT = 330;
/** atlas 里的帧文件数：帧全导（第 25 张是第 24 帧的重复副本，只为保持命名/文件数稳定）。 */
const FRAME_COUNT = 25;
/** `anim` 实际引用的帧数 = 24（新美术 24 张全用；`sample=12` ⇒ 24/12 = 2.0s，与老口径同长）。 */
const CLIP_FRAME_COUNT = 24;
/**
 * prefab 根节点缩放。显示尺寸 = 帧尺寸 × 它，受两条约束夹住：
 *  · 宽度 < 112（地块面宽，免得盖住相邻格子）⇒ `s < 112/266 = 0.42105`
 *  · 高度是人物可见高 67.27 的 2~3 倍 ⇒ `s > 134.54/330 = 0.40771`
 * 取区间中点 0.4144 ⇒ 显示 110.23 × 136.75（比值 2.033）。
 */
const EXPECTED_SCALE = 0.4144;

/** 帧文件名的规范格式：两位补零，保证 `ls` / 资源管理器里顺序 = 播放顺序。 */
const FRAME_NAME_PATTERN = /^出生特效_spawn_(\d{2})\.png$/;

/** 把 atlas 里的帧按帧号升序返回，顺带断言命名规范。 */
function sortedFrames(): string[] {
    const frames = readdirSync(ATLAS_DIR).filter((f) => f.endsWith('.png'));
    for (const frame of frames) {
        assert.match(frame, FRAME_NAME_PATTERN,
            `帧名不合规范：${frame}。要求「出生特效_spawn_NN」（两位补零），`
            + '参照projectiles/冰法师_冰峰/atlas 的「冰道人_冰峰_attack_01」模板 —— '
            + '不补零时 `ls` 按字典序排会变成 1,10,11,...,2,20，与播放顺序不一致');
    }
    const byIndex = (a: string, b: string) =>
        Number(FRAME_NAME_PATTERN.exec(a)![1]) - Number(FRAME_NAME_PATTERN.exec(b)![1]);
    return frames.sort(byIndex);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const loadRaw = (path: string): Raw[] => JSON.parse(readFileSync(path, 'utf8')) as Raw[];

test('出生特效：25 帧序列帧全在，命名是「出生特效_spawn_NN」，且都是原始尺寸 208x376', () => {
    assert.ok(existsSync(PREFAB_PATH), '出生特效 prefab 缺失');
    const frames = sortedFrames();
    assert.equal(frames.length, FRAME_COUNT,
        `帧数应为 ${FRAME_COUNT}（老端 sc_idle_01..25 全导），实际 ${frames.length}`);

    // 帧号必须恰好是 01..25，不能有重复或跳号（漏一帧 = 动画卡一下）。
    const indexes = frames.map((f) => Number(FRAME_NAME_PATTERN.exec(f)![1]));
    assert.deepEqual(indexes, Array.from({ length: FRAME_COUNT }, (_, i) => i + 1),
        `帧号必须是 01..${FRAME_COUNT} 连续无重复，实际 ${indexes.join(',')}`);

    for (const frame of frames) {
        const meta = JSON.parse(readFileSync(`${ATLAS_DIR}/${frame}.meta`, 'utf8')) as Raw;
        const userData = meta.subMetas?.f9941?.userData;
        assert.ok(userData, `${frame} 缺 sprite-frame 子资源，引擎没能导出可绑的 SpriteFrame`);
        // rawWidth/rawHeight 是**未裁剪**的原始尺寸，全帧一致才说明缩放没走偏。
        assert.equal(userData.rawWidth, EXPECTED_FRAME_WIDTH,
            `${frame} 原始宽度应为 ${EXPECTED_FRAME_WIDTH}（老端 sourceSize），实际 ${userData.rawWidth}`);
        assert.equal(userData.rawHeight, EXPECTED_FRAME_HEIGHT,
            `${frame} 原始高度应为 ${EXPECTED_FRAME_HEIGHT}（老端 sourceSize），实际 ${userData.rawHeight}`);
    }
});

/**
 * anim 的 24 处 spriteFrame 引用必须**逐一命中** atlas 里的帧，且顺序与帧号一致。
 *
 * 这条是 2026-10-12 换尺寸时踩出来的：改帧的过程中曾用「新建 `出生特效_spawn_NN.png` +
 * 脚本写 .meta 并沿用旧 uuid」的写法，结果 **Cocos 的资源监听立刻导入新文件并重分配 uuid**
 * （我写的 `f22c5af8…` 被改成 `b9be3c1d…`）⇒ anim 的 24 处引用与 prefab 的 `_spriteFrame`
 * 全部指向不存在的资源 ⇒ **特效静默变空白，不报任何错**。
 * 正解是「原地换像素内容、文件名与 uuid 一律不动」，改名交给编辑器做。
 *
 * ⚠️ 查引用要用 `subMetas.f9941.uuid`（**值自带 `@f9941`**，别再拼一次，见 MEMORY rule 178），
 *    不是顶层 `uuid`（那是纹理图的）。
 */
test('出生特效：anim 的 16 处 spriteFrame 引用逐一命中 atlas，且顺序 = 帧号顺序', () => {
    const clip = JSON.parse(readFileSync(ANIM_PATH, 'utf8')) as Raw;
    const values = clip._tracks[0]._channel._curve._values as Raw[];
    const times = clip._tracks[0]._channel._curve._times as number[];
    assert.equal(values.length, CLIP_FRAME_COUNT, `clip 应引用 ${CLIP_FRAME_COUNT} 帧，实际 ${values.length}`);
    assert.equal(times.length, CLIP_FRAME_COUNT, 'times 与 values 必须一一对应');

    // uuid → 帧名（用 sprite-frame 子资源的 uuid）
    const byUuid = new Map<string, string>();
    for (const frame of sortedFrames()) {
        const meta = JSON.parse(readFileSync(`${ATLAS_DIR}/${frame}.meta`, 'utf8')) as Raw;
        byUuid.set(meta.subMetas.f9941.uuid, frame);
    }
    const order = values.map((v) => {
        const uuid = v.__uuid__ as string;
        const hit = byUuid.get(uuid);
        assert.ok(hit, `anim 引用的 ${uuid} 不在 atlas 的 ${byUuid.size} 帧里`
            + '（uuid 断链 ⇒ 特效播放时静默空白）。'
            + '⚠️ 若刚改过帧：不要用「新建文件+脚本写 meta」的写法，'
            + 'Cocos 资源监听会立刻重分配新 uuid 把引用打断；应原地换像素内容、文件名不动');
        return hit!;
    });
    const expected = sortedFrames().slice(0, CLIP_FRAME_COUNT);
    assert.deepEqual(order, expected,
        'anim 的帧顺序必须与 atlas 帧号顺序一致（且只取前 16 帧），否则动画会跳帧/倒放');
});

test('出生特效：动画片段逐帧引用 16 张图，时长 = 帧数 / fps', () => {
    const clip = JSON.parse(readFileSync(ANIM_PATH, 'utf8')) as Raw;
    const tracks = clip._tracks as Raw[];
    assert.equal(tracks.length, 1, '应当只有一条 track（只换 spriteFrame）');
    const values = tracks[0]._channel._curve._values as Raw[];
    const times = tracks[0]._channel._curve._times as number[];
    assert.equal(values.length, CLIP_FRAME_COUNT, `clip 应引用 ${CLIP_FRAME_COUNT} 帧，实际 ${values.length}`);
    assert.equal(times.length, CLIP_FRAME_COUNT, 'times 与 values 必须一一对应');

    // 时长必须等于 帧数 / fps，否则播放几帧就停 / 末尾空转。
    const expectedDuration = CLIP_FRAME_COUNT / Number(clip.sample);
    assert.ok(Math.abs(clip._duration - expectedDuration) < 1e-6,
        `_duration=${clip._duration} 与 帧数/${clip.sample}=${expectedDuration} 不符`);

    // uuid 不能重复丢帧：16 个 uuid 必须互不相同（重复帧是不同的图，uuid 也不同）。
    const uuids = values.map((v) => v.__uuid__ as string);
    assert.equal(new Set(uuids).size, CLIP_FRAME_COUNT, 'clip 里有重复 uuid，动画会少帧');

    // ClampToForever(1)：出生特效播一次停住，靠渲染层按时间回收，不该自己循环。
    assert.equal(clip.wrapMode, 1, `wrapMode 应为 1(ClampToForever)，实际 ${clip.wrapMode}`);
});

test('出生特效 prefab：layer=UI_2D、sizeMode=RAW、trim关（抖动三连）', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const node = prefab.find((o) => o?.__type__ === 'cc.Node');
    assert.ok(node, 'prefab 没有根节点');
    assert.equal(node._layer, 33554432,
        `layer 必须是 UI_2D(33554432)，实际 ${node._layer} —— 落DEFAULT 会让特效在 UI 相机下完全不可见`);

    const sprite = prefab.find((o) => o?.__type__ === 'cc.Sprite');
    assert.ok(sprite, 'prefab 没有 cc.Sprite，动画无处换图');
    assert.equal(sprite._sizeMode, 2,
        `sizeMode 必须是 RAW(2)：24 帧 trim 包围盒各不相同，CUSTOM/TRIMMED 会让动画忽大忽小`);
    assert.equal(sprite._isTrimmedMode, false,
        'trim 必须为false，否则又按 trim 区渲染，逐帧位置会跳');
    assert.ok(sprite._spriteFrame?.__uuid__, 'Sprite 没绑首帧 spriteFrame');

    // 节点尺寸应等于原生帧尺寸（RAW 下引擎写成 originalSize）。
    const uiTransform = prefab.find((o) => o?.__type__ === 'cc.UITransform');
    assert.equal(uiTransform._contentSize.width, EXPECTED_FRAME_WIDTH);
    assert.equal(uiTransform._contentSize.height, EXPECTED_FRAME_HEIGHT);
});

/**
 * 锚点必须是**底边**（`(0.5, 0)`），光柱才会从人物脚底往上喷。
 *
 * 判据来自实测像素（`png-pixel-geometry`，24 帧全量）：这 24 帧的内容底边
 * **20/24 帧精确落在画布最底一行**（439×688 时 artY=687；105×165 时 artY=164），顶边约 47~98。
 * 即原稿本身就是「从画布底边往上喷」的构图，锚点该跟它对齐。
 *
 * 改成居中锚点时的实际错位（人物可见高 67；旧 439×688 图 @ scale 0.24）：
 *   局部 y = (1 − anchorY)·688 − artY
 *   anchorY=0.5 ⇒ 内容底边局部 −343 ⇒ 单位坐标系 **−82.3（沉在人物脚下 82px）**，
 *                内容顶边只到 +71.3（人物 67 高，勉强罩住、光柱大半在地下）
 *   anchorY=0   ⇒ 内容底边局部 +1   ⇒ 单位坐标系 **+0.24（≈ 脚底）**，顶边 +153.8
 * 所以这不是美术问题，是节点原点与光柱根部不在一条线上。
 *
 * ⚠️ 判据只钉 `y`：RAW 的 `_applySpriteSize` 只写 `contentSize`、**不改 anchor**，
 * 所以这两个字段互不干扰，可以各自独立断言（否则改一个会被另一个的断言误伤）。
 */
test('出生特效 prefab：锚点 =底边(0.5,0)，光柱从脚底往上喷而不是沉在地下', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const uiTransform = prefab.find((o) => o?.__type__ === 'cc.UITransform');
    assert.ok(uiTransform, 'prefab 没有 cc.UITransform');
    const anchor = uiTransform._anchorPoint;
    assert.equal(anchor.x, 0.5, 'x 应保持水平居中（0.5），只改 y');
    assert.equal(anchor.y, 0,
        `anchorPoint.y 必须是 0（底边锚点）：24 帧内容底边实测贴着画布最底一行，`
        + `居中锚点会让光柱有 82px 沉在人物脚下。实际 ${JSON.stringify(anchor)}`);
});

test('出生特效 prefab：Animation 同时绑好 _clips 与 _defaultClip', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const animation = prefab.find((o) => o?.__type__ === 'cc.Animation');
    assert.ok(animation, 'prefab 没有 cc.Animation —— prefab 不会自己播');

    const clipUuid = (JSON.parse(readFileSync(`${ANIM_PATH}.meta`, 'utf8')) as Raw).uuid;
    assert.deepEqual(animation._clips?.map((c: Raw) => c.__uuid__), [clipUuid],
        '_clips 为空时 play(clipName) 找不到 clip');
    assert.equal(animation._defaultClip?.__uuid__, clipUuid,
        '_defaultClip 缺失时playOnLoad 不会触发');
    assert.equal(animation.playOnLoad, true);
});

test('出生特效：prefab 的首帧 spriteFrame 必须真的指向 atlas 里的图', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const sprite = prefab.find((o) => o?.__type__ === 'cc.Sprite');
    const bound = sprite._spriteFrame.__uuid__ as string;
    const known = new Set<string>();
    for (const frame of readdirSync(ATLAS_DIR).filter((f) => f.endsWith('.png'))) {
        const meta = JSON.parse(readFileSync(`${ATLAS_DIR}/${frame}.meta`, 'utf8')) as Raw;
        known.add(meta.subMetas.f9941.uuid);
    }
    assert.ok(known.has(bound), `prefab 绑的 ${bound} 不在 atlas 的 ${known.size} 张图里`);
});

/**
 * 帧尺寸与 prefab 缩放是**一对**，必须同一条用例里一起钉。
 *
 * 2026-10-14 换老客户端素材后的口径：**帧 = 老端原始像素 208×376，`_lscale = 0.4`**
 * （= 老端 `sprite.scale`，展平后即 `net_scale`）⇒ 屏上 83.2×150.4。
 * | 帧尺寸 | _lscale | 实际显示 | 后果 |
 * |---|---|---|---|
 * | 208×376 | 0.4 | 83.2×150.4 | ✓ 与老端逐像素等价 |
 * | 208×376 | 1.0 | 208×376 | 铺满半个屏（2.3 倍） |
 * | 105×165 | 1.0 | 105×165 | 旧的 Demo 口径（另一套美术，已下线） |
 */
test('出生特效：帧是老端原始尺寸 208x376，prefab _lscale 必须是 0.4（与帧尺寸配对）', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const node = prefab.find((o) => o?.__type__ === 'cc.Node');
    assert.ok(node);

    assert.equal(node._lscale.x, EXPECTED_SCALE, `根节点 scale.x 应为 ${EXPECTED_SCALE}（老端 net_scale），实际 ${node._lscale.x}`);
    assert.equal(node._lscale.y, EXPECTED_SCALE, `scale.y 应同为 ${EXPECTED_SCALE}，否则光柱被拉扁。实际 ${node._lscale.y}`);
    assert.equal(node._lscale.z, 1, 'z 缩放固定 1');

    // 显示尺寸 = 帧尺寸 × scale，两边任一改动都要在这条断言上暴露。
    const displayW = EXPECTED_FRAME_WIDTH * node._lscale.x;
    const displayH = EXPECTED_FRAME_HEIGHT * node._lscale.y;
    // 宽度略窄于地块面宽 112px，免得盖住相邻格子。
    assert.ok(displayW < 112, `显示宽 ${displayW.toFixed(1)} 应窄于地块宽 112，否则会盖邻格`);
    // 高度约等于人物可见高（67）的 2~3 倍 —— 罩住人物再留一点往上喷的余量。
    const heroHeight = 67.27;
    assert.ok(displayH / heroHeight > 2 && displayH / heroHeight < 3,
        `显示高 ${displayH.toFixed(1)} 应是人物可见高 ${heroHeight} 的 2~3 倍`);
});

/**
 * 跨文件口径：垂直落位**全部归 prefab**（`anchorPoint` + `_lpos`），渲染层一个位置字段都不许写。
 *
 * 三个部件各管一件事，少任何一个都不对：
 *
 * | 部件 | 值 | 作用 | 少了会怎样 |
 * |---|---|---|---|
 * | prefab `anchorPoint` | `(0.5, 0)` 底边 | 让光柱**画布底边**落在节点原点 | 居中锚点 ⇒ 82px沉在人物脚下 |
 * | prefab `_lpos.y` | `-28.2` | 光柱**内容底边**落在单位脚下 28px 处 | 太高 ⇒ 看着像罩在人物中间而不是从脚下喷 |
 * | 渲染层 `setPosition` | **不写** | 跟随靠父子关系自动同步 | 🔴 **写了就把上面两个值全覆盖 ⇒「改了 prefab 没效果」且零报错** |
 *
 * `-28.2` 是**算出来的、不是调的**：老端展平后 sprite 中心在单位上方 47px
 * （`position.scale ⊙ sprite.pos` = `(0, 47)`），显示高 376×0.4 = 150.4
 * ⇒ 内容 y ∈ [47−75.2, 47+75.2] = `[-28.2, 122.2]`；Demo 用底边锚点 ⇒ `_lpos.y` = 底边 = −28.2。
 *
 * ⚠️ 最后一行是真实踩过的坑：`_lpos` 设好后渲染层仍在写 `setPosition(0,0,0)`，
 * prefab 的偏移被完全覆盖。判据必须是**反向断言**（不许出现 setPosition），
 * 正向断言 `includes('setPosition')` 反而会把 bug钉成"正确"。
 */
test('出生特效：垂直落位全归 prefab（anchorPoint + _lpos），渲染层不许写位置', () => {
    const prefab = loadRaw(PREFAB_PATH);
    const uiTransform = prefab.find((o) => o?.__type__ === 'cc.UITransform');
    const node = prefab.find((o) => o?.__type__ === 'cc.Node');
    assert.equal(uiTransform._anchorPoint.y, 0, 'prefab 侧：底边锚点（详见锚点那条用例的推导）');
    // 光柱内容底边的落位靠这个 y：老端展平 = 中心在单位上方 47px、显示高 150.4
    // ⇒ 底边 −28.2（推导见上方表格后的说明）。它把光柱从"罩在头顶"下压到"从脚下喷"。
    assert.equal(node._lpos.y, -28.2,
        `prefab._lpos.y 应为 -28.2（老端展平后的内容底边）。实际 ${node._lpos.y}`);
    assert.equal(node._lpos.x, 0, '横向不该偏：光柱是居中构图，由 anchorPoint.x=0.5 决定');

    // 行为判据：playSpawnFx 不得覆盖 prefab 烘好的位置/缩放。
    // 造一个初始就带 prefab 落位（_lpos=(0,-28.2)、_lscale=0.4144）的特效节点，播放后必须原样保留。
    const { load, FakeNode, makeEffectPool } = loadViews();
    const host = new FakeNode('ZCGameUnit');
    /** 用来观测 `AnimationState.speed`（加速倍数）—— 加速就是靠这一个字段实现的。 */
    const spawnState: { speed: number } = { speed: 1 };
    const { effectPool } = makeEffectPool({ spawnFxPrefab: {
        make: () => {
            const fx = new FakeNode('SpawnFx');
            fx.setPosition(0, -28.2, 0);   // 模拟 prefab 的 _lpos
            fx.setScale(0.4144, 0.4144, 1); // 模拟 prefab 的 _lscale
            fx.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? {
                    defaultClip: { name: 'spawn', duration: 2.0 }, stop() {}, play() {},
                    getState: () => spawnState,
                }
                : null)) as never;
            return fx;
        },
    } });
    effectPool.playSpawnFx(host, 0);
    const spawned = host.children[0];
    assert.ok(spawned, '播放后光柱应挂在单位节点下');
    assert.deepEqual({ x: spawned.position.x, y: spawned.position.y }, { x: 0, y: -28.2 },
        'playSpawnFx 不得写 setPosition —— 否则 prefab 的 _lpos(-28.2) 被 (0,0) 覆盖，表现为「改 prefab 没效果」');
    assert.ok(Math.abs(spawned.scale.x - 0.4144) < 1e-9,
        `playSpawnFx 不得写 setScale —— 否则 prefab 的 _lscale(0.4144) 被覆盖，实际 ${spawned.scale.x}`);
    // 2026-10-19 用户口径两改：「总时长缩短成 80%」→「再加速，1.6s → 1.25s」。
    // 锁的是**总时长 1.25s**，倍速由 clip 反推：2.0 / 1.25 = 1.6。
    assert.ok(Math.abs(spawnState.speed - 1.6) < 1e-9,
        `出生特效必须把 2.0s 的 clip 压进 1.25s（speed 1.6×），实际 speed=${spawnState.speed}`);
});

test('出生特效：加载器容错加载 + 渲染层播放，两端都接上了', () => {
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    assert.ok(loader.includes('units/effects/出生特效/出生特效'),
        'SPAWN_FX_URL 没指向出生特效 prefab');
    assert.ok(loader.includes('loadSpawnFxPrefab'),
        '缺容错加载器 —— 出生特效没交/路径写错不该让整局开不起来');

    const world = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    // 播放/回收逻辑已抽到 ZCEffectPool，渲染世界只负责在单位出生/帧推进时委托给它。
    assert.ok(world.includes('effectPool.playSpawnFx'), '渲染层没有在单位出生时委托播放入口');
    assert.ok(world.includes('effectPool.recycleSpawnFx'),
        '缺回收入口委托 —— 出生特效会永久留在场上');

    // 回收判据必须走 clip 时长而不是写死常量：改帧率不该让特效提前消失。
    const pool = readFileSync('assets/script/app/zcds/view/ZCEffectPool.ts', 'utf8');
    assert.ok(pool.includes('clip.duration'), '出生特效时长应从 AnimationClip 读，不写死');
});

/**
 * 出生特效必须**挂在单位节点下**（跟随人物移动），而不是作为 mapLayer 的独立兄弟节点
 * 只在出生那一帧写一次坐标 —— 后者会让光柱钉在出生格上不动，人已经走出去几十像素。
 *
 * 这条不报错、只是「看起来怪」，所以钉死父子关系 + 回收时必须摘宿主。
 */
test('出生特效：挂在单位节点下跟随移动，播完/宿主消失都先摘 parent 再回池', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    // 走「拿得到 clip」那一支：duration 才是 clip 时长而不是兜底常量。
    const { effectPool } = makeEffectPool({ spawnFxPrefab: {
        make: () => {
            const node = new FakeNode('SpawnFx');
            node.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? {
                    defaultClip: { name: 'spawn', duration: 1.5 }, stop() {}, play() {},
                    getState: () => ({ speed: 1 }),
                }
                : null)) as never;
            return node;
        },
    } });

    const unitNode = new FakeNode('ZCGameUnit');
    unitNode.setPosition(120, -60, 0);
    effectPool.playSpawnFx(unitNode, 0);

    assert.equal(unitNode.children.length, 1, '出生那一帧应当播一条光柱');
    const fx = unitNode.children[0];

    // ① 挂在单位节点下（不是 mapLayer 的兄弟）—— 这是「跟随人物」的唯一实现方式。
    assert.equal(fx.parent, unitNode,
        '光柱必须 setParent(单位节点)，否则人物移动时光柱留在原地不动');
    assert.deepEqual({ x: fx.position.x, y: fx.position.y }, { x: 0, y: 0 },
        '局部坐标应为 (0,0)：与单位的逻辑脚点重合');

    // ② 播放期间不写坐标：人物被 ZCUnitView 写到哪，光柱作为子节点就跟到哪。
    unitNode.setPosition(400, 250, 0);
    assert.deepEqual({ x: fx.position.x, y: fx.position.y }, { x: 0, y: 0 },
        '播放期间特效池不得再写光柱坐标，否则会与单位的插值位置打架');

    // ③ 播完回收：**先 removeFromParent 再回池**。不摘的话光柱留在单位子树里，
    //    而单位节点自己也进池 ⇒ 复用时光柱挂到无关单位身上。
    // 🔴 回收点按**目标总时长 1.25s**，与 clip 原速（这里是 1.5s）无关：
    // wrapMode 是 once，动画播完会停在末帧，多留一截就是冻住不动的残影。
    effectPool.recycleSpawnFx(1.2);
    assert.equal(unitNode.children.length, 1, '1.2s < 目标 1.25s，不该提前回收');
    // 加 1e-6 只为压过 1.25 这种「整秒边界」的尾差，实际时钟按帧走不会正好落在边界上。
    effectPool.recycleSpawnFx(1.25 + 1e-6);
    assert.equal(unitNode.children.length, 0, '到目标时长 1.25s 必须回收');
    assert.equal(fx.parent, null, '回池前必须 removeFromParent —— 留在原宿主子树里会被池带到别的单位身上');

    // ④ 宿主单位先没了（阵亡/被移除）⇒ 立刻摘掉，不等 1.5s。
    const doomed = new FakeNode('ZCGameUnit');
    effectPool.playSpawnFx(doomed, 10);
    assert.equal(doomed.children.length, 1);
    // 池里那一条被复用（`spawnFx` 是同一个节点），所以这里验的仍是同一节点。
    const second = doomed.children[0];
    assert.equal(second, fx, '回收的节点应当被对象池复用，而不是每次新建');
    assert.equal(second.parent, doomed,
        '复用时必须重新挂到新宿主上 —— 残留的 parent 会让光柱停在上一个单位的坐标');
    effectPool.detachSpawnFxOf(doomed);
    assert.equal(doomed.children.length, 0, '宿主消失时光柱必须立刻回收，不能留在场上');
    assert.equal(second.parent, null, '同样必须摘 parent');
});
