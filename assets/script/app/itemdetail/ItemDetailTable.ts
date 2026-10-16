/**
 * 物品详情（老端 `LayerRolrItemDetail`，FGUI `主界面_角色/组件/道具/组件_角色_道具详情.xml`）
 * 的**判定口径与解析** —— 零 import 纯函数层。
 *
 * ## 为什么单独一层（项目规则：判定逻辑要能单测）
 *
 * 老端 `LayerRoleItemDetailUI.InitUI()` 里的每一句判定（品质名、类型控制器、合成按钮）
 * 都散在带 `cc` 的页面脚本里。本文件把它们**原样搬成纯函数**，
 * `tests/itemdetail.test.ts` 走 Node 直接 import —— 链上任何一个 `import ... from 'cc'`
 * 都会让整组用例 `Cannot find module 'cc'` 静默失效。
 *
 * ## 三个「品质」体系（⚠️ 别混）
 *
 * 老端同屏有**三套**品质映射，各自真源不同，值不同名也不同：
 *
 * | 用途 | 真源 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * |---|---|---|---|---|---|---|---|---|---|
 * | 「品质:」文案 | `gameConfig.qualityname` | 普通 | 精良 | 优秀 | 史诗 | 传说 | 绝世 | 神话 | — |
 * | 标题缎带底图 | `组件_角色_道具详情` 控制器「品质」 | gray | green | blue | purple | yellow | red | caise | — |
 * | 物品框边框 | `组件_公用_道具` 控制器「品质」 | 白 | 绿 | 蓝 | 紫 | 橙 | 红 | 金 | 将 |
 *
 * 三者前 7 档**同色系**（`ItemBehavior2.MapQuality` 与品质名表交叉验证过：
 * quality 3 = 优秀 = 蓝 = blue 框），第 8 档只有物品框有（`pzk_11`「将」）。
 */

// ============================================================
// 品质
// ============================================================

/**
 * `gameConfig.qualityname` 的兜底值（策划表读不到时用）。
 * ⚠️ 真源在表里 —— 这里只是离线/未加载时的保底，**别拿它当唯一真源**。
 */
export const QUALITY_NAME_FALLBACK = '普通,精良,优秀,史诗,传说,绝世,神话';

/**
 * 品质名。老端 `StringRef.GetQualityName`：
 *
 * ```js
 * quality -= 1;                       // ← 表是 0 基，品质是 1 基
 * quality = Math.max(quality, 0);
 * return qualityArr[quality];
 * ```
 *
 * 越界返回空串（老端 `undefined` ⇒ `setText(undefined)` 会炸，这里收敛成空串）。
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
 * FGUI 原稿：`pages="0,1,1,2,2,3,3,4,4,5,5,6,6,7"`（7 个页，id 0..6，名 "1".."7"），
 * `gearIcon pages="1,2,3,4,5,6" values="green|blue|purple|yellow|red|caise" default="gray"`。
 *
 * 老端 `setSelectedPage("品质", String(vo.GetQuality()))` 走的是 **page 名**匹配
 * （`fairygui.js` L276 `_pageNames.indexOf(value)`，找不到回落 index 0）：
 * quality 1 ⇒ 名 "1" ⇒ index 0 ⇒ **pageId "0"** ⇒ 无 gearIcon 项 ⇒ `default` = gray。
 * ⇒ 映射即 `quality 1..7 → gray..caise`，实测与 `ItemBehavior2.MapQuality`（1→白 2→绿 3→蓝）同色系。
 */
export function qualityTitleStepOf(quality: number): string {
    const n = Math.floor(quality);
    if (!Number.isFinite(n) || n < 1 || n > TITLE_ART_STEPS.length) return TITLE_ART_STEPS[0];
    return TITLE_ART_STEPS[n - 1];
}

/** 物品框品质框的**档数**（`组件_公用_道具` 的 8 个 `gearIcon` 值）。 */
export const QUALITY_FRAME_COUNT = 8;

/**
 * 物品框品质框用哪一档（quality 1..8 ⇒ `quality01`..`quality08`）。
 *
 * 真源 = `组件_公用_道具.xml` 的 `icon_frame` gearIcon（页名 白/绿/蓝/紫/橙/红/金/将）。
 * 第 8 档「将」用的是另一张 `icon_frame2`（`pzk_11`，101×115，FGUI 里同时把 `icon_frame` 关掉）——
 * 本工程只迁一张 Sprite，所以第 8 档直接换帧、**不切节点**（见 `ItemDetailPanel`/`GetHeroPanel` 的 `applyFrame`）。
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

/**
 * 数量文案。老端 `Goods.GetNumberStr()`：`0 ⇒ ''`，其余 **纯整数不缩写**
 * （与 `celebration/OSRewardSlot.osNumberTextOf` 同一条口径 —— 那两处别各写一份判断）。
 */
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

function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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

/** `item` 表的原始行 → `IItemRow`。字段缺失一律给**安全默认**（不是抛错）。 */
export function parseItemRow(raw: unknown): IItemRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = num(row.resId);
    if (resId <= 0) return null;
    return {
        resId,
        name: str(row.name),
        desc: str(row.desc),
        type: num(row.type),
        useType: num(row.useType),
        quality: num(row.quality, 1),
        icon: str(row.icon),
        access: numList(row.access),
        itemBox: numList(row.itemBox),
        useJump: num(row.useJump),
    };
}

/** `item` 全表 → `resId → IItemRow`。 */
export function parseItemRows(rows: readonly unknown[]): Map<number, IItemRow> {
    const out = new Map<number, IItemRow>();
    for (const raw of rows) {
        const row = parseItemRow(raw);
        if (row) out.set(row.resId, row);
    }
    return out;
}

// ============================================================
// 按钮 / 内容区的显隐
// ============================================================

/**
 * 界面下半部四块的显隐（由「有没有内容」+「能不能使用」+「能不能合成」推出）。
 *
 * 真源 = FGUI 控制器「类型」+ `UpdateComposBtn`：
 *
 * | 老端 | 条件 |
 * |---|---|
 * | 控制器「类型」= 0 有内容不可使用 / 1 有内容可使用 / 2 无内容不可使用 / 3 无内容可使用 | `hasItemBox` × `useJump > 0` |
 * | `btn_go`  `gearDisplay pages="1"` | 类型 1 |
 * | `btn_go1` `gearDisplay pages="3"` | 类型 3 |
 * | `n31`「内容」+ `list_ctx` `gearDisplay pages="0,1"` | 类型 0 或 1 ⇒ 有内容 |
 * | `btn_compos.visible = canCompos` / `btn_go1.visible = !canCompos` | 合成优先 |
 *
 * ⚠️ **有意偏离**：老端 `btn_go`（类型1）与 `btn_compos` 会**同时为 true**，
 * 两者几何只差 2px（`280,883` vs `280,885`），靠 `_children` 序让合成盖住前往。
 * 这里改成**三选一互斥**（`canCompos` 优先）—— 视觉等价，但不会出现两个按钮同时可点、
 * 也不会出现「点到的其实是下层那个」。单测 `typeStateOf` 直接钉住互斥。
 */
export interface IItemDetailButtonState {
    /** `n31`「内容」标题 + `list_ctx` 列表。 */
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
        const resId = num(row.resId);
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
 * ⚠️ 老端**两条**回调用的是**同一个** `id`：
 *   · `render(index, item, id)` → `RefMgrviewtype.getRef("resId", id).value` → `lab`（文案）
 *   · `onClick(index, item, id)` → `jumpTo(id)`（跳转）
 * 所以文案与 id 必须**成对**保留 —— 只留文案（`accessTextsOf`）会让途径行点不动，
 * 因为 `viewtype.resId` 本身就是 `JUMP_TYPE` 的取值。
 *
 * 查不到的 id **跳过**（老端会 `setText(undefined)` ⇒ 空行，这里直接不产行，
 * 免得列表里出现一个「点了没反应」的空白条）。
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

/** `itemCraft` 表一行（主键是 `id` = 碎片自身的 resId，**不是**产物）。 */
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
        const id = num(row.id);
        if (id <= 0) continue;
        const rewardRaw = row.reward && typeof row.reward === 'object'
            ? (row.reward as Record<string, unknown>)
            : null;
        out.set(id, {
            id,
            number: num(row.number),
            reward: rewardRaw
                ? { resId: num(rewardRaw.resId), number: num(rewardRaw.number, 1) }
                : null,
        });
    }
    return out;
}

/**
 * 「合成」按钮显不显示。老端：
 *
 * ```js
 * let craftRef = RefMgritemCraft.getRef("id", vo.GetRefId())
 * let canCompos = craftRef != null && craftRef.number > 0 && vo.GetNumber() >= craftRef.number
 * ```
 *
 * ⚠️ `itemCraft` 是**异步表**（不在 `refSmallAll.json` 里），老端 `initAsync` 里专门
 * `preloadRef()` 过 —— 不预热的话这里恒 `undefined` ⇒ **合成按钮永远不出现**（静默）。
 * 本工程的对应动作在 `ItemDetailRepository.load()` 的 `readRows('itemCraft')`。
 */
export function canComposOf(craft: IItemCraftRow | undefined | null, owned: number): boolean {
    if (!craft) return false;
    if (!Number.isFinite(craft.number) || craft.number <= 0) return false;
    return Number.isFinite(owned) && owned >= craft.number;
}
