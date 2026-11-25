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
import { toCount, toIdString, type GameRequestStatus } from '../net/RequestGuard';
import { GameNet } from '../net/GameNet';
import { RequestMsg, type ProtoInput } from '../../framework/net/RequestMsg';
import { cardRepository } from '../card/CardRepository';
import { readItemCounts } from '../card/ItemBag';
import type { IRoleBagEntry, IRoleEquipSlotData, IRoleGemEntry, IRoleSnapshot, RoleBagTabId, RoleGemChange } from './RoleTypes';
import { ROLE_BAG_TAB_KINDS, buildEquipSlotPlan, buildGemSockets, buildRoleNavs, equipLevelOf, sortBagEntries } from './RoleTable';

import { HEAD_TABLE, ITEM_TABLE } from '../../core/config/TableNames';
import type { IRoleEquipGrowth, IRoleEquipPlan, IRoleGemGrowth, IRoleGrowthProtocol } from './RoleTypes';
import { ROLE_TEXTS } from './RoleTexts';
import { EQUIP_EXTRA_ATTR_KEYS } from './RolePowerTable';
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

class RoleRequest<TRequest, TResponse> extends RequestMsg<TRequest, TResponse> {
    static readonly __cname = 'RoleRequest';

    constructor(
        private readonly proto: ReqMsgProtoName,
        payload: ProtoInput<TRequest>,
        caller: object,
        receive?: (response: TResponse) => void,
    ) {
        super(payload, caller, receive);
        this.allowRetry = false;
    }

    getReqMsgProtoName(): ReqMsgProtoName {
        return this.proto;
    }
}

const ROLE_REQUEST_OPTIONS = { timeoutMs: 8000, tag: 'Role' } as const;

type ReportMissingConfig = (table: string, key: string) => void;

class RoleRepository {
    /** 宝石背包（已解析）。 */
    private _gemBag: IRoleGemEntry[] = [];
    private describeGem: (id: string) => IRoleGemEntry | null = () => null;
    private loadRevision = 0;
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
        const revision = ++this.loadRevision;
        const missing = new Map<string, Set<string>>();
        const reportMissing: ReportMissingConfig = (table, key) => {
            let keys = missing.get(table);
            if (!keys) {
                keys = new Set();
                missing.set(table, keys);
            }
            keys.add(key);
        };
        const [{ bag: gemBag, describe }, equip, itemBag, power] = await Promise.all([
            this.readGemBag(reportMissing),
            this.readEquipBag(reportMissing),
            this.readItemBag(reportMissing),
            cachedPower ?? cardRepository.loadLineupPower(),
        ]);
        if (revision === this.loadRevision) {
            this._gemBag = gemBag;
            this.describeGem = describe;
            this._equipBag = equip.bag;
            this._equipSlots = equip.slots;
            this._itemBag = itemBag;
            if (missing.size > 0) {
                const details = Array.from(missing, ([table, keys]) =>
                    `${table} [${Array.from(keys).join(', ')}]`).join(' | ');
                console.warn(`[RoleRepository] 缺少角色物品配置 ${details}`);
            }
        }

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

    findGem(id: string): IRoleGemEntry | null {
        return this._gemBag.find(gem => gem.gemId === id) ?? this.describeGem(id);
    }

    findBagEntry(kind: 'gem' | 'equip' | 'item', uniqueIdOrResId: string | number): IRoleBagEntry | null {
        const idStr = String(uniqueIdOrResId);
        if (kind === 'equip') {
            return this._equipBag.find(e => e.uniqueId === idStr || String(e.id) === idStr) ?? null;
        }
        if (kind === 'gem') {
            return this._gemBag.find(e => (e as IRoleGemEntry).gemId === idStr || String(e.id) === idStr) ?? null;
        }
        return this._itemBag.find(e => String(e.resId) === idStr || String(e.id) === idStr) ?? null;
    }

    async requestGrowth<K extends keyof IRoleGrowthProtocol>(
        proto: K, payload: ProtoInput<IRoleGrowthProtocol[K][0]>, caller: object,
        apply?: (response: IRoleGrowthProtocol[K][1]) => void,
    ): Promise<GameRequestStatus> {
        let received = false;
        const status = await GameNet.sendRequest(() => new RoleRequest<IRoleGrowthProtocol[K][0], IRoleGrowthProtocol[K][1]>(
            proto, payload, caller, response => {
                if ((proto === 'CmdEquipReplaceReqMsg' || proto === 'CmdEquipUpQualityReqMsg' || proto === 'CmdEquipWashReqMsg')
                    && !(response as CmdEquipReplaceRspMsg | CmdEquipUpQualityRspMsg | CmdEquipWashRspMsg).ret) return;
                received = true;
                this.applyGrowthResponse(proto, response);
                apply?.(response);
            }), ROLE_REQUEST_OPTIONS);
        return status === 'ok' && !received ? 'failed' : status;
    }

    private applyGrowthResponse(proto: keyof IRoleGrowthProtocol, response: IRoleGrowthProtocol[keyof IRoleGrowthProtocol][1]): void {
        const cache = CacheMgr.instance;
        if ('equipPart' in response && response.equipPart) cache.getCache('CmdEquipPart').addOrUpdate(response.equipPart);
        if (proto === 'CmdEquipReplaceReqMsg') {
            const replace = response as CmdEquipReplaceRspMsg;
            if (replace.uniqueId) cache.getCache('CmdEquipItem').delete(toIdString(replace.uniqueId));
            if (replace.equip) cache.getCache('CmdEquipItem').addOrUpdate(replace.equip);
        } else if (proto === 'CmdEquipDecomposeReqMsg') {
            for (const id of (response as CmdEquipDecomposeRspMsg).tlUniqueIds ?? []) {
                cache.getCache('CmdEquipItem').delete(toIdString(id));
            }
        }
    }

    async equipmentGrowth(bagId: string | null, partId: number | null): Promise<IRoleEquipGrowth | null> {
        const cache = CacheMgr.instance;
        const cmd = partId === null
            ? cache.getCmdEquipItem(bagId)
            : cache.getCmdEquipPart(partId)?.equip;
        if (!cmd) return null;
        const page = cache.getTlCmdRole()[0]?.selectEquipPage;
        const selected = page == null ? null : cache.getCmdEquipPage(page);
        // 分页行的 equipId 是装备 resId；cmd.baseId 是初始部位 1..6，不能拿来比。
        const level = equipLevelOf(selected?.tlCmdEquip, cmd.resId);
        const ref = RefUtil.instance;
        const [item, levelRow, nextLevel, rank, prevRank, nextRank, costConfig] = await Promise.all([
            ref.getRefAsync('equip', 'resId', cmd.resId),
            ref.getRefAsync('equipLevel', 'equipLevel', level),
            ref.getRefAsync('equipLevel', 'equipLevel', level + 1),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality - 1),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality + 1),
            ref.getRefAsync('gameConfig', 'key', 'equipAddQualityCostId'),
        ]) as Array<Record<string, unknown> | undefined>;
        if (!item) return null;
        const rankRow = rank ?? prevRank;
        const [drawings, qualityMaterial, libraries] = await Promise.all([
            ref.getRefAsync(ITEM_TABLE, 'resId', toCount(item.consumeId)),
            ref.getRefAsync(ITEM_TABLE, 'resId', toCount(costConfig?.value)),
            ref.getRefAllAsync('equipLib'),
        ]) as [Record<string, unknown> | undefined, Record<string, unknown> | undefined, Record<string, unknown>[]];
        const libById = indexBy(libraries, 'id');
        const amount = (name: unknown, id: unknown, count: unknown) => `${name ?? id} × ${toCount(count)}`;
        // 宝石只挂在穿戴中的分页装备上（`CmdEquipPage.tlCmdEquip[].tlCmdGemInfo`），背包装备没有。
        const gemEffects = partId === null ? [] : await this.gemEffectsOf(cmd.resId);
        return {
            id: toIdString(cmd.uniqueId),
            baseId: cmd.baseId,
            name: String(item.name ?? ''),
            level,
            rank: cmd.rank,
            worn: partId !== null,
            attack: toCount(levelRow?.attack) + toCount(rankRow?.attack),
            hpPercent: (toCount(levelRow?.hpPer) + toCount(rankRow?.hpPer)) / 100,
            effects: (cmd.tlEffects ?? []).map((id, index) =>
                `${libById.get(id)?.attribute ?? id} +${toCount(rankRow?.[EQUIP_EXTRA_ATTR_KEYS[index]])}`),
            gemEffects,
            washValues: EQUIP_EXTRA_ATTR_KEYS.map(key => toCount(rankRow?.[key])),
            levelCost: nextLevel ? [
                amount('金币', 2, nextLevel.gold), amount(drawings?.name, item.consumeId, nextLevel.drawings),
            ] : [],
            qualityCost: rankRow && nextRank ? amount(qualityMaterial?.name, costConfig?.value, rankRow.cost) : null,
            washCost: rankRow && toCount(rankRow.libCount) >= 2
                ? amount(qualityMaterial?.name, costConfig?.value, rankRow.washCost) : null,
        };
    }

    /**
     * 已镶嵌宝石的属性文案（`gemAttribute.modifyDesc`，按孔位顺序）。
     *
     * 数据源与 `buildGemSockets` 同一条：当前装备页 `CmdEquipPage.tlCmdEquip[].tlCmdGemInfo`，
     * 再按 `CmdGem.attribute`（缺省退 gemId 末四位，与 {@link readGemBag} 同口径）查 `gemAttribute`。
     * 只读缓存、不发请求；页快照过期时它和孔位一起陈旧。
     */
    private async gemEffectsOf(equipResId: number): Promise<string[]> {
        const cache = CacheMgr.instance;
        const pageId = cache.getTlCmdRole()[0]?.selectEquipPage;
        if (pageId == null) return [];
        const row = cache.getCmdEquipPage(pageId)?.tlCmdEquip?.find(item => toCount(item.equipId) === equipResId);
        const out: string[] = [];
        for (const info of row?.tlCmdGemInfo ?? []) {
            const gemId = toIdString(info.gemId);
            if (!/^[1-9]\d*$/.test(gemId)) continue;
            const attrId = cache.getCmdGem(gemId)?.attribute || Number(gemId.slice(-4));
            if (!attrId) continue;
            const attr = await RefUtil.instance.getRefAsync('gemAttribute', 'id', attrId);
            const desc = String(attr?.modifyDesc ?? '');
            if (desc) out.push(desc);
        }
        return out;
    }

    async equipmentWashAttributes(ids: readonly number[], values: readonly number[]): Promise<readonly string[]> {
        const rows = await RefUtil.instance.getRefAllAsync('equipLib') as Record<string, unknown>[];
        const byId = indexBy(rows, 'id');
        return ids.map((id, index) => `${byId.get(id)?.attribute ?? id} +${values[index] ?? 0}`);
    }

    async equipPlans(): Promise<readonly IRoleEquipPlan[]> {
        const config = await RefUtil.instance.getRefAsync('gameConfig', 'key', 'gemTabOpen');
        const requirements: readonly number[] = Array.isArray(config?.value) ? config.value : [];
        const cache = CacheMgr.instance;
        const role = cache.getTlCmdRole()[0];
        if (!role) return [];
        const pages = cache.getTlCmdEquipPage();
        const pageIds = new Set([...requirements.map((_, index) => index + 1), ...pages.map(plan => plan.page)]);
        return Array.from(pageIds, page => {
            const plan = pages.find(row => row.page === page);
            const level = requirements[page - 1] ?? 0;
            return {
                page,
                name: plan?.name || ROLE_TEXTS.pageFallback(page),
                selected: role.selectEquipPage === page,
                lockedUntil: !plan && role.lv < level ? level : 0,
            };
        });
    }

    async gemFilters(): Promise<readonly { id: number; name: string }[]> {
        const rows = await RefUtil.instance.getRefAllAsync('gem') as Record<string, unknown>[];
        return (rows ?? []).map(row => ({ id: toCount(row.equipId), name: String(row.desc) }));
    }

    async gemGrowth(id: string): Promise<IRoleGemGrowth | null> {
        const cmd = CacheMgr.instance.getCmdGem(id);
        const gem = this.findGem(id);
        if (!cmd || !gem) return null;
        const ref = RefUtil.instance;
        const [quality, pending] = await Promise.all([
            ref.getRefAsync('gemQuality', 'quality', gem.quality),
            cmd.newAttribute ? ref.getRefAsync('gemAttribute', 'id', cmd.newAttribute) : null,
        ]) as Array<Record<string, unknown> | null>;
        return {
            lock: cmd.lock,
            refineCost: toCount(quality?.consume1),
            pendingAttribute: cmd.newAttribute ? String(pending?.modifyDesc ?? cmd.newAttribute) : '',
        };
    }

    changeGem(change: RoleGemChange, caller: object): Promise<GameRequestStatus> {
        switch (change.kind) {
            case 'on':
                return GameNet.sendRequest(() => new RoleRequest<CmdGemOnReqMsg, CmdGemOnRspMsg>(
                    'CmdGemOnReqMsg', change.payload, caller), ROLE_REQUEST_OPTIONS);
            case 'down':
                return GameNet.sendRequest(() => new RoleRequest<CmdGemDownReqMsg, CmdGemDownRspMsg>(
                    'CmdGemDownReqMsg', change.payload, caller), ROLE_REQUEST_OPTIONS);
            case 'replace':
                return GameNet.sendRequest(() => new RoleRequest<CmdGemReplaceReqMsg, CmdGemReplaceRspMsg>(
                    'CmdGemReplaceReqMsg', change.payload, caller), ROLE_REQUEST_OPTIONS);
        }
    }

    async previewGemCompose(caller: object): Promise<{ status: GameRequestStatus; materials: readonly CmdGemPreview[] }> {
        let materials: readonly CmdGemPreview[] = [];
        const status = await GameNet.sendRequest(() => new RoleRequest<CmdGemComposePreviewReqMsg, CmdGemComposePreviewRspMsg>(
            'CmdGemComposePreviewReqMsg', {}, caller, response => {
                materials = response.tlCmdGemPreview ?? [];
            }),
            ROLE_REQUEST_OPTIONS);
        return { status, materials };
    }

    async composeGems(caller: object): Promise<{ status: GameRequestStatus; rewards: CmdGoods[] }> {
        let rewards: CmdGoods[] = [];
        const status = await GameNet.sendRequest(() => new RoleRequest<CmdGemComposeReqMsg, CmdGemComposeRspMsg>(
            'CmdGemComposeReqMsg', {}, caller, response => {
                rewards = response.tlCmdGoods ?? [];
            }),
            ROLE_REQUEST_OPTIONS);
        return { status, rewards };
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
    private async readGemBag(reportMissing: ReportMissingConfig): Promise<{
        bag: IRoleGemEntry[];
        describe: (id: string) => IRoleGemEntry | null;
    }> {
        const [gemRows, qualityRows, attrRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync('gem'),
            RefUtil.instance.getRefAllAsync('gemQuality'),
            RefUtil.instance.getRefAllAsync('gemAttribute'),
        ]);
        const gemByResId = indexBy(gemRows as Array<Record<string, unknown>>, 'resId');
        const qualityByQ = indexBy(qualityRows as Array<Record<string, unknown>>, 'quality');
        const attrById = indexBy(attrRows as Array<Record<string, unknown>>, 'id');

        const describe = (gemId: string, cmd?: CmdGem, report?: ReportMissingConfig): IRoleGemEntry | null => {
            if (!/^[1-9]\d*$/.test(gemId)) return null;
            const attrId = cmd?.attribute || Number(gemId.slice(-4));
            const resId = cmd ? toCount(cmd.resId) : Number(gemId.slice(0, -4)) * 10000;
            const gem = gemByResId.get(resId);
            const attr = attrById.get(attrId);
            const quality = attr ? toCount(attr.quality) : Math.floor(attrId / 1000) + 1;
            const qualityRef = qualityByQ.get(quality);
            if (!gem) report?.('gem', `resId=${resId} (gemId=${gemId})`);
            if (!attr && attrId > 0) report?.('gemAttribute', `id=${attrId} (gemId=${gemId})`);
            if (!qualityRef) report?.('gemQuality', `quality=${quality} (gemId=${gemId})`);
            if (!gem || !qualityRef) return null;

            return {
                id: Number(gemId),
                gemId,
                equipId: toCount(gem.equipId),
                resId,
                kind: 'gem',
                iconKey: String(qualityRef.icon ?? ''),
                iconPath: '',
                name: `${gem.desc ?? ''}·${qualityRef.desc ?? ''}`,
                desc: String(attr?.modifyDesc ?? ''),
                quality,
                rank: 0,
                count: cmd?.num ?? 0,
                equipped: !!cmd && toCount(cmd.lock) >= GEM_LOCK_WEAR,
                upMark: false,
            };
        };

        const bag: IRoleGemEntry[] = [];
        for (const cmd of CacheMgr.instance.getTlCmdGem()) {
            const row = cmd.num > 0 ? describe(toIdString(cmd.id), cmd, reportMissing) : null;
            if (row) bag.push(row);
        }
        return { bag, describe };
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
    private async readEquipBag(reportMissing: ReportMissingConfig): Promise<{ bag: IRoleBagEntry[]; slots: IRoleEquipSlotData[] }> {
        const equipRows = await RefUtil.instance.getRefAllAsync('equip');
        const equipByResId = indexBy(equipRows as Array<Record<string, unknown>>, 'resId');

        // 两表都是解码后的消息数组：`CmdEquipItem`（背包）/ `CmdEquipPart`（6 个部位）。
        const cmds = CacheMgr.instance.getTlCmdEquipItem();
        const parts = CacheMgr.instance.getTlCmdEquipPart();

        const equippedIds = new Set<number>();
        for (const part of parts) {
            // `CmdEquipPart.equip` 是 **required** 字段（d.ts 非空），不用判 null。
            equippedIds.add(toCount(part.equip.uniqueId));
            const resId = part.equip.resId;
            if (resId > 0 && !equipByResId.has(resId)) reportMissing('equip', `resId=${resId}`);
        }

        const out: IRoleBagEntry[] = [];
        const seenUniqueIds = new Set<number>();
        const pushEquip = (cmd: CmdEquipItem, equipped: boolean) => {
            const resId = cmd.resId;
            const equip = equipByResId.get(resId);
            if (!equip) {
                reportMissing('equip', `resId=${resId}`);
                return;
            }
            const uniqueId = toCount(cmd.uniqueId);
            if (seenUniqueIds.has(uniqueId)) return;
            seenUniqueIds.add(uniqueId);
            const quality = cmd.curQuality || toCount(equip.quality) || 1;
            out.push({
                id: uniqueId,
                uniqueId: toIdString(cmd.uniqueId),
                resId,
                kind: 'equip',
                iconKey: String(equip.icon ?? ''),
                iconPath: '',
                name: String(equip.name ?? ''),
                desc: '',
                quality,
                rank: cmd.rank,
                count: 1,
                equipped,
                upMark: false,
            });
        };

        // 对齐老端 `ModelEquipItem.GetItemBagDataIncludePart()`：已穿戴装备只在 `CmdEquipPart.equip` 中，需并入背包列表。
        for (const part of parts) {
            if (part.equip) pushEquip(part.equip, true);
        }
        for (const cmd of cmds) {
            pushEquip(cmd, equippedIds.has(toCount(cmd.uniqueId)));
        }

        const slots = this.buildEquipSlots(parts, equipRows, equipByResId);
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
     *   · **等级 / 孔位** —— `CmdRole.selectEquipPage` 对应页的 `CmdEquip`。
     *     页快照未到时沿用装备栏原有的等级回退口径。
     */
    private buildEquipSlots(
        parts: readonly unknown[],
        equipRows: readonly unknown[],
        equipByResId: ReadonlyMap<number, Record<string, unknown>>,
    ): IRoleEquipSlotData[] {
        const cache = CacheMgr.instance;
        const pages = cache.getTlCmdEquipPage();
        const activePage = cache.getTlCmdRole()[0]?.selectEquipPage;
        const selected = pages.find(page => page.page === activePage);
        const selectedByPart = new Map((selected?.tlCmdEquip ?? []).map(row => [
            toCount(equipByResId.get(row.equipId)?.equipType), row,
        ]));
        return buildEquipSlotPlan(parts, pages, equipRows).map(plan => {
            const row = selectedByPart.get(plan.partId);
            return {
                ...plan,
                level: plan.entry && row ? row.level : plan.level,
                sockets: plan.entry && selected && row ? buildGemSockets(selected.page, row.equipId, [selected]) : [],
            };
        });
    }

    // ============================================================
    // 道具背包
    // ============================================================

    /**
     * CmdItem（经 ItemBag 计数）→ 列表条目。
     * 图标走 item.icon 的 resources 相对路径（与宝石/装备的 icon.json 通道不同）。
     */
    private async readItemBag(reportMissing: ReportMissingConfig): Promise<IRoleBagEntry[]> {
        const [itemRows, headRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync(ITEM_TABLE),
            RefUtil.instance.getRefAllAsync(HEAD_TABLE),
        ]);
        const headByResId = indexBy(headRows as Array<Record<string, unknown>>, 'resId');
        const itemByResId = indexBy(itemRows as Array<Record<string, unknown>>, 'resId');
        const counts = await readItemCounts();

        const out: IRoleBagEntry[] = [];
        for (const [resIdStr, count] of counts) {
            // `readItemCounts` 的键是 `String(CmdItem.resId)` ⇒ 这里就是 string，直接交给 toCount。
            const resId = toCount(resIdStr);
            const item = itemByResId.get(resId);
            if (!item) {
                // CmdItem 也记录已拥有的头像，头像由 head 表配置。
                if (!headByResId.has(resId)) reportMissing(ITEM_TABLE, `resId=${resIdStr}`);
                continue;
            }
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
