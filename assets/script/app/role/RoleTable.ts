/** 角色导航、背包排序、装备部位和宝石孔位的纯数据规则。 */
import { toIdString } from '../../core/value/Coerce';
import type { IRoleGemEntry, IRoleGemSocket, RoleGemChange } from './RoleTypes';
import type { IEquipPartInfo, IRoleBagEntry, IRoleNavEntry, RoleBagKind, RoleBagTabId, RoleNavId } from './RoleTypes';
import { ROLE_BAG_TAB_IDS, ROLE_EQUIP_PART_COUNT, ROLE_GEM_SOCKET_COUNT, ROLE_NAV_IDS } from './RoleTypes';

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
const ROLE_NAV_NAMES: Readonly<Record<RoleNavId, string>> = {
    1: '武将',
    2: '民兵',
    3: '共鸣',
    4: '近卫',
    5: '属性预览',
    6: '宝物',
    7: '主公技',
};

/**
 * 已接入的角色导航。点击后的提示或打开指令由 `RoleController` 派发。
 * 民兵入口在 prefab 上显示为「天赋」，对应 `ROLE_NAV_NAMES` 中的「民兵」。
 */
export const ROLE_NAV_READY: ReadonlySet<RoleNavId> = new Set<RoleNavId>([2, 3]);

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
const ROLE_BAG_TAB_READY: ReadonlySet<RoleBagTabId> = new Set<RoleBagTabId>(ROLE_BAG_TAB_IDS);

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
// 宝石格状态（推荐箭头 / 同类属性灰罩）
// ============================================================

/** 宝石属性的一行（`gemAttribute` 的 `type` / `quality` / `skillId`）。 */
export interface IGemAttrFact {
    readonly type: number;
    readonly quality: number;
    readonly skillId: number;
}

/**
 * 把装备上的宝石按 `order` 摊回 1..5；**缺失的孔位补 null**。
 *
 * `CmdEquip.tlCmdGemInfo` 只保证「已镶嵌的孔」有记录，不能假定空孔一定下发；
 * 而老端 `CheckIsBattleWear` 依赖空孔 `gemId=0` 判定「有空洞就推荐」。
 * 所以这里必须按 `order` 补齐，否则 5 孔缺 1 孔时永远看不到推荐箭头。
 */
export function gemFactsByOrder(
    entries: readonly { order: number; fact: IGemAttrFact | null }[],
): (IGemAttrFact | null)[] {
    const facts: (IGemAttrFact | null)[] = Array.from({ length: ROLE_GEM_SOCKET_COUNT }, () => null);
    for (const entry of entries) {
        if (entry.order >= 1 && entry.order <= ROLE_GEM_SOCKET_COUNT) {
            facts[entry.order - 1] = entry.fact;
        }
    }
    return facts;
}

/**
 * 「推荐」箭头（老端 `TabGem` 的 `com_rd_up`）：背包宝石比当前装备页同部位装备上的
 * 同类宝石更好时显示；没有同类宝石时，品质高于任一已镶嵌宝石也显示。
 *
 * 口径参考老端 `ModelGem.CheckIsBattleWear`：
 *   · 数量 0 / 本页已镶嵌 → 不推荐；
 *   · 当前页该部位没有装备（`worn = null`）→ 推荐；
 *   · 孔位为空（`worn` 里的 `null`）→ 推荐；
 *   · 遇到第一条同类属性（`type` 相同）就定结果：有 `skillId` 时要求技能组相同，
 *     再比品质；不同技能组直接不推荐；无 `skillId` 只比品质；
 *   · 没有同类属性时，用老端被注释掉的 `qualityBigger` 兜底：品质更高 → 推荐。
 */
export function gemUpMark(
    current: IGemAttrFact | null,
    worn: readonly (IGemAttrFact | null)[] | null,
    wornOnCurrent: boolean,
    count: number,
): boolean {
    if (!current || count <= 0 || wornOnCurrent) return false;
    if (worn === null) return true;
    let qualityBigger = false;
    for (const item of worn) {
        if (!item) return true;
        if (item.type !== current.type) {
            // 不同属性：老端把 `qualityBigger` 分支注释了；这里恢复为兜底，
            // 让「新合成的更高品质宝石」在没有同属性可升级时也能推荐。
            if (item.quality < current.quality) qualityBigger = true;
            continue;
        }
        if (item.skillId) {
            return item.skillId === current.skillId && item.quality < current.quality;
        }
        return item.quality < current.quality;
    }
    return qualityBigger;
}

/**
 * 「同类属性」灰罩（老端 `TabGem` 的 `mask`）：当前装备页同部位装备上已有
 * **同属性类型 + 同品质**的宝石时，背包里多出来的同类宝石置灰。
 *
 * 老端只把当前页已镶嵌的那颗从列表里拆走、留下备用数量，所以这里额外要求
 * 该宝石本身不在本页装备上（`wornOnCurrent = false`），避免把已镶嵌的宝石本体也压暗。
 */
export function gemSameAttrWorn(
    current: IGemAttrFact | null,
    worn: readonly (IGemAttrFact | null)[] | null,
): boolean {
    if (!current || !worn) return false;
    return worn.some(item => !!item && item.type === current.type && item.quality === current.quality);
}

// ============================================================
// 装备格状态（推荐箭头）
// ============================================================

/** 推荐箭头对比的一件装备事实（攻击力已按强化等级 + 品阶档算好）。 */
export interface IEquipAttackFact {
    /** 装备实例 uniqueId（相同 = 就是身上这件）。 */
    readonly uniqueId: number;
    /** `equipLevel.attack + equipRank.attack`。 */
    readonly attack: number;
}

/**
 * 装备「推荐」箭头（老端 `TabRoleEquip` 的 `com_rd_up` ← `VOEquipItem.GetRatiyRd()`）：
 *   · 同部位已穿戴的就是自己 → 不推荐；
 *   · 同部位已穿戴装备攻击力低于本装备 → 推荐；
 *   · 空部位（没有可比较的穿戴装备）→ 推荐（换上一定不亏）。
 *
 * 攻击力口径见 `RoleRepository.readEquipBag`：`GetAttack()` 的强化等级项两边取同一部位
 * 的分页等级，实际差异来自 `equipRank.attack`（品阶 + 品质档）；相等不推荐。
 */
export function equipUpMark(candidate: IEquipAttackFact, worn: IEquipAttackFact | null): boolean {
    if (!worn) return true;
    if (worn.uniqueId === candidate.uniqueId) return false;
    return worn.attack < candidate.attack;
}

/**
 * 装备实例的部位号：优先 `CmdEquipItem.baseId`（协议：初始装备部位 1..6），
 * 缺省 / 越界时退 `equip` 表的 `equipType`。都没有 = 0（界面按 0 不显示箭头）。
 */
export function equipPartIdOf(cmd: unknown, equipType: number): number {
    const row = cmd as Record<string, unknown> | null;
    const baseId = numOf(row?.baseId, 0);
    if (baseId >= 1 && baseId <= ROLE_EQUIP_PART_COUNT) return baseId;
    return equipType >= 1 && equipType <= ROLE_EQUIP_PART_COUNT ? equipType : 0;
}

/**
 * `equipRank` 按 [rank, qualityLevel] 取攻击力；缺行退 qualityLevel-1
 * （老端 `VOEquipItem.GetEquipRankRef()` 的降档兜底）。查不到 = 0。
 */
export function equipRankAttackOf(rows: readonly unknown[], rank: number, qualityLevel: number): number {
    for (const level of [qualityLevel, qualityLevel - 1]) {
        if (level <= 0) continue;
        for (const raw of rows) {
            const row = raw as Record<string, unknown> | null;
            if (!row) continue;
            if (numOf(row.rank, 0) !== rank || numOf(row.qualityLevel, 0) !== level) continue;
            return numOf(row.attack, 0);
        }
    }
    return 0;
}

/** `equipLevel` 按强化等级取攻击力；查不到 = 0。 */
export function equipLevelAttackOf(rows: readonly unknown[], level: number): number {
    if (level <= 0) return 0;
    for (const raw of rows) {
        const row = raw as Record<string, unknown> | null;
        if (row && numOf(row.equipLevel, 0) === level) return numOf(row.attack, 0);
    }
    return 0;
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

/**
 * 按装备资源 ID 匹配分页记录的 `CmdEquip.equipId`。`CmdEquipItem.baseId` 表示初始装备部位（1～6）。
 * 同一资源 ID 有多条记录时取最小非零等级，无匹配时返回 0。
 */
export function equipLevelOf(rows: readonly unknown[] | null | undefined, resId: number): number {
    let level = 0;
    for (const raw of rows ?? []) {
        const row = raw as Record<string, unknown> | null;
        if (!row) continue;
        if (numOf(row.equipId, 0) !== resId) continue;
        const value = numOf(row.level, 0);
        if (value <= 0) continue;
        if (level === 0 || value < level) level = value;
    }
    return level;
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
    /** 穿戴装备由 `CmdEquipPart.equip` 构建，空部位为 `null`。`CmdEquipItem` 背包缓存只包含未穿戴装备。 */
    readonly entry: IRoleBagEntry | null;
    /** 装备等级（跨页取最小非零；空位或分页里没有 = 0）。 */
    readonly level: number;
}

/**
 * 装备的**展示品质**（1..7 普通..神话）。
 *
 * `CmdEquipItem.curQuality` 是 `equipRank.qualityLevel`（1..17 品质档），不是界面品质；
 * 老端 `VOEquipItem.GetQuality()` 取的是该档位行的 `quality` 列。缺行时按老端
 * `GetEquipRankRef()` 退 `qualityLevel - 1`，仍缺则回退 `equip.quality`。
 */
export function equipDisplayQuality(
    rankRows: readonly unknown[],
    rank: number,
    qualityLevel: number,
    fallbackQuality = 1,
): number {
    for (const level of [qualityLevel, qualityLevel - 1]) {
        if (level <= 0) continue;
        for (const raw of rankRows) {
            const row = raw as Record<string, unknown> | null;
            if (!row) continue;
            if (numOf(row.rank, 0) !== rank || numOf(row.qualityLevel, 0) !== level) continue;
            return numOf(row.quality, 0) || fallbackQuality || 1;
        }
    }
    return fallbackQuality || 1;
}

/**
 * 固定生成六个装备部位，下标为部位号减一。`CmdEquipPart.equipId` 是部位号，分页 `CmdEquip.equipId` 是装备资源 ID。
 * 用穿戴实例的资源 ID 匹配分页行，跨页取最小非零等级作为回退值。无匹配等级时返回 0，界面隐藏等级文案。
 * 有品阶配置时，按装备的阶数和品质档位查 `equipRank` 的展示品质。
 */
export function buildEquipSlotPlan(
    parts: readonly unknown[],
    pages: readonly unknown[],
    equipRows: readonly unknown[],
    rankRows: readonly unknown[] = [],
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
        const rank = numOf(equip.rank, 0);
        const qualityLevel = numOf(equip.curQuality, 0);
        // curQuality 是品质档（1..17），界面品质框要按 equipRank.quality（1..7）换算；
        // 缺失时 ref.quality 本身就是展示品质，不能再当品质档查表。
        const quality = qualityLevel > 0
            ? equipDisplayQuality(rankRows, rank, qualityLevel, ref ? numOf(ref.quality, 0) : 1)
            : (ref ? numOf(ref.quality, 0) : 0) || 1;
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
                quality,
                rank,
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

/** Gem orders belong to the selected equipment plan and use one-based indexing. */
export function buildGemSockets(
    page: number,
    equipId: number,
    pages: readonly Pick<CmdEquipPage, 'page' | 'tlCmdEquip'>[],
): IRoleGemSocket[] {
    const equipment = pages.find(row => row.page === page)?.tlCmdEquip?.find(row => row.equipId === equipId);
    if (!equipment) return [];

    const gemIds = new Map<number, string>();
    for (const gem of equipment.tlCmdGemInfo ?? []) {
        const id = toIdString(gem.gemId);
        if (/^[1-9]\d*$/.test(id)) gemIds.set(gem.order, id);
    }
    return Array.from({ length: ROLE_GEM_SOCKET_COUNT }, (_, index) => ({
        page, equipId, order: index + 1, gemId: gemIds.get(index + 1) ?? '',
    }));
}

export function getGemChange(
    sockets: readonly IRoleGemSocket[],
    target: IRoleGemSocket,
    gem: IRoleGemEntry | null,
): RoleGemChange | null {
    const { page, equipId, order, gemId } = target;
    const current = sockets.find(socket => socket.page === page && socket.equipId === equipId && socket.order === order);
    if (!current || current.gemId !== gemId) return null;
    if (!gem) return gemId ? { kind: 'down', payload: { equipId, page, order } } : null;
    if (gem.equipId !== equipId || gem.count <= 0 || sockets.some(socket => socket.gemId === gem.gemId)) return null;
    return gemId
        ? { kind: 'replace', payload: { equipId, page, order, id: gem.gemId } }
        : { kind: 'on', payload: { equipId, page, id: gem.gemId } };
}
