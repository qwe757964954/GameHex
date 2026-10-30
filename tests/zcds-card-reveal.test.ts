import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

/**
 * `ZCGameCardReveal.prefab` 的**绑定守卫**。
 *
 * 起因（2026-10-10）：prefab 上有 5 个 `@property` 没绑（`luckSprite` / `resourceFrame` /
 * 3 张运气评语切图），**运行时一条错都不报** —— 只是「上方那行字不显示」「金矿卡框不换色」。
 * 更隐蔽的是 `rarityLabel`：它的节点在编辑器内存里存在、**磁盘 prefab 里没有**，
 * 编辑器 save 时报 `Reference "rarityLabel" ... to external scene object ... can not be
 * saved in prefab asset` 并**把该引用静默降级成 null**，还顺手把节点一起丢��。
 *
 * ⇒ 这条守卫的价值是：**下次再加 `@property` 忘了绑，会当场红**，而不是等真机上看不出字。
 *
 * 口径：脚本声明 vs prefab 实际引用，两边逐字段对账（MEMORY 铁律 6 / 0.1）。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const PREFAB_PATH = assetPath('ui/game/ZCGameCardReveal.prefab');
const VIEW_PATH = 'assets/script/app/zcds/view/ZCCardRevealView.ts';

/** `ZCCardRevealView` 的压缩 cid（= `.ts.meta` 的 uuid 经 compressUuid）。 */
const VIEW_CID = 'e6ab2eZkapI44DBRMWZggoA';

const loadPrefab = (): Raw[] => JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Raw[];

/** 脚本里声明的 `@property` 字段名（按 `名字 = ` / `名字: 类型 = ` 两种形态抓）。 */
function declaredProps(): string[] {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const names = new Set<string>();
    // ① `@property({...})\n    foo: T = v;`  /  `@property({...})\n    foo = v;`
    for (const m of src.matchAll(/@property\([^)]*\)\s*\n\s*(\w+)\s*[:=]/g)) names.add(m[1]);
    return [...names].sort();
}

/** prefab 里脚本组件的字段：名→ 值（`__id__` 引用 / `__uuid__` 资产 / 标量）。 */
function boundProps(): Record<string, Raw | null> {
    const prefab = loadPrefab();
    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp, `prefab 上找不到 ZCCardRevealView 组件（cid=${VIEW_CID}）`);
    const skip = new Set(['__type__', '_name', '_objFlags', '__editorExtras__', 'node', '_enabled', '__prefab', '_id']);
    const out: Record<string, Raw | null> = {};
    for (const k of Object.keys(comp)) {
        if (skip.has(k)) continue;
        out[k] = comp[k] ?? null;
    }
    return out;
}

test('卡牌小卡牌：脚本声明的每个 @property 在 prefab 上都有值', () => {
    const declared = declaredProps();
    const bound = boundProps();
    assert.ok(declared.length > 0, '没抓到任何 @property —— 正则失效了，这条守卫会假绿');

    const missing: string[] = [];
    for (const name of declared) {
        const v = bound[name];
        if (v === undefined) { missing.push(`${name}（prefab 上没这个字段）`); continue; }
        // `null` /空 uuid / `{uuid:''}` / `{"__uuid__": null}` 都算「没绑」
        const isEmpty = v === null
            || (typeof v === 'object' && Object.keys(v).length === 0)
            || (typeof v === 'object' && 'uuid' in v && !v.uuid)
            || (typeof v === 'object' && '__uuid__' in v && !v.__uuid__);
        if (isEmpty) missing.push(`${name}（值为空）`);
    }
    assert.deepEqual(missing, [], `有 @property 没挂号：\n  - ${missing.join('\n  - ')}`);
});

test('卡牌小卡牌：组件引用的__id__ 必须指向对应类型的组件、不是节点', () => {
    const prefab = loadPrefab();
    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp);

    // 字段声明类型（从脚本读，改了类型这里也要跟着改）
    const expected: Record<string, string> = {
        frameSprite: 'cc.Sprite',
        iconSprite: 'cc.Sprite',
        luckSprite: 'cc.Sprite',
        nameLabel: 'cc.Label',
    };
    for (const [prop, type] of Object.entries(expected)) {
        const ref = comp[prop];
        assert.ok(ref?.__id__ !== undefined, `${prop} 没绑组件引用`);
        const target = prefab[ref.__id__];
        assert.ok(target, `${prop} 的 __id__=${ref.__id__} 越界（prefab 共 ${prefab.length} 个对象）`);
        assert.equal(target.__type__, type,
            `${prop} 应指向 ${type}，实际指向 ${target.__type__}（指向 cc.Node 是静默失效：字段读出来是 Node，组件内部一律 null）`);
    }
});

test('卡牌小卡牌：已删的 rarityLabel 不留孤儿（节点与字段都不该在）', () => {
    const prefab = loadPrefab();
    const nodeNames = prefab.filter((o) => o?.__type__ === 'cc.Node').map((o) => o._name);
    assert.ok(!nodeNames.includes('RarityLabel'),
        'RarityLabel 节点还在 —— 2026-10-10 已按口径删除（上方那行只由 LuckSprite 承担）');

    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp && !('rarityLabel' in comp),
        'rarityLabel 孤儿字段还在 prefab 上 —— refresh 脚本目录后 enter→save 才会清掉');

    const src = readFileSync(VIEW_PATH, 'utf8');
    assert.ok(!/rarityLabel|hasRarityName|RARITY_COLORS|setOutlineTint|rarityTier/.test(src),
        '脚本里还有 rarityLabel 一族的残留（死代码应当删净）');
});

test('卡牌小卡牌：蓝卡暂借绿卡评语切图，但卡框仍按各自评级', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    // ⚠️ 切函数体必须按「到下一个 `private ` 为止」划边界，不能拿某个具名函数当结束标记 ——
    // `luckTextFrameForTier` 排在 `frameForBuilding` **之后**，用后者当 slice 终点会得到空串、断言假红。
    const methodBody = (name: string): string => {
        const start = src.indexOf(`private ${name}`);
        assert.ok(start > 0, `脚本里找不到 ${name}`);
        const next = src.indexOf('\n    private ', start + 1);
        return src.slice(start, next > 0 ? next : src.length);
    };

    // 绿/蓝 共用一张：写成 `case 1:` 紧跟 `case 2:` 两个标签，return 同一个字段
    const fn = methodBody('luckTextFrameForTier');
    assert.match(fn, /case 1:\s*\n\s*case 2:\s*return this\.luckTextGreenFrame;/,
        '蓝品级应与绿品级共用 luckTextGreenFrame（美术没出蓝色评语切图，2026-10-10 口径）');

    // 卡框不能跟着借：四个品级必须各走各的字段
    const frameFn = methodBody('frameForTier');
    for (const [field, label] of [['greenFrame', '绿'], ['blueFrame', '蓝'], ['purpleFrame', '紫'], ['goldFrame', '金']] as const) {
        assert.match(frameFn, new RegExp(`case [1-4]: return this\\.${field};`),
            `卡框 ${label} 品级应返回自己的 ${field}（卡框按各自评级，不跟评语一起借）`);
    }
    // 蓝卡仍要有蓝框：出现两次 greenFrame 说明借错了
    assert.equal((frameFn.match(/return this\.greenFrame;/g) ?? []).length, 1, '蓝卡不能借用绿色卡框');
    assert.match(frameFn, /case 2: return this\.blueFrame;/, '蓝卡必须用蓝色卡框');
});

test('卡牌小卡牌：切图与prefab 绑定一致（品级 4 + 资源点 + 评语 3）', () => {
    const comp = boundProps();
    // 覆盖后的 4 张品级卡框uuid 不变（美术换图不改 uuid），所以这里只钉「都有值 + 互不相同」
    const frames = ['greenFrame', 'blueFrame', 'purpleFrame', 'goldFrame', 'resourceFrame'] as const;
    const uuids = frames.map((k) => comp[k]?.__uuid__ ?? '');
    for (const [i, u] of uuids.entries()) {
        assert.ok(u && u.endsWith('@f9941'), `${frames[i]} 没绑上 SpriteFrame（uuid=${u || '空'}）`);
    }
    assert.equal(new Set(uuids).size, frames.length, '5 张卡框绑成了同一张图 —— 品级换色会失效');

    const luck = ['luckTextGreenFrame', 'luckTextPurpleFrame', 'luckTextGoldFrame'] as const;
    const luckUuids = luck.map((k) => comp[k]?.__uuid__ ?? '');
    for (const [i, u] of luckUuids.entries()) {
        assert.ok(u && u.endsWith('@f9941'), `${luck[i]} 没绑上评语切图`);
    }
    assert.equal(new Set(luckUuids).size, 3, '3 张评语切图有重复');

    // 切图文件必须真的存在（防「绑了 uuid 但美术没导」）
    for (const name of ['cardRevealLuck_01', 'cardRevealLuck_03', 'cardRevealLuck_04', 'common_img_pzk_05']) {
        const meta = assetPath(`image/frame/${name}.png.meta`);
        assert.doesNotThrow(() => readFileSync(meta), `缺美术：${meta}`);
    }
});
