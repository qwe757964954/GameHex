import { type ITestDamageStatsPopup, runtimeFixture, deferred, flush as flushRuntime } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assetPath } from './helpers/asset-paths';
import * as DamageStats from '../assets/script/app/zcds/model/ZCDamageStats';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function load(file: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as any, console, require: (name: string) => {
        if (name.endsWith('/ZCBattleEvents')) return { ZC_BATTLE_EVENTS };
        assert.ok(name in dependencies, name); return dependencies[name];
    } };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, context); return context.exports;
}
const decorator = { ccclass: () => (value: unknown) => value, property: () => () => {} };
const { ZCGameUiEvent } = load('assets/script/app/zcds/view/ZCGameHudEvents.ts', {});

/**
 * 弹窗替身：`open` 挂起（由用例手动兑现）。总线在**控制器自己**身上（`uiEvents`），订阅也在
 * `bindUiEvents` 里注册 —— 所以这里只要一个能 `close` 的壳，事件由用例直接往 `game.uiEvents` 派发。
 */
function popupStub(closed: number[] = []) {
    return { close: (reason: number) => closed.push(reason) };
}

test('战斗统计弹窗初始化绑定双页签与双虚拟列表，切页签重算列并回顶，关闭清空条数', async () => {
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Sprite: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: class { canCloseOnBlank() { return true; } } },
        '../../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        '../model/ZCDamageStats': DamageStats,
        '../view/ZCGameHudEvents': { ZCGameUiEvent },
        './RunAwayUnitItem': { RunAwayUnitItem: class {} },
        './RunAwayQualityArt': { RUNAWAY_QUALITY_FRAME_NAMES: { gold: 'common_img_pzk_01', purple: 'common_img_pzk_02', green: 'common_img_pzk_03', blue: 'common_img_pzk_04' }, RUNAWAY_QUALITY_FRAME_ROOT: 'image/frame' },
        '../../HeadArt': {},
        '../../common/SpriteFrameCache': { createIconLoader: () => async () => null },
    });
    const list = () => ({ renderItemFn: null as any, total: 0, scrolls: 0, setTotalCount(n: number) { this.total = n; }, scrollToTop() { this.scrolls++; } });
    const clicks = new Map<string, Function>();
    const button = (name: string) => ({ node: { on: (event: string, fn: Function) => clicks.set(name, fn) } });
    const popup = new GameRunAway();
    (popup as any).isValid = true;
    (popup as any).resourceScope = { disposed: false };
    const onFrame = { spriteFrame: 'on' }, offFrame = { spriteFrame: 'off' };
    popup.damageTab = button('damage'); popup.takenTab = button('taken');
    popup.damageTabBg = { spriteFrame: onFrame }; popup.takenTabBg = { spriteFrame: offFrame };
    popup.ownList = list(); popup.enemyList = list();
    popup.onInit();
    assert.equal(popup.damageTabBg.spriteFrame, onFrame, '默认伤害页签亮底');
    assert.equal(popup.takenTabBg.spriteFrame, offFrame);
    assert.equal(typeof popup.ownList.renderItemFn, 'function');
    assert.equal(typeof popup.enemyList.renderItemFn, 'function');
    const units = [
        { owner: ZCOwner.Player, unitId: 'a', cardId: 'a', name: '我方输出', iconKey: '', rarity: 'purple' as const, damage: 300, damageTaken: 10 },
        { owner: ZCOwner.Player, unitId: 'b', cardId: 'b', name: '我方坦克', iconKey: '', rarity: 'green' as const, damage: 0, damageTaken: 900 },
        { owner: ZCOwner.Enemy, unitId: 'c', cardId: 'c', name: '敌方输出', iconKey: '', rarity: 'gold' as const, damage: 200, damageTaken: 100 },
    ];
    await popup.onOpen({ units });
    assert.equal(popup.ownList.total, 1, '伤害页签过滤 0 输出单位');
    assert.equal(popup.enemyList.total, 1);
    clicks.get('taken')!.call(popup);
    assert.equal(popup.takenTabBg.spriteFrame, onFrame, '点承伤页签后亮底转移');
    assert.equal(popup.damageTabBg.spriteFrame, offFrame);
    assert.equal(popup.ownList.total, 2);
    assert.equal(popup.enemyList.total, 1);
    assert.equal(popup.ownList.scrolls, 2, '打开回顶一次、切页签回顶一次');
    assert.equal(popup.enemyList.scrolls, 2);
    assert.equal(popup.canCloseOnBlank(), true, '统计弹窗点空白可关');
    popup.onClose();
    assert.equal(popup.ownList.total, 0);
    assert.equal(popup.enemyList.total, 0);
});

test('神器结果弹吐司，模型与意图在运行控制器内处理', () => {
    const h = runtimeFixture();
    try {
        h.runtime.currentModel.useArtifact = () => ({ ok: true, message: '神器结果' });
        EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
        assert.ok(h.calls.includes('tip:神器结果'));
        const count = h.calls.filter(call => call.startsWith('tip:')).length;
        EventMgr.instance.emit(ZCGameUiEvent.HexClick, -1);
        assert.equal(h.calls.filter(call => call.startsWith('tip:')).length, count);
    } finally { h.dispose(); }
});

test('战斗统计按单位渲染左右虚拟列表：数据刷新原位更新，切页签重算条数与可见行', async () => {
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Sprite: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: class {} },
        '../../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        '../model/ZCDamageStats': DamageStats,
        '../view/ZCGameHudEvents': { ZCGameUiEvent },
        './RunAwayUnitItem': { RunAwayUnitItem: class {} },
        './RunAwayQualityArt': { RUNAWAY_QUALITY_FRAME_NAMES: { gold: 'common_img_pzk_01', purple: 'common_img_pzk_02', green: 'common_img_pzk_03', blue: 'common_img_pzk_04' }, RUNAWAY_QUALITY_FRAME_ROOT: 'image/frame' },
        '../../HeadArt': {},
        '../../common/SpriteFrameCache': { createIconLoader: () => async (name: string) => ({ name }) },
    });
    const list = () => ({ renderItemFn: null as any, total: -1, scrolls: 0, setTotalCount(n: number) { this.total = n; }, scrollToTop() { this.scrolls++; } });
    const button = () => ({ node: { on() {} } });
    const popup = new GameRunAway();
    (popup as any).isValid = true;
    (popup as any).resourceScope = { disposed: false };
    popup.damageTab = button(); popup.takenTab = button();
    popup.damageTabBg = { spriteFrame: { name: 'on' } }; popup.takenTabBg = { spriteFrame: { name: 'off' } };
    popup.ownList = list(); popup.enemyList = list();
    popup.onInit();
    const units = [
        { owner: ZCOwner.Player, unitId: 'p1', cardId: 'p1', name: '豌豆游侠', iconKey: '', rarity: 'gold' as const, damage: 600, damageTaken: 100 },
        { owner: ZCOwner.Player, unitId: 'p2', cardId: 'p2', name: '巨力坚果', iconKey: '', rarity: 'blue' as const, damage: 300, damageTaken: 800 },
        { owner: ZCOwner.Enemy, unitId: 'e1', cardId: 'e1', name: '火焰树妖', iconKey: '', rarity: 'purple' as const, damage: 200, damageTaken: 50 },
    ];
    await popup.onOpen({ units });
    assert.equal(popup.ownList.total, 2);
    assert.equal(popup.enemyList.total, 1);
    const calls: any[] = [];
    const bases: any[] = [];
    const row = {
        render: (value: number, total: number, _frame: unknown, base: unknown) => { calls.push({ value, total }); bases.push(base); },
        clear: () => calls.push('clear'),
    };
    const node = { getComponent: () => row };
    popup.ownList.renderItemFn(node, 0);
    assert.deepEqual(calls.at(-1), { value: 600, total: 900 }, '分母 = 我方全队合计（600 + 300），不是列内最大值');
    assert.deepEqual(bases.at(-1), { name: 'common_img_pzk_01' }, '金品级底框复用品级卡框原图 pzk_01');
    popup.ownList.renderItemFn(node, 1);
    assert.deepEqual(calls.at(-1), { value: 300, total: 900 }, '同一列共用同一个分母');
    assert.deepEqual(bases.at(-1), { name: 'common_img_pzk_04' }, '蓝品级底框走 pzk_04');
    popup.enemyList.renderItemFn(node, 0);
    assert.deepEqual(calls.at(-1), { value: 200, total: 200 }, '敌方分母 = 该席位合计（只有一席时等于它自己）');
    assert.deepEqual(bases.at(-1), { name: 'common_img_pzk_02' }, '紫品级底框走 pzk_02');
    units[0].damage = 900;
    popup.refresh(units);
    assert.equal(popup.ownList.total, 2, '数据刷新不增删行');
    assert.equal(popup.ownList.scrolls, 1, '数据刷新不回顶');
    popup.ownList.renderItemFn(node, 0);
    assert.deepEqual(calls.at(-1), { value: 900, total: 1200 }, '原位更新：分母跟着合计一起变（900 + 300）');
    popup.ownList.renderItemFn(node, 9);
    assert.equal(calls.at(-1), 'clear', '越界槽位清空复用组件');
});
test('敌方列跟随头像栏选中：默认席位序最小的敌方，切换后按该席位重算并回顶', async () => {
    const { GameRunAway } = load('assets/script/app/zcds/ui/GameRunAway.ts', {
        cc: { _decorator: decorator, Button: { EventType: { CLICK: 'click' } }, Sprite: class {}, SpriteFrame: class {} },
        '../../../framework/ui/PopupBase': { PopupBase: class {} },
        '../../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        '../model/ZCDamageStats': DamageStats,
        '../view/ZCGameHudEvents': { ZCGameUiEvent },
        './RunAwayUnitItem': { RunAwayUnitItem: class {} },
        './RunAwayQualityArt': { RUNAWAY_QUALITY_FRAME_NAMES: { gold: 'common_img_pzk_01', purple: 'common_img_pzk_02', green: 'common_img_pzk_03', blue: 'common_img_pzk_04' }, RUNAWAY_QUALITY_FRAME_ROOT: 'image/frame' },
        '../../HeadArt': {},
        '../../common/SpriteFrameCache': { createIconLoader: () => async () => null },
    });
    const list = () => ({ renderItemFn: null as any, total: -1, scrolls: 0, setTotalCount(n: number) { this.total = n; }, scrollToTop() { this.scrolls++; } });
    const button = () => ({ node: { on() {} } });
    const popup = new GameRunAway();
    (popup as any).isValid = true;
    (popup as any).resourceScope = { disposed: false };
    popup.damageTab = button(); popup.takenTab = button();
    popup.damageTabBg = { spriteFrame: null }; popup.takenTabBg = { spriteFrame: null };
    popup.ownList = list(); popup.enemyList = list();
    popup.onInit();
    const row = (owner: string, cardId: string, damage: number) => ({
        owner: owner as never, unitId: cardId, cardId, name: cardId, iconKey: '',
        rarity: 'green' as const, damage, damageTaken: 0, deckOrder: 0,
    });
    const units = [
        row('player', 'p1', 10),
        row('enemy', 'e1', 300),
        row('enemy2', 'e2a', 900),
        row('enemy2', 'e2b', 100),
    ];
    const seats = { owners: ['player', 'enemy', 'enemy2'] as never, profiles: new Map() };
    await popup.onOpen({ units, seats });
    assert.equal(popup.enemyList.total, 1, '默认只显示席位序最小的那一方（enemy），不把两方合并');
    assert.equal(popup.enemyList.scrolls, 1, '打开时回顶一次');
    (popup as any).selectEnemy('enemy2');
    assert.equal(popup.enemyList.total, 2, '切到 enemy2 后按它重算');
    assert.equal(popup.enemyList.scrolls, 2, '换敌方 = 换一批行，回顶');
    (popup as any).selectEnemy('enemy2');
    assert.equal(popup.enemyList.scrolls, 2, '重复点同一方不重算');
    popup.refresh(units);
    assert.equal(popup.enemyList.total, 2, '实时刷新保留当前选中，不退回默认');
    assert.equal(popup.enemyList.scrolls, 2, '刷新不回顶');
    popup.onClose();
});
test('胜负和平局自动结算一次，返回使用组合层导航端口', async () => {
    for (const status of ['victory', 'defeat', 'draw'] as const) {
        const h = runtimeFixture();
        try {
            h.forceStatus(status);
            for (let i = 0; i < 3; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { dt: 0.1 });
            await flushRuntime();
            assert.equal(h.requests.length, 1);
            assert.equal((h.pages[0] as { victory: boolean }).victory, status === 'victory');
            EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
            assert.ok(h.calls.includes('navigate'));
        } finally { h.dispose(); }
    }
});
test('确定先关页再导航，重复点击不重复导航，切流取消原样重开', async () => {
    const h = runtimeFixture();
    try {
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flushRuntime();
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
        assert.ok(h.calls.indexOf('close') < h.calls.indexOf('navigate'));
        assert.equal(h.calls.filter(call => call === 'navigate').length, 1);
        h.settleSwitch(false); await flushRuntime();
        assert.equal(h.pages.length, 2); assert.equal(h.pages[0], h.pages[1]);
        assert.equal(h.requests.length, 1);
    } finally { h.dispose(); }
});
test('主动撤退冻结业务，退出统一关闭统计和指南', async () => {
    const h = runtimeFixture();
    EventMgr.instance.emit(ZCGameUiEvent.OpenDamageStats);
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); await flushRuntime();
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    let develops = 0;
    h.runtime.currentModel.developHex = () => { develops++; return { ok: true, message: '' }; };
    EventMgr.instance.emit(ZCGameUiEvent.HexClick, 1);
    assert.equal(develops, 0);
    h.dispose();
    assert.ok(h.calls.includes('damageClose')); assert.ok(h.calls.includes('guideClose'));
});
test('退出后迟到的统计和指南窗口立即关闭，旧意图不再导航', async () => {
    for (const event of [ZCGameUiEvent.OpenDamageStats, ZCGameUiEvent.OpenGuide]) {
        const pending = deferred<ITestDamageStatsPopup | null>(); let closed = 0;
        const h = runtimeFixture({}, false, undefined, { openDamage: () => pending.promise, openGuide: () => pending.promise });
        EventMgr.instance.emit(event); await flushRuntime(); h.dispose();
        pending.resolve({ isOpen: true, refresh() {}, close: () => closed++ }); await flushRuntime();
        EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
        assert.equal(closed, 1); assert.equal(h.calls.includes('navigate'), false);
    }
});

test('结算页「查看完整队伍」用冻结的席位统计弹面板，重复点击不叠窗', async () => {
    const h = runtimeFixture();
    try {
        h.forceStatus('victory');
        for (let i = 0; i < 3; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { dt: 0.1 });
        await flushRuntime();
        // 结算请求带上本局统计（MVP 卡与「查看完整队伍」共用这一份）
        const request = h.requests[0];
        assert.ok(request.units, '结算请求必须带 units');
        // 这一局没有伤害（夹具不打仗）⇒ 不出 MVP 卡，页面整组收起
        assert.equal(request.mvp, null);
        assert.equal((h.pages[0] as { mvp: unknown }).mvp, null);
        EventMgr.instance.emit(ZCGameUiEvent.SettlementViewTeam);
        await flushRuntime();
        const opened = h.calls.filter(call => call.startsWith('viewTeam:'));
        assert.equal(opened.length, 1, '第一次点击应打开统计面板');
        EventMgr.instance.emit(ZCGameUiEvent.SettlementViewTeam);
        await flushRuntime();
        assert.equal(h.calls.filter(call => call.startsWith('viewTeam:')).length, 1, '已开着的窗口不重复弹');
    } finally { h.dispose(); }
});

test('战斗统计 Prefab 绑定完整：双虚拟列表、两页签与面板内边界按设计稿落位', () => {
    const prefab = JSON.parse(readFileSync('assets/bundles/battle/ui/game/GameRunAway.prefab', 'utf8'));
    for (const object of prefab) {
        JSON.stringify(object, (key, value) => { if (key === '__id__') assert.ok(value >= 0 && value < prefab.length); return value; });
    }
    const script = prefab.find((x: any) => x.ownList && x.enemyList);
    assert.ok(script, 'GameRunAway 必须绑定左右两个虚拟列表');
    const listOf = (ref: any) => prefab[ref.__id__];
    const nodeOf = (comp: any) => prefab[comp.node.__id__];
    const compOf = (node: any, type: string) => node._components
        .map((ref: any) => prefab[ref.__id__]).find((x: any) => x.__type__ === type);
    const compOfIn = (data: any[], node: any, type: string) => node._components
        .map((ref: any) => data[ref.__id__]).find((x: any) => x.__type__ === type);
    const ownList = listOf(script.ownList), enemyList = listOf(script.enemyList);
    for (const [list, name] of [[ownList, 'OwnList'], [enemyList, 'EnemyList']] as const) {
        assert.equal(list.__type__, '544earF5qRLB4JTuTnSr11+', `${name} 必须挂 VirtualScrollView`);
        assert.equal(list.useVirtualList, true);
        assert.equal(list.direction, 0);
        assert.equal(list.itemCreationMode, 1);
        assert.equal(list.spacing, 6);
        assert.equal(list.headerSpacing, 8);
        assert.equal(list.totalCount, 0);
        assert.equal(list.interactive, true, `${name} 必须接管触摸才能上下滑`);
        const itemMeta = JSON.parse(readFileSync(assetPath('ui/game/RunAwayUnitItem.prefab.meta'), 'utf8'));
        assert.equal(list.itemPrefab.__uuid__, itemMeta.uuid, `${name} 必须复用 RunAwayUnitItem 预制体`);
        const node = nodeOf(list);
        assert.equal(node._name, name);
        const contentRef = node._children.find((ref: any) => prefab[ref.__id__]._name === 'content');
        assert.ok(contentRef, `${name} 必须有 content 容器，否则 VirtualScrollView.start() 会直接返回`);
        assert.equal(list.content.__id__, contentRef.__id__, `${name} 的 content 必须绑定到虚拟列表`);
        const contentTransform = compOf(prefab[contentRef.__id__], 'cc.UITransform');
        assert.equal(contentTransform._anchorPoint.y, 1);
        assert.equal(contentTransform._contentSize.width, 242);
        const transform = compOf(node, 'cc.UITransform');
        assert.equal(transform._contentSize.width, 242);
        assert.equal(transform._contentSize.height, 435);
        assert.equal(transform._anchorPoint.y, 1);
        assert.ok(node._lpos.y <= 542 / 2, `${name} 顶部不能越过面板`);
        assert.ok(node._lpos.y - transform._contentSize.height >= -542 / 2, `${name} 底部不能越过面板`);
        assert.ok(node._lpos.x - 121 >= -542 / 2 && node._lpos.x + 121 <= 542 / 2, `${name} 左右不能越过面板`);
    }
    assert.equal(nodeOf(ownList)._lpos.x, -136);
    assert.equal(nodeOf(enemyList)._lpos.x, 128);

    // 敌方席位头像栏：脚本必须绑上容器；容器锚点在右沿，右沿与敌方列右沿对齐
    // （只有 1 个敌方时贴最右），且落在「敌方」标头与列表之间的标题带里。
    const seatsNode = prefab.find((x: any) => x.__type__ === 'cc.Node' && x._name === 'EnemySeats');
    assert.ok(seatsNode, 'GameRunAway 必须有 EnemySeats 容器');
    assert.ok(script.enemySeats, 'GameRunAway 脚本必须绑定 EnemySeats');
    assert.equal(prefab[script.enemySeats.__id__], seatsNode);
    const seatsTransform = compOf(seatsNode, 'cc.UITransform');
    assert.equal(seatsTransform._contentSize.width, 151, '「敌方」标头右侧到敌方列右沿的净宽');
    assert.equal(seatsTransform._contentSize.height, 44);
    assert.equal(seatsTransform._anchorPoint.x, 1, '右锚点：子节点从原点向左排，天然右对齐');
    assert.equal(seatsNode._lpos.x, nodeOf(enemyList)._lpos.x + 242 / 2, '右沿 = 敌方列右沿');
    assert.equal(seatsNode._lpos.y, 189, '与「我方 / 敌方」标头同一条基线');
    assert.ok(seatsNode._lpos.y + 44 / 2 <= 238.5 - 41 / 2, '不能顶到两个页签');
    const enemyHeader = prefab.find((x: any) => x.__type__ === 'cc.Node' && x._name === 'EnemyHeader');
    const headerLabel = compOf(enemyHeader, 'cc.Label');
    assert.equal(headerLabel._string, '敌方');
    assert.ok(enemyHeader._lpos.x + compOf(enemyHeader, 'cc.UITransform')._contentSize.width
        <= seatsNode._lpos.x - seatsTransform._contentSize.width, '头像栏不能压到「敌方」二字');

    const tabOn = JSON.parse(readFileSync(assetPath('image/gameui/damage_stats_tab_on.png.meta'), 'utf8'));
    const tabOff = JSON.parse(readFileSync(assetPath('image/gameui/damage_stats_tab_off.png.meta'), 'utf8'));
    const damageBg = listOf(script.damageTabBg), takenBg = listOf(script.takenTabBg);
    assert.equal(damageBg._spriteFrame.__uuid__, tabOn.subMetas.f9941.uuid, '默认选中伤害页签（亮底）');
    assert.equal(takenBg._spriteFrame.__uuid__, tabOff.subMetas.f9941.uuid);
    for (const [ref, text] of [[script.damageTab, '伤害统计'], [script.takenTab, '承伤统计']] as const) {
        const button = listOf(ref);
        assert.equal(button.__type__, 'cc.Button');
        const node = nodeOf(button);
        const label = node._children.map((child: any) => compOf(prefab[child.__id__], 'cc.Label')).find(Boolean);
        assert.equal(label._string, text);
        assert.equal(label._fontSize, 20);
    }

    const titleNode = prefab.find((x: any) => x.__type__ === 'cc.Node' && x._name === 'Title');
    const title = compOf(titleNode, 'cc.Label');
    assert.equal(title._string, '战斗统计');
    assert.equal(title._fontSize, 24);

    const item = JSON.parse(readFileSync('assets/bundles/battle/ui/game/RunAwayUnitItem.prefab', 'utf8'));
    for (const object of item) {
        JSON.stringify(object, (key, value) => { if (key === '__id__') assert.ok(value >= 0 && value < item.length); return value; });
    }
    const itemScript = item.find((x: any) => x.base && x.avatar && x.valueLabel && x.fill);
    assert.ok(itemScript, '列表项必须绑定底框 / 头像 / 数值 / 进度条');
    const itemRoot = item[1];
    const itemTransform = compOfIn(item, itemRoot, 'cc.UITransform');
    assert.equal(itemTransform._contentSize.width, 242);
    assert.equal(itemTransform._contentSize.height, 69);
    const avatar = item[itemScript.avatar.__id__];
    const frameMeta = JSON.parse(readFileSync(assetPath('image/frame/common_img_pzk_02.png.meta'), 'utf8'));
    const avatarNodeId = item[avatar.node.__id__]._parent.__id__;
    const avatarNode = item[avatarNodeId];
    assert.equal(avatar._spriteFrame, null);
    // 头像位 = 69×69 的 Mask 容器：整张 pzk（103×126）挂在子节点 Base 上，上对齐后被裁成方形底。
    const avatarTransform = compOfIn(item, avatarNode, 'cc.UITransform');
    assert.equal(avatarTransform._contentSize.width, 69);
    assert.equal(avatarTransform._contentSize.height, 69);
    const mask = compOfIn(item, avatarNode, 'cc.Mask');
    assert.ok(mask, 'Avatar 必须是 RECT Mask：没有它整张 pzk 的底部卡名条会漏出来');
    assert.equal(mask._type, 0);
    assert.equal(mask._inverted, false);
    const base = item[itemScript.base.__id__];
    assert.equal(base.__type__, 'cc.Sprite');
    const baseNode = item[base.node.__id__];
    assert.equal(baseNode._parent.__id__, avatarNodeId, 'Base 必须挂在 Mask 容器下才会被裁');
    const baseTransform = compOfIn(item, baseNode, 'cc.UITransform');
    assert.equal(baseTransform._contentSize.height, 85, 'Base 比 Mask 高，多出来的部分正好是卡名条');
    assert.equal(base._spriteFrame.__uuid__, frameMeta.subMetas.f9941.uuid, '底框默认挂紫色品级底（pzk 原图，运行时按品级换同尺寸整图）');
    const fill = item[itemScript.fill.__id__];
    assert.equal(fill._type, 3, '进度条填充必须用 FILLED，按比例裁切');
    assert.equal(fill._fillType, 0);
    assert.equal(fill._fillRange, 1, '预制体默认满条，运行时 render 再按数据裁切');
});
