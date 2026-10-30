/**
 * 公用红点组件（FGUI `组件_公用_红点` / `com_rd`）移植的回归网。
 *
 * 分四段，各守一件事：
 *
 *   A. **判定口径**（`RedDotState`，零 import 纯函数）—— 老端这些判定在 `GObjRD.OnRDUpdate()` 里，
 *      依赖 FGUI 控制器 + `SetSpine`，没法单测；移植时全收敛成纯函数，本段是它唯一的回归网。
 *   B. **prefab 结构**（`ui/common/RedDot.prefab`）—— 脚本组件的 `__type__` 必须能从
 *      `RedDot.ts.meta` 反解（防 cid 抄错成 `MissingScript`）；三个 `@property` 引用必须指到
 *      **正确类型**的组件上（指错对象不报错，只是运行时静默不生效）；每个组件必须自带
 *      `cc.CompPrefabInfo`（漏了编辑器存盘会重建 fileId，见生成器注释）。
 *   C. **资源落位** —— 三张静态图 + spine 四件套必须在盘上，且 `.skel.meta` 的 uuid 与 prefab 里
 *      `_skeletonData` 一致（对不上 ⇒ 红点 spine 静默不显示）。
 *   D. **源码口径**（读文本）—— 动画名 `anmation`（上游少一个 `i`，改了就静默不播）、
 *      取图必须带 `/spriteFrame`、spine 尺寸 33×38.4 不能写成老端 prefab 的 27.5×32。
 *
 * 口径真源：
 *   - 老端行为：`client/assets/script/app/game/fguiExtend/GObjRD.ts`
 *   - 老端几何：`zarts/.../共用组件/组件/红点/组件_公用_红点.xml`（30×30 容器）
 *   - 老端美术：`client/assets/resources/塔防/spine/reddot/`（spine 3.8.95）
 *   - 调用点示例：`client/.../gift/SubTab/SubTabSpecialGiftBase.ts`（免费礼包 ⇒ `com_rd` 亮）
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    RED_DOT_TYPE_DEFAULT,
    RED_DOT_TYPE_NEW,
    RED_DOT_TYPE_NUMBER,
    RED_DOT_TYPE_ORDINARY,
    RED_DOT_TYPE_PAGES,
    normalizeRedDotCount,
    normalizeRedDotType,
    redDotTypePageName,
    resolveRedDotState,
} from '../assets/script/app/common/RedDotState';
import { assetPath } from './helpers/asset-paths';

// ============================================================
// A. 判定口径
// ============================================================

const HIDDEN = { visible: false, artKey: null, showSpine: false, text: '' };

test('A1 老端那两行归一化：null → 0、boolean → 1/0、负数/NaN → 0、小数向下取整', () => {
    assert.equal(normalizeRedDotCount(null), 0);
    assert.equal(normalizeRedDotCount(undefined), 0);
    assert.equal(normalizeRedDotCount(true), 1);
    assert.equal(normalizeRedDotCount(false), 0);
    assert.equal(normalizeRedDotCount(0), 0);
    assert.equal(normalizeRedDotCount(-5), -5, '负数原样返回，由 resolveRedDotState 判 <= 0 收起');
    assert.equal(normalizeRedDotCount(Number.NaN), 0);
    assert.equal(normalizeRedDotCount(Number.POSITIVE_INFINITY), 0);
    assert.equal(normalizeRedDotCount(3.9), 3);
});

test('A2 ⚠️ boolean 必须被接住 —— 否则 `true <= 0` 恒 false，红点永远显示', () => {
    assert.equal(resolveRedDotState(true).visible, true);
    assert.deepEqual(resolveRedDotState(false), HIDDEN);
});

test('A3 count <= 0 ⇒ 整块不显示（FGUI `是否显示红点` 切到「不显示」页）', () => {
    for (const count of [0, -1, -999, null, undefined, false, Number.NaN]) {
        assert.deepEqual(resolveRedDotState(count), HIDDEN, `count=${String(count)} 应收起`);
    }
});

test('A4 三种类型各自的形态：普通=spine、数字=文案、新=换底图', () => {
    const ordinary = resolveRedDotState(1, RED_DOT_TYPE_ORDINARY);
    assert.deepEqual(ordinary, { visible: true, artKey: 'ordinary', showSpine: true, text: '' });

    const number = resolveRedDotState(7, RED_DOT_TYPE_NUMBER);
    assert.deepEqual(number, { visible: true, artKey: 'number', showSpine: false, text: '7' });

    const fresh = resolveRedDotState(1, RED_DOT_TYPE_NEW);
    assert.deepEqual(fresh, { visible: true, artKey: 'new', showSpine: false, text: '' });
});

test('A5 数字文案不截断（老端 `title.setText(rdNum)` 原样写，超长交给 Label 的 SHRINK）', () => {
    assert.equal(resolveRedDotState(12345, RED_DOT_TYPE_NUMBER).text, '12345');
    assert.equal(resolveRedDotState(99, RED_DOT_TYPE_NUMBER).text, '99');
});

test('A6 类型归一化：越界 / 空值一律当普通红点（对齐老端 `GetRdType()`）', () => {
    assert.equal(normalizeRedDotType(RED_DOT_TYPE_NUMBER), RED_DOT_TYPE_NUMBER);
    assert.equal(normalizeRedDotType(RED_DOT_TYPE_NEW), RED_DOT_TYPE_NEW);
    for (const bad of [null, undefined, -1, 3, 99, 0.5, Number.NaN]) {
        assert.equal(normalizeRedDotType(bad as number), RED_DOT_TYPE_ORDINARY, `type=${String(bad)} 应兜底成普通红点`);
    }
    assert.equal(RED_DOT_TYPE_DEFAULT, RED_DOT_TYPE_ORDINARY);
});

test('A7 页序即类型号 —— 顺序改了就会与老端素材/行为错位', () => {
    assert.deepEqual([...RED_DOT_TYPE_PAGES], ['普通红点', '数字红点', '新红点']);
    assert.equal(redDotTypePageName(RED_DOT_TYPE_ORDINARY), '普通红点');
    assert.equal(redDotTypePageName(RED_DOT_TYPE_NUMBER), '数字红点');
    assert.equal(redDotTypePageName(RED_DOT_TYPE_NEW), '新红点');
});

test('A8 省略类型 = 沿用普通红点（老端首帧就是这个形态）', () => {
    assert.deepEqual(resolveRedDotState(1), resolveRedDotState(1, RED_DOT_TYPE_ORDINARY));
    assert.deepEqual(resolveRedDotState(1, null), resolveRedDotState(1, RED_DOT_TYPE_ORDINARY));
    assert.deepEqual(resolveRedDotState(1, undefined), resolveRedDotState(1, RED_DOT_TYPE_ORDINARY));
});

test('A9 判定结果每一项都齐（界面侧要**绝对赋值**，缺字段会留下上一帧的残影）', () => {
    for (const state of [
        resolveRedDotState(0),
        resolveRedDotState(1),
        resolveRedDotState(1, RED_DOT_TYPE_NUMBER),
        resolveRedDotState(1, RED_DOT_TYPE_NEW),
    ]) {
        assert.deepEqual(Object.keys(state).sort(), ['artKey', 'showSpine', 'text', 'visible']);
        assert.equal(typeof state.visible, 'boolean');
        assert.equal(typeof state.showSpine, 'boolean');
        assert.equal(typeof state.text, 'string');
        assert.ok(state.artKey === null || ['ordinary', 'number', 'new'].includes(state.artKey));
    }
});

// ============================================================
// B. prefab 结构
// ============================================================

const RED_DOT_TS = 'assets/script/app/common/RedDot.ts';
const RED_DOT_ART_TS = 'assets/script/app/common/RedDotArt.ts';
const PREFAB_PATH = assetPath('ui/common/RedDot.prefab');
const COMMON_ART_DIR = assetPath('image/common');
const SPINE_DIR = assetPath('skel/reddot');

/** 编辑器压缩 uuid：前 5 个 hex 原样 + 其余 27 个 hex 每 3 个编 2 个 base64 字符 = 23 位。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[value >> 6] + KEYS[value & 63];
    }
    return out;
}

type Obj = Record<string, unknown>;
const PREFAB = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Obj[];
const NODES = PREFAB.filter((entry) => entry && entry.__type__ === 'cc.Node');
const nodeNamed = (name: string): Obj => {
    const found = NODES.find((node) => node._name === name);
    assert.ok(found, `prefab 里没有节点 ${name}`);
    return found;
};
const compsOf = (name: string): Obj[] =>
    (nodeNamed(name)._components as Obj[]).map((ref) => PREFAB[ref.__id__ as number]);
const compOfType = (name: string, type: string): Obj => {
    const found = compsOf(name).find((comp) => comp.__type__ === type);
    assert.ok(found, `${name} 上没有 ${type}`);
    return found;
};
const sizeOf = (name: string): [number, number] => {
    const size = compOfType(name, 'cc.UITransform')._contentSize as Obj;
    return [size.width as number, size.height as number];
};

test('B1 根节点是第一个 cc.Node，且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    const firstNodeIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.ok(firstNodeIndex > 0, 'prefab 里没有 cc.Node');
    const data = PREFAB[0].data as Obj;
    assert.equal(data.__id__, firstNodeIndex, 'cc.Prefab.data 没指向真根节点');
    assert.equal(NODES[0]._name, 'RedDot');
    assert.equal(NODES[0]._parent, null, '根节点不应有 _parent');
});

test('B2 四个节点、根下子序 Icon → Spine → Title（Title 必须最后，否则数字被底图压住）', () => {
    assert.equal(NODES.length, 4, `节点数应是 4，实际 ${NODES.length}`);
    const children = (nodeNamed('RedDot')._children as Obj[]).map((ref) => PREFAB[ref.__id__ as number]._name);
    assert.deepEqual(children, ['Icon', 'Spine', 'Title']);
    for (const name of ['Icon', 'Spine', 'Title']) {
        const parent = nodeNamed(name)._parent as Obj;
        assert.equal(PREFAB[parent.__id__ as number]._name, 'RedDot', `${name} 的父节点不是 RedDot`);
    }
});

test('B3 几何：根 30×30、Icon 30×29、Spine 33×38.4、Title 15×29 且中心锚点', () => {
    assert.deepEqual(sizeOf('RedDot'), [30, 30], 'FGUI 组件容器是 30×30');
    assert.deepEqual(sizeOf('Icon'), [30, 29], '普通红点图 29×28 按宽缩到 30 ⇒ 30×28.97 取 30×29');
    assert.deepEqual(sizeOf('Spine'), [33, 38.4], 'spine 按骨架自然尺寸，**不是**老端 prefab 的 27.5×32');
    assert.deepEqual(sizeOf('Title'), [15, 29], 'FGUI 的 `title` 是 15×29');
    for (const name of ['Icon', 'Spine', 'Title']) {
        const anchor = compOfType(name, 'cc.UITransform')._anchorPoint as Obj;
        assert.equal(anchor.x, 0.5, `${name} anchor.x`);
        assert.equal(anchor.y, 0.5, `${name} anchor.y`);
    }
});

test('B4 ⚠️ 每个脚本组件的 __type__ 都能从 RedDot.ts.meta 反解（防 cid 抄错成 MissingScript）', () => {
    const meta = JSON.parse(readFileSync(`${RED_DOT_TS}.meta`, 'utf8')) as { uuid: string };
    const expected = compressUuid(meta.uuid);
    assert.equal(expected.length, 23, 'compressUuid 结果必须是 23 位');
    assert.equal(expected, '5fa5aSCCTRI/Y8zkguS79+z', 'cid 变了要同步 tmp/gen_reddot.mjs 与 tmp/gen_gift.mjs');

    // `sp.Skeleton` 也在 `sp` 命名空间下（不是 `cc.`），别把它当脚本组件数进来
    const isScriptComponent = (type: unknown): boolean =>
        typeof type === 'string' && !type.startsWith('cc.') && !type.startsWith('sp.');
    const scripts = PREFAB.filter((entry) => entry && isScriptComponent(entry.__type__));
    assert.equal(scripts.length, 1, `应恰好 1 个脚本组件，实际 ${scripts.length}`);
    assert.equal(scripts[0].__type__, expected);
    assert.equal(PREFAB.some((entry) => entry && entry.__type__ === 'cc.MissingScript'), false, '出现 MissingScript');
});

test('B5 三个 @property 引用指到**正确类型 + 正确节点**上（指错不报错，只是静默不生效）', () => {
    const meta = JSON.parse(readFileSync(`${RED_DOT_TS}.meta`, 'utf8')) as { uuid: string };
    const script = PREFAB.find((entry) => entry && entry.__type__ === compressUuid(meta.uuid));
    assert.ok(script, '找不到 RedDot 脚本组件');

    const cases: Array<[string, string, string]> = [
        ['icon', 'cc.Sprite', 'Icon'],
        ['titleLabel', 'cc.Label', 'Title'],
        ['spine', 'sp.Skeleton', 'Spine'],
    ];
    for (const [field, type, nodeName] of cases) {
        const ref = script[field] as Obj | undefined;
        assert.ok(ref && typeof ref.__id__ === 'number', `RedDot.${field} 没回填`);
        const target = PREFAB[ref.__id__ as number];
        assert.ok(target, `RedDot.${field} 的 __id__ 越界`);
        assert.equal(target.__type__, type, `RedDot.${field} 应指向 ${type}`);
        assert.equal(PREFAB[(target.node as Obj).__id__ as number]._name, nodeName, `RedDot.${field} 指到了别的节点`);
    }
});

test('B6 渲染尺寸铁律：Sprite CUSTOM + 不裁剪、Label SHRINK + 不换行', () => {
    const sprite = compOfType('Icon', 'cc.Sprite');
    assert.equal(sprite._sizeMode, 0, 'Sprite 必须 CUSTOM(0)，TRIMMED 会按图片原始尺寸回写 contentSize');
    assert.equal(sprite._isTrimmedMode, false, '必须关掉裁剪，否则 30×29 的框里图会被裁');
    assert.equal((sprite._spriteFrame as Obj).__expectedType__, 'cc.SpriteFrame');

    const label = compOfType('Title', 'cc.Label');
    assert.equal(label._overflow, 2, 'Label 必须 SHRINK(2)');
    assert.equal(label._enableWrapText, false, 'Label 必须 wrap=false');
    assert.equal(label._string, '1', 'FGUI 原稿 title 的默认文案是 "1"');
    assert.equal(label._fontSize, 20);
});

test('B7 每个组件都自带 cc.CompPrefabInfo（漏了编辑器存盘会重建 fileId），且 fileId 22 位不重复', () => {
    const infos: string[] = [];
    for (const entry of PREFAB) {
        if (!entry || typeof entry.__type__ !== 'string') continue;
        const type = entry.__type__ as string;
        if (type === 'cc.Prefab' || type === 'cc.Node' || type === 'cc.PrefabInfo' || type === 'cc.CompPrefabInfo') continue;
        const info = entry.__prefab as Obj | undefined;
        assert.ok(info && typeof info.__id__ === 'number', `${type} 缺 __prefab`);
        const target = PREFAB[info.__id__ as number];
        assert.equal(target.__type__, 'cc.CompPrefabInfo', `${type} 的 __prefab 没指向 CompPrefabInfo`);
        infos.push(target.fileId as string);
    }
    assert.ok(infos.length >= 7, `组件数偏少：${infos.length}`);
    for (const fileId of infos) assert.equal(fileId.length, 22, `CompPrefabInfo.fileId 长度：${fileId}`);
    assert.equal(new Set(infos).size, infos.length, 'CompPrefabInfo.fileId 有重复');
});

test('B8 所有节点 layer=33554432（UI_2D），非根节点也要带 cc.PrefabInfo', () => {
    for (const node of NODES) {
        assert.equal(node._layer, 33554432, `${node._name} 的 _layer 不对`);
    }
    for (const name of ['Icon', 'Spine', 'Title']) {
        const info = nodeNamed(name)._prefab as Obj;
        assert.ok(info && typeof info.__id__ === 'number', `${name} 缺 cc.PrefabInfo`);
        assert.equal(PREFAB[info.__id__ as number].__type__, 'cc.PrefabInfo');
    }
});

test('B9 默认形态：根节点在、三个子节点收起（老端 `是否显示红点` 默认页是「不显示」）', () => {
    assert.equal(nodeNamed('RedDot')._active, true, '根节点 active 归宿主管，prefab 里保持 true');
    for (const name of ['Icon', 'Spine', 'Title']) {
        assert.equal(nodeNamed(name)._active, false, `${name} 应默认收起`);
    }
});

// ============================================================
// C. 资源落位
// ============================================================

/** 读一张 png 的 sprite-frame 子资源 uuid（带 `@f9941`）。 */
function spriteFrameUuid(pngPath: string): string {
    const meta = JSON.parse(readFileSync(`${pngPath}.meta`, 'utf8')) as {
        subMetas: Record<string, { importer: string; uuid: string }>;
    };
    const key = Object.keys(meta.subMetas).find((k) => meta.subMetas[k].importer === 'sprite-frame');
    assert.ok(key, `${pngPath} 没有 sprite-frame 子资源`);
    return meta.subMetas[key as string].uuid;
}

test('C1 三张静态图在盘上，Icon 用的是普通红点那张', () => {
    const files = ['cm_red_dot', 'cm_red_dot_num', 'cm_red_dot_new'];
    for (const name of files) {
        assert.ok(existsSync(`${COMMON_ART_DIR}/${name}.png`), `缺图 ${name}.png`);
        assert.ok(existsSync(`${COMMON_ART_DIR}/${name}.png.meta`), `缺图 ${name}.png.meta`);
    }
    const frame = compOfType('Icon', 'cc.Sprite')._spriteFrame as Obj;
    assert.equal(frame.__uuid__, spriteFrameUuid(`${COMMON_ART_DIR}/cm_red_dot.png`));
});

test('C2 spine 四件套在盘上，`.atlas` 必须叫 `.atlas.txt` 且 prefab 的 _skeletonData 与 .skel.meta 一致', () => {
    for (const file of ['reddot.skel', 'reddot.skel.meta', 'reddot.atlas.txt', 'reddot.atlas.txt.meta', 'reddot.png', 'reddot.png.meta']) {
        assert.ok(existsSync(`${SPINE_DIR}/${file}`), `缺 spine 资源 ${file}`);
    }
    assert.equal(existsSync(`${SPINE_DIR}/reddot.atlas`), false, '裸 .atlas 后缀 Cocos 3.8 不认，必须改成 .atlas.txt');

    const skelMeta = JSON.parse(readFileSync(`${SPINE_DIR}/reddot.skel.meta`, 'utf8')) as {
        uuid: string;
        userData: { atlasUuid: string };
    };
    const skeleton = compOfType('Spine', 'sp.Skeleton');
    assert.equal((skeleton._skeletonData as Obj).__uuid__, skelMeta.uuid, 'prefab 里的 skeletonData 与 .skel.meta 不一致');
    assert.equal((skeleton._skeletonData as Obj).__expectedType__, 'sp.SkeletonData');
    assert.equal(skeleton.defaultAnimation, 'anmation', '⚠️ 上游拼写就少一个 i，别「修正」');
    assert.equal(skeleton.defaultSkin, 'default');

    // `.atlas.txt` 里写的图名必须还是 `reddot.png`（改名会让 spine 找不到贴图）
    const atlasMeta = JSON.parse(readFileSync(`${SPINE_DIR}/reddot.atlas.txt.meta`, 'utf8')) as { uuid: string };
    assert.equal(skelMeta.userData.atlasUuid, atlasMeta.uuid, '.skel.meta 的 atlasUuid 没指向 .atlas.txt');
    const atlas = readFileSync(`${SPINE_DIR}/reddot.atlas.txt`, 'utf8');
    assert.ok(/\nreddot\.png\s*\n/.test(`\n${atlas}`), `.atlas.txt 里的图名必须是 reddot.png：\n${atlas}`);
});

// ============================================================
// D. 源码口径（读文本，避免 import 依赖 `cc` 的模块）
// ============================================================

const ART_SOURCE = readFileSync(RED_DOT_ART_TS, 'utf8');
const DOT_SOURCE = readFileSync(RED_DOT_TS, 'utf8');

test('D1 取图路径必须是 `<root>/<name>/spriteFrame`（少这一段 = 静默留白 + 一条 warn）', () => {
    assert.ok(ART_SOURCE.includes("spriteFramePath(RED_DOT_ART_ROOT, name)"), 'redDotArtPath 必须走 spriteFramePath');
    assert.match(ART_SOURCE, /createRoutedSpriteFrameCache\('RedDot'\)/);
    const loader = readFileSync('assets/script/app/common/SpriteFrameCache.ts', 'utf8');
    assert.match(loader, /routedLoad\(path, SpriteFrame,/);
    assert.ok(!ART_SOURCE.includes('resources.load(artKey('), '不能拿裸路径去 load');
});

test('D2 三个美术常量与 prefab/资源落位一致（改一处要三处同改）', () => {
    assert.ok(ART_SOURCE.includes("ordinary: 'cm_red_dot'"), 'ordinary 图名');
    assert.ok(ART_SOURCE.includes("number: 'cm_red_dot_num'"), 'number 图名');
    assert.ok(ART_SOURCE.includes("new: 'cm_red_dot_new'"), 'new 图名');
    assert.ok(ART_SOURCE.includes('ordinary: [30, 29]'), 'ordinary 显示尺寸');
    assert.ok(ART_SOURCE.includes('number: [30, 30]'), 'number 显示尺寸');
    assert.ok(ART_SOURCE.includes('new: [30, 29]'), 'new 显示尺寸');
    assert.ok(ART_SOURCE.includes("RED_DOT_SPINE_ANIMATION = 'anmation'"), '动画名常量');
    assert.ok(ART_SOURCE.includes('width: 33'), 'spine 宽');
    assert.ok(ART_SOURCE.includes('height: 38.4'), 'spine 高');
    // ⚠️ 27.5×32 是老端 prefab 节点尺寸（loader 缩放分支被 width=0 短路掉，不是渲染尺寸）——
    //    只在注释里作为「反例」出现，不能出现在代码里
    const codeOnly = ART_SOURCE.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));
    assert.equal(codeOnly.some((line) => line.includes('27.5')), false, '27.5（老端 prefab 的节点尺寸）不该出现在代码里');
});

test('D3 spine 只播一次（重复 setAnimation 会把动画打回第一帧）', () => {
    assert.ok(DOT_SOURCE.includes("setAnimation(0, RED_DOT_SPINE_ANIMATION, true)"), '必须用常量而不是裸字符串');
    const calls = DOT_SOURCE.match(/setAnimation\(/g) ?? [];
    assert.equal(calls.length, 1, `setAnimation 应只在一处调用，实际 ${calls.length} 处`);
    assert.ok(DOT_SOURCE.includes('spinePlaying'), '必须有「已在播」的短路标志');
});

test('D4 根节点 active 不在 onLoad 里被写死（否则宿主再写 active=true 会露上一帧残影）', () => {
    // 按大括号配平截出 onLoad 的方法体（不能用「下一个 'setRedDot(' 」当终点 —— 注释里也出现过）
    const start = DOT_SOURCE.indexOf('protected onLoad(): void {');
    assert.ok(start > 0, '找不到 onLoad');
    const end = DOT_SOURCE.indexOf('\n    }', start);
    assert.ok(end > start, 'onLoad 方法体没闭合');
    const onLoad = DOT_SOURCE.slice(start, end);

    assert.equal(/this\.node\.active\s*=/.test(onLoad), false, 'onLoad 不应写根节点 active');
    for (const name of ['this.icon.node.active', 'this.spine.node.active', 'this.titleLabel.node.active']) {
        assert.ok(onLoad.includes(name), `onLoad 应把 ${name} 收起`);
    }
});

test('D5 ⚠️ FGUI `pivot + anchor="true"` 的 xy 是中心：Title 的 (0.5,-0.5) 不能当左上角算', () => {
    const title = nodeNamed('Title')._lpos as Obj;
    // FGUI `title xy=8,1 size=15,29` + `relation center-center,middle-middle`
    // ⇒ 中心 (15.5,15.5) − 容器中心 (15,15) = (+0.5,+0.5) FGUI ⇒ Cocos (+0.5,−0.5)
    assert.equal(Math.abs((title.x as number) - 0.5) < 1e-6, true, `Title.x 应为 0.5，实际 ${title.x}`);
    assert.equal(Math.abs((title.y as number) + 0.5) < 1e-6, true, `Title.y 应为 -0.5，实际 ${title.y}`);
    const icon = nodeNamed('Icon')._lpos as Obj;
    assert.equal(icon.x, 0, 'icon 中心正好在容器中心');
    assert.equal(icon.y, 0, 'icon 中心正好在容器中心');
});
