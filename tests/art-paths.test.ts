/**
 * 美术路径 ↔ 磁盘资源 的一致性守卫。
 *
 * 起因：2026-09-15 美术目录统一收进 assetPath(`image/**`)（卡牌阵容的图还从
 * `main/` 挪到了 `card/`），而各模块里写的是裸子目录（`main` / `matching` / `buildings`）。
 * `resources.load` 找不到路径时**只打一条 warn、返回 null**，界面表现为「静默留白」——
 * 不报错、不崩，最容易当成代码写错查半天。
 *
 * 这里把「代码里用到的每个资源名」和「磁盘上真实存在的 png」对一遍：
 * 根目录一律取 `app/ArtPaths.ts`（唯一来源），资源名从各模块自己的表 / 配置组里读，
 * 所以改图、挪目录、改名都会在这里先红，而不是等到跑界面才发现。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    CARD_ART_ROOT,
    FRAME_ART_ROOT,
    ICON_ART_ROOT,
    GAMEUI_ART_ROOT,
    MAIN_CITY_ART_ROOT,
    MATCH_ART_ROOT,
    BUILDING_ART_ROOT,
} from '../assets/script/app/ArtPaths';
import { ZC_CARD_CLASSES } from '../assets/script/app/card/CardLineupTypes';
import { cardArtConfig } from './helpers/card-art-config';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import { RL_ART_NAMES, roleArtRelPath } from '../assets/script/app/role/RoleArt';
import { MILITIA_ARMY_ID } from '../assets/script/app/role/MilitiaTypes';
import { getGuideIconPath } from '../assets/script/app/zcds/model/ZCGuideConfig';
import { assetExists, assetPath } from './helpers/asset-paths';

/** 断言 `<root>/<name>.png` 真实存在。 */
function assertSpriteExists(root: string, name: string, hint: string): void {
    assert.ok(name, `${hint}：资源名为空`);
    const file = assetPath(`${root}/${name}.png`);
    assert.ok(existsSync(file), `${hint}：缺少美术 ${file}（根目录来自 ArtPaths，别在别处另写一份）`);
}

/** 源码里 import 了 ArtPaths 才算「根目录走唯一来源」。 */
function assertUsesArtPaths(source: string, hint: string): void {
    assert.match(source, /from '[^']*ArtPaths'/, `${hint}：资源路径必须取自 app/ArtPaths.ts，不要写裸子目录字面量`);
}

/**
 * 卡牌阵容 / 布阵两页用到的图分三个根目录，**不能一律按 `image/card` 找**：
 *   - `image/card`：卡面、站台底座、品级垫盘；
 *   - `icons/card`：职业角标（`yx_zhiye_*`）；
 *   - `icons/cardHead`：角色立绘与兵种头像；
 *   - `image/frame`：布阵卡池卡框（`common_img_pzk_*`）。
 *
 *  2026-09-15 美术收编时 `class_*` 从 `card` 挪到了 `icon`，但旧代码仍
 * 只按 `image/card` 根目录加载 → 角标**一直静默留白**
 * （`resources.load` 只打一条 warn），这条用例是当时唯一的报警点。
 */
test('卡牌阵容 / 布阵的每张图都在它自己的根目录下', () => {
    for (const [key, path] of cardArtConfig.paths) {
        const cut = path.lastIndexOf('/');
        assertSpriteExists(path.slice(0, cut), path.slice(cut + 1), key);
    }
    const badges = ZC_CARD_CLASSES.map(key => cardArtConfig.paths.get(`badge.${key}`));
    assert.equal(new Set(badges).size, ZC_CARD_CLASSES.length);
    assert.equal(badges.filter(path => path?.includes('/camp_')).length, 0, '立绘不再走职业雕像');
});

/** 用 vm 读取主城底栏文案配置，避免加载 Cocos runtime。 */
function readNavGroup(): Array<{ name: string }> {
    const code = ts.transpileModule(readFileSync('assets/script/app/main/MainTabItems.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const context = {
        exports: {} as { MAIN_TAB_ITEMS: Array<{ name: string }> },
        console,
    };
    runInNewContext(code, context);
    return context.exports.MAIN_TAB_ITEMS;
}

test('主城七格文案配置与 prefab 绑定的新图标资源齐全', () => {
    const group = readNavGroup();
    assert.equal(group.length, 7, '蓝湖「塔防主界面-1」是七格：商店 / 英雄 / 角色 / 领地 / 挑战 / 联盟 / 世界');

    // 配置组来自另一个 vm realm，必须用 Array.from 在本 realm 重建数组，
    // 否则 deepStrictEqual 会因为 Array 原型不同而误报不等。
    assert.deepEqual(Array.from(group, (entry) => entry.name), [
        '商店', '英雄', '角色', '领地', '挑战', '联盟', '世界',
    ]);

    for (const icon of ['nav_shop', 'nav_hero', 'nav_role', 'nav_territory', 'nav_challenge', 'nav_alliance', 'nav_world']) {
        assertSpriteExists(MAIN_CITY_ART_ROOT, icon, `${icon} 由 TabButton prefab 实例绑定`);
    }
    for (const oldIcon of [
        'btm_arena_n', 'btm_arena_s', 'btm_char_n', 'btm_char_s', 'btm_shop_n', 'btm_shop_s',
        'btn_adventure_n', 'btn_adventure_s', 'btn_alliance_n', 'btn_alliance_s', 'btn_territory_n', 'btn_territory_s',
    ]) {
        assert.equal(assetExists(`image/main/${oldIcon}.png`), false, `${oldIcon} 旧底栏资源应已删除`);
        assert.equal(assetExists(`image/main/${oldIcon}.png.meta`), false, `${oldIcon} 旧资源 meta 应随资源删除`);
    }
    assert.equal(assetExists('ui/card/CardLineupNav.prefab'), false,
        '旧主城导航 prefab 应已由共用 TabButton 取代');
    assert.equal(existsSync('assets/script/app/card/CardLineupNav.ts'), false,
        '旧私有导航视图类应已移除，主城只保留文案配置');

    // 选中底板与底条也必须在盘上
    assertSpriteExists(MAIN_CITY_ART_ROOT, 'nav_sel', '选中底板（tab_02）');
    assertSpriteExists(MAIN_CITY_ART_ROOT, 'nav_bg', '底栏底条（bg_01）');

    // 配置组只有一份：老的 CARD_LINEUP_NAV_ART 副本必须已经删掉
    const texts = readFileSync('assets/script/app/card/CardLineupTexts.ts', 'utf8');
    assert.ok(!texts.includes('CARD_LINEUP_NAV_ART'), '七格图标名不要再在 CardLineupTexts 里留第二份');
    assert.match(readFileSync('assets/script/app/main/MainTabItems.ts', 'utf8'), /MainRoot\.prefab/,
        'tab 图标与类型应由主城 prefab 实例维护');
});

test('匹配页图标走 MATCH_ART_ROOT 根目录', () => {
    // 页面大图：头像 / 雷达
    assertSpriteExists(MATCH_ART_ROOT, 'tx_01', '匹配头像');
    assertSpriteExists(MATCH_ART_ROOT, 'icon_fdj', '匹配雷达图标');
    // ⚠️ 神器图标**不在这里**：`image/matching/icon_faqi.png`（固定蓝色法杖占位）已于
    //  2026-10-13 随匹配界面改版删除，真源是 `ARTIFACT_ART_ROOT`
    //  （`image/artifact/<pvpArtifact[].icon>`，与对局里的神器格同一张图），
    //  口径见 `tests/matching-artifact-icon.test.ts`。

    // 匹配常规 UI 与槽位视觉组件均在 MATCH_ART_ROOT
    assertUsesArtPaths(readFileSync('assets/script/app/matching/MatchingResourcePlan.ts', 'utf8'), 'MatchingResourcePlan');
    assertUsesArtPaths(readFileSync('assets/script/app/common/SpriteFrameCache.ts', 'utf8'), '公共图标加载器');
    assertUsesArtPaths(readFileSync('assets/script/app/matching/MatchPlayerItem.ts', 'utf8'), 'MatchPlayerItem');
    assertUsesArtPaths(readFileSync('assets/script/app/bootstrap/matching/MatchingComposition.ts', 'utf8'), 'ProcedureMatching');
});

/**
 * 信息条小图标目录 icons/matching 整体下线（原 icon_01~icon_04 为旧版阵容阵营职业统计小图标，
 * 匹配界面重构为 8 格卡牌后已无任何运行时引用与渲染，MatchStatItem 预制体也一并下线）。
 */
test('匹配页信息条小图标目录 icons/matching 整体已退役', () => {
    for (const name of ['icon_01', 'icon_02', 'icon_03', 'icon_04', 'icon_05', 'char_01', 'char_02']) {
        // 负向断言用 assetExists（assetPath 找不到会直接抛，那是正向读取的口径）。
        assert.equal(assetExists(`icons/matching/${name}.png`), false, `${name} 已退役，别放回 icons/matching`);
    }
});

/**
 * 指南图标表住在 `model/ZCGuideConfig.ts`（`ui/ZCGuideConfig.ts` 只剩 re-export +
 * 颜色常量）。曾经这里读的是 ui 那份 —— 路径表搬走后用例只会拿 re-export 文件去匹配
 * `spriteFramePath(...)`，永远匹配不到任何一条，于是「美术删了图」也报不出来。
 */
test('战斗指南的图标都在 image 下', () => {
    const source = readFileSync('assets/script/app/zcds/model/ZCGuideConfig.ts', 'utf8');
    assertUsesArtPaths(source, 'ZCGuideConfig');

    const roots: Record<string, string> = { BUILDING_ART_ROOT, GAMEUI_ART_ROOT };
    const found: string[] = [];
    const expression = /spriteFramePath\(\s*([A-Z_]+)\s*,\s*'([^']+)'\s*\)/g;
    for (const match of source.matchAll(expression)) {
        const root = roots[match[1]];
        assert.ok(root, `ZCGuideConfig 用了未登记的根目录常量：${match[1]}`);
        assertSpriteExists(root, match[2], `指南图标（${match[1]}）`);
        found.push(match[2]);
    }
    assert.deepEqual(found, ['mine', 'barracks-default', 'icon_question']);
});

/**
 * 反向守卫：**表里用到的每个 icon 键都必须能解析出磁盘真实存在的图**。
 *
 * 2026-09-30 的教训：`zcGuide.json` 的 `icon` 列写「兵营」，而登记表还指着
 * r361 已被美术删掉的 `barracks-icon` ⇒ 运行期只有
 * `Bundle resources doesn't contain image/buildings/barracks-icon/spriteFrame`
 * 一条 warn，卡片照渲染、只是六边形里空着。键名从表里扫出来（不抄一份名单），
 * 表里加新图标、美术删图，这里都会先红。
 */
test('指南表里每个 icon 键都能解析出真实存在的图', () => {
    const table = JSON.parse(readFileSync('assets/remoteRef/zcGuide.json', 'utf8')) as {
        k: string[];
        v: unknown[][];
    };
    const iconColumn = table.k.indexOf('icon');
    assert.ok(iconColumn >= 0, 'zcGuide.json 的列定义里没有 icon，正则该跟着表改');

    const keys = [...new Set(table.v.map((row) => String(row[iconColumn])))];
    assert.ok(keys.length >= 3, `表里只扫到 ${keys.length} 个 icon 键，正则该跟着表改`);
    for (const key of keys) {
        const path = getGuideIconPath(key);
        assert.ok(path, `zcGuide.json 的 icon「${key}」没有登记在 GUIDE_ICON_PATHS 里（会静默无图标）`);
        const rel = path.replace(/\/spriteFrame$/, '.png');
        assert.ok(assetExists(rel), `指南图标「${key}」缺少美术 ${rel}`);
    }
});

// ============================================================
// 角色模块运行时美术路径
// ============================================================

test('角色运行时美术键解析为 image 下实际存在的资源路径', () => {
    for (const [key, value] of Object.entries(RL_ART_NAMES)) {
        const rel = roleArtRelPath(key);
        assert.equal(rel, `${ArtPaths.ART_ROOT}/${value}`);
        assert.ok(['png', 'jpg', 'jpeg'].some(ext => assetExists(`${rel}.${ext}`)), `缺少角色美术 ${rel}`);
    }
});

test('角色美术路径对未知键返回空串', () => {
    assert.equal(roleArtRelPath('不存在的key'), '');
    assert.equal(roleArtRelPath('constructor'), '');
});

// ============================================================
// 民兵天赋图标（`icons/militia/<图标_民兵天赋_N_0|1>`，42 张）
// ============================================================

/** `armyLevel.json`（k/v 表）里民兵兵种用到的所有基础图标名（`图标_民兵天赋_N`）。 */
function militiaBaseIcons(): string[] {
    const table = JSON.parse(readFileSync('assets/remoteRef/armyLevel.json', 'utf8')) as {
        k: string[]; v: unknown[][];
    };
    const iId = table.k.indexOf('id');
    const iIcon = table.k.indexOf('icon');
    const set = new Set<string>();
    for (const row of table.v) {
        if (Number(row[iId]) !== MILITIA_ARMY_ID) continue;
        const icon = row[iIcon];
        if (typeof icon === 'string' && icon) set.add(icon);
    }
    return [...set];
}

test('民兵天赋图标：配置表用到的每个 key 在 icons/militia 下都有图（缺一张就是静默留白 + 一条 warn）', () => {
    const bases = militiaBaseIcons();
    assert.equal(bases.length, 21, `配置表里民兵天赋基础图标应 21 个，实际 ${bases.length} 个`);

    const missing: string[] = [];
    for (const base of bases) {
        for (const state of ['_0', '_1']) {
            const rel = `icons/militia/${base}${state}.png`;
            if (!assetExists(rel)) missing.push(rel);
        }
    }
    assert.deepEqual(missing, [], `缺图（共需 ${bases.length * 2} 张）`);

    // 目录口径钉死：`icons/` 与 `image/` 平级 ⇒ 不许拼 image 前缀（规则 137）
    const roots = readFileSync('assets/script/app/role/RoleArtLoader.ts', 'utf8');
    assert.match(roots, /militia:\s*'icons\/militia'/, "BAG_ICON_ROOTS.militia 必须是 'icons/militia'");
});
