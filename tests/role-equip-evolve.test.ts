import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent, type RoleOutput } from '../assets/script/app/role/RoleEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import type { IRoleGemOperations, IRoleGrowthOperations } from '../assets/script/app/role/RoleController';
import { assetPath } from './helpers/asset-paths';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('RoleController opens rich equip info popup when equipPart intent is received', async () => {
    const owner = {};
    const openedPopups: Array<{ name: string; args: unknown[] }> = [];
    const actions: string[] = [];
    const callers: object[] = [];
    const bagGear = {
        id: 'unique_998', baseId: 4, name: '测试护腿', level: 0, rank: 1, worn: false,
        attack: 10, hpPercent: 1, effects: [], gemEffects: [], washValues: [],
        levelCost: [], qualityCost: null, washCost: null,
        rarityName: '平凡', nextRarityName: null, effectRows: [], levelCostFacts: [],
        qualityCostFact: null, washCostFact: null,
    };
    const choices: Array<'confirm' | 'alternate'> = ['confirm', 'alternate', 'confirm'];

    const gems: IRoleGemOperations = {
        slots: () => [],
        find: id => ({
            kind: 'gem',
            id: Number(id) || 1,
            gemId: id,
            equipId: 1,
            resId: 1000000,
            iconKey: '',
            iconPath: '',
            name: '测试宝石',
            desc: '攻击 +10',
            quality: 5,
            rank: 0,
            count: 1,
            equipped: false,
            upMark: false,
            masked: false,
        }),
        change: async () => 'ok',
        preview: async () => ({ status: 'ok', materials: [] }),
        compose: async () => ({ status: 'ok', rewards: [] }),
        qualities: async () => [],
        showRewards: () => {},
        dialog: async () => choices.shift() ?? null,
        cancel: () => {},
    };

    const growth: IRoleGrowthOperations = {
        equip: async id => id === bagGear.id ? bagGear : null,
        washAttributes: async () => [],
        gem: async () => null,
        plans: async () => [],
        filters: async () => [],
        request: async (proto, _payload, caller) => {
            actions.push(proto);
            callers.push(caller);
            return 'ok';
        },
    };

    const controller = new RoleController(createControllerContext(), {
        gems,
        growth,
        repository: { load: async () => ({}) },
        popups: {
            equipInfo: true,
            equipEvolve: true,
            gemInfo: true,
        },
    });
    EventMgr.instance.on(RoleEvent.Output, (output: RoleOutput<object>) => {
        if (output.kind === 'openEquipInfo') openedPopups.push({ name: 'RoleEquipInfoPopup', args: [output.partId, output.bagUniqueId] });
        else if (output.kind === 'openEquipEvolve') openedPopups.push({ name: 'EquipEvolvePage', args: [output.partId, output.tab] });
        else if (output.kind === 'openGemInfo') openedPopups.push({ name: 'RoleGemInfoPopup', args: [output.gemId] });
    }, owner);

    try {
        controller.start();

        // 1. 点击穿戴装备格 -> 打开装备详情弹窗
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equipPart', partId: 4 });
        await tick();
        assert.equal(openedPopups.length, 1);
        assert.deepEqual(openedPopups[0], { name: 'RoleEquipInfoPopup', args: [4, undefined] });

        // 2. 点击背包装备 -> 打开装备详情弹窗并传 bagUniqueId
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equip', id: 'unique_998' });
        await tick();
        assert.equal(openedPopups.length, 2);
        assert.deepEqual(openedPopups[1], { name: 'RoleEquipInfoPopup', args: [0, 'unique_998'] });

        // 3. 点击装备锻造入口 -> 打开锻造主界面
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'forge' });
        await tick();
        assert.equal(openedPopups.length, 3);
        assert.deepEqual(openedPopups[2], { name: 'EquipEvolvePage', args: [undefined, undefined] });

        // 4. 点击背包宝石 -> 打开宝石详情弹窗
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'gem', id: 'gem_1001' });
        await tick();
        assert.equal(openedPopups.length, 4);
        assert.deepEqual(openedPopups[3], { name: 'RoleGemInfoPopup', args: ['gem_1001'] });

        // 5. 装备详情弹窗发出带部位的 forge 意图 -> 透传 partId 给锻造界面
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'forge', partId: 4 });
        await tick();
        assert.equal(openedPopups.length, 5);
        assert.deepEqual(openedPopups[4], { name: 'EquipEvolvePage', args: [4, undefined] });

        // 背包装备详情中的操作入口可穿戴，也可确认单件分解。
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equip', id: bagGear.id, manage: true });
        await tick();
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equip', id: bagGear.id, manage: true });
        await tick();
        assert.deepEqual(actions, ['CmdEquipReplaceReqMsg', 'CmdEquipDecomposeReqMsg']);
        assert.deepEqual(callers, [controller, controller]);
        assert.equal(openedPopups.length, 5);
    } finally {
        EventMgr.instance.offTarget(owner);
        controller.dispose();
    }
});

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    _components?: Array<{ __id__: number }>;
    _contentSize?: { width: number; height: number };
    _enabled?: boolean;
    closeOnBlank?: boolean;
    data?: { __id__: number };
}

test('锻造页禁止空白关闭，全屏根节点必须挂 cc.BlockInputEvents，否则点击穿透到背包会误开物品详情', () => {
    const objects = JSON.parse(readFileSync(assetPath('ui/Role/EquipEvolve.prefab'), 'utf8')) as IPrefabObject[];
    const page = objects.find(object => object.closeOnBlank !== undefined);
    assert.equal(page?.closeOnBlank, false,
        '全屏锻造页关掉空白关闭，PopupBase 不会建 __BlankClose 全屏接收层，必须由 prefab 自己拦');

    const root = objects[objects[0].data!.__id__];
    assert.equal(root._name, 'EquipEvolve');
    const components = (root._components ?? []).map(ref => objects[ref.__id__]);
    const transform = components.find(component => component.__type__ === 'cc.UITransform');
    assert.equal(transform?._contentSize?.width, 720, '拦截组件只有挂在全屏尺寸的节点上，才会在整个页面范围内命中');
    assert.equal(transform?._contentSize?.height, 1280);

    const blocker = components.find(component => component.__type__ === 'cc.BlockInputEvents');
    assert.ok(blocker, '缺少 cc.BlockInputEvents：点击空白会穿到下层角色页背包格，打开物品详情');
    assert.equal(blocker?._enabled, true);
});
