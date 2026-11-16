/**
 * 物品详情的数据端口：只读配置表，不发任何请求。
 *
 * 数据来源：
 *   `item`                主数据（name / desc / quality / icon / access / itemBox / useJump）
 *   `viewtype`            `access` 的 id → 文案
 *   `itemCraft`           碎片合成（异步表，见下）
 *   `gameConfig`          品质名 CSV（`qualityname`）
 *   `roleProperty`        item 未命中时的货币 / 体力名称、说明、品质与图标
 *
 * 判定全在 `ItemDetailTable`（纯函数、可单测），本文件只负责把表搬成一次快照。
 *
 * 老端打开这个界面时也不发请求（`openLayerRoleItemDetails` 只是 `SetGoods + load`），
 * 所以表读不到就显示空态，离线 / 编辑器预览都能打开。
 *
 * `itemCraft` 不在 `refSmallAll.json` 里，老端要专门 `preloadRef()`；本工程的对应动作
 * 就是这里的 `readRows('itemCraft')`（走 `getRefAllAsync`，缺失即空数组）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { resBarCellOfRefId, resBarIconSpritePath } from '../common/ResTypes';
import {
    accessRefsOf,
    canComposOf,
    itemNumberTextOf,
    parseItemCraftRows,
    parseItemRows,
    parseItemRow,
    parseViewTypeRows,
    qualityNameOf,
    typeStateOf,
} from './ItemDetailTable';
import type {
    IItemAccessRef,
    IItemDetailButtonState,
    IItemRow,
} from './ItemDetailTable';

/** 一次界面刷新要的全部数据。 */
export interface IItemDetailSnapshot {
    /** 物品行；item 未命中时读取 roleProperty，两表均未命中为 null。 */
    readonly row: IItemRow | null;
    /** 持有数量。 */
    readonly number: number;
    /** 品质名（`gameConfig.qualityname`）。 */
    readonly qualityName: string;
    /** 数量文案（0 ⇒ 空串）。 */
    readonly numberText: string;
    /** 获取途径（文案与跳转 id 成对 —— 途径行点击要拿同一个 id 去 `jumpTo`）。 */
    readonly accessRefs: readonly IItemAccessRef[];
    /** 「内容」格子的 resId 列表。 */
    readonly itemBox: readonly number[];
    /** 合成按钮显不显示。 */
    readonly canCompos: boolean;
    /** 下半部四块的显隐。 */
    readonly buttons: IItemDetailButtonState;
    /** 全量 `item` 表（`itemBox` 里的物品要按 `resId` 取名字 / 品质 / 图标）。 */
    readonly items: ReadonlyMap<number, IItemRow>;
}

export interface IItemDetailRepository {
    /**
     * 读全部表，组装一次快照；不发请求。
     * 任何时候都兑现（表拿不到就是空态），不会 reject。
     */
    load(resId: number, owned: number): Promise<IItemDetailSnapshot>;
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
 * 读不到返回 `''`，由 `qualityNameOf` 回落到内置兜底串。
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
    async load(resId: number, owned: number): Promise<IItemDetailSnapshot> {
        const [itemRows, viewTypeRows, craftRows, qualityCsv] = await Promise.all([
            readRows('item'),
            readRows('viewtype'),
            readRows('itemCraft'),
            readQualityNameCsv(),
        ]);

        const items = parseItemRows(itemRows);
        const viewTypes = parseViewTypeRows(viewTypeRows);
        const crafts = parseItemCraftRows(craftRows);

        let row = items.get(resId) ?? null;
        if (!row) {
            // item 未命中时按 roleProperty 兜底（货币、体力这类资源条目）。
            const properties = await readRows('roleProperty');
            const raw = properties.find(value => value && typeof value === 'object'
                && Number((value as Record<string, unknown>).resId) === resId);
            if (raw) {
                const property = raw as Record<string, unknown>;
                const icon = resBarIconSpritePath(resBarCellOfRefId(resId, [property]));
                row = parseItemRow({ ...property, desc: property.describe, icon, useJump: 0 });
            }
        }

        const ownedCount = Number.isFinite(owned) ? owned : 0;
        const canCompos = canComposOf(crafts.get(resId), ownedCount);
        const itemBox = row?.itemBox ?? [];
        return {
            row,
            number: ownedCount,
            qualityName: qualityNameOf(qualityCsv, row?.quality ?? 1),
            numberText: itemNumberTextOf(ownedCount),
            accessRefs: row ? accessRefsOf(viewTypes, row.access) : [],
            itemBox,
            canCompos,
            buttons: typeStateOf(itemBox.length > 0, row?.useJump ?? 0, canCompos),
            items,
        };
    }

    async loadItemRow(resId: number): Promise<IItemRow | null> {
        const rows = await readRows('item');
        return parseItemRows(rows).get(resId) ?? null;
    }
}

/** 全局单例（页面默认用它；测试可注入替身）。 */
export const itemDetailRepository: IItemDetailRepository = new ItemDetailRepositoryImpl();
