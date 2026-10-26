import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness() {
    const source = ts.createSourceFile('ZCGame.ts', readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ZCGame') as ts.ClassDeclaration;
    const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'onHudOpenGuide')!;
    const leaving = declaration.members.find(node => ts.isGetAccessorDeclaration(node) && node.name.getText(source) === 'leaving')!;
    const exports: Record<string, any> = {}; let opens = 0, closes = 0;
    let finishContent!: (value: object) => void; let finishPopup!: (value: object) => void;
    const content = new Promise(resolve => { finishContent = resolve; });
    runInNewContext(ts.transpileModule(`export class Harness { ${leaving.getText(source)} ${method.getText(source)} }`, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText, { exports, console, ZCDC_LOG_WARNINGS: false, PopupCloseReason: { Force: 'force' },
        ZCGuidePanel: { open: () => { opens++; return new Promise(resolve => { finishPopup = resolve; }); } },
    });
    const game = new exports.Harness(); game.isValid = true; game.phase = { isLeaving: false };
    game.preparedResources = { loadGuide: () => content };
    return { game, finishContent, finishPopup: () => finishPopup({ close: () => { closes++; } }), get opens() { return opens; }, get closes() { return closes; } };
}

test('指南内容加载期间离场或换局，不创建迟到弹窗', async () => {
    for (const replace of [false, true]) {
        const h = harness(); const opening = h.game.onHudOpenGuide();
        if (replace) h.game.preparedResources = {}; else h.game.phase.isLeaving = true;
        h.finishContent({ entries: [] }); await opening; assert.equal(h.opens, 0);
    }
});

test('指南弹窗加载期间离场，迟到弹窗立即关闭', async () => {
    const h = harness(); const opening = h.game.onHudOpenGuide();
    h.finishContent({ entries: [] }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.opens, 1);
    h.game.phase.isLeaving = true; h.finishPopup(); await opening; assert.equal(h.closes, 1);
});


test('Cocos 已销毁并清空 phase 后，指南迟到完成仍安全结束', async () => {
    const h = harness(); const opening = h.game.onHudOpenGuide();
    h.game.isValid = false; h.game.phase = null;
    h.finishContent({ entries: [] }); await assert.doesNotReject(opening); assert.equal(h.opens, 0);
});
