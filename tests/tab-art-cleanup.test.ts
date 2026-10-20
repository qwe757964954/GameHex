import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const PROJECT_ROOT = process.cwd();
const LEGACY_TAB_ASSETS = [
    'assets/resources/image/main/tab_bg_01.png',
    'assets/resources/image/main/tab_bg_01.png.meta',
    'assets/resources/image/main/tab_bg_02.png',
    'assets/resources/image/main/tab_bg_02.png.meta',
] as const;
const LEGACY_REFERENCES = [
    'tab_bg_01',
    'tab_bg_02',
    '01160154-423b-4b28-93b5-7464bbb81174',
    'b09f13ff-cf09-410b-988e-cc4ee0391fad',
] as const;

function filesUnder(directory: string): string[] {
    return readdirSync(join(PROJECT_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return filesUnder(path);
        return /\.(ts|prefab)$/.test(entry.name) ? [path] : [];
    });
}

test('主页页签改版后删除旧 tab_bg 资源和所有代码、Prefab 引用', () => {
    for (const path of LEGACY_TAB_ASSETS) {
        assert.equal(existsSync(join(PROJECT_ROOT, path)), false, `${path} should be deleted`);
    }

    const consumers = [
        ...filesUnder('assets/script/app'),
        ...filesUnder('assets/resources/ui'),
    ];
    for (const path of consumers) {
        const source = readFileSync(join(PROJECT_ROOT, path), 'utf8');
        for (const reference of LEGACY_REFERENCES) {
            assert.equal(source.includes(reference), false, `${path} still references ${reference}`);
        }
    }
});

test('礼包、首充、限时活动和共用页签都接主页金色选中底板', () => {
    const navSelUuid = '5aa83ea4-4ad3-4935-9da7-c6081617404f@f9941';
    const giftArt = readFileSync(join(PROJECT_ROOT, 'assets/script/app/gift/GiftArt.ts'), 'utf8');
    assert.match(giftArt, /on:\s*'city\/nav_sel'/);
    assert.match(giftArt, /off:\s*''/);

    const firstRecharge = JSON.parse(readFileSync(
        join(PROJECT_ROOT, 'assets/resources/ui/FirstRecharge/FirstRecharge.prefab'), 'utf8',
    )) as Array<Record<string, unknown>>;
    const tierBindings = firstRecharge.filter((item) => Object.prototype.hasOwnProperty.call(item, 'selectedFrame'));
    assert.equal(tierBindings.length, 4, '首充四个档位都要接主页选中图');
    for (const binding of tierBindings) {
        assert.deepEqual(binding.selectedFrame, { __uuid__: navSelUuid, __expectedType__: 'cc.SpriteFrame' });
        assert.equal(binding.normalFrame, null);
    }

    const limitTimeAct = JSON.parse(readFileSync(
        join(PROJECT_ROOT, 'assets/resources/ui/LimitTimeAct/LimitTimeAct.prefab'), 'utf8',
    )) as Array<Record<string, unknown>>;
    const limitTimeBinding = limitTimeAct.find((item) => Object.prototype.hasOwnProperty.call(item, 'selectedTabFrame'));
    assert.ok(limitTimeBinding, '限时活动页签必须在 prefab 上绑定选中底板');
    assert.deepEqual(limitTimeBinding!.selectedTabFrame, { __uuid__: navSelUuid, __expectedType__: 'cc.SpriteFrame' });

    const sharedTab = JSON.parse(readFileSync(
        join(PROJECT_ROOT, 'assets/resources/ui/common/TabButton.prefab'), 'utf8',
    )) as Array<Record<string, unknown>>;
    const sharedBinding = sharedTab.find((item) => Object.prototype.hasOwnProperty.call(item, 'onBgFrame'));
    assert.ok(sharedBinding, '共用 TabButton 需要序列化选中态资源');
    assert.equal(sharedBinding!.offBgFrame, null);
    assert.deepEqual(sharedBinding!.onBgFrame, { __uuid__: navSelUuid, __expectedType__: 'cc.SpriteFrame' });
});
