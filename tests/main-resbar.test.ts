/**
 * 主界面顶部「资源栏」的单测。
 *
 * 覆盖三个**会静默失效**的点（都是本项目踩过的同一类坑）：
 *
 *   ① **图标白名单与磁盘不同步** —— `RES_BAR_ICON_ART` 里写了个目录里没有的名字，
 *      `resources.load` 只打一条 warn、界面留白，不报错。所以这里把白名单逐个对到
 *      assetPath(`<ArtPaths.RESBAR_ART_ROOT>/<名>.png`)。
 *   ② **满级时经验条变 `Infinity`** —— 老端口径是 `exp / level[lv+1].exp`，满级取不到
 *      下一级 → 0，而 `Sprite.fillRange = Infinity` 的表现不定（可能整条铺满）。
 *   ③ **prefab 掉绑定** —— 脚本引用存的是脚本资产 uuid 派生的 cid，prefab 被回滚 /
 *      重新序列化时引用会变 `null`，运行时只表现为「资源栏一直占位」。
 *      这里直接读 prefab JSON 复核结构、`_layer` 与每个 `@property` 的指向。
 *
 * 只 import 零引擎依赖的模块：`MainResBarTypes` 的依赖链（`net/RequestGuard`）
 * 自身没有任何 import，所以能在 Node 里直接跑。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    RESBAR_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    artKey,
    spriteFramePath,
} from '../assets/script/app/ArtPaths';
import {
    buildResBarView,
    computeExpRatio,
    formatResValue,
    RES_BAR_ICON_ART,
    RES_BAR_KEYS,
    type ResBarRoleRow,
} from '../assets/script/app/main/MainResBarTypes';
import { assetPath } from './helpers/asset-paths';

const RESOURCES = 'assets/resources';
// ⚠️ 2026-09-24：资源栏已从 `ArenaRoot.prefab`（主界面外壳）**搬到 `ArenaRoot.prefab`（竞技页）**。
//    口径变化：它是「竞技页自己的常驻 HUD」，随 ArenaRoot 一起 instantiate / destroy
//    （切到角色页就收起来），不再挂在外壳上。读 prefab 的路径随之改到 ArenaRoot。
const HUD_PREFAB = assetPath('ui/main/ArenaRoot.prefab');
// ⚠️ 2026-09-29：货币三格**不再内联在 ArenaRoot 里**，而是 `common/ResBar.prefab` 的
//    嵌套 prefab 实例（宿主只存 `PrefabInfo.asset.__uuid__` + `cc.PrefabInstance`）。
//    好处：改公共件穿透所有宿主（HUD / 商城 / 天赋页）。代价：宿主文件里**看不到** `Res0/1/2`
//    ⇒ 想断言几何只能「实例位置（本文件守） ⊕ 公共件内部相对坐标（militia-talent-ui.test.ts 守）」。
const COMMON_RESBAR = assetPath('ui/common/ResBar.prefab');
const COMMON_RESBAR_UUID = (JSON.parse(readFileSync(`${COMMON_RESBAR}.meta`, 'utf8')) as { uuid: string }).uuid;

/** `level.json` 的形状（`{level, exp}`，`exp` = 从该级升到下一级所需）。 */
const LEVEL_ROWS = [{ level: 1, exp: 0 }, { level: 2, exp: 5 }, { level: 3, exp: 10 }];

// ── 数据层 ────────────────────────────────────────────────────────────

test('formatResValue：体力走「当前/上限」，负数归零但上限保持原值', () => {
    assert.equal(formatResValue({ end: 30, endMax: 120 }, 'end'), '30/120');
    // 老端 `Math.max(vo.GetEnd(), 0)` —— 体力可以被消耗到负，显示归零、上限不动
    assert.equal(formatResValue({ end: -5, endMax: 120 }, 'end'), '0/120');
    // 缓存 JSON 往返后 sint32 也会变字符串，两条路都得走通
    assert.equal(formatResValue({ end: '7', endMax: '9' }, 'end'), '7/9');
    // 缺字段 → 0，不要变成 "undefined/undefined"
    assert.equal(formatResValue({}, 'end'), '0/0');
});

test('formatResValue：gold/gem 是 string 字段，超 2^53 也不许过 number', () => {
    const huge = '12345678901234567890';
    assert.equal(formatResValue({ gold: huge }, 'gold'), huge);
    assert.equal(formatResValue({ gem: '20' }, 'gem'), '20');
    // 服务端给空串时显示 0，而不是留一片空白
    assert.equal(formatResValue({ gold: '' }, 'gold'), '0');
    // 没登记的资源键 / 没拿到角色行 → 空串（视图层据此保留空图）
    assert.equal(formatResValue({ gold: '1' }, 'nope'), '');
    assert.equal(formatResValue(null, 'gold'), '');
    assert.equal(formatResValue(undefined, 'end'), '');
});

test('computeExpRatio：取「下一级」那一行；满级 / 上限<=0 / 缺表一律 0', () => {
    assert.equal(computeExpRatio(1, 0, LEVEL_ROWS), 0);
    assert.equal(computeExpRatio(1, 3, LEVEL_ROWS), 0.6);
    assert.equal(computeExpRatio(1, 5, LEVEL_ROWS), 1);
    // 越界的经验值要收紧到 1：`fillRange > 1` 在 Sprite 上不等于「刚好满」
    assert.equal(computeExpRatio(1, 99, LEVEL_ROWS), 1);
    // 表里没有 lv+1 那一行 = 满级（老端 `GetExpMax()` 返回 0）
    assert.equal(computeExpRatio(3, 5, LEVEL_ROWS), 0);
    // 有一行但 exp 为 0：绝不能算出 Infinity（`level.json` 首行 `{level:1, exp:0}` 就是这个形状）
    assert.equal(computeExpRatio(1, 3, [{ level: 2, exp: 0 }]), 0);
    assert.equal(computeExpRatio(1, 3, null), 0);
    assert.equal(computeExpRatio(0, 3, LEVEL_ROWS), 0);
    assert.equal(computeExpRatio(1, -2, LEVEL_ROWS), 0);
});

test('buildResBarView：三格顺序取自 RES_BAR_KEYS，只有体力格带「+」', () => {
    const role: ResBarRoleRow = {
        // uint64 的 Long 形状：`id` 走 toString()、`img` 走 low/high 兜底
        id: { low: 10129, high: 0, toString: () => '10129' },
        img: { low: 70001, high: 0 },
        name: '雨晴冰轮',
        lv: 1,
        exp: 4,
        gold: '1000',
        gem: '20',
        end: 30,
        endMax: 120,
    };
    const view = buildResBarView(role, LEVEL_ROWS);
    assert.ok(view, '有角色行时必须产出视图数据');
    assert.equal(view!.name, '雨晴冰轮');
    assert.equal(view!.levelText, '1', '等级只显示数字，不带 LV 前缀（2026-10-20 需求）');
    assert.equal(view!.uidText, 'uid:10129');
    assert.equal(view!.avatarId, '70001');
    assert.equal(view!.expRatio, 0.8);   // 4 / level[2].exp = 5

    // 槽位顺序、数值、加号显隐一次比完（顺序错了界面就会串格）
    assert.deepEqual(Array.from(view!.slots, (slot) => slot.key), ['gold', 'gem', 'end']);
    assert.deepEqual(Array.from(view!.slots, (slot) => slot.valueText), ['1000', '20', '30/120']);
    assert.deepEqual(Array.from(view!.slots, (slot) => slot.showPlus), [false, false, true]);
    assert.deepEqual(
        Array.from(view!.slots, (slot) => slot.iconArt),
        RES_BAR_KEYS.map((key) => RES_BAR_ICON_ART[key]),
    );

    // 昵称缺失时给空串（Label 显示空白，不是 "undefined"）
    assert.equal(buildResBarView({ lv: 2 }, null)!.name, '');
    // 没有角色行 → `null`，调用方保留 prefab 占位
    assert.equal(buildResBarView(null, LEVEL_ROWS), null);
    assert.equal(buildResBarView(undefined, LEVEL_ROWS), null);
});

test('buildResBarView：槽位顺序可注入，未知资源键给空图标名', () => {
    const view = buildResBarView({ lv: 1 }, null, ['end', 'gold']);
    assert.deepEqual(Array.from(view!.slots, (slot) => slot.key), ['end', 'gold']);
    assert.equal(view!.slots[0].showPlus, true);
    // 没登记的资源键 → `iconArt` 空串（视图层据此把图清空，而不是留上一格的图）
    assert.equal(buildResBarView({ lv: 1 }, null, ['mystery'])!.slots[0].iconArt, '');
});

// ── 图标白名单 ↔ 磁盘 ────────────────────────────────────────────────

test('资源栏图标：白名单覆盖三格，且每张图真实存在于 ArtPaths.RESOURCE_ICON_ART_ROOT 下', () => {
    // ⚠️ 2026-09-29：货币图标目录统一到 `icons/resource`（真源 `roleProperty.icon`）。
    //    原先取 `image/main/resbar`，那份里有 4 张与 `icons/resource` **同 md5** 的副本。
    assert.equal(RESOURCE_ICON_ART_ROOT, 'icons/resource');
    assert.equal(spriteFramePath(RESOURCE_ICON_ART_ROOT, '图标_铜币'), 'icons/resource/图标_铜币/spriteFrame');
    assert.equal(artKey(RESOURCE_ICON_ART_ROOT, '图标_铜币'), 'icons/resource/图标_铜币');

    // `RESBAR_ART_ROOT` 现在只服务 HUD 专用件（头像框 / 货币格底 / 血条 / 加号），不再是货币图目录
    assert.equal(RESBAR_ART_ROOT, 'image/main/resbar');

    for (const key of RES_BAR_KEYS) {
        const name = RES_BAR_ICON_ART[key];
        assert.ok(name, `RES_BAR_KEYS 里的「${key}」没登记图标 → 那一格会静默留白`);
        const file = `${RESOURCES}/${RESOURCE_ICON_ART_ROOT}/${name}.png`;
        assert.ok(existsSync(file), `资源键「${key}」缺美术 ${file}`);
    }

    // 五个资源键各自一张图，别有两格共用同一个名字
    const names = Object.values(RES_BAR_ICON_ART);
    assert.equal(new Set(names).size, names.length, '白名单里有两个资源键指到同一张图');
});

// ── prefab 结构 / 绑定 ───────────────────────────────────────────────

type PrefabObject = Record<string, unknown>;
type ObjRef = { __id__: number };

function readPrefab(path: string): PrefabObject[] {
    return JSON.parse(readFileSync(path, 'utf8')) as PrefabObject[];
}

const childrenOf = (node: PrefabObject): ObjRef[] => (node._children ?? []) as ObjRef[];
const compsOf = (node: PrefabObject): ObjRef[] => (node._components ?? []) as ObjRef[];
const sizeOf = (component: PrefabObject): { width: number; height: number } =>
    component._contentSize as { width: number; height: number };
const anchorOf = (component: PrefabObject): { x: number; y: number } =>
    component._anchorPoint as { x: number; y: number };
const posOf = (node: PrefabObject): { x: number; y: number } => node._lpos as { x: number; y: number };

/** 按名字取**直接子节点**（`Icon` / `Value` / `Bg` 在三个资源格里重名，必须按父节点定位）。 */
function child(prefab: PrefabObject[], parent: PrefabObject, name: string): PrefabObject {
    const found = childrenOf(parent).map((ref) => prefab[ref.__id__]).find((node) => node._name === name);
    assert.ok(found, `节点「${String(parent._name)}」下找不到子节点 ${name}`);
    return found!;
}

/** 取节点上「含 marker 字段」的组件（避免把用例绑死在脚本 cid 上）。 */
function component(prefab: PrefabObject[], node: PrefabObject, marker: string): PrefabObject {
    const found = compsOf(node).map((ref) => prefab[ref.__id__]).find((comp) => marker in comp);
    assert.ok(found, `节点「${String(node._name)}」上找不到含 ${marker} 的组件`);
    return found!;
}

function transform(prefab: PrefabObject[], node: PrefabObject): PrefabObject {
    const found = compsOf(node).map((ref) => prefab[ref.__id__]).find((comp) => comp.__type__ === 'cc.UITransform');
    assert.ok(found, `节点「${String(node._name)}」上没有 UITransform`);
    return found!;
}

/** 一个 `@property` 引用：解出它指向的对象（空引用直接红）。 */
function binding(prefab: PrefabObject[], comp: PrefabObject, prop: string): PrefabObject {
    const ref = comp[prop] as ObjRef | null | undefined;
    assert.ok(ref && typeof ref.__id__ === 'number', `${String(comp.__type__)} 的 ${prop} 是空引用`);
    const target = prefab[ref!.__id__];
    assert.ok(target, `${prop} 指向的对象不存在`);
    return target!;
}

/** 组件所在节点（`cc.Component.node` 是自引用，可直接查）。 */
function hostNode(prefab: PrefabObject[], comp: PrefabObject): PrefabObject {
    return prefab[(comp.node as ObjRef).__id__];
}

const KEYS_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `.ts.meta` 的 uuid → prefab 里的**压缩 cid**（脚本组件在 prefab 里的 `__type__`）。 */
function cidOf(tsPath: string): string {
    const uuid = (JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid;
    const hex = uuid.replace(/-/g, '');
    let cid = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const v = parseInt(hex.slice(i, i + 3), 16);
        cid += KEYS_B64[v >> 6]! + KEYS_B64[v & 63]!;
    }
    return cid;
}

test('ArenaRoot.prefab：资源栏子树的结构、layer 与全部 @property 绑定都在', () => {
    const prefab = readPrefab(HUD_PREFAB);

    const nodeNamed = (name: string): PrefabObject => {
        const found = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === name);
        assert.ok(found, `ArenaRoot.prefab 里没有节点 ${name}`);
        return found!;
    };

    // ── 根：铺满 720×1280 + 顶对齐（随全面屏撑满宽度，底部不拉伸）────────
    const layer = nodeNamed('ResBarLayer');
    const layerTf = transform(prefab, layer);
    assert.equal(sizeOf(layerTf).width, 720);
    assert.equal(sizeOf(layerTf).height, 1280);

    const widget = component(prefab, layer, '_alignFlags');
    // 45 = TOP|LEFT|RIGHT
    assert.equal(widget._alignFlags, 45, 'Widget 必须是 左右撑满 + 顶对齐');
    assert.equal(widget._alignMode, 2, 'alignMode 必须是 2（ALWAYS，运行时改尺寸也重排）');
    assert.equal(widget._top, 0);
    assert.equal(widget._left, 0);
    assert.equal(widget._right, 0);

    // ── 几何：反解出的画布框必须逐条等于 FGUI 原值 ───────────────────────
    //  见下面 `<xxx> 几何` 用例；这里只确认容器本身的锚点没跑偏。
    // ⚠️ 2026-09-29：玩家信息块与货币条现在**平级**挂在 ResBarLayer 下（原先套一层 `Mid`）——
    //    货币条是 `common/ResBar` 的嵌套实例（壳节点没 `_name`），PlayerInfo 直接是首个子节点。
    assert.equal(anchorOf(layerTf).x, 0.5);
    assert.equal(anchorOf(layerTf).y, 0.5);

    // ── 玩家信息块：容器几何 + 八个引用逐个落地 ──────────────────────────
    const playerInfo = child(prefab, layer, 'PlayerInfo');
    assert.equal(childrenOf(layer)[0].__id__, prefab.indexOf(playerInfo), 'PlayerInfo 必须是 ResBarLayer 的首个子节点');
    const infoTf = transform(prefab, playerInfo);
    assert.equal(sizeOf(infoTf).width, 463);
    assert.equal(sizeOf(infoTf).height, 106);
    // ⚠️ 必须是 (0.5, 0.5)：锚点决定「子节点位置的参照点」。写成 (0.5,1) 会让
    //   参照点从框中心变成框顶边，整块玩家信息被抬 53px（2026-09-23 踩过）。
    assert.equal(anchorOf(infoTf).x, 0.5);
    assert.equal(anchorOf(infoTf).y, 0.5, 'PlayerInfo 的锚点必须是框中心，子节点坐标才是按「父中心」算的');

    const bar = component(prefab, layer, 'uidLabel');

    const avatarHost = hostNode(prefab, binding(prefab, bar, 'avatarIcon'));
    assert.equal(avatarHost._name, 'HeadIcon');
    assert.equal((avatarHost._parent as ObjRef).__id__, prefab.indexOf(playerInfo));
    // 头像位 80×80，尺寸必须固定（CUSTOM + 不裁剪），否则贴图会改写宿主节点
    assert.equal(sizeOf(transform(prefab, avatarHost)).width, 80);
    const avatarSprite = binding(prefab, bar, 'avatarIcon');
    assert.equal(avatarSprite._sizeMode, 0, '头像 Sprite 必须 CUSTOM');
    assert.equal(avatarSprite._isTrimmedMode, false);

    const nameComp = binding(prefab, bar, 'nameLabel');
    assert.equal(nameComp._string, '雨晴冰轮', '名称位要留占位文案，不能是空串');
    assert.equal(binding(prefab, bar, 'levelLabel')._string, 'LV1');
    assert.equal(binding(prefab, bar, 'uidLabel')._string, 'uid:0');
    assert.equal(binding(prefab, bar, 'levelLabel')._fontSize, 20);
    assert.equal(binding(prefab, bar, 'nameLabel')._fontSize, 22);

    // 经验条：只靠 fillRange 表现进度 ⇒ 必须固定尺寸 + FILLED/HORIZONTAL + 初始 0
    const expFill = binding(prefab, bar, 'expFill');
    assert.equal(expFill._type, 3, 'Sprite type 必须是 3（FILLED）');
    assert.equal(expFill._fillType, 0, 'fillType 必须是 0（HORIZONTAL）');
    assert.equal(expFill._fillStart, 0);
    assert.equal(expFill._fillRange, 0, '初始进度必须是 0（没数据时不该显示满格）');
    assert.equal(expFill._sizeMode, 0, '经验条必须 CUSTOM，否则贴图会改写宿主宽度');
    assert.equal(sizeOf(transform(prefab, hostNode(prefab, expFill))).width, 374);

    // ── 货币三格：宿主里**一个内联节点都不许有**（全在公共实例里）─────────
    assert.equal(
        prefab.filter((entry) => entry.__type__ === 'cc.Node' && /^Res\d$/.test(String(entry._name))).length,
        0,
        'ArenaRoot 里不该再有内联的 Res0/1/2 —— 那是「手抄一份」的旧形态，改公共件时不会同步',
    );

    // ── 每个 UI 节点都必须在 33554432（UI_2D），否则相机拍不到 ──────────
    // ⚠️ 按 `_components` 筛「真实节点」：嵌套实例的壳节点只有 `_parent` + `_prefab`，
    //    没有 `_components` / `_layer`（它的 layer 在源 prefab 里，且已由各公共件自己的用例守）。
    //    ArenaRoot 里共有 5 个这样的壳（含货币条那个）⇒ 38 个 `cc.Node` 里只有 33 个是本文件的。
    const uiNodes = prefab.filter((entry) => entry.__type__ === 'cc.Node' && Array.isArray(entry._components));
    assert.ok(uiNodes.length >= 30, `只找到 ${uiNodes.length} 个 UI 节点，prefab 可能被截断了`);
    assert.deepEqual(
        Array.from(uiNodes.filter((entry) => entry._layer !== 33554432), (entry) => entry._name),
        [],
        'UI 节点的 _layer 必须全是 33554432',
    );
    assert.deepEqual(
        Array.from(uiNodes.filter((entry) => entry._layer !== 33554432), (entry) => entry._name),
        [],
        'UI 节点的 _layer 必须全是 33554432',
    );
});

test('ArenaRoot.prefab：货币条 = common/ResBar 的嵌套实例（实例身份 + 位置 + resKeys 焊死 RES_BAR_KEYS）', () => {
    // ⚠️ 2026-09-29（第二轮修正）：HUD 的货币三格**不是**「内联抄一份 + 挂脚本」，
    //   而是 `common/ResBar.prefab` 的**嵌套 prefab 实例**（与天赋页 `TabMilitiaTalent` 同一姿势）。
    //   区别是决定性的：只有实例化，改公共件才能穿透所有宿主；手抄一份 = 改 N 处、必然漂移。
    //   这条用例守四件事，全是**静默失效**：
    //   ① 实例壳挂的不是公共件（uuid 对不上）⇒ 改公共件时 HUD 纹丝不动，零报错；
    //   ② `resKeys` 与 `RES_BAR_KEYS` 各说各话 ⇒ 货币顺序悄悄漂移（两处真源）；
    //   ③ 位置覆盖丢了 ⇒ 整条资源栏落回 (0,0)，压住玩家信息且不报错；
    //   ④ 宿主里又长回内联的 `Res0/1/2` / `ResBar`·`MainResBarSlot` 脚本 ⇒ 回归「手抄」形态。
    const prefab = readPrefab(HUD_PREFAB);
    const layer = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'ResBarLayer');
    assert.ok(layer, 'ArenaRoot.prefab 里没有 ResBarLayer');

    // 实例壳 = 唯一没有 `_name` 的子节点（嵌套实例根不落 `_name`，名字在覆盖项里）
    const shellRef = childrenOf(layer!).find((ref) => prefab[ref.__id__]._name === undefined);
    assert.ok(shellRef, 'ResBarLayer 下找不到嵌套实例壳 —— 货币条要么被删了，要么又变成内联节点树了');
    const shell = prefab[shellRef!.__id__];
    assert.equal(shell._components, undefined, '实例壳不该有 _components（有就说明被改回内联了）');

    const info = prefab[(shell._prefab as ObjRef).__id__];
    assert.equal(
        (info.asset as { __uuid__?: string } | undefined)?.__uuid__,
        COMMON_RESBAR_UUID,
        '货币条必须实例化 common/ResBar.prefab（uuid 对不上 ⇒ 改公共件不会同步到 HUD）',
    );

    // ① 覆盖项：名字 / 位置 / 格数真源（宿主里读不到 Res0/1/2，它们的值在公共件里）
    const instance = prefab[(info.instance as ObjRef).__id__];
    assert.equal(instance.__type__, 'cc.PrefabInstance');
    const overrides = new Map<string, unknown>();
    for (const ref of (instance.propertyOverrides ?? []) as ObjRef[]) {
        const ov = prefab[ref.__id__] as { propertyPath?: string[]; value?: unknown };
        overrides.set((ov.propertyPath ?? []).join('.'), ov.value);
    }
    assert.equal(overrides.get('_name'), 'ResBar', '实例覆盖名应为 ResBar');
    const lpos = overrides.get('_lpos') as { x: number; y: number } | undefined;
    assert.ok(lpos, '实例必须覆盖 _lpos —— 丢了就落回 (0,0)，整条压在玩家信息上');
    assert.deepEqual({ x: lpos!.x, y: lpos!.y }, { x: -84, y: 587 }, '实例位置必须覆盖成 (-84,587)（= 原 Mid 的框左上）');

    // ② 格数真源 = 实例覆盖的 `resKeys`
    //   🔴 2026-10-26 用户口径：「资源栏的按钮分别对应 银币 icon 和 体力 icon」
    //   ⇒ HUD 从 `gold,gem`（银币 + 晶石）改成 **`gold,end`**（银币 + 体力），
    //     `gold` 的行是 `roleProperty.resId=7 icon=图标_铜币`，`end` 是 `resId=9 icon=图标_体力`。
    //   别再拿 `RES_BAR_KEYS`（银币/晶石/体力三格）比 —— 那个常量只服务 `buildResBarView` 的默认参数。
    assert.equal(
        overrides.get('resKeys'),
        'gold,end',
        '实例上的 resKeys 必须是 gold,end（银币 + 体力）—— 改这里要同步 HUD 版面口径',
    );
    // ③ HUD 这三国货币是写死的（老端同口径）⇒ 不覆盖 `openRefId`，继承公共件默认 0
    assert.ok(!overrides.has('openRefId'), 'HUD 货币不走 open.json，不该覆盖 openRefId');

    // ④ 反向断言：宿主里不许再有内联脚本 / 内联 Res 格
    for (const tsPath of ['assets/script/app/common/ResBar.ts', 'assets/script/app/main/MainResBarSlot.ts']) {
        assert.ok(
            !prefab.some((entry) => entry?.__type__ === cidOf(tsPath)),
            `ArenaRoot 里不该再挂 ${tsPath} —— 那是「手抄一份」的旧形态（改公共件不会同步）`,
        );
    }
    assert.equal(
        prefab.filter((entry) => entry.__type__ === 'cc.Node' && /^Res\d$/.test(String(entry._name))).length,
        0,
        'ArenaRoot 里不该再有内联的 Res0/1/2',
    );

    // ⑤ `MainResBar` 上也不许留孤儿 `slotN` 字段（下次有人照它去接货币会接出死引用）
    const src = readFileSync('assets/script/app/main/MainResBar.ts', 'utf8');
    assert.doesNotMatch(src, /slot[0-2]:\s*MainResBarSlot/, 'MainResBar 不该再声明 slot0/1/2');
    assert.doesNotMatch(src, /from '\.\/MainResBarSlot'/, 'MainResBar 不该再 import MainResBarSlot');
    const bar = component(prefab, layer!, 'uidLabel');
    for (const index of [0, 1, 2]) {
        assert.equal(bar[`slot${index}`], undefined, `MainResBar 上残留孤儿字段 slot${index}（编辑器 save 应清掉）`);
    }
});

// ── 几何守卫：反解回画布像素，逐条对 FGUI 原值 ────────────────────────

/** 一个节点在画布（720×1280、y 向下、原点左上）里的框。 */
interface Box {
    name: string;
    path: string;
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * 把 prefab 的节点树反解成画布像素框。
 *
 *  Cocos 的规则：子节点 `position` 相对**父节点的锚点**（不是父的左上角），y 向上；
 *  锚点分数从**下往上**算 ⇒ 上边距用 `(1 - anchorY) * height`。
 *  根 `ResBarLayer` 铺满画布 720×1280，其锚点（中心）落在画布中心 (360, 640)。
 *
 *  ⚠️ 2026-09-29：遇到**嵌套实例壳**（只有 `_parent`+`_prefab`、没有 `_components`/`_layer`）
 *  就整棵跳过 —— 它的内部节点不落宿主文件，几何由公共件自己的用例（`militia-talent-ui.test.ts`）
 *  守，实例位置则由下面 `实例位置` 那条用例守。两者复合 = 整块世界坐标。
 */
function layoutBoxes(prefab: PrefabObject[], root: PrefabObject, rootAnchorWorld = { x: 360, y: 640 }): Box[] {
    const out: Box[] = [];
    const walk = (node: PrefabObject, parentAnchor: { x: number; y: number }, prefix: string): void => {
        if (!Array.isArray(node._components)) return; // 实例壳：内部不落盘，跳过
        const tf = transform(prefab, node);
        const { width, height } = sizeOf(tf);
        const anchor = anchorOf(tf);
        const pos = posOf(node);
        const anchorWorld = { x: parentAnchor.x + pos.x, y: parentAnchor.y - pos.y };
        const path = prefix ? `${prefix}/${String(node._name)}` : String(node._name);
        out.push({
            name: String(node._name),
            path,
            left: anchorWorld.x - anchor.x * width,
            top: anchorWorld.y - (1 - anchor.y) * height,
            width,
            height,
        });
        for (const child of childrenOf(node).map((ref) => prefab[ref.__id__])) {
            walk(child, anchorWorld, path);
        }
    };
    walk(root, rootAnchorWorld, '');
    return out;
}

/**
 * 期望框**直接抄自**老端 FairyGUI 源码
 * （`zarts/.../UIProject/assets/首页/组件/资源栏/*.xml`，画布 720×1280、y 向下）：
 *   FGUI 的框 `left = xy.x − pivot.x*width`、`top = xy.y − pivot.y*height`
 *   （`xy` 是 **pivot 点**的位置；没写 `pivot` 就是 `(0,0)`，此时 `xy` 就是左上角）
 *
 *  2026-09-23 在这条换算上连踩两处「拿错参照系」：Mid 锚点写成 `(0.5,1)`（垂直偏 53px）、
 *  PlayerInfo 的六个子节点拿 `mid` 的半宽 276 当父中心（水平偏 44.5px）—— 都是肉眼看不出的。
 *  这条用例把整块复原成 FGUI 的坐标，任何一处参照系错了都会红。
 *
 *  ⚠️ 2026-09-29：货币条改成嵌套实例后，`Mid` 这层**没了**（实例根直接挂 `ResBarLayer`），
 *  PlayerInfo 上提一位、`_lpos` 由 (-84,587)+(-44.5,0) 合成 (-128.5,587) —— 世界坐标不变。
 */
const FGUI_HOST_BOXES: ReadonlyArray<{ path: string; left: number; top: number; width: number; height: number }> = [
    { path: 'ResBarLayer', left: 0, top: 0, width: 720, height: 1280 },      // 铺满画布
    // 原 `ResBarLayer/Mid/PlayerInfo`：现在 Mid 没了，世界框不变（left=0, top=0）
    { path: 'ResBarLayer/PlayerInfo', left: 0, top: 0, width: 463, height: 106 },
    // <image name="组件_玩家信息背景" xy="14,15"/> 542×98
    { path: 'ResBarLayer/PlayerInfo/HeadBg', left: 14, top: 15, width: 542, height: 98 },
    // <loader name="icon" xy="22,22" size="80,80"/>
    { path: 'ResBarLayer/PlayerInfo/HeadIcon', left: 22, top: 22, width: 80, height: 80 },
    // <text name="文本_玩家等级" xy="121,93" pivot="0,0.5" size="50,29"/> → 顶 = 93 − 14.5
    { path: 'ResBarLayer/PlayerInfo/LevelLabel', left: 121, top: 78.5, width: 50, height: 29 },
    // <text name="文本_玩家名称" xy="122,63" pivot="0,0.5" size="165,32"/> → 顶 = 63 − 16
    { path: 'ResBarLayer/PlayerInfo/NameLabel', left: 122, top: 47, width: 165, height: 32 },
    // <text name="文本_uid" xy="310,63" pivot="0,0.5" size="75,29"/> → 顶 = 63 − 14.5
    { path: 'ResBarLayer/PlayerInfo/UidLabel', left: 310, top: 48.5, width: 75, height: 29 },
    // <component name="compExp" xy="177,82" size="374,19"/>
    { path: 'ResBarLayer/PlayerInfo/ExpFill', left: 177, top: 82, width: 374, height: 19 },
];

/** 货币条整条的期望框：路径以**实例根名** `ResBar` 起（实例世界锚点 = 容器中心 + 覆盖的 `_lpos`）。 */
const FGUI_SLOT_BOXES: ReadonlyArray<{ path: string; left: number; top: number; width: number; height: number }> = [
    // 组件_资源信息0|1|2 在资源栏里的 xy = 127,8 / 273,8 / 420,8
    { path: 'ResBar/Res0', left: 127, top: 8, width: 132, height: 40 },
    { path: 'ResBar/Res1', left: 273, top: 8, width: 132, height: 40 },
    { path: 'ResBar/Res2', left: 420, top: 8, width: 132, height: 40 },
];

/** `组件_资源信息.xml` 各元素在 132×40 组件内的局部框（三格共用）。 */
const FGUI_SLOT_LOCAL: ReadonlyArray<{ name: string; left: number; top: number; width: number; height: number }> = [
    { name: 'Bg', left: 0, top: 0, width: 132, height: 40 },      // <image xy="0,0"/>
    { name: 'Icon', left: 0, top: 0, width: 40, height: 40 },     // <loader icon xy="0,0" size="40,40"/>
    { name: 'Value', left: 54, top: 5, width: 75, height: 32 },   // <text 文本_数值 xy="129,21" pivot="1,0.5"/>
    { name: 'Plus', left: 23, top: 18, width: 24, height: 24 },   // <image 图片_增加 xy="23,18"/>
];

/**
 * `ResBarLayer` 下那个嵌套实例的**世界锚点**：容器中心 (360,640) + 实例覆盖的 `_lpos`（y 向上翻转）。
 * 有了它就能把公共件的子树按同一套换算摆到画布上 —— 实例位置错了会立刻显形。
 */
function resBarInstanceAnchor(prefab: PrefabObject[], layer: PrefabObject): { x: number; y: number } {
    const shellRef = childrenOf(layer).find((ref) => prefab[ref.__id__]._name === undefined);
    assert.ok(shellRef, 'ResBarLayer 下找不到嵌套实例壳');
    const info = prefab[(prefab[shellRef!.__id__]._prefab as ObjRef).__id__];
    const instance = prefab[(info.instance as ObjRef).__id__] as { propertyOverrides?: ObjRef[] };
    const lpos = (instance.propertyOverrides ?? [])
        .map((ref) => prefab[ref.__id__] as { propertyPath?: string[]; value?: { x: number; y: number } })
        .find((ov) => ov.propertyPath?.[0] === '_lpos');
    assert.ok(lpos?.value, '实例没有覆盖 _lpos —— 货币条会落回 (0,0)');
    return { x: 360 + lpos!.value!.x, y: 640 - lpos!.value!.y };
}

test('资源栏几何：整块反解回画布后，每个节点的框逐条等于 FGUI 原值', () => {
    const prefab = readPrefab(HUD_PREFAB);
    const layer = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'ResBarLayer');
    assert.ok(layer, 'ArenaRoot.prefab 里没有 ResBarLayer');
    const boxes = new Map(layoutBoxes(prefab, layer!).map((box) => [box.path, box]));

    // 货币条实例：把**公共件**的子树按实例世界锚点摆一遍（实例内部不落宿主文件，只能这样复原）
    const common = readPrefab(COMMON_RESBAR);
    const commonRoot = common.find((entry) => entry.__type__ === 'cc.Node' && entry._parent === null);
    assert.ok(commonRoot, 'common/ResBar.prefab 里没有根节点');
    for (const box of layoutBoxes(common, commonRoot!, resBarInstanceAnchor(prefab, layer!))) {
        boxes.set(box.path, box);
    }

    const expected = [...FGUI_HOST_BOXES, ...FGUI_SLOT_BOXES];
    for (const slot of FGUI_SLOT_BOXES) {
        for (const local of FGUI_SLOT_LOCAL) {
            expected.push({
                path: `${slot.path}/${local.name}`,
                left: slot.left + local.left,
                top: slot.top + local.top,
                width: local.width,
                height: local.height,
            });
        }
    }

    const drift: string[] = [];
    for (const want of expected) {
        const got = boxes.get(want.path);
        if (!got) { drift.push(`${want.path}：找不到`); continue; }
        const same = Math.abs(got.left - want.left) < 0.6 && Math.abs(got.top - want.top) < 0.6
            && Math.abs(got.width - want.width) < 0.01 && Math.abs(got.height - want.height) < 0.01;
        if (!same) {
            drift.push(`${want.path}：得到 ${got.left.toFixed(1)},${got.top.toFixed(1)} `
                + `${got.width}×${got.height}，期望 ${want.left},${want.top} ${want.width}×${want.height}`);
        }
    }
    assert.deepEqual(Array.from(drift), [], '资源栏几何与 FGUI 原值不符（多半是锚点/父参照系错了）');
    // 8 个宿主节点（根 + PlayerInfo + 6 个玩家信息子节点）+ 3 个资源格 + 3×4 格内元素
    assert.equal(expected.length, 23, '守卫覆盖的节点数变了，确认是有意为之');
});

test('资源栏几何：整块贴在画布左上角（不居中、不悬浮）', () => {
    const prefab = readPrefab(HUD_PREFAB);
    const layer = prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'ResBarLayer');
    const boxes = new Map(layoutBoxes(prefab, layer!).map((box) => [box.path, box]));

    const common = readPrefab(COMMON_RESBAR);
    const commonRoot = common.find((entry) => entry.__type__ === 'cc.Node' && entry._parent === null)!;
    for (const box of layoutBoxes(common, commonRoot, resBarInstanceAnchor(prefab, layer!))) {
        boxes.set(box.path, box);
    }

    // 货币条实例必须贴画布左缘/顶边（FGUI 里 `group mid` 是 xy="0,0"；实例位置错一点就露馅）
    const bar = boxes.get('ResBar')!;
    assert.equal(bar.left, 0, '货币条实例必须贴画布左缘');
    assert.equal(bar.top, 0, '货币条实例必须贴画布顶边');
    assert.equal(bar.width, 552);
    assert.equal(bar.height, 106);

    // 三个资源格整体落在货币条的框里、且不越过 106 高的条带
    for (const index of [0, 1, 2]) {
        const slot = boxes.get(`ResBar/Res${index}`)!;
        assert.ok(slot.left >= bar.left && slot.left + slot.width <= bar.left + bar.width,
            `Res${index} 横向越出货币条`);
        assert.ok(slot.top >= bar.top && slot.top + slot.height <= bar.top + bar.height,
            `Res${index} 纵向越出货币条`);
    }
    // 头像必须整块在画布内（之前偏 44.5px 时它会跑出屏幕）
    const head = boxes.get('ResBarLayer/PlayerInfo/HeadIcon')!;
    assert.ok(head.left >= 0 && head.left + head.width <= 720, `头像横向出屏：left=${head.left}`);
    assert.ok(head.top >= 0 && head.top + head.height <= 1280, `头像纵向出屏：top=${head.top}`);
});

test('点头像弹个人信息：prefab 的 AvatarHead 挂 cc.Button + 脚本监听节点 CLICK 打开 PlayerInfoPage', () => {
    // 老端：`LayerMainResources.InitClick()` 给「组件_玩家信息.icon」绑 CLICK →
    // `CtrlPlayer.LayerPlayerInfo.load()`。Demo3.8 的对位是 MainResBar.bindHeadClick →
    // PlayerInfoPage.open()。这条守护防「绑点被顺手删掉」——它是静默失效，
    // 删了不报任何错，只是点头像没反应。
    //
    // 2026-10-30：`AvatarHead` 在 `ArenaRoot.prefab` 上补了 `cc.Button`（transition=NONE），
    // 脚本统一监听节点 `CLICK`。旧形态「没有 Button 就退回 TOUCH_END」已删 ——
    // 那种分流会让「prefab 掉了组件」降级成静默无反应，且 TOUCH_END 还会绕过 interactable。
    const src = readFileSync('assets/script/app/main/MainResBar.ts', 'utf8');
    assert.match(src, /import \{ PlayerInfoPage \} from '\.\.\/playerinfo\/PlayerInfoPage';/);
    assert.match(src, /this\.bindHeadClick\(\)/, 'onLoad 里必须调 bindHeadClick —— 删了点头像就毫无反应且零报错');
    assert.match(src, /this\.avatarIcon\.node\.on\(Button\.EventType\.CLICK, this\.onClickHead, this\)/,
        '必须监听头像节点的 CLICK');
    // 反向断言前先剥注释（规则 104）：本文件的说明里就会写 `TOUCH_END`
    assert.doesNotMatch(stripSourceComments(src), /TOUCH_END/,
        '不许退回 TOUCH_END 兜底（绕过 interactable，且会掩盖「prefab 掉了组件」）');
    assert.match(src, /PlayerInfoPage\.open\(\)/, '点击回调必须打开 PlayerInfoPage');

    // prefab 侧：AvatarHead 必须挂 cc.Button —— 缺了这条，`Button.EventType.CLICK` 永远不派发（静默死按钮）
    const data = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8')) as any[];
    const head = data.find((o) => o?.__type__ === 'cc.Node' && o._name === 'AvatarHead');
    assert.ok(head, 'ArenaRoot.prefab 里必须有 AvatarHead 节点');
    const button = (head._components ?? [])
        .map((c: any) => data[c.__id__])
        .find((c: any) => c.__type__ === 'cc.Button');
    assert.ok(button, 'AvatarHead 必须挂 cc.Button（否则 CLICK 永远不派发）');
    assert.equal(button._transition, 0, '头像点击保持 transition = NONE，不加缩放/变色过渡');
    assert.equal(button._target?.__id__ ?? null, null, '不给 Button 指定 target（默认作用于自己那颗 Sprite）');
});

// ── 2026-10-26：两格图标 = 游戏内「银币 / 体力」图，且由 `resKeys` 驱动 ─────────
//
// 用户原话：「资源栏这两个图标保持大小不变，分别更换成 图标_银币和 图标_体力」。
//
// ## 为什么不是「把 prefab 上的图换一下」就完事
//
// 现场是：宿主给两格都覆盖了 `iconOverride = hud_coin_icon`（HUD 专用金色硬币），
// 于是**不管 `resKeys` 配成什么，两格都画同一枚金币** —— 上一轮把 `resKeys` 改成
// `gold,end` 后数值已经是体力口径（59/30），图标却纹丝不动，就是这个原因。
// 所以这里守两件事：
//   ① 宿主**不许**再覆盖 `iconOverride`（否则改表/改 keys 图标永远不跟随，静默）；
//   ② 预制体里当占位用的 `_spriteFrame` 必须就是表里那两张图（首帧加载前不会闪错图）。
//
// ## 「保持大小不变」怎么落成数字
//
// 旧图 `hud_coin_icon.png` 是 38×37 且四周无透明留白（可见区 = 画布 100%），节点 38×37
// ⇒ 可见硬币 ≈ 38px。游戏内图标是 100×100 且带留白（`图标_铜币` 可见 86%、
// `图标_体力` 可见 90%×81%），同样铺 38×38 会缩到 ≈33~34px（肉眼小一圈）。
// 所以节点放到 **44×44**：44×0.86 = 37.8 ≈ 38，可见大小与换图前一致。

/** `roleProperty.icon` + `resIconRoot` → 那张图在磁盘上的 spriteFrame uuid（`<uuid>@f9941`）。 */
function iconSpriteFrameUuid(iconName: string): string {
    const root = resIconRootForTest(iconName);
    const metaPath = `${RESOURCES}/${root}/${iconName}.png.meta`;
    assert.ok(existsSync(metaPath), `表里配的图标在盘上找不到：${metaPath}`);
    const uuid = (JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid: string }).uuid;
    return `${uuid}@f9941`;
}

/** 与 `ResTypes.resIconRoot` 同口径（只认那三条覆盖，其余落 `icons/resource`）。 */
function resIconRootForTest(iconName: string): string {
    if (iconName === '图标_联盟贡献' || iconName === '图标_补天神石') return 'icons/common';
    if (iconName === '图标_经验值') return 'image/main/resbar';
    return RESOURCE_ICON_ART_ROOT;
}

test('ArenaRoot 的货币条：两格图标跟 resKeys 走（不覆盖 iconOverride），占位图 = 表里的 银币/体力', () => {
    const prefab = readPrefab(HUD_PREFAB);
    const common = readPrefab(COMMON_RESBAR);

    // ── 源 prefab 的 fileId → 节点名（覆盖项的 TargetInfo.localID 落在这一套上）──
    const prefabInfoOwner = new Map<number, number>();
    for (let i = 0; i < common.length; i += 1) {
        const entry = common[i];
        for (const key of ['_prefab', '__prefab'] as const) {
            const ref = entry?.[key] as ObjRef | undefined;
            if (ref && typeof ref.__id__ === 'number') prefabInfoOwner.set(ref.__id__, i);
        }
    }
    const fileIdIndex = new Map<string, number>();
    for (let i = 0; i < common.length; i += 1) {
        const fileId = common[i]?.fileId as string | undefined;
        if (fileId) fileIdIndex.set(fileId, i);
    }
    /** localID → 「节点名 · 组件类型」（解析不出返回空串）。 */
    const ownerOf = (localID: string): string => {
        const infoIndex = fileIdIndex.get(localID);
        if (infoIndex === undefined) return '';
        const ownerIndex = prefabInfoOwner.get(infoIndex);
        if (ownerIndex === undefined) return '';
        const owner = common[ownerIndex];
        if (owner.__type__ === 'cc.Node') return String(owner._name ?? '');
        const node = owner.node ? common[(owner.node as ObjRef).__id__] : null;
        return `${String(node?._name ?? '?')} · ${String(owner.__type__)}`;
    };

    // ── ResBar 实例：覆盖项 = (属性路径, 归属节点名, 值) ──
    const shell = childrenOf(
        prefab.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'ResBarLayer')!,
    ).map((ref) => prefab[ref.__id__]).find((node) => node._name === undefined)!;
    const info = prefab[(shell._prefab as ObjRef).__id__];
    const instance = prefab[(info.instance as ObjRef).__id__];
    const overrides = ((instance.propertyOverrides ?? []) as ObjRef[]).map((ref) => {
        const ov = prefab[ref.__id__] as { propertyPath?: string[]; value?: unknown; targetInfo?: ObjRef };
        const target = prefab[(ov.targetInfo as ObjRef).__id__] as { localID?: string[] };
        return {
            path: (ov.propertyPath ?? []).join('.'),
            owner: ownerOf((target.localID ?? [])[0] ?? ''),
            value: ov.value,
        };
    });

    // ① 不许再覆盖 iconOverride —— 否则「改 resKeys 图标不跟随」会静默复发
    assert.deepEqual(
        overrides.filter((one) => one.path === 'iconOverride').map((one) => one.owner),
        [],
        '宿主不许覆盖 iconOverride：两格图标必须由 resKeys → roleProperty.icon 决定',
    );

    // ② 占位图 = 表里那两张（首帧异步加载完成前不会闪成别的资源）
    const rows = JSON.parse(readFileSync('assets/remoteRef/roleProperty.json', 'utf8')) as {
        resId?: number;
        key?: string;
        icon?: string;
    }[];
    const iconOfKey = (key: string): string => {
        const row = rows.find((one) => one.key === key);
        assert.ok(row?.icon, `roleProperty 表里 key=${key} 没配 icon`);
        return row!.icon!;
    };
    // `resKeys` 的两格顺序 = Res0 / Res1 的覆盖项顺序（_spriteFrame 按 slot 依次出现）
    const keys = String(overrides.find((one) => one.path === 'resKeys')!.value).split(',');
    assert.deepEqual(keys, ['gold', 'end'], 'HUD 两格 = 银币 + 体力');
    const iconFrames = overrides
        .filter((one) => one.path === '_spriteFrame' && one.owner.startsWith('Icon · '))
        .map((one) => (one.value as { __uuid__?: string })?.__uuid__ ?? '');
    assert.equal(iconFrames.length, 2, `两格各有一张占位图，实际 ${iconFrames.length} 张`);
    assert.deepEqual(
        iconFrames,
        keys.map((key) => iconSpriteFrameUuid(iconOfKey(key))),
        '占位图必须与 roleProperty 里 gold/end 配的图标是同一张（否则加载完成前会闪错图）',
    );

    // ③ 44×44：补偿游戏内图标的透明留白，让「可见」大小与换图前的 38px 金币一致
    const iconSizes = overrides
        .filter((one) => one.path === '_contentSize' && one.owner.startsWith('Icon · '))
        .map((one) => one.value as { width?: number; height?: number });
    assert.equal(iconSizes.length, 2);
    for (const size of iconSizes) {
        assert.deepEqual({ width: size.width, height: size.height }, { width: 44, height: 44 },
            'Icon 尺寸必须是 44×44（可见区 86%/90% × 44 ≈ 换图前的 38px）');
    }
});

// ============================================================
// 闪光的作用域：只有命中的那一格闪
// ============================================================
//
// 用户 2026-10-26 原话：
// > 「宝箱打开获取体力资源，只有对应的资源条闪烁，银币资源栏不闪烁」
//
// 上一轮的实现是**整条闪**（`flash()` 无参、`computeGlowRect()` 取全部格子的包围盒），
// 于是体力涨的时候银币格跟着一起亮 —— 玩家反而看不出到底涨的是哪个资源。
//
// `ResBar` 是 `cc.Component`，node 测试沙箱里跑不起来 ⇒ 这里退一步守**源码契约**
// （与本文件另外几条 `readFileSync(...MainResBar.ts)` 同一种守法的先例）：
//  ① `playGainFeedback` 必须把命中的槽位传下去（`this.flash(slot)`）；
//  ② 全文件**不许**再出现无参 `this.flash()`（那就是整条闪）；
//  ③ `computeGlowRect` 必须接一个槽位参数，且目标不可见时返回 `null` 而不是回退整条包围盒。
test('ResBar 闪光只落在命中的那一格（不许整条一起亮）', () => {
    const src = readFileSync('assets/script/app/common/ResBar.ts', 'utf8');

    const body = /playGainFeedback\(key: string, amount: number\): void \{([\s\S]*?)\n {4}\}/.exec(src);
    assert.ok(body, '找不到 playGainFeedback 的实现体（方法签名变了就同步改这条用例）');
    assert.match(body![1], /this\.flash\(slot\)\s*;/,
        'playGainFeedback 必须 this.flash(slot)：不传槽位就是整条闪，银币格会跟着体力格一起亮');

    assert.doesNotMatch(src, /this\.flash\(\s*\)/,
        '不许出现无参 this.flash()：那会回退成「所有显示中格子的包围盒」= 整条闪');

    // 闪光框必须能收槽位；`target` 缺席的那条分支只留作兼容，不该被本工程调用。
    assert.match(src, /flash\(target\?: MainResBarSlot \| null\): void \{/,
        'flash 必须接受可选的目标槽位');
    assert.match(src, /private computeGlowRect\(\s*target: MainResBarSlot \| null,?\s*\)/,
        'computeGlowRect 必须按槽位算框（传 null 才回退整条）');

    // 目标格不可见 / 没变换 ⇒ 不闪（`null`），绝不回退成整条 —— 那正是本轮要修的病。
    const rectBody = /private computeGlowRect\([\s\S]*?\n {4}\}/.exec(src);
    assert.ok(rectBody, '找不到 computeGlowRect 的实现体');
    assert.match(rectBody![0], /if \(!Number\.isFinite\(minX\) \|\| !Number\.isFinite\(maxX\)\) return null;/,
        '算不出框时必须返回 null（不闪），而不是拿本节点的三格容器去画一大片亮块');
});

/** 反向断言前先剥注释（规则 104：注释里会写反例，不剥会被自己的文档绊倒）。 */
function stripSourceComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
