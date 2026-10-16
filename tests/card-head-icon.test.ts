/**
 * `PVP-卡牌.headIcon`（卡牌头像）的单测。
 *
 * 这一列存的**不是资源名**，而是 `icon.json` 的图标名；而且它会落到**两个目录**：
 *   - 兵种头像 `兵种_头像_*` → `ui://图标_兵种_头像/tx_icon_*` → `icons/cardHead`
 *   - 玩家头像 `图标_头像_*` → `ui://图标/图标_头像_*`       → `icons/head`
 * 目录由 **`path` 的包名**决定（`ArtPaths.ICON_PACKAGE_ART_ROOT`）。
 *
 * 为什么值得单独一个文件：这条链**每一层断了都不报错** —— 表里没填、`icon.json` 没这个 key、
 * 包名没登记、资源名在磁盘上不存在 —— 四种情况全都只表现为"卡面上那张图没出来"，
 * `resources.load` 顶多打一条 warn。所以最后一跳用「读真表 + 查真目录」钉死，不靠人眼。
 *
 * 对应实现：
 *   - 纯逻辑 `assets/script/app/HeadArtModel.ts`（零引擎，本文件直接 import）
 *   - 加载层 `assets/script/app/HeadArt.ts`（含 `cc`，本文件只测它调到的那部分口径）
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import {
    EMPTY_ICON_ART, createIconArtResolver, loadIconByKey, packageFromIconPath, preloadIconKeys,
} from '../assets/script/app/HeadArtModel';
import { normalizeCardRow, parseCard } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { SpriteFrame } from 'cc';

const FRAME = { name: 'fake' } as unknown as SpriteFrame;

/** 真表：`assets/remoteRef/<表>.json`（压缩表 `{k,v,c}` 或行对象数组）。 */
function readRows(name: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Record<string, unknown>[]
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => Object.fromEntries(raw.k.map((key, i) => [key, row[i]])));
}

test('包名取 `ui://` 之后到第一个 / 之前的那段；没有 / 时为空串', () => {
    assert.equal(packageFromIconPath('ui://图标_兵种_头像/tx_icon_GB_SPL'), '图标_兵种_头像');
    assert.equal(packageFromIconPath('ui://图标/图标_头像_主角'), '图标');
    assert.equal(packageFromIconPath('ui://图标_武将/希尔瓦娜斯'), '图标_武将');
    // 没有 / → 解不出包名（无根目录 → 不该加载）
    assert.equal(packageFromIconPath('ui://什么都不带'), '');
    assert.equal(packageFromIconPath(''), '');
});

test('图标名 → 资源：目录由包名决定，包名没登记的一律 null', () => {
    const resolver = createIconArtResolver([
        // 兵种头像：老端 army.icon 那套，进 icons/cardHead
        { key: '兵种_头像_弓兵', path: 'ui://图标_兵种_头像/tx_icon_GB_SPL' },
        // 玩家头像：老端 guards.head / head 表那套，进 icons/head
        { key: '图标_头像_刺杀者', path: 'ui://图标/图标_头像_刺杀者' },
        { key: '图标_头像_凯尔萨斯', path: 'ui://图标/icon_hero_head_40010' },
        // `图标_武将` 也是玩家头像那批（general.head 用的）
        { key: '队长老头', path: 'ui://图标_武将/希尔瓦娜斯' },
        // 包名**没登记**（老端「兵种_卡牌_*」→ bz_*）：本工程没导入这批图，
        // 必须解不出来 —— 与其拼一个永远 load 不到的路径，不如明确"没有"
        { key: '兵种_卡牌_弓兵', path: 'ui://图标_兵种/bz_GB_SPL' },
        // path 为空 / key 为空 → 丢掉
        { key: '图标_头像_空路径', path: '' },
        { key: '', path: 'ui://图标/xxx' },
    ]);

    assert.deepEqual(resolver.resolve('兵种_头像_弓兵'),
        { art: 'tx_icon_GB_SPL', root: ArtPaths.CARD_HEAD_ART_ROOT }, '兵种头像进 cardHead');
    assert.deepEqual(resolver.resolve('图标_头像_刺杀者'),
        { art: '图标_头像_刺杀者', root: ArtPaths.HEAD_ART_ROOT }, '末段是中文名时照用（磁盘上就有这个文件名）');
    assert.deepEqual(resolver.resolve('图标_头像_凯尔萨斯'),
        { art: 'icon_hero_head_40010', root: ArtPaths.HEAD_ART_ROOT });
    assert.deepEqual(resolver.resolve('队长老头'),
        { art: '希尔瓦娜斯', root: ArtPaths.HEAD_ART_ROOT }, '图标_武将 也是玩家头像那批');

    assert.equal(resolver.resolve('兵种_卡牌_弓兵'), null, '未登记的包名 → null，不能拼出一个加载不到的路径');
    assert.equal(resolver.resolve('图标_头像_空路径'), null);
    assert.equal(resolver.resolve(''), null);
    assert.equal(resolver.resolve('表里没有的键'), null);
    // 表读不到时（缺 icon.json）恒 null —— 与"没这张图"同口径，调用方自然保留占位图
    assert.equal(createIconArtResolver(null).resolve('兵种_头像_弓兵'), null);
    assert.equal(createIconArtResolver(undefined).resolve('兵种_头像_弓兵'), null);
    assert.equal(EMPTY_ICON_ART.resolve('兵种_头像_弓兵'), null);

    // 两个根目录必须**不同** —— 这一列的存在理由就是它俩不是一回事
    assert.notEqual(ArtPaths.CARD_HEAD_ART_ROOT, ArtPaths.HEAD_ART_ROOT);
    assert.equal(ArtPaths.CARD_HEAD_ART_ROOT, 'icons/cardHead');
    assert.equal(ArtPaths.HEAD_ART_ROOT, 'icons/head');
});

test('loadIconByKey：解不出就**不调加载器**，且永远不 reject', async () => {
    const resolver = createIconArtResolver([
        { key: '兵种_头像_弓兵', path: 'ui://图标_兵种_头像/tx_icon_GB_SPL' },
        { key: '图标_头像_刺杀者', path: 'ui://图标/图标_头像_刺杀者' },
    ]);
    const asked: { name: string; root: string }[] = [];
    const loader = (name: string, root: string) => {
        asked.push({ name, root });
        return Promise.resolve(FRAME);
    };

    assert.equal(await loadIconByKey('兵种_头像_弓兵', resolver, loader), FRAME);
    assert.deepEqual(asked, [{ name: 'tx_icon_GB_SPL', root: ArtPaths.CARD_HEAD_ART_ROOT }]);

    // 两个根要真的分开：同一个 loader 被调用时 root 必须跟着键走
    asked.length = 0;
    await loadIconByKey('图标_头像_刺杀者', resolver, loader);
    assert.deepEqual(asked, [{ name: '图标_头像_刺杀者', root: ArtPaths.HEAD_ART_ROOT }]);

    // 解不出（键不对 / 没给 resolver / 空串）→ 一次加载都不该发：
    // 发了就是拿空串或错目录去 load，只会换回一条 warn + null，而调用方把 null 当"还没回来"白等。
    asked.length = 0;
    assert.equal(await loadIconByKey('兵种_卡牌_弓兵', resolver, loader), null);
    assert.equal(await loadIconByKey('', resolver, loader), null);
    assert.equal(await loadIconByKey('兵种_头像_弓兵', null, loader), null);
    assert.equal(await loadIconByKey('兵种_头像_弓兵', undefined, loader), null);
    assert.deepEqual(asked, [], '解不出就不该调 loader');

    // 预取：无效的跳过、有效的各调一次；**不 reject**（它是可选增强，不能把调用方带崩）
    asked.length = 0;
    await preloadIconKeys(['兵种_头像_弓兵', '', '兵种_卡牌_弓兵', '图标_头像_刺杀者'], resolver, loader);
    assert.deepEqual(asked, [
        { name: 'tx_icon_GB_SPL', root: ArtPaths.CARD_HEAD_ART_ROOT },
        { name: '图标_头像_刺杀者', root: ArtPaths.HEAD_ART_ROOT },
    ]);
    await preloadIconKeys(['兵种_头像_弓兵'], resolver, () => Promise.reject(new Error('load 炸了')));
});

test('loadIconByKey 是底层原语：加载器的错误**原样透传**', async () => {
    const resolver = createIconArtResolver([
        { key: '兵种_头像_弓兵', path: 'ui://图标_兵种_头像/tx_icon_GB_SPL' },
    ]);
    await assert.rejects(
        loadIconByKey('兵种_头像_弓兵', resolver, () => Promise.reject(new Error('load 炸了'))),
        /load 炸了/,
        '底层不吞错 —— 吞了调用方就分不清"没有这张图"和"加载器坏了"',
    );
});

test('parseCard 把 headIcon 带进 ZCDeckCard；留空 = undefined（不是空串）', () => {
    // 直接用**真表的一行**当夹具：`parseCard` 的必填列不少（baseHp / soilderAddTime /
    // cyclePerTierValue…），手拼 fixture 漏一个就报"必须是不小于 0 的数字"，
    // 而且那种报错跟本用例要验的 headIcon 毫无关系 —— 用真行能一次性绕开。
    const cards = readRows('pvpCard');
    // 只挑「配了 headIcon」的行 —— `deck` 列在 2026-09-20 合表时已下线，
    // 别再拿它当"出战卡"的判据（那样 find 恒 undefined，用例永远红）。
    const row = cards.find((r) => typeof r.headIcon === 'string' && r.headIcon);
    assert.ok(row, '真表里应存在"配了 headIcon"的行');

    const full = parseCard(normalizeCardRow(row!));
    assert.equal(full.headIcon, row!.headIcon);

    // 表里没这一列 → `undefined`，绝不能变成 `''`：消费方靠 `if (!card.headIcon)` 判断
    // "这张卡没有头像"，空串虽然等价，但会让人误以为是"配了、只是名字是空的"。
    const { headIcon: _dropped, ...withoutColumn } = row! as Record<string, unknown>;
    assert.equal(parseCard(normalizeCardRow(withoutColumn)).headIcon, undefined, '整列缺失');
    assert.equal(parseCard(normalizeCardRow({ ...row!, headIcon: '' })).headIcon, undefined, '留空');
});

test('真表 + 磁盘：pvpCard 的每一行 headIcon 都能解出资源名，且图确实在对应目录下', () => {
    const cards = readRows('pvpCard');
    const iconRows = readRows('icon') as { key?: unknown; path?: unknown }[];
    const resolver = createIconArtResolver(iconRows);

    const cardHead = new Set(readdirSync('assets/resources/icons/cardHead'));
    const head = new Set(readdirSync('assets/resources/icons/head'));

    assert.ok(cards.length >= 37, `pvpCard 应有 37 行，实际 ${cards.length}`);
    const filled: string[] = [];
    const missing: string[] = [];
    const unresolved: string[] = [];
    let blank = 0;

    for (const row of cards) {
        const id = String(row.id);
        // 未配 deck 的卡池行不能走 parseCard（会抛），所以只在出战卡/目录卡上验 headIcon 这一列。
        const headIcon = typeof row.headIcon === 'string' ? row.headIcon : '';
        if (!headIcon) {
            blank += 1;
            continue;
        }
        const target = resolver.resolve(headIcon);
        if (!target) {
            unresolved.push(`${id}(${row.name}) → ${headIcon}`);
            continue;
        }
        filled.push(headIcon);
        const pool = target.root === ArtPaths.CARD_HEAD_ART_ROOT ? cardHead : head;
        if (!pool.has(`${target.art}.png`)) missing.push(`${id}(${row.name}) → ${target.root}/${target.art}.png`);
    }

    assert.deepEqual(unresolved, [],
        'headIcon 必须在 icon.json 里且包名已登记（否则界面静默留白）');
    assert.deepEqual(missing, [], '解出来的每一张都必须已在磁盘上（否则就是 resources.load 的静默留白）');
    assert.ok(filled.length >= 32, `至少应有 32 张卡配了头像，实际 ${filled.length}`);
    assert.ok(blank >= 1, '骷髅战士 / 冰霜巨龙 / 亡灵法师 老端也没有头像，应当留空');
    // 两个目录都要真的被用到 —— 只填一个目录说明这批映射退化了
    assert.ok(filled.includes('兵种_头像_弓兵'), '兵种头像那批（icons/cardHead）必须有');
    assert.ok(filled.some((key) => key.startsWith('图标_头像_')),
        '玩家头像那批（icons/head，近卫 4 张）也必须有');
    // 2026-10-09：12 个有专属立绘的角色必须走自己的 key，不能再共用兵种级那张脸
    assert.ok(filled.includes('兵种_头像_豌豆游侠'),
        '豌豆游侠必须用角色专属头像（共用 兵种_头像_弓兵 就是这次改动被回滚了）');
});

test('真表 + 守卫：cardHead 目录里的图与 icon.json 的「兵种_头像_*」条目一一对应', () => {
    const iconRows = readRows('icon') as { key?: unknown; path?: unknown }[];
    const resolver = createIconArtResolver(iconRows);
    const onDisk = new Set(readdirSync('assets/resources/icons/cardHead')
        .filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));

    const mapped = new Set<string>();
    for (const row of iconRows) {
        const key = typeof row.key === 'string' ? row.key : '';
        if (!key.startsWith('兵种_头像_')) continue;
        const target = resolver.resolve(key);
        assert.ok(target, `icon.json 里的 ${key} 必须能解出来`);
        assert.equal(target!.root, ArtPaths.CARD_HEAD_ART_ROOT);
        mapped.add(target!.art);
    }
    // 2026-10-15 清理：army / advisor / monster 三张老表零活消费（代码 + 测试都无getTable），
    // 它们独占的 6 张兵种级头像（刀盾兵/斧盾兵/弓手民兵/战士民兵/法师民兵/枪兵民兵）
    // 连同 icon.json 条目一起清掉 ⇒ 50 → 44。
    assert.equal(mapped.size, 44,
        `icon.json 里应有 44 个「兵种_头像_*」条目（50 减去army/advisor/monster 独占的 6 张），实际 ${mapped.size}`);
    assert.deepEqual([...mapped].filter((a) => !onDisk.has(a)), [],
        'icon.json 里的每一个兵种头像都必须已导入 icons/cardHead（否则那张卡静默留白）');
});
