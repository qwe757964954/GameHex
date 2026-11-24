/**
 * 角色页「战斗力」的标题位必须是卡牌页同款战力图标（`icon_zhanli`），不能再是「战斗力」文字。
 *
 * 2026-11-24 用户：「战斗力文字 使用卡牌那边的战力icon」。
 * 口径同步：角色页数值来自 `cardRepository.loadLineupPower`（见 role-lineup-power.test.ts），
 * 标题图标直接复用卡牌页 `PowerIcon` 的 SpriteFrame，避免两处美术再分叉。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assetPath } from './helpers/asset-paths';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const loadPrefab = (path: string): Raw[] => JSON.parse(readFileSync(path, 'utf8')) as Raw[];

function findNode(objects: Raw[], name: string): Raw {
    const found = objects.find((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.ok(found, `prefab 里找不到节点 ${name}`);
    return found as Raw;
}

function componentOf(objects: Raw[], host: Raw, type: string): Raw | null {
    for (const ref of host._components ?? []) {
        const component = objects[ref.__id__];
        if (component.__type__ === type) return component;
    }
    return null;
}

function transformOf(objects: Raw[], host: Raw): Raw {
    const transform = componentOf(objects, host, 'cc.UITransform');
    assert.ok(transform, `${host._name} 没有 UITransform`);
    return transform as Raw;
}

/** 节点在父节点坐标系里的左沿（anchor 以左为 0 折算）。 */
function leftOf(objects: Raw[], host: Raw): number {
    const transform = transformOf(objects, host);
    return Number(host._lpos.x) - Number(transform._contentSize.width) * Number(transform._anchorPoint.x);
}

test('角色页战斗力标题用卡牌页同款 icon_zhanli，且紧挨数值左侧', () => {
    const role = loadPrefab(assetPath('ui/Role/Role.prefab'));
    const card = loadPrefab(assetPath('ui/card/CardLineup.prefab'));

    const roleIcon = findNode(role, 'PowerIcon');
    const cardIcon = findNode(card, 'PowerIcon');
    const roleSprite = componentOf(role, roleIcon, 'cc.Sprite');
    const cardSprite = componentOf(card, cardIcon, 'cc.Sprite');
    assert.ok(roleSprite, 'PowerIcon 必须挂 cc.Sprite');
    assert.ok(cardSprite, '卡牌页 PowerIcon 必须挂 cc.Sprite');
    assert.equal(
        roleSprite!._spriteFrame.__uuid__,
        cardSprite!._spriteFrame.__uuid__,
        '角色页战力图标必须与卡牌页同一 SpriteFrame（icon_zhanli）',
    );
    assert.equal(roleIcon._active, true, 'PowerIcon 不能被隐藏');

    // 文字标题已退场，改成图标后不应再残留「战斗力」Label。
    const text = role.find((item) => item.__type__ === 'cc.Label' && item._string === '战斗力');
    assert.equal(text, undefined, '「战斗力」文字已被图标替换');

    // 图标与数值不重叠，且图标在左。
    const iconRight = leftOf(role, roleIcon) + Number(transformOf(role, roleIcon)._contentSize.width);
    const valueLeft = leftOf(role, findNode(role, 'PowerValue'));
    assert.ok(iconRight <= valueLeft, `图标右沿 ${iconRight} 必须不超过数值左沿 ${valueLeft}`);
});
