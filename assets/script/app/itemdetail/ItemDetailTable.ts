/**
 * 物品详情（老端 `LayerRolrItemDetail`，FGUI `组件_角色_道具详情.xml`）的判定口径与解析
 * —— 纯函数层，只依赖 core 的表行骨架，`tests/itemdetail.test.ts` 直接 import。
 *
 * 页面里带 `cc` 的部分不能进这里：链上出现 `import ... from 'cc'` 会让整组用例静默失效。
 *
 * 老端同屏有三套品质映射，真源各不相同，别混用：
 *
 * | 用途 | 真源 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * |---|---|---|---|---|---|---|---|---|---|
 * | 「品质:」文案 | `gameConfig.qualityname` | 普通 | 精良 | 优秀 | 史诗 | 传说 | 绝世 | 神话 | — |
 * | 标题缎带底图 | 控制器「品质」 | gray | green | blue | purple | yellow | red | caise | — |
 * | 物品框边框 | 控制器「品质」 | 白 | 绿 | 蓝 | 紫 | 橙 | 红 | 金 | 将 |
 *
 * 前 7 档同色系（quality 3 = 优秀 = 蓝 = blue），第 8 档只有物品框有（`pzk_11`「将」）。
 */

import { parseRowsToMap } from '../../core/table/RowParse';
import { toCount } from '../../core/value/Coerce';

// ============================================================
// 品质
// ============================================================

/**
 * `gameConfig.qualityname` 的兜底值（策划表读不到时用）。
 * 真源在表里，这里只是离线 / 未加载时的保底。
 */
export const QUALITY_NAME_FALLBACK = '普通,精良,优秀,史诗,传说,绝世,神话';

/**
 * 品质名。老端 `StringRef.GetQualityName` 把 1 基的品质减 1 后查 0 基的表，
 * 越界返回空串（老端是 `undefined`，`setText(undefined)` 会出错）。
 */
export function qualityNameOf(csv: string | null | undefined, quality: number): string {
    const names = (typeof csv === 'string' && csv.length > 0 ? csv : QUALITY_NAME_FALLBACK).split(',');
    const n = Math.floor(quality);
    if (!Number.isFinite(n)) return names[0] ?? '';
    const index = Math.max(n - 1, 0);
    return names[index] ?? '';
}

/** 标题缎带的图档名（quality 1..7 ⇒ gray..caise）。越界钳到 `gray`。 */
export const TITLE_ART_STEPS = ['gray', 'green', 'blue', 'purple', 'yellow', 'red', 'caise'] as const;

/**
 * 标题缎带用哪一档 —— 复刻 FGUI 控制器「品质」的 gearIcon。
 *
 * 原稿 7 个页（id 0..6，名 "1".."7"）配 `gearIcon` 与 `default="gray"`，
 * 老端按页名匹配：quality 1 落到未配图的第一页 ⇒ gray。即 1..7 → gray..caise。
 */
export function qualityTitleStepOf(quality: number): string {
    const n = Math.floor(quality);
    if (!Number.isFinite(n) || n < 1 || n > TITLE_ART_STEPS.length) return TITLE_ART_STEPS[0];
    return TITLE_ART_STEPS[n - 1];
}

/** 物品框品质框的档数（`组件_公用_道具` 的 8 个 `gearIcon` 值）。 */
export const QUALITY_FRAME_COUNT = 8;

/**
 * 物品框品质框用哪一档（quality 1..8 ⇒ `quality01`..`quality08`）。
 *
 * 第 8 档「将」在 FGUI 里换的是另一张 `icon_frame2`（`pzk_11`）；本工程只迁一张 Sprite，
 * 所以第 8 档直接换帧、不切节点。
 */
export function qualityFrameStepOf(quality: number): number {
    const n = Math.floor(quality);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, QUALITY_FRAME_COUNT);
}

/** 品质框档位 → `cu_quality_0N` 的 N（两位，1..8）。 */
export function qualityFrameSuffixOf(quality: number): string {
    const step = qualityFrameStepOf(quality);
    return step < 10 ? `0${step}` : String(step);
}

// ============================================================
// 数量
// ============================================================

/** 数量文案。老端 `Goods.GetNumberStr()`：`0 ⇒ ''`，其余纯整数不缩写。 */
export function itemNumberTextOf(number: number): string {
    if (!Number.isFinite(number) || Math.floor(number) === 0) return '';
    return String(Math.floor(number));
}

// ============================================================
// item 表
// ============================================================

/** `item` 表一行的收敛形状。 */
export interface IItemRow {
    readonly resId: number;
    readonly name: string;
    readonly desc: string;
    /** 物品大类（`GoodsType`）。 */
    readonly type: number;
    /** 使用类型。 */
    readonly useType: number;
    readonly quality: number;
    /** 图标：相对 `assets/resources/` 的路径（如 `icons/item/图鉴_帽子`）。 */
    readonly icon: string;
    /** 获取途径 id 列表（查 `viewtype` 表转文案）。 */
    readonly access: readonly number[];
    /** 「内容」格子的 resId 列表（老端 `ref.itemBox`）。 */
    readonly itemBox: readonly number[];
    /** 「前往」的跳转类型；老端用 `useJump > 0` 判「可使用」。 */
    readonly useJump: number;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function numList(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const out: number[] = [];
    for (const item of value) {
        const n = Number(item);
        if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
}

/** `item` 表的原始行 → `IItemRow`。字段缺失给安全默认，不抛错。 */
export function parseItemRow(raw: unknown): IItemRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = toCount(row.resId);
    if (resId <= 0) return null;
    return {
        resId,
        name: str(row.name),
        desc: str(row.desc),
        type: toCount(row.type),
        useType: toCount(row.useType),
        quality: Number.isFinite(Number(row.quality)) ? toCount(row.quality) : 1,
        icon: str(row.icon),
        access: numList(row.access),
        itemBox: numList(row.itemBox),
        useJump: toCount(row.useJump),
    };
}

/** `item` 全表 → `resId → IItemRow`。 */
export function parseItemRows(rows: readonly unknown[]): Map<number, IItemRow> {
    return parseRowsToMap(rows, parseItemRow, (one) => one.resId, { keep: 'last' });
}

// ============================================================
// 按钮 / 内容区的显隐
// ============================================================

/**
 * 界面下半部四块的显隐（由「有没有内容」+「能不能使用」+「能不能合成」推出）。
 *
 * 真源是 FGUI 控制器「类型」+ `UpdateComposBtn`：
 *   类型 0 有内容不可使用 / 1 有内容可使用 / 2 无内容不可使用 / 3 无内容可使用；
 *   `btn_go` 显示类型 1，`btn_go1` 显示类型 3，「内容」显示类型 0 或 1，
 *   合成按钮优先于 `btn_go1`。
 *
 * 老端 `btn_go` 与 `btn_compos` 会同时为 true（两者几何只差 2px，靠子节点顺序遮挡），
 * 这里改成三选一互斥，视觉等价，但不会出现两个按钮同时可点。
 */
export interface IItemDetailButtonState {
    /** 「内容」标题 + 内容格子容器。 */
    readonly showContent: boolean;
    /** `btn_go`（有内容可使用）。 */
    readonly showGo: boolean;
    /** `btn_go1`（无内容可使用）。 */
    readonly showGo1: boolean;
    /** `btn_compos`（碎片合成）。 */
    readonly showCompos: boolean;
}

export function typeStateOf(hasItemBox: boolean, useJump: number, canCompos: boolean): IItemDetailButtonState {
    const usable = Number.isFinite(useJump) && useJump > 0;
    return {
        showContent: hasItemBox,
        showCompos: canCompos,
        showGo: !canCompos && hasItemBox && usable,
        showGo1: !canCompos && !hasItemBox && usable,
    };
}

// ============================================================
// 获取途径（viewtype）
// ============================================================

/** `viewtype` 表一行。 */
export interface IViewTypeRow {
    readonly resId: number;
    readonly value: string;
}

export function parseViewTypeRows(rows: readonly unknown[]): Map<number, IViewTypeRow> {
    const out = new Map<number, IViewTypeRow>();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const resId = toCount(row.resId);
        if (resId <= 0) continue;
        out.set(resId, { resId, value: str(row.value) });
    }
    return out;
}

/** 途径行：文案 + 跳转 id。 */
export interface IItemAccessRef {
    readonly resId: number;
    readonly text: string;
}

/**
 * `access` 的 id 列表 → 「文案 + id」。
 *
 * 老端的渲染回调和点击回调用的是同一个 id（`viewtype.resId` 本身就是 `JUMP_TYPE` 的取值），
 * 所以文案与 id 必须成对保留：只留文案的话途径行点不动。
 * 查不到的 id 直接跳过，免得列表里出现点不动的空白条。
 */
export function accessRefsOf(
    viewTypes: ReadonlyMap<number, IViewTypeRow>,
    access: readonly number[],
): IItemAccessRef[] {
    const out: IItemAccessRef[] = [];
    for (const id of access) {
        const row = viewTypes.get(id);
        if (row && row.value) out.push({ resId: id, text: row.value });
    }
    return out;
}

/** 只要文案（`accessRefsOf` 的投影；单测与「只显示不点击」的场景用）。 */
export function accessTextsOf(viewTypes: ReadonlyMap<number, IViewTypeRow>, access: readonly number[]): string[] {
    return accessRefsOf(viewTypes, access).map((ref) => ref.text);
}

// ============================================================
// 碎片合成（itemCraft）
// ============================================================

/** `itemCraft` 表一行（主键是碎片自身的 resId，不是产物）。 */
export interface IItemCraftRow {
    readonly id: number;
    /** 合成需要的碎片数量。 */
    readonly number: number;
    /** 合成产物。 */
    readonly reward: { readonly resId: number; readonly number: number } | null;
}

export function parseItemCraftRows(rows: readonly unknown[]): Map<number, IItemCraftRow> {
    const out = new Map<number, IItemCraftRow>();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const id = toCount(row.id);
        if (id <= 0) continue;
        const rewardRaw = row.reward && typeof row.reward === 'object'
            ? (row.reward as Record<string, unknown>)
            : null;
        out.set(id, {
            id,
            number: toCount(row.number),
            reward: rewardRaw
                ? {
                    resId: toCount(rewardRaw.resId),
                    number: Number.isFinite(Number(rewardRaw.number)) ? toCount(rewardRaw.number) : 1,
                }
                : null,
        });
    }
    return out;
}

/**
 * 「合成」按钮显不显示。老端口径：
 * `craftRef != null && craftRef.number > 0 && 持有数量 >= craftRef.number`。
 *
 * `itemCraft` 是异步表，不预热的话这里恒 undefined，「合成」按钮永远不出现（静默）。
 * 本工程的预热在 `ItemDetailRepository.load()` 的 `readRows('itemCraft')`。
 */
export function canComposOf(craft: IItemCraftRow | undefined | null, owned: number): boolean {
    if (!craft) return false;
    if (!Number.isFinite(craft.number) || craft.number <= 0) return false;
    return Number.isFinite(owned) && owned >= craft.number;
}
