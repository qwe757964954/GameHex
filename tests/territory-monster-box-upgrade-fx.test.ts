/**
 * 「巡逻宝箱升级成功」= 屏正中播一次 spine 字特效（2026-11-25）。
 *
 * ## 为什么要有这条
 *
 * 这条链路上**每一环错了都不会报错**，只会「看起来不太对」：
 *
 *   · 预制里的 `_skeletonData` uuid 抄错 / 素材改名 ⇒ 打开面板就是一片空白，
 *     控制台只会有一行资源警告，玩法照跑；
 *   · `defaultAnimation` 写成 `shengjie`（升阶）⇒ 演的是一句意思不对的字；
 *   · `loop` 忘记关 / `setAnimation` 末位传 `true` ⇒ 字在屏幕中间一直重播；
 *   · 播完不收节点（`loop = false` 的骨架停在最后一帧）⇒ 字永远糊在屏中间；
 *   · 挂错父节点（比如挂到 `Panel` 里）⇒ 就变成「面板中间」而不是「屏幕中间」。
 *
 * 所以这里既钉**预制本身**（结构 / uuid / 动画名 / loop），也钉**面板怎么播**
 * （播一次、屏正中、到点收），再把「成功不补 toast」的选择钉在 Model 侧。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TERRITORY_MONSTER_BOX_FX } from '../assets/script/app/territory/model/TerritoryMonsterBoxFx';

const PREFAB_PATH = 'assets/resources/ui/territory/TerritoryMonsterBoxUpgradeFx.prefab';
const SKEL_META_PATH = 'assets/resources/skel/UI升级升星升阶特效字/shengduan.skel.meta';
const PANEL_PATH = 'assets/script/app/territory/view/TerritoryMonsterBoxPanel.ts';
const MODEL_PATH = 'assets/script/app/territory/application/TerritoryModel.ts';

const PANEL_SRC = readFileSync(PANEL_PATH, 'utf8');
const MODEL_SRC = readFileSync(MODEL_PATH, 'utf8');

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    _children?: { __id__: number }[];
    _components?: { __id__: number }[];
    _lscale?: { x: number; y: number };
    _layer?: number;
    _parent?: unknown;
    defaultAnimation?: string;
    defaultSkin?: string;
    loop?: boolean;
    _skeletonData?: { __uuid__?: string; __expectedType__?: string };
    _contentSize?: { width: number; height: number };
    _anchorPoint?: { x: number; y: number };
    node?: { __id__: number };
    [key: string]: unknown;
}

const objects = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as IPrefabObject[];

function ofType(type: string): IPrefabObject | undefined {
    return objects.find((object) => object && object.__type__ === type);
}

const prefab = ofType('cc.Prefab');
const root = objects[1];
const transform = ofType('cc.UITransform');
const skeleton = ofType('sp.Skeleton');

test('预制结构：单节点 sp.Skeleton（与 CardUpgradeFx 同一份骨架）', () => {
    assert.ok(prefab, '缺 cc.Prefab');
    assert.equal(root?.__type__, 'cc.Node', '根节点必须是第 1 个对象（cc.Prefab.data 指向它）');
    assert.equal(root?._name, 'TerritoryMonsterBoxUpgradeFx');
    assert.equal(root?._parent, null, '预制根节点不该有父节点');
    assert.equal(root?._children?.length ?? 0, 0, '字特效是单节点，不该有子节点');
    assert.ok(transform, '缺 cc.UITransform');
    assert.ok(skeleton, '缺 sp.Skeleton');
    assert.deepEqual(root?._components?.map((entry) => objects[entry.__id__].__type__),
        ['cc.UITransform', 'sp.Skeleton'], '组件顺序与 CardUpgradeFx 一致');
    assert.equal(skeleton?.node?.__id__, 1, 'sp.Skeleton 必须挂在根节点上');
    assert.equal(root?._layer, 33554432, '层必须是 UI_2D（否则渲染不到相机里）');
});

test('预制绑定：SkeletonData uuid 与 shengduan.skel 一致，动画取 shengji', () => {
    const meta = JSON.parse(readFileSync(SKEL_META_PATH, 'utf8')) as { uuid: string };
    assert.equal(skeleton?._skeletonData?.__uuid__, meta.uuid,
        '预制指向的 SkeletonData 必须就是美术交付的 shengduan.skel');
    assert.equal(skeleton?._skeletonData?.__expectedType__, 'sp.SkeletonData');
    assert.equal(skeleton?.defaultSkin, 'default', 'shengduan 只有 default 一套皮肤');
    // 三条动画：shengji 升级 / shengjie 升阶 / shengxing 升星 —— 这里要「升级」
    assert.equal(skeleton?.defaultAnimation, 'shengji');
    assert.equal(skeleton?.loop, false, '只播一次，不能在预制里就开循环');
});

test('预制几何：UITransform 取素材包围盒 140×60、锚点居中', () => {
    // 三条动画逐帧包围盒都是 139.2 × 58.8、中心≈原点（见 tools/build_monster_box_upgrade_fx.py）
    assert.equal(transform?._contentSize?.width, 140);
    assert.equal(transform?._contentSize?.height, 60);
    assert.equal(transform?._anchorPoint?.x, 0.5);
    assert.equal(transform?._anchorPoint?.y, 0.5);
    // 逻辑 139×59 太小读不出字 ⇒ 预制里烘 2 倍（屏上 280×120）
    assert.equal(root?._lscale?.x, 2);
    assert.equal(root?._lscale?.y, 2);
});

test('面板：屏正中播一次，到点收起来', () => {
    // ① 预制路径与面板同在首包 resources（不带 bundle 也能加载）
    assert.match(PANEL_SRC, /const UPGRADE_FX_PREFAB_PATH = 'ui\/territory\/TerritoryMonsterBoxUpgradeFx'/);
    assert.match(PANEL_SRC, /const UPGRADE_FX_ANIMATION = 'shengji'/);
    assert.doesNotMatch(PANEL_SRC, /UPGRADE_FX_PREFAB_PATH = '[^']*assets\/resources/,
        'resources 下的路径要相对 bundle 根（不能带 assets/resources 前缀）');
    // ② 挂在弹窗根节点的 (0,0)：根节点是 720×1280 / 锚点 0.5 的全屏层 ⇒ 就是屏幕正中
    assert.match(PANEL_SRC, /private ensureUpgradeFx\(\): Node \| null \{[\s\S]{0,900}?const host = this\.node;/,
        '字特效的宿主必须是弹窗根节点，不是 Panel');
    assert.match(PANEL_SRC, /private ensureUpgradeFx\(\): Node \| null \{[\s\S]{0,900}?node\.setPosition\(0, 0, 0\)/);
    assert.match(PANEL_SRC, /node\.setSiblingIndex\(host\.children\.length - 1\)/,
        '排到兄弟最后才压得住 Dim / Panel');
    // ③ 播一次：末位 false（不循环）
    assert.match(PANEL_SRC, /skeleton\.setAnimation\(0, UPGRADE_FX_ANIMATION, false\)/);
    // ④ 播完收节点：素材会停在最后一帧，不收就一直糊在屏幕中间
    assert.match(PANEL_SRC, /private stepUpgradeFx\(\): void \{[\s\S]{0,400}?active = false/);
    assert.match(PANEL_SRC, /update\(\): void \{[\s\S]{0,160}?this\.stepUpgradeFx\(\)/,
        'update 里要推进「到点收起来」');
    assert.match(PANEL_SRC, /this\.upgradeFxHideAt = performance\.now\(\) \+ TERRITORY_MONSTER_BOX_FX\.upgradeFxSeconds \* 1000/,
        '收起时刻按统一登记的时长算，别在视图里写 1.1');
});

test('时长常量：够素材播完（1.07s）又不拖沓', () => {
    const seconds = TERRITORY_MONSTER_BOX_FX.upgradeFxSeconds;
    assert.ok(seconds >= 1.07, `字特效时长 ${seconds}s 比素材 1.07s 还短 ⇒ 字会被切断`);
    assert.ok(seconds <= 1.4, `字特效收得太晚（${seconds}s）⇒ 字停在屏幕中间显脏`);
});

test('成功的主反馈是字特效：Model 只在特效没演成时补文案', () => {
    assert.match(MODEL_SRC, /if \(fxPlayed\) return;/);
    assert.match(MODEL_SRC, /notifyMonsterBoxRollSettled\(cellId: number, fxPlayed = false\): void/);
    // 失败仍然是一条 toast（字特效只表达「成功了」）
    assert.match(MODEL_SRC, /this\.showTip\(TERRITORY_TEXTS\.monsterBoxUpgradeFailed\)/);
});

test('每次开面板重新拿预制（资源作用域跟着 open 一起换）', () => {
    assert.match(PANEL_SRC, /protected onOpen\(userData\?: unknown\): void \{[\s\S]{0,900}?this\.upgradeFxLoaded = false;[\s\S]{0,600}?this\.loadUpgradeFx\(\)/,
        '上一趟的 prefab 随作用域 dispose，不重置就永远只有第一次有特效');
    assert.match(PANEL_SRC, /protected onClose\(\): void \{[\s\S]{0,220}?this\.closing = true;/,
        '关闭时要挡住起演（节点马上跟着销毁）');
});
