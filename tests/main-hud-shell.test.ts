import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveChestPanelX } from '../assets/script/app/main/MainHudMotion';
import { assetPath } from './helpers/asset-paths';

type Raw = Record<string, unknown>;
const load = (path: string): Raw[] => JSON.parse(readFileSync(path, 'utf8')) as Raw[];
const MAIN_ROOT = load(assetPath('ui/main/MainRoot.prefab'));
const ARENA_ROOT = load(assetPath('ui/main/ArenaRoot.prefab'));

function scriptCid(path: string): string {
    const uuid = (JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { uuid: string }).uuid.replace(/-/g, '');
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let cid = uuid.slice(0, 5);
    for (let index = 5; index < 32; index += 3) {
        const value = parseInt(uuid.slice(index, index + 3), 16);
        cid += keys[value >> 6] + keys[value & 63];
    }
    return cid;
}

function overrideOf(instance: Raw, objects: Raw[], name: string): unknown {
    const overrides = (instance.propertyOverrides ?? []) as Array<{ __id__: number }>;
    const found = overrides.map(({ __id__ }) => objects[__id__])
        .filter((entry) => (entry?.propertyPath as string[] | undefined)?.[0] === name);
    return found.at(-1)?.value;
}

function instanceName(instance: Raw): string {
    const index = MAIN_ROOT.indexOf(instance);
    const info = MAIN_ROOT.find((entry) => entry.__type__ === 'cc.PrefabInfo'
        && (entry.instance as { __id__?: number } | undefined)?.__id__ === index);
    const overrides = ((instance.propertyOverrides ?? []) as Array<{ __id__: number }>).map(({ __id__ }) => MAIN_ROOT[__id__]);
    const name = overrides.find((entry) => (entry?.propertyPath as string[] | undefined)?.[0] === '_name')?.value;
    return typeof name === 'string' ? name : (info?.name as string | undefined) ?? '';
}

test('MainRoot 底部导航实例按 tabType 绑定类型与自身两态图标', () => {
    const itemPrefabUuid = (JSON.parse(readFileSync(assetPath('ui/common/TabButton.prefab.meta'), 'utf8')) as { uuid: string }).uuid;
    const instances = MAIN_ROOT.flatMap((entry, index) => {
        if (entry.__type__ !== 'cc.PrefabInstance') return [];
        const info = MAIN_ROOT.find((candidate) => candidate.__type__ === 'cc.PrefabInfo'
            && (candidate.instance as { __id__?: number } | undefined)?.__id__ === index);
        return info?.asset && (info.asset as { __uuid__?: string }).__uuid__ === itemPrefabUuid ? [entry] : [];
    });
    const navItems = instances;
    assert.equal(navItems.length, 7);
    const sharedLabel = load(assetPath('ui/common/TabButton.prefab'))
        .find((entry) => entry.__type__ === 'cc.Label');
    assert.ok(sharedLabel, '共用页签必须提供名称 Label');
    const expected: Record<string, { type: number; icon: string }> = {
        Shop: { type: 0, icon: 'nav_shop' },
        Hero: { type: 1, icon: 'nav_hero' },
        Role: { type: 2, icon: 'nav_role' },
        Territory: { type: 3, icon: 'nav_territory' },
        Challenge: { type: 4, icon: 'nav_challenge' },
        Alliance: { type: 5, icon: 'nav_alliance' },
        World: { type: 6, icon: 'nav_world' },
    };
    for (const item of navItems) {
        const name = instanceName(item);
        const specification = expected[name];
        assert.ok(specification, `未知主城 tab 实例 ${name}`);
        assert.equal(overrideOf(item, MAIN_ROOT, 'tabType'), specification.type, `${name} 的 tabType`);
        assert.deepEqual(overrideOf(item, MAIN_ROOT, 'onLabelColor'),
            { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }, `${name} 选中后保留白字`);
        assert.equal(overrideOf(item, MAIN_ROOT, 'iconRaiseY'), 12, `${name} 选中后图标上抬 12px`);
        assert.equal(overrideOf(item, MAIN_ROOT, '_isBold') ?? sharedLabel._isBold,
            true, `${name} 名称使用粗体`);
        assert.equal(overrideOf(item, MAIN_ROOT, '_enableOutline') ?? sharedLabel._enableOutline,
            true, `${name} 名称使用描边`);
        assert.equal(overrideOf(item, MAIN_ROOT, '_outlineWidth') ?? sharedLabel._outlineWidth,
            3, `${name} 名称描边宽度`);
        const iconMeta = JSON.parse(readFileSync(assetPath(`image/main/city/${specification.icon}.png.meta`), 'utf8')) as { uuid: string };
        const expectedFrame = `${iconMeta.uuid}@f9941`;
        for (const property of ['offIcon', 'onIcon']) {
            const frame = overrideOf(item, MAIN_ROOT, property) as { __uuid__?: string } | undefined;
            assert.equal(frame?.__uuid__, expectedFrame, `${name}.${property} 应绑定 ${specification.icon}`);
        }
    }
    const host = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    assert.match(host, /button\.tabType/);
    assert.doesNotMatch(host, /loadNavArt/);
});

test('角色使用蓝湖蓝色建筑切图，不能把旧头盔改名后继续使用', () => {
    const icon = readFileSync(assetPath('image/main/city/nav_role.png'));
    // 用户提供的 zjm_icon_sj.png 原图；角色与世界复用建筑外观，锁定状态由页签控制。
    assert.equal(createHash('sha256').update(icon).digest('hex'),
        '1077f09508803f8966e2e7da382749b664310d8eeb2cccbf9407ff713b258f96');
});

test('TopHud 接上主界面玩家数据渲染组件', () => {
    const topHud = ARENA_ROOT.find((entry) => entry.__type__ === 'cc.Node' && entry._name === 'TopHud');
    assert.ok(topHud, 'ArenaRoot 缺少 TopHud');
    const mainResBarCid = scriptCid('assets/script/app/main/MainResBar.ts');
    const componentRefs = topHud!._components as Array<{ __id__: number }>;
    const renderer = componentRefs.map(({ __id__ }) => ARENA_ROOT[__id__]).find((entry) => entry?.__type__ === mainResBarCid);
    assert.ok(renderer, 'TopHud 未挂接已有的 MainResBar 数据渲染器');
    for (const property of ['avatarIcon', 'nameLabel', 'levelLabel', 'expFill']) {
        assert.ok(renderer![property], `TopHud 的 MainResBar.${property} 未绑定`);
    }
});

test('宝箱栏通过可逆的时间轴从左侧滑入和滑出', () => {
    const chestBar = readFileSync('assets/script/app/main/ChestBar.ts', 'utf8');
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.match(chestBar, /setOpen\(open: boolean/);
    assert.match(chestBar, /resolveChestPanelX/);
    assert.match(chestBar, /motionStartedAt/);
    assert.match(page, /this\.chestBar\.setOpen\(open\)/);
    assert.doesNotMatch(page, /this\.chestBar\.node\.active = open/);
});

test('宝箱栏滑动时间轴按绝对时间计算并在边界锁定', () => {
    assert.equal(resolveChestPanelX(0, -720, 10, 10, 0.28), 0);
    assert.equal(resolveChestPanelX(0, -720, 10, 10.28, 0.28), -720);
    assert.ok(Math.abs(resolveChestPanelX(0, -720, 10, 10.14, 0.28) + 630) < 1e-9);
    assert.equal(resolveChestPanelX(0, -720, 10, 9, 0.28), 0);
    assert.equal(resolveChestPanelX(0, -720, 10, 10, 0), -720);
});
