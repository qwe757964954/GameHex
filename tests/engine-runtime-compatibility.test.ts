import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import * as ts from 'typescript';
import { Vec2 } from '../assets/script/engine/Vec2';

function methods(path: string, className: string, names: string[]): string {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    assert.ok(declaration && ts.isClassDeclaration(declaration));
    return names.map(name => {
        const method = declaration.members.find(member => member.name?.getText(source) === name);
        assert.ok(method && ts.isMethodDeclaration(method));
        return method.getText(source);
    }).join('\n');
}

test('Cocos 3.8 时间采用毫秒，帧号由 director 提供', () => {
    const body = methods('assets/script/framework/ecs/World.ts', 'World', ['GetCurTime']);
    const frames = methods('assets/script/engine/EngineMain.ts', 'EngineMain', ['getTotalFrames']);
    const scope = { game: { totalTime: 1234 }, director: { getTotalFrames: () => 42 }, exports: {} as Record<string, any> };
    runInNewContext(ts.transpileModule(`class WorldProbe { ${body} } class EngineProbe { ${frames} }
        exports.now = new WorldProbe().GetCurTime(); exports.frames = EngineProbe.getTotalFrames();`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, scope);
    assert.equal(scope.exports.now, 1234);
    assert.equal(scope.exports.frames, 42);
});

test('帧计时器首轮等待完整间隔，重复执行到次数后停止', () => {
    let frame = 100;
    let fired = 0;
    const source = methods('assets/script/framework/utils/FrameTimer.ts', 'FrameTimer', ['init', 'update']);
    const scope = { director: { getTotalFrames: () => frame }, exports: {} as Record<string, any> };
    runInNewContext(ts.transpileModule(`class TimerProbe { ${source} } exports.TimerProbe = TimerProbe;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, scope);
    const timer = new scope.exports.TimerProbe();
    const caller = { count: 0 };
    timer.init(function (this: typeof caller) { this.count += 1; fired += 1; }, caller, 3, 2);
    timer.running = true;
    timer.stop = () => { timer.running = false; };
    timer.update();
    frame = 102; timer.update();
    assert.equal(fired, 0);
    frame = 103; timer.update();
    assert.equal(fired, 1);
    frame = 105; timer.update();
    assert.equal(fired, 1);
    frame = 106; timer.update();
    assert.equal(fired, 2);
    assert.equal(caller.count, 2);
    assert.equal(timer.running, false);
    frame = 109; timer.update();
    assert.equal(fired, 2);
});

test('纯 Vec2 的限幅和夹角不依赖已移除的 cc.misc', () => {
    const vector = new Vec2(-3, 9);
    assert.equal(vector.clampf(new Vec2(0, 1), new Vec2(5, 6)), vector);
    assert.deepEqual([vector.x, vector.y], [0, 6]);
    assert.equal(new Vec2(1, 0).angle(new Vec2(1, 0)), 0);
    assert.equal(new Vec2(1, 0).angle(new Vec2(-1, 0)), Math.PI);
    assert.equal(new Vec2(1, 0).angle(new Vec2(0, 1)), Math.PI / 2);
});
