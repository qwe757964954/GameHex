import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = 'assets/bundles/battle/units/effects';
const groups = [
    { name: '出生特效', dir: '出生特效/atlas', prefab: '出生特效/出生特效.prefab', count: 25, size: [110, 137], canvas: [266, 330], scale: .4144 },
    { name: '法师受击', dir: '受击特效/法师受击', prefab: '受击特效/法师受击/法师受击.prefab', count: 14, size: [77, 77], canvas: [1377, 1377], scale: .05593 },
    { name: '坦克受击', dir: '受击特效/坦克受击', prefab: '受击特效/坦克受击/坦克受击.prefab', count: 9, size: [77, 65], canvas: [1085, 910], scale: .07098 },
    { name: '射手受击', dir: '受击特效/射手受击', prefab: '受击特效/射手受击/射手受击.prefab', count: 9, size: [77, 72], canvas: [620, 583], scale: .12418 },
    { name: '战士受击', dir: '受击特效/战士受击', prefab: '受击特效/战士受击/战士受击.prefab', count: 9, size: [62, 70], canvas: [210, 239], scale: .2933333333333333 },
    { name: '中毒受击', dir: '受击特效/中毒受击', prefab: '受击特效/中毒受击/中毒受击.prefab', count: 6, size: [77, 65], canvas: [1085, 910], scale: .07098 },
    { name: '死亡特效', dir: '死亡特效/atlas', prefab: '死亡特效/死亡特效.prefab', count: 13, size: [88, 180], canvas: [535, 1092], scale: .16448 },
];

for (const group of groups) {
    test(`${group.name}按常规显示大小缩图，预制体保持显示尺寸`, () => {
        const dir = join(root, group.dir);
        const frames = readdirSync(dir).filter(name => name.endsWith('.png'));
        assert.equal(frames.length, group.count, group.name);
        for (const name of frames) {
            const bytes = readFileSync(join(dir, name));
            assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], group.size, `${group.name}/${name}`);
            const meta = JSON.parse(readFileSync(join(dir, `${name}.meta`), 'utf8'));
            assert.deepEqual([meta.subMetas.f9941.userData.rawWidth, meta.subMetas.f9941.userData.rawHeight], group.size, `${name}.meta`);
        }
        const prefab = JSON.parse(readFileSync(join(root, group.prefab), 'utf8'));
        const node = prefab.find((value: { __type__: string }) => value.__type__ === 'cc.Node');
        const transform = prefab.find((value: { __type__: string }) => value.__type__ === 'cc.UITransform');
        const sprite = prefab.find((value: { __type__: string }) => value.__type__ === 'cc.Sprite');
        assert.deepEqual([transform._contentSize.width, transform._contentSize.height], group.canvas, group.name);
        assert.equal(node._lscale.x, group.scale, group.name);
        assert.equal(node._lscale.y, group.scale, group.name);
        assert.equal(sprite._sizeMode, 0, `${group.name} 必须固定尺寸`);
        assert.equal(sprite._isTrimmedMode, false, `${group.name} 保持完整帧画布`);
    });
}
