import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleController } from '../assets/script/app/role/RoleController';
import { RoleEvent } from '../assets/script/app/role/RoleEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import type { IRoleGemOperations, IRoleGrowthOperations } from '../assets/script/app/role/RoleController';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('RoleController opens rich equip info popup when equipPart intent is received', async () => {
    const owner = {};
    const source = {};
    const openedPopups: Array<{ name: string; args: unknown[] }> = [];

    const gems: IRoleGemOperations = {
        source: () => source,
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
        }),
        change: async () => 'ok',
        preview: async () => ({ status: 'ok', materials: [] }),
        compose: async () => ({ status: 'ok', rewards: [] }),
        showRewards: () => {},
        dialog: async () => null,
        cancel: () => {},
    };

    const growth: IRoleGrowthOperations = {
        equip: async () => null,
        washAttributes: async () => [],
        gem: async () => null,
        plans: async () => [],
        filters: async () => [],
        request: async () => 'ok',
    };

    const controller = new RoleController(createControllerContext(), {
        owner,
        gems,
        growth,
        repository: { load: async () => ({}) },
        failed: () => {},
        view: {
            render: async () => {},
            selectBag: () => {},
            showBag: async () => {},
        },
        popups: {
            openTalent: () => {},
            openEquipInfo: (partId, bagUniqueId) => {
                openedPopups.push({ name: 'RoleEquipInfoPopup', args: [partId, bagUniqueId] });
            },
            openEquipEvolve: (partId, tab) => {
                openedPopups.push({ name: 'EquipEvolvePage', args: [partId, tab] });
            },
            openGemInfo: gemId => {
                openedPopups.push({ name: 'RoleGemInfoPopup', args: [gemId] });
            },
        },
        feedback: { tip: () => {} },
    });

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
    } finally {
        controller.dispose();
    }
});
