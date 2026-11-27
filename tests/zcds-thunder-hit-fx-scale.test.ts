import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZC_EFFECT_PATHS, zcEffectNodeScaleOf } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { assetPath } from './helpers/asset-paths';

/**
 * 雷电系**受击爆点**统一缩到 50%（2026-11-20 需求，两条美术各一条）。
 *
 * 需求原话：
 *   1. 「68016 和 68022 使用了磁电菇-子弹命中特效的预制，统一都改小成 50%，
 *      现在的受击效果太大了」；
 *   2. 追问后追加：「杰克藕（30717）那份 磁电菇_子弹命中 也缩」。
 *
 * 名字与链路对不上，这条最容易改错：
 *   · 68016 / 68022 共用普攻行 `30231 雷法师普攻`，它的 `impactEffectPrefabPath` 在
 *     11-06 换雷弹美术时已经从 `磁电菇_子弹命中` 改成了 **`雷弹命中`**
 *     （见 `tools/config/patch_leidan_art.js`）；
 *   · `磁电菇_子弹命中` 现在只挂在 **`30717 杰克藕普攻`**（68008 杰克藕）上。
 * 两份美术、两个键、两条倍率。改错那一份 = 「改了但画面一点没变」的静默失败。
 *
 * 为什么挂 `nodeScale` 而不是改 prefab 的 `_lscale`：
 * 命中爆点是 `area` 事件，视觉尺寸 100% 来自 prefab 烘焙值、视图不按 `event.radius` 缩放，
 * 所以「缩到 N%」只能走宿主倍率（与椰蛋暴风 0.7 / 冲锋 0.4 同一口径）。
 */

const ROOT = join(__dirname, '..');

/** 68016 / 68022：`pvpSkill 30231` 的 `impactEffectPrefabPath`（本体烘焙 0.7）。*/
const IMPACT = ZC_EFFECT_PATHS.thunderBulletImpact;
/** 杰克藕：`pvpSkill 30717` 的 `impactEffectPrefabPath`（本体烘焙 0.4）。*/
const JIEKEOU_IMPACT = ZC_EFFECT_PATHS.cidianBulletImpact;
/** 两张卡共用的普攻行 / 杰克藕的普攻行。*/
const ATTACK_SKILL_ID = 30231;
const JIEKEOU_SKILL_ID = 30717;
/** 用户要的倍率（两条同一口径）。*/
const REQUIRED_SCALE = 0.5;

interface IPacked {
    k: string[];
    v: unknown[][];
}

/** client 副本在仓库上一级（`doc/塔防数据配置/json/client`），remoteRef 在工程内。*/
const CLIENT = '../doc/塔防数据配置/json/client';

function readRows(relative: string): Array<Record<string, any>> {
    const source = JSON.parse(readFileSync(join(ROOT, relative), 'utf8')) as
        | Array<Record<string, unknown>>
        | IPacked;
    if (Array.isArray(source)) return source as Array<Record<string, any>>;
    return (source as IPacked).v.map(
        (values) => Object.fromEntries((source as IPacked).k.map((key, index) => [key, values[index]])),
    );
}

/** prefab 根节点 UITransform 的 `_contentSize`（= 帧图画布）。*/
function rootContentSize(prefabPath: string): { width: number; height: number } {
    const entries = JSON.parse(
        readFileSync(join(ROOT, assetPath(`${prefabPath}.prefab`)), 'utf8'),
    ) as Array<Record<string, any>>;
    const transform = entries.find((entry) => entry.__type__ === 'cc.UITransform');
    assert.ok(transform, `${prefabPath} 缺 UITransform`);
    return transform!._contentSize as { width: number; height: number };
}

/** prefab 根节点（唯一那层 `cc.Node`）的 `_lscale.x`。*/
function rootScale(prefabPath: string): number {
    const entries = JSON.parse(
        readFileSync(join(ROOT, assetPath(`${prefabPath}.prefab`)), 'utf8'),
    ) as Array<Record<string, any>>;
    const roots = entries.filter((entry) => entry.__type__ === 'cc.Node' && entry._parent === null);
    assert.equal(roots.length, 1, `${prefabPath} 根节点应恰好 1 个，实际 ${roots.length}`);
    return roots[0]._lscale.x;
}

test('① 宿主倍率 = 0.5：烘焙 0.7 × 0.5 = 屏上 0.35', () => {
    assert.equal(zcCombatEffectNodeScaleOf(IMPACT), REQUIRED_SCALE, 'facade 倍率');
    assert.equal(zcEffectNodeScaleOf(IMPACT), REQUIRED_SCALE, '目录倍率（facade 只是它的转发）');
    const baked = rootScale(IMPACT);
    assert.ok(Math.abs(baked - 0.7) < 1e-6, `美术烘焙应仍是 0.7，实际 ${baked}`);
    assert.ok(Math.abs(baked * REQUIRED_SCALE - 0.35) < 1e-6, '屏上终值应是 0.35');
});

test('② 只落在这两张卡上：30231 两份产物都指向它，pvpCard 里只有 68016 / 68022 用 30231', () => {
    for (const relative of [
        'assets/remoteRef/pvpSkill.json',
        `${CLIENT}/pvpSkill.json`,
    ]) {
        const row = readRows(relative).find((item) => Number(item.skillId) === ATTACK_SKILL_ID);
        assert.ok(row, `${relative} 里找不到技能 ${ATTACK_SKILL_ID}`);
        //  改配表把命中换成别的 prefab 时，这条会立刻红 —— 倍率必须跟着挪到新路径上。
        assert.equal(row!.impactEffectPrefabPath, IMPACT, `${relative} 的 30231 命中爆点`);
    }
    const owners = readRows(`${CLIENT}/pvpCard.json`)
        .filter((card) => Number(card.unitSkillId) === ATTACK_SKILL_ID)
        .map((card) => Number(card.unitId))
        .sort((a, b) => a - b);
    assert.deepEqual(owners, [68016, 68022], '30231 的使用者必须是磁电菇 + 雷蕉');
});

test('③ 杰克藕那份：贴图已按屏上尺寸重烘（62×80），prefab 与目录倍率都归 1', () => {
    //  2026-11-26：旧值是 prefab 0.4 × 目录 0.5 = 屏上 0.2。现在两层倍率都去掉，
    //  尺寸落在贴图上（458×495 裁掉空白 → 308×401 内容 → 重烘 62×80）。
    assert.equal(zcCombatEffectNodeScaleOf(JIEKEOU_IMPACT), 1, '宿主不再挂倍率');
    assert.equal(zcEffectNodeScaleOf(JIEKEOU_IMPACT), 1, '目录不再挂倍率');
    const baked = rootScale(JIEKEOU_IMPACT);
    assert.ok(Math.abs(baked - 1) < 1e-6, `美术烘焙应归 1，实际 ${baked}`);
    const size = rootContentSize(JIEKEOU_IMPACT);
    assert.deepEqual([size.width, size.height], [62, 80], '画布 = 帧图 = 屏上尺寸');
    //  别把两条合并成一个键：它们是两份独立美术（雷弹命中仍是 0.7 × 0.5 = 0.35）。
    assert.ok(Math.abs(rootScale(IMPACT) - baked) > 1e-6, '两份美术的烘焙值不同');
});

test('④ 杰克藕那条只挂在 30717 上，且 pvpCard 里只有 68008 用它', () => {
    for (const relative of [
        'assets/remoteRef/pvpSkill.json',
        `${CLIENT}/pvpSkill.json`,
    ]) {
        const row = readRows(relative).find((item) => Number(item.skillId) === JIEKEOU_SKILL_ID);
        assert.ok(row, `${relative} 里找不到技能 ${JIEKEOU_SKILL_ID}`);
        assert.equal(row!.impactEffectPrefabPath, JIEKEOU_IMPACT, `${relative} 的 30717 命中爆点`);
    }
    const owners = readRows(`${CLIENT}/pvpCard.json`)
        .filter((card) => Number(card.unitSkillId) === JIEKEOU_SKILL_ID)
        .map((card) => Number(card.unitId));
    assert.deepEqual(owners, [68008], '30717 的使用者只有杰克藕');
});
