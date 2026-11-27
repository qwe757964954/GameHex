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
        if (name === 'LineupSlot') {
            // 2026-11-25：台座要「以角色的底位置对齐底座中心」，而全身立绘在 256 画布里
            // 自带透明留白（35 张的 trimY 是 1~49px，逐张不同）⇒ 只能走 TRIMMED：
            // 节点高度 = 不透明区高度，anchorY=0 时底边天然压在台座中心。
            // 其余四处是卡面 / 布阵 / 升级，仍是 RAW 正方形，别一起改歪。
            assert.equal(sprite._sizeMode, 1);
            assert.equal(sprite._isTrimmedMode, true);
        } else {
            assert.equal(sprite._sizeMode, 2);
            assert.equal(sprite._isTrimmedMode, false);
        }
        const expectedScale = { CardLineupCard: 0.57, LineupSlot: 0.65, LineupBoardCard: 0.3, LineupBoardSlot: 0.4, CardUpgrade: 318 / 390 };
        assert.equal(hero._lscale.x, expectedScale[name]);
        assert.equal(sprite._enabled, true);
        assert.equal(hero._active, true);
        assert.equal(transform._contentSize.width, name === 'CardUpgrade' ? 365 : transform._contentSize.height);
        assert.ok(transform._contentSize.height > 0);
        assert.equal(hero._lscale.x, hero._lscale.y);
        assert.equal(items.filter(item => item.__type__ === 'cc.Node').every(item => item._layer === 33554432), true);
    });
}
