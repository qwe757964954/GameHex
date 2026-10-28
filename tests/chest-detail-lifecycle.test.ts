import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as chestTypes from '../assets/script/app/main/ChestTypes';

function createPage() {
    let panel: { updateCountdown: (...args: unknown[]) => void; close: () => void } | null = null;
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/MainPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Repository { dispose() {} }
    runInNewContext(code, { exports, console, require: (name: string) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class {}, SpriteFrame: class {} };
        if (name === '../../core/asset/ResourceScope') return { ResourceScope };
        if (name === './ChestTypes') return chestTypes;
        if (name === './NewTreasureRepository') return { NewTreasureRepository: Repository };
        if (name === '../../framework/ui/PopupManager') return { PopupManager: { inst: { get: () => panel } } };
        if (name === '../ArtPaths') return { spriteFramePathOf: (s: string) => `${s}/spriteFrame` };
        if (name === '../itemdetail/ItemDetailTable') return { qualityNameOf: () => '精良', qualityFrameSuffixOf: () => '01' };
        if (name === '../itemdetail/ItemDetailArt') return { qualityFrameArtPath: () => 'frame' };
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { offTarget() {} } } };
        if (name === '../net/GameNet') return { GameNet: { instance: { removeCaller() {} } } };
        return {};
    } });
    const page = new exports.MainPage();
    page.isValid = true;
    return { page, setPanel: (value: typeof panel) => { panel = value; } };
}

test('未激活宝箱显示配置等待时长并允许开启，激活后立即刷新倒计时', async () => {
    const { page, setPanel } = createPage();
    page.loadChestFrame = async () => null;
    page.loadQualityFrame = async () => null;
    const detail = { name: '宝箱', quality: 1, icon: '', rewards: [], fastOpenCost: 10,
        action: chestTypes.ChestSlotAction.Activate, remainSeconds: 3600 };
    const content = await page.chestDetailContentOf(detail);
    assert.equal(content.openCountdown, '01:00:00');
    assert.equal(content.openEnabled, true);
    const updates: unknown[][] = [];
    let closeCount = 0;
    setPanel({ updateCountdown: (...args) => updates.push(args), close: () => { closeCount++; } });
    page.detailSlot = 1;
    page.treasureRepository = { activate: async () => { detail.action = chestTypes.ChestSlotAction.SpeedUp; return 'ok'; },
        detailOf: () => detail };
    await page.runTreasureAction('activate');
    assert.equal(page.detailSlot, 1);
    assert.equal(closeCount, 0);
    assert.deepEqual(updates, [[3600, true]]);
    assert.equal(page.detailAction, chestTypes.ChestSlotAction.SpeedUp);
});

test('详情图标和品质框持有独立资源作用域，页面销毁后释放', async () => {
    const { page } = createPage();
    const frame = { isValid: true, refs: 0 };
    page.initialize({ load: async (_path: string, _type: unknown, options: { scope?: ResourceScope }) => {
        assert.ok(options.scope, '缓存的 SpriteFrame 必须持有资源作用域');
        frame.refs++;
        options.scope.defer(() => { frame.refs--; });
        return frame;
    } });
    assert.equal(await page.loadChestFrame('image/item'), frame);
    assert.equal(await page.loadChestFrame('image/item'), frame);
    assert.equal(frame.refs, 1);
    page.onDestroy();
    assert.equal(frame.refs, 0);
});
