import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleController, type IRoleGemDialog } from '../assets/script/app/role/RoleController';
import { RoleEvent, type IRoleIntent } from '../assets/script/app/role/RoleEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { createControllerContext } from './helpers/controller-context';
import { buildGemSockets, getGemChange } from '../assets/script/app/role/RoleTable';
import type { IRoleGemEntry, RoleGemChange } from '../assets/script/app/role/RoleTypes';

const helmetId = 401111;
const otherId = 401112;
const gemId = '9007199254740993';

test('gem sockets use the selected page, exact gem IDs and one-based socket orders', () => {
    const slots = buildGemSockets(2, helmetId, [
        { page: 1, tlCmdEquip: [{ equipId: helmetId, tlCmdGemInfo: [{ order: 2, gemId: '11' }] }] },
        { page: 2, tlCmdEquip: [
            { equipId: otherId, tlCmdGemInfo: [{ order: 1, gemId: '12' }] },
            { equipId: helmetId, tlCmdGemInfo: [{ order: 4, gemId }, { order: 0, gemId: '13' }] },
        ] },
    ]);
    assert.deepEqual(slots.map(slot => slot.gemId), ['', '', '', gemId, '']);
    assert.deepEqual(slots[3], { page: 2, equipId: helmetId, order: 4, gemId });
    assert.deepEqual(buildGemSockets(3, helmetId, []), []);
});

test('gem requests retain the base equipment ID and only send order for replacement or removal', () => {
    const gem = { count: 2, gemId, equipId: helmetId } as IRoleGemEntry;
    const socket = { page: 2, equipId: helmetId, order: 4, gemId: '' };
    const occupied = { ...socket, gemId: '11' };
    assert.deepEqual(getGemChange([socket], socket, gem), {
        kind: 'on', payload: { equipId: helmetId, page: 2, id: gemId },
    });
    assert.deepEqual(getGemChange([occupied], occupied, gem), {
        kind: 'replace', payload: { equipId: helmetId, page: 2, id: gemId, order: 4 },
    });
    assert.deepEqual(getGemChange([occupied], occupied, null), {
        kind: 'down', payload: { equipId: helmetId, page: 2, order: 4 },
    });
    assert.equal(getGemChange([socket], socket, null), null);
    assert.equal(getGemChange([occupied], socket, gem), null);
    assert.equal(getGemChange([socket], socket, { ...gem, equipId: otherId }), null);
    assert.equal(getGemChange([occupied], occupied, { ...gem, gemId: '11' }), null);
    assert.equal(getGemChange([socket, { ...occupied, order: 5, gemId }], socket, gem), null);
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function roleGemFixture() {
    const owner = {};
    const source = {};
    const dialogs: IRoleGemDialog[] = [];
    const changes: RoleGemChange[] = [];
    const renders: number[] = [];
    const shown: number[] = [];
    const errors: unknown[] = [];
    const choices: Array<(choice: 'confirm' | 'alternate' | null) => void> = [];
    const writes: Array<(status: 'ok' | 'failed') => void> = [];
    const rewardsShown: CmdGoods[][] = [];
    let previewCalls = 0;
    let composeCalls = 0;
    let cancels = 0;
    let loads = 0;
    const socket = { page: 2, equipId: helmetId, order: 4, gemId: '' };
    const gem = {
        kind: 'gem', id: Number(gemId), gemId, equipId: helmetId, resId: 1000000,
        iconKey: '', iconPath: '', name: '头盔宝石', desc: '攻击 +10',
        quality: 5, rank: 0, count: 2, equipped: false, upMark: false,
    } satisfies IRoleGemEntry;
    const controller = new RoleController(createControllerContext(), {
        owner,
        repository: { load: async () => ++loads },
        failed: error => errors.push(error),
        view: {
            render: async snapshot => {
                renders.push(snapshot);
            },
            selectBag() {},
            showBag: async tab => {
                shown.push(tab);
            },
        },
        popups: { openTalent() {} },
        feedback: { tip() {} },
        gems: {
            source: () => source,
            slots: () => [{ partId: 1, entry: null, level: 1, sockets: [socket] }],
            find: id => id === gemId ? gem : null,
            change: change => {
                changes.push(change);
                return new Promise(resolve => writes.push(resolve));
            },
            preview: async () => {
                previewCalls++;
                return { status: 'ok', materials: [{ id: gemId, count: 2 }] };
            },
            compose: async () => {
                composeCalls++;
                return { status: 'ok', rewards: [{ resId: gemId, number: '1' } as unknown as CmdGoods] };
            },
            showRewards: rewards => rewardsShown.push(rewards),
            dialog: data => {
                dialogs.push(data);
                return new Promise(resolve => choices.push(resolve));
            },
            cancel: () => {
                cancels++;
            },
        },
    });
    controller.start();
    return {
        controller, dialogs, changes, renders, shown, errors, choices, writes, rewardsShown, socket,
        counts: () => ({ previewCalls, composeCalls, cancels }),
        emit: (event: IRoleIntent, caller = event.kind === 'compose' ? owner : source) => {
            EventMgr.instance.emit(RoleEvent.Intent, event, caller);
        },
    };
}

test('selecting a socket then confirming a bag gem sends one write and refreshes from the repository', async () => {
    const f = roleGemFixture();
    try {
        f.emit({ kind: 'socket', partId: 1, order: 4 });
        await tick();
        f.emit({ kind: 'gem', id: gemId }, {});
        assert.equal(f.dialogs.length, 0);
        f.emit({ kind: 'gem', id: gemId });
        f.emit({ kind: 'gem', id: gemId });
        assert.equal(f.dialogs.length, 1);
        assert.equal(f.dialogs[0].sureText, '镶嵌');
        f.choices[0]('confirm');
        await tick();
        assert.deepEqual(f.changes, [{ kind: 'on', payload: { equipId: helmetId, page: 2, id: gemId } }]);
        assert.deepEqual(f.renders, []);
        f.writes[0]('ok');
        await tick();
        assert.deepEqual(f.renders, [1]);
        assert.deepEqual(f.shown, [1]);
        assert.deepEqual(f.errors, []);
    } finally {
        f.controller.dispose();
    }
});

test('a gem response received after the role page is disabled cannot refresh the page', async () => {
    const f = roleGemFixture();
    try {
        f.socket.gemId = gemId;
        f.emit({ kind: 'socket', partId: 1, order: 4 });
        f.choices[0]('confirm');
        await tick();
        assert.deepEqual(f.changes, [{ kind: 'down', payload: { equipId: helmetId, page: 2, order: 4 } }]);
        f.controller.cancel();
        f.writes[0]('ok');
        await tick();
        assert.equal(f.counts().cancels, 1);
        assert.deepEqual(f.renders, []);
        assert.deepEqual(f.errors, []);
    } finally {
        f.controller.dispose();
    }
});

test('compose previews server materials, waits for confirmation, then shows rewards and refreshes', async () => {
    const f = roleGemFixture();
    try {
        f.emit({ kind: 'compose' });
        await tick();
        assert.equal(f.counts().previewCalls, 1);
        assert.equal(f.counts().composeCalls, 0);
        assert.match(f.dialogs[0].content, /头盔宝石 × 2/);
        assert.equal(f.dialogs[0].confirmAgainText, '确认合成高品质宝石');
        f.choices[0](null);
        await tick();
        assert.equal(f.counts().composeCalls, 0);
        f.emit({ kind: 'compose' });
        await tick();
        f.choices[1]('confirm');
        await tick();
        assert.equal(f.counts().composeCalls, 1);
        assert.equal(f.rewardsShown.length, 1);
        assert.deepEqual(f.renders, [1]);
        assert.deepEqual(f.errors, []);
    } finally {
        f.controller.dispose();
    }
});
