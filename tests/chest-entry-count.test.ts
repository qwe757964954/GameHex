import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { MainPage } from '../assets/script/app/main/MainPage';
import * as chestTypes from '../assets/script/app/main/ChestTypes';

function createHarness() {
    const releasedOwners: object[] = [];
    let slots: readonly chestTypes.IChestSlotData[] = [];
    let loads = 0;
    const listeners = new Set<(value: readonly chestTypes.IChestSlotData[]) => void>();
    class RepositoryStub {
        private listener: ((value: readonly chestTypes.IChestSlotData[]) => void) | null = null;
        get slots() { return slots; }
        async load(_caller: object, listener: (value: readonly chestTypes.IChestSlotData[]) => void) {
            loads++;
            this.listener = listener;
            listeners.add(listener);
            listener(slots);
            return 'ok';
        }
        dispose() {
            if (this.listener) listeners.delete(this.listener);
        }
    }
    const exports: { MainPage?: new () => MainPage } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/MainPage.ts', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === '../net/GameNet') return { GameNet: { instance: { removeCaller: (owner: object) => releasedOwners.push(owner) } } };
        if (name === 'cc') return {
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
            Component: class {},
        };
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: { on: () => undefined, offTarget: () => undefined } } };
        if (name === './ChestEvents') return { CHEST_EVENTS: { SLOT_ACTION: 'slot', COLLAPSE: 'collapse', PAGE: 'page' } };
        if (name === './ChestTypes') return chestTypes;
        if (name === './NewTreasureRepository') return { NewTreasureRepository: RepositoryStub };
        return {};
    } });
    assert.ok(exports.MainPage);
    const Page = exports.MainPage;
    const createPage = () => {
        const page = new Page();
        const cells = Array.from({ length: chestTypes.CHEST_SLOT_COUNT }, () => ({ spriteFrame: null as unknown }));
        Object.assign(page, {
            isValid: true,
            chestCell0: cells[0], chestCell1: cells[1], chestCell2: cells[2], chestCell3: cells[3],
            chestCellFilled: 'green', chestCellEmpty: 'gray',
            startButton: { active: false },
            chestBar: { render() {}, setOpen() {} },
        });
        return { page, colors: () => cells.map((cell) => cell.spriteFrame) };
    };
    const setCount = (occupiedIndices: number[], notify = true) => {
        slots = Array.from({ length: chestTypes.CHEST_SLOT_COUNT }, (_, index) => ({
            index: index + 1,
            state: occupiedIndices.includes(index + 1) ? chestTypes.ChestSlotState.Ready : chestTypes.ChestSlotState.Empty,
            action: occupiedIndices.includes(index + 1) ? chestTypes.ChestSlotAction.Activate : chestTypes.ChestSlotAction.Battle,
            name: '', remainSeconds: 10, totalSeconds: 10, cost: 0,
        }));
        if (notify) for (const listener of listeners) listener(slots);
    };
    return { createPage, setCount, get loads() { return loads; } };
}

test('宝箱数量格按实际数量连续点亮，开箱和推送后全量更新', () => {
    const h = createHarness();
    h.setCount([2, 4]);
    const { page, colors } = h.createPage();
    page.start();
    assert.deepEqual(colors(), ['green', 'green', 'gray', 'gray'], '槽位不连续时仍显示总数量');
    h.setCount([4]);
    assert.deepEqual(colors(), ['green', 'gray', 'gray', 'gray']);
    h.setCount([]);
    assert.deepEqual(colors(), ['gray', 'gray', 'gray', 'gray']);
    h.setCount([1, 2, 3, 4]);
    assert.deepEqual(colors(), ['green', 'green', 'green', 'green']);
});

test('每局返回主城重新加载宝箱列表，数量格不沿用上一局', () => {
    const h = createHarness();
    h.setCount([1]);
    const first = h.createPage();
    first.page.start();
    assert.deepEqual(first.colors(), ['green', 'gray', 'gray', 'gray']);
    first.page.onDestroy();
    h.setCount([1, 2, 3], false);
    const next = h.createPage();
    next.page.start();
    assert.equal(h.loads, 2, '每次返回都要重新拉取');
    assert.deepEqual(next.colors(), ['green', 'green', 'green', 'gray']);
    assert.deepEqual(first.colors(), ['green', 'gray', 'gray', 'gray'], '旧页面销毁后不再接收更新');
});

test('主城 prefab 的四个数量格和亮灭图片都绑定到 MainPage', () => {
    const objects = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8')) as Array<Record<string, unknown>>;
    const page = objects.find((entry) => 'chestToggle' in entry && 'chestCell0' in entry);
    assert.ok(page);
    for (let index = 0; index < chestTypes.CHEST_SLOT_COUNT; index++) {
        const reference = page[`chestCell${index}`] as { __id__: number };
        assert.ok(reference);
        const sprite = objects[reference.__id__];
        assert.equal(sprite.__type__, 'cc.Sprite');
        const node = objects[(sprite.node as { __id__: number }).__id__];
        assert.equal(node._name, `Cell${index}`);
    }
    for (const [property, image] of [
        ['chestCellFilled', 'hud_chest_cell'], ['chestCellEmpty', 'hud_chest_cell_off'],
    ]) {
        const metadata = JSON.parse(readFileSync(`assets/resources/image/main/hud/${image}.png.meta`, 'utf8'));
        assert.equal((page[property] as { __uuid__: string }).__uuid__, `${metadata.uuid}@f9941`);
    }
});
