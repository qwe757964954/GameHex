/**
 * 「一键合成」红点的显隐口径（`RolePage.updateComposeRedDot`）。
 *
 * 背景：装备页签的「装备分解」会把同一个 `BagBtnCompose` 节点复用成「品质筛选」。
 * 如果只按 `GEM_COMPOSE` 写值、不按当前模式收口，宝石合成的红点会被带到装备分解里。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import * as RoleTypes from '../assets/script/app/role/RoleTypes';

class FakeComponent {
    node: unknown = null;
    _objFlags = 0;
}

/** 服务端红点值由用例控制（默认 0）。 */
let serverRedDot = 0;
const events: string[] = [];

const { exports, unresolved } = loadTsModule<{ RolePage: new () => any }>('assets/script/app/role/RolePage.ts', {
    modules: {
        cc: ccStub({ Component: FakeComponent, sp: { Skeleton: class {} } }),
        '/RoleRepository': { roleRepository: { roleLevel: () => 1, equipParts: () => [] } },
        '/ViewLifecycle': { VIEW_LIFECYCLE },
        '/RoleEvents': { RoleEvent },
        '/RoleTypes': RoleTypes,
        '/EventMgr': { EventMgr: { instance: { emit: (name: string) => events.push(name) } } },
        '/RedDot': { RedDot: class {} },
        '/CmdInterface': { CmdRedDotType: { GEM_COMPOSE: 1 } },
        '/RdServerVar': { readServerRedDot: () => serverRedDot },
        '/RoleBagPanel': { RoleBagPanel: class {} },
        '/RoleBagTabGroup': { RoleBagTabGroup: class {} },
        '/RoleNavItem': { RoleNavItem: class {} },
        '/EquipDecomposePopup': { EquipDecomposePopup: { open: async () => null } },
        '/RoleEquipSlot': { RoleEquipSlot: class {} },
        '/RoleTexts': { ROLE_TEXTS: {} },
        '/RoleArtLoader': { loadRoleBagIcon: async () => null, loadRoleQualityFrame: async () => null },
        '/CardLineupPower': { formatPowerText: (value: number) => String(value) },
    },
    globals: { setTimeout: () => 1, clearTimeout: () => undefined, console },
});
assert.deepEqual(unresolved, [], '桩表必须覆盖 RolePage 的全部依赖（漏桩会静默回空对象）');

interface IDot {
    calls: number[];
    setRedDot(value: number): void;
}

function makePage(): { page: any; dot: IDot } {
    const page = new exports.RolePage();
    page.node = { isValid: true, activeInHierarchy: true, getChildByName: () => null };
    page.bagPanelComp = { isDecomposing: false, hide: () => undefined };
    page.composeBtnRedDot = { calls: [], setRedDot(this: IDot, value: number) { this.calls.push(value); } };
    page.forgeBtnRedDot = { setRedDot: () => undefined };
    page.tabGroup = { clearRedDots: () => undefined, item: () => ({ setRedDot: () => undefined }) };
    page.equipSlots = [];
    return { page, dot: page.composeBtnRedDot };
}

test('宝石页签且非分解模式：按钮红点跟随服务端 GEM_COMPOSE', () => {
    const { page, dot } = makePage();
    page.activeTab = 1;
    page.bagPanelComp.isDecomposing = false;
    page.updateComposeRedDot(3);
    assert.deepEqual(dot.calls, [3]);
});

test('装备分解模式（同一节点复用成品质筛选）：必须归零', () => {
    const { page, dot } = makePage();
    page.activeTab = 2;
    page.bagPanelComp.isDecomposing = true;
    page.updateComposeRedDot(3);
    assert.deepEqual(dot.calls, [0], '分解模式里亮宝石合成红点会被误读成品质筛选有提醒');
});

test('装备页签普通态 / 道具页签：也归零', () => {
    const { page, dot } = makePage();
    page.activeTab = 2;
    page.updateComposeRedDot(5);
    page.activeTab = 3;
    page.updateComposeRedDot(5);
    assert.deepEqual(dot.calls, [0, 0]);
});

test('分解结束回到宝石页签：重新从服务端取当前值（不沿用旧值）', () => {
    const { page, dot } = makePage();
    page.activeTab = 1;
    serverRedDot = 2;
    page.updateComposeRedDot();
    assert.deepEqual(dot.calls, [2]);
});

test('onDisable：一键合成红点也要清零，避免 RedDot 复用留残影', () => {
    const { page, dot } = makePage();
    dot.calls.length = 0;
    page.onDisable();
    assert.deepEqual(dot.calls, [0]);
});
