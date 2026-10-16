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
import { readItemCounts } from '../card/ItemBag';
import type { IRoleBagEntry, IRoleEquipSlotData, IRoleSnapshot, RoleBagTabId } from './RoleTypes';
import { ROLE_BAG_TAB_KINDS, buildEquipSlotPlan, buildRoleNavs, sortBagEntries } from './RoleTable';
import { totalAttackOf } from './RolePowerTable';
import type { IEquipLevelRow, IEquipPowerPart, IEquipRankRow, ISkillAttrModifierRow } from './RolePowerTable';

/** 宝石「镶嵌中」锁定阈值：GemLockState.wear = 2（lock / wearLock 也算已镶嵌）。 */
const GEM_LOCK_WEAR = 2;

/** 按数值字段建索引（读坏行跳过，不抛）。 */
function indexBy<T>(rows: readonly T[] | null | undefined, field: keyof T): Map<number, T> {
    const map = new Map<number, T>();
    for (const row of rows ?? []) {
        const key = toCount(row[field] as unknown as number);
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
        const [gemBag, equip, itemBag] = await Promise.all([
            this.readGemBag(),
            this.readEquipBag(),
            this.readItemBag(),
        ]);
        this._gemBag = gemBag;
        this._equipBag = equip.bag;
        this._equipSlots = equip.slots;
        this._itemBag = itemBag;

        return {
            // 攻击力：客户端算（老端 `ModelTeam.GetTotalAtk`），见 readTotalAttack 的注释与待接清单。
            power: equip.power,
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
        const cache = CacheMgr.instance as unknown as { getTlCmdRole?: () => Array<Record<string, unknown>> } | null;
        const rows = cache?.getTlCmdRole?.() ?? [];
        return rows.length ? toCount(rows[0].lv as number) : 0;
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

        const cmds = (CacheMgr.instance as unknown as { getTlCmdGem?: () => unknown[] })?.getTlCmdGem?.() ?? [];
        const out: IRoleBagEntry[] = [];

        for (const cmd of cmds as Array<Record<string, unknown>>) {
            const resId = toCount(cmd.resId as number);
            const gem = gemByResId.get(resId);
            const gemId = toCount(cmd.id as number);
            const attrId = toCount(cmd.attribute as number) || (gemId % 10000);
            const attr = attrById.get(attrId);
            const quality = attr
                ? toCount(attr.quality as number)
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
                count: Math.max(1, toCount(cmd.num as number)),
                equipped: toCount(cmd.lock as number) >= GEM_LOCK_WEAR,
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
    private async readEquipBag(): Promise<{ bag: IRoleBagEntry[]; slots: IRoleEquipSlotData[]; power: number }> {
        const equipRows = await RefUtil.instance.getRefAllAsync('equip');
        const equipByResId = indexBy(equipRows as Array<Record<string, unknown>>, 'resId');

        const cache = CacheMgr.instance as unknown as {
            getTlCmdEquipItem?: () => Array<Record<string, unknown>>;
            getTlCmdEquipPart?: () => Array<Record<string, unknown>>;
            getTlCmdEquipPage?: () => Array<Record<string, unknown>>;
        };
        const cmds = cache?.getTlCmdEquipItem?.() ?? [];
        const parts = cache?.getTlCmdEquipPart?.() ?? [];

        const equippedIds = new Set<number>();
        for (const part of parts) {
            const equip = part.equip as Record<string, unknown> | null | undefined;
            if (equip && equip.uniqueId != null) equippedIds.add(toCount(equip.uniqueId as number));
        }

        const out: IRoleBagEntry[] = [];
        for (const cmd of cmds) {
            const resId = toCount(cmd.resId as number);
            const equip = equipByResId.get(resId);
            if (!equip) continue;
            const uniqueId = toCount(cmd.uniqueId as number);
            const quality = toCount(cmd.curQuality as number) || toCount(equip.quality as number) || 1;

            out.push({
                id: uniqueId,
                resId,
                kind: 'equip',
                iconKey: String(equip.icon ?? ''),
                iconPath: '',
                name: String(equip.name ?? ''),
                desc: '',
                quality,
                rank: toCount(cmd.rank as number),
                count: 1,
                equipped: equippedIds.has(uniqueId),
                upMark: false,
            });
        }

        const slots = this.buildEquipSlots(parts, equipRows as Array<Record<string, unknown>>, cache);
        // 攻击力的「装备支」只算**穿着中的** 6 件（老端 `ModelTeam.GetTotalAtk` 遍历的就是
        // `VOEquipPartBag` = 6 个部位），不是整个装备背包。
        const equippedItems: Array<Record<string, unknown>> = [];
        for (const part of parts) {
            const equip = part?.equip as Record<string, unknown> | null | undefined;
            if (equip) equippedItems.push(equip);
        }
        return { bag: out, slots, power: await this.readTotalAttack(equippedItems, slots) };
    }

    /**
     * 角色**攻击力**（老端 `ModelTeam.GetTotalAtk()` 口径）。
     *
     * ```
     * atk = 属性袋['攻击力'] + 属性袋['装备攻击力']
     *     + Σ skillAttrModifier[modifyId] 里 type='修改属性' 的 data['攻击力']
     *     + gameConfig.roleDefaultAtk
     * ```
     * ⚠️ **本轮只接了「装备」这一支**（`RolePowerTable.equipFightAttrs`）：
     *   · 禁军 `ModelGuards.GetAtkAttr`、主公技、神像祝福、宝物天赋 ⇒ **待接**（见 `RolePowerTable` 顶部那张表）；
     *   · 部队（老端自身空实现）、城墙（只产血量/皮肤）⇒ **对攻击力无贡献，不需要接**。
     * 所以现在这个数字**偏小但不是错的**（结构对，来源逐个补）。
     */
    private async readTotalAttack(
        items: readonly Record<string, unknown>[],
        slots: readonly IRoleEquipSlotData[],
    ): Promise<number> {
        const [levelRows, rankRows, libRows, modifierRows, configRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync('equipLevel'),
            RefUtil.instance.getRefAllAsync('equipRank'),
            RefUtil.instance.getRefAllAsync('equipLib'),
            RefUtil.instance.getRefAllAsync('skillAttrModifier'),
            RefUtil.instance.getRefAllAsync('gameConfig'),
        ]);

        const equipLevel = new Map<number, IEquipLevelRow>();
        for (const r of (levelRows ?? []) as Array<Record<string, unknown>>) {
            equipLevel.set(toCount(r.equipLevel as number), {
                attack: toCount(r.attack as number),
                hpPer: toCount(r.hpPer as number),
            });
        }

        const equipRank = new Map<string, IEquipRankRow>();
        for (const r of (rankRows ?? []) as Array<Record<string, unknown>>) {
            equipRank.set(`${toCount(r.rank as number)}|${toCount(r.qualityLevel as number)}`, {
                attack: toCount(r.attack as number),
                hpPer: toCount(r.hpPer as number),
                add1: toCount(r.add1 as number),
                add2: toCount(r.add2 as number),
                add3: toCount(r.add3 as number),
            });
        }

        const equipLib = new Map<number, { attribute: string }>();
        for (const r of (libRows ?? []) as Array<Record<string, unknown>>) {
            equipLib.set(toCount(r.id as number), { attribute: String(r.attribute ?? '') });
        }

        const skillAttrModifier = new Map<number, ISkillAttrModifierRow>();
        for (const r of (modifierRows ?? []) as Array<Record<string, unknown>>) {
            skillAttrModifier.set(toCount(r.id as number), { modify: normalizeModify(r.modify) });
        }

        let roleDefaultAtk = 0;
        for (const r of (configRows ?? []) as Array<Record<string, unknown>>) {
            if (String(r.key ?? '') === 'roleDefaultAtk') roleDefaultAtk = toCount(r.value as number);
        }

        // 穿着中的装备：`CmdEquipPart` 的部位 → 该部位等级（来自 slots）+ 实例的 rank/品质/附加属性
        const itemByUniqueId = new Map(items.map((i) => [toCount(i.uniqueId as number), i]));
        const parts: IEquipPowerPart[] = [];
        for (const slot of slots) {
            if (!slot.entry) continue;
            const item = itemByUniqueId.get(slot.entry.id);
            if (!item) continue;
            parts.push({
                level: slot.level,
                rank: toCount(item.rank as number),
                qualityLevel: toCount(item.curQuality as number),
                effects: Array.isArray(item.tlEffects) ? (item.tlEffects as number[]) : [],
            });
        }

        return totalAttackOf(parts, [], {
            equipLevel, equipRank, equipLib, skillAttrModifier, roleDefaultAtk,
        });
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
        parts: readonly Record<string, unknown>[],
        equipRows: readonly unknown[],
        cache: { getTlCmdEquipPage?: () => Array<Record<string, unknown>> },
    ): IRoleEquipSlotData[] {
        // 「部位 / 等级 / 实例」的取值判定在 `RoleTable.buildEquipSlotPlan` 里（**零 cc、可单测**）；
        // 这里只做透传，避免判定逻辑埋在带 cc 的链上（规则 78）。
        return buildEquipSlotPlan(parts, cache.getTlCmdEquipPage?.() ?? [], equipRows).map((plan) => ({
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
        const itemRows = await RefUtil.instance.getRefAllAsync('item');
        const itemByResId = indexBy(itemRows as Array<Record<string, unknown>>, 'resId');
        const counts = await readItemCounts();

        const out: IRoleBagEntry[] = [];
        for (const [resIdStr, count] of counts) {
            const resId = toCount(resIdStr as unknown as number);
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
                quality: toCount(item.quality as number) || 1,
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

/**
 * `skillAttrModifier.modify` 的防御式归一。
 *
 * 表里这一列是**嵌套数组**（`[{type, data}]`），但 ref 装配层有时给的是**JSON 字符串**
 * （`refSmallAll` 那种压缩形态）⇒ 两种都认，认不出就返回空数组（宁可少算也不抛）。
 */
function normalizeModify(raw: unknown): ISkillAttrModifierRow['modify'] {
    let value: unknown = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    const out: Array<{ type: string; data: Record<string, number> }> = [];
    for (const entry of value) {
        const row = entry as { type?: unknown; data?: unknown } | null;
        if (!row) continue;
        out.push({
            type: String(row.type ?? ''),
            data: (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, number>,
        });
    }
    return out;
}
