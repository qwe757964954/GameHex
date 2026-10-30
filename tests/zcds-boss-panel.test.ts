import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

/**
 * 波次怪守城（塔防）左上角**首领条**（`ZCHudBossPanel` + `ZCBossPanel.prefab`）的结构守卫。
 *
 * 面板来自蓝湖「BOSS」稿：骷髅 + `第4/8波` + 首领头像框 + 名字 + 红血条 + `X4`（本波血量倍率）。
 * 与「落点选择」HUD 同一套做法 —— 节点树 / 尺寸 / 美术全在 prefab 里，代码只按数据刷文案与比例。
 *
 * 判据四层：
 *   ① 源码里不许退回「代码搭节点」；面板也不许自己算坐标（位置归 prefab 的 Widget）；
 *   ② prefab 的树形、尺寸、相对几何逐项等于**下面手抄的设计稿量测表**（独立于生成脚本）；
 *   ③ 4 张切图逐张对到 `image/gameui/<名>.png`，且 `sizeMode=CUSTOM` + `trim=false`；
 *   ④ 每个 `@property` 都能反解到正确类型的对象；三条文字**必须带描边**（面板没有深色底板）。
 */
const panelSource = readFileSync('assets/script/app/zcds/view/ZCHudBossPanel.ts', 'utf8');
const gameSource = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const hudSource = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
const loaderSource = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
const panelMeta = JSON.parse(readFileSync('assets/script/app/zcds/view/ZCHudBossPanel.ts.meta', 'utf8'));
const prefabText = readFileSync(assetPath('ui/game/ZCBossPanel.prefab'), 'utf8');
const objects: any[] = JSON.parse(prefabText);

const CID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function cidOf(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    return hex.slice(0, 5) + Array.from({ length: 9 }, (_, i) => {
        const value = parseInt(hex.slice(5 + i * 3, 8 + i * 3), 16);
        return CID_ALPHABET[value >> 6] + CID_ALPHABET[value & 0x3f];
    }).join('');
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 设计稿量测表（蓝湖「BOSS」稿，画布 720×1610，切片 1:1）——**手抄**，别由 prefab 反推。
 * cocosY = 805 − 设计y（y 反向）；子树坐标 = 子中心 − 父中心；面板整体用 Widget 钉左上（top=76/left=129）。
 */
const DESIGN = {
    panel: { w: 464, h: 173, top: 76, left: 129 },
    icon: { w: 64, h: 53, x: -69, y: 60 },      // icon_boss 骷髅（设计 260,76）
    wave: { w: 120, h: 32, x: 26.5, y: 59.5 },   // 第4/8波（设计 333,87）
    frame: { w: 86, h: 86, x: -189, y: -43.5 },  // boss_txk 红框（设计 129,163）
    inner: { w: 72, h: 72 },                     // 框内头像（设计示例怪图 72×72）
    name: { w: 124, h: 30, x: -37.5, y: -25.5 }, // 深渊领主（设计 265,174）
    track: { w: 373, h: 31, x: 45.5, y: -66 },   // progress_02
    fill: { w: 363, h: 21 },                     // progress_01（与轨道同心、四周内收 5）
    rate: { w: 40, h: 20, x: -8.5, y: -2 },      // X4（设计 383,222，压在血条上；设计 y 向下 ⇒ cocos 里比条心低 2）
};

const nodes = objects.filter((o) => o.__type__ === 'cc.Node');
const nodeNamed = (name: string, parentName?: string) => nodes.find((node) => {
    if (node._name !== name) return false;
    if (parentName === undefined) return node._parent === null;
    return objects[node._parent.__id__]._name === parentName;
});
const componentOf = (node: any, type: string) =>
    node._components.map((ref: any) => objects[ref.__id__]).find((c: any) => c.__type__ === type);
const sizeOf = (node: any): [number, number] => {
    const t = componentOf(node, 'cc.UITransform');
    return [t._contentSize.width, t._contentSize.height];
};
const positionOf = (node: any): [number, number] => [node._lpos.x, node._lpos.y];
const childrenOf = (node: any): string[] => node._children.map((ref: any) => objects[ref.__id__]._name);
const spriteOf = (node: any) => componentOf(node, 'cc.Sprite');
const labelOf = (node: any) => componentOf(node, 'cc.Label');
const frameOf = (art: string): string =>
    JSON.parse(readFileSync(assetPath(`image/gameui/${art}.png.meta`), 'utf8')).subMetas.f9941.uuid;

test('面板脚本不再自己建节点，也不自己算坐标', () => {
    const code = stripComments(panelSource);
    assert.doesNotMatch(code, /new Node\(/);
    assert.doesNotMatch(code, /\.addComponent\(/);
    assert.doesNotMatch(code, /removeAllChildren/);
    // 位置归 prefab 的 Widget：渲染层只写文案 / 头像 / 血量比例（规则 215）
    assert.doesNotMatch(code, /setPosition|setScale/);
    for (const key of ['waveLabel', 'portraitIcon', 'nameLabel', 'hpFill', 'rateLabel']) {
        assert.match(code, new RegExp(`this\\.${key}\\b`), `${key} 应当被直接使用（而不是先判空）`);
    }
});

test('ZCBossPanel.prefab：9 个节点、尺寸与相对几何按设计稿', () => {
    assert.equal(nodes.length, 9);
    const root = nodeNamed('ZCBossPanel')!;
    assert.deepEqual(childrenOf(root), ['IconBoss', 'WaveText', 'Portrait', 'BossName', 'Bar'],
        '子节点顺序 = 渲染顺序（血条在最上层）');
    assert.deepEqual(sizeOf(root), [DESIGN.panel.w, DESIGN.panel.h]);

    assert.deepEqual(sizeOf(nodeNamed('IconBoss', 'ZCBossPanel')!), [DESIGN.icon.w, DESIGN.icon.h]);
    assert.deepEqual(positionOf(nodeNamed('IconBoss', 'ZCBossPanel')!), [DESIGN.icon.x, DESIGN.icon.y]);
    assert.deepEqual(sizeOf(nodeNamed('WaveText', 'ZCBossPanel')!), [DESIGN.wave.w, DESIGN.wave.h]);
    assert.deepEqual(positionOf(nodeNamed('WaveText', 'ZCBossPanel')!), [DESIGN.wave.x, DESIGN.wave.y]);
    assert.deepEqual(sizeOf(nodeNamed('BossName', 'ZCBossPanel')!), [DESIGN.name.w, DESIGN.name.h]);
    assert.deepEqual(positionOf(nodeNamed('BossName', 'ZCBossPanel')!), [DESIGN.name.x, DESIGN.name.y]);

    const portrait = nodeNamed('Portrait', 'ZCBossPanel')!;
    assert.deepEqual(sizeOf(portrait), [DESIGN.frame.w, DESIGN.frame.h]);
    assert.deepEqual(positionOf(portrait), [DESIGN.frame.x, DESIGN.frame.y]);
    assert.deepEqual(childrenOf(portrait), ['Icon']);
    assert.deepEqual(sizeOf(nodeNamed('Icon', 'Portrait')!), [DESIGN.inner.w, DESIGN.inner.h]);
    assert.deepEqual(positionOf(nodeNamed('Icon', 'Portrait')!), [0, 0], '头像在框里居中');

    const bar = nodeNamed('Bar', 'ZCBossPanel')!;
    assert.deepEqual(sizeOf(bar), [DESIGN.track.w, DESIGN.track.h]);
    assert.deepEqual(positionOf(bar), [DESIGN.track.x, DESIGN.track.y]);
    assert.deepEqual(childrenOf(bar), ['Fill', 'Rate']);
    assert.deepEqual(sizeOf(nodeNamed('Fill', 'Bar')!), [DESIGN.fill.w, DESIGN.fill.h]);
    assert.deepEqual(positionOf(nodeNamed('Fill', 'Bar')!), [0, 0], '填充与轨道同心（四周内收 5）');
    assert.deepEqual(positionOf(nodeNamed('Rate', 'Bar')!), [DESIGN.rate.x, DESIGN.rate.y]);
});

test('面板钉左上：Widget = TOP + LEFT，inset 就是设计稿坐标', () => {
    const widget = componentOf(nodeNamed('ZCBossPanel')!, 'cc.Widget');
    assert.equal(widget._alignFlags, 9, 'TOP(1) + LEFT(8)');
    assert.equal(widget._top, DESIGN.panel.top);
    assert.equal(widget._left, DESIGN.panel.left);
    assert.equal(widget._alignMode, 1, 'ALWAYS：换分辨率也要重新对齐');
    // 子节点不许挂 Widget（会脱离面板坐标系）
    assert.equal(nodes.filter((n) => n !== nodeNamed('ZCBossPanel')!).some((n) => componentOf(n, 'cc.Widget')), false);
});

test('四条切图指到 image/gameui 下的对应美术，sizeMode=CUSTOM + trim=false', () => {
    const expected: Array<[string, string, string]> = [
        ['IconBoss', 'ZCBossPanel', 'icon_boss'],
        ['Portrait', 'ZCBossPanel', 'boss_txk'],
        ['Bar', 'ZCBossPanel', 'progress_02'],
        ['Fill', 'Bar', 'progress_01'],
    ];
    for (const [name, parent, art] of expected) {
        const node = nodeNamed(name, parent);
        assert.ok(node, `${parent}/${name} 不存在`);
        const sprite = spriteOf(node)!;
        assert.equal(sprite._spriteFrame.__uuid__, frameOf(art), `${name} 的图应当是 ${art}.png`);
        assert.equal(sprite._sizeMode, 0, `${name} sizeMode 必须 CUSTOM`);
        assert.equal(sprite._isTrimmedMode, false, `${name} 必须关掉裁剪模式`);
    }
    // 框内头像是**运行时换图**的：出厂必须是 null 而不是 `{}`（空对象会让引擎读 uv[0] 抛错）
    const inner = spriteOf(nodeNamed('Icon', 'Portrait')!)!;
    assert.equal(inner._spriteFrame, null, '框内头像出厂留空');
    assert.doesNotMatch(prefabText, /"_spriteFrame":\s*\{\s*\}/);
    // 只有血条填充用 FILLED + HORIZONTAL（只改 fillRange，贴图与圆角不被拉伸）
    const fill = spriteOf(nodeNamed('Fill', 'Bar')!)!;
    assert.equal(fill._type, 3);
    assert.equal(fill._fillType, 0);
    assert.equal(objects.filter((o) => o.__type__ === 'cc.Sprite' && o._type === 3).length, 1);
});

test('三条文字都是白字 + 黑描边（面板没有深色底板，缺描边会糊在沙地上）', () => {
    for (const [name, parent, fontSize] of [
        ['WaveText', 'ZCBossPanel', 32],
        ['BossName', 'ZCBossPanel', 28],
        ['Rate', 'Bar', 22],
    ] as const) {
        const label = labelOf(nodeNamed(name, parent)!)!;
        assert.equal(label._fontSize, fontSize, `${name} 字号`);
        assert.equal(label._enableOutline, true, `${name} 必须开描边`);
        assert.ok(label._outlineWidth >= 2, `${name} 描边宽度`);
        assert.equal(label._outlineColor.r + label._outlineColor.g + label._outlineColor.b, 0, `${name} 描边是黑色`);
        assert.equal(label._color.r + label._color.g + label._color.b, 765, `${name} 文字是白色`);
        assert.equal(label._overflow, 2, 'SHRINK：定宽框里只缩字不折行');
        assert.equal(label._enableWrapText, false);
    }
});

test('prefabInfo / fileId / layer 形态正确', () => {
    const rootIndex = objects[0].data.__id__;
    assert.equal(rootIndex, objects.findIndex((o) => o?.__type__ === 'cc.Node'), '根必须是第一个 cc.Node');
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} layer 必须是 UI_2D`);
        const info = objects[node._prefab.__id__];
        assert.equal(info.asset.__id__, 0);
        assert.equal(info.root.__id__, rootIndex);
    }
    const fileIds = objects.filter((o) => typeof o?.fileId === 'string').map((o) => o.fileId);
    for (const id of fileIds) assert.equal(id.length, 22);
    assert.equal(new Set(fileIds).size, fileIds.length);
});

test('5 个 @property 全部绑到正确类型的对象', () => {
    const cid = cidOf(panelMeta.uuid);
    const script = objects.find((o) => o.__type__ === cid);
    assert.ok(script, `prefab 里应当挂 ${cid}（ZCHudBossPanel）`);
    const expected: Record<string, string> = {
        waveLabel: 'cc.Label',
        portraitIcon: 'cc.Sprite',
        nameLabel: 'cc.Label',
        hpFill: 'cc.Sprite',
        rateLabel: 'cc.Label',
    };
    for (const [prop, type] of Object.entries(expected)) {
        const ref = script[prop];
        assert.ok(ref && typeof ref.__id__ === 'number', `${prop} 未绑定`);
        assert.equal(objects[ref.__id__].__type__, type, `${prop} 应指向 ${type}`);
    }
    // 血条填充与倍率必须挂在 Bar 下且互为兄弟（Bar 整体不随血量变，只有填充的比例变）
    const barIndex = objects.indexOf(nodeNamed('Bar', 'ZCBossPanel')!);
    const fillNode = objects[script.hpFill.__id__].node.__id__;
    const rateNode = objects[script.rateLabel.__id__].node.__id__;
    assert.equal(objects[fillNode]._name, 'Fill');
    assert.equal(objects[rateNode]._name, 'Rate');
    assert.equal(objects[fillNode]._parent.__id__, barIndex);
    assert.equal(objects[rateNode]._parent.__id__, barIndex);
});

test('接线条：守城局实例化首领条、非守城局销毁；顶部信息带在守城局收起', () => {
    const game = stripComments(gameSource);
    assert.match(game, /instantiate\(this\.cachedBossPanelPrefab\)/, '必须实例化 prefab');
    assert.match(game, /node\.getComponent\(ZCHudBossPanel\)!/, '取组件失败应当当场抛');
    assert.match(game, /const progress = model\.defenceWaveProgress;\n?/, '按 defenceWaveProgress 判是否守城局');
    assert.match(game, /this\.bossPanel\?\.node\.destroy\(\)/, '非守城局要销毁（换局不能留残留）');
    assert.match(game, /this\.bossPanel\.render\(/, '每帧全量赋值');
    // 不能写位置：位置归 prefab 的 Widget（规则 215）
    const renderer = game.slice(game.indexOf('private renderBossPanel'), game.indexOf('private loadDefenceBossArt'));
    assert.doesNotMatch(renderer, /setPosition/, '实例化后不许再写 setPosition');

    const hud = stripComments(hudSource);
    assert.match(hud, /this\.topInfoPanel\.active = defence === null && !this\.spawnSelectionMode/,
        '守城局收起顶部信息带（计时 + 四格）；选点阶段也不许被顶回来');
    assert.match(loaderSource, /const BOSS_PANEL_URL = 'ui\/game\/ZCBossPanel'/);
    assert.match(loaderSource, /this\.assets\.load\(BOSS_PANEL_URL, Prefab/);
    assert.match(loaderSource, /bossPanelPrefab: Prefab;/);
});
