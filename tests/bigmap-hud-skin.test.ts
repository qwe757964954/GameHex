import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
    BIGMAP_COMMON_ART_ROOT, BIGMAP_HUD_UI_FILES, BIGMAP_HUD_UI_KEYS, BIGMAP_MAIN_CITY_ART_ROOT,
    BIGMAP_MAIN_HUD_ART_ROOT,
} from '../assets/script/app/bigmap/application/BigMapArtCatalog';
import { assetPath } from './helpers/asset-paths';

/**
 * 世界页「领地页 HUD 皮肤」判据（2026-10-22 第二轮用户口径：
 * *「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式 /
 *   删除植物大地图的文字」*）。
 *
 * 口径落定（追问后确认）：走**领地页顶部 HUD 那套深色卡**，不是底部菜单栏的木牌。钉五件事：
 * 1. **色是取出来的**：card / rim 与 `image/main/hud/hud_player_card.png` 同值，
 *    scrim 与领地弹窗 `LevelInfoPanel.prefab` 的 `Dim` 同值（直接读 prefab JSON 比对）；
 * 2. **三层结构**：近黑描边 → 卡面收 2px → 铜金细线再收 2px，线只能细；
 * 3. **按钮用领地页那颗 3D 金钮**（`btn_quick_fight`），木牌只留给【基地/大地图】切换；
 * 4. **标题字删干净**：页面里不许再出现 worldName / 缎带 / titleLabel；
 * 5. **弹窗是居中模态**：暗底 + 居中卡片，不再是贴底大面板。
 */

class FakeColor {
    r: number;
    g: number;
    b: number;
    a: number;

    constructor(r = 0, g = 0, b = 0, a = 255) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
}

const CC_STUB = {
    Color: FakeColor,
    Graphics: class {},
    Node: class {},
    Sprite: Object.assign(class {}, { Type: { SIMPLE: 0, SLICED: 1 }, SizeMode: { CUSTOM: 0, RAW: 2 } }),
    SpriteFrame: class {},
    UITransform: class {},
};

function loadModule(path: string, stubs: Record<string, unknown>): Record<string, any> {
    const source = readFileSync(path, 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports,
        console,
        require: (name: string) => {
            if (name in stubs) return stubs[name];
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return exports as Record<string, any>;
}

function skinModule() {
    return loadModule('assets/script/app/bigmap/view/BigMapSkin.ts', {
        cc: CC_STUB,
        './BigMapTheme': { createUiNode: () => null },
    });
}

const PAGE_SOURCE = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
const LOADER_SOURCE = readFileSync('assets/script/app/bigmap/application/BigMapArtLoader.ts', 'utf8');

/** 读领地弹窗 prefab 里 `Dim` 节点的序列化颜色（站点详情面板已删，改读关卡界面）。 */
function territoryScrim(): { r: number; g: number; b: number; a: number } {
    const data = JSON.parse(readFileSync(
        assetPath('ui/main/LevelInfoPanel.prefab'), 'utf8',
    )) as Record<string, any>[];
    const resolve = (ref: unknown): Record<string, any> | null =>
        (ref && typeof ref === 'object' && '__id__' in (ref as object) ? data[(ref as { __id__: number }).__id__] : null);
    const dim = data.find((entry) => entry._name === 'Dim');
    assert.ok(dim, '领地弹窗 prefab 里找不到 Dim');
    for (const ref of dim!._components ?? []) {
        const component = resolve(ref);
        if (component?.__type__ === 'cc.Sprite') return component._color;
    }
    throw new Error('Dim 上没有 Sprite');
}

// ── 1. 色板 ─────────────────────────────────────────────────

test('★卡面色 / 描边色取自领地页 HUD 玩家卡（72,73,83 / 7,7,8）', () => {
    const colors = skinModule().BIGMAP_HUD_COLORS;
    assert.deepEqual(
        [colors.card.r, colors.card.g, colors.card.b],
        [72, 73, 83],
        '卡面必须是 hud_player_card 中心的深板岩灰',
    );
    assert.deepEqual(
        [colors.rim.r, colors.rim.g, colors.rim.b],
        [7, 7, 8],
        '描边必须是 hud_player_card 边缘的近黑',
    );
    assert.ok(colors.card.a > 200 && colors.card.a < 255, '卡面留一点透明度，透出地图（HUD 观感）');
});

test('★弹窗暗底与领地页 TerritorySiteDetail 的 Dim 逐通道同值（读 prefab 比对）', () => {
    const colors = skinModule().BIGMAP_HUD_COLORS;
    const dim = territoryScrim();
    assert.deepEqual(
        [colors.scrim.r, colors.scrim.g, colors.scrim.b, colors.scrim.a],
        [dim.r, dim.g, dim.b, dim.a],
        '暗底必须等于领地弹窗的 Dim，否则两页的模态感不一样',
    );
});

// ── 2. 三层结构 ─────────────────────────────────────────────

test('卡面板三层叠加：近黑描边 → 卡面各收 2px → 金线再收 2px', () => {
    const skin = skinModule();
    const calls: any[][] = [];
    const graphics = {
        fillColor: null as unknown,
        strokeColor: null as unknown,
        lineWidth: 0,
        clear: () => calls.push(['clear']),
        roundRect: (...args: number[]) => calls.push(['roundRect', ...args]),
        fill: () => calls.push(['fill']),
        stroke: () => calls.push(['stroke']),
    };
    skin.drawBigMapCardPanel(graphics, 200, 100, 10);

    assert.deepEqual(calls.map((call) => call[0]),
        ['clear', 'roundRect', 'fill', 'roundRect', 'fill', 'roundRect', 'stroke']);

    const [, outer, , innerFill, , innerStroke] = calls;
    assert.deepEqual(outer.slice(1), [-100, -50, 200, 100, 10], '描边按整块铺');
    assert.deepEqual(innerFill.slice(1), [-98, -48, 196, 96, 8], '卡面各收 2px');
    assert.deepEqual(innerStroke.slice(1), [-96, -46, 192, 92, 6], '金线再收 2px');
    assert.ok(graphics.lineWidth > 0 && graphics.lineWidth <= 1.5,
        '金线只能是 1px 级细线，粗了就成第二道边框');
});

test('圆角被面板尺寸夹住，不会画出负半径（通栏条 radius 0 也不能把描边吃掉）', () => {
    const skin = skinModule();
    const calls: any[][] = [];
    const graphics = {
        fillColor: null, strokeColor: null, lineWidth: 0,
        clear: () => undefined,
        roundRect: (...args: number[]) => calls.push(args),
        fill: () => undefined,
        stroke: () => undefined,
    };
    skin.drawBigMapCardPanel(graphics, 40, 20, 32);
    for (const args of calls) {
        assert.ok(args[args.length - 1] >= 0, `半径不得为负：${args}`);
        assert.ok(args[2] > 0 && args[3] > 0, `宽高不得为负：${args}`);
    }
    calls.length = 0;
    // radius 0（通栏）：inset 不能跟着圆角一起归零，否则底色盖满、描边消失。
    // ⚠️ 这个 `graphics` 只把 `roundRect` 入列（clear/fill/stroke 都是空实现），
    //    所以下标就是三层：0 = 描边、1 = 卡面、2 = 金线。
    skin.drawBigMapCardPanel(graphics, 400, 40, 0);
    assert.deepEqual(calls[0], [-200, -20, 400, 40, 0], '描边仍是整块');
    assert.deepEqual(calls[1], [-198, -18, 396, 36, 0], '卡面仍要收 2px');
    assert.deepEqual(calls[2], [-196, -16, 392, 32, 0], '金线再收 2px');
});

// ── 3. 贴图 ────────────────────────────────────────────────

test('★四张皮肤图都在磁盘上且已导入；金钮来自主城页、任务底框与地图图标来自主界面 HUD', () => {
    assert.equal(BIGMAP_COMMON_ART_ROOT, 'image/common');
    assert.equal(BIGMAP_MAIN_CITY_ART_ROOT, 'image/main/city');
    assert.equal(BIGMAP_MAIN_HUD_ART_ROOT, 'image/main/hud');
    assert.deepEqual([...BIGMAP_HUD_UI_KEYS].sort(), Object.keys(BIGMAP_HUD_UI_FILES).sort());
    for (const key of BIGMAP_HUD_UI_KEYS) {
        const file = join('assets/resources', `${BIGMAP_HUD_UI_FILES[key]}.png`);
        assert.ok(existsSync(file), `缺图 ${file}`);
        assert.ok(existsSync(`${file}.meta`), `${file} 未经 Cocos 导入`);
    }
});

test('★按钮就是领地页【快速寻敌】那颗金钮；模式按钮换成一整套「任务按钮」三件套', () => {
    assert.equal(BIGMAP_HUD_UI_FILES.button, 'image/main/city/btn_quick_fight');
    // 2026-10-28 用户口径：「基地按钮 和大地图按钮的图标更换成类似任务按钮的样式，
    // 底框加成对应内容(建筑icon-基地，地图icon--大地图)的卡通icon」
    assert.equal(BIGMAP_HUD_UI_FILES.mode_frame, 'image/main/hud/hud_task_tab');
    assert.equal(BIGMAP_HUD_UI_FILES.mode_base, 'image/main/city/nav_territory');
    assert.equal(BIGMAP_HUD_UI_FILES.mode_world, 'image/main/hud/hud_mode_world');
    const keys = BIGMAP_HUD_UI_KEYS as readonly string[];
    assert.equal(keys.includes('title_ribbon'), false, '标题字删了，缎带不该还在');
    assert.equal(keys.includes('bar'), false, '扁按钮改用 3D 金钮，扁条退役');
    // 底部菜单栏那两张两态木牌随模式按钮一起退役（任务按钮结构做不出图标位，只换底图没意义）
    assert.equal(keys.includes('tab_idle'), false, '两态木牌已退役');
    assert.equal(keys.includes('tab_active'), false, '两态木牌已退役');
});

test('美术加载器把皮肤图挂到独立的 hud 表，概念图 ui 表结构不变', () => {
    assert.match(LOADER_SOURCE, /readonly hud: ReadonlyMap<IBigMapHudUiKey, SpriteFrame \| null>;/);
    assert.match(LOADER_SOURCE, /hud: new Map\(hudEntries\)/);
    assert.match(LOADER_SOURCE, /BIGMAP_HUD_UI_FILES\[key\]/);
});

// ── 4. 删掉标题字 ──────────────────────────────────────────

test('★「植物大地图」字样从页面里彻底删掉（不再读 worldName / baseTitle）', () => {
    assert.equal(/worldName/.test(PAGE_SOURCE), false, '页面不该再显示世界名');
    assert.equal(/baseTitle/.test(PAGE_SOURCE), false, '基地标题也一并去掉（模式由切换木牌表达）');
    assert.equal(/titleLabel/.test(PAGE_SOURCE), false, '标题 Label 必须删干净');
    assert.equal(/titleRibbon|TitleRibbon|fitBigMapRibbon/.test(PAGE_SOURCE), false, '缎带相关代码必须删干净');
});

const PAGE_PREFAB = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
const prefabNode = (name: string) => PAGE_PREFAB.find((item: Record<string, unknown>) => item.__type__ === 'cc.Node' && item._name === name);
const prefabComponent = (node: Record<string, any>, type: string) => node._components.map((ref: { __id__: number }) => PAGE_PREFAB[ref.__id__]).find((item: Record<string, unknown>) => item.__type__ === type);

test('顶栏保留透明 Header、独立资源卡和收取按钮', () => {
    const header = prefabNode('Header');
    assert.equal(prefabComponent(header, 'cc.Graphics'), undefined);
    assert.ok(prefabNode('ResourceCard'));
    assert.ok(prefabNode('HarvestAll'));
});

test('详情卡是居中模态，暗底拦截输入并关闭选择', () => {
    const dim = prefabNode('InfoDim');
    const panel = prefabNode('InfoPanel');
    assert.ok(prefabComponent(dim, 'cc.BlockInputEvents'));
    assert.ok(prefabComponent(panel, 'cc.BlockInputEvents'));
    assert.equal(panel._lpos.x, 0);
    assert.equal(panel._lpos.y, 0);
    const style = dim._components.map((ref: { __id__: number }) => PAGE_PREFAB[ref.__id__]).find((item: object) => 'fill' in item);
    assert.deepEqual([style.fill.r, style.fill.g, style.fill.b, style.fill.a], [5, 10, 14, 205]);
    assert.match(PAGE_SOURCE, /this\.infoDim\.on\(Node\.EventType\.TOUCH_END, this\.clearSelection, this\)/);
    assert.match(PAGE_SOURCE, /this\.infoDim\.active = visible/);
});

test('实心按钮使用 HUD 金钮，模式按钮的三层结构在 Prefab 中维护', () => {
    assert.match(PAGE_SOURCE, /for \(const button of this\.skinButtons\) button\.setSkin\(art\.hud\.get\('button'\)/);
    assert.match(PAGE_SOURCE, /this\.primaryButton\.setSkin\(art\.hud\.get\('button'\)/);
    const toggle = prefabNode('BaseWorldToggle');
    const names = toggle._children.map((ref: { __id__: number }) => PAGE_PREFAB[ref.__id__]._name);
    assert.deepEqual(names, ['ModeFrameFallback', 'ModeFrame', 'ModeIcon', 'ModeLabel']);
    assert.equal(prefabNode('ModeFrame')._lpos.y, -7.5);
    assert.equal(prefabNode('ModeIcon')._lpos.y, 11.5);
    assert.equal(prefabNode('ModeLabel')._lpos.y, -25);
    const label = prefabComponent(prefabNode('ModeLabel'), 'cc.Label');
    assert.equal(label._fontSize, 22);
    assert.equal(label._isBold, true);
    assert.equal(label._enableOutline, true);
    assert.equal(label._outlineWidth, 2);
    assert.match(PAGE_SOURCE, /this\.art\.hud\.get\(this\.mode === 'world' \? 'mode_base' : 'mode_world'\)/);
    assert.match(PAGE_SOURCE, /fitBigMapSprite\(this\.modeButton\.icon, icon, MODE_ICON_SIZE, 0, MODE_ICON_Y\)/);
});

test('页面不再给面板贴深铁概念图，也不再引用木牌皮肤', () => {
    assert.equal(/applyBigMapPanel/.test(PAGE_SOURCE), false, '皮肤换了之后不该再引用概念图贴图');
    assert.equal(/BIGMAP_WOOD_COLORS|drawBigMapWoodPanel|paintBigMapWoodPanel/.test(PAGE_SOURCE), false,
        '木牌皮肤已整条退役');
    assert.equal(/art\.ui\.get\('header'\)/.test(PAGE_SOURCE), false, '皮肤不该取概念图 ui 表');
});
