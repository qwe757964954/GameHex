import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import * as HeadArtModel from '../assets/script/app/HeadArtModel';

test('敌军头像按 icon 表解析资源名与分包路径，加载后刷新已打开的提示', async () => {
    const exports: Record<string, any> = {};
    const opened = { applied: null as any, applyContent(value: unknown) { this.applied = value; } };
    const cc = { Component: class {}, SpriteFrame: class {}, _decorator: { ccclass: () => (x: unknown) => x, property: () => () => {} } };
    const imports: Record<string, unknown> = {
        cc, '../../core/asset/ResourceScope': { ResourceScope }, '../ArtPaths': ArtPaths,
        '../HeadArtModel': HeadArtModel,
        '../../framework/ui/PopupManager': { PopupManager: { inst: { get: () => opened } } },
    };
    const source = ts.transpileModule(readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(source, { exports, console, require: (name: string) => imports[name] ?? {} });
    const page = new exports.MainTerritoryMap();
    const paths: string[] = [];
    const frame = { isValid: true };
    page.isValid = true;
    page.assets = { load: async (path: string) => { paths.push(path); return frame; } };
    page.refRows = async () => [{ key: '兵种_头像_豌豆游侠', path: 'ui://图标_兵种_头像/wandouyouxia' }];
    const content = { title: '关卡', description: '', enemies: [{ headIcon: '兵种_头像_豌豆游侠', name: '豌豆', description: '' }] };
    await page.prefillLevelTipIcons(content);
    assert.deepEqual(paths, ['icons/cardHead/wandouyouxia/spriteFrame']);
    assert.equal(opened.applied.enemies[0].icon, frame);
    page.levelTipIcons.clear();
    opened.applied = null;
    page.levelTipRevision++;
    let finish!: (frame: unknown) => void;
    page.assets.load = () => new Promise((resolve) => { finish = resolve; });
    const pending = page.prefillLevelTipIcons(content);
    await new Promise<void>((resolve) => setImmediate(resolve));
    page.levelTipRevision++;
    finish(frame);
    await pending;
    assert.equal(opened.applied, null, '关闭或切换关卡后，迟到的头像不能覆盖新内容');
});

test('弹窗预加载尚未结束就关闭时，迟到的弹窗不会重新留在屏幕上', async () => {
    const exports: Record<string, any> = {};
    let finish!: (panel: unknown) => void;
    const Tip = { open: () => new Promise((resolve) => { finish = resolve; }) };
    const imports: Record<string, unknown> = {
        cc: { Component: class {}, _decorator: { ccclass: () => (x: unknown) => x, property: () => () => {} } },
        '../../core/asset/ResourceScope': { ResourceScope }, '../ArtPaths': ArtPaths,
        '../HeadArtModel': HeadArtModel, './LevelTipPanel': { LevelTipPanel: Tip },
        '../../framework/ui/PopupManager': { PopupManager: { inst: { get: () => null } } },
    };
    const source = ts.transpileModule(readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(source, { exports, console, require: (name: string) => imports[name] ?? {} });
    const page = new exports.MainTerritoryMap();
    page.isValid = true;
    page.renderLevelTip({ title: '关卡', description: '', enemies: [] });
    page.renderLevelTip(null);
    let closed = 0;
    finish({ close: () => { closed++; } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closed, 1);
});
