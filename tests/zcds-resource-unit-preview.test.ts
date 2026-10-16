import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

/** 与 `zcds-progress.test.ts` 同款：补齐 prefab 必填引用。 */
function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

/** 造一个「骨骼 prefab」：带假骨架（动画名idle/move/attack，canvas 高 916.29）与 setAnimation 记录。 */
function spinePrefab(load: (name: string) => any, cc: any, name = '豌豆射手', canvasHeight = 916.29) {
    const played: Array<{ clip: string; loop: boolean }> = [];
    const skeleton = {
        skeletonData: { getRuntimeData: () => ({ height: canvasHeight, animations: [{ name: 'idle' }, { name: 'move' }, { name: 'attack' }] }) },
        setAnimation(_track: number, clip: string, loop: boolean) { played.push({ clip, loop }); },
    };
    const make = () => {
        const node = new (load('./ZCHexView') ? (cc.Node as any) : (cc.Node as any))();
        // 桩组件要挂在节点上才能被 getComponent 找到。
        const sk = { ...skeleton, skeletonData: skeleton.skeletonData, setAnimation: skeleton.setAnimation };
        node.__skeleton = sk;
        node.getComponent = (type: any) => (type === cc.sp?.Skeleton || type?.name === 'Skeleton' ? sk : null);
        node.getComponentInChildren = (type: any) => (type === cc.sp?.Skeleton || type?.name === 'Skeleton' ? sk : null);
        node.name = name;
        node.componentName = name;
        return node;
    };
    return { name, make, played };
}

function resourceHexState(id: string, extra: Record<string, unknown> = {}): never {
    return {
        id: 7, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
        hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
        developmentCost: 25, tileType: null, developmentResolved: false,
        neutralResourceId: id, cardId: null, ...extra,
    } as never;
}

test('unit_cap 不再写中文「兵力」：按配置站N 个中立待机兵，播idle', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc, '豌豆射手');
    view.setResourceUnits('68001', prefab as never, 3);

    view.render({
        state: resourceHexState('unit_cap'),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });

    // ① 站了 3 个（表里 `rewardUnitCount = 3`）。
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3, `应站 3 个中立兵，实际 ${nodes.length}`);
    assert.ok(nodes.every((n) => n.active), '未领取时三个兵都该可见');

    // ② 播的是 idle 且循环。
    assert.equal(prefab.played.length, 3, '每个兵都要起一次待机动作');
    assert.ok(prefab.played.every((p) => p.clip === 'idle' && p.loop), `应播 idle 循环，实际 ${JSON.stringify(prefab.played)}`);

    // ③ **不再有中文「兵力」字**：标签不启用、字符串为空。
    assert.equal(view.iconLabel.enabled, false, '有骨骼时不该再显示文字');
    assert.equal(view.iconLabel.string, '', `不该写中文兜底，实际 "${view.iconLabel.string}"`);

    // ④ 缩到格内：豌豆射手骨架 canvas 916.29 高，按格内目标高度 48.6 归一。
    const factor = 48.6 / 916.29;
    assert.ok(Math.abs(nodes[0].scale.x - factor) < 1e-9, `缩放应按 canvas 高归一，实际 ${nodes[0].scale.x}`);
    assert.equal(nodes[0].scale.y, nodes[0].scale.x, '等比：两轴同值');

    // ⑤ 并排且都在格内：偏移以格心对称，间距 16 ⇒ 三个占 [-16, 0, 16]。
    // ⚠️ 逐项断言而不是 deepEqual：桩对象来自 `runInNewContext` 的另一个 realm，
    // 跨 realm 的 Array 原型不同，deepEqual 必红（规则 167 同族坑）。
    assert.deepEqual(Array.from(nodes, (n) => n.position.x), [-16, 0, 16]);

    // ⑥ 脚底落点 = `ZCHexView.RESOURCE_UNIT_POS_Y`（需求 row7：「格内兵团上移 30px」，
    //    2026-10-15 由 -18 抬到 12）。钉住它是因为这个值**曾被改回去过一次**，
    //    而没有任何用例会因此变红 —— 表现上只是兵又陷回格子里。
    assert.deepEqual(Array.from(nodes, (n) => n.position.y), [12, 12, 12],
        '格内兵团必须上移到 y = 12（-18 + 30，需求 row7）');
});

test('领取后（neutralResourceId 清空）骨���收掉，不残留', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc) as never, 3);
    view.render({
        state: resourceHexState('unit_cap'),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3);

    // 领取后：资源标识清空（`claimAdjacentNeutralResources` 的行为）。
    view.render({
        state: resourceHexState('', { neutralResourceId: null }),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    assert.ok(nodes.every((n) => !n.active), '领取后三个兵都该隐藏');
});

test('没注入骨骼 prefab 时退回中文兜底，不留空格', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 表里 rewardCardId 为空、或该卡没单位 prefab ⇒ 渲染层会喂 null。
    view.setResourceUnits('', null, 3);
    view.render({
        state: resourceHexState('unit_cap'),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    assert.equal(view.iconLabel.enabled, true, '兜底要显示文字');
    assert.equal(view.iconLabel.string, '兵力');
    assert.equal(((view as any).resourceUnitNodes as any[]).length, 0, '不该凭空造节点');
});

test('同一个 prefab 每帧 render 不会反复重建节点（否则节点无限增长）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc);
    view.setResourceUnits('68001', prefab as never, 2);
    const presentation = {
        state: resourceHexState('unit_cap'),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    };
    view.render(presentation);
    const first = ((view as any).resourceUnitNodes as any[]).slice();
    for (let i = 0; i < 10; i += 1) view.render(presentation);
    const after = (view as any).resourceUnitNodes as any[];
    assert.equal(after.length, first.length, '不该每帧重建');
    assert.ok(after.every((n, i) => n === first[i]), '节点实例应被复用，不是重建的');
    assert.equal(prefab.played.length, 2, '待机只播一次，不重复 setAnimation');
});

test('换兵种（cardId / prefab 变了）必须重建节点', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc, '豌豆射手') as never, 2);
    view.render({ state: resourceHexState('unit_cap'), canDevelop: false, playerGold: 0, cooldown: null, now: 0 });
    const before = ((view as any).resourceUnitNodes as any[]).slice();

    const nutPrefab = spinePrefab(load, cc, '坚果');
    view.setResourceUnits('68002', nutPrefab as never, 2);
    view.render({ state: resourceHexState('unit_cap'), canDevelop: false, playerGold: 0, cooldown: null, now: 0 });

    const after = (view as any).resourceUnitNodes as any[];
    assert.equal(after.length, 2);
    assert.ok(after.every((n) => !before.includes(n)), '换兵种后应是全新节点，不能沿用旧的骨架');
    assert.equal(nutPrefab.played.length, 2, '新兵种要起自己的待机动作');
});

test('数量变化按配置走：改成 1 个只留 1 个可见', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc) as never, 3);
    const presentation = { state: resourceHexState('unit_cap'), canDevelop: false, playerGold: 0, cooldown: null, now: 0 };
    view.render(presentation);
    assert.equal(((view as any).resourceUnitNodes as any[]).filter((n) => n.active).length, 3);

    // 策划把 rewardUnitCount 改成 1。
    // ⚠️ 必须重新取 `resourceUnitNodes`：数量变化会**重建**节点（旧数组里的已被 destroy），
    // 拿旧数组断言会看到过期的 [-16,0,16]，误判成「位置没重算」。
    view.setResourceUnits('68001', ((view as any).resourceUnitPrefab as any), 1);
    view.render(presentation);
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 1, '数量改成 1 后应只剩 1 个节点');
    assert.equal(nodes.filter((n) => n.active).length, 1, '只剩 1 个可见');
    assert.deepEqual(Array.from(nodes, (n) => n.position.x), [0],
        '并排位置要按新数量重算：1 个时正中那只 offset 必须为 0');
});

test('★自选出生点阶段：兵力资源点与对局一致（站待机兵、不画兵营图标、不写文字）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc, '豌豆射手');
    view.setResourceUnits('68001', prefab as never, 3);
    // 给一个区名，验「站了骨骼的格子一个字都不写」——包括本来会画上去的区名。
    view.renderSpawnSelection({
        sectionOwner: 'player', selectedBy: null, confirmed: false, blocked: false,
        resourcePoint: true, resourceId: 'unit_cap', unlocksResource: false,
        regionText: '后区·发育',
    } as never);

    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3, `选点阶段该站 3 个待机兵，实际 ${nodes.length}`);
    assert.ok(nodes.every((n) => n.active), '三个兵都该可见');
    assert.equal(prefab.played.length, 3, '每个兵都要起待机动作');
    assert.ok(prefab.played.every((p) => p.clip === 'idle' && p.loop), '播 idle 循环');
    // ① 不再画兵营图标（这正是用户报的那一处）。
    assert.equal(view.iconSprite.enabled, false, '★兵力点不该再画兵营图标');
    assert.equal(view.iconSprite.spriteFrame, null, '★图标帧该被清掉（对象池复用的节点也是）');
    // ② 一个字都不写（区名 / × / 锁 都让位给兵）。
    assert.equal(view.iconLabel.enabled, false, '★兵力点不该有任何文字');
    assert.equal(view.iconLabel.string, '', `不该写文字，实际 "${view.iconLabel.string}"`);
    assert.equal(view.buildingLayer.active, false, '骨骼模式下 buildingLayer 该关（那是「可开发」的语义）');

    // 反例：骨骼建不出来（表没配 rewardCardId / 没单位 prefab）才退回兵营图标兜底，不留空格。
    const fallback = stubHexView(load, cc, bar);
    fallback.renderSpawnSelection({
        sectionOwner: 'player', selectedBy: null, confirmed: false, blocked: false,
        resourcePoint: true, resourceId: 'unit_cap', unlocksResource: false,
    } as never);
    assert.equal((fallback as any).resourceUnitNodes.length, 0, '没喂骨骼时不该凭空造兵');
    assert.equal(fallback.iconSprite.spriteFrame, fallback.barracksIconFrame,
        '骨骼缺失时才退回兵营图标（保住「这一格是兵力点」的信息）');
});
