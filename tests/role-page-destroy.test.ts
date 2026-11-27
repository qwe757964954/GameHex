/**
 * 角色页销毁期的存活守卫（`RolePage.onDestroy` / `stopQipao` / `alive`）。
 *
 * ## 为什么要有这条
 *
 * 2026-11-17 实机：点开「角色」再切「领地」崩溃，报
 * `RolePage.ts:308 Uncaught TypeError: Cannot set properties of null (setting 'active')`，
 * 调用链 `stopQipao → onDestroy → NodeActivator.destroyComp → _onPreDestroy/_destroyImmediate`。
 *
 * 引擎事实（`cocos/scene-graph/node.ts` / `core/data/object.ts`，3.8.8 逐行核过）：
 *
 *  - `_onPreDestroyBase()` **先销毁子节点**（L1532-1537），**再销毁自身组件**（L1540-1545）
 *    ⇒ `onDestroy` 跑的时候子节点 `Qipao` 已经走完自己的销毁；
 *  - 销毁会调 `CCObject._destruct()`（`compileDestruct`），把字符串型自有属性清成 `''`
 *    ⇒ `getChildByName('Qipao')` 返回的是 **`null`**（不是抛错，是"名字被清了、找不到"）；
 *  - 组件销毁后 `_node` 也被清成 `null` ⇒ `this.node.isValid` 会抛
 *    `Cannot read properties of null (reading 'isValid')`。
 *
 * 🔴 后果不是"报一行"：异常从 `onDestroy` 抛回 `CCObject._deferredDestroy()`
 *    （`object.ts` L173，**没有 try/catch**）⇒ 整批延迟销毁中断，本对象拿不到 `Destroyed`
 *    标记（永远 `isValid === true`）且留在 `objectsToDestroy` 里每帧重炸。
 *
 * ## 本文件钉什么
 *
 * 1. `onDestroy` 在「子节点已被先销毁」的状态下**不抛**，且定时器照清、`destroyed` 照发；
 * 2. `onDisable` 同样不因 `Qipao` 缺失而抛（宿主被父节点连带销毁走的是这条路）；
 * 3. `alive` 在组件已销毁（`_node === null`）时返回 `false` 而不是抛；
 * 4. 反向确认判空**没有扩散**到 `showQipao` —— 运行时 `Qipao` 真缺失仍要当场抛，
 *    别把 prefab 绑定错误吞成静默不显示。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import * as RoleTypes from '../assets/script/app/role/RoleTypes';

/** 模拟「子节点已先被销毁」的宿主：`getChildByName` 一律返回 `null`（`_name` 被 `_destruct` 清空）。 */
interface IFakeNode {
    isValid: boolean;
    activeInHierarchy: boolean;
    getChildByName(name: string): { active: boolean } | null;
}

interface IPageLike {
    node: IFakeNode | null;
    qipaoTimer: unknown;
    qipao: { active: boolean; isValid: boolean } | null;
    bagPanelComp: unknown;
    composeBtnRedDot: unknown;
    forgeBtnRedDot: unknown;
    tabGroup: unknown;
    equipSlots: unknown[];
    readonly alive: boolean;
    onDestroy(): void;
    onDisable(): void;
    showQipao(): void;
}

type PageCtor = new () => IPageLike;

/** 被销毁的组件：`_objFlags` 末位 = `Destroyed`（引擎 `isValid` 读的就是它，数字不会被 `_destruct` 清）。 */
class FakeComponent {
    node: IFakeNode | null = null;
    _objFlags = 0;
    get isValid(): boolean { return (this._objFlags & 1) === 0; }
}

interface IHarness {
    page: IPageLike;
    events: Array<{ name: string; payload: { phase?: string } }>;
    cleared: unknown[];
}

function harness(getChildByName: (name: string) => { active: boolean } | null): IHarness {
    const events: Array<{ name: string; payload: { phase?: string } }> = [];
    const cleared: unknown[] = [];

    const { exports, unresolved } = loadTsModule<{ RolePage: PageCtor }>('assets/script/app/role/RolePage.ts', {
        modules: {
            cc: ccStub({ Component: FakeComponent, sp: { Skeleton: class {} } }),
            '/RoleRepository': { roleRepository: { roleLevel: () => 1, equipParts: () => [] } },
            '/ViewLifecycle': { VIEW_LIFECYCLE },
            '/RoleEvents': { RoleEvent },
            '/RoleTypes': RoleTypes,
            '/EventMgr': { EventMgr: { instance: {
                emit: (name: string, payload: { phase?: string }) => events.push({ name, payload }),
                off: () => undefined,
            } } },
            '/RedDot': { RedDot: class {} },
            '/CmdInterface': { CmdRedDotType: { GEM_COMPOSE: 1 } },
            '/RdServerVar': { readServerRedDot: () => 0 },
            '/RoleBagPanel': { RoleBagPanel: class {} },
            '/RoleBagTabGroup': { RoleBagTabGroup: class {} },
            '/RoleNavItem': { RoleNavItem: class {} },
            '/EquipDecomposePopup': { EquipDecomposePopup: { open: async () => null } },
            '/RoleEquipSlot': { RoleEquipSlot: class {} },
            '/RoleTexts': { ROLE_TEXTS: {} },
            '/RoleArtLoader': { loadRoleBagIcon: async () => null, loadRoleQualityFrame: async () => null },
            '/CardLineupPower': { formatPowerText: (value: number) => String(value) },
        },
        globals: {
            setTimeout: () => 1,
            clearTimeout: (handle: unknown) => { cleared.push(handle); },
            console,
        },
    });
    assert.deepEqual(unresolved, [], '桩表必须覆盖 RolePage 的全部依赖（漏桩会静默回空对象）');

    const page = new exports.RolePage();
    page.node = { isValid: true, activeInHierarchy: true, getChildByName };
    // prefab 绑定的引用按真实形态补桩：`onDisable` 不再对这些引用判空（绑错该当场抛），
    // 所以「不抛」这条用例守的是 Qipao 缺失，不是「引用为 null 也能跑」。
    page.bagPanelComp = { isDecomposing: false, hide: () => undefined };
    page.composeBtnRedDot = { setRedDot: () => undefined };
    page.forgeBtnRedDot = { setRedDot: () => undefined };
    page.tabGroup = { clearRedDots: () => undefined, item: () => ({ setRedDot: () => undefined }) };
    page.equipSlots = [];
    return { page, events, cleared };
}

test('onDestroy ⚠️ 子节点已先被引擎销毁时不许抛：定时器照清、destroyed 照发', () => {
    const { page, events, cleared } = harness(() => null);
    const handle = { id: 'qipao-timer' };
    page.qipaoTimer = handle;

    // 修前这里必抛 `Cannot set properties of null (setting 'active')` —— 原报错现场
    assert.doesNotThrow(() => page.onDestroy(), '销毁期碰子节点会打断 _deferredDestroy 整批销毁');

    assert.deepEqual(cleared, [handle], '销毁时必须把在闪的定时器清掉，否则回调打在死组件上');
    assert.equal(page.qipaoTimer, null, '定时器句柄要归零，防重复 clear');
    const destroyed = events.filter((event) => event.payload.phase === 'destroyed');
    assert.equal(destroyed.length, 1, '`destroyed` 必须发出去（组合层靠它 dispose 控制器）');
    assert.equal(destroyed[0].name, VIEW_LIFECYCLE);
});

test('onDisable ⚠️ 宿主被父节点连带销毁时（子节点已先拆）也不许抛', () => {
    const { page, events, cleared } = harness(() => null);
    const handle = { id: 'qipao-timer' };
    page.qipaoTimer = handle;

    assert.doesNotThrow(() => page.onDisable(), '父节点连带销毁时 onDisable 在 destroyComp 里跑，子节点已经没了');

    assert.deepEqual(cleared, [handle]);
    assert.equal(events.filter((event) => event.payload.phase === 'disabled').length, 1);
});

test('alive ⚠️ 组件已销毁（_node 被 _destruct 清成 null）时返回 false 而不是抛', () => {
    const { page } = harness(() => null);
    // 模拟 `_destruct()` 之后的真实状态：`_node === null`、`Destroyed` 位已置
    (page as unknown as FakeComponent).node = null;
    (page as unknown as FakeComponent)._objFlags = 1;

    assert.doesNotThrow(() => { void page.alive; }, '`this.node.isValid` 在销毁后必抛 Cannot read properties of null');
    assert.equal(page.alive, false, '销毁后必须判死，`await` 之后的续跑要靠它早退');
});

test('alive 在页面只是被反激活（组件仍有效）时也判死 —— 语义没被削弱', () => {
    const { page } = harness(() => null);
    page.node!.activeInHierarchy = false;
    assert.equal(page.alive, false);
    page.node!.activeInHierarchy = true;
    assert.equal(page.alive, true);
});

test('showQipao 不做判空：运行时 Qipao 真缺失必须当场抛（别把 prefab 绑定错误吞掉）', () => {
    const { page } = harness(() => null);
    assert.throws(() => page.showQipao(), /Cannot set properties of null/,
        '判空只该留在销毁期的 stopQipao，不能扩散到正常渲染路径');
});
