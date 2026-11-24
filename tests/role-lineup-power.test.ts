/**
 * 角色页「战斗力」与卡牌页同源（`cardRepository.loadLineupPower`）。
 *
 * ## 为什么要有这条
 *
 * 2026-11-24 实机：角色页显示 72、卡牌页显示 325。两侧当时是**两套算法** ——
 * 角色页走 `RolePowerTable.totalAttackOf`（只有装备那一支），卡牌页走
 * `CardLineupPower.lineupAttackTotal`（上阵卡攻击力之和）。
 * 现在角色快照直接透传卡牌阵容战力，本用例钉住这条取数口径，别再分叉。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/cc-sandbox';
import * as RoleTable from '../assets/script/app/role/RoleTable';
import * as RoleTypes from '../assets/script/app/role/RoleTypes';

interface ISnapshotLike {
    power: number;
    bagCounts: Record<number, number>;
    navs: readonly unknown[];
}

interface IRepositoryLike {
    load(): Promise<ISnapshotLike>;
}

function loadRepository(power: number, cachedPower: number | null = null): { repository: IRepositoryLike; counter: { powerCalls: number } } {
    const counter = { powerCalls: 0 };
    const { exports, unresolved } = loadTsModule<{ roleRepository: IRepositoryLike }>('assets/script/app/role/RoleRepository.ts', {
        modules: {
            '/RefUtil': { RefUtil: { instance: { getRefAllAsync: async () => [] } } },
            '/CacheMgr': {
                CacheMgr: {
                    instance: {
                        getTlCmdGem: () => [],
                        getTlCmdEquipItem: () => [],
                        getTlCmdEquipPart: () => [],
                        getTlCmdEquipPage: () => [],
                        getTlCmdRole: () => [],
                    },
                },
            },
            '/RequestGuard': { toCount: (value: unknown) => Number(value) || 0 },
            '/CardRepository': {
                cardRepository: {
                    getCachedLineupPower: () => cachedPower,
                    loadLineupPower: async () => {
                        counter.powerCalls += 1;
                        return power;
                    },
                },
            },
            '/ItemBag': { readItemCounts: async () => new Map<string, number>() },
            '/TableNames': { ITEM_TABLE: 'item' },
            '/RoleTable': RoleTable,
            '/RoleTypes': RoleTypes,
        },
    });
    assert.deepEqual(unresolved, [], '桩表必须覆盖 RoleRepository 的全部依赖（漏桩会静默回空对象）');
    return { repository: exports.roleRepository, counter };
}

test('角色快照的战斗力直接取卡牌阵容战力，不再走装备攻击力那一套', async () => {
    const { repository, counter } = loadRepository(325);
    const snapshot = await repository.load();
    assert.equal(counter.powerCalls, 1, '角色页必须调用 loadLineupPower（与卡牌页 / 主界面同源）');
    assert.equal(snapshot.power, 325);
});

test('卡牌阵容战力为 0（空阵容 / 未取到）时角色快照原样透传，不另算一个数', async () => {
    const { repository } = loadRepository(0);
    const snapshot = await repository.load();
    assert.equal(snapshot.power, 0);
});

test('卡牌页首屏缓存（内存 / 本地快照）已有时优先复用，不重复取数', async () => {
    const { repository, counter } = loadRepository(999, 325);
    const snapshot = await repository.load();
    assert.equal(counter.powerCalls, 0, '已有卡牌页缓存时不应再发起一次阵容取数');
    assert.equal(snapshot.power, 325);
});
