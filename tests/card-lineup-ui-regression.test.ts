import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8');
const cardSource = readFileSync('assets/script/app/card/CardLineupCard.ts', 'utf8');
const prefab = JSON.parse(readFileSync('assets/resources/ui/card/CardLineupCard.prefab', 'utf8')) as Array<Record<string, any>>;
const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((node) => node._name === name);
const components = (node: Record<string, any>) => node._components.map((ref: { __id__: number }) => prefab[ref.__id__]);

test('卡库进度使用升级所需卡牌数量，进度条绑定在对应节点', () => {
    assert.match(source, /const cardRequirement = status\.requirements\.find\(\(item\) => item\.key === 'card'\)/);
    assert.doesNotMatch(source, /status\.requirements\.find\(\(item\) => item\.key === 'exp'\)/);
    const track = nodeNamed('CardFragmentProgress');
    const fill = nodeNamed('CardFragmentFill');
    const label = nodeNamed('CardFragmentCountLabel');
    assert.ok(track && fill && label);
    const bar = components(track).find((component: Record<string, any>) => component.__type__ === 'cc.ProgressBar');
    assert.ok(bar);
    assert.equal(prefab[bar._barSprite.__id__].node.__id__, prefab.indexOf(fill));
    assert.match(cardSource, /this\.progressBar\.progress\s*=/);
});

test('等级底板包含等级标签，0 级时整体隐藏', () => {
    const plate = nodeNamed('LevelPlate');
    const label = nodeNamed('LevelLabel');
    assert.ok(plate && label);
    assert.equal(label._parent.__id__, prefab.indexOf(plate));
    assert.match(cardSource, /this\.levelPlate\.active\s*=\s*normalizedLevel\s*>\s*0/);
});
