import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGemSockets, getGemChange } from '../assets/script/app/role/RoleTable';
import type { IRoleGemEntry } from '../assets/script/app/role/RoleTypes';

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
