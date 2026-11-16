import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('CardLineupPage.ts', readFileSync(
    'assets/script/app/card/CardLineupPage.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const page = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CardLineupPage') as ts.ClassDeclaration;
const method = page.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'revealGuideCard');
assert.ok(method, '卡牌页需要交付虚拟列表中的引导目标，不能只查当前可见节点');
const exports: { reveal?: (this: object, id: string) => void } = {};
runInNewContext(ts.transpileModule(`exports.reveal = class { ${method.getText(source)} }.prototype.revealGuideCard;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });

test('目标卡牌按当前排序定位；等数据就绪后重试，轮询不反复滚动，排序变化后重新定位', () => {
    const calls: unknown[][] = [];
    const host = { poolCards: [] as { id: string }[], guideCardIndex: -1,
        cardGrid: { scrollToIndex: (...args: unknown[]) => calls.push(args) } };
    const reveal = (id: string) => exports.reveal!.call(host, id);
    reveal('68001');
    assert.equal(calls.length, 0);
    host.poolCards = [{ id: '68008' }, { id: '68001' }];
    reveal('68001');
    assert.deepEqual(calls, [[1, false, undefined, undefined, true]]);
    reveal('68001');
    reveal('99999');
    assert.equal(calls.length, 1);
    host.poolCards.reverse();
    reveal('68001');
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0], 0);
});
