/**
 * 物品详情的数据端口 —— **配置表** 的 Repository。
 *
 * 与 `RoleRepository` / `SevenDayRepository` 同一套分层：页面只依赖本文件的接口，
 * 一切判定在 `ItemDetailTable`（纯函数、可单测），本文件只负责「把表搬进来」。
 *
 * 数据来源（全部只读，**不发任何请求**）：
 *   ① `item`      —— 主数据（name / desc / quality / icon / access / itemBox / useJump）
 *   ② `viewtype`  —— `access` 的 id → 文案（老端 `render()` 逐行查）
 *   ③ `itemCraft` —— 碎片合成（老端 `UpdateComposBtn` 查 `itemCraft.id`）
 *   ④ `gameConfig.qualityname` —— 品质名 CSV（老端 `StringRef.GetQualityName`）
 *
 * ## 老端打开这个界面时**不发请求**
 *
 * `CtrlRole.openLayerRoleItemDetails(voItem)` 只是 `SetGoods(vo) + load()`，
 * 详情内容全部来自本地表 + 已持有的 `Goods` VO。所以本类也**不造假的刷新请求**；
 * 表读不到就显示空态（编辑器预览 / 离线都能打开，不白屏）。
 *
 * ## `itemCraft` 是异步表
 *
 * 老端 `initAsync()` 里专门 `RefMgritemCraft.preloadRef()` —— 因为 `itemCraft` **不在**
 * `refSmallAll.json` 里，不预热的话 `getRef` 恒 `undefined` ⇒「合成」按钮**永远不出现**。
 * 本工程对应动作就是这里的 `readRows('itemCraft')`（走 `getRefAllAsync`，缺失即空数组）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import {
    accessRefsOf,
    canComposOf,
    itemNumberTextOf,
    parseItemCraftRows,
    parseItemRows,
    parseViewTypeRows,
    qualityNameOf,
    typeStateOf,
} from './ItemDetailTable';
import type {
    IItemAccessRef,
    IItemCraftRow,
    IItemDetailButtonState,
    IItemRow,
    IViewTypeRow,
} from './ItemDetailTable';

/** 一次界面刷新要的全部数据。 */
export interface IItemDetailSnapshot {
    /** 这个 `resId` 在 `item` 表里的行；查不到为 `null`（界面显示空态）。 */
    readonly row: IItemRow | null;
    /** 持有数量（调用方传入）。 */
    readonly number: number;
    /** 品质名（`gameConfig.qualityname`）。 */
    readonly qualityName: string;
    /** 数量文案（0 ⇒ 空串）。 */
    readonly numberText: string;
    /** 获取途径（**文案 + 跳转 id 成对** —— 老端途径行点击要拿同一个 id 去 `jumpTo`）。 */
    readonly accessRefs: readonly IItemAccessRef[];
    /** 获取途径文案（`accessRefs` 的投影；只显示不点击的场景用）。 */
    readonly accessTexts: readonly string[];
    /** 「内容」格子的 resId 列表。 */
    readonly itemBox: readonly number[];
    /** 合成按钮显不显示。 */
    readonly canCompos: boolean;
    /** 合成产物（`itemCraft.reward`）；没有则为 `null`。 */
    readonly composReward: { readonly resId: number; readonly number: number } | null;
    /** 下半部四块的显隐。 */
    readonly buttons: IItemDetailButtonState;
    /** 全量 `item` 表（`itemBox` 里的物品要按 `resId` 取名字 / 品质 / 图标）。 */
    readonly items: ReadonlyMap<number, IItemRow>;
    /** `viewtype` 全表（`access` 转文案用）。 */
    readonly viewTypes: ReadonlyMap<number, IViewTypeRow>;
    /** 合成表（调试 / 测试用）。 */
    readonly crafts: ReadonlyMap<number, IItemCraftRow>;
}

export interface IItemDetailRepository {
    /**
     * 读全部表，组装一次快照；**不发任何请求**。
     * 任何时候都兑现（表拿不到就是空态），不会 reject。
     */
    load(resId: number, number: number): Promise<IItemDetailSnapshot>;
    /** 只读一个 `resId` 的 `item` 行（HUD 等轻量场景用，避免整表组装）。 */
    loadItemRow(resId: number): Promise<IItemRow | null>;
}

/** 读一张分表的全部行；表缺失 / 未加载时返回空数组。 */
async function readRows(table: string): Promise<readonly unknown[]> {
    try {
        return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
    } catch (error) {
        console.warn(`[ItemDetail] 读配置表 ${table} 失败`, error);
        return [];
    }
}

/**
 * 品质名 CSV（`gameConfig.qualityname`）。
 * 表读不到返回 `''` —— `qualityNameOf` 会自动回落到内置兜底串。
 */
async function readQualityNameCsv(): Promise<string> {
    try {
        const row = await RefUtil.instance.getRefAsync('gameConfig', 'key', 'qualityname');
        const value = (row as { value?: unknown } | null)?.value;
        return typeof value === 'string' ? value : '';
    } catch (error) {
        console.warn('[ItemDetail] 读 gameConfig.qualityname 失败', error);
        return '';
    }
}

class ItemDetailRepositoryImpl implements IItemDetailRepository {
    async load(resId: number, number: number): Promise<IItemDetailSnapshot> {
        const [itemRows, viewTypeRows, craftRows, qualityCsv] = await Promise.all([
            readRows('item'),
            readRows('viewtype'),
            readRows('itemCraft'),
            readQualityNameCsv(),
        ]);

        const items = parseItemRows(itemRows);
        const viewTypes = parseViewTypeRows(viewTypeRows);
        const crafts = parseItemCraftRows(craftRows);

        const row = items.get(resId) ?? null;
        const accessRefs = row ? accessRefsOf(viewTypes, row.access) : [];
        const itemBox = row?.itemBox ?? [];
        const craft = crafts.get(resId);
        const owned = Number.isFinite(number) ? number : 0;
        const canCompos = canComposOf(craft, owned);

        return {
            row,
            number: owned,
            qualityName: qualityNameOf(qualityCsv, row?.quality ?? 1),
            numberText: itemNumberTextOf(owned),
            accessRefs,
            accessTexts: accessRefs.map((ref) => ref.text),
            itemBox,
            canCompos,
            // 产物与「能不能合成」无关（老端也是先查 `craftRef` 再判数量），
            // 界面只在 `canCompos` 为真时才用得上它。
            composReward: craft?.reward ?? null,
            buttons: typeStateOf(itemBox.length > 0, row?.useJump ?? 0, canCompos),
            items,
            viewTypes,
            crafts,
        };
    }

    async loadItemRow(resId: number): Promise<IItemRow | null> {
        const rows = await readRows('item');
        return parseItemRows(rows).get(resId) ?? null;
    }
}

/** 全局单例（页面默认用它；测试可注入替身）。 */
export const itemDetailRepository: IItemDetailRepository = new ItemDetailRepositoryImpl();
