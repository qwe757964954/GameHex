import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import {
    ZC_BOSS_WARNING_ANIMATION,
    ZC_BOSS_WARNING_FALLBACK_SECONDS,
    zcShouldPlayBossWarning,
} from '../assets/script/app/zcds/model/ZCBossWarningStyle';
import { ZC_BATTLE_FX_PATHS } from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import { ZC_UI_BANNER_WIDTH, zcUiBannerScale } from '../assets/script/app/zcds/model/ZCUISpineBannerStyle';

/**
 * 塔防 BOSS 波预警 UI 特效（2026-11-26 第 57 批）。
 *
 * 需求原文：「塔防模式，触发 boss 波次的时候播放预警 UI 特效，给特效制作格式一致的预制，
 * 特效的宽度要匹配 720px」。
 *
 * 「格式一致」= 与 `开局对战UI特效` / `胜利失败UI特效` 同一套预制结构：
 * 根节点（scale = 720 ÷ 画布宽）+ `UITransform`（画布尺寸、锚点居中）+ `sp.Skeleton`（prefab 声明动画与预乘透明）。
 */

const EFFECTS = 'assets/bundles/battle/units/effects';
const BOSS_DIR = `${EFFECTS}/BOSS来袭UI特效`;
const BOSS_PREFAB = `${BOSS_DIR}/BOSS来袭UI特效.prefab`;
const HUD_SOURCE = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
const GAME_SOURCE = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');

interface IPrefabObject { __type__: string; _name?: string; [key: string]: unknown }

function readPrefab(path: string): IPrefabObject[] {
    return JSON.parse(readFileSync(path, 'utf8')) as IPrefabObject[];
}

function pngSize(path: string): { width: number; height: number } {
    const head = readFileSync(path).subarray(0, 24);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const bossPrefab = readPrefab(BOSS_PREFAB);
const bossRoot = bossPrefab.find(item => item.__type__ === 'cc.Node')!;
const bossTransform = bossPrefab.find(item => item.__type__ === 'cc.UITransform')!;
const bossSkeleton = bossPrefab.find(item => item.__type__ === 'sp.Skeleton')!;
const canvas = pngSize(`${BOSS_DIR}/ddz_jinggao_ani.png`);

test('① 预制结构与本类 UI 特效逐项一致（同一套四件套）', () => {
    // 兄弟预制是「格式一致」的基准，任何一条结构差异都要么是对齐、要么是有意为之。
    for (const sibling of ['开局对战UI特效', '胜利失败UI特效']) {
        const other = readPrefab(`${EFFECTS}/${sibling}/${sibling}.prefab`);
        assert.deepEqual(bossPrefab.map(item => item.__type__), other.map(item => item.__type__),
            `${sibling} 的组件序列必须与本预制相同`);
        // 根节点名 = 预制名（`syncNodeName` 的依据）。
        assert.equal((other.find(item => item.__type__ === 'cc.Node') as IPrefabObject)._name, sibling);
    }
    assert.equal(bossRoot._name, 'BOSS来袭UI特效');
    const prefabHead = bossPrefab.find(item => item.__type__ === 'cc.Prefab')!;
    assert.equal(prefabHead._name, 'BOSS来袭UI特效');

    // 三个 CompPrefabInfo / PrefabInfo 的 fileId 必须按节点名区分，撞了会让编辑器合并成同一个组件。
    const fileIds = bossPrefab.filter(item => item.__type__ === 'cc.CompPrefabInfo' || item.__type__ === 'cc.PrefabInfo')
        .map(item => (item as { fileId?: string }).fileId);
    assert.deepEqual(fileIds, ['BOSS来袭UI特效_uitransform', 'BOSS来袭UI特效_skeleton', 'BOSS来袭UI特效_root']);
});

test('② 宽度匹配 720：画布 496 × 节点缩放 = 720', () => {
    assert.deepEqual(canvas, { width: 496, height: 496 }, 'PNG 画布尺寸就是 UITransform 的口径');
    const size = bossTransform._contentSize as { width: number; height: number };
    assert.deepEqual([size.width, size.height], [canvas.width, canvas.height], 'UITransform 必须等于画布尺寸');
    const anchor = bossTransform._anchorPoint as { x: number; y: number };
    assert.deepEqual([anchor.x, anchor.y], [0.5, 0.5], '锚点居中，720 才是「以屏幕中心铺满」');

    const scale = bossRoot._lscale as { x: number; y: number; z: number };
    assert.ok(Math.abs(scale.x - ZC_UI_BANNER_WIDTH / canvas.width) < 1e-12,
        `缩放 = 720 ÷ 画布宽，实际 ${scale.x}`);
    assert.equal(scale.y, scale.x, '等比缩放，不能把字压扁');
    assert.ok(Math.abs(canvas.width * scale.x - ZC_UI_BANNER_WIDTH) < 1e-9, '屏上宽度 = 720');
    // 换算函数与写死值必须给出同一个数：将来改画布只改 prefab，别看代码。
    assert.ok(Math.abs(zcUiBannerScale(canvas.width) - scale.x) < 1e-12, '与通用 720 换算同口径');

    // 兄弟预制同一口径（560 → 9/7、744 → 720/744），这条是「格式一致」的证据。
    assert.ok(Math.abs(zcUiBannerScale(560) - 1.2857142857142858) < 1e-12);
    assert.ok(Math.abs(zcUiBannerScale(744) - 0.967741935483871) < 1e-12);
});

test('③ 骨架引用、动画名与播完即收的参数', () => {
    const skelMeta = JSON.parse(readFileSync(`${BOSS_DIR}/ddz_jinggao_ani.skel.meta`, 'utf8'));
    assert.equal((bossSkeleton._skeletonData as { __uuid__: string }).__uuid__, skelMeta.uuid,
        'prefab 引的必须就是这枚 .skel 的 uuid');
    assert.equal(bossSkeleton.defaultAnimation, 'ddz_jinggao_ani');
    assert.equal(ZC_BOSS_WARNING_ANIMATION, bossSkeleton.defaultAnimation, '代码里的动画名与 prefab 同源');
    //  动画名不是按文件名猜的：骨架二进制里就有这一段。
    assert.ok(readFileSync(`${BOSS_DIR}/ddz_jinggao_ani.skel`).includes(Buffer.from(ZC_BOSS_WARNING_ANIMATION)),
        'skel 里必须真的有这段动画');
    assert.equal(bossSkeleton.loop, false, '预警只播一次，不能循环');
    assert.equal(bossSkeleton._premultipliedAlpha, false, '与兄弟预制一致：非预乘，否则边缘发黑');
    assert.equal(bossSkeleton._timeScale, 1);
    assert.equal(bossSkeleton._srcBlendFactor, 2);
    assert.equal(bossSkeleton._dstBlendFactor, 4);
    assert.ok(ZC_BOSS_WARNING_FALLBACK_SECONDS > 0);
});

test('④ 预制 meta 能被编辑器认（importer / syncNodeName / uuid 唯一）', () => {
    const meta = JSON.parse(readFileSync(`${BOSS_PREFAB}.meta`, 'utf8'));
    assert.equal(meta.importer, 'prefab');
    assert.equal(meta.userData.syncNodeName, 'BOSS来袭UI特效');
    assert.match(meta.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const sibling of ['开局对战UI特效', '胜利失败UI特效', '大招技能提示特效']) {
        const other = JSON.parse(readFileSync(`${EFFECTS}/${sibling}/${sibling}.prefab.meta`, 'utf8'));
        assert.notEqual(meta.uuid, other.uuid, `uuid 不能与 ${sibling} 撞`);
    }
    //  prefab 本身有内容（空文件 / 只有 `[]` 时编辑器会静默不导入）。
    assert.ok(statSync(BOSS_PREFAB).size > 1024);
});

test('⑤ 触发判据：守城局 + BOSS 波 + 同一波只播一次', () => {
    const boss = (waveId: number | null, isBoss = true) => ({ currentWaveId: waveId, currentWaveIsBoss: isBoss });
    assert.equal(zcShouldPlayBossWarning(null, null), false, '非塔防局不播');
    assert.equal(zcShouldPlayBossWarning(boss(2, false), null), false, '普通波不播');
    assert.equal(zcShouldPlayBossWarning(boss(6), null), true, 'BOSS 波首次触发 ⇒ 播');
    assert.equal(zcShouldPlayBossWarning(boss(6), 6), false, '同一波每帧都来，只播一次');
    assert.equal(zcShouldPlayBossWarning(boss(9), 6), true, '多段 BOSS：下一波照播');
    assert.equal(zcShouldPlayBossWarning(boss(null), null), false, '还没轮到某波（无 currentWaveId）不播');
    assert.equal(zcShouldPlayBossWarning(undefined, null), false);
    //  非有限数不能当波 id（NaN 会被 `!==` 判成"换了一波"，每帧重播）。
    assert.equal(zcShouldPlayBossWarning({ currentWaveId: Number.NaN, currentWaveIsBoss: true }, null), false);
});

test('⑥ 接线：资源计划 → ZCGame 只在守城局加载 → HUD 每帧判一次并播完即收', () => {
    assert.equal(ZC_BATTLE_FX_PATHS.bossWarningBanner, 'units/effects/BOSS来袭UI特效/BOSS来袭UI特效');
    assert.match(GAME_SOURCE, /private loadBossWarningBanner\(\): void \{/);
    assert.match(GAME_SOURCE, /if \(!this\.matchConfig\?\.pveDefence\) return;/, '只有塔防局才拉这个预制');
    assert.match(GAME_SOURCE,
        /this\.loadBattlePrefab\(ZC_BATTLE_FX_PATHS\.bossWarningBanner, 'BOSS来袭预警特效', \(prefab\) => \{\s*if \(!this\.hudView\) return;\s*this\.hudView\.setBossWarningEffect\(prefab\);/);
    assert.match(GAME_SOURCE, /this\.loadBossWarningBanner\(\);/, '加载要在 createGame 里发起');

    //  HUD：每帧喂进度再判一次（不含"当前帧是不是 BOSS 波"这种每帧都真的写法）。
    assert.match(HUD_SOURCE, /this\.bossWarningProgress = defence;\s*this\.playBossWarningEffect\(\);/);
    assert.match(HUD_SOURCE,
        /if \(!zcShouldPlayBossWarning\(progress, this\.bossWarningWaveId\)\) return;/,
        '去重判据只认零 cc 的纯函数');
    assert.match(HUD_SOURCE, /this\.bossWarningWaveId = progress\.currentWaveId;/, '记下这一波，避免重播');
    assert.match(HUD_SOURCE,
        /createZCUISpineBannerNode\(prefab, ZC_BOSS_WARNING_ANIMATION, this\.node, \{/,
        '复用 720 横幅播放器，不另造一套');
    assert.match(HUD_SOURCE,
        /clip > 0 \? clip \+ 0\.1 : ZC_BOSS_WARNING_FALLBACK_SECONDS/, '播完即收，读不到时长走兜底');
    assert.match(HUD_SOURCE, /this\.clearBossWarningBanner\(\);\s*this\.bossWarningPrefab = null;/,
        'onDestroy 必须收干净（节点挂在 HUD 根上，留着会叠到下一局）');
});
