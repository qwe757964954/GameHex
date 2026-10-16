/**
 * 角色模块：导航 / 背包页签 / 虚拟网格的**纯函数表**（零引擎依赖，可直接单测）。
 *
 * 本轮落地：背包三页签（宝石 / 装备 / 道具）的列表窗口与排序。
 */
import type { IEquipPartInfo, IRoleBagEntry, IRoleNavEntry, RoleBagKind, RoleBagTabId, RoleNavId } from './RoleTypes';
import { ROLE_BAG_TAB_IDS, ROLE_EQUIP_PART_COUNT, ROLE_NAV_IDS } from './RoleTypes';

// ============================================================
// 防御式取值
// ============================================================

/** 数字归一：`Long` / `string` / `number` 都要能落到 `number`；非法值给 `fallback`。 */
function numOf(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }
    if (value && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
        const n = Number((value as { toNumber(): unknown }).toNumber());
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

/** 字符串归一：`null` / `undefined` → 空串。 */
function strOf(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

// ============================================================
// 导航（左侧按钮）
// ============================================================

/** 导航 id → 名称（与老端 FGUI 按钮一致）。 */
export const ROLE_NAV_NAMES: Readonly<Record<RoleNavId, string>> = {
    1: '武将',
    2: '民兵',
    3: '共鸣',
    4: '近卫',
    5: '属性预览',
    6: '宝物',
    7: '主公技',
};

/**
 * 已落地的导航 id（**显式白名单**）。
 *
 * 目前只有 **2 = 民兵天赋**（老端 `TabMilitiaTalent`，2026-09-28 迁来）：
 * 打开 `ui/Role/TabMilitiaTalent` 弹窗。其余六个点击时由视图层给「功能未接入」提示。
 *
 * ⚠️ 名字以 prefab 上烘的为准（规则 118）：`Role.prefab` 里 `NavMilitia` 写的是「天赋」，
 * 而 {@link ROLE_NAV_NAMES} 里那条沿用了 FGUI 的「民兵」—— 两处指的是同一个按钮。
 */
export const ROLE_NAV_READY: ReadonlySet<RoleNavId> = new Set<RoleNavId>([2]);

/** 构建导航条目（按 id 升序）。 */
export function buildRoleNavs(): readonly IRoleNavEntry[] {
    return ROLE_NAV_IDS.map((id) => ({
        id,
        name: ROLE_NAV_NAMES[id],
        ready: ROLE_NAV_READY.has(id),
    }));
}

// ============================================================
// 背包页签
// ============================================================

/** 背包页签 id → 名称。 */
export const ROLE_BAG_TAB_NAMES: Readonly<Record<RoleBagTabId, string>> = {
    1: '宝石',
    2: '装备',
    3: '道具',
};

/** 背包页签 id → 物品归属类型（决定取数与图标通道）。 */
export const ROLE_BAG_TAB_KINDS: Readonly<Record<RoleBagTabId, RoleBagKind>> = {
    1: 'gem',
    2: 'equip',
    3: 'item',
};

/**
 * 已落地的背包页签（**显式白名单**）。本轮三个都做 ⇒ 全在。
 * 未登记页签点击时给明确提示，不留死按钮。
 */
export const ROLE_BAG_TAB_READY: ReadonlySet<RoleBagTabId> = new Set<RoleBagTabId>(ROLE_BAG_TAB_IDS);

/** 解析背包页签 id；非法 / 空值返回 null，不抛。 */
export function resolveRoleBagTab(id: number | null | undefined): RoleBagTabId | null {
    return ROLE_BAG_TAB_IDS.includes(id as RoleBagTabId) ? (id as RoleBagTabId) : null;
}

/** 背包页签是否已落地。 */
export function isRoleBagTabReady(id: number | null | undefined): boolean {
    const tab = resolveRoleBagTab(id);
    return tab != null && ROLE_BAG_TAB_READY.has(tab);
}

// ============================================================
// 排序 / 文案
// ============================================================

/**
 * 背包条目排序：品质降序 → 配置 resId 升序 → 身份 id 升序。
 * 与老端「品质 → refId → attrId」口径一致（装备 upMark 不参与排序）。
 */
export function sortBagEntries(entries: readonly IRoleBagEntry[]): IRoleBagEntry[] {
    return [...entries].sort((a, b) => {
        if (b.quality !== a.quality) return b.quality - a.quality;
        if (a.resId !== b.resId) return a.resId - b.resId;
        return a.id - b.id;
    });
}

/** 数量文案（装备不显示数量；道具 / 宝石显示 n）。 */
export function bagCountText(entry: IRoleBagEntry): string {
    if (entry.kind === 'equip') return '';
    return entry.count > 1 ? String(entry.count) : '';
}

/** 品阶文案（装备 `{rank}阶`，老端 `GRADE_RANK`=「阶」；其余 / rank≤0 返回空串）。 */
export function bagRankText(entry: IRoleBagEntry): string {
    if (entry.kind !== 'equip' || entry.rank <= 0) return '';
    return `${entry.rank}阶`;
}

// ============================================================
// 装备格（供「个人信息」PlayerInfoRepository 复用）
// ============================================================

/** `equip` 表的一行（只要界面用得到的字段）。 */
export interface IEquipRow {
    readonly resId: number;
    readonly equipType: number;
    readonly icon: string;
    readonly quality: number;
}

/** `equip` 表 ⇒ `resId` → 行。 */
export function normalizeEquipRows(rows: readonly unknown[]): Map<number, IEquipRow> {
    const out = new Map<number, IEquipRow>();
    for (const row of rows) {
        const r = row as Record<string, unknown> | null;
        if (!r) continue;
        const resId = numOf(r.resId, 0);
        if (resId <= 0) continue;
        out.set(resId, {
            resId,
            equipType: numOf(r.equipType, 0),
            icon: strOf(r.icon),
            quality: numOf(r.quality, 0),
        });
    }
    return out;
}

/** 一条 `CmdEquip` → 部位信息；`equip` 表查不到返回 `null`。 */
export function equipPartOf(
    item: unknown,
    equipByResId: ReadonlyMap<number, IEquipRow>,
): IEquipPartInfo | null {
    const r = item as Record<string, unknown> | null;
    if (!r) return null;
    const equipId = numOf(r.equipId, 0);
    const row = equipByResId.get(equipId);
    if (!row || row.equipType <= 0) return null;
    const gems = Array.isArray(r.tlCmdGemInfo) ? r.tlCmdGemInfo : [];
    return {
        equipId,
        type: row.equipType,
        icon: row.icon,
        quality: row.quality,
        gemCount: gems.length,
    };
}

// ============================================================
// 装备栏 6 格（CmdEquipPart + CmdEquipPage → 取值计划）
// ============================================================

/**
 * 装备栏一格的**取值计划**（纯数据，不含背包条目实体 —— 实体绑定留给调用方）。
 *
 * 拆出来的原因（项目规则 78「判定逻辑禁挂在带 `cc` 的 import 链上」）：
 * 原实现是 `RoleRepository` 的私有方法，而 Repository 一路 import 到 `CacheMgr → cc`
 * ⇒ 那段判定**一条单测都跑不了**，错了只会表现为「6 格全空」这种静默故障。
 */
export interface IEquipSlotPlan {
    /** 部位 1..6。 */
    readonly partId: number;
    /**
     * 该部位穿着的装备（直接由 `CmdEquipPart.equip` 构建；空位 = `null`）。
     *
     * ⚠️ **不能**回头查 `CmdEquipItem` 缓存反推 —— **已穿戴的装备不在那个缓存里**
     * （2026-09-26 真服实测：`getTlCmdEquipItem()` = 0 行，穿着中的装备只出现在
     * `CmdEquipPart.equip` 里）⇒ 按 uniqueId 回查背包永远 miss，6 格全空。
     */
    readonly entry: IRoleBagEntry | null;
    /** 装备等级（跨页取最小非零；空位或分页里没有 = 0）。 */
    readonly level: number;
}

/**
 * `CmdEquipPart[]` + `CmdEquipPage[]` + equip 表 → 6 个部位的取值计划（下标 = 部位号 − 1，恒 6 条）。
 *
 * 口径同老端 `TabRoleMain.updateEquip`：
 *   · **部位** —— `CmdEquipPart.equipId`（**1..6 是部位号**，别和 `CmdEquip.equipId`
 *     （那边的语义是装备 resId，见 {@link equipPartOf}）混用）；
 *   · **装备实例** —— **直接用 `CmdEquipPart.equip`**（`CmdEquipItem`：resId / rank /
 *     curQuality / tlEffects 全在身上），图标 / 品质 / 名字按 `resId` 查 equip 表；
 *   · **等级** —— `CmdEquipPage.tlCmdEquip[].level`，那行的 `equipId` 是**装备 resId**
 *     （真服实测：`{equipId:401111, level:1}`，401111 是 resId 不是部位号！），按
 *     `row.equipId === part.equip.resId` 跨页取**最小非零**
 *     （老端取当前分页；新端角色页还没做分页切换，宁可保守也不要显示别的分页的等级）。
 *
 * 空位、以及「穿着装备但分页里查不到等级」，一律落 `level = 0`（界面据此不显示 `Lv.`）。
 */
export function buildEquipSlotPlan(
    parts: readonly unknown[],
    pages: readonly unknown[],
    equipRows: readonly unknown[],
): IEquipSlotPlan[] {
    const refByResId = new Map<number, Record<string, unknown>>();
    for (const raw of equipRows) {
        const row = raw as Record<string, unknown> | null;
        if (!row) continue;
        const resId = numOf(row.resId, 0);
        if (resId > 0) refByResId.set(resId, row);
    }

    const equipped = new Map<number, Record<string, unknown>>();
    for (const raw of parts) {
        const p = raw as Record<string, unknown> | null;
        if (!p) continue;
        const partId = numOf(p.equipId, 0);
        const equip = p.equip as Record<string, unknown> | null | undefined;
        if (!equip) continue;
        if (partId >= 1 && partId <= ROLE_EQUIP_PART_COUNT) {
            equipped.set(partId, equip);   // 同部位重复下发 ⇒ 后者覆盖（服务端全量重发语义）
        }
    }

    const levels = new Map<number, number>();
    for (const rawPage of pages) {
        const page = rawPage as Record<string, unknown> | null;
        const rows = Array.isArray(page?.tlCmdEquip) ? (page.tlCmdEquip as unknown[]) : [];
        for (const rawRow of rows) {
            const row = rawRow as Record<string, unknown> | null;
            if (!row) continue;
            const resId = numOf(row.equipId, 0);
            const level = numOf(row.level, 0);
            if (resId <= 0 || level <= 0) continue;
            const prev = levels.get(resId);
            if (prev === undefined || level < prev) levels.set(resId, level);
        }
    }

    const out: IEquipSlotPlan[] = [];
    for (let partId = 1; partId <= ROLE_EQUIP_PART_COUNT; partId += 1) {
        const equip = equipped.get(partId);
        const resId = equip ? numOf(equip.resId, 0) : 0;
        if (!equip || resId <= 0) {
            out.push({ partId, entry: null, level: 0 });
            continue;
        }
        const ref = refByResId.get(resId);
        out.push({
            partId,
            entry: {
                id: numOf(equip.uniqueId, 0),
                resId,
                kind: 'equip',
                iconKey: ref ? String(ref.icon ?? '') : '',
                iconPath: '',
                name: ref ? String(ref.name ?? '') : '',
                desc: '',
                // 当前品质优先，表品质兜底；都没有按 1（最低品质框）
                quality: numOf(equip.curQuality, 0) || (ref ? numOf(ref.quality, 0) : 0) || 1,
                rank: numOf(equip.rank, 0),
                count: 1,
                equipped: true,
                upMark: false,
            },
            // 空位不显示等级：老端空槽也不留 Lv 文本（规则 82：状态一律无条件写，这里算出确定的 0）
            level: levels.get(resId) ?? 0,
        });
    }
    return out;
}
