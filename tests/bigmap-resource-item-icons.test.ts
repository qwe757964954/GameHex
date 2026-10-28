/**
 * 大地图顶栏资源图标「走背包」的那条链（2026-10-26 用户口径：
 * *「大地图顶部资源 18501 18502 18503 18504 18505 用这几个，走背包的」*）。
 *
 * 链路：`bigmapResource.itemId` →（`item` 表）`resId` → `item.icon` → `attachBigMapResourceItemIcons`
 * → `config.resourceIcons` → `BigMapArtLoader` 优先按它加载（`icons/item/xxx` + `main-pages` 分包）。
 *
 * 钉住四件事：
 * 1. 五张资源表确实配了 18501..18505；
 * 2. `item.icon` 有值就并进 `resourceIcons`；
 * 3. `item.icon` 为空 / item 表缺行 **不并**（视图退回概念图，绝不留空图标）；
 * 4. 老表没有 `itemId` 列也能解析（给 0），不能一条都解析不出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
    BIGMAP_TABLE, attachBigMapResourceItemIcons, decompressBigMapRows, parseBigMapConfig,
} from '../assets/script/app/bigmap/model/BigMapConfig';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function currentTables(): Record<string, unknown> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))]));
}

test('五张资源表都配了背包道具 id：18501 粮食 / 18502 木材 / 18503 矿石 / 18504 钻石 / 18505 行动力', () => {
    const config = loadBigMapConfig();
    const expected: Record<string, number> = {
        grain: 18501, wood: 18502, iron: 18503, coin: 18504, stamina: 18505,
    };
    for (const [resType, itemId] of Object.entries(expected)) {
        assert.equal(config.resources.get(resType as never)?.itemId, itemId, `${resType} 的道具 id 不对`);
    }
    // 名称跟背包道具保持一致（背包里 18503 叫「矿石」、18504 叫「钻石」）。
    assert.equal(config.resources.get('iron')?.name, '矿石');
    assert.equal(config.resources.get('coin')?.name, '钻石');
});

test('item 表里的 icon 会被并进 resourceIcons（这是「走背包」的落点）', () => {
    const config = loadBigMapConfig();
    const merged = attachBigMapResourceItemIcons(config, [
        { resId: 18501, name: '粮食', icon: 'icons/item/图标_粮食' },
        { resId: 18502, name: '木材', icon: 'icons/item/图标_木材' },
        { resId: 18505, name: '行动力', icon: 'icons/item/图标_体力' },
    ]);
    assert.equal(merged.resourceIcons.get('grain'), 'icons/item/图标_粮食');
    assert.equal(merged.resourceIcons.get('wood'), 'icons/item/图标_木材');
    assert.equal(merged.resourceIcons.get('stamina'), 'icons/item/图标_体力');
    // 表里没给 icon / 没给行 ⇒ 不并，视图退回概念图。
    assert.equal(merged.resourceIcons.has('iron'), false);
    assert.equal(merged.resourceIcons.has('coin'), false);
    // 原配置不能被就地改（纯函数口径）。
    assert.equal(config.resourceIcons.size, 0);
});

test('item.icon 全为空 / item 表缺失时原样返回，一个空图标都不塞', () => {
    const config = loadBigMapConfig();
    assert.equal(attachBigMapResourceItemIcons(config, []).resourceIcons.size, 0);
    assert.equal(attachBigMapResourceItemIcons(config, null).resourceIcons.size, 0);
    const blank = attachBigMapResourceItemIcons(config, [
        { resId: 18501, icon: '' },
        { resId: 18502, icon: '   ' },
    ]);
    assert.equal(blank.resourceIcons.size, 0);
    // 未知 resId 不参与映射。
    const stranger = attachBigMapResourceItemIcons(config, [{ resId: 10001, icon: 'icons/item/x' }]);
    assert.equal(stranger.resourceIcons.size, 0);
});

test('老表没有 itemId 列也能解析（给 0，退回概念图），不会整表报错', () => {
    const tables = currentTables();
    const rows = decompressBigMapRows(tables[BIGMAP_TABLE.resource]) as Array<Record<string, unknown>>;
    const withoutColumn = rows.map(({ itemId: _drop, ...rest }) => rest);
    const config = parseBigMapConfig({ ...tables, [BIGMAP_TABLE.resource]: withoutColumn });
    for (const res of config.resources.values()) {
        assert.equal(res.itemId, 0, `${res.resType} 缺列时应为 0`);
    }
    assert.equal(attachBigMapResourceItemIcons(config, [{ resId: 18501, icon: 'icons/item/x' }])
        .resourceIcons.size, 0);
});
test('真实 item 表已配 18501~18505 的图标，且图真的在 main-pages/icons/item 下', () => {
    const config = loadBigMapConfig();
    const itemRows = JSON.parse(readFileSync('assets/remoteRef/item.json', 'utf8'));
    const merged = attachBigMapResourceItemIcons(config, itemRows);
    // 表与图必须成对：只配了表没交图 ⇒ 加载必然 null；只交了图没配表 ⇒ 走不到背包那条路。
    const expected: Record<string, string> = {
        grain: 'icons/item/图标_粮食',
        wood: 'icons/item/图标_木材',
        iron: 'icons/item/图标_矿石',
        coin: 'icons/item/图标_钻石',
        stamina: 'icons/item/图标_行动力',
    };
    for (const [resType, icon] of Object.entries(expected)) {
        assert.equal(merged.resourceIcons.get(resType as never), icon);
        assert.ok(existsSync(`assets/bundles/main-pages/icons/item/${icon.split('/').pop()}.png`),
            `缺图：${icon}.png`);
    }
});
