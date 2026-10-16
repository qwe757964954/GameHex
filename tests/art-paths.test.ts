/**
 * 美术路径 ↔ 磁盘资源 的一致性守卫。
 *
 * 起因：2026-09-15 美术目录统一收进 `assets/resources/image/**`（卡牌阵容的图还从
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
    MAIN_ART_ROOT,
    MATCH_ART_ROOT,
    MATCH_ICON_ART_ROOT,
    BUILDING_ART_ROOT,
} from '../assets/script/app/ArtPaths';
import { CARD_LINEUP_TEXTS } from '../assets/script/app/card/CardLineupTexts';
import {
    BOARD_HERO_ART,
    CARD_FACE_ART,
    CLASS_BADGE_ART,
    CLASS_ICON_OFF_ART,
    CLASS_ICON_ON_ART,
    POOL_FRAME_ART,
    resolveHeroArt,
    STAGE_DISC_ART,
    ZC_CARD_CLASSES,
} from '../assets/script/app/card/CardLineupTypes';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import {
    RL_ART_ALL_KEYS,
    RL_ART_NAMES,
    RL_ART_ROOT,
    RL_ICON_ROOT_PREFIX,
    roleArtRelPath,
} from '../assets/script/app/role/RoleArt';
import { MILITIA_ARMY_ID } from '../assets/script/app/role/MilitiaTypes';
import { getGuideIconPath } from '../assets/script/app/zcds/model/ZCGuideConfig';

const RESOURCES = 'assets/resources';

/** 断言 `<root>/<name>.png` 真实存在。 */
function assertSpriteExists(root: string, name: string, hint: string): void {
    assert.ok(name, `${hint}：资源名为空`);
    const file = `${RESOURCES}/${root}/${name}.png`;
    assert.ok(existsSync(file), `${hint}：缺少美术 ${file}（根目录来自 ArtPaths，别在别处另写一份）`);
}

/** 源码里 import 了 ArtPaths 才算「根目录走唯一来源」。 */
function assertUsesArtPaths(source: string, hint: string): void {
    assert.match(source, /from '[^']*ArtPaths'/, `${hint}：资源路径必须取自 app/ArtPaths.ts，不要写裸子目录字面量`);
}

/**
 * 卡牌阵容 / 布阵两页用到的图分三个根目录，**不能一律按 `image/card` 找**：
 *   - `image/card`：卡面、站台底座、品级垫盘；
 *   - `image/icon/card`：立绘（`camp_*` / `char_0*`）、职业角标（`class_*`）、中栏图标；
 *   - `image/frame`：布阵卡池卡框（`common_img_pzk_*`）。
 *
 *  2026-09-15 美术收编时 `camp_*` / `class_*` 从 `card` 挪到了 `icon`，但代码里
 * 仍旧统一走 `loadLineupArt`（只认 `CARD_ART_ROOT`）→ 立绘与角标**一直静默留白**
 * （`resources.load` 只打一条 warn），这条用例是当时唯一的报警点。
 */
test('卡牌阵容 / 布阵的每张图都在它自己的根目录下', () => {
    for (const [rarity, name] of Object.entries(CARD_FACE_ART)) {
        assertSpriteExists(CARD_ART_ROOT, name, `卡面底图（${rarity}）`);
    }
    for (const [rarity, name] of Object.entries(STAGE_DISC_ART)) {
        assertSpriteExists(CARD_ART_ROOT, name, `站台垫盘（${rarity}）`);
    }
    for (const [rarity, name] of Object.entries(POOL_FRAME_ART)) {
        assertSpriteExists(FRAME_ART_ROOT, name, `布阵卡池卡框（${rarity}）`);
    }
    for (const cardClass of ZC_CARD_CLASSES) {
        assertSpriteExists(ICON_ART_ROOT, CLASS_BADGE_ART[cardClass], `角标（${cardClass}）`);
        assertSpriteExists(ICON_ART_ROOT, CLASS_ICON_ON_ART[cardClass], `中栏亮态（${cardClass}）`);
        assertSpriteExists(ICON_ART_ROOT, CLASS_ICON_OFF_ART[cardClass], `中栏灰态（${cardClass}）`);
        assertSpriteExists(ICON_ART_ROOT, resolveHeroArt(cardClass), `营地雕像（${cardClass}）`);
        assertSpriteExists(ICON_ART_ROOT, BOARD_HERO_ART[cardClass], `布阵站台立绘（${cardClass}）`);
    }
    // 四职业各用自己的雕像，别写成同一张
    const heroArts = ZC_CARD_CLASSES.map((cardClass) => resolveHeroArt(cardClass));
    assert.equal(new Set(heroArts).size, ZC_CARD_CLASSES.length);

    // 布阵页与卡牌阵容页的立绘是两套资源（`char_0*` vs `camp_*`），别互相串
    for (const cardClass of ZC_CARD_CLASSES) {
        assert.notEqual(BOARD_HERO_ART[cardClass], resolveHeroArt(cardClass), '布阵立绘不该直接用地形雕像名');
    }
});

/** 用 stub 掉 `cc` 的方式拿到 `CardLineupNav` 的配置组（本组件拉了 cc，Node 里 import 不了）。 */
function readNavGroup(): Array<{ name: string; on: string; off: string }> {
    const code = ts.transpileModule(readFileSync('assets/script/app/card/CardLineupNav.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
        Component: class {}, Label: class {}, Sprite: class {}, SpriteFrame: class {},
    };
    const dependencies: Record<string, unknown> = {
        cc,
        '../ArtPaths': ArtPaths,
        './CardLineupIcons': { loadArt: () => Promise.resolve(null) },
        './CardLineupTexts': { CARD_LINEUP_TEXTS },
    };
    const context = {
        exports: {} as { CARD_LINEUP_NAV_GROUP: Array<{ name: string; on: string; off: string }> },
        require: (name: string) => dependencies[name],
        console,
    };
    runInNewContext(code, context);
    return context.exports.CARD_LINEUP_NAV_GROUP;
}

test('底部六格导航的配置组住在 CardLineupNav，图标都在 image/main 下', () => {
    const group = readNavGroup();
    assert.equal(group.length, 6, '设计稿是六格：商店 / 角色 / 竞技 / 领地 / 冒险 / 联盟');

    // 顺序与 CARD_LINEUP_TEXTS 里的名称一一对应，MainTabHost 的 MainTab 下标才有意义
    //  配置组来自另一个 vm realm，必须用 Array.from 在本 realm 重建数组，
    // 否则 deepStrictEqual 会因为 Array 原型不同而误报不等。
    assert.deepEqual(Array.from(group, (entry) => entry.name), [
        CARD_LINEUP_TEXTS.navShops, CARD_LINEUP_TEXTS.navRoles, CARD_LINEUP_TEXTS.navArena,
        CARD_LINEUP_TEXTS.navTerritory, CARD_LINEUP_TEXTS.navAdventure, CARD_LINEUP_TEXTS.navAlliance,
    ]);

    for (const entry of group) {
        assertSpriteExists(MAIN_ART_ROOT, entry.on, `${entry.name} 选中态`);
        assertSpriteExists(MAIN_ART_ROOT, entry.off, `${entry.name} 未选中态`);
        assert.notEqual(entry.on, entry.off, `${entry.name} 的选中 / 未选中必须是两张图`);
    }

    // 配置组只有一份：老的 CARD_LINEUP_NAV_ART 副本必须已经删掉
    const texts = readFileSync('assets/script/app/card/CardLineupTexts.ts', 'utf8');
    assert.ok(!texts.includes('CARD_LINEUP_NAV_ART'), '六格图标名不要再在 CardLineupTexts 里留第二份');
    assertUsesArtPaths(readFileSync('assets/script/app/card/CardLineupNav.ts', 'utf8'), 'CardLineupNav');
});

test('匹配页图标按「页面大图 / 信息条小图标」分两个根目录', () => {
    // 页面大图：头像 / 雷达
    assertSpriteExists(MATCH_ART_ROOT, 'img_people', '匹配头像');
    assertSpriteExists(MATCH_ART_ROOT, 'icon_fdj', '匹配雷达图标');
    // ⚠️ 神器图标**不在这里**：`image/matching/icon_faqi.png`（固定蓝色法杖占位）已于
    //  2026-10-13 随匹配界面改版删除，真源是 `ARTIFACT_ART_ROOT`
    //  （`image/artifact/<pvpArtifact[].icon>`，与对局里的神器格同一张图），
    //  口径见 `tests/matching-artifact-icon.test.ts`。

    // 信息条小图标在 `MATCH_ICON_ART_ROOT`（`icons/matching`），与页面大图是两个根目录：
    // 两个目录下都有 `icon_*` 风格的名字，往一个根目录写死只会静默留白 ——
    // 界面上表现为 `[MatchIcons] 图标加载失败：icon_04`，但页面照常渲染。
    //  ⚠️ 资源名是**运行时**由服务端数据给的（`MatchPlayerData.stats[].icon`），代码里没有静态列表，
    //  所以这里直接核对目录里有设计稿要的那四张，别再去扫一个已经空掉的占位数据源。
    for (const name of ['icon_01', 'icon_02', 'icon_03', 'icon_04']) {
        assertSpriteExists(MATCH_ICON_ART_ROOT, name, `信息条小图标（${name}）`);
    }

    // 两个根目录只能在 ArtPaths 里定义一次，业务侧不许写死子目录字面量
    assertUsesArtPaths(readFileSync('assets/script/app/matching/MatchIcons.ts', 'utf8'), 'MatchIcons');
    assertUsesArtPaths(readFileSync('assets/script/app/matching/MatchPlayerItem.ts', 'utf8'), 'MatchPlayerItem');
    assertUsesArtPaths(readFileSync('assets/script/app/procedure/ProcedureMatching.ts', 'utf8'), 'ProcedureMatching');
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
        const file = `${RESOURCES}/${path.replace(/\/spriteFrame$/, '.png')}`;
        assert.ok(existsSync(file), `指南图标「${key}」缺少美术 ${file}`);
    }
});

// ============================================================
// 角色模块（`RoleArt`）：两根并存 —— `image/**` 要拼前缀、`icons/**` 不能拼
// ============================================================

test('角色模块的每张图都按自己的根拼出了真实存在的路径（漏/多拼 image 都是静默留白）', () => {
    const bad: string[] = [];
    let iconCount = 0;
    for (const key of RL_ART_ALL_KEYS) {
        const value = (RL_ART_NAMES as Readonly<Record<string, string>>)[key];
        const rel = roleArtRelPath(key);
        if (value.startsWith(RL_ICON_ROOT_PREFIX)) {
            iconCount += 1;
            assert.ok(!rel.startsWith(`${RL_ART_ROOT}/`),
                `${key}（${value}）在 icons/ 下，与 image/ 平级 ⇒ 不该再拼 ${RL_ART_ROOT}/`);
        } else {
            assert.ok(rel.startsWith(`${RL_ART_ROOT}/`), `${key}（${value}）应拼上 ${RL_ART_ROOT}/ 前缀`);
        }
        // 拼出来的路径必须在 resources 下真有这张图（png / jpg 都算）
        const hit = ['png', 'jpg', 'jpeg'].some((ext) => existsSync(`${RESOURCES}/${rel}.${ext}`));
        if (!hit) bad.push(`${key} → assets/resources/${rel} 磁盘上不存在`);
    }
    assert.deepEqual(bad, [], '装配路径不对 / 缺图');
    assert.equal(iconCount, 2, 'RL_ART_NAMES 里 icons/ 那两条（锻造页签图标）应还在，改口径要连这里一起改');
    assert.equal(roleArtRelPath('不存在的key'), '', '缺 key 返回空串，别拼出 image//spriteFrame');
});

test('RoleArtLoader 一律走 roleArtRelPath（不许自己拼 root，否则 icons/ 那两条又会拼错）', () => {
    const src = stripSourceComments(readFileSync('assets/script/app/role/RoleArtLoader.ts', 'utf8'));
    assert.ok(src.includes('spriteFramePathOf(roleArtRelPath(key))'),
        'roleFramePathOf 必须转发 roleArtRelPath（拼前缀 + icons 分流只在零 cc 的 RoleArt 里做一次）');
    assert.ok(/export const ROLE_ART_ROOT = RL_ART_ROOT;/.test(src),
        'ROLE_ART_ROOT 必须从零 cc 的 RoleArt 转发（真源只有一份，别在 Loader 里再写一次 image 字面量）');
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
            const file = `${RESOURCES}/icons/militia/${base}${state}.png`;
            if (!existsSync(file)) missing.push(file);
        }
    }
    assert.deepEqual(missing, [], `缺图（共需 ${bases.length * 2} 张）`);

    // 目录口径钉死：`icons/` 与 `image/` 平级 ⇒ 不许拼 image 前缀（规则 137）
    const roots = readFileSync('assets/script/app/role/RoleArtLoader.ts', 'utf8');
    assert.match(roots, /militia:\s*'icons\/militia'/, "BAG_ICON_ROOTS.militia 必须是 'icons/militia'");
});

/** 反向断言前先剥注释（规则 104：注释里会写反例）。 */
function stripSourceComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
