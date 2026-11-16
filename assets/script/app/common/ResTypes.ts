/**
 * 资源 / 货币口径的唯一出口（零引擎依赖，可被 Node 用例直接 import）。
 *
 * 真源是 `roleProperty.json`：`resId` / `key` / `name` / `icon`（FGUI 裸组件名）/ `quality`。
 * 本文件负责「数字 ↔ key ↔ 图标名」互查，以及 `open.json` 决定「显示哪几格」：
 * 自己有 `resShowType` 就用自己，否则沿 `preResId` 继承（老端 `GetTlShowType` 口径）。
 * 图标目录由 `ArtPaths` + `resIconRoot` 解析，视觉装配仍走既有 `resolveRewardIconRef` 链路。
 *
 * 手抄映射只作登录前兜底（`FALLBACK_RES_ICON_ART`），表落地后以表为准。
 */
import {
    COMMON_ICON_ART_ROOT as ART_COMMON_ICON_ROOT,
    RESBAR_ART_ROOT,
    RESOURCE_ICON_ART_ROOT,
    spriteFramePath,
    spriteFramePathOf,
} from '../ArtPaths';
import { toCount } from '../../core/value/Coerce';
import { asRow, parseRowsToMap } from '../../core/table/RowParse';
import {
    ITEM_TABLE as CORE_ITEM_TABLE,
    OPEN_TABLE as CORE_OPEN_TABLE,
    ROLE_PROPERTY_TABLE as CORE_ROLE_PROPERTY_TABLE,
} from '../../core/config/TableNames';
import type { IResGoodsInfo } from '../../core/types/Reward';

export type { IResGoodsInfo };

/** 顶部货币条最多几格（老端 `组件_资源栏` 里 `组件_资源信息` 的摆位上限）。 */
export const RES_BAR_MAX_SLOTS = 3;

/** `roleProperty` 表名（`RefUtil` 的 `resName`，不带后缀）。 */
export const ROLE_PROPERTY_TABLE = CORE_ROLE_PROPERTY_TABLE;

/** `open.json` 的表名（`RefBase._RefMgropen` / `RefMgrBase('open')`）。 */
export const OPEN_TABLE = CORE_OPEN_TABLE;

/** `item` 表名（`resShowType` 里那些不是 `roleProperty` 的 id 落这张表）。 */
export const ITEM_TABLE = CORE_ITEM_TABLE;

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
 * `key` → 图标名兜底表。只在 `roleProperty` 表读不到（登录前 / 表未落地）时用。
 * 真源是表：`tests/res-types.test.ts` 会拿这张表与 `roleProperty.json` 逐条比对，防止手抄漂移。
 */
export const FALLBACK_RES_ICON_ART: Readonly<Record<string, string>> = {
    gold: '图标_铜币',
    gem: '图标_灵石',
    end: '图标_体力',
    coin: '图标_幻灵玉',
    exp: '图标_经验值',
};

/**
 * 通用图标目录（`icons/common`）：`item` 表按路径直通的图，以及少量 `roleProperty` 图标。
 * 值转发 `ArtPaths.COMMON_ICON_ART_ROOT`；别写成 `ArtPaths.COMMON_ART_ROOT`（那是 `image/common`，
 * 通用底图与按钮，不是图标目录，名字像但不是一个东西）。
 */
export const COMMON_ICON_ART_ROOT = ART_COMMON_ICON_ROOT;

/**
 * `roleProperty` 里不落 `icons/resource/` 的裸名图标，必须逐名覆盖，不能猜。
 *
 * 老端 `icon` 是 FGUI 资源名，由 FGUI 包查找定位，名字里不含目录；本端把图平铺到
 * `resources/image|icons/*`，所以「这个名字当初拷进哪个目录」只能查实盘：
 *   - `icons/common/`：图标_联盟贡献、图标_补天神石；
 *   - `image/main/resbar/`：图标_经验值；
 *   - 其余默认 `icons/resource/`。
 *
 * 只认 `icons/resource` 的症状是这 3 张图静默加载失败（加载器只 warn 并返回 null），
 * 奖励格只剩品质框。`tests/league-store-donate-discount.test.ts` 会拿真表现算实盘位置，
 * 与这张表逐条对齐；美术挪目录或表里新增例外，用例立刻红。
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
 * `refId` → 货币条要显示的 `key` 列表（顺序即从左到右）。
 *
 * 规则对齐老端 `ModelSystem.GetTlShowType()`：自己的 `resShowType` 非空就用它；
 * 否则沿 `preResId` 继承（递归，`MAX_PRE_DEPTH` 封顶）；都没有返回空数组。
 * 查不到 `key` 的 `resId` 跳过 —— 没有 key 就取不到数值，硬占一格只会显示 0；
 * 用 `resolveResBarCells` + `unknownResIds` 可以把这些格子列出来催表。
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

/** `item` 全表 → `resId` → 展示字段；同 resId 后写覆盖（与 activity 口径一致）。 */
export function parseItemRows(rows: readonly unknown[]): Map<number, IResGoodsInfo> {
    return parseRowsToMap(rows, (row) => {
        const resId = toCount(row.resId);
        if (resId <= 0) return null;
        return {
            name: typeof row.name === 'string' ? row.name : '',
            quality: toCount(row.quality),
            icon: typeof row.icon === 'string' ? row.icon : '',
            iconIsPath: true,
        };
    }, (one) => one.resId, { keep: 'last' });
}

/** `roleProperty` 全表 → `resId` → 展示字段；同 resId 后写覆盖。 */
export function parseRolePropertyRows(rows: readonly unknown[]): Map<number, IResGoodsInfo> {
    const map = new Map<number, IResGoodsInfo>();
    for (const raw of rows ?? []) {
        const row = asRow(raw);
        if (!row) continue;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        map.set(resId, {
            name: typeof row.name === 'string' ? row.name : '',
            quality: toCount(row.quality),
            icon: typeof row.icon === 'string' ? row.icon : '',
            iconIsPath: false,
        });
    }
    return map;
}

/** 一个奖励 `resId` 的展示信息：`item` 表优先，查不到再回落 `roleProperty`。 */
export function rewardGoodsOf(
    resId: number,
    items: ReadonlyMap<number, IResGoodsInfo>,
    resources: ReadonlyMap<number, IResGoodsInfo>,
): IResGoodsInfo | null {
    return items.get(resId) ?? resources.get(resId) ?? null;
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
 * {@link IResBarCell} → 可交给 `AssetService.load` 的装配路径（已带 `/spriteFrame`）；
 * 解析不出（kind = unknown / 表里没填 icon）返回空串。
 *
 * 两种 icon 的拼法不同：`roleProperty` 是 FGUI 裸名，拼 `spriteFramePath(resIconRoot(name), name)`；
 * `item` 是相对某个 bundle 的路径（如 `icons/item/图标_兵书弓兵`），拼 `spriteFramePathOf(path)`。
 * 少拼 `/spriteFrame` 会报 `Bundle resources doesn't contain …`（不是 404）；
 * 把 item 图当 resources 相对路径则静默返回 null，表现是飘字 / 喷发颗粒没有图标。
 *
 * bundle 路由不在这里做：`CocosAssetService` 按路径前缀查 `BundleCatalog` 自动选 bundle。
 */
export function resBarIconSpritePath(cell: IResBarCell | null | undefined): string {
    const name = textOf(cell?.icon);
    if (!name) return '';
    return cell?.iconIsPath
        ? spriteFramePathOf(name)
        : spriteFramePath(resIconRoot(name), name);
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
