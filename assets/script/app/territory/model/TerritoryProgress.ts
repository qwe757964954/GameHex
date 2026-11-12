import { TerritoryMapConfig, TerritorySite, TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import { TERRITORY_TEXTS } from '../application/TerritoryTexts';

/** 发起探索前回给 UI 的报价。 */
export interface TerritoryExploreQuote {
    cellId: number;
    cells: number[];
    siteId?: string;
    silverCost: number;
    staminaCost: number;
    exploreSeconds: number;
    requiredCombatPower: number;
}

export interface TerritoryExploration extends TerritoryExploreQuote {
    startedAt: number;
    finishesAt: number;
}

/** 存档 JSON 结构，故意不包含地图定义本身。 */
export interface TerritoryProgressData {
    ownedCells?: number[];
    /** 仅服务端快照或 succ=1 的解锁结果写入；离线重进时保留已开启格。 */
    unlockedCells?: number[];
    disabledCells?: number[];
    explorations?: TerritoryExploration[];
    /** 已占领但尚未得到服务端确认的格子；随进度一起落盘。 */
    pendingPassCells?: number[];
}

export type TerritoryExploreCheck =
    | { ok: true; quote: TerritoryExploreQuote }
    | { ok: false; reason: string };

/**
 * 玩家单章领地进度。
 *
 *  静态地图留在 `TerritoryMapConfig`；本类只持有可保存的玩家状态，
 *  因此地图 JSON 重发后能安全恢复。
 */
export class TerritoryProgress {
    private readonly owned = new Set<number>();
    /**
     * **服务端快照确认**的通关格（`passCells` 原样），不含本地结算 / 旧档残留。
     *
     * 与 {@link owned} 的区别：`owned` 是「本地认为已占领」（快照 + 本地结算 + 存档合并，
     * 可能比服务端领先 —— 离线胜利未上报 / 旧档残留时服务端其实没记录）；
     * 这个集合**只由 `applyServerState` 的 `passCells` 写入**，是「服务端已确认通关」的权威。
     * asyncPvp 重复挑战的子类型分流用 `isServerOwned`（已通关传宝箱子类型 2，未通关传 1）：
     * 用 `isOwned` 会被本地旧档残留误判 ⇒ 没打过的格也传 2，服务端回「配置错误」。
     * 不落档（会话内由快照填充），切章 / 重进重新按快照建立。
     */
    private readonly serverOwned = new Set<number>();
    private readonly disabled = new Set<number>();
    private readonly explorations = new Map<number, TerritoryExploration>();
    private readonly pendingPasses = new Set<number>();
    /**
     * 服务端 `unlockCells`：已解锁、可探索的格子。
     *
     * ⚠️ 与 {@link disabled} 是**两回事**：这个是"服务端允许点"，那个是"玩家手动关掉"。
     */
    private readonly unlockable = new Set<number>();
    /** 服务端格子状态是否已成功拉取过；false 时 {@link isUnlockable} 一律放行。 */
    private serverStateKnownFlag = false;

    constructor(readonly map: TerritoryMapConfig, saved?: TerritoryProgressData) {
        const total = map.rows * map.columns;
        const validCell = (cell: unknown): cell is number =>
            typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < total;
        for (const cell of saved?.ownedCells ?? []) if (validCell(cell)) this.owned.add(cell);
        for (const cell of saved?.unlockedCells ?? []) if (validCell(cell)) this.unlockable.add(cell);
        // 章节必有一个立足点：旧存档没有 ownedCells 时迁回起点。
        this.owned.add(map.startCellId);
        for (const cell of saved?.pendingPassCells ?? []) {
            if (validCell(cell) && cell !== map.startCellId && this.owned.has(cell)) this.pendingPasses.add(cell);
        }
        for (const cell of saved?.disabledCells ?? []) {
            if (validCell(cell) && cell !== map.startCellId) this.disabled.add(cell);
        }
        for (const exploration of saved?.explorations ?? []) {
            if (!validCell(exploration?.cellId)
                || this.owned.has(exploration.cellId)
                || this.disabled.has(exploration.cellId)) continue;
            const cells = (exploration.cells ?? []).filter(validCell);
            if (!cells.length) continue;
            if (cells.some((cell) => this.owned.has(cell) || this.disabled.has(cell))) continue;
            this.explorations.set(exploration.cellId, { ...exploration, cells: Array.from(new Set(cells)) });
        }
    }

    // 以下四处的 Set/Map 展开都走 `Array.from`：release 构建会把 `[...set]`
    // 降级成 `[].concat(set)`，而 concat 不展开迭代器 → 拿到装着 Set 本身的
    // 单元素数组，`.sort()` 不报错但结果完全错误。
    get ownedCells(): readonly number[] {
        return Array.from(this.owned).sort((a, b) => a - b);
    }

    get pendingPassCells(): readonly number[] {
        return Array.from(this.pendingPasses).sort((a, b) => a - b);
    }

    get disabledCells(): readonly number[] {
        return Array.from(this.disabled).sort((a, b) => a - b);
    }

    get activeExplorations(): readonly TerritoryExploration[] {
        return Array.from(this.explorations.values())
            .sort((a, b) => a.finishesAt - b.finishesAt || a.cellId - b.cellId);
    }

    /**
     * 把服务端 `CmdCityChapterCellInfoRspMsg` 的格子状态**合并**进来。
     *
     * ## 语义映射（两边名字不同，别按字面对号入座）
     *
     * | 服务端字段 | 本地 | 含义 |
     * |---|---|---|
     * | `passCells`（已通关） | `owned` | **已占领** ← 就是同一个东西 |
     * | `unlockCells`（已解锁） | `unlockable` | 战斗格可探索；固定资源格已领取 |
     * | `rewardState` | 不落本地 | 章节领奖态由服务端权威，客户端不存 |
     *
     * ⚠️ 服务端的 `unlockCells` **不是**本地的 `disabled`（那是"玩家手动关掉的站点"），
     * 两者千万别混：一个管"能不能点"，一个管"玩家要不要它"。
     *
     * ## `passCells` 只增；`unlockCells` 是**完整集合**
     *
     * 协议里两个都是 bitSet（`repeated uint64`），**一次性给全量**。所以：
     *  - `passCells` 单调增加（本地可能在等服务端确认，覆盖会丢待确认态）；
     *  - `unlockCells` 在 `replaceUnlocks` 时**按快照重建**（见下）。
     *
     * ## 🔴 为什么 `unlockCells` 必须能重建（2026-11-09 实机）
     *
     * 原来这条也是单调 `add`，而 `unlockable` 在构造时还会灌入**本地存档**的
     * `unlockedCells` ⇒ 两份数据只并集、从不清 ⇒ 本地一旦领先服务端就永久领先。
     * 症状：点一个「服务端认为前置未解锁」的关卡格，客户端判前置全满足 ⇒ **不上锁**、
     * 直接发 `CmdCityChapterUnlockCellReqMsg`，服务端回 `CmdTips「前置地块未解锁」`。
     * 玩家看到的是一句莫名其妙的红字，而不是地图上那把锁。
     *
     * @param options.replaceUnlocks 传 `true` 表示这是一次**完整快照**（`CmdCityChapterCellInfoRspMsg`）：
     *   `unlockable` 先用快照重建，本地存档里多出来的格跟着消失。
     *   ⚠️ `CmdCityChapterPassCellBroMsg`（只讲通关、`unlockCells` 传空）**绝不能**传它，
     *   否则整章格子会被清成未解锁、玩家一个都点不动。
     *
     * @returns 新增占领的格子（升序）。调用方据此决定要不要提示 / 刷新。
     */
    applyServerState(
        state: { readonly unlockCells: readonly number[]; readonly passCells: readonly number[] },
        options?: { readonly replaceUnlocks?: boolean },
    ): number[] {
        const total = this.map.rows * this.map.columns;
        const validCell = (cell: unknown): cell is number =>
            typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < total;
        const added: number[] = [];
        for (const cell of state.passCells ?? []) {
            this.pendingPasses.delete(cell);
            if (!validCell(cell)) continue;
            // 服务端确认通关的，无条件记入权威集合（本地是否已 owned 都算确认过）。
            this.serverOwned.add(cell);
            if (this.owned.has(cell)) continue;
            // 服务端说通关了 ⇒ 本地视为已占领（探索中的那格直接被占，无需等settle）。
            this.explorations.delete(cell);
            this.disabled.delete(cell);
            this.owned.add(cell);
            added.push(cell);
        }
        // 完整快照 ⇒ 重建解锁集：本地存档 / 旧回包里多出来的格子必须跟着消失，
        // 否则前置判定会放行一个服务端认为未解锁的格（见方法头注）。
        // 完整快照 ⇒ 重建解锁集：本地存档 / 旧回包里多出来的格子必须跟着消失，
        // 否则前置判定会放行一个服务端认为未解锁的格（见方法头注）。
        // ⚠️ **空数组不清空**：`unlockCells` 为空只可能是「服务端还没算好 / 桩数据 / 旧包」，
        //    真清空会让整章格子一个都点不动（连起点格都没解锁）。宁可留着本地多出的格
        //    （最多被服务端打回一次「前置地块未解锁」），也不能一次空包把图清死。
        if (options?.replaceUnlocks && (state.unlockCells?.length ?? 0) > 0) this.unlockable.clear();
        for (const cell of state.unlockCells ?? []) {
            if (!validCell(cell)) continue;
            this.unlockable.add(cell);
        }
        return added.sort((a, b) => a - b);
    }

    /**
     * 这格是否**可探索**（服务端已解锁）。
     *
     * ⚠️ 服务端没给过状态时（`unlockCells` 为空且尚未拉取）**一律放行** ——
     * 收紧会让玩家在离线 / 请求失败时点不动任何格子。
     */
    isUnlockable(cellId: number): boolean {
        return this.serverStateKnown ? this.unlockable.has(cellId) : true;
    }

    /** 仅服务端快照或成功的解锁回包能确认此状态；固定资源点据此判断是否已领取。 */
    isCellUnlocked(cellId: number): boolean {
        return this.unlockable.has(cellId);
    }

    get unlockedCells(): readonly number[] {
        return Array.from(this.unlockable).sort((a, b) => a - b);
    }

    /** 服务端格子状态是否已成功拉取过（用来区分"没解锁"与"还不知道"）。 */
    get serverStateKnown(): boolean {
        return this.serverStateKnownFlag;
    }

    /**
     * 标记服务端状态已拉取。
     *
     * ⚠️ 只在**成功**拉到回包时调（`TerritoryPage.mergeServerState` 里）——
     * 请求失败时保持 false，否则 {@link isUnlockable} 会用"全不放行"白送一次全图可探索。
     */
    markServerStateKnown(known = true): void {
        this.serverStateKnownFlag = known;
        if (!known) this.unlockable.clear();
    }

    /**
     * 单格解锁成功后的本地记账（配合 `TerritoryCellRepository.unlockCell`）。
     * 服务端返回 `succ=1` 之后才调 —— **不乐观更新**。
     */
    markCellUnlocked(cellId: number): void {
        if (Number.isInteger(cellId) && cellId >= 0 && cellId < this.map.rows * this.map.columns) {
            this.unlockable.add(cellId);
        }
    }

    /**
     * 按**服务端回包给的格子清单**批量记账解锁（`CmdCityChapterUnlockCellRspMsg.cellId`）。
     *
     * ## 为什么要批量
     *
     * 解锁回包的 `cellId` 是 **`repeated uint32`**：服务端按「相同 `configId` = 一片战斗区域」
     * 把同区域的一起解锁。实机日志（2026-10-10）：请求 `cellId:327`、回包 `cellId:[327, 328]`。
     * 只记请求的那一格 ⇒ 同区域其余格在界面上仍是锁态，玩家以为要一格格点。
     *
     * @param cellIds 服务端回的格子清单；空数组时**什么都不做**（不退回请求格——
     *   记账必须以服务端为准，客户端替它猜会把没解锁的格也标成可点）。
     * @returns 实际新增解锁的格子（升序），供调用方决定要不要刷新/ 写盘。
     */
    markCellsUnlocked(cellIds: readonly number[]): number[] {
        const total = this.map.rows * this.map.columns;
        const added: number[] = [];
        for (const cell of cellIds) {
            if (!Number.isInteger(cell) || cell < 0 || cell >= total) continue;
            if (this.unlockable.has(cell)) continue;
            this.unlockable.add(cell);
            added.push(cell);
        }
        return added.sort((a, b) => a - b);
    }

    /**
     * 单格通关成功后的本地记账（配合 `TerritoryCellRepository.passCell`）。
     * 服务端返回 `succ=1` 之后才调 —— **不乐观更新**。
     */
    markCellPassed(cellId: number): void {
        if (!Number.isInteger(cellId) || cellId < 0 || cellId >= this.map.rows * this.map.columns) return;
        this.explorations.delete(cellId);
        this.disabled.delete(cellId);
        this.owned.add(cellId);
    }

    /**
     * 按**服务端回包给的格子清单**批量记账通关（**随机格解锁即通关**专用）。
     *
     * ## 为什么随机格需要它
     *
     * 随机格没有「通关」这一步：解锁成功即由服务端发奖（见
     * `docs/领地随机资源跨端规则.md`），但解锁记账只把格子放进 `unlockable`，
     * 地图底色仍是泥地（未通关）—— 玩家翻开后看不到草地地块，
     * 还会以为要再点一次。
     *
     * ⚠️ **不加入 `pendingPasses`**：随机格永远不发 `CmdCityChapterPassCellReqMsg`
     * （服务端在解锁时已结算）。这与 `settle()` 到期占领的记账不同，别复用那条。
     *
     * ⚠️ 调用前仍需先调 {@link markCellsUnlocked}：服务端快照里随机格在 `unlockCells`，
     * 两个集合都保留，与已领取的 `fixedResource` 格「同时在 unlockable 与 owned」口径一致。
     *
     * ## 🔴 只认随机候选格（2026-11-06 修 chapter_02 的「boss 没通关就变蓝」）
     *
     * 入参是**服务端的解锁回包**，而回包的 `cellId` 是「一片区域一起解锁」的整批
     * （实测：请求 327 → 回 `[327, 328]`）。原实现对整批无差别地记 `owned`，于是只要回包里
     * 混进一个关卡 / 首领格，那格就变成「已通关」—— 表现是**地块变草地 + 编号气泡变蓝
     * （`isAreaPassed` 判 `owned`）+ `owned ⊆ opened` 直接把后继关卡提前揭示**，
     * 而玩家根本没打过那一关（用户 2026-11-06：chapter_02 的 boss「尚未通关就已经显示成
     * 已通过的蓝色气泡」「解锁关系没有绑到 2-9，提前披露了」）。
     *
     * 「解锁 = 通关」这条特例**只对随机格成立**（服务端在解锁时结算发奖），
     * 关卡 / 首领 / 宝箱格必须走各自的 passCell 或战斗流程 ⇒ 这里按 `randomSites.candidateCells`
     * 白名单过滤。⚠️ 老地图没有 `randomSites` 时（清单为空）保持原样全收，避免整章随机格失效。
     *
     * @param cellIds 服务端回包给的格子清单（与解锁同一清单）。
     * @returns 实际新增占领的格子（升序），供调用方决定写盘 / 刷新。
     */
    markCellsPassed(cellIds: readonly number[]): number[] {
        const total = this.map.rows * this.map.columns;
        const candidates = this.randomCandidateCells();
        const added: number[] = [];
        for (const cell of cellIds) {
            if (!Number.isInteger(cell) || cell < 0 || cell >= total) continue;
            // 白名单为空 = 这张图没配随机点 ⇒ 不做过滤（老图兼容）；配了就必须是候选格。
            if (candidates && !candidates.has(cell)) continue;
            this.explorations.delete(cell);
            this.disabled.delete(cell);
            if (this.owned.has(cell)) continue;
            this.owned.add(cell);
            added.push(cell);
        }
        return added.sort((a, b) => a - b);
    }

    /** 随机候选格集合（缓存）；`null` = 这张图没配 `randomSites`。 */
    private randomCandidatesCache: Set<number> | null | undefined;
    private randomCandidateCells(): Set<number> | null {
        if (this.randomCandidatesCache !== undefined) return this.randomCandidatesCache;
        const cells = this.map.randomSites?.candidateCells;
        this.randomCandidatesCache = cells?.length ? new Set(cells) : null;
        return this.randomCandidatesCache;
    }

    /**
     * 这一格是否「同区域已通关」—— **任一同 `configId` 的格子 owned，整片都算已通关**。
     *
     * ## 为什么需要（2026-10-12）
     *
     * 山猫口径：「327 与 328 configId 一样，都是打同一关卡，**327 / 328 算一起的**」。
     * 二者在同一片战斗区域（`configId=10001`），只差`buildingId`（328 有、327 没有）
     * ⇒ 通关一次就该整片一起变已通关外观，而不是「打的是327、结果 328 还显示可通关」。
     *
     * ## 🔴 只在**查询态**扩散，不动 `owned` 存储
     *
     * `owned` 会被 `ownedCells` 落进存档、被服务端 `passCells` 快照合并、喂
     * `territoryChapterCompletion` 算章节进度分母。若在这里把同区域的格子都写进 `owned`：
     * - 存档多出一批「从没单独打过」的格子；
     * - 服务端快照回来时它们会被当成「本地已占领但服务端没确认」⇒ 反复重报通关。
     *
     * 所以只在这里把「这一格的区域组里有没有 owned」当查询条件返回，**存储仍是原本打过的那几格**。
     *
     * 区域组 = 所有 `type ∈ {stage, boss, asyncPvp}` 且 `configId` 是**同一个非空数字**的站点。
     * 非战斗类型（`fixedResource` / `bonus`）**不参与** ——
     * 它们各是各的据点（`fixedResource` 甚至同 configId 有 3 个格子，见 map 配置）。
     */
    isAreaPassed(cellId: number): boolean {
        if (this.owned.has(cellId)) return true;
        const area = this.areaPeers(cellId);
        return area.some((peer) => this.owned.has(peer));
    }

    /** 同区域的其它格子（不含自己）。非战斗站点或configId 非数字 ⇒ 空数组。 */
    areaPeers(cellId: number): readonly number[] {
        const { byCell, byConfig } = this.areaIndex();
        const configId = byCell.get(cellId);
        if (configId === undefined) return [];
        return (byConfig.get(configId) ?? []).filter((peer) => peer !== cellId);
    }

    /**
     * 同区域战斗格索引（`cellId → configId` 与 `configId → cellId[]`）。
     *
     * `map` 在实例生命周期内不变 ⇒ **构建一次后缓存**，把原来 `areaPeers` 每次调用的
     * 两趟 `map.sites` 线性扫描（`find` + `filter`）降为一次性构建 + O(1) 查表。
     * `areaPeers` 走渲染热路径（`isAreaPassed` → `isCellActivated` / `levelInfoContent`
     * 每格一调），全量重渲染时原先是几千次数组扫描。
     *
     * 区域组 = 所有 `type ∈ {stage, boss, asyncPvp}` 且 `configId` 为非空数字串的站点
     * （口径与下方 `isPrerequisiteComplete` 一致；fixedResource 同 configId 有多格，不参与）。
     */
    private areaIndexCache: { byCell: Map<number, string>; byConfig: Map<string, number[]> } | null = null;
    private areaIndex(): { byCell: Map<number, string>; byConfig: Map<string, number[]> } {
        if (this.areaIndexCache) return this.areaIndexCache;
        const byCell = new Map<number, string>();
        const byConfig = new Map<string, number[]>();
        for (const peer of this.map.sites) {
            const isBattleSite = peer.type === TERRITORY_SITE_TYPE.stage || peer.type === TERRITORY_SITE_TYPE.boss || peer.type === TERRITORY_SITE_TYPE.asyncPvp;
            if (!isBattleSite) continue;
            const configId = peer.configId;
            if (typeof configId !== 'string' || !/^\d+$/.test(configId)) continue;
            byCell.set(peer.cellId, configId);
            const list = byConfig.get(configId);
            if (list) list.push(peer.cellId);
            else byConfig.set(configId, [peer.cellId]);
        }
        this.areaIndexCache = { byCell, byConfig };
        return this.areaIndexCache;
    }

    isOwned(cellId: number): boolean { return this.owned.has(cellId); }

    /**
     * 服务端快照是否**确认过**这格通关（`passCells` 权威，不含本地结算 / 旧档残留）。
     *
     * asyncPvp 子类型分流用它：本地旧档残留的 owned 会让 `isOwned` 误判「已通关」，
     * 未打过的格也会发宝箱战斗子类型 2 ⇒ 服务端「配置错误」。
     */
    isServerOwned(cellId: number): boolean { return this.serverOwned.has(cellId); }
    isDisabled(cellId: number): boolean { return this.disabled.has(cellId); }
    explorationAt(cellId: number): TerritoryExploration | null {
        return this.explorations.get(cellId) ?? null;
    }

    setDisabled(cellId: number, disabled: boolean): boolean {
        if (!this.isCellInMap(cellId)
            || cellId === this.map.startCellId
            || this.owned.has(cellId)
            || this.isExploringCell(cellId)) return false;
        if (disabled) this.disabled.add(cellId);
        else this.disabled.delete(cellId);
        return true;
    }

    /** 只判地图门槛；钱包与战力由调用方负责。 */
    checkExplore(cellId: number, combatPower: number): TerritoryExploreCheck {
        const result = this.checkUnlock(cellId, combatPower);
        if (!result.ok) return result;
        if (this.serverStateKnownFlag && !this.unlockable.has(cellId)) {
            return { ok: false, reason: TERRITORY_TEXTS.cellNotUnlocked };
        }
        return result;
    }

    /** 申请解锁只看本地前置；是否允许解锁由写请求响应裁定。 */
    checkUnlock(cellId: number, combatPower: number): TerritoryExploreCheck {
        if (!this.isCellInMap(cellId)) return { ok: false, reason: TERRITORY_TEXTS.cellOutOfMap };
        if (this.owned.has(cellId)) return { ok: false, reason: TERRITORY_TEXTS.cellAlreadyOwned };
        if (this.disabled.has(cellId)) return { ok: false, reason: TERRITORY_TEXTS.cellDisabled };
        if (this.isExploringCell(cellId)) return { ok: false, reason: TERRITORY_TEXTS.cellExploring };
        const site = this.siteForCell(cellId);
        const cells = site ? Array.from(new Set(site.footprint)) : [cellId];
        if (cells.some((cell) => this.owned.has(cell))) {
            return { ok: false, reason: TERRITORY_TEXTS.footprintAlreadyOwned };
        }
        if (cells.some((cell) => this.disabled.has(cell) || this.isExploringCell(cell))) {
            return { ok: false, reason: TERRITORY_TEXTS.footprintLocked };
        }
        const unlock = site?.unlock ?? this.map.defaults;
        if (this.prerequisiteBlockers(cellId).length) {
            return { ok: false, reason: TERRITORY_TEXTS.prerequisiteNotOwned };
        }
        if (!Number.isFinite(combatPower) || combatPower < unlock.combatPower) {
            return { ok: false, reason: TERRITORY_TEXTS.combatPowerNotEnough };
        }
        return {
            ok: true,
            quote: {
                cellId,
                cells,
                ...(site ? { siteId: site.id } : {}),
                silverCost: unlock.silverCost,
                staminaCost: unlock.staminaCost,
                exploreSeconds: unlock.exploreSeconds,
                requiredCombatPower: unlock.combatPower,
            },
        };
    }

    /** 战斗胜利后开始探索；离线胜利不能被尚未同步的解锁快照抹掉。 */
    startExplore(
        cellId: number,
        combatPower: number,
        now = Date.now(),
    ): TerritoryExploreCheck {
        const result = this.checkUnlock(cellId, combatPower);
        if (!result.ok) return result;
        const { quote } = result;
        this.explorations.set(cellId, {
            ...quote,
            startedAt: now,
            finishesAt: now + quote.exploreSeconds * 1000,
        });
        return result;
    }

    /** 回收已完成的探索，返回本拍新占领的格子。 */
    settle(now = Date.now()): number[] {
        const claimed: number[] = [];
        for (const [cellId, exploration] of Array.from(this.explorations)) {
            if (exploration.finishesAt > now) continue;
            this.explorations.delete(cellId);
            for (const cell of exploration.cells) {
                if (!this.disabled.has(cell) && !this.owned.has(cell)) {
                    this.owned.add(cell);
                    this.pendingPasses.add(cell);
                    claimed.push(cell);
                }
            }
        }
        return claimed.sort((a, b) => a - b);
    }

    toJSON(): TerritoryProgressData {
        return {
            ownedCells: Array.from(this.ownedCells),
            unlockedCells: Array.from(this.unlockedCells),
            disabledCells: Array.from(this.disabledCells),
            pendingPassCells: Array.from(this.pendingPassCells),
            explorations: this.activeExplorations.map((item) => ({
                ...item,
                cells: Array.from(item.cells),
            })),
        };
    }

    /**
     * 这个 cellId 落在哪个站点的 `footprint` 里（一格最多一个站点）。
     *
     * `map` 在实例生命周期内不变 ⇒ 建一次 `footprint → site` 索引后缓存：
     * 它现在走**渲染热路径**（`isPrerequisiteComplete` ← `territoryRevealedCells` 每帧逐站点判），
     * 原来的 `map.sites.find(...)` 是 O(站点数) 线性扫描，全量重渲染时是几千次数组遍历。
     */
    private siteByCellCache: Map<number, TerritorySite> | null = null;
    private siteForCell(cellId: number): TerritorySite | null {
        if (!this.siteByCellCache) {
            const index = new Map<number, TerritorySite>();
            for (const site of this.map.sites) {
                for (const cell of site.footprint) {
                    // 与原来的 `find` 同口径：一个格子只归**第一个**命中的站点。
                    if (!index.has(cell)) index.set(cell, site);
                }
            }
            this.siteByCellCache = index;
        }
        return this.siteByCellCache.get(cellId) ?? null;
    }

    /**
     * 这一格**还没满足的前置格**（`requiredCells` 里 `isPrerequisiteComplete` 为假的那些）。
     *
     * 判据与 {@link checkUnlock} 的拦截**同源**（那边直接调本方法），所以「被拦截」与
     * 「提示里列出来的那几格」永远是一回事 —— 不会出现"拦了但说不出拦在哪"。
     *
     * 用途：玩家看得见的提示要具体到前置对象（需求 2026-11-02），由
     * `TerritoryModel` 翻译成 `1-1 关卡通关后解锁` / `前置宝箱未打开`。
     * 返回**去重**后的 cellId；顺序沿用配置里的书写顺序（编辑器里的连线顺序）。
     */
    prerequisiteBlockers(cellId: number): number[] {
        const site = this.siteForCell(cellId);
        const required = site?.unlock?.requiredCells ?? this.map.defaults.requiredCells ?? [];
        return Array.from(new Set(required)).filter((cell) => !this.isPrerequisiteComplete(cell));
    }

    /**
     * 这一格的前置里，**已经解锁、但还没点开领取**的固定资源（宝箱）格。
     *
     * ## 为什么要单独列出来（2026-11-09 用户）
     *
     * > 「前置地块未解锁，展示的也是锁 icon，不是银币 + 显示红色的 UI」
     *
     * 前置宝箱走在 {@link isPrerequisiteComplete} 的**固定资源特例**里（`unlockable` 即算完成），
     * 所以它既不进 {@link prerequisiteBlockers}、也不挡住点击 —— 解服务器口径就是这样
     * （`unlockCells` 里记 completed）。但**玩家眼里那只宝箱还闭着**，后继格只把银币数字
     * 染红（旧口径：山猫 2026-10-21）读起来像「钱不够」，和「先把宝箱点了」完全不是一回事。
     *
     * ⇒ 显示侧把这一种也归进「前置没完成」，画锁（见 `lockBlockedCells`），
     *   红字只留给**真的缺钱**。⚠️ 只影响画法：点击拦截仍走 {@link checkUnlock}，
     *   这一种**照常能解锁**（服务端允许），锁只是提示。
     */
    unclaimedFixedPrerequisites(cellId: number): number[] {
        const site = this.siteForCell(cellId);
        const required = site?.unlock?.requiredCells ?? this.map.defaults.requiredCells ?? [];
        const out: number[] = [];
        for (const cell of new Set(required)) {
            if (this.owned.has(cell)) continue;
            if (!this.unlockable.has(cell)) continue;
            if (this.siteForCell(cell)?.type !== TERRITORY_SITE_TYPE.fixedResource) continue;
            out.push(cell);
        }
        return out;
    }

    /**
     * 这一格是不是「被前置卡住」—— **显示侧的唯一口径**（`siteOpenableCells` 排除、`lockBlockedCells` 纳入）。
     *
     * 两个来源取并集：
     *  ① {@link prerequisiteBlockers}：前置关卡没打通 / 前置格根本还没开；
     *  ② {@link unclaimedFixedPrerequisites}：前置宝箱解锁了却没点开（服务端已算完成）。
     *
     * 🔴 与 {@link checkUnlock} 的**拦截**口径不是同一条：②只影响画法，不拦点击。
     */
    isPrerequisitePending(cellId: number): boolean {
        return this.prerequisiteBlockers(cellId).length > 0
            || this.unclaimedFixedPrerequisites(cellId).length > 0;
    }

    /**
     * 这一格**是否已经「完成」**（可以当作别人的前置了）。
     *
     * 🔴 **唯一口径**：点击拦截（{@link prerequisiteBlockers} ← `checkUnlock`）与
     * **显示侧的揭示**（`territoryRevealedCells`）都走这一个方法。
     *
     * 2026-11-06 之前显示侧自己写的是「`owned ∪ unlocked` 里有就算满足」，
     * 于是**只要把 2-9 的格子用银币解锁、根本不用打**，2-10（首领）就露出来了 ——
     * 用户原话：「boss 关卡的解锁关系没有绑定到 2-9 的关卡中，提前披露了」。
     * 拦截那一侧本来就是「必须通关」，两边不同源才是那个 bug 的根。
     */
    isPrerequisiteComplete(cellId: number): boolean {
        if (this.owned.has(cellId)) return true;
        const site = this.siteForCell(cellId);
        // 固定资源只进入 unlockCells，不进入 passCells；后继站点仍需把它视为已完成。
        if (site?.type === TERRITORY_SITE_TYPE.fixedResource && this.unlockable.has(site.cellId)) return true;
        if (site && (site.type === TERRITORY_SITE_TYPE.stage || site.type === TERRITORY_SITE_TYPE.boss || site.type === TERRITORY_SITE_TYPE.asyncPvp)) {
            return this.isAreaPassed(site.cellId);
        }
        // 🔴 2026-10-15：关卡前置**改走区域口径**（同 `configId` 任一格 owned 即算完成），
        // 与显示侧 `isAreaPassed` 对齐。
        //
        // 之前这里是严格 `owned.has(cellId)`，而显示是区域共享 ⇒ 两套口径：
        // 玩家看到 327/328（configId=10001）整片绿「已通关」，点 cellId 309 却弹
        // 「前置领地尚未占领」且**一个协议都不发**（真机实证）。
        // 而且 328 才有建筑、玩家只点 328 ⇒ 327 永远拿不到 owned ⇒ 不改就是死锁。
        //
        // ⚠️ 只对 stage/boss/asyncPvp 生效：fixedResource 是上一行那条「解锁即完成」的特例，
        //    两者别混成一条（fixedResource 同 configId 有多格，绝不能区域共享）。
        return false;
    }

    private isExploringCell(cellId: number): boolean {
        for (const exploration of this.explorations.values()) {
            if (exploration.cells.includes(cellId)) return true;
        }
        return false;
    }

    private isCellInMap(cellId: number): boolean {
        return Number.isInteger(cellId) && cellId >= 0 && cellId < this.map.rows * this.map.columns;
    }
}
