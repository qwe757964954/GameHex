import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(`assets/script/app/${path}`, 'utf8');
test('chapter page consumes snapshots and emits intents without business dependencies', () => {
    const source = read('main/MainTerritoryMap.ts');
    assert.doesNotMatch(source, /TerritoryPresenter|TerritoryModel|TerritoryCellRepository|GameNet|CacheMgr|readRoleRow/);
    assert.match(source, /TerritoryUiEvent\.Intent/);
    assert.match(source, /TerritoryViewEvent\.Render/);
    assert.match(source, /TerritoryViewEvent\.Command/);
});
test('chapter model has instance outputs and no global view event subscriptions', () => {
    const source = read('territory/application/TerritoryModel.ts');
    assert.doesNotMatch(source, /import.*EventMgr|from.*view\/TerritoryEvents/);
    assert.match(source, /onOutput/);
});
test('chapter has a single implementation: no compatibility re-export presenters', () => {
    assert.equal(existsSync('assets/script/app/territory/application/TerritoryPresenter.ts'), false);
    assert.equal(existsSync('assets/script/app/bigmap/application/BigMapPresenter.ts'), false);
});
