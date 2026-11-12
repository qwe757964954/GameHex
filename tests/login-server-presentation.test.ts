import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ServerStatus } from '../assets/script/app/login/LoginProtocol';

test('pooled server row resets its frame, mark, status text and dot for each server', () => {
    const exports: Record<string, any> = {};
    class Color { constructor(public r: number, public g: number, public b: number, public a: number) {} }
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/login/ServerSelectItem.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { _decorator: { ccclass: () => (v: unknown) => v, property: () => () => {} },
            Color, Component: class {}, Sprite: class {}, SpriteFrame: class {}, Node: class {}, Label: class {}, Button: class {} };
        if (name === './LoginProtocol') return { ServerStatus };
        return {};
    } });
    const row = new exports.ServerSelectItem();
    Object.assign(row, { node: {}, background: {}, statusDot: {}, selectedMark: {}, nameLabel: {}, statusLabel: {},
        normalFrame: {}, selectedFrame: {}, disabledFrame: {} });
    for (const [status, selected, frame, mark, text, rgb] of [
        [ServerStatus.Recommend, true, row.selectedFrame, true, '流畅', [132, 220, 67]],
        [ServerStatus.Maintenance, true, row.disabledFrame, false, '维护', [145, 145, 145]],
        [ServerStatus.Full, false, row.normalFrame, false, '爆满', [242, 90, 80]],
        [ServerStatus.New, false, row.normalFrame, false, '新服', [248, 205, 78]],
        [ServerStatus.Recommend, false, row.normalFrame, false, '流畅', [132, 220, 67]],
    ] as const) {
        row.initialize({ serverId: '3', name: '测试服', status }, selected, {});
        assert.equal(row.background.spriteFrame, frame);
        assert.equal(row.selectedMark.active, mark);
        assert.equal(row.statusLabel.string, text);
        assert.equal(row.nameLabel.string, '测试服');
        assert.deepEqual([row.statusDot.color.r, row.statusDot.color.g, row.statusDot.color.b], rgb);
        assert.equal(row.statusLabel.color, row.statusDot.color);
    }
});
