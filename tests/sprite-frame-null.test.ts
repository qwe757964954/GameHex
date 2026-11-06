/**
 * `spriteFrame = null` 是「压根不渲染」，不是透明图（代码审查规范 §4）。
 *
 * 真源契约：`assets/script/platform/cocos/SpriteFrameGuard.ts` 头注写明
 * 「`Batcher2D` 会跳过空帧」，所以置空是让渲染器跳过该 Sprite 的手段。
 * 典型误用：把 `spriteFrame = null` 当成「画一张透明图」继续走渲染分支，
 * 或者清空后忘了异步现赋 ⇒ 整块 UI 永久空白，零报错。
 *
 * E2/E3 走真实函数 `findDeadSpriteFrames()` 的行为探针（不复制算法），
 * E4/E5 钉住 `RewardItemView.ts`「先清空、后异步恢复」的成对模式。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..');
const GUARD = 'assets/script/platform/cocos/SpriteFrameGuard.ts';
const REWARD_VIEW = 'assets/script/app/common/RewardItemView.ts';

interface IFakeFrame { texture: unknown; name: string; }
interface IFakeSprite { spriteFrame: IFakeFrame | null; }
interface IFakeNode {
    name: string;
    isValid: boolean;
    parent: IFakeNode | null;
    children: IFakeNode[];
    sprite?: IFakeSprite;
    getComponent(ctor: unknown): IFakeSprite | null;
}

/** 用工程既有的「转译 + require 桩」夹具装载真源模块。 */
function loadGuard(scene: IFakeNode, SpriteKey: unknown): Record<string, any> {
    const source = readFileSync(join(ROOT, GUARD), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const cc = {
        director: { getScene: () => scene },
        Node: class CocosNode {},
        Sprite: SpriteKey,
    };
    const loaded = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        if (name === 'cc') return cc;
        if (name === 'cc/env') return { DEBUG: true };
        throw new Error(`未预期的依赖：${name}`);
    }, loaded, loaded.exports);
    return loaded.exports;
}

function makeNode(name: string, parent: IFakeNode | null, sprite?: IFakeSprite, SpriteKey?: unknown): IFakeNode {
    const node: IFakeNode = {
        name,
        isValid: true,
        parent,
        children: [],
        sprite,
        getComponent(ctor: unknown) {
            return ctor === SpriteKey ? (node.sprite ?? null) : null;
        },
    };
    if (parent) parent.children.push(node);
    return node;
}

/** 模拟 Batcher2D：空帧整条跳过，坏帧进队列就抛。 */
function drawPass(nodes: IFakeNode[], SpriteKey: unknown): string[] {
    const drawn: string[] = [];
    for (const node of nodes) {
        const sprite = node.getComponent(SpriteKey);
        const frame = sprite?.spriteFrame;
        if (!frame) continue;
        if (!frame.texture) throw new Error('坏帧进了绘制队列 ⇒ 整屏渲染崩');
        drawn.push(frame.name);
    }
    return drawn;
}

function buildScene(SpriteKey: unknown) {
    const root = makeNode('Scene', null, undefined, SpriteKey);
    const good = makeNode('GoodIcon', root, { spriteFrame: { texture: {}, name: 'ok.png' } }, SpriteKey);
    const bad = makeNode('BadIcon', root, { spriteFrame: { texture: null, name: 'released.png' } }, SpriteKey);
    return { root, good, bad, nodes: [root, good, bad] };
}

test('E1 真源语义契约：置空是跳过渲染的手段，不是画透明图', () => {
    const source = readFileSync(join(ROOT, GUARD), 'utf8');
    assert.match(source, /Batcher2D[^\n]*跳过空帧/, '语义契约注释被删了，需要先确认新的渲染口径');
    const clearAt = source.indexOf('sprite.spriteFrame = null');
    const deadAt = source.indexOf('!frame.texture');
    assert.ok(deadAt >= 0 && clearAt > deadAt,
        '置空必须发生在「检测到坏帧」之后；挪到常规渲染路径会变成整片空白');
});

test('E2 行为探针：坏帧被点名并置空，好帧不受影响', () => {
    const SpriteKey = class PreviewSprite {};
    const scene = makeNode('Scene', null, undefined, SpriteKey);
    const good = makeNode('GoodIcon', scene, { spriteFrame: { texture: {}, name: 'ok.png' } }, SpriteKey);
    const bad = makeNode('BadIcon', scene, { spriteFrame: { texture: null, name: 'released.png' } }, SpriteKey);
    const guard = loadGuard(scene, SpriteKey);

    const hits = (guard.findDeadSpriteFrames as () => { path: string; frame: string }[])();
    assert.equal(hits.length, 1, `应只命中一个坏帧，实际 ${hits.length}`);
    assert.match(hits[0].path, /BadIcon/);
    assert.equal(hits[0].frame, 'released.png');
    assert.equal(bad.sprite!.spriteFrame, null, '坏帧必须被置空');
    assert.ok(good.sprite!.spriteFrame, '好帧不能被误伤');
});

test('E3 行为探针：置空后渲染器跳过它；不置空的对照组会崩（null ≠ 透明图）', () => {
    const SpriteKey = class PreviewSprite {};
    const { root, good, bad, nodes } = buildScene(SpriteKey);
    assert.throws(() => drawPass(nodes, SpriteKey), /坏帧进了绘制队列/,
        '对照组必须先崩，否则这个探针证明不了任何事');

    const guard = loadGuard(root, SpriteKey);
    (guard.findDeadSpriteFrames as () => unknown[])();
    assert.equal(bad.sprite!.spriteFrame, null);
    assert.deepEqual(drawPass(nodes, SpriteKey), ['ok.png'],
        '空帧必须整条跳过绘制；若还画出来，说明把 null 当成透明图用了');
    assert.ok(good.sprite!.spriteFrame);
});

test('E4 成对守卫：RewardItemView 清空后必须异步现赋，且顺序不能反', () => {
    const source = readFileSync(join(ROOT, REWARD_VIEW), 'utf8');
    const clearAt = source.indexOf('this.frame.spriteFrame = null');
    const callAt = source.indexOf('void this.applyFrames(data.resId)');
    assert.ok(clearAt >= 0, 'render 里必须先清空旧帧（否则虚拟列表回收会闪上一条物品的图）');
    assert.ok(callAt > clearAt, '先清空再异步恢复；只留清空就是永久空白');
    assert.match(source, /this\.frame\.spriteFrame = qualityFrame;/);
    assert.match(source, /this\.icon\.spriteFrame = iconFrame;/);
});

test('E5 显式空值处理：iconFrame 为 null 时必须隐藏节点，不能留给渲染器', () => {
    const source = readFileSync(join(ROOT, REWARD_VIEW), 'utf8');
    assert.match(source, /this\.icon\.node\.active = iconFrame !== null/,
        '这条是「null 不渲染」在视图层的显式表达，删掉就退化成空白格');
    const asyncReturns = (source.match(/currentResId !== resId\) return;/g) || []).length;
    assert.equal(asyncReturns, 2, '加载前 / 加载后各要判一次复用，否则异步恢复会贴到别的格子上');
});
