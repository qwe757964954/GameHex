/**
 * **资源 / 货币口径的唯一出口**（零引擎依赖，规则 78 —— 判定逻辑可被 Node 用例 import）。
 *
 * ## 为什么要有这个文件（2026-09-29）
 *
 * 「某一种货币长什么样」在工程里曾经**手抄了三份**，而且目录也分两套：
 *
 * | # | 位置 | 形态 | 目录 |
 * |---|---|---|---|
 * | ① | `main/MainResBarTypes.RES_BAR_ICON_ART` | 按 `key` 手抄 5 条 | `image/main/resbar/` |
 * | ② | `gift/GiftArt.GIFT_RES_ICON_ART` | 按 `resId` 手抄 4 条 | `image/main/resbar/` |
 * | ③ | **真源** `assets/remoteRef/roleProperty.json` | `resId` / `key` / `name` / `icon` | —— |
 *
 * 而「图标怎么装配」工程里**早就有一个唯一入口**：`activity/LayerActivityArt.resolveRewardIconRef`
 * （老端 `ModelGoods.GetGoodsIconKeyByRefId` 的两支）——`item` 表直通路径 / `roleProperty` 表落
 * `icons/resource/<icon>`（**3 条例外见下面的 `ROLE_PROPERTY_ICON_ROOT_OVERRIDE`**，统一由
 * `resIconRoot()` 解析），被 `hang` / `gift` / `celebration` / `battletoken` / `league` / `showReward` 共用。
 *
 * ⚠️ 于是「顶部货币条」当时**长出了第二套目录**：`image/main/resbar/` 里那 5 张货币图有 4 张
 * 与 `icons/resource/` **同一份文件（同 md5）**。两份图 + 三份映射，改一个货币要动四个地方。
 *
 * ⇒ 本文件把「数字 ↔ `key` ↔ 图标名」收敛成一处，并把「显示哪几格」的来源统一到
 *   **`open.json.resShowType`**（老端口径，见 `ModelSystem.GetTlShowType`）。
 *   视觉与装配仍交给 `resolveRewardIconRef` 那条既有链路，本文件**不碰 cc**。
 *
 * ## 真源字段（`roleProperty.json`，17 行）
 *
 * | 字段 | 含义 | 例子 |
 * |---|---|---|
 * | `resId` | `open.json.resShowType` 里写的那个数字 | `10` |
 * | `key` | `CmdRole` 缓存的字段名（`buildResBarView` 靠它取值） | `coin` |
 * | `name` | 中文名（提示文案用） | `金币` |
 * | `icon` | **FGUI 裸组件名**（不是路径！） | `图标_幻灵玉` |
 * | `quality` | 品质（奖励格描边用） | `3` |
 *
 * ## 「哪几格」的真源与继承
 *
 * `open.json` 每条页面/弹窗都有 `resShowType`（`refId=18` 天赋 ⇒ `[10,7]`）。老端
 * `ModelSystem.GetTlShowType()` 的完整规则是：**自己有 `resShowType` 就用自己**；
 * 否则**继承 `preResId` 指向的那个系统**。工程里 `resShowType` 基本都填了，但 `preResId`
 * 仍在表里（如 `TabSkill` `preResId=2`），所以这里实现成 `resolveResBarKeys(refId, …)`
 * 一次到位，页面只填一个 `refId`。
 */
import {
    COMMON_ICON_ART_ROOT as ART_COMMON_ICON_ROOT,
    RESBAR_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
} from '../ArtPaths';
import { toCount } from '../net/RequestGuard';

/** 顶部货币条最多几格（老端 `组件_资源栏` 里 `组件_资源信息` 的摆位上限）。 */
export const RES_BAR_MAX_SLOTS = 3;

/** `roleProperty` 表名（`RefUtil` 的 `resName`，不带后缀）。 */
export const ROLE_PROPERTY_TABLE = 'roleProperty';

/** `open.json` 的表名（`RefBase._RefMgropen` / `RefMgrBase('open')`）。 */
export const OPEN_TABLE = 'open';

/** `item` 表名（`resShowType` 里那些不是 `roleProperty` 的 id 落这张表）。 */
export const ITEM_TABLE = 'item';

/** 继承链最深几层（防表里配出环）。老端只有一层 `preResId`，这里放宽到 8 层够用。 */
const MAX_PRE_DEPTH = 8;

/** `roleProperty` 行：只声明本模块用到的字段，避免把生成类型拖进来。 */
export interface IResPropertyRow {
    readonly resId?: unknown;
    readonly key?: unknown;
    readonly name?: unknown;
    readonly icon?: unknown;
    readonly quality?: unknown;
}

/** `open.json` 行：本模块只用这三个字段。 */
export interface IOpenRefRow {
    readonly refId?: unknown;
    readonly resShowType?: unknown;
    readonly preResId?: unknown;
    readonly url?: unknown;
}

/**
 * `key` → 图标名 **兜底表**。
 *
 * ⚠️ 只在 `roleProperty` 表读不到（登录前 / 表未落地）时用。真源是表，不是这里 ——
 *  `tests/res-types.test.ts` 会逐条比对这张表与 `roleProperty.json`，表改了而这里没跟
 *  ⇒ 用例红（防住"手抄表悄悄漂移"这条老坑）。
 */
export const FALLBACK_RES_ICON_ART: Readonly<Record<string, string>> = {
    gold: '图标_铜币',
    gem: '图标_灵石',
    end: '图标_体力',
    coin: '图标_幻灵玉',
    exp: '图标_经验值',
};

/**
 * 通用图标目录（`icons/common`）：`item` 表里**按路径直通**的那些图落这里，
 * `roleProperty` 也有少量（见下面的例外表）。
 *
 * ⚠️ 值转发 `ArtPaths.COMMON_ICON_ART_ROOT` —— 别写成 `ArtPaths.COMMON_ART_ROOT`
 * （那是 `image/common`，通用底图与按钮，**不是图标目录**，名字像但不是一个东西）。
 */
export const COMMON_ICON_ART_ROOT = ART_COMMON_ICON_ROOT;

/**
 * `roleProperty` 里**不落 `icons/resource/`** 的裸名图标 —— 必须逐名覆盖，不能猜。
 *
 * ## 为什么不能猜
 *
 * 老端的 `roleProperty.icon` 是 **FGUI 资源名**，由 FGUI 的**包查找**去定位
 * （`ModelGoods.GetGoodsIconKeyByRefId` → `ref.icon` → FGUI loader 自己解析），
 * 名字里**不含目录信息**。本端把 FGUI 图平铺到了 `resources/image|icons/*`，
 * 「这个名字当初被拷进了哪个目录」就只能查实盘。
 *
 * ## 实测口径（`roleProperty` 全 17 行、11 行有 `icon`）
 *
 * | 落在哪 | 张数 | 例子 |
 * |---|---|---|
 * | `icons/resource/`（默认） | **8** | 银币 7 / 洗炼石 8 / 幻灵玉 10 / 联盟金币 11 / 活跃度 15 … |
 * | `icons/common/` | **2** | 联盟贡献 13 `图标_联盟贡献`、补天神石 14 `图标_补天神石` |
 * | `image/main/resbar/` | **1** | 经验值 3 `图标_经验值` |
 *
 * ⚠️ **只认 `icons/resource` 的症状**：这 3 张图**静默**加载失败（加载器只 `console.warn`、
 * 返回 `null` ⇒ 奖励格只剩品质框、弹窗里少一格图），不报错、不崩 —— 端到端探针量
 * 「格子有没有图标」才逮得到。实测就是用户报的
 * `[ArtIcons] 图标加载失败：icons/resource/图标_联盟贡献`（联盟捐献的奖励格）。
 *
 * ⚠️ **为什么是「覆盖表」而不是把这 3 张图再拷一份到 `icons/resource/`**：
 *    `item` 表里同名的图已经在 `icons/common/`（`item.json` 的 `图标_联盟贡献` 存的是
 *    路径 `icons/common/图标_联盟贡献`）⇒ 再拷一份就是**同内容两个 uuid**，
 *    以后谁改了哪份说不清（同内容两份资源在 Cocos 里就是两个 uuid）。
 *
 * ⚠️ **有防锈测试**：`tests/league-store-donate-discount.test.ts` 的 B11 会拿
 *    `assets/remoteRef/roleProperty.json` **现算**每个 `icon` 的实盘位置，与这里逐条对齐；
 *    美术挪了目录 / 表里新增了例外，用例立刻红。
 */
export const ROLE_PROPERTY_ICON_ROOT_OVERRIDE: Readonly<Record<string, string>> = {
    '图标_联盟贡献': COMMON_ICON_ART_ROOT,
    '图标_补天神石': COMMON_ICON_ART_ROOT,
    '图标_经验值': RESBAR_ART_ROOT,
};

/**
 * 裸图标名 → 该去哪个目录取。**默认 `icons/resource`，例外查 {@link ROLE_PROPERTY_ICON_ROOT_OVERRIDE}**。
 *
 * 与 `activity/LayerActivityArt.resolveRewardIconRef` 的 `roleProperty` 支**同口径** ——
 * 改这里就是改全工程，调用方别再写死目录。
 */
export function resIconRoot(name: string): string {
    return ROLE_PROPERTY_ICON_ROOT_OVERRIDE[name] ?? RESOURCE_ICON_ART_ROOT;
}

/** `resKeys` 文本 → 键数组（逗号分隔，去空白 / 去空串；顺序即从左到右）。 */
export function parseResKeys(text: string): readonly string[] {
    if (!text) return [];
    return text
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '');
}

/** 文本字段安全取值（非字符串 / 空串一律当没有）。 */
function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** `resId` → `key`；查不到返回空串（**不抛**：表里还没登记的新货币要能安静跳过）。 */
export function resKeyOfRefId(rows: readonly IResPropertyRow[] | null | undefined, refId: unknown): string {
    const want = toCount(refId);
    if (!rows || want <= 0) return '';
    for (const row of rows) {
        if (!row) continue;
        if (toCount(row.resId) === want) return textOf(row.key);
    }
    return '';
}

/** `key` → `icon`（FGUI 裸组件名）；查不到返回空串。 */
export function resIconOfKey(rows: readonly IResPropertyRow[] | null | undefined, key: unknown): string {
    const want = textOf(key);
    if (!rows || want === '') return '';
    for (const row of rows) {
        if (!row) continue;
        if (textOf(row.key) === want) return textOf(row.icon);
    }
    return '';
}

/** `key` → `resId`；查不到返回 0（礼包那类按 `resId` 组装的场景要反查）。 */
export function resRefIdOfKey(rows: readonly IResPropertyRow[] | null | undefined, key: unknown): number {
    const want = textOf(key);
    if (!rows || want === '') return 0;
    for (const row of rows) {
        if (!row) continue;
        if (textOf(row.key) === want) return toCount(row.resId);
    }
    return 0;
}

/**
 * `key` → 图标名。**表优先，表缺失/未登记时落兜底白名单**（登录前也要有图，规则 140）。
 */
export function resIconArt(key: unknown, rows?: readonly IResPropertyRow[] | null): string {
    const name = textOf(key);
    if (name === '') return '';
    return resIconOfKey(rows, name) || FALLBACK_RES_ICON_ART[name] || '';
}

/** 在 `open.json` 全表里按 `refId` 取行。 */
export function openRowOfRefId(
    openRows: readonly IOpenRefRow[] | null | undefined,
    refId: unknown,
): IOpenRefRow | null {
    const want = toCount(refId);
    if (!openRows || want <= 0) return null;
    for (const row of openRows) {
        if (!row) continue;
        if (toCount(row.refId) === want) return row;
    }
    return null;
}

/** `open.json` 一行的 `resShowType` → 数字数组（非数组 / 空 ⇒ 空数组）。 */
export function resShowTypeOf(row: IOpenRefRow | null | undefined): readonly number[] {
    const raw = row?.resShowType;
    if (!Array.isArray(raw)) return [];
    const out: number[] = [];
    for (const one of raw) {
        const id = toCount(one);
        if (id > 0) out.push(id);
    }
    return out;
}

/**
 * `refId` → 货币条要显示的 `key` 列表（**顺序即从左到右**）。
 *
 * 规则与老端 `ModelSystem.GetTlShowType()` 对齐：
 *   ① 自己的 `resShowType` 非空 ⇒ 用它；
 *   ② 否则继承 `preResId` 指向的系统（递归，`MAX_PRE_DEPTH` 封顶）；
 *   ③ 都没有 ⇒ 空数组（页面货币条整条不显示，而不是瞎给三格）。
 *
 * 查不到 `key` 的 `resId`（表里还没登记的新货币）**跳过** —— 没有 `key` 就取不到数值，
 * 硬占一格只会显示 0。用 `unmappedResIds()` 可以把这些 id 列出来催表。
 */
export function resolveResBarRefIds(
    refId: unknown,
    openRows: readonly IOpenRefRow[] | null | undefined,
): readonly number[] {
    let current = toCount(refId);
    for (let depth = 0; depth < MAX_PRE_DEPTH && current > 0; depth++) {
        const row = openRowOfRefId(openRows, current);
        if (!row) return [];
        const showType = resShowTypeOf(row);
        if (showType.length > 0) return showType;
        // 自己没有 ⇒ 继承前置系统（老端 GetPreTlShowType）
        current = toCount(row.preResId);
    }
    return [];
}

/** `item` 表行：本模块只用这几个字段（`icon` 是**相对 resources 的路径**）。 */
export interface IItemRefRow {
    readonly resId?: unknown;
    readonly name?: unknown;
    readonly icon?: unknown;
    readonly quality?: unknown;
}

/**
 * 货币条上的一格 —— 「谁 / 图标画什么 / 数值从哪取」。
 *
 * 口径对齐老端 `ModelGoods.GetGoodsTypeByResId` 的两支（`GetGoodsIconKeyByRefId` 同款分流）：
 *
 * | `kind` | 判定 | `icon` 是 | 数值来源 |
 * |---|---|---|---|
 * | `roleProperty` | `roleProperty.resId` 查得到 | FGUI 裸名（落 `icons/resource/`） | `CmdRole[key]` |
 * | `item` | 否则 `item.resId` 查得到 | **相对 resources 的路径** | 道具数量（需背包数据源） |
 * | `unknown` | 两张表都没有 | —— | 没有（调用方跳过 + 留痕） |
 */
export interface IResBarCell {
    readonly refId: number;
    readonly kind: 'roleProperty' | 'item' | 'unknown';
    /** `kind = roleProperty` 时的 `CmdRole` 字段名；其它情况空串。 */
    readonly key: string;
    /** `kind = roleProperty` 时是 FGUI 裸名，`kind = item` 时是资源路径。 */
    readonly icon: string;
    readonly iconIsPath: boolean;
    readonly name: string;
}

/** `item.resId` → 行；查不到返回 `null`。 */
export function itemRowOfResId(
    rows: readonly IItemRefRow[] | null | undefined,
    resId: unknown,
): IItemRefRow | null {
    const want = toCount(resId);
    if (!rows || want <= 0) return null;
    for (const row of rows) {
        if (!row) continue;
        if (toCount(row.resId) === want) return row;
    }
    return null;
}

/** 单个 `refId` → 一格描述（`roleProperty` 优先，其次 `item`，都没有给 `unknown`）。 */
export function resBarCellOfRefId(
    refId: number,
    propRows: readonly IResPropertyRow[] | null | undefined,
    itemRows?: readonly IItemRefRow[] | null,
): IResBarCell {
    const prop = propRows?.find((row) => row && toCount(row.resId) === refId);
    if (prop) {
        return {
            refId,
            kind: 'roleProperty',
            key: textOf(prop.key),
            icon: textOf(prop.icon),
            iconIsPath: false,
            name: textOf(prop.name),
        };
    }
    const item = itemRowOfResId(itemRows, refId);
    if (item) {
        return {
            refId,
            kind: 'item',
            key: '',
            icon: textOf(item.icon),
            iconIsPath: true,
            name: textOf(item.name),
        };
    }
    return { refId, kind: 'unknown', key: '', icon: '', iconIsPath: false, name: '' };
}

/**
 * `refId`（`open.json` 的页面/弹窗）→ **货币条要摆的格子列表**（顺序 = 从左到右）。
 *
 * `unknown` 的格子**也会返回**（由调用方决定跳过还是占位）—— 静默丢掉会让"少了哪一格"
 * 变得无从查起；`tests/res-types.test.ts` 会把当前 `unknown` 清单钉成快照。
 */
export function resolveResBarCells(
    refId: unknown,
    openRows: readonly IOpenRefRow[] | null | undefined,
    propRows: readonly IResPropertyRow[] | null | undefined,
    itemRows?: readonly IItemRefRow[] | null,
): readonly IResBarCell[] {
    const seen = new Set<number>();
    const cells: IResBarCell[] = [];
    for (const id of resolveResBarRefIds(refId, openRows)) {
        if (seen.has(id)) continue;
        seen.add(id);
        cells.push(resBarCellOfRefId(id, propRows, itemRows));
    }
    return cells;
}

/** 格子列表里 `kind = unknown` 的 `refId`（**表缺口清单**，用于催表/守卫）。 */
export function unknownResIds(cells: readonly IResBarCell[]): readonly number[] {
    return cells.filter((cell) => cell.kind === 'unknown').map((cell) => cell.refId);
}
