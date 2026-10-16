/**
 * 货币口径唯一出口（`common/ResTypes.ts`）的守卫。
 *
 * 这一组用例盯的是**"同一个货币在几处各写一遍"**这条老坑 —— 2026-09-29 之前工程里
 * 「某货币长什么样」手抄了三份（`MainResBarTypes.RES_BAR_ICON_ART` 按 `key`、
 * `GiftArt.GIFT_RES_ICON_ART` 按 `resId`、`MonthCardGiftTable.MONTHCARD_IMPORTED_CURRENCY_ART`
 * 又一份字面量），**目录还有两套**（`image/main/resbar` 与 `icons/resource` 里 5 张图有 4 张同 md5）。
 *
 * 所以这里全部**对着真表/磁盘**断言，不看实现：
 *   ① 两张真表（`roleProperty.json` / `open.json`）→ 逐条核解析结果；
 *   ② 手抄表的每一项都必须等于真表里的 `icon`（表改了不跟 ⇒ 用例红）；
 *   ③ 每张图真的在 `resIconRoot()` 解析出的目录下（默认 `icons/resource`，3 条例外查覆盖表）；
 *   ④ `resShowType` 里落在 `item` 表的 id 钉成快照（这些格需要背包数据源，不能悄悄少一格）。
 *
 * 只 import 零 `cc` 的模块（规则 78）：`ResTypes` 的依赖链只有 `ArtPaths` + `RequestGuard`。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { RESOURCE_ICON_ART_ROOT } from '../assets/script/app/ArtPaths';
import {
    FALLBACK_RES_ICON_ART,
    ITEM_TABLE,
    OPEN_TABLE,
    RES_BAR_MAX_SLOTS,
    ROLE_PROPERTY_TABLE,
    parseResKeys,
    resBarCellOfRefId,
    resIconArt,
    resIconOfKey,
    resIconRoot,
    resKeyOfRefId,
    resRefIdOfKey,
    resolveResBarCells,
    resolveResBarRefIds,
    unknownResIds,
    type IItemRefRow,
    type IOpenRefRow,
    type IResPropertyRow,
} from '../assets/script/app/common/ResTypes';
import { GIFT_RES_ICON_ART } from '../assets/script/app/gift/GiftArt';
import { MONTHCARD_IMPORTED_CURRENCY_ART } from '../assets/script/app/monthcard/MonthCardGiftTable';

const RESOURCES = 'assets/resources';

/** 读 `remoteRef/*.json`：两种形态都认（行对象数组 / `{k, v}` 打包）。 */
function readRows(file: string): Array<Record<string, unknown>> {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    const packed = raw as { k: string[]; v: unknown[][] };
    return packed.v.map((values) => Object.fromEntries(packed.k.map((key, i) => [key, values[i]])));
}

const PROP_ROWS = readRows('assets/remoteRef/roleProperty.json') as IResPropertyRow[];
const OPEN_ROWS = readRows('assets/remoteRef/open.json') as IOpenRefRow[];
const ITEM_ROWS = readRows('assets/remoteRef/item.json') as IItemRefRow[];

/** 真表里出现过的图标名集合（`roleProperty.icon`）。 */
const PROP_ICON_NAMES = new Set(
    PROP_ROWS.map((row) => (typeof row.icon === 'string' ? row.icon : '')).filter((one) => one !== ''),
);

/**
 * 剥掉行注释与块注释再断言 —— 规则 104：
 * 源码级**反向**断言（"不许出现 XXX"）必须先剥注释，否则注释里提到旧写法的说明文字会假红。
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── 表名 / 常量 ──────────────────────────────────────────────────────

test('表名与格数上限是常量，不是散落的字面量', () => {
    assert.equal(ROLE_PROPERTY_TABLE, 'roleProperty');
    assert.equal(OPEN_TABLE, 'open');
    assert.equal(ITEM_TABLE, 'item');
    assert.equal(RES_BAR_MAX_SLOTS, 3, '老端 组件_资源栏 的 组件_资源信息 摆位上限是 3');
});

test('货币图标目录只有一处真源：ArtPaths.RESOURCE_ICON_ART_ROOT', () => {
    assert.equal(RESOURCE_ICON_ART_ROOT, 'icons/resource');

    // 两个曾经的"第二份字面量"必须改成转发（源码级，因为这两个模块带 cc 不能 import）
    for (const file of ['assets/script/app/activity/LayerActivityArt.ts', 'assets/script/app/hang/HangArt.ts']) {
        const code = stripComments(readFileSync(file, 'utf8'));
        assert.doesNotMatch(code, /=\s*'icons\/resource'/, `${file} 又写了一份字面量，应当转发 ArtPaths`);
        assert.match(code, /RESOURCE_ICON_ART_ROOT as ART_RESOURCE_ICON_ROOT/, `${file} 没有从 ArtPaths 转发目录常量`);
    }

    // 顶部货币条与主界面 HUD 取图都必须走这个目录（不许回到 image/main/resbar）
    for (const file of ['assets/script/app/main/MainResBarArt.ts', 'assets/script/app/common/ResBar.ts']) {
        assert.doesNotMatch(
            stripComments(readFileSync(file, 'utf8')),
            /RESBAR_ART_ROOT/,
            `${file} 仍在用 HUD 专用目录取货币图`,
        );
    }
});

// ── `resKeys` 文本 ───────────────────────────────────────────────────

test('parseResKeys：逗号分隔、去空白、丢空串', () => {
    assert.deepEqual(parseResKeys('coin,gold'), ['coin', 'gold']);
    assert.deepEqual(parseResKeys(' coin , gold '), ['coin', 'gold']);
    assert.deepEqual(parseResKeys('end'), ['end']);
    // 空 / 只有分隔符 → 空数组（`ResBar` 据此整条不画，而不是画三个空壳）
    assert.deepEqual(parseResKeys(''), []);
    assert.deepEqual(parseResKeys(' , , '), []);
});

// ── 真表查询 ────────────────────────────────────────────────────────

test('roleProperty 真表：resId ↔ key ↔ icon 三向都对得上', () => {
    // 老端 open.json 里出现的枚举：6 gem / 7 gold / 9 end / 10 coin / 11 unionCoin / 12 unionGold / 14 jianGeCoin
    assert.equal(resKeyOfRefId(PROP_ROWS, 10), 'coin');
    assert.equal(resKeyOfRefId(PROP_ROWS, 7), 'gold');
    assert.equal(resKeyOfRefId(PROP_ROWS, 9), 'end');
    assert.equal(resKeyOfRefId(PROP_ROWS, 6), 'gem');
    assert.equal(resKeyOfRefId(PROP_ROWS, 11), 'unionCoin');
    assert.equal(resKeyOfRefId(PROP_ROWS, 14), 'jianGeCoin');

    assert.equal(resIconOfKey(PROP_ROWS, 'gold'), '图标_铜币');
    assert.equal(resIconOfKey(PROP_ROWS, 'coin'), '图标_幻灵玉');
    assert.equal(resIconOfKey(PROP_ROWS, 'end'), '图标_体力');

    assert.equal(resRefIdOfKey(PROP_ROWS, 'end'), 9);
    assert.equal(resRefIdOfKey(PROP_ROWS, 'coin'), 10);

    // 查不到不抛（新货币还没登记时要能安静跳过）
    assert.equal(resKeyOfRefId(PROP_ROWS, 99999), '');
    assert.equal(resIconOfKey(PROP_ROWS, 'nope'), '');
    assert.equal(resRefIdOfKey(PROP_ROWS, 'nope'), 0);
    // 表没读到时也要安全（登录前）
    assert.equal(resKeyOfRefId(null, 10), '');
    assert.equal(resIconOfKey(undefined, 'gold'), '');
});

test('兜底白名单与 roleProperty 真表逐条一致（表改了不跟 ⇒ 这条红）', () => {
    for (const [key, icon] of Object.entries(FALLBACK_RES_ICON_ART)) {
        assert.equal(
            resIconOfKey(PROP_ROWS, key),
            icon,
            `FALLBACK_RES_ICON_ART.${key} = ${icon}，但 roleProperty 表里是 ${resIconOfKey(PROP_ROWS, key)}`,
        );
    }
    // 兜底表里的每个键都得真在表里（不然就是凭空造的键）
    for (const key of Object.keys(FALLBACK_RES_ICON_ART)) {
        assert.ok(resRefIdOfKey(PROP_ROWS, key) > 0, `兜底表里的 key「${key}」在 roleProperty 表里不存在`);
    }
});

test('resIconArt：表优先，表缺失才落兜底白名单', () => {
    // 表在：以表为准（哪怕兜底表写错也能被真表纠正）
    assert.equal(resIconArt('gold', PROP_ROWS), '图标_铜币');
    // 表不在：落兜底（登录前也要有图，规则 140）
    assert.equal(resIconArt('gold', null), '图标_铜币');
    // 表在但键没登记、兜底也没有 → 空串（那格留白，不画上一格的图）
    assert.equal(resIconArt('mystery', PROP_ROWS), '');
    assert.equal(resIconArt('', PROP_ROWS), '');
});

// ── 「哪几格」：open.json 真源 ──────────────────────────────────────

test('resolveResBarRefIds/resolveResBarCells：天赋页 refId=18 ⇒ resShowType [10,7] ⇒ coin,gold', () => {
    assert.deepEqual(resolveResBarRefIds(18, OPEN_ROWS), [10, 7]);

    const cells = resolveResBarCells(18, OPEN_ROWS, PROP_ROWS, ITEM_ROWS);
    assert.deepEqual(cells.map((cell) => cell.key), ['coin', 'gold']);
    assert.deepEqual(cells.map((cell) => cell.kind), ['roleProperty', 'roleProperty']);
    assert.deepEqual(cells.map((cell) => cell.icon), ['图标_幻灵玉', '图标_铜币']);
    // 第 1 格是 coin（幻灵玉），顺序错了界面就会串格
    assert.equal(cells[0].refId, 10);
});

test('resolveResBarRefIds：战斗页 refId=3 ⇒ [10,7,9]，第 3 格是体力', () => {
    const cells = resolveResBarCells(3, OPEN_ROWS, PROP_ROWS, ITEM_ROWS);
    assert.deepEqual(cells.map((cell) => cell.key), ['coin', 'gold', 'end']);
    assert.deepEqual(cells.map((cell) => cell.icon), ['图标_幻灵玉', '图标_铜币', '图标_体力']);
});

test('没有 resShowType 时按老端口径继承 preResId（GetPreTlShowType）', () => {
    const openRows: IOpenRefRow[] = [
        { refId: 900, resShowType: [] as unknown[], preResId: 901 },
        { refId: 901, resShowType: [], preResId: 902 },
        { refId: 902, resShowType: [10, 7] },
    ];
    assert.deepEqual(resolveResBarRefIds(900, openRows), [10, 7]);
    // 整条链都没有 → 空数组（货币条整条不画，而不是瞎给三格）
    assert.deepEqual(resolveResBarRefIds(950, openRows), []);
    // 表里没有这个 refId → 空数组，不抛
    assert.deepEqual(resolveResBarRefIds(1, null), []);
});

test('resShowType 里的 id 必然落在 roleProperty 或 item 表上（unknown 清单必须是空的）', () => {
    const unknownAll: string[] = [];
    for (const row of OPEN_ROWS) {
        const cells = resolveResBarCells(row.refId, OPEN_ROWS, PROP_ROWS, ITEM_ROWS);
        for (const id of unknownResIds(cells)) unknownAll.push(`${row.refId}/${id}`);
    }
    assert.deepEqual(unknownAll, [], `这些 resShowType 的 id 两张表都查不到，货币条会少格子：${unknownAll.join(', ')}`);
});

test('落在 item 表的 resShowType 格钉成快照（要画它们得先接背包数据源）', () => {
    const itemCells: string[] = [];
    for (const row of OPEN_ROWS) {
        const cells = resolveResBarCells(row.refId, OPEN_ROWS, PROP_ROWS, ITEM_ROWS);
        for (const cell of cells) {
            if (cell.kind !== 'item') continue;
            // 图标路径必须解析得出来，否则那一格只剩个空壳
            assert.ok(cell.icon.length > 0, `${row.refId} 的 ${cell.refId} 落在 item 表但没有 icon`);
            itemCells.push(`${cell.refId}(${cell.icon})`);
        }
    }
    assert.deepEqual(
        Array.from(new Set(itemCells)),
        [
            // 通用道具（`item.icon` 是相对 resources 的路径，直通不再拼目录）
            '16014(icons/common/图标_突破丹)', // 天赋石（TabRoleMain）
            '10901(icons/common/图标_请神酒)', // 啤酒
            '10993(icons/item/图标_金钥匙)', // 吉骨（转盘活动）
            '10994(icons/item/图标_金钥匙)', // 远航商币
            '10998(icons/item/图标_金钥匙碎片)', // 圣殿圣币碎片
            '10910(icons/item/图标_金钥匙)', // 观星仪
            '10302(icons/common/图标_武库石板)', // 武库石板
        ],
        'item 支清单变了：新出现的是"多了个货币格"，消失的是"某页少了格"，都要先确认',
    );
});

test('resBarCellOfRefId：roleProperty 优先于 item，两张都没有给 unknown', () => {
    const prop = resBarCellOfRefId(10, PROP_ROWS, ITEM_ROWS);
    assert.equal(prop.kind, 'roleProperty');
    assert.equal(prop.iconIsPath, false);

    const item = resBarCellOfRefId(16014, PROP_ROWS, ITEM_ROWS);
    assert.equal(item.kind, 'item');
    assert.equal(item.iconIsPath, true, 'item 表的 icon 是相对 resources 的路径（直通，不能再拼目录）');

    const none = resBarCellOfRefId(987654, PROP_ROWS, ITEM_ROWS);
    assert.equal(none.kind, 'unknown');
    assert.equal(none.icon, '');
});

// ── 磁盘核对 ────────────────────────────────────────────────────────

test('roleProperty 的每张货币图都在 resIconRoot() 解析出的目录下（漏一张 = 某格静默留白）', () => {
    // ⚠️ 不是「都在 icons/resource」—— 有 3 张例外（联盟贡献 / 补天神石落 `icons/common`、
    //    经验值落 `image/main/resbar`，见 ROLE_PROPERTY_ICON_ROOT_OVERRIDE）。这里跟着
    //    `resIconRoot()` 走，与 `resolveRewardIconRef` 同口径；例外表本身由 B11 复算。
    const missing: string[] = [];
    for (const name of PROP_ICON_NAMES) {
        if (!existsSync(`${RESOURCES}/${resIconRoot(name)}/${name}.png`)) missing.push(name);
    }
    assert.deepEqual(
        missing,
        [],
        `这些 roleProperty.icon 没有对应美术（新增货币时按规则 138 导入）：${missing.join(', ')}`,
    );
});

test('月卡/礼包的手抄映射与真表一致（不许各写一份）', () => {
    // 礼包按 resId 索引
    for (const [resId, icon] of Object.entries(GIFT_RES_ICON_ART)) {
        assert.equal(
            resIconOfKey(PROP_ROWS, resKeyOfRefId(PROP_ROWS, Number(resId))),
            icon,
            `GIFT_RES_ICON_ART[${resId}] = ${icon}，与 roleProperty 表不一致`,
        );
        assert.ok(
            existsSync(`${RESOURCES}/${resIconRoot(icon)}/${icon}.png`),
            `GIFT_RES_ICON_ART[${resId}] 的图 ${icon} 在 ${resIconRoot(icon)} 下不存在`,
        );
    }

    // 月卡的预加载清单：每张都得是真表里的图标名（值已由 ResTypes 派生，这里防的是"手抄回来"）
    for (const icon of MONTHCARD_IMPORTED_CURRENCY_ART) {
        assert.ok(PROP_ICON_NAMES.has(icon), `MONTHCARD_IMPORTED_CURRENCY_ART 里的「${icon}」不在 roleProperty 表里`);
        assert.ok(
            existsSync(`${RESOURCES}/${resIconRoot(icon)}/${icon}.png`),
            `月卡预加载清单里的「${icon}」缺美术`,
        );
    }
});

test('GIFT_RES_ICON_ART 覆盖的 resId 都在真表里（含补上的 8 洗炼石）', () => {
    assert.equal(GIFT_RES_ICON_ART[8], '图标_洗炼石');
    assert.ok(
        existsSync(`${RESOURCES}/${RESOURCE_ICON_ART_ROOT}/图标_洗炼石.png`),
        '2026-09-29 起 icons/resource/图标_洗炼石.png 已存在，8 不该再走"只画品质框"的降级',
    );
    for (const resId of Object.keys(GIFT_RES_ICON_ART)) {
        assert.ok(resKeyOfRefId(PROP_ROWS, Number(resId)) !== '', `${resId} 在 roleProperty 表里查不到 key`);
    }
});
