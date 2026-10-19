import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 受击特效（`assets/resources/units/effects/受击特效/`）+ 阵亡特效（`.../死亡特效/`）的
 * 资产与接线守卫。
 *
 * 与出生特效同源的**静默失效**清单，每条都能钉死：
 *  - `layer` 落 DEFAULT(1073741824)⇒ UI_2D 相机下完全看不见；
 *  - `sizeMode` 不是 RAW(2) / `trim=true` ⇒ 各帧 trim 包围盒不同 ⇒ **忽大忽大地抖**；
 *  - `Animation._clips` 为空 ⇒ `play(defaultClip.name)` 找不到 clip，特效压根不播；
 *  - 少一个职业的 prefab ⇒ 那个职业**静默**不播（`get(trait)` 返 undefined 是设计，不是崩）。
 *
 * ## 素材来源与口径（2026-10-15 接入）
 * 源目录 `zarts/art/植物占领世界美术/特效/`：
 *  - `0通用-受击/{中毒,坦克,射手,战士,法师}受击/` 共 **47 帧**；
 *  - `死亡特效/` **13 帧**（`163 SLBLJS vfx_skill_hollow_01_01_00..12.png`）。
 *
 * 🔴 **战士受击 2026-10-16 换了素材**（山猫拍板「替换」）：美术在 `战士受击/` 下新增 9 帧
 * `vfx_bullet_cloud_01-hit_0..8.png`（210×239，**内容几乎铺满画布**，占比 78%→99%），
 * 旧的 407 六帧（1085×910 紫色星芒，内容最大仅占 70%）已从工程删除。
 * ⇒ 帧数 6→9、`contentSize` 1085×910→210×239、`_lscale` 0.1014→**0.5238095**（屏上仍是 110px）。
 *
 * 🔴 **这批是巨图，与工程既有特效不同量级**：既有 projectile 特效全部 ≤256px，
 * 而死亡特效 535×1092、法师受击 1377×1377。5 组受击 + 死亡**图集都装不下**
 * （13 张 535×1092 要4096×4096，工程既有 pac 上限是 2048²）。`.pac` 仍然必须配
 * （漏了**不报错**，是静默失效），`filterUnused:true` 会自动把超限帧排除、按独立
 * SpriteFrame 走 —— 运行时正常，只是不进合并图集。
 *
 * ## 缩放口径（山猫 2026-10-15 拍板「压到与出生特效同量级」）
 * 出生特效 266×330 @ `_lscale=0.4144` ⇒ 屏上 110.2×136.8。**基准 = 屏上宽 110px**。
 * ⚠️ 不要重采样成显示尺寸 —— 保留原始像素零插值损失，改显示大小只动 `_lscale` 一个数。
 *
 *  🔴 **阵亡特效是唯一不守 110px 的特效**（2026-10-16 反馈「死亡特效节点，整体缩小成 0.8」）：
 *  `0.2056 × 0.8 = 0.16448` ⇒ 屏上 **88×179.6**。它原先是按 110px 对齐的，现在故意比
 *  受击/出生小一圈 —— 它是「脚下一团爆开」，110px 会和单位本体抢视觉重心。
 *  **别顺手把它改回 110px**（别"统一口径"），那是把反馈又改回去了。
 */

/** 受击特效根目录（美术源 `0通用-受击` 的五个子目录）。 */
const HIT_FX_ROOT = 'assets/resources/units/effects/受击特效';
/** 阵亡特效根目录。 */
const DEATH_FX_ROOT = 'assets/resources/units/effects/死亡特效';

/**
 * 受击特效的**基准**显示宽度（px，见文件头「缩放口径」）。
 *
 *  = `contentSize.width × _lscale`。各组的实际期望值 = 本基准 × `sizeFactor`（缺省 1）。
 */
const HIT_FX_BASELINE_WIDTH = 110;

/**
 * 参与"职业受击"的四组 —— 必须与卡表 `traits.attack`（= `ZCAttackTrait`）一一对应。
 *
 * 🔴 **「中毒受击」故意不在这里**：它是一个**状态**（中毒 debuff）不是职业，
 * 硬塞进职业映射会让"中毒"看起来像第五个职业。见 `ZCGameLoader.HIT_FX_TRAITS`。
 */
const HIT_FX_GROUPS: ReadonlyArray<{
    name: string;
    frames: number;
    width: number;
    height: number;
    scale: number;
    /** 相对 `HIT_FX_BASELINE_WIDTH` 的显示倍率，缺省 1。**目前只有战士受击不是 1**。 */
    sizeFactor?: number;
}> = [
    { name: '射手受击', frames: 9, width: 620, height: 583, scale: 0.1774 },
    // 🔴 2026-10-16 二次调整（山猫「动画改小一点」）：换上 `vfx_bullet_cloud` 后**图内容占比 70%→99%**，
    // 在同一个 `_lscale` 口径下屏上**视觉内容**从 77px 涨到 108px（比旧版大 40%）⇒ 取 0.8 倍压回 88px。
    // ⚠️ 别把这一条"统一"回 110px：那是把反馈改回去了。
    { name: '战士受击', frames: 9, width: 210, height: 239, scale: 0.41904761904761904, sizeFactor: 0.8 },
    { name: '法师受击', frames: 14, width: 1377, height: 1377, scale: 0.0799 },
    { name: '坦克受击', frames: 9, width: 1085, height: 910, scale: 0.1014 },
    // 中毒那组只验资源在盘上（美术已交），但不进职业映射。
    { name: '中毒受击', frames: 6, width: 1085, height: 910, scale: 0.1014 },
];

/**
 * 死亡特效的帧率（13 帧 @12fps = 1.0833s，2026-10-15 未调）。
 *
 *  ⚠️ 与受击特效的 `HIT_FX_FPS = 18` **故意不同**：受击是「一次性快闪」，
 * 山猫反馈"太久"后提帧率 + 去掉末帧；死亡是「慢动作躺尸」，慢一点才对。
 */
const FPS = 12;

/**
 * 受击特效帧率（2026-10-15 从 12 提到 18）。
 *
 *  缘由：山猫反馈「受击效果太久了」。12fps 下法师 14 帧 = 1.167s 明显拖沓；
 *  18fps 让五组统一缩短 33%（法师 → 0.722s，最长）。
 *  ⚠️ **别再往上加**：受击是挨一下就完的闪，越快越利索。
 */
const HIT_FX_FPS = 18;

/**
 * 阵亡特效的显示尺寸口径 —— `_lscale` 是**唯一旋钮**（见文件头「缩放口径」）。
 *
 *  `DEATH_FX_BASELINE_SCALE` = 110px 基准下的取值（535 × 0.2056 ≈ 110）；
 *  `DEATH_FX_SIZE_FACTOR` = 2026-10-16 反馈「整体缩小成 0.8」。
 *  两个常数分开写是为了让断言能**同时钉住"是 0.8"和"屏上是 88px"**，
 *  而不是只钉一个算出来的小数（那样改坏了基数就查不出来）。
 */
const DEATH_FX_BASELINE_SCALE = 0.2056;
const DEATH_FX_SIZE_FACTOR = 0.8;

function readPrefab(path: string): Record<string, any>[] {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function findType(prefab: Record<string, any>[], type: string): Record<string, any> | null {
    return prefab.find((o) => o.__type__ === type) ?? null;
}

test('受击特效：五组的帧、pac、anim、prefab 四件套齐全，且帧都是原始尺寸', () => {
    for (const group of HIT_FX_GROUPS) {
        const dir = `${HIT_FX_ROOT}/${group.name}`;
        assert.ok(existsSync(dir), `缺目录 ${dir}`);
        const frames = readdirSync(dir).filter((f) => f.endsWith('.png'));
        assert.equal(frames.length, group.frames,
            `${group.name} 应有 ${group.frames} 帧，实际 ${frames.length}`);
        for (const frame of frames) {
            assert.ok(existsSync(`${dir}/${frame}.meta`),
                `${group.name}/${frame} 缺 .meta —— 没交资源是静默失效（加载时才报错）`);
        }
        // 图集必须配（漏了不报错，见文件头注释）。
        assert.ok(existsSync(`${dir}/${group.name}.pac`),
            `${group.name} 缺 auto-atlas.pac（漏配**不报错**，是静默失效）`);
        assert.ok(existsSync(`${dir}/${group.name}.pac.meta`), `${group.name}.pac 缺 .meta`);
        // anim + prefab
        assert.ok(existsSync(`${dir}/anim/${group.name}.anim`), `${group.name} 缺 anim`);
        assert.ok(existsSync(`${dir}/anim/${group.name}.anim.meta`), `${group.name}.anim 缺 .meta`);
        assert.ok(existsSync(`${dir}/${group.name}.prefab`), `${group.name} 缺 prefab`);
        assert.ok(existsSync(`${dir}/${group.name}.prefab.meta`), `${group.name}.prefab 缺 .meta`);
    }
});

test('受击特效：anim 逐帧引用都命中盘上的图，时长 = (帧数-1) / 18fps（末帧已去）', () => {
    for (const group of HIT_FX_GROUPS) {
        const dir = `${HIT_FX_ROOT}/${group.name}`;
        const anim = JSON.parse(readFileSync(`${dir}/anim/${group.name}.anim`, 'utf8'));
        const curve = anim._tracks[0]._channel._curve;
        // 🔴 2026-10-15「受击效果太久了」后改了口径：18fps + **去掉末帧**。
        // 末帧是暗色残留（不透明覆盖 10~13%、亮度降到最低），Normal(1) 会把它**定住**
        // ⇒ 视觉上「闪完了还有一坨东西杵着」。删掉末帧引用后，最后一步停在"无图"= 干净消失。
        const usedFrames = group.frames - 1;
        assert.equal(curve._values.length, usedFrames,
            `${group.name} 的 clip 应引用 ${usedFrames} 帧（全部 ${group.frames} 帧去掉末帧），实际 ${curve._values.length}`);
        // 时长 = 用到的帧数 / fps
        assert.ok(Math.abs(anim._duration - usedFrames / HIT_FX_FPS) < 1e-6,
            `${group.name} 时长应= ${usedFrames}/${HIT_FX_FPS} = ${(usedFrames / HIT_FX_FPS).toFixed(6)}，实际 ${anim._duration}`);
        assert.equal(anim.sample, HIT_FX_FPS, `${group.name} 的 sample 应 = ${HIT_FX_FPS}`);
        // wrapMode 必须是 Normal(1)：Loop(2) 会跳回第一帧继续闪，PingPong 会来回播。
        assert.equal(anim.wrapMode, 1,
            `${group.name} 的 wrapMode 应= 1(Normal，只播一遍)；2(Loop) 会跳回首帧继续闪`);
        // 每帧引用的 spriteFrame 都能在盘上找到对应 png
        const onDisk = new Set(readdirSync(dir).filter((f) => f.endsWith('.png')));
        const uuidToFile = new Map<string, string>();
        for (const png of onDisk) {
            const meta = readFileSync(`${dir}/${png}.meta`, 'utf8');
            const uuid = /"uuid": "([0-9a-f-]+)"/.exec(meta)?.[1];
            if (uuid) uuidToFile.set(uuid, png);
        }
        for (const value of curve._values) {
            const ref = String(value.__uuid__ ?? '');
            const base = ref.split('@')[0];
            assert.ok(uuidToFile.has(base),
                `${group.name} 的 clip 引用了不存在的图（${ref}）—— 该帧会静默留白`);
        }
        // 🔴 钉死"末帧确实被排除"：clip 最后一帧不能是盘上字典序最后那张（否则又定住了）。
        const lastBase = String(curve._values[curve._values.length - 1].__uuid__).split('@')[0];
        const lastOnDisk = [...onDisk].sort().at(-1)!;
        const lastDiskBase = /"uuid": "([0-9a-f-]+)"/.exec(readFileSync(`${dir}/${lastOnDisk}.meta`, 'utf8'))?.[1];
        assert.notEqual(lastBase, lastDiskBase,
            `${group.name} 的 clip 最后一帧仍是最末那张（${lastOnDisk}）⇒ 末帧被 Normal 定住，画面收不干净`);
    }
});

test('受击特效 prefab：layer=UI_2D、sizeMode=RAW、trim 关（抖动三连）', () => {
    for (const group of HIT_FX_GROUPS) {
        const prefab = readPrefab(`${HIT_FX_ROOT}/${group.name}/${group.name}.prefab`);
        const node = findType(prefab, 'cc.Node');
        const sprite = findType(prefab, 'cc.Sprite');
        assert.ok(node && sprite, `${group.name} prefab 结构异常`);
        assert.equal(node!._layer, 33554432,
            `${group.name} 的 layer 必须是 UI_2D(33554432)，落DEFAULT 就完全看不见`);
        assert.equal(sprite!._sizeMode, 2,
            `${group.name} 的 sizeMode 必须是 RAW(2)：各帧 trim 包围盒不同，CUSTOM 会忽大忽小地抖`);
        assert.equal(sprite!._isTrimmedMode, false,
            `${group.name} 的 trim 必须关，否则位置也跟着跳`);
        assert.ok(sprite!._spriteFrame, `${group.name} prefab 没绑首帧 spriteFrame`);
    }
});

test('受击特效 prefab：_lscale 把屏上宽度压到约 110px（与出生特效同量级）', () => {
    for (const group of HIT_FX_GROUPS) {
        const prefab = readPrefab(`${HIT_FX_ROOT}/${group.name}/${group.name}.prefab`);
        const node = findType(prefab, 'cc.Node')!;
        const ui = findType(prefab, 'cc.UITransform')!;
        const scale = node._lscale.x as number;
        const onScreenWidth = ui._contentSize.width * scale;
        const expectedWidth = HIT_FX_BASELINE_WIDTH * (group.sizeFactor ?? 1);
        assert.ok(Math.abs(onScreenWidth - expectedWidth) <= 1,
            `${group.name} 屏上宽 ${onScreenWidth.toFixed(1)}px，应约 ${expectedWidth.toFixed(0)}px`
            + `（基准 ${HIT_FX_BASELINE_WIDTH} × ${group.sizeFactor ?? 1}）`);
        assert.equal(ui._contentSize.width, group.width,
            `${group.name} 的 contentSize 应是帧的原始像素宽 ${group.width}`);
        assert.equal(ui._contentSize.height, group.height,
            `${group.name} 的 contentSize 应是帧的原始像素高 ${group.height}`);
    }
});

test('受击特效 prefab：锚点居中（跟着被打者中心），Animation 绑好 clip', () => {
    for (const group of HIT_FX_GROUPS) {
        const prefab = readPrefab(`${HIT_FX_ROOT}/${group.name}/${group.name}.prefab`);
        const ui = findType(prefab, 'cc.UITransform')!;
        const animation = findType(prefab, 'cc.Animation')!;
        assert.deepEqual({ x: ui._anchorPoint.x, y: ui._anchorPoint.y }, { x: 0.5, y: 0.5 },
            `${group.name} 锚点应居中：受击是贴在被打者身上的一下闪白，要跟着对方中心`);
        assert.equal(animation._clips.length, 1, `${group.name} 的 _clips 应恰好 1 条`);
        assert.ok(animation._defaultClip, `${group.name} 没绑 _defaultClip ⇒ play(clip.name) 找不到 clip`);
        assert.equal(animation._defaultClip.__uuid__, animation._clips[0].__uuid__,
            `${group.name} 的 _defaultClip 必须与 _clips[0] 同一条`);
        assert.equal(animation.playOnLoad, true, `${group.name} 应 playOnLoad`);
    }
});

test('阵亡特效：13 帧 + pac + anim + prefab 四件套齐全', () => {
    const frames = readdirSync(`${DEATH_FX_ROOT}/atlas`).filter((f) => f.endsWith('.png'));
    assert.equal(frames.length, 13, `死亡特效应有 13 帧，实际 ${frames.length}`);
    for (const frame of frames) {
        assert.ok(existsSync(`${DEATH_FX_ROOT}/atlas/${frame}.meta`), `${frame} 缺 .meta`);
    }
    assert.ok(existsSync(`${DEATH_FX_ROOT}/atlas/死亡特效.pac`), '缺 auto-atlas.pac（漏配不报错）');
    assert.ok(existsSync(`${DEATH_FX_ROOT}/anim/死亡特效.anim`), '缺 anim');
    assert.ok(existsSync(`${DEATH_FX_ROOT}/anim/死亡特效.anim.meta`), 'anim 缺 .meta');
    assert.ok(existsSync(`${DEATH_FX_ROOT}/死亡特效.prefab`), '缺 prefab');
    assert.ok(existsSync(`${DEATH_FX_ROOT}/死亡特效.prefab.meta`), 'prefab 缺 .meta');

    const anim = JSON.parse(readFileSync(`${DEATH_FX_ROOT}/anim/死亡特效.anim`, 'utf8'));
    assert.equal(anim._tracks[0]._channel._curve._values.length, 13, 'clip 应引用全部 13 帧');
    assert.ok(Math.abs(anim._duration - 13 / FPS) < 1e-6,
        `时长应 = 13/12 = ${(13 / FPS).toFixed(6)}，实际 ${anim._duration}`);
});

test('阵亡特效 prefab：RAW + trim 关 + 锚点底边（人物倒下时脚底不动）', () => {
    const prefab = readPrefab(`${DEATH_FX_ROOT}/死亡特效.prefab`);
    const node = findType(prefab, 'cc.Node')!;
    const ui = findType(prefab, 'cc.UITransform')!;
    const sprite = findType(prefab, 'cc.Sprite')!;
    const animation = findType(prefab, 'cc.Animation')!;
    assert.equal(node._layer, 33554432, 'layer 必须是 UI_2D');
    assert.equal(sprite._sizeMode, 2, 'sizeMode 必须 RAW(2)');
    assert.equal(sprite._isTrimmedMode, false, 'trim 必须关');
    // 死亡特效是竖长条（535×1092），底边锚点 + _lpos 让脚底与单位对齐。
    assert.deepEqual({ x: ui._anchorPoint.x, y: ui._anchorPoint.y }, { x: 0.5, y: 0 },
        '阵亡特效锚点应是底边 (0.5,0)：人物倒下时脚底不动');
    assert.equal(ui._contentSize.width, 535);
    assert.equal(ui._contentSize.height, 1092);
    // 🔴 2026-10-16 反馈「整体缩小成 0.8」：0.2056 → 0.16448，屏上 110×225 → 88×179.6。
    //   这条断言同时钉**倍数**与**屏上尺寸**：只钉一个算出的小数，将来基数被改坏查不出来。
    const expectedScale = DEATH_FX_BASELINE_SCALE * DEATH_FX_SIZE_FACTOR;
    assert.ok(Math.abs(node._lscale.x - expectedScale) < 1e-6,
        `_lscale.x 应是 ${expectedScale}（= ${DEATH_FX_BASELINE_SCALE} × ${DEATH_FX_SIZE_FACTOR}），实际 ${node._lscale.x}`);
    // x/y 必须**等比**：不等比会把爆开的形状拉扁，而「整体缩小」是等比缩放。
    assert.ok(Math.abs(node._lscale.y - node._lscale.x) < 1e-9,
        `_lscale 必须等比（x=${node._lscale.x}, y=${node._lscale.y}）——「整体缩小」不是单轴压扁`);
    const onScreenWidth = ui._contentSize.width * node._lscale.x;
    assert.ok(Math.abs(onScreenWidth - 110 * DEATH_FX_SIZE_FACTOR) <= 0.5,
        `阵亡特效屏上宽应约 ${110 * DEATH_FX_SIZE_FACTOR}px（= 110 基准 × ${DEATH_FX_SIZE_FACTOR}），实际 ${onScreenWidth.toFixed(1)}`);
    assert.equal(animation._clips.length, 1);
    assert.ok(animation._defaultClip, '没绑 _defaultClip ⇒ 特效不播');
});

/**
 * 「中毒受击」是**状态**不是职业 —— 它不能出现在 `ZCAttackTrait` 映射里，
 * 否则「中毒」看起来像第五个职业，将来加职业时又得回头改一遍加载侧。
 */
test('受击特效：加载侧只点名四个职业，「中毒」不进映射（它是状态不是职业）', () => {
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    const match = /HIT_FX_TRAITS: readonly ZCAttackTrait\[\] = \[([^\]]+)\]/.exec(loader);
    assert.ok(match, '找不到 HIT_FX_TRAITS 清单（加载侧的唯一真源）');
    const listed = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(listed.sort(), ['法师', '射手', '战士', '坦克'].sort(),
        'HIT_FX_TRAITS 必须是射手/战士/法师/坦克四个职业');
    assert.ok(!listed.includes('中毒受击'), '「中毒受击」是状态不是职业，不该进职业映射');
    // 职业类型本身也只有这四个（卡表 traits.attack 的取值集合）
    const catalog = readFileSync('assets/script/app/zcds/model/ZCCombatCatalog.ts', 'utf8');
    assert.match(catalog, /export type ZCAttackTrait = '射手' \| '坦克' \| '法师' \| '战士'/,
        'ZCAttackTrait 的取值变了，加载侧清单要同步');
});

/**
 * 加载器必须**逐个 load**、不 `loadDir`：`loadDir` 会把「中毒受击」那组
 * 和每个目录里的 `.pac` / `.anim` / 裸帧全捞回来，白白进内存还得再筛。
 */
test('受击特效：加载器容错加载 + 逐个点名，不 loadDir（别把中毒那组捞进来）', () => {
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    assert.ok(loader.includes('units/effects/死亡特效/死亡特效'), '缺 DEATH_FX_URL');
    assert.ok(loader.includes('loadDeathFxPrefab'), '缺阵亡特效容错加载器');
    assert.ok(loader.includes('loadHitFxPrefabs'), '缺受击特效加载器');
    assert.ok(loader.includes('units/effects/受击特效'), '缺 HIT_FX_DIRECTORY');
    // loadHitFxPrefabs 函数体内不能出现 loadDir
    const body = /private async loadHitFxPrefabs\([\s\S]*?\n    }/.exec(loader)?.[0] ?? '';
    assert.ok(body.length > 0, '找不到 loadHitFxPrefabs 实现');
    assert.ok(!body.includes('loadDir'),
        'loadHitFxPrefabs 禁用 loadDir：会把「中毒受击」那组和裸帧一起捞进来');
});

test('受击特效：模型按攻击方职业推事件 + 渲染层播放/回收，两端都接上了', () => {
    const model = readFileSync('assets/script/app/zcds/model/ZCGameModel.ts', 'utf8');
    assert.ok(model.includes('pushHitFx'), '模型层没有推受击特效的入口');
    assert.ok(model.includes('attackerTrait'), '没按攻击方职业取traits');
    assert.ok(/get hitFxs\(\)/.test(model), '模型层没暴露 hitFxs 只读出口');

    const world = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    // renderHitFxs 仍是渲染世界的受击入口（内部委托给 effectPool）。
    assert.ok(world.includes('renderHitFxs'), '渲染层没有受击特效委托入口');
    // 回收/播放逻辑已抽到 ZCEffectPool，渲染世界只负责委托。
    const pool = readFileSync('assets/script/app/zcds/view/ZCEffectPool.ts', 'utf8');
    assert.ok(pool.includes('recycleHitFx'), '缺回收入口 —— 受击特效会永久留在场上');
    // 回收判据走 clip 时长，不写死常量（改美术帧率不该让特效提前消失）
    assert.ok(pool.includes('clip.duration'), '受击特效时长应从 AnimationClip 读');
});

/**
 * 🔴 两级 id 曾经搞混 ⇒ 受击特效「一次都不播」（表现为**完全看不到**，零报错）。
 *
 *  - `source.unitId` 是**单位实例 id**（`state.nextUnitId`，从 1 递增）；
 *  - `ZCUnitState.unitId` 才是**卡牌 unitId**（`pvpCard.unitId`，68001 这种）；
 *  - `cards[owner]` 的键是**卡牌 id**（`card.id`，同样 68001）。
 *
 * 曾经写 `cards[owner].get(String(source.unitId))` —— 拿实例 id 去查卡表，**永远查不到**。
 * 正确链路必须是：**实例 id → `units.byId` → 实例的 `cardId` → 卡表 → `traits.attack`**。
 *
 * 🔴 这条是**源码级判据**：模型层没有能直接实例化的轻量夹具（`ZCGameModel` 依赖几十个模块），
 * 退化成"反查链路必须出现 `units.byId` + 用 `attacker.cardId` 查表"。
 * 它只能防「又写回错误写法」，防不住「换一种方式再错」—— 那要靠真机端到端。
 */
test('受击特效：攻击方职业按「实例 id → byId → cardId → 卡表」反查（两级 id 别搞混）', () => {
    const model = readFileSync('assets/script/app/zcds/model/ZCGameModel.ts', 'utf8');
    const body = /private traitOfAttacker\([\s\S]*?\n    }/.exec(model)?.[0] ?? '';
    assert.ok(body.length > 0, '找不到 traitOfAttacker 实现');
    assert.ok(/units\.byId\.get\(source\.unitId\)/.test(body),
        '必须先用 source.unitId（实例 id）经 units.byId 拿到单位实例 —— 直接拿实例 id 查卡表永远查不到');
    assert.ok(/cards\[[^\]]+\]\.get\(attacker\.cardId\)/.test(body),
        '必须用实例的 cardId 查卡表（cards 的键是卡牌 id，不是实例 id）');
    // 反过来钉死错误写法：不得直接拿 String(source.unitId) 当卡牌 id 查。
    // ⚠️ 只在**代码行**里查 —— 方法注释为了说明坑也写了这段字面量（自己踩过：判据把自己的注释当违规）。
    const codeLines = body.split('\n')
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')
            && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/**'));
    assert.ok(!codeLines.some((line) => /cards\[[^\]]+\]\.get\(\s*String\(source\.unitId\)/.test(line)),
        '🔴 又写回了「拿实例 id 当卡牌 id 查」⇒ 受击特效一次都不会播');
});

/**
 * 受击特效坐标必须过 `mapToViewX/Y` —— `ZCHitFx.x/y` 是**棋盘坐标**，
 * 而 node `setPosition` 吃 `mapLayer` 的**视图局部坐标**；不换算就飞到屏幕外。
 */
test('受击特效：setPosition 必须过 mapToViewX/Y（不换算就飞出屏幕外）', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    // 夹具默认 mapToViewX = x + 100、mapToViewY = y + 50（非恒等，可辨识）。
    const { effectPool, mapLayer } = makeEffectPool({ hitFxPrefabs: new Map([['法师', {
        make: () => {
            const node = new FakeNode('HitFx');
            node.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? { defaultClip: { name: 'hit', duration: 0.75 }, stop() {}, play() {} }
                : null)) as never;
            return node;
        },
    }]]) });
    effectPool.playHitFx(
        { id: 1, trait: '法师', owner: 'enemy', x: 10, y: 20, startedAt: 0, durationSeconds: 0.8 } as never,
        0,
    );
    assert.equal(mapLayer.children.length, 1, '有 prefab 时应播一条');
    const pos = mapLayer.children[0].position;
    assert.deepEqual({ x: pos.x, y: pos.y }, { x: 110, y: 70 },
        '受击特效必须用 mapToViewX/Y 把棋盘坐标 (10,20) 换算成视图坐标 (110,70)；直接用原坐标会飞出屏幕');
});

/** 缺 prefab 的职业要**跳过这一下**，不能崩也不能复用别的职业的闪白。 */
test('受击特效：这个职业没交 prefab 时跳过，不崩也不借用别的职业', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    const fx = { id: 1, trait: '法师', owner: 'enemy', x: 10, y: 20, startedAt: 0, durationSeconds: 0.8 } as never;
    const hitPrefab = {
        make: () => {
            const node = new FakeNode('HitFx');
            node.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? { defaultClip: { name: 'hit', duration: 0.75 }, stop() {}, play() {} }
                : null)) as never;
            return node;
        },
    };
    for (const hitFxPrefabs of [new Map(), new Map([['战士', hitPrefab]])]) {
        const missing = makeEffectPool({ hitFxPrefabs });
        missing.effectPool.playHitFx(fx, 0);
        assert.equal(missing.mapLayer.children.length, 0, '没有对应职业的 prefab 时跳过，不借用其他职业');
    }

    const { effectPool, mapLayer } = makeEffectPool({ hitFxPrefabs: new Map([['法师', hitPrefab]]) });
    effectPool.playHitFx(fx, 0);
    assert.equal(mapLayer.children.length, 1, '法师有 prefab 时该播一条');
    assert.equal(mapLayer.children[0].parent, mapLayer,
        '受击特效挂 mapLayer：不挂被打单位，否则它同帧被击杀移除时特效只闪半下');
});

/**
 * 🔴 2026-10-16 山猫「受击会停顿在角色上」的真因与判据。
 *
 * 模型层 `hitFxQueue` 保留到 `startedAt + HIT_FX_SECONDS(0.8s)`，而渲染世界每帧把**整条队列**
 * 送进特效池。若逐个直接 `playHitFx`，同一个 fx 在 0.8s 内会被 `animation.play()` 约 48 次，
 * 而 `play()` **无条件把动画 seek 回 0**（真引擎实测：每 tick 重播 ⇒ 8 帧里只出现第 0 帧；
 * 只播一次 ⇒ 8 帧全出）⇒ 动画被钉死在起始帧 = 一坨静止的特效杵在角色身上。
 *
 * 修法 = `syncHitFx` 按 fx（**对象引用**）去重，记录保留到 fx 离队并自我清理。
 */
test('受击特效：同一个 fx 跨多帧只播一次（不去重会把动画钉死在第 0 帧 = 停在角色上）', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    const hitPrefab = {
        make: () => {
            const node = new FakeNode('HitFx');
            node.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? { defaultClip: { name: 'hit', duration: 0.4444 }, stop() {}, play() {} }
                : null)) as never;
            return node;
        },
    };
    const { effectPool, mapLayer } = makeEffectPool({ hitFxPrefabs: new Map([['法师', hitPrefab]]) });
    const fx = { id: 1, trait: '法师', owner: 'enemy', x: 10, y: 20, startedAt: 0, durationSeconds: 0.8 } as never;

    // 模型队列在 0.8s 内每帧都还在（60fps ⇒ 48 帧）—— 渲染世界每帧把整条队列送进来。
    for (let frame = 0; frame < 48; frame += 1) effectPool.syncHitFx([fx], frame / 60);
    assert.equal(mapLayer.children.length, 1,
        '同一个 fx 只应建 1 个节点；建出多个 = 每帧都重新 play()，动画会被 seek 回第 0 帧 ⇒ 停住不动');

    // 动画（0.4444s）播完 ⇒ 节点回池；但 fx 还在队列里，**不能**被重新播一次。
    effectPool.recycleHitFx(0.5);
    assert.equal(mapLayer.children.length, 0, '动画播完应回池');
    effectPool.syncHitFx([fx], 0.5);
    assert.equal(mapLayer.children.length, 0,
        '同一 fx 播完后不得重播（动画 0.4444s < 队列 0.8s，剩下那段会被"重播一次"）');

    // fx 离队 ⇒ 去重记录自我清理（否则 Set 只增不减）；随后新的受击必须还能播。
    effectPool.syncHitFx([], 0.9);
    const next = { id: 2, trait: '法师', owner: 'enemy', x: 10, y: 20, startedAt: 0.95, durationSeconds: 0.8 } as never;
    effectPool.syncHitFx([next], 0.95);
    assert.equal(mapLayer.children.length, 1, 'fx 离队后新受击必须能播（去重表要自我清理）');
});

/**
 * 阵亡特效：**挂 `mapLayer`**（不挂宿主单位）+ 只播一次 + 播完回池。
 *
 * 🔴 为什么不挂宿主（2026-10-15 修的真 bug）：模型的 `DEATH_SECONDS = 0.45` 只让阵亡尸体
 * 停留 0.45s 就进 `removeDeadUnits` 出快照 ⇒ 宿主节点 0.45s 后被 `removeEntity` 回收。
 * 而死亡特效 13 帧 @12fps = **1.0833s** —— 挂宿主等于有 58% 的时间挂在**已销毁的父节点**上，
 * 表现为「特效没播完就突然消失」。
 * 挂 `mapLayer` + 起播时写一次坐标（阵亡单位不会再移动）就与宿主存活解耦。
 * 这条断言当初写反了（写的正是"必须挂单位节点"），是它把错误口径固化了一整轮。
 */
test('阵亡特效：挂 mapLayer 不挂宿主（宿主 0.45s 就没了）、判死只播一次、播完回池', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    const { effectPool, mapLayer } = makeEffectPool({ deathFxPrefab: {
        make: () => {
            const node = new FakeNode('DeathFx');
            node.getComponent = ((type: { name?: string }) => (type?.name === 'Animation'
                ? { defaultClip: { name: 'death', duration: 1.0833 }, stop() {}, play() {} }
                : null)) as never;
            return node;
        },
    } });

    // 传视图坐标（renderUnitEntity 里的 presentation.x/y，阵亡特效不再过 mapToView）。
    effectPool.playDeathFx(120, -60, 7, 0);
    assert.equal(mapLayer.children.length, 1, '判死那一帧应当播一条阵亡特效');
    const fx = mapLayer.children[0];
    assert.equal(fx.parent, mapLayer,
        '阵亡特效必须挂 mapLayer：宿主0.45s 后就被模型移除（DEATH_SECONDS），挂它身上特效会中途消失');
    assert.deepEqual({ x: fx.position.x, y: fx.position.y }, { x: 120, y: -60 },
        '坐标应取判死那一帧的视图坐标（阵亡单位不再移动，写一次就够）');

    // 同一个 unit.id 再判死一次 ⇒ 不重复播。
    effectPool.playDeathFx(120, -60, 7, 0);
    assert.equal(mapLayer.children.length, 1, '同一次阵亡只播一次（单位消失后会再走几帧）');

    // 🔴 关键回归：宿主在 0.45s 后消失（模型 removeDeadUnits），特效必须**继续播到 1.0833s**。
    // 旧实现挂宿主 ⇒ 这里就提前消失了（用户报的现象）。
    effectPool.recycleDeathFx(0.5);
    assert.equal(mapLayer.children.length, 1,
        '过了 0.45s（宿主被移除的时点）特效仍须存活 —— 这条红了就是挂回了宿主');
    // 未到时长不回收。
    effectPool.recycleDeathFx(1.0);
    assert.equal(mapLayer.children.length, 1, '没播完不该回收');
    // 1.09s 已过 clip 时长 1.0833（13 帧 @12fps），但早于兜底 1.1s —— 以此确认时长真从 clip 读。
    effectPool.recycleDeathFx(1.09);
    assert.equal(mapLayer.children.length, 0, '播完应回收（时长 1.0833 从 clip 读，不是兜底 1.1）');
    assert.equal(fx.parent, null, '回池前必须 removeFromParent，否则会留在场上');
});

/**
 * 一次性表现件（受击/阵亡/出生）都不在 `this.scene` 里 —— 不参与快照对账，
 * 所以 `destroy()` 必须显式销毁，否则节点泄漏到下一局。
 */
test('受击/阵亡/出生特效：destroy() 显式销毁全部在播节点，不靠 ECS 遍历', () => {
    const { FakeNode, makeEffectPool } = loadViews();
    const clip = (name: string, duration: number) => ((type: { name?: string }) => (type?.name === 'Animation'
        ? { defaultClip: { name, duration }, stop() {}, play() {} }
        : null)) as never;
    const { effectPool, mapLayer } = makeEffectPool({
        spawnFxPrefab: { make: () => Object.assign(new FakeNode('SpawnFx'), { getComponent: clip('spawn', 1.5) }) },
        deathFxPrefab: { make: () => Object.assign(new FakeNode('DeathFx'), { getComponent: clip('death', 1.0833) }) },
        hitFxPrefabs: new Map([['法师', { make: () => Object.assign(new FakeNode('HitFx'), { getComponent: clip('hit', 0.75) }) }]]),
    });

    const host = new FakeNode('ZCGameUnit');
    effectPool.playSpawnFx(host, 0);
    effectPool.playDeathFx(120, -60, 7, 0);
    effectPool.playHitFx(
        { id: 1, trait: '法师', owner: 'enemy', x: 10, y: 20, startedAt: 0, durationSeconds: 0.8 } as never,
        0,
    );

    const spawnNode = host.children[0];
    const deathNode = mapLayer.children.find((n) => n.name.includes('Death'));
    const hitNode = mapLayer.children.find((n) => n.name.includes('Hit'));
    assert.ok(spawnNode && deathNode && hitNode, '三类特效都应在播');

    effectPool.destroy();
    assert.equal(spawnNode.isValid, false, '出生特效节点必须被 destroy（不进 ECS，遍历收不到）');
    assert.equal(deathNode.isValid, false, '阵亡特效节点必须被 destroy');
    assert.equal(hitNode.isValid, false, '受击特效节点必须被 destroy');
    assert.equal(mapLayer.children.length, 0, '销毁后 mapLayer 不应残留特效节点');
});
