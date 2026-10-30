/**
 * 主城宝箱栏（`ui/main/ChestSlot.prefab` + `ui/main/ArenaRoot.prefab` 的 `ChestBar`）回归网。
 *
 * 由来：2026-10-19 接蓝湖「塔防主界面-2」时吃过两个**零报错**的亏：
 *  1. `prefab_lifecycle create` 落盘的节点 **layer = DEFAULT(1073741824)** ⇒ 2D 相机不渲染，
 *     界面上 4 格只剩顶部计时条（组件数据全对，就是不画）。这里直接断言 layer。
 *  2. 宿主 `MainPage` 挂在页根，父的 `onLoad` 先于 `ChestBar` 装配槽位跑 ⇒ `render()` 画了 4 个默认态。
 *     源码侧断言「`render` 前必须 `ensureSlots()`」。
 *
 * 只验**静态结构 + 纯函数**（组件都拉 `cc`，Node 里 import 不了，规则 78）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

type Entry = Record<string, unknown>;

const SLOT_PATH = assetPath('ui/main/ChestSlot.prefab');
const ARENA_PATH = assetPath('ui/main/ArenaRoot.prefab');

const SLOT = JSON.parse(readFileSync(SLOT_PATH, 'utf8')) as Entry[];
const ARENA = JSON.parse(readFileSync(ARENA_PATH, 'utf8')) as Entry[];

const UI_2D = 33554432;

const node = (prefab: Entry[], name: string): Entry | undefined =>
    prefab.find((e) => e?.__type__ === 'cc.Node' && e._name === name);

const childNames = (prefab: Entry[], parent: Entry): string[] =>
    ((parent._children ?? []) as Array<{ __id__: number }>)
        .map((r) => prefab[r.__id__])
        .filter((e) => e?._name)
        .map((e) => e._name as string);

test('C1 宝箱单格结构：7 个直接子节点，顺序即渲染序', () => {
    const slot = node(SLOT, 'ChestSlot');
    assert.ok(slot, 'ChestSlot.prefab 没有根节点');
    assert.deepEqual(childNames(SLOT, slot!), ['Card', 'Box', 'Timer', 'NameLabel', 'EmptyLabel', 'Cost', 'Btn'],
        '子节点顺序变了 —— Card 必须最底（先画），Btn 压在最上');
    assert.equal(slot!._layer, UI_2D, '根节点 layer 必须是 UI_2D');
});

test('C2 每个节点都是 UI_2D —— DEFAULT 层的子节点在 2D 相机下「整棵不画」，零报错', () => {
    const offenders: string[] = [];
    for (const entry of SLOT) {
        if (entry?.__type__ !== 'cc.Node' || !entry._name) continue;
        if (entry._layer !== UI_2D) offenders.push(`${entry._name}=${entry._layer}`);
    }
    assert.deepEqual(offenders, [], '这些节点 layer 不是 UI_2D（prefab_lifecycle create 的默认坑）');
});

test('C3 宝箱单格挂 ChestSlotView，且 15 个 @property 全绑上（漏一个就是静默留白）', () => {
    const slot = node(SLOT, 'ChestSlot')!;
    const comps = ((slot._components ?? []) as Array<{ __id__: number }>).map((r) => SLOT[r.__id__]);
    // ⚠️ 自定义组件的 `__type__` 存的是 **cid**（`f536cnjD+…`），不是类名 ⇒ 按「有没有 card 字段」认。
    const view = comps.find((c) => !!c && typeof c === 'object' && 'card' in (c as Record<string, unknown>));
    assert.ok(view, '根节点没有 ChestSlotView 组件');
    for (const key of ['card', 'timer', 'timeBg', 'clock', 'timeFill', 'timeText', 'timeTextTransform', 'box', 'nameLabel', 'emptyLabel', 'cost', 'costLabel', 'btn', 'btnLabel', 'speedUpIcon']) {
        assert.ok(view![key], `ChestSlotView.${key} 没绑 —— 运行时该处会静默不显示`);
    }
    assert.equal(SLOT[(view!.timeBg as { __id__: number }).__id__], node(SLOT, 'TimeBg'));
    assert.equal(SLOT[(view!.clock as { __id__: number }).__id__], node(SLOT, 'Clock'));
    const textTransform = SLOT[(view!.timeTextTransform as { __id__: number }).__id__];
    assert.equal(textTransform.__type__, 'cc.UITransform');
    assert.equal(SLOT[(textTransform.node as { __id__: number }).__id__], node(SLOT, 'TimeText'));
});

test('C4 主城页有 ChestBar：底图 720×317、4 个 ChestSlot 实例、箭头就位', () => {
    const bar = node(ARENA, 'ChestBar');
    assert.ok(bar, 'ArenaRoot.prefab 里没有 ChestBar');
    assert.deepEqual(childNames(ARENA, bar!), ['Bg', 'List', 'Prev', 'Next'], 'ChestBar 子节点顺序变了');

    const list = ((bar!._children ?? []) as Array<{ __id__: number }>)
        .map((r) => ARENA[r.__id__]).find((e) => e?._name === 'List')!;
    const slots = ((list._children ?? []) as Array<{ __id__: number }>)
        .map((r) => ARENA[r.__id__]).filter((e) => e?.__type__ === 'cc.Node');
    assert.equal(slots.length, 4, '宝箱栏应当正好 4 格');
    const slotUuid = (JSON.parse(readFileSync(`${SLOT_PATH}.meta`, 'utf8')) as { uuid: string }).uuid;
    for (const slot of slots) {
        const info = ARENA[(slot!._prefab as { __id__: number }).__id__] as Entry;
        assert.equal((info.asset as { __uuid__?: string })?.__uuid__, slotUuid, '不是 ChestSlot.prefab 的实例');
    }

    // 底图尺寸 = 设计稿 720×317（宝箱栏压在底栏上沿）
    //  ⚠️ 必须从 ChestBar 自己下面找 Bg —— ArenaRoot 里 `EntranceLayer/LeftList/Bg`、`HangEntry/Bg`
    //     也叫 Bg，全局 find 会抓到别人。
    const bg = ((bar!._children ?? []) as Array<{ __id__: number }>)
        .map((r) => ARENA[r.__id__]).find((e) => e?._name === 'Bg')!;
    const bgTransform = ARENA[((bg._components ?? []) as Array<{ __id__: number }>)[0].__id__] as Entry;
    const bgSize = (bgTransform._contentSize as { width: number; height: number });
    assert.equal(bgSize.width, 720);
    assert.equal(bgSize.height, 317);
});

test('C5 `ChestBar.render` 必须先 `ensureSlots()` —— 主城 start 先绘制明确的空槽数据', () => {
    const src = readFileSync('assets/script/app/main/ChestBar.ts', 'utf8');
    const body = src.slice(src.indexOf('render(data: readonly IChestSlotData[]'));
    assert.match(body.slice(0, 220), /const slots = this\.ensureSlots\(\);/, 'render 没先装配槽位');
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.match(page, /start\(\): void \{\s*this\.renderChests\(this\.emptyChestSlots\);/, '宝箱栏要在 start() 铺明确的初始空槽');
});

test('C6 计时文本使用紧凑英文 h m s 单位', () => {
    const src = readFileSync('assets/script/app/main/ChestSlotView.ts', 'utf8');
    assert.match(src, /parts\.push\(`\$\{hours\}h`\)/);
    assert.match(src, /parts\.push\(`\$\{minutes\}m`\)/);
    assert.match(src, /parts\.push\(`\$\{secondsRemaining\}s`\)/);
    assert.match(src, /return parts\.join\(' '\)/);
});

test('C7 蓝卡计时条保留时钟图标，时间文字与图标同排', () => {
    const timer = node(SLOT, 'Timer');
    assert.ok(timer, 'ChestSlot.prefab 缺少 Timer 节点');
    const timerChildren = childNames(SLOT, timer!);
    assert.ok(timerChildren.includes('Clock'), '蓝湖计时样式需要时钟图标');
    assert.ok(timerChildren.includes('TimeText'), 'Timer 下缺少时间文字');

    const clock = node(SLOT, 'Clock')!;
    const clockSprite = ((clock._components ?? []) as Array<{ __id__: number }>)
        .map((ref) => SLOT[ref.__id__]).find((entry) => entry?.__type__ === 'cc.Sprite') as Entry | undefined;
    assert.deepEqual([ (clock._lpos as { x: number; y: number }).x, (clock._lpos as { x: number; y: number }).y ], [-24, 0]);
    assert.equal((clockSprite?._spriteFrame as { __uuid__?: string })?.__uuid__,
        'b022a368-7f62-4ac9-9e61-152a2328b86c@f9941');

    const timeText = node(SLOT, 'TimeText')!;
    assert.deepEqual([ (timeText._lpos as { x: number; y: number }).x, (timeText._lpos as { x: number; y: number }).y ], [16, 0]);
});

test('C8 宝箱入口展开宝箱栏时隐藏快速寻敌按钮，收起时恢复', () => {
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.match(page, /chestToggle: Node = null!/);
    assert.match(page, /this\.chestToggle\.on\(Button\.EventType\.CLICK, this\.onToggleChestPanel, this\)/);
    assert.match(page, /setChestPanelOpen\(open: boolean\): void/);
    assert.match(page, /this\.chestBar\.setOpen\(open\)/);
    assert.match(page, /this\.startButton\.active = !open/);
    assert.match(page, /this\.chestToggle\.on\(Button\.EventType\.CLICK, this\.onToggleChestPanel, this\);[\s\S]*?start\(\): void \{[\s\S]*?this\.chestBar\.setOpen\(false, false\)/);
});
