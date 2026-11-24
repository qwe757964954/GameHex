/**
 * 角色模块数据仓库（**单例**）。
 *
 * 职责：
 *   · 从缓存 / 配置表读取角色主界面数据（导航、背包计数）；
 *   · 解析背包三页签（宝石 / 装备 / 道具）的列表条目。
 *
 * 不直接持有 UI；视图层（{@link RolePage}）只调 `load()` / `bagEntries(tab)`。
 */
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { toCount } from '../net/RequestGuard';
import { cardRepository } from '../card/CardRepository';
import { readItemCounts } from '../card/ItemBag';
import type { IRoleBagEntry, IRoleEquipSlotData, IRoleSnapshot, RoleBagTabId } from './RoleTypes';
import { ROLE_BAG_TAB_KINDS, buildEquipSlotPlan, buildRoleNavs, sortBagEntries } from './RoleTable';

import { ITEM_TABLE } from '../../core/config/TableNames';
/** 宝石「镶嵌中」锁定阈值：GemLockState.wear = 2（lock / wearLock 也算已镶嵌）。 */
const GEM_LOCK_WEAR = 2;

/** 按数值字段建索引（读坏行跳过，不抛）。 */
function indexBy<T>(rows: readonly T[] | null | undefined, field: keyof T): Map<number, T> {
    const map = new Map<number, T>();
    for (const row of rows ?? []) {
        const key = toCount(row[field]);
        if (Number.isFinite(key)) map.set(key, row);
    }
    return map;
}

class RoleRepository {
    /** 宝石背包（已解析）。 */
    private _gemBag: IRoleBagEntry[] = [];
    /** 装备背包（已解析）。 */
    private _equipBag: IRoleBagEntry[] = [];
    /** 道具背包（已解析）。 */
    private _itemBag: IRoleBagEntry[] = [];
    /** 装备栏 6 个部位（下标 0..5 = 部位 1..6）。 */
    private _equipSlots: IRoleEquipSlotData[] = [];

    /**
     * 加载角色主界面快照（导航 + 三个背包计数）。
     * 同时把三页背包解析缓存，供 {@link bagEntries} 取。不抛（坏数据降级为空）。
     */
    async load(): Promise<IRoleSnapshot> {
        // 与卡牌页首屏同一条取数链：先读内存 / 本地快照缓存，未命中再走阵容取数。
        const cachedPower = cardRepository.getCachedLineupPower();
        const [gemBag, equip, itemBag, power] = await Promise.all([
            this.readGemBag(),
            this.readEquipBag(),
            this.readItemBag(),
            cachedPower ?? cardRepository.loadLineupPower(),
        ]);
        this._gemBag = gemBag;
        this._equipBag = equip.bag;
        this._equipSlots = equip.slots;
        this._itemBag = itemBag;

        return {
            // 战斗力 = 卡牌阵容战力（`CardLineupPower.lineupAttackTotal`），与卡牌页 / 主界面同源同式。
            power,
            navs: buildRoleNavs(),
            bagCounts: {
                1: gemBag.length,
                2: equip.bag.length,
                3: itemBag.length,
            },
        };
    }

    /**
     * 指定背包页签的条目（已排序：品质降序 → resId → id）。
     * 必须在 `load()` 之后调，否则为空。
     */
    bagEntries(tab: RoleBagTabId): IRoleBagEntry[] {
        const kind = ROLE_BAG_TAB_KINDS[tab];
        const source = kind === 'gem' ? this._gemBag : kind === 'equip' ? this._equipBag : this._itemBag;
        return sortBagEntries(source);
    }

    /**
     * 装备栏 6 个部位（下标 0..5 = 部位 1..6；空位 `entry = null`）。
     * 必须在 `load()` 之后调，否则为空。
     */
    equipParts(): readonly IRoleEquipSlotData[] {
        return this._equipSlots;
    }

    /**
     * 自己的角色等级（`CmdRole.lv`，单行表取第一行；读不到按 0）。
     * 消费方：角色页「前期建议优先提升攻击力」气泡的显隐门控（老端 `TabRoleMain.showQiPao`：`lv >= 5` 不显示）。
     */
    roleLevel(): number {
        // `CmdRole` 是单行表；`lv` 是 `sint32` ⇒ 已是 number。
        const row = CacheMgr.instance.getTlCmdRole()[0];
        return row ? row.lv : 0;
    }

    // ============================================================
    // 宝石背包
    // ============================================================

    /**
     * CmdGem[] → 列表条目。
     *
     * 口径同老端 `VOGem`：
     *   · 槽类型 gem 按 cmd.resId（1000000 等）；
     *   · 属性 attrId = cmd.attribute（缺失退 id % 10000）；
     *   · 品质 = gemAttribute.quality（缺失退 floor(attrId×0.001)+1）；
     *   · 图标按品质取 gemQuality.icon；名称「槽类型desc·品质desc」。
     */
    private async readGemBag(): Promise<IRoleBagEntry[]> {
        const [gemRows, qualityRows, attrRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync('gem'),
            RefUtil.instance.getRefAllAsync('gemQuality'),
            RefUtil.instance.getRefAllAsync('gemAttribute'),
        ]);
        const gemByResId = indexBy(gemRows as Array<Record<string, unknown>>, 'resId');
        const qualityByQ = indexBy(qualityRows as Array<Record<string, unknown>>, 'quality');
        const attrById = indexBy(attrRows as Array<Record<string, unknown>>, 'id');

        // `CmdGem` 的行本身就是解码后的消息（`resId` / `id` 是 `sint64` ⇒ `Long`）。
        const cmds = CacheMgr.instance.getTlCmdGem();
        const out: IRoleBagEntry[] = [];

        for (const cmd of cmds) {
            const resId = toCount(cmd.resId);
            const gem = gemByResId.get(resId);
            const gemId = toCount(cmd.id);
            const attrId = cmd.attribute || (gemId % 10000);
            const attr = attrById.get(attrId);
            const quality = attr
                ? toCount(attr.quality)
                : Math.floor(attrId * 0.001) + 1;
            const qualityRef = qualityByQ.get(quality);
            if (!gem || !qualityRef) continue;

            out.push({
                id: gemId,
                resId,
                kind: 'gem',
                iconKey: String(qualityRef.icon ?? ''),
                iconPath: '',
                name: `${gem.desc ?? ''}·${qualityRef.desc ?? ''}`,
                desc: String(attr?.modifyDesc ?? ''),
                quality,
                rank: 0,
                count: Math.max(1, toCount(cmd.num)),
                equipped: toCount(cmd.lock) >= GEM_LOCK_WEAR,
                upMark: false,
            });
        }
        return out;
    }

    // ============================================================
    // 装备背包
    // ============================================================

    /**
     * CmdEquipItem[] → 列表条目。
     *
     * 已穿戴判定：CmdEquipPart（6 个部位）中某部件 `equip.uniqueId` 命中。
     * 品质框按实例 curQuality（升品档），缺失退 equip.quality。
     * upMark（更优装备箭头）本轮不接 —— 依赖 equipRank/equipLevel 的攻击对比，后续补。
     */
    private async readEquipBag(): Promise<{ bag: IRoleBagEntry[]; slots: IRoleEquipSlotData[] }> {
        const equipRows = await RefUtil.instance.getRefAllAsync('equip');
        const equipByResId = indexBy(equipRows as Array<Record<string, unknown>>, 'resId');

        // 两表都是解码后的消息数组：`CmdEquipItem`（背包）/ `CmdEquipPart`（6 个部位）。
        const cmds = CacheMgr.instance.getTlCmdEquipItem();
        const parts = CacheMgr.instance.getTlCmdEquipPart();

        const equippedIds = new Set<number>();
        for (const part of parts) {
            // `CmdEquipPart.equip` 是 **required** 字段（d.ts 非空），不用判 null。
            equippedIds.add(toCount(part.equip.uniqueId));
        }

        const out: IRoleBagEntry[] = [];
        for (const cmd of cmds) {
            // `resId` / `rank` / `curQuality` 是 `sint32` ⇒ number；`uniqueId` 是 `sint64` ⇒ `Long`。
            const resId = cmd.resId;
            const equip = equipByResId.get(resId);
            if (!equip) continue;
            const uniqueId = toCount(cmd.uniqueId);
            const quality = cmd.curQuality || toCount(equip.quality) || 1;

            out.push({
                id: uniqueId,
                resId,
                kind: 'equip',
                iconKey: String(equip.icon ?? ''),
                iconPath: '',
                name: String(equip.name ?? ''),
                desc: '',
                quality,
                rank: cmd.rank,
                count: 1,
                equipped: equippedIds.has(uniqueId),
                upMark: false,
            });
        }

        const slots = this.buildEquipSlots(parts, equipRows);
        return { bag: out, slots };
    }

    /**
     * 部位数组（`CmdEquipPart`）→ 装备栏 6 格。
     *
     * 两套数据合流（口径同老端 `TabRoleMain.updateEquip`）：
     *   · **图标 / 品质 / 阶** —— **直接用 `CmdEquipPart.equip`**（`CmdEquipItem`）。
     *     ⚠️ 不能按 uniqueId 回查 `CmdEquipItem` 缓存反推 —— **已穿戴的装备不在那个缓存里**
     *     （2026-09-26 真服实测：缓存 0 行，穿着中的装备只在 `CmdEquipPart.equip` 里），
     *     回查永远 miss ⇒ 6 格全空；
     *   · **等级** —— `CmdEquipPage.tlCmdEquip[].level`，那行的 `equipId` 是**装备 resId**
     *     （实测 `{equipId:401111,...}`），按 resId **分页取小值**。
     *     老端是「当前选中页」的等级；新端角色页还没做分页切换，这里跨页取**最小非零**值 ——
     *     宁可保守也不要显示一个别的分页的等级（后续接分页时改成取当前页即可，一处）。
     */
    private buildEquipSlots(
        parts: readonly unknown[],
        equipRows: readonly unknown[],
    ): IRoleEquipSlotData[] {
        // 「部位 / 等级 / 实例」的取值判定在 `RoleTable.buildEquipSlotPlan` 里（**零 cc、可单测**）；
        // 这里只做透传，避免判定逻辑埋在带 cc 的链上（规则 78）。
        return buildEquipSlotPlan(parts, CacheMgr.instance.getTlCmdEquipPage(), equipRows).map((plan) => ({
            partId: plan.partId,
            entry: plan.entry,
            level: plan.level,
        }));
    }

    // ============================================================
    // 道具背包
    // ============================================================

    /**
     * CmdItem（经 ItemBag 计数）→ 列表条目。
     * 图标走 item.icon 的 resources 相对路径（与宝石/装备的 icon.json 通道不同）。
     */
    private async readItemBag(): Promise<IRoleBagEntry[]> {
        const itemRows = await RefUtil.instance.getRefAllAsync(ITEM_TABLE);
        const itemByResId = indexBy(itemRows as Array<Record<string, unknown>>, 'resId');
        const counts = await readItemCounts();

        const out: IRoleBagEntry[] = [];
        for (const [resIdStr, count] of counts) {
            // `readItemCounts` 的键是 `String(CmdItem.resId)` ⇒ 这里就是 string，直接交给 toCount。
            const resId = toCount(resIdStr);
            const item = itemByResId.get(resId);
            if (!item) continue;
            out.push({
                id: resId,
                resId,
                kind: 'item',
                iconKey: '',
                iconPath: String(item.icon ?? ''),
                name: String(item.name ?? ''),
                desc: String(item.desc ?? ''),
                quality: toCount(item.quality) || 1,
                rank: 0,
                count: Math.max(1, count),
                equipped: false,
                upMark: false,
            });
        }
        return out;
    }
}

/** 角色模块数据仓库单例。 */
export const roleRepository = new RoleRepository();
