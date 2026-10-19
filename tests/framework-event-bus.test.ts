/**
 * `framework/event/EventBus` 的单测（纯 TS 派发器）。
 *
 * 为什么单独测它：它现在是**界面意图契约的唯一派发机制**（`ZCGameUiEvent` 那 8 个事件都走它），
 * 而且它的语义有几条是"看不见但会咬人"的 —— 幂等订阅、遍历前拷贝、target 决定 `this`。
 * 这里不碰 `cc`（该模块零依赖），所以能直接 import。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventBus } from '../assets/script/framework/event/EventBus';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

enum E {
    A = 'a',
    B = 'b',
}


test('EventBus：只打给订阅了该事件的监听，回调里的 this 由 target 决定', () => {
    const bus = new EventBus<E>();
    const seen: string[] = [];
    const holder = { tag: 'T' };
    const handler = function (this: { tag: string }) { seen.push(`A:${this.tag}`); };
    bus.on(E.A, handler, holder);
    bus.on(E.B, () => seen.push('B'));

    bus.emit(E.A);
    assert.deepEqual(seen, ['A:T'], 'target 必须成为回调里的 this');
    bus.emit(E.B);
    assert.deepEqual(seen, ['A:T', 'B'], '不同事件互不串台');
});

test('EventBus：同一 (事件, 函数, target) 重复 on 只留一份；target 不同算两份', () => {
    const bus = new EventBus<E>();
    let hits = 0;
    const handler = () => { hits += 1; };

    bus.on(E.A, handler);
    bus.on(E.A, handler);
    bus.emit(E.A);
    assert.equal(hits, 1, '★幂等：视图支持重复 initialize，叠成两份就是「点一下走两遍」');

    // 同一个函数挂在另一个宿主上是**两件事**（target 参与身份判定）⇒ 这一次派发两份都跑：
    // 无 target 那份 + 新宿主那份 ⇒ 累计 1 + 2 = 3。
    bus.on(E.A, handler, {});
    bus.emit(E.A);
    assert.equal(hits, 3, 'target 不同算两份（同一个函数可以同时挂多个宿主）');
});

test('EventBus：off 精确注销；没订阅 / 重复注销时 emit 都不抛', () => {
    const bus = new EventBus<E>();
    let hits = 0;
    const target = {};
    const handler = () => { hits += 1; };

    bus.on(E.A, handler, target);
    bus.off(E.A, handler, target);
    bus.emit(E.A);
    assert.equal(hits, 0, 'off 必须真的摘掉');
    bus.emit(E.B);
    assert.equal(hits, 0, '没人订阅的事件应当静默返回');
    bus.off(E.A, handler, target);
    assert.equal(hits, 0, '重复 off 不该抛');
});

test('EventBus：派发中新增的监听不会被本次触发（遍历前拷贝）', () => {
    const bus = new EventBus<E>();
    const seen: string[] = [];
    const late = () => seen.push('late');
    bus.on(E.A, () => {
        seen.push('first');
        bus.on(E.A, late);
    });

    bus.emit(E.A);
    assert.deepEqual(seen, ['first'], '★本次不该带上刚订阅的 late');
    bus.emit(E.A);
    assert.deepEqual(seen, ['first', 'first', 'late'], '下一次才轮到它');
});


test('EventBus：offTarget 一次摘掉某个宿主的全部监听（跨事件）', () => {
    const bus = new EventBus<E>();
    const seen: string[] = [];
    const first = { name: 'first' };
    const second = { name: 'second' };
    const onA = function (this: { name: string }) { seen.push(`A:${this.name}`); };
    const onB = function (this: { name: string }) { seen.push(`B:${this.name}`); };
    bus.on(E.A, onA, first);
    bus.on(E.B, onB, first);
    bus.on(E.A, onA, second);

    bus.offTarget(first);
    bus.emit(E.A);
    bus.emit(E.B);
    assert.deepEqual(seen, ['A:second'], '★first 的两条都要没；second 那条要留');
});

test('EventMgr：全局单例 + on/emit/offTarget（订阅方销毁必须摘自己）', () => {
    assert.equal(EventMgr.instance, EventMgr.instance, 'instance 必须是同一个');
    const mgr = EventMgr.instance;
    const seen: string[] = [];
    const host = { tag: 'h' };
    const handler = function (this: { tag: string }) { seen.push(`hit:${this.tag}`); };
    mgr.on('demo', handler, host);
    mgr.emit('demo');
    assert.deepEqual(seen, ['hit:h']);
    // 控制器在 `shutdown` 里就是这么摘的：不摘的话旧实例跨局累积（泄漏 + 幽灵回调）。
    mgr.offTarget(host);
    mgr.emit('demo');
    assert.deepEqual(seen, ['hit:h'], 'offTarget 之后不该再被回调');
});
