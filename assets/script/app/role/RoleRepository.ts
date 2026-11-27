/** 从协议缓存与配置表组装角色、装备、宝石和道具数据，并通过 GameNet 提交养成操作。 */
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { toCount, toIdString, type GameRequestStatus } from '../net/RequestGuard';
import { GameNet } from '../net/GameNet';
import { RequestMsg, type ProtoInput } from '../../framework/net/RequestMsg';
import { cardRepository } from '../card/CardRepository';
import { readItemCounts } from '../card/ItemBag';
import type { IEquipRedDots, IRoleBagEntry, IRoleDecomposeOptions, IRoleDecomposeResult, IRoleEquipSlotData, IRoleGemEntry, IRoleSnapshot, RoleBagTabId, RoleGemChange } from './RoleTypes';
import type { IGemAttrFact } from './RoleTable';
import { ROLE_BAG_TAB_KINDS, buildEquipSlotPlan, buildGemSockets, buildRoleNavs, equipDisplayQuality, equipLevelAttackOf, equipLevelOf, equipPartIdOf, equipRankAttackOf, equipUpMark, gemFactsByOrder, gemSameAttrWorn, gemUpMark, normalizeEquipRows, sortBagEntries } from './RoleTable';
import { buildEquipRedDots, emptyEquipRedDots, type IEquipPartCostFacts } from './RoleEquipRedDotTable';
import { EQUIP_DECOMPOSE_DEFAULT_GAIN_PER, decomposeMissingIds, equipDecomposeGain, normalizeDecomposeIds, summarizeDecompose } from './EquipDecomposeTable';
import { ROLE_EQUIP_PART_COUNT } from './RoleTypes';

import { HEAD_TABLE, ITEM_TABLE } from '../../core/config/TableNames';
import type { IRoleEquipCostFact, IRoleEquipGrowth, IRoleEquipPlan, IRoleGemGrowth, IRoleGrowthProtocol } from './RoleTypes';
import type { IRoleComposeQuality } from './RoleComposeView';
import { ROLE_TEXTS } from './RoleTexts';
import { EQUIP_EXTRA_ATTR_KEYS } from './RolePowerTable';
/** 宝石「镶嵌中」锁定阈值：GemLockState.wear = 2（lock / wearLock 也算已镶嵌）。 */
const GEM_LOCK_WEAR = 2;

/** 金币图标（与 `MilitiaTalentPage` 同资源；`icons/**` 相对 `assets/resources/`，不再拼前缀）。 */
const GOLD_ICON_PATH = 'icons/resource/图标_铜币';

/** 按数值字段建索引（读坏行跳过，不抛）。 */
function indexBy<T>(rows: readonly T[] | null | undefined, field: keyof T): Map<number, T> {
    const map = new Map<number, T>();
    for (const row of rows ?? []) {
        const key = toCount(row[field]);
        if (Number.isFinite(key)) map.set(key, row);
    }
    return map;
}

/** `equipRank` 的复合主键（`rank` + `qualityLevel`），分解收益按 `baseQuality` 取行。 */
function equipRankKey(rank: number, qualityLevel: number): string {
    return `${rank}:${qualityLevel}`;
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
    /** 分解产出物品的 resId（`gameConfig.equipAddQualityCostId` = 精炼石；0 = 配置未到）。 */
    private _decomposeResId = 0;

    /** 加载角色页快照及三个背包的解析结果。并发加载时，只有最后发起的加载能更新仓库缓存。 */
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
            this._decomposeResId = equip.decomposeResId;
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

    /** 装备背包同时展示穿戴项，分解列表只保留有唯一 ID 的未穿戴装备，并沿用背包排序。 */
    decomposeCandidates(): IRoleBagEntry[] {
        return this.bagEntries(2).filter(entry =>
            entry.kind === 'equip' && !entry.equipped && !!entry.uniqueId);
    }

    /** 仅汇总仍可分解的装备。产出物品由 `gameConfig.equipAddQualityCostId` 指定，未配置时 `resId` 为 0，界面隐藏产出图标。 */
    decomposeSummary(ids: readonly (string | number)[]): {
        readonly ids: readonly string[];
        readonly count: number;
        readonly gain: number;
        readonly resId: number;
    } {
        const candidates = this.decomposeCandidates();
        const summary = summarizeDecompose(candidates.map(entry => ({
            uniqueId: entry.uniqueId ?? '',
            rank: entry.rank,
            quality: entry.quality,
            decompose: entry.decompose ?? 0,
            equipped: entry.equipped,
        })), ids.map(id => String(id ?? '')));
        return { ...summary, resId: this._decomposeResId };
    }

    /**
     * 批量分解装备（`CmdEquipDecomposeReqMsg`）。
     *
     * 当前协议字段支持 repeated id，但服务端可能只实现单件：
     *   · 默认先按老端整包发一次；
     *   · 整包回包缺件（或只返回空列表）时，剩余装备逐件补发，进度经 `onProgress` 上报；
     *   · `mode: 'sequential'` 直接逐件发，跳过整包等待。
     *
     * 服务端回包里的 `tlUniqueIds` 才是真正移除的列表（可能只接受一部分），
     * 缓存同步由 {@link applyGrowthResponse} 按回包删除；这里再把回包与奖励原样交给调用方。
     * 空列表不发请求，状态按 `failed` 处理，避免「点了没反应」。
     */
    async decomposeEquips(
        ids: readonly (string | number)[],
        caller: object,
        options: IRoleDecomposeOptions = {},
    ): Promise<IRoleDecomposeResult> {
        const uniqueIds = normalizeDecomposeIds(ids);
        if (!uniqueIds.length) return { status: 'failed', removedIds: [], rewards: [] };
        if (options.mode === 'sequential') {
            return this.decomposeSequentially(uniqueIds, caller, uniqueIds.length, options.onProgress);
        }
        const batch = await this.sendDecompose(uniqueIds, caller);
        const removedIds = new Set(batch.removedIds);
        const missing = decomposeMissingIds(uniqueIds, batch.removedIds);
        options.onProgress?.(removedIds.size, uniqueIds.length);
        // 整包失败（超时 / 离线）不再逐件重试，避免 99 次超时叠加；整包 ok 但缺件才补发。
        if (batch.status !== 'ok' || missing.length === 0) return batch;
        return this.decomposeSequentially(missing, caller, uniqueIds.length, options.onProgress, batch);
    }

    /** 整包分解请求；回包只做解析，缓存删除仍由 `requestGrowth` 内的 `applyGrowthResponse` 完成。 */
    private async sendDecompose(
        uniqueIds: readonly string[],
        caller: object,
    ): Promise<IRoleDecomposeResult> {
        const removedIds: string[] = [];
        const rewards: CmdGoods[] = [];
        const status = await this.requestGrowth('CmdEquipDecomposeReqMsg', { tlUniqueIds: [...uniqueIds] }, caller, response => {
            for (const id of response.tlUniqueIds ?? []) removedIds.push(toIdString(id));
            for (const goods of response.tlCmdGoods ?? []) rewards.push(goods);
        });
        return { status, removedIds, rewards };
    }

    /**
     * 逐件分解：每件单独一次 `CmdEquipDecomposeReqMsg`，适合服务端只支持单件的版本。
     * 单件请求失败即停止（保留已成功部分），不把剩余装备当成功；进度按已确认移除数上报。
     */
    private async decomposeSequentially(
        ids: readonly string[],
        caller: object,
        total: number,
        onProgress?: (completed: number, total: number) => void,
        seed?: IRoleDecomposeResult,
    ): Promise<IRoleDecomposeResult> {
        const removedIds = [...(seed?.removedIds ?? [])];
        const rewards = [...(seed?.rewards ?? [])];
        let status: GameRequestStatus = seed?.status ?? 'failed';
        for (const id of ids) {
            const one = await this.sendDecompose([id], caller);
            if (one.status !== 'ok') {
                return { status: status === 'ok' ? 'ok' : 'failed', removedIds, rewards };
            }
            if (one.removedIds.length > 0) {
                removedIds.push(...one.removedIds);
                rewards.push(...one.rewards);
                status = 'ok';
            }
            onProgress?.(removedIds.length, total);
        }
        return { status: removedIds.length > 0 ? 'ok' : 'failed', removedIds, rewards };
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
        // 锻造页要显示「持有/需求」，持有数取背包实时计数；金币取角色缓存（与 `equipRedDots` 同口径）。
        const counts = readItemCounts();
        const ownedGold = toCount(cache.getTlCmdRole()[0]?.gold);
        const costConfigId = toCount(costConfig?.value);
        const ownedMaterial = counts.get(String(costConfigId)) ?? 0;
        const drawingsId = toCount(item.consumeId);
        const costFact = (name: unknown, need: unknown, owned: number, icon: unknown): IRoleEquipCostFact => ({
            name: String(name ?? ''), need: toCount(need), owned, iconPath: String(icon ?? ''),
        });
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
            // `hpPer` 配置是 0.01% 单位（100 = 1%），/100 后 `hpPercent` 已是「百分数」（105 = 105%），
            // 展示层不得再 ×100（锻造页曾因此显示成 10500）。
            hpPercent: (toCount(levelRow?.hpPer) + toCount(rankRow?.hpPer)) / 100,
            // 强化预览的「下一级」与 `attack` / `hpPercent` 同一口径：`equipLevel[level+1]` + 当前阶行。
            // 没有 level+1 行（满级 / 表尾）就给 `undefined`，由页面隐藏箭头，别在界面里编 `×1.05`。
            nextAttack: nextLevel ? toCount(nextLevel.attack) + toCount(rankRow?.attack) : undefined,
            nextHpPercent: nextLevel ? (toCount(nextLevel.hpPer) + toCount(rankRow?.hpPer)) / 100 : undefined,
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
            rarityName: String(rankRow?.rarityName ?? ''),
            nextRarityName: nextRank ? String(nextRank.rarityName ?? '') : null,
            // 升品行按「名称 + 当前 → 下一」拆列；带「百分比」的词条按配置习惯左列不带 %、右列带 %。
            effectRows: (cmd.tlEffects ?? []).map((id, index) => {
                const key = EQUIP_EXTRA_ATTR_KEYS[index];
                const attr = String(libById.get(id)?.attribute ?? id);
                const cur = toCount(rankRow?.[key]);
                const next = nextRank ? toCount(nextRank[key]) : cur;
                return attr.includes('百分比')
                    ? { name: `${attr}：`, cur: String(cur), next: `${next}%` }
                    : { name: `${attr}：`, cur: `+${cur}`, next: `+${next}` };
            }),
            levelCostFacts: nextLevel ? [
                { name: '金币', need: toCount(nextLevel.gold), owned: ownedGold, iconPath: GOLD_ICON_PATH },
                costFact(drawings?.name, nextLevel.drawings, counts.get(String(drawingsId)) ?? 0, drawings?.icon),
            ] : [],
            qualityCostFact: rankRow && nextRank
                ? costFact(qualityMaterial?.name, rankRow.cost, ownedMaterial, qualityMaterial?.icon) : null,
            washCostFact: rankRow && toCount(rankRow.libCount) >= 2
                ? costFact(qualityMaterial?.name, rankRow.washCost, ownedMaterial, qualityMaterial?.icon) : null,
        };
    }

    /**
     * 按当前装备页的孔位顺序读取已镶嵌宝石的 `gemAttribute.modifyDesc`。
     * 属性 ID 缺失时取宝石 ID 末四位。主键查不到描述时，按 ID 编码 `(quality - 1) * 1000 + type` 拆出品质和属性类型回查。
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
            let desc = String(attr?.modifyDesc ?? '');
            if (!desc) {
                const rows = await RefUtil.instance.getTlRefAsync('gemAttribute', ['quality', 'type'],
                    Math.floor(attrId / 1000) + 1, attrId % 1000);
                desc = String(rows?.[0]?.modifyDesc ?? '');
            }
            if (desc) out.push(desc);
        }
        return out;
    }

    /**
     * 装备锻造红点快照（强化 / 升品 / 洗炼 × 6 部位）。
     *
     * 与 {@link equipmentGrowth} 读同一批缓存与配置行，保证「锻造页展示的消耗」与
     * 「角色页 / 底栏红点」同口径。只读，不发请求；页面在渲染与装备变更后各取一次。
     */
    async equipRedDots(): Promise<IEquipRedDots> {
        const cache = CacheMgr.instance;
        const role = cache.getTlCmdRole()[0];
        if (!role) return emptyEquipRedDots();
        const page = cache.getCmdEquipPage(toCount(role.selectEquipPage));
        const counts = readItemCounts();
        const ref = RefUtil.instance;
        const costConfig = await ref.getRefAsync('gameConfig', 'key', 'equipAddQualityCostId') as Record<string, unknown> | undefined;
        const ownedGold = toCount(role.gold);
        const ownedMaterial = counts.get(String(toCount(costConfig?.value))) ?? 0;
        const facts = await Promise.all(
            Array.from({ length: ROLE_EQUIP_PART_COUNT }, (_unused, index) =>
                this.equipPartCostFacts(index + 1, page, ref, ownedGold, ownedMaterial, counts)),
        );
        return buildEquipRedDots(facts);
    }

    /** 单个部位的锻造消耗事实；空位 / 缺配置时给「全不可操作」的安全形状。 */
    private async equipPartCostFacts(
        partId: number,
        page: CmdEquipPage | undefined,
        ref: RefUtil,
        ownedGold: number,
        ownedMaterial: number,
        counts: ReadonlyMap<string, number>,
    ): Promise<IEquipPartCostFacts> {
        const cmd = CacheMgr.instance.getCmdEquipPart(partId)?.equip;
        if (!cmd) {
            return {
                partId, level: 0, hasNextLevel: false, nextLevelGold: 0, nextLevelDrawings: 0,
                nextRankCost: null, washLibCount: 0, washCost: null, ownedGold, ownedDrawings: 0, ownedMaterial,
            };
        }
        // 分页行的 equipId 是装备 resId；`cmd.baseId` 是初始部位 1..6，不能拿来比。
        const level = equipLevelOf(page?.tlCmdEquip, cmd.resId);
        const [item, nextLevel, rank, prevRank, nextRank] = await Promise.all([
            ref.getRefAsync('equip', 'resId', cmd.resId),
            ref.getRefAsync('equipLevel', 'equipLevel', level + 1),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality - 1),
            ref.getRefAsync('equipRank', ['rank', 'qualityLevel'], cmd.rank, cmd.curQuality + 1),
        ]) as Array<Record<string, unknown> | undefined>;
        const rankRow = rank ?? prevRank;
        const drawingsId = toCount(item?.consumeId);
        return {
            partId,
            level,
            hasNextLevel: !!nextLevel,
            nextLevelGold: toCount(nextLevel?.gold),
            nextLevelDrawings: toCount(nextLevel?.drawings),
            nextRankCost: rankRow && nextRank ? toCount(rankRow.cost) : null,
            washLibCount: toCount(rankRow?.libCount),
            washCost: rankRow ? toCount(rankRow.washCost) : null,
            ownedGold,
            ownedDrawings: drawingsId > 0 ? counts.get(String(drawingsId)) ?? 0 : 0,
            ownedMaterial,
        };
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

    /**
     * `gemQuality` 全表 → 合成弹窗用的品质档案。
     *
     * `consume` 是「做出该档需要几张低一档」（当前 5，即 5 合 1），
     * `icon` 是该档宝石图标（`图标_宝石_绿色` 等），材料/产出棋子共用。
     */
    async gemComposeQualities(): Promise<readonly IRoleComposeQuality[]> {
        const rows = await RefUtil.instance.getRefAllAsync('gemQuality') as Record<string, unknown>[];
        return (rows ?? []).map(row => ({
            quality: toCount(row.quality),
            consume: toCount(row.consume),
            iconKey: String(row.icon ?? ''),
        }));
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

    /**
     * 宝石「生效技能」名称：`gemAttribute.skillId` → `skillType.name`。
     *
     * 只有技能类宝石（type 1000/1001 等 56 条属性）带 `skillId`；普通属性宝石返回空串。
     */
    async gemSkillName(skillId: number): Promise<string> {
        if (!skillId) return '';
        const row = await RefUtil.instance.getRefAsync('skillType', 'id', skillId) as { name?: unknown } | null;
        return typeof row?.name === 'string' ? row.name : '';
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
     *   · 属性 attrId = cmd.attribute（缺失退 gemId 末四位）；
     *   · 品质 = gemAttribute.quality（缺失退 floor(attrId×0.001)+1）；
     *   · 图标按品质取 gemQuality.icon；名称「槽类型desc·品质desc」。
     *
     * 状态标记对齐老端 `TabGem.render`：
     *   · `upMark` —— `CheckIsBattleWear` 的「推荐」箭头；
     *   · `masked` —— 当前装备页同部位已有同属性类型 + 同品质宝石时的灰罩。
     */
    private async readGemBag(reportMissing: ReportMissingConfig): Promise<{
        bag: IRoleGemEntry[];
        describe: (id: string) => IRoleGemEntry | null;
    }> {
        const [gemRows, qualityRows, attrRows, equipRows] = await Promise.all([
            RefUtil.instance.getRefAllAsync('gem'),
            RefUtil.instance.getRefAllAsync('gemQuality'),
            RefUtil.instance.getRefAllAsync('gemAttribute'),
            RefUtil.instance.getRefAllAsync('equip'),
        ]);
        const gemByResId = indexBy(gemRows as Array<Record<string, unknown>>, 'resId');
        const qualityByQ = indexBy(qualityRows as Array<Record<string, unknown>>, 'quality');
        const attrById = indexBy(attrRows as Array<Record<string, unknown>>, 'id');
        const equipByResId = normalizeEquipRows(equipRows as Array<Record<string, unknown>>);

        const cache = CacheMgr.instance;
        const pageId = cache.getTlCmdRole()[0]?.selectEquipPage;
        const page = pageId == null ? undefined : cache.getCmdEquipPage(pageId);

        /** 部位类型（`equipType` 1..6）→ 当前页穿着的装备行。 */
        const pageEquipByType = new Map<number, CmdEquip>();
        for (const row of page?.tlCmdEquip ?? []) {
            const type = equipByResId.get(toCount(row.equipId))?.equipType ?? 0;
            if (type > 0 && !pageEquipByType.has(type)) pageEquipByType.set(type, row);
        }

        /**
         * 当前页某部位已镶嵌宝石的属性事实（`null` 元素 = 空孔 / 属性配置缺失）。
         * `null` 整个返回值 = 当前页该部位没有装备（老端 `GetTmEquipTmWearGem` 返回 null）。
         */
        const wornByType = new Map<number, { facts: (IGemAttrFact | null)[]; ids: Set<string> } | null>();
        const wornOf = (type: number): { facts: (IGemAttrFact | null)[]; ids: Set<string> } | null => {
            if (wornByType.has(type)) return wornByType.get(type) ?? null;
            const row = pageEquipByType.get(type);
            if (!row) {
                wornByType.set(type, null);
                return null;
            }
            const ids = new Set<string>();
            const entries = (row.tlCmdGemInfo ?? []).map(info => {
                const id = toIdString(info.gemId);
                if (!/^[1-9]\d*$/.test(id)) return { order: info.order, fact: null };
                ids.add(id);
                const attrId = cache.getCmdGem(id)?.attribute || Number(id.slice(-4));
                const attr = attrId > 0 ? attrById.get(attrId) : undefined;
                if (!attr) return { order: info.order, fact: null };
                return {
                    order: info.order,
                    fact: {
                        type: toCount(attr.type),
                        quality: toCount(attr.quality) || Math.floor(attrId / 1000) + 1,
                        skillId: toCount(attr.skillId),
                    } satisfies IGemAttrFact,
                };
            });
            // 服务器只下发已镶嵌的孔（不会给 gemId=0 的空条目），必须按 order 补齐 5 个孔位，
            // 否则「还有空孔」这个老端推荐条件会丢失。
            const facts = gemFactsByOrder(entries);
            const worn = { facts, ids };
            wornByType.set(type, worn);
            return worn;
        };

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

            const current: IGemAttrFact | null = attr ? {
                type: toCount(attr.type),
                quality,
                skillId: toCount(attr.skillId),
            } : null;
            const worn = wornOf(toCount(gem.gemType));
            const wornOnCurrent = worn?.ids.has(gemId) ?? false;

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
                attrType: current?.type ?? 0,
                skillId: current?.skillId ?? 0,
                upMark: gemUpMark(current, worn?.facts ?? null, wornOnCurrent, cmd?.num ?? 0),
                masked: !wornOnCurrent && gemSameAttrWorn(current, worn?.facts ?? null),
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
     * 品质框：`curQuality` 是 `equipRank.qualityLevel`（1..17 品质档），需按同阶该行的
     * `quality` 换算成展示品质（1..7），缺失退 equip.quality。
     * upMark（更优装备箭头）口径同老端 `VOEquipItem.GetRatiyRd()`：同部位穿戴装备的
     * `equipLevel.attack + equipRank.attack` 低于本装备才推荐（已穿戴不推荐，见 `equipUpMark`）。
     */
    private async readEquipBag(reportMissing: ReportMissingConfig): Promise<{
        bag: IRoleBagEntry[];
        slots: IRoleEquipSlotData[];
        decomposeResId: number;
    }> {
        const [equipRows, rankRows, levelRows, gainConfig, costConfig] = await Promise.all([
            RefUtil.instance.getRefAllAsync('equip'),
            RefUtil.instance.getRefAllAsync('equipRank'),
            RefUtil.instance.getRefAllAsync('equipLevel'),
            RefUtil.instance.getRefAsync('gameConfig', 'key', 'equipDecomposeGainPer'),
            RefUtil.instance.getRefAsync('gameConfig', 'key', 'equipAddQualityCostId'),
        ]) as [
            Array<Record<string, unknown>>,
            Array<Record<string, unknown>>,
            Array<Record<string, unknown>>,
            Record<string, unknown> | undefined,
            Record<string, unknown> | undefined,
        ];
        const equipByResId = indexBy(equipRows, 'resId');

        // 分解收益：`equipRank[rank, baseQuality]`（老端 `GetBaseEquipRankRef()`，**不是** curQuality）
        // + `CmdEquipItem.costNum` 的 70% 返还（`equipDecomposeGainPer`）。
        const rankByKey = new Map<string, Record<string, unknown>>();
        for (const row of rankRows) {
            const key = equipRankKey(toCount(row.rank), toCount(row.qualityLevel));
            if (row) rankByKey.set(key, row);
        }
        const gainPer = toCount(gainConfig?.value) || EQUIP_DECOMPOSE_DEFAULT_GAIN_PER;
        const decomposeResId = toCount(costConfig?.value);

        // 两表都是解码后的消息数组：`CmdEquipItem`（背包）/ `CmdEquipPart`（6 个部位）。
        const cache = CacheMgr.instance;
        const cmds = cache.getTlCmdEquipItem();
        const parts = cache.getTlCmdEquipPart();

        const equippedIds = new Set<number>();
        const wornByPart = new Map<number, CmdEquipItem>();
        for (const part of parts) {
            // `CmdEquipPart.equip` 是 **required** 字段（d.ts 非空），不用判 null。
            const partId = toCount(part.equipId);
            if (partId >= 1 && partId <= ROLE_EQUIP_PART_COUNT) wornByPart.set(partId, part.equip);
            equippedIds.add(toCount(part.equip.uniqueId));
            const resId = part.equip.resId;
            if (resId > 0 && !equipByResId.has(resId)) reportMissing('equip', `resId=${resId}`);
        }

        // 推荐箭头：同部位穿戴装备的攻击力对比（老端 `VOEquipItem.GetRatiyRd()`）。
        // 强化等级两边取同一部位在当前分页里的等级（老端 `GetPartPageLv` 的取值源），
        // 分页里查不到时退各自 `cmd.rank`；实际差异来自 `equipRank.attack`。
        const pageId = cache.getTlCmdRole()[0]?.selectEquipPage;
        const pageRows = pageId == null ? [] : (cache.getCmdEquipPage(pageId)?.tlCmdEquip ?? []);
        const wornLevelByPart = new Map<number, number>();
        for (const [partId, worn] of wornByPart) {
            const level = equipLevelOf(pageRows, toCount(worn.resId));
            if (level > 0) wornLevelByPart.set(partId, level);
        }
        const qualityLevelOf = (cmd: CmdEquipItem): number =>
            toCount(cmd.curQuality) || toCount(equipByResId.get(toCount(cmd.resId))?.quality) || 1;
        const attackOf = (cmd: CmdEquipItem, partId: number, qualityLevel: number): number => {
            const level = wornLevelByPart.get(partId) ?? toCount(cmd.rank);
            return equipLevelAttackOf(levelRows, level) + equipRankAttackOf(rankRows, toCount(cmd.rank), qualityLevel);
        };

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
            const rank = toCount(cmd.rank);
            // curQuality 是品质档（1..17，equipRank.qualityLevel）；界面品质要换算成 1..7。
            // curQuality 缺失时 equip.quality 本身就是展示品质，不能再当品质档查表。
            const qualityLevel = toCount(cmd.curQuality);
            const fallbackQuality = toCount(equip.quality) || 1;
            const quality = qualityLevel > 0
                ? equipDisplayQuality(rankRows, rank, qualityLevel, fallbackQuality)
                : fallbackQuality;
            const baseRank = rankByKey.get(equipRankKey(rank, toCount(cmd.baseQuality)))
                ?? (qualityLevel > 0 ? rankByKey.get(equipRankKey(rank, qualityLevel)) : undefined);
            const partId = equipPartIdOf(cmd, toCount(equip.equipType));
            const worn = !equipped && partId > 0 ? wornByPart.get(partId) ?? null : null;
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
                rank,
                decompose: equipDecomposeGain(toCount(baseRank?.decompose), toCount(cmd.costNum), gainPer),
                count: 1,
                equipped,
                upMark: !equipped && partId > 0 && equipUpMark(
                    { uniqueId, attack: attackOf(cmd, partId, qualityLevel) },
                    worn ? { uniqueId: toCount(worn.uniqueId), attack: attackOf(worn, partId, qualityLevelOf(worn)) } : null,
                ),
            });
        };

        // 对齐老端 `ModelEquipItem.GetItemBagDataIncludePart()`：已穿戴装备只在 `CmdEquipPart.equip` 中，需并入背包列表。
        for (const part of parts) {
            if (part.equip) pushEquip(part.equip, true);
        }
        for (const cmd of cmds) {
            pushEquip(cmd, equippedIds.has(toCount(cmd.uniqueId)));
        }

        const slots = this.buildEquipSlots(parts, equipRows, equipByResId, rankRows);
        return { bag: out, slots, decomposeResId };
    }

    /**
     * 穿戴实例取自 `CmdEquipPart.equip`，图标、品质和阶数根据该实例生成。
     * 当前装备页按部位提供等级和孔位。部位无匹配页记录时，等级跨页回退，孔位为空。
     */
    private buildEquipSlots(
        parts: readonly unknown[],
        equipRows: readonly unknown[],
        equipByResId: ReadonlyMap<number, Record<string, unknown>>,
        rankRows: readonly unknown[],
    ): IRoleEquipSlotData[] {
        const cache = CacheMgr.instance;
        const pages = cache.getTlCmdEquipPage();
        const activePage = cache.getTlCmdRole()[0]?.selectEquipPage;
        const selected = pages.find(page => page.page === activePage);
        const selectedByPart = new Map((selected?.tlCmdEquip ?? []).map(row => [
            toCount(equipByResId.get(row.equipId)?.equipType), row,
        ]));
        return buildEquipSlotPlan(parts, pages, equipRows, rankRows).map(plan => {
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
