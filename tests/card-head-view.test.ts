import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Sprite, SpriteFrame, UITransform } from 'cc';
import { applyCardHeroArt } from '../assets/script/app/card/CardHeroView';
import type { ZCDeckCard } from '../assets/script/app/zcds/model/ZCCombatCatalog';

function fixture() {
    const transform = { width: 133, height: 133 };
    const scale = { x: 0.85, y: 0.85, z: 1 };
    let current: SpriteFrame | null = null;
    const hero = {
        sizeMode: 0, trim: true, enabled: false,
        node: { active: false, scale, setScale: (x: number, y: number, z: number) => Object.assign(scale, { x, y, z }) },
        get spriteFrame() { return current; },
        set spriteFrame(value: SpriteFrame | null) {
            current = value;
            if (value && this.sizeMode === 2) Object.assign(transform, value.originalSize);
        },
    };
    return { hero: hero as unknown as Sprite, transform: transform as UITransform };
}
const frame = (width: number, height: number) => ({ originalSize: { width, height } } as SpriteFrame);

test('角色立绘反复复用：方图与宽图保持原始比例、展示尺寸和显隐', () => {
    const { hero, transform } = fixture();
    for (const art of [frame(256, 256), frame(390, 300), frame(300, 300)]) {
        applyCardHeroArt(hero, transform, art);
        assert.equal(hero.spriteFrame, art);
        assert.equal(hero.enabled, true);
        assert.equal(hero.node.active, true);
        assert.equal(hero.trim, false);
        assert.equal(hero.sizeMode, 2);
        assert.equal(hero.node.scale.x, hero.node.scale.y);
        assert.equal(transform.width / transform.height, art.originalSize.width / art.originalSize.height);
        assert.ok(Math.abs(Math.max(transform.width * hero.node.scale.x, transform.height * hero.node.scale.y) - 133 * 0.85) < 1e-8);
    }
    applyCardHeroArt(hero, transform, null);
    assert.equal(hero.spriteFrame, null, '缺图必须清空复用项，不能残留上一张卡');
    assert.equal(hero.enabled, true, '静态展示须从骨骼隐藏 Sprite 的状态恢复');
});

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
        assert.equal(items[script.heroTransform.__id__], transform);
        assert.equal(sprite._isTrimmedMode, false);
        assert.equal(transform._contentSize.width, transform._contentSize.height);
        assert.equal(hero._lscale.x, hero._lscale.y);
        assert.equal(items.filter(item => item.__type__ === 'cc.Node').every(item => item._layer === 33554432), true);
    });
}
