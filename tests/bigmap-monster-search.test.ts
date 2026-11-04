import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';
import { BigMapController, BIGMAP_SEARCH_MONSTER_EMPTY } from '../assets/script/app/bigmap/application/BigMapController';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { BigMapUiEvent, BigMapViewEvent, type IBigMapViewCommandEvent } from '../assets/script/app/bigmap/application/BigMapEvents';
import { createControllerContext } from './helpers/controller-context';

/**
 * 搜索复用 canAttack 判定，距离以玩家基地为起点。
 */
function makeModel() {
    const config = loadBigMapConfig();
    return new BigMapModel({
        config, storage: createMemoryBigMapStorage(), saveKey: 'monster-search',
        now: () => 957600, adventureChapter: () => 3,
        startBattle: async () => ({ ok: true, message: '' }),
    });
}

test('探索选择距玩家基地最近的可挑战怪物', () => {
    const model = makeModel();
    const best = model.bestMonsterToFarm();
    const sites = (model as unknown as { worldInstance: { monsters: { instanceId: number }[] } }).worldInstance.monsters;
    const attackable = sites.map((site) => model.monsterView(site.instanceId)).filter((view) => view?.canAttack);
    assert.ok(attackable.length > 1, '夹具必须提供多个可挑战目标，不能空跑');
    assert.ok(best, '有能打的野怪就必须挑出来一只');
    assert.equal(best.canAttack, true);
    const nearest = Math.min(...attackable.map((view) => model.distanceFromBase(view.hexId)));
    assert.equal(model.distanceFromBase(best.hexId), nearest);
    const sameDistance = attackable.filter((view) => model.distanceFromBase(view.hexId) === nearest);
    assert.equal(best.instanceId, Math.min(...sameDistance.map((view) => view.instanceId)));
});

test('附近高等级野怪未解锁时，搜索最近的一级怪且拒绝直接攻打高等级怪', async () => {
    const model = makeModel();
    const views = model.world.monsters.map((site) => model.monsterView(site.instanceId));
    const high = views.find((view) => view?.level === 19);
    const first = views.find((view) => view?.level === 1);
    assert.ok(high);
    assert.ok(first);
    model.distanceFromBase = (hexId) => hexId === high.hexId ? 0 : hexId === first.hexId ? 1 : 10;
    assert.equal(model.bestMonsterToFarm()?.instanceId, first.instanceId);
    assert.equal(high.unlocked, false);
    assert.equal(high.canAttack, false);
    assert.equal(high.attackReason, '需先通关 18 级野怪');
    const result = await model.requestAttackMonster(high.instanceId);
    assert.equal(result.ok, false);
    assert.equal(result.message, high.attackReason);
});

test('距离优先于等级，跳过不能挑战的目标，同距离稳定选择', () => {
    const model = makeModel();
    const sites = model.world.monsters;
    assert.ok(sites.length >= 3);
    const template = model.monsterView(sites[0].instanceId);
    assert.ok(template);
    const [far, near, locked] = sites;
    model.monsterView = (id) => id === far.instanceId ? { ...template, instanceId: id, hexId: far.anchorHexId, level: 99, canAttack: true }
        : id === near.instanceId ? { ...template, instanceId: id, hexId: near.anchorHexId, level: 1, canAttack: true }
        : id === locked.instanceId ? { ...template, instanceId: id, hexId: locked.anchorHexId, canAttack: false } : null;
    model.distanceFromBase = (id) => id === far.anchorHexId ? 10 : id === near.anchorHexId ? 2 : 0;
    assert.equal(model.bestMonsterToFarm()?.instanceId, near.instanceId);
    model.distanceFromBase = () => 2;
    assert.equal(model.bestMonsterToFarm()?.instanceId, Math.min(far.instanceId, near.instanceId));
    model.monsterView = () => null;
    assert.equal(model.bestMonsterToFarm(), null);
});

test('从基地搜索切回世界地图并选中定位，无目标时只提示', () => {
    const model = makeModel();
    const controller = new BigMapController(model, { context: createControllerContext(), schedule: () => () => {} });
    const commands: IBigMapViewCommandEvent['command'][] = [];
    const owner = {};
    EventMgr.instance.on(BigMapViewEvent.Command, ({ command }: IBigMapViewCommandEvent) => commands.push(command), owner);
    controller.start();
    try {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'mode', mode: 'base' } });
        const target = model.bestMonsterToFarm();
        assert.ok(target);
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'searchMonster' } });
        assert.equal(controller.snapshot.ui.mode, 'world');
        assert.equal(controller.snapshot.ui.selectedMonsterId, target.instanceId);
        assert.ok(commands.some((command) => command.kind === 'focusWorld' && command.hexId === target.hexId));
        commands.length = 0;
        model.monsterView = () => null;
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'searchMonster' } });
        assert.deepEqual(commands, [{ kind: 'feedback', ok: false, message: BIGMAP_SEARCH_MONSTER_EMPTY }]);
    } finally {
        controller.dispose();
        EventMgr.instance.offTarget(owner);
    }
});

test('探索与攻打共用同一套「能不能打」判定，控制器据此定位而不是另开一套', () => {
    const controller = readFileSync('assets/script/app/bigmap/application/BigMapController.ts', 'utf8');
    assert.ok(/case 'searchMonster': this\.searchMonster\(\);/.test(controller), '控制器必须接住 searchMonster 意图');
    assert.ok(/bestMonsterToFarm\(\)/.test(controller), '必须复用 model.bestMonsterToFarm()');
    assert.ok(/selectedMonsterId = target\.instanceId/.test(controller), '定位要顺带选中，详情面板才弹得出来');
    assert.ok(/kind: 'focusWorld'/.test(controller), '定位完要把镜头移过去');
});
