import { createControllerContext } from './helpers/controller-context';
import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as chestTypes from '../assets/script/app/main/ChestTypes';

function createPage() {
    const context = createControllerContext();
    let panel: { updateCountdown: (...args: unknown[]) => void; close: () => void } | null = null;
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/MainPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Repository { dispose() {} }
    runInNewContext(code, { exports, console, require: (name: string) => {
        if (name.endsWith('/ComponentController')) return componentControllerModule(context);
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, SpriteFrame: class {},
            // `MainPage` 的「点空白收起宝箱栏」把 `chestBlankTouchStart` 当字段初始化（`new Vec2()`）
            // ⇒ 桩里缺它会直接 `Vec2 is not a constructor`，整个用例连页面都建不出来（2026-11-09 补）。
            Vec2: class { constructor(public x = 0, public y = 0) {} static distance(): number { return 0; } } };
        if (name === '../../core/asset/ResourceScope') return { ResourceScope };
        if (name === './ChestTypes') return chestTypes;
        if (name === './NewTreasureRepository') return { NewTreasureRepository: Repository };
        if (name === '../../framework/ui/PopupManager') return { PopupManager: { inst: { get: () => panel } } };
        if (name === '../ArtPaths') return { spriteFramePathOf: (s: string) => `${s}/spriteFrame` };
        if (name === '../itemdetail/ItemDetailTable') return { qualityNameOf: () => '精良', qualityFrameSuffixOf: () => '01' };
        if (name === '../itemdetail/ItemDetailArt') return { qualityFrameArtPath: () => 'frame' };
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { offTarget() {} } } };
        if (name === '../net/GameNet') return { GameNet: { instance: { removeCaller() {} } } };
        // `onDestroy` 会退订关卡缓存（战斗宝箱入口的开启动条件看 `CmdBattleLevel`）
        if (name === '../net/CacheMgr') return { CacheMgr: { instance: { setEventUpdate() {}, removeEventUpdate() {} } } };
        return {};
    } });
    const page = new exports.MainPage();
    page.isValid = true;
    const { ComponentController } = componentControllerModule(context);
    const composition = new ComponentController('test-main-page-composition');
    page.initialize(composition.resources);
    return { page, context, composition, setPanel: (value: typeof panel) => { panel = value; } };
}

test('未激活宝箱显示配置等待时长并允许开启，激活后立即刷新倒计时', async () => {
    const { page, setPanel } = createPage();
    page.loadChestFrame = async () => null;
    page.loadQualityFrame = async () => null;
    // 后面会把它改成 SpeedUp：显式放宽成枚举类型，否则 TS 把字面量推成 'activate'。
    const detail = { name: '宝箱', quality: 1, icon: '', rewards: [], fastOpenCost: 10,
        action: chestTypes.ChestSlotAction.Activate as chestTypes.ChestSlotAction, remainSeconds: 3600 };
    const content = await page.chestDetailContentOf(detail);
    assert.equal(content.openCountdown, '01:00:00');
    assert.equal(content.openEnabled, true);
    assert.equal(content.openSpeedUp, false, '未激活 ⇒ 黄色底、不带播放 icon');
    // 🔴 2026-11-09 用户：「详情弹窗也一起改成『解锁』，跟栏位保持一致」。
    //    未激活时这颗按钮点下去是**启动倒计时**，写「打开」会让人以为直接开箱。
    assert.equal(content.openCaption, '解锁', '未激活 ⇒ 与宝箱栏那颗按钮同一个文案');
    // 等完了才是「开启」（判据与栏位共用 `chestActionCaption`，两处不许各写一份）。
    const ready = await page.chestDetailContentOf({
        ...detail, action: chestTypes.ChestSlotAction.Open, remainSeconds: 0,
    });
    assert.equal(ready.openCaption, '开启');
    assert.equal(ready.openEnabled, true);
    assert.equal(ready.openSpeedUp, false, '等完了可开 ⇒ 黄色底、不带播放 icon');
    // 🔴 2026-11-09 用户第二轮：「点击解锁中的宝箱，宝箱详情中的开启按钮用加速按钮替换」——
    //    等待中（格上有倒计时）这颗按钮与栏位一样写「加速」。
    //    ⚠️ 仍是禁用态：服务端只有 InfoList/Activate/FastOpen/Open，没有"加速"命令，
    //    接上广告位或新协议后才把 `openEnabled` 打开。
    const waiting = await page.chestDetailContentOf({
        ...detail, action: chestTypes.ChestSlotAction.SpeedUp, remainSeconds: 11,
    });
    assert.equal(waiting.openCaption, '加速', '等待中 ⇒ 与栏位同写「加速」，不许还写「开启」');
    assert.equal(waiting.openSpeedUp, true, '2026-11-11：加速态 ⇒ 弹窗换绿底 + 文案前播放 icon');
    assert.equal(waiting.openEnabled, false, '没有加速协议 ⇒ 这颗仍是禁用（别给玩家一颗点不动的假按钮）');
    assert.equal(waiting.openCountdown, '00:00:11', '禁用也要显示还要等多久');
    const updates: unknown[][] = [];
    let closeCount = 0;
    setPanel({ updateCountdown: (...args) => updates.push(args), close: () => { closeCount++; } });
    page.detailSlot = 1;
    page.treasureRepository = { activate: async () => { detail.action = chestTypes.ChestSlotAction.SpeedUp; return 'ok'; },
        detailOf: () => detail };
    await page.runTreasureAction('activate');
    assert.equal(page.detailSlot, 1);
    assert.equal(closeCount, 0);
    // 🔴 2026-11-11 用户：「点击解锁后，详情的按钮也要同步刷新」。
    //    第三个参数把当前槽位的文案与加速态一起下发，弹窗才会从黄色「解锁」
    //    切成绿色「加速」+ 播放 icon；只传倒计时会停在旧态。
    // 页面跑在 `runInNewContext` 沙箱里，第三个参数是跨 realm 的对象，
    // `deepStrictEqual` 会因原型不同判红 ⇒ 按值序列化后再比。
    assert.deepEqual(JSON.parse(JSON.stringify(updates)),
        [[3600, true, { caption: '加速', speedUp: true }]]);
    assert.equal(page.detailAction, chestTypes.ChestSlotAction.SpeedUp);
});

test('宝箱队列变化立即同步刷新详情按钮，不等下一秒 tick', async () => {
    const { page, setPanel } = createPage();
    let onChange: (() => void) | null = null;
    const updates: unknown[][] = [];
    setPanel({ updateCountdown: (...args) => updates.push(args), close: () => {} });
    page.detailSlot = 1;
    page.treasureRepository = {
        load: async (_caller: unknown, cb: () => void) => { onChange = cb; return 'ok'; },
        slots: [],
        detailOf: () => ({ action: chestTypes.ChestSlotAction.SpeedUp, remainSeconds: 12 }),
    };
    await page.loadTreasureQueue();
    assert.ok(onChange, '队列必须注册变化回调');
    // 激活回包 / 服务端广播到点就刷；旧实现这个回调只 renderChests，弹窗要等下一次 1s tick。
    onChange!();
    assert.deepEqual(JSON.parse(JSON.stringify(updates)),
        [[12, true, { caption: '加速', speedUp: true }]],
        '变化回调必须带上当前文案与加速态，详情按钮才不会停在黄色「解锁」');
});

test('详情图标和品质框持有独立资源作用域，页面销毁后释放', async () => {
    const { page, context, composition } = createPage();
    const frame = { isValid: true, refs: 0 };
    Object.assign(context.assets, { load: async (_path: string, _type: unknown, options: { scope?: ResourceScope }) => {
        assert.ok(options.scope, '缓存的 SpriteFrame 必须持有资源作用域');
        frame.refs++;
        options.scope.defer(() => { frame.refs--; });
        return frame;
    } });
    assert.equal(await page.loadChestFrame('image/item'), frame);
    assert.equal(await page.loadChestFrame('image/item'), frame);
    assert.equal(frame.refs, 1);
    composition.dispose();
    page.onDestroy();
    assert.equal(frame.refs, 0);
});
