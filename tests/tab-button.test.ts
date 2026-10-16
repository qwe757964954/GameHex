/**
 * 共用页签组件 `ui/common/TabButton.prefab`（+ `app/common/TabButton.ts`）的回归网。
 *
 * 2026-09-28 把这**两处**原本各写一套的底栏页签合并成一个共用件：
 *   - 主界面底栏六格（`ui/main/MainRoot.prefab` 的 `BottomNav`）—— 原 `CardLineupNav`
 *   - 战令页底栏四格（`ui/BattleToken/BattleToken.prefab` 的 `TabBar`）—— 原 `BattleTokenTabButton`
 * 依据：老端 `zarts/.../共用组件/组件/底菜单/按钮_首页_菜单.xml` 本来就同时被这两处引用
 * （`组件_首页_底菜单.xml` 六格 + `组件_超值战令.xml` 四个标签），合并是**还原原稿**。
 *
 * 分段：
 *   A. 主界面六格真的换成了共用实例（槽位 / 坐标 / 红点绑定 / 嵌套实例注册）
 *   B. 两处消费者指向**同一个** prefab，且两个旧的私有页签组件已从 prefab 里归零
 *   C. 宿主源码形状 —— 点击 / 选中 / 红点三条通路都走 `TabButton`，不再各写一套
 *
 * ⚠️ 为什么不写「点一下真的换了页」这类行为断言：`TabButton` / `MainTabHost` 都直接
 *    依赖 `cc`（`Component` / `Sprite` / `Node`），Node 里 import 不了（规则 78 的反面）。
 *    组件几何的数值断言在 `tests/battletoken.test.ts`（战令四格那侧，含 −42.5 / 26 的推导），
 *    这里只补主界面那侧 + 两处交叉 + 源码形状。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type Entry = Record<string, unknown>;

const MAINROOT_PATH = 'assets/resources/ui/main/MainRoot.prefab';
const BATTLETOKEN_PATH = 'assets/resources/ui/BattleToken/BattleToken.prefab';
const TABBUTTON_PATH = 'assets/resources/ui/common/TabButton.prefab';
const REDDOT_PATH = 'assets/resources/ui/common/RedDot.prefab';

const MAINROOT = JSON.parse(readFileSync(MAINROOT_PATH, 'utf8')) as Entry[];
const BATTLETOKEN = JSON.parse(readFileSync(BATTLETOKEN_PATH, 'utf8')) as Entry[];
const TABBUTTON = JSON.parse(readFileSync(TABBUTTON_PATH, 'utf8')) as Entry[];
const REDDOT = JSON.parse(readFileSync(REDDOT_PATH, 'utf8')) as Entry[];

const assetUuid = (path: string): string =>
    (JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { uuid: string }).uuid;

const TABBUTTON_UUID = assetUuid(TABBUTTON_PATH);
const REDDOT_UUID = assetUuid(REDDOT_PATH);

/** `__id__` 解引用；内联对象（如 `asset` / `_spriteFrame`）原样返回。 */
function resolve(prefab: Entry[], ref: unknown): Entry | undefined {
    if (!ref || typeof ref !== 'object') return undefined;
    const id = (ref as { __id__?: number }).__id__;
    return typeof id === 'number' ? prefab[id] : (ref as Entry);
}

/** 脚本类名 → cid（= 编译器 `_RF.push` 用的那个）。 */
function scriptCid(tsPath: string): string {
    const uuid = (JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string }).uuid;
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[value >> 6] + KEYS[value & 63];
    }
    return out;
}

const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

interface Slot {
    name: string;
    index: number;
    instance: Entry;
    info: Entry;
}

/** 一个 prefab 里所有嵌套实例（按根节点的 `_name` 覆盖取名）。 */
function instancesOf(prefab: Entry[]): Slot[] {
    const out: Slot[] = [];
    prefab.forEach((entry, index) => {
        if (entry?.__type__ !== 'cc.PrefabInstance') return;
        const info = prefab.find((e) => e?.__type__ === 'cc.PrefabInfo' && (e.instance as { __id__?: number })?.__id__ === index);
        assert.ok(info, `#${index} 的 cc.PrefabInstance 没有对应 PrefabInfo`);
        const overrides = ((entry.propertyOverrides ?? []) as unknown[]).map((r) => resolve(prefab, r));
        const name = overrides.find((ov) => (ov?.propertyPath as unknown[])?.[0] === '_name')?.value;
        out.push({ name: typeof name === 'string' ? name : '', index, instance: entry, info: info! });
    });
    return out;
}

/** 取实例上的覆盖值（同名的取后写的那条）。 */
function overrideValue(slot: Slot, key: string, prefab: Entry[]): unknown {
    const hits = ((slot.instance.propertyOverrides ?? []) as unknown[])
        .map((r) => resolve(prefab, r))
        .filter((ov) => (ov?.propertyPath as unknown[])?.[0] === key);
    return hits.length ? hits.at(-1)!.value : undefined;
}

/** 某组件在 `RedDot.prefab` 里的 `CompPrefabInfo.fileId`（`targetOverrides.localID` 用它）。 */
function componentFileId(prefab: Entry[], cid: string): string {
    const index = prefab.findIndex((e) => e?.__type__ === cid);
    assert.ok(index >= 0, `prefab 里没有 ${cid}`);
    const info = resolve(prefab, prefab[index]!.__prefab);
    assert.equal(typeof info?.fileId, 'string', `${cid} 的组件没有 __prefab.fileId`);
    return info!.fileId as string;
}

const MAIN_NAV: ReadonlyArray<readonly [string, number, number]> = [
    // [实例名, 相对 BottomNav 的 x, 画布中心 x]  —— 画布 720 宽，BottomNav 中心在 360
    ['Shop', -300, 60],
    ['Role', -180, 180],
    ['Arena', -60, 300],
    ['Territory', 60, 420],
    ['Adventure', 180, 540],
    ['Alliance', 300, 660],
];

// ============================================================
// A. 主界面六格 = 共用实例
// ============================================================

test('A1 主界面 `BottomNav` 六格全部换成 `ui/common/TabButton` 实例', () => {
    const bottomNav = MAINROOT.find((e) => e?.__type__ === 'cc.Node' && e._name === 'BottomNav');
    assert.ok(bottomNav, 'MainRoot.prefab 里没有 BottomNav');
    const kids = ((bottomNav!._children ?? []) as unknown[]).map((r) => resolve(MAINROOT, r));
    // 只该有「底图条 + 六格」（历史上这里挂 6 个 CardLineupNav，另有一个 Bg03 底图）
    assert.equal(kids.length, 7, 'BottomNav 子节点数变了 —— 先确认是不是又多挂了一格');
    assert.deepEqual(kids.map((k) => k?._name).filter(Boolean), ['Bg03']);

    const slots = instancesOf(MAINROOT);
    assert.equal(slots.length, 6, '六格应当是 6 个嵌套实例');
    for (const slot of slots) {
        assert.equal((slot.info.asset as { __uuid__?: string })?.__uuid__, TABBUTTON_UUID,
            `${slot.name} 没指向共用 TabButton.prefab`);
        // 六格用的是运行时 `loadNavArt` 喂图 ⇒ 实例上不写两态帧（写了会覆盖掉异步加载）
        assert.equal(overrideValue(slot, 'offIcon', MAINROOT), undefined, `${slot.name} 不该写 offIcon`);
        assert.equal(overrideValue(slot, 'onIcon', MAINROOT), undefined, `${slot.name} 不该写 onIcon`);
        assert.equal(overrideValue(slot, 'tabType', MAINROOT), undefined, `${slot.name} 不按业务类型号切页`);
    }
});

test('A2 六格坐标：x = −300..300 间距 120，画布中心 60 / 180 / … / 660（与 FGUI 六格对齐）', () => {
    const slots = instancesOf(MAINROOT);
    const byName = new Map(slots.map((s) => [s.name, s]));
    for (const [name, x, canvasX] of MAIN_NAV) {
        const slot = byName.get(name);
        assert.ok(slot, `六格里没有 ${name}`);
        assert.deepEqual(overrideValue(slot!, '_lpos', MAINROOT),
            { __type__: 'cc.Vec3', x, y: 0, z: 0 }, `${name} 的 _lpos`);
        // 画布中心 = 360（画布半宽）+ BottomNav 自身的 0 + x
        assert.equal(360 + x, canvasX, `${name} 的画布中心 x`);
    }
    // 相邻间距恒 = 120
    for (let i = 1; i < MAIN_NAV.length; i++) {
        assert.equal(MAIN_NAV[i]![1] - MAIN_NAV[i - 1]![1], 120);
    }
});

test('A3 六格各自带红点：实例的 `targetOverrides` 指向共用 `RedDot.prefab` 的组件', () => {
    const redDotFileId = componentFileId(REDDOT, scriptCid('assets/script/app/common/RedDot.ts'));
    for (const slot of instancesOf(MAINROOT)) {
        const targets = ((slot.info.targetOverrides ?? []) as unknown[]).map((r) => resolve(MAINROOT, r));
        const bound = targets.find((to) => (to?.propertyPath as unknown[])?.[0] === 'redDot');
        assert.ok(bound, `${slot.name} 没绑 redDot`);
        assert.deepEqual(resolve(MAINROOT, bound!.targetInfo)?.localID, [redDotFileId],
            `${slot.name} 的 redDot 没指到 RedDot.prefab 里的组件`);
        // 6 格必须**各带一颗**，不能 6 个引用指同一个节点（那样只会亮一个）
        assert.equal((slot.info.targetOverrides as unknown[]).length, 1, `${slot.name} 的 targetOverrides 条数异常`);
    }
    // 根 PrefabInfo 要把 6 个实例登记成「嵌套实例根」，否则覆盖解析不生效（本项目踩过）
    // ⚠️ `cc.PrefabInfo.root` 在每一份 PrefabInfo 上都写的是**同一个**根节点
    //    ⇒ 不能用它来找「根节点自己的 PrefabInfo」，得从根节点的 `_prefab` 反查。
    const rootNode = MAINROOT.find((e) => e?.__type__ === 'cc.Node' && e._name === 'MainRoot');
    const rootInfo = resolve(MAINROOT, rootNode!._prefab);
    const registered = ((rootInfo?.nestedPrefabInstanceRoots ?? []) as Array<{ __id__: number }>)
        .map((r) => r.__id__).sort((a, b) => a - b);
    // 六格的节点在父 prefab 里是空壳（没有 `_name`），`Bg03` 是有名字的真节点
    const bottomNav = MAINROOT.find((e) => e?.__type__ === 'cc.Node' && e._name === 'BottomNav')!;
    const stubs = ((bottomNav._children ?? []) as Array<{ __id__: number }>)
        .map((r) => r.__id__).filter((i) => !MAINROOT[i]?._name).sort((a, b) => a - b);
    assert.equal(stubs.length, 6, 'BottomNav 下的空壳实例根应当正好 6 个');
    assert.deepEqual(registered, stubs, '注册的嵌套实例根必须正好是 BottomNav 下那 6 个实例');
});

// ============================================================
// B. 两处消费者 + 旧件归零
// ============================================================

test('B1 主界面六格与战令四格用的是**同一个** `TabButton.prefab`', () => {
    const main = new Set(instancesOf(MAINROOT).map((s) => (s.info.asset as { __uuid__?: string }).__uuid__));
    const battle = new Set(instancesOf(BATTLETOKEN)
        .filter((s) => (s.info.asset as { __uuid__?: string }).__uuid__ === TABBUTTON_UUID)
        .map((s) => s.name));
    assert.deepEqual([...main], [TABBUTTON_UUID], '主界面六格指到了别的 prefab');
    assert.deepEqual([...battle].sort(), ['Tab1', 'Tab2', 'Tab3', 'Tab4'], '战令四格没指向共用件');
});

test('B2 两个旧的私有页签组件已从 prefab 里彻底退场（防 cid 抄错成 MissingScript）', () => {
    const oldCids = [
        scriptCid('assets/script/app/card/CardLineupNav.ts'),          // 主界面旧件
        scriptCid('assets/script/app/battletoken/BattleTokenTabButton.ts'), // 战令旧件
    ];
    for (const [path, prefab] of [[MAINROOT_PATH, MAINROOT], [BATTLETOKEN_PATH, BATTLETOKEN]] as const) {
        const raw = JSON.stringify(prefab);
        for (const cid of oldCids) {
            assert.ok(!raw.includes(cid), `${path} 里还挂着旧页签组件 ${cid}`);
        }
    }
    // 反向：共用件的组件 cid 只住在子 prefab 里 ⇒ 两个宿主的 prefab 里**不该**出现它，
    // 但都必须出现共用 prefab 自身的 uuid（否则就是又抄了一份内联节点）
    const tabButtonCid = scriptCid('assets/script/app/common/TabButton.ts');
    for (const [path, prefab] of [[MAINROOT_PATH, MAINROOT], [BATTLETOKEN_PATH, BATTLETOKEN]] as const) {
        const raw = JSON.stringify(prefab);
        assert.ok(!raw.includes(tabButtonCid), `${path} 把 TabButton 的节点内联进来了（应当只挂实例）`);
        assert.ok(raw.includes(TABBUTTON_UUID), `${path} 没有引用共用 TabButton.prefab`);
    }
    assert.ok(JSON.stringify(TABBUTTON).includes(tabButtonCid), 'TabButton.prefab 里没有挂 TabButton 组件');
});

// ============================================================
// C. 宿主源码形状
// ============================================================

test('C1 `MainTabHost`：按 x 排序收集 `TabButton`，点击走 `bindSelect`，红点走 `bindRedDotExpr`', () => {
    const code = stripComments(readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8'));
    assert.match(code, /getComponentsInChildren\(TabButton\)/, '宿主要收集 TabButton');
    assert.match(code, /\.sort\(\(a, b\) => a\.node\.position\.x - b\.node\.position\.x\)/, '必须按 x 排序');
    assert.match(code, /bindSelect\(/, '点击要交给 TabButton');
    assert.match(code, /bindRedDotExpr\(/, '红点要接表达式通路');
    // 旧写法（宿主自己挂 CLICK / 实例化旧视图类）不许回来
    assert.ok(!/getComponentsInChildren\(CardLineupNav\)/.test(code), '还在收集旧的 CardLineupNav');
    assert.ok(!/new CardLineupNav\b/.test(code), '还在 new 旧的 CardLineupNav');
    assert.ok(!/Button\.EventType\.CLICK/.test(code), '宿主不该自己挂 CLICK —— TabButton 内部已挂（幂等）');
    // 名称仍由槽位表驱动（唯一真源在 `card/CardLineupNav.ts`），不写死在宿主
    assert.match(code, /cardLineupNavItem\(index\)/, '名称/两态图必须查槽位表');
});

test('C2 `BattleTokenPage`：运行时从 `tabBar` 收集共用页签，不再吃 Inspector 数组', () => {
    const code = stripComments(readFileSync('assets/script/app/battletoken/BattleTokenPage.ts', 'utf8'));
    assert.ok(!code.includes('BattleTokenTabButton'), '页面还在引用旧的私有页签组件');
    assert.match(code, /collectTabButtons\(this\.tabBar\)/, '页面应当运行时收集页签');
    assert.match(code, /btn\.bindSelect\(/, '点击要交给 TabButton');
    assert.match(code, /btn\.bindRedDotExpr\(battleTokenTabRdExpr\(type\)\)/, '每格红点按自己的 tabType 取表达式');
    assert.ok(!/@property\([^)]*\[TabButton\]/.test(code), '别再把页签数组做成 Inspector 属性');
});

test('C3 红点回路：`TabButton` 持 `RdExprBinding`，销毁时**必须**解绑', () => {
    const code = stripComments(readFileSync('assets/script/app/common/TabButton.ts', 'utf8'));
    assert.match(code, /new RdExprBinding\(this\.redDot\)/, '红点要经 RdExprBinding（对齐老端 AddRdExpr）');
    assert.match(code, /this\.rdBinding\.unbind\(\)/,
        'onDestroy 必须 unbind —— 不然表达式引擎里留着指向死 RedDot 的回调');
    // 只暴露 setRedDot / bindRedDotExpr 两个入口，不许绕过 RedDot.setRedDot 直接写节点
    assert.ok(!/this\.redDot\.node\.(active|setActive)/.test(code),
        '别直接改 redDot 节点显隐 —— `count <= 0` 的收起由 RedDot.setRedDot 统一处理');
    assert.match(code, /setSelected\(selected: boolean\)/, '选中态要绝对赋值（两态都写）');
    assert.match(code, /ensureInit\(\): void/, '初始化要幂等（宿主 active=false ⇒ onLoad 会晚跑）');
});
