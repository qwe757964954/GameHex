import assert from 'node:assert/strict';
import test from 'node:test';
import { PopupCompositionHost } from '../assets/script/framework/ui/PopupCompositionHost';
function deferred() { let resolve: () => void = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
test('composition host awaits first presentation; each open owns one session and disposes once', async () => {
    const gate = deferred(), view = {}, values: unknown[] = []; let disposed = 0;
    const host = new PopupCompositionHost(() => ({ open: value => { values.push(value); return gate.promise; }, dispose() { disposed++; } }));
    let ready = false; const open = host.open(view, { hero: 1 }).then(value => { ready = value; });
    await Promise.resolve(); assert.equal(ready, false); gate.resolve(); await open;
    assert.equal(ready, true); host.close(view); host.close(view); assert.equal(disposed, 1);
    await host.open(view, 2); host.dispose(); assert.equal(disposed, 2); assert.equal(values.length, 2);
});
test('closing a pending composition settles open immediately and cannot affect a reopened instance', async () => {
    const gates = [deferred(), deferred()]; let created = 0, disposed = 0;
    const host = new PopupCompositionHost(() => { const gate = gates[created++]; return { open: () => gate.promise, dispose() { disposed++; } }; });
    const view = {}, old = host.open(view, null); host.close(view);
    assert.equal(await old, false); const next = host.open(view, null);
    gates[0].resolve(); await Promise.resolve(); assert.equal(disposed, 1);
    gates[1].resolve(); assert.equal(await next, true); host.dispose(); host.dispose(); assert.equal(disposed, 2);
});
test('factory or opening failure releases the session; unrelated views are isolated', async () => {
    let disposed = 0;
    const bad = {}, good = {};
    const host = new PopupCompositionHost(view => ({ open: async () => { if (view === bad) throw new Error('bad'); }, dispose() { disposed++; } }));
    await assert.rejects(host.open(bad, null), /bad/); assert.equal(disposed, 1);
    assert.equal(await host.open(good, null), true); host.close(bad); assert.equal(disposed, 1); host.dispose(); assert.equal(disposed, 2);
    const missing = new PopupCompositionHost(() => null); assert.equal(await missing.open({}, null), true);
});
