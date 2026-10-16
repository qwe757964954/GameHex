/**
 * 卡牌头像（`PVP-卡牌.headIcon`）**画到界面上**这一跳的单测。
 *
 * 上游（`headIcon` → `icon.json` → `image/icon/cardHead|head`）已由
 * `card-head-icon.test.ts` 钉死；本文件管的是**下游**——这张图有没有被真正摆上四张卡：
 *
 *   1. `CardHeadView.applyCardHeadArt()` 的**互斥显隐**（纯函数，零引擎，可直接 import）；
 *   2. `CardLineupTypes.cardArtKey()` 的**复用键必须带 `headIcon`**；
 *   3. 四个 prefab 的结构契约（离线读 `.prefab` JSON）：`HeadIcon` 存在、几何对、
 *      脚本属性绑对、渲染序在 `Hero` 之后、Sprite 的 sizeMode/trim 口径对、layer 全 UI_2D。
 *
 * 为什么每一条都值得写：这条链上**每一层断了都只是"图没出来"**，顶多一条 warn。
 * 尤其第 2 条——键漏了 `headIcon` 时界面不报错、图也能出来，只是**出的是别人的脸**
 * （同品级同职业的卡共用一个 Promise），肉眼要在"我认得这个角色"的前提下才看得出来。
 *
 * ⚠️ 本项目单测一律不 import `cc`：`applyCardHeadArt` 只 `import type`（可被 tsx 抹掉），
 * `CardArtProvider` 经 `CardLineupIcons` **真的**拉进 `cc`，所以它不在本文件里 import ——
 * 键的口径被提成零依赖的 `cardArtKey()` 正是为了这件事。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyCardHeadArt } from '../assets/script/app/card/CardHeadView';
import { cardArtKey } from '../assets/script/app/card/CardLineupTypes';
import { normalizeCardRow, parseCard } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { Sprite, SpriteFrame } from 'cc';

// ============================================================================
// 1. applyCardHeadArt：头像与立绘互斥显示
// ============================================================================

const FRAME = (name: string) => ({ name } as unknown as SpriteFrame);

/** 造一对假的 Sprite（只用到 `spriteFrame` 与 `node.active`）。 */
function fakeSlots(heroFrame: SpriteFrame | null = null) {
    const hero = { spriteFrame: heroFrame, node: { active: true } };
    const headIcon = { spriteFrame: null, node: { active: true } };
    return { hero, headIcon } as unknown as {
        hero: Sprite & { node: { active: boolean } };
        headIcon: Sprite & { node: { active: boolean } };
    };
}

test('有头像：头像接管那一格，立绘整节点隐藏', () => {
    const slots = fakeSlots(FRAME('prefab占位'));
    const head = FRAME('tx_icon_GB_SPL');
    applyCardHeadArt(slots, FRAME('camp_warrior'), head);

    assert.equal(slots.headIcon.spriteFrame, head);
    assert.equal(slots.headIcon.node.active, true);
    assert.equal(slots.hero.node.active, false, '两张图叠着会同时看见一尊石像和一个人物');
    assert.equal(slots.hero.spriteFrame!.name, 'prefab占位', '隐藏即可，不必多写一次 spriteFrame');
});

test('没头像：立绘必须被换上，且头像节点要 active=false（不只是 spriteFrame 置空）', () => {
    const slots = fakeSlots(FRAME('prefab占位'));
    applyCardHeadArt(slots, FRAME('camp_archer'), null);

    assert.equal(slots.hero.spriteFrame!.name, 'camp_archer',
        '只在有头像时写 headIcon、没头像时只翻 active 的写法，会让没头像的卡永远停在 prefab 占位雕像上');
    assert.equal(slots.hero.node.active, true);
    assert.equal(slots.headIcon.node.active, false,
        '只清 spriteFrame 不够：Sprite 会保留上一次的渲染数据，复用槽位时闪出上一张卡的头像');
});

test('没头像且新立绘也拿不到：保留 prefab 现有图片，不写成 null（不闪空一帧）', () => {
    const slots = fakeSlots(FRAME('prefab占位'));
    applyCardHeadArt(slots, null, null);

    assert.equal(slots.hero.spriteFrame!.name, 'prefab占位');
    assert.equal(slots.hero.node.active, true);
    assert.equal(slots.headIcon.node.active, false);
});

test('槽位复用：有头像 → 没头像 → 再有头像，两态都能切回来', () => {
    const slots = fakeSlots(FRAME('camp_mage'));
    const a = FRAME('head_a');
    const b = FRAME('head_b');

    applyCardHeadArt(slots, FRAME('camp_mage'), a);
    assert.equal(slots.headIcon.spriteFrame, a);
    assert.equal(slots.headIcon.node.active, true);
    assert.equal(slots.hero.node.active, false);

    applyCardHeadArt(slots, FRAME('camp_mage'), null);
    assert.equal(slots.headIcon.node.active, false);
    assert.equal(slots.hero.node.active, true);

    applyCardHeadArt(slots, FRAME('camp_mage'), b);
    assert.equal(slots.headIcon.spriteFrame, b, '复用槽位时必须换图，不能留着上一张卡的');
    assert.equal(slots.headIcon.node.active, true);
    assert.equal(slots.hero.node.active, false);
});

// ============================================================================
// 2. cardArtKey：复用键必须带上 headIcon
// ============================================================================

/** 读 remoteRef 的列存表（`{k, v}`）→ 行对象数组。 */
function readPvpRef(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as { k: string[]; v: unknown[][] };
    return source.v.map((row) => Object.fromEntries(source.k.map((key, i) => [key, row[i]])));
}

test('cardArtKey：只差 headIcon 的两张卡必须不同键（同品级同职业会串味）', () => {
    // `deck` 列在 2026-09-20 合表时已下线，别再拿它筛"出战卡"（那样 cards 恒为空、用例永远红）。
    // 收「兵种卡 + 配了头像」两类：2 张建筑卡（主城/金矿）没 unitId，`parseCard` 吃不下；
    // 没配头像的卡本来就没有"专属脸"可串，不参与本用例。
    const cards = readPvpRef('pvpCard')
        .filter((row) => row.unitId !== undefined && row.unitId !== null && row.unitId !== '')
        .filter((row) => typeof row.headIcon === 'string' && row.headIcon !== '')
        .map((row) => parseCard(normalizeCardRow(row)));
    assert.ok(cards.length >= 30, `应有至少 30 张"兵种卡且配了头像"，实际 ${cards.length}`);

    // 用真表证明「同品级同职业但头像不同」是**真实存在**的组合 ——
    // 如果这批数据里根本不存在，这条风险就是想象出来的，测试也该跟着改。
    const byClassRarity = new Map<string, typeof cards>();
    for (const card of cards) {
        const group = `${card.rarity}|${card.traits?.attack ?? ''}`;
        byClassRarity.set(group, [...(byClassRarity.get(group) ?? []), card]);
    }
    const risky = [...byClassRarity.values()].filter((group) => {
        const heads = new Set(group.map((card) => card.headIcon ?? ''));
        return group.length > 1 && heads.size > 1;
    });
    assert.ok(risky.length > 0,
        '真表里应存在「同品级同职业、头像不同」的成对卡 —— 否则 cardArtKey 带 headIcon 这件事就没有意义');

    for (const group of risky) {
        const keys = group.map((card) => cardArtKey(card));
        assert.equal(new Set(keys).size, group.length,
            `同组每张卡都必须有独立键；实际 ${JSON.stringify(group.map((c) => [c.name, c.headIcon, cardArtKey(c)]))}`);
        // 旧口径（只用品级 + 职业）必然撞 —— 这就是当初要改键的理由
        const oldKeys = group.map((card) => cardArtKey(card).split('|').slice(0, 2).join('|'));
        assert.ok(new Set(oldKeys).size < group.length, '旧口径在这组里必须撞键（证明加 headIcon 是必要的）');
    }
});

test('cardArtKey：没配头像的卡键后缀是空串，且与任何配了头像的卡都不同键', () => {
    const row = readPvpRef('pvpCard').find((r) => r.unitId !== undefined && r.unitId !== null && r.unitId !== '');
    assert.ok(row);
    // 本用例要的是「整列缺失」的夹具 —— 真表这一行现在**是配了 headIcon 的**，
    // 必须先显式摘掉，否则 `missing` 会带上真值、与 `blank` 自然不同键（用例失去意义）。
    const { headIcon: _droppedHeadIcon, ...base } = normalizeCardRow(row!) as Record<string, unknown>;

    const withHead = parseCard(normalizeCardRow({ ...base, headIcon: '兵种_头像_弓兵' }));
    const blank = parseCard(normalizeCardRow({ ...base, headIcon: '' }));
    const missing = parseCard(normalizeCardRow(base));

    const prefix = cardArtKey(blank).split('|').slice(0, 2).join('|');
    assert.equal(cardArtKey(blank), `${prefix}|`, '没头像时后缀是空串');
    assert.equal(cardArtKey(withHead), `${prefix}|兵种_头像_弓兵`);
    assert.equal(cardArtKey(blank), cardArtKey(missing), '留空与整列缺失同键（都是"没头像"）');
    assert.notEqual(cardArtKey(blank), cardArtKey(withHead));
});

// ============================================================================
// 3. 四个 prefab 的结构契约
// ============================================================================

const PREFAB_DIR = 'assets/resources/ui/card/';

/** 一个落图点：`headParent` = `HeadIcon` 的父节点路径（`''` 表示 prefab 根）。 */
interface HeadSlotSpec {
    readonly prefab: string;
    /** 脚本组件上的属性名。 */
    readonly prop: string;
    /** `HeadIcon` 的父节点路径。 */
    readonly headParent: string;
    readonly pos: { readonly x: number; readonly y: number };
    readonly size: number;
    /** 这一格原本是什么（`HeadIcon` 必须排在它后面 = 画在它上面）。 */
    readonly after: string;
}

const HEAD_SLOTS: readonly HeadSlotSpec[] = [
    // 卡牌阵容页卡库卡：Hero 是 96×133、锚点 (0.5,0) 底边落在 -44.5，
    // 头像居中摆在这个盒子里（盒心 y = -44.5 + 133/2 = 22）。
    // 卡库卡（2026-10-10：同事 r498 把84 调到 **120**，其余三个 prefab 仍是 84/57/84）。
    // 正方形这个约束才是关键（等比缩放不变形），具体边长跟着 prefab 走，别当设计稿常量。
    { prefab: 'CardLineupCard.prefab', prop: 'headIcon', headParent: '', pos: { x: 0, y: 22 }, size: 120, after: 'Hero' },
    // 上阵站台：Hero 盒 [0,133]，盒心 66.5 —— 头像底边 24.5 正好压在品级垫盘（顶边 28）上。
    { prefab: 'LineupSlot.prefab', prop: 'headIcon', headParent: '', pos: { x: 0, y: 66.5 }, size: 84, after: 'Hero' },
    // 布阵卡池卡：只有 99×100，跟 Hero（57×80）同中心；同为方图所以等比缩放不变形。
    { prefab: 'LineupBoardCard.prefab', prop: 'headIcon', headParent: '', pos: { x: 0, y: -1 }, size: 57, after: 'Hero' },
    // 升级弹窗：脚本组件挂在根上，但头像要进 `Card`（与 Face / Badge / Hero 同层）。
    { prefab: 'CardUpgrade.prefab', prop: 'cardHeadIcon', headParent: 'Card', pos: { x: 0, y: -10 }, size: 84, after: 'Hero' },
];

interface PrefabIndex {
    readonly objs: any[];
    readonly idOf: (path: string) => number | null;
    readonly nameOf: (id: number) => string;
}

function loadPrefab(file: string): PrefabIndex {
    const objs = JSON.parse(readFileSync(PREFAB_DIR + file, 'utf8')) as any[];
    const rootId = objs[0].data.__id__;
    const byPath = new Map<string, number>();
    const walk = (id: number, path: string) => {
        const n = objs[id];
        const name = n._name;
        const here = path ? `${path}/${name}` : name;
        byPath.set(here, id);
        for (const c of n._children ?? []) walk(c.__id__, here);
    };
    walk(rootId, '');
    return {
        objs,
        idOf: (path: string) => byPath.get(path) ?? null,
        nameOf: (id: number) => objs[id]?._name ?? '<unnamed>',
    };
}

const compOf = (p: PrefabIndex, id: number, type: string) =>
    (p.objs[id]._components ?? []).map((c: any) => p.objs[c.__id__]).find((c: any) => c?.__type__ === type);

for (const spec of HEAD_SLOTS) {
    test(`${spec.prefab}：HeadIcon 存在、几何对、绑对、画在 ${spec.after} 之后`, () => {
        const p = loadPrefab(spec.prefab);
        const rootPath = p.nameOf(p.objs[0].data.__id__);
        const headParentId = p.idOf(spec.headParent ? `${rootPath}/${spec.headParent}` : rootPath);
        assert.notEqual(headParentId, null, `找不到 ${spec.headParent || '<root>'} 节点`);
        // `assert.notEqual` 在本项目**不收窄类型**（同 `assert.ok`），下面一律带 `!`。
        const parentId = headParentId!;

        // ---- 全树只有一枚 HeadIcon ----
        const headIds = p.objs
            .map((o, i) => (o?.__type__ === 'cc.Node' && o._name === 'HeadIcon' ? i : -1))
            .filter((i) => i >= 0);
        assert.equal(headIds.length, 1, `HeadIcon 必须恰好一个，实际 ${headIds.length}`);
        const headId = headIds[0];

        // ---- 挂在正确的父节点下 ----
        assert.equal(p.objs[headId]._parent.__id__, parentId);

        // ---- 几何：位置 / 尺寸 / 锚点 ----
        const ut = compOf(p, headId, 'cc.UITransform');
        assert.ok(ut, 'HeadIcon 缺 UITransform');
        assert.deepEqual(
            { x: p.objs[headId]._lpos.x, y: p.objs[headId]._lpos.y },
            { x: spec.pos.x, y: spec.pos.y },
        );
        assert.deepEqual({ w: ut._contentSize.width, h: ut._contentSize.height },
            { w: spec.size, h: spec.size }, '头像必须是正方形，否则等比缩放会变形');
        assert.deepEqual({ x: ut._anchorPoint.x, y: ut._anchorPoint.y }, { x: 0.5, y: 0.5 });

        // ---- Sprite 口径：CUSTOM + 不裁剪 ----
        const sprite = compOf(p, headId, 'cc.Sprite');
        assert.ok(sprite, 'HeadIcon 缺 cc.Sprite');
        assert.equal(sprite._sizeMode, 0,
            'sizeMode 必须是 CUSTOM(0)：TRIMMED(1) 下运行时赋 spriteFrame 会用贴图尺寸改写节点尺寸（84×84 → 43×43 那类）');
        assert.equal(sprite._isTrimmedMode, false,
            'trim 必须关：33 张头像画布统一 84×84，按裁剪框拉伸会让每张脸大小不一');

        // ---- 渲染序：紧跟 after 那一项（`_children` 序 = 绘制序） ----
        const siblings: number[] = (p.objs[parentId]._children ?? []).map((c: any) => c.__id__);
        const headIndex = siblings.indexOf(headId);
        const afterIndex = siblings.findIndex((id) => p.nameOf(id) === spec.after);
        assert.notEqual(afterIndex, -1, `父节点下找不到 ${spec.after}`);
        assert.equal(headIndex, afterIndex + 1,
            `HeadIcon 必须紧跟 ${spec.after}（否则被卡面/压暗遮罩盖住）：实际 children = ${JSON.stringify(siblings.map((id) => p.nameOf(id)))}`);

        // ---- 脚本属性真的绑到了这个 Sprite 上（跨 __id__ 解析，不能只看字段非空） ----
        const rootId = p.objs[0].data.__id__;
        const script = (p.objs[rootId]._components ?? [])
            .map((c: any) => p.objs[c.__id__])
            .find((c: any) => c && !String(c.__type__).startsWith('cc.'));
        assert.ok(script, '根节点上应有卡牌脚本组件');
        const boundRef = script[spec.prop];
        assert.ok(boundRef && typeof boundRef.__id__ === 'number', `脚本属性 ${spec.prop} 没绑定`);
        const bound = p.objs[boundRef.__id__];
        assert.equal(bound.__type__, 'cc.Sprite', `${spec.prop} 必须指向组件（写错成节点的形态不报错，只静默为 null）`);
        assert.equal(bound.node.__id__, headId, `${spec.prop} 指向了别的节点`);

        // ---- layer：整棵子树必须 UI_2D，否则 UI 相机整棵不渲染 ----
        const badLayer = p.objs
            .map((o, i) => (o?.__type__ === 'cc.Node' && o._layer !== 33554432 ? `${p.nameOf(i)}=${o._layer}` : null))
            .filter(Boolean);
        assert.deepEqual(badLayer, [], 'UI prefab 的所有节点都必须 UI_2D(33554432)');
    });
}
