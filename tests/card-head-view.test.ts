import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
for (const name of ['CardLineupCard', 'LineupSlot', 'LineupBoardCard', 'LineupBoardSlot', 'CardUpgrade']) {
    test(`${name}：仅保留角色立绘，Inspector 正确绑定展示框`, () => {
        const items = JSON.parse(readFileSync(`assets/bundles/main-pages/ui/card/${name}.prefab`, 'utf8'));
        assert.equal(items.some(item => item.__type__ === 'cc.Node' && item._name === 'HeadIcon'), false);
        assert.equal(items.some(item => 'headIcon' in item || 'cardHeadIcon' in item), false);
        const hero = items.find(item => item.__type__ === 'cc.Node' && item._name === 'Hero');
        const components = hero._components.map(ref => items[ref.__id__]);
        const transform = components.find(item => item.__type__ === 'cc.UITransform');
        const sprite = components.find(item => item.__type__ === 'cc.Sprite');
        const root = items[items[0].data.__id__];
        const script = root._components.map(ref => items[ref.__id__]).find(item => !item.__type__.startsWith('cc.'));
        assert.equal('heroTransform' in script, false);
        assert.equal(sprite._sizeMode, 2);
        const expectedScale = { CardLineupCard: 0.4, LineupSlot: 0.5, LineupBoardCard: 0.3, LineupBoardSlot: 0.4, CardUpgrade: 318 / 390 };
        assert.equal(hero._lscale.x, expectedScale[name]);
        assert.equal(sprite._enabled, true);
        assert.equal(hero._active, true);
        assert.equal(sprite._isTrimmedMode, false);
        assert.equal(transform._contentSize.width, name === 'CardUpgrade' ? 365 : transform._contentSize.height);
        assert.ok(transform._contentSize.height > 0);
        assert.equal(hero._lscale.x, hero._lscale.y);
        assert.equal(items.filter(item => item.__type__ === 'cc.Node').every(item => item._layer === 33554432), true);
    });
}
