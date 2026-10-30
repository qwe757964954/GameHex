import { GameNet } from '../../net/GameNet';
import { withTimeout } from '../../net/RequestGuard';
import { startBattle as requestStartBattle } from '../../battle/BattleStartService';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import {
    RequestTerritoryCellInfo,
    RequestTerritoryIdleReward,
    RequestTerritoryPassCell,
    RequestTerritorySweep,
    RequestTerritoryUnlockCell,
} from './RequestTerritoryCellInfoMsg';
import {
    decodeCellBitSet,
    emptyCellState,
    ITerritoryCellState,
    isRewardClaimed,
} from '../model/TerritoryCellBitSet';
import { readTerritoryGrantedRewards } from '../model/TerritoryGrantedReward';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import { TERRITORY_REQUEST_STATUS, type TerritoryRequestFailure, type TerritoryRequestTransportFailure } from '../model/TerritoryRequestStatus';

/**
 * 占城（领地）· 服务端数据端口。
 *
 * 只做「与服务端说话 + 把回包搬成快照」，**不碰本地存档**——
 * 落地要交给 `TerritoryProgress`（它有"起点必占领""探索中的格不可重复占领"等规则）。
 * 合并策略见 `TerritoryPage.mergeServerState`。
 *
 * ## 走主动请求而不是 `CacheMgr`
 *
 * 这几条**格子状态表**服务端不按 key 推（`protoCache.json` 里没有），
 * `CacheMgr` 那套「按 key 查已推送缓存」用不上 ⇒ 必须主动 req。
 * ⚠️ 误用 `CacheMgr.getTl…()` 会拿到**恒空数组**，症状是"格子状态永远是空的、零报错" ——
 * 这正是 `ProcedureMatching` 踩过的坑（推送表没人写却当数据源用）。
 *
 * ⚠️ 例外是 **`CmdCityChapterPassCellBroMsg`（通关格子广播）**—— 它是**真的服务端主动推**，
 * 由 `MainTerritoryMap` 通过 `GameNet.addEvent` 订阅，不走 req、也不进 `CacheMgr`。
 * 所以「服务端一条都不推」只对 **req 侧那张表**成立，别拿它当「没有推送」的证据。
 *
 * ## ⚠️ 写请求一律**不乐观更新**
 *
 * 解锁 / 通关 / 扫荡 / 领奖都等服务端 `succ`，成功才由调用方改本地状态。
 * 乐观更新（先改本地、失败再回滚）在这种场景特别糟：
 * ① 回滚容易漏（多处读同一个快照）；② 断线时"看起来成功了"的假象会误导玩家；
 * ③ 本地存档是**唯一**副本（`TerritorySaveStore` 走 localStorage），弄脏了没法恢复。
 *
 * ⚠️ **Bro 是唯一例外**：它是服务端权威事实的主动通知（别人打通了格子），
 * 收到就应当直接落地，不存在"回滚"问题。
 */

/** 拉取结果三态，调用方据此决定"用服务端数据 / 回落本地存档 / 提示重试"。 */
export type TerritoryCellFetchResult =
    | { readonly ok: true; readonly state: ITerritoryCellState }
    | { readonly ok: false; readonly reason: TerritoryRequestTransportFailure; readonly state: ITerritoryCellState };

/** 写操作结果：`rejected` 表示服务端明确回了 `succ = 0`（业务拒绝，不是网络问题）。 */
export type TerritoryWriteResult =
    | { readonly ok: true; readonly unlockedCellIds?: readonly number[]; readonly rewards?: readonly ITerritoryGrantedReward[] }
    | { readonly ok: false; readonly reason: TerritoryRequestFailure };

/** Boss 关开战（`CmdStartBattleReqMsg`）结果；`rejected` = 服务端拒绝（业务原因）。 */
export type TerritoryStartBattleResult =
    | { readonly ok: true; readonly battle: ZCBattleStart }
    | { readonly ok: false; readonly reason: TerritoryRequestFailure };

/** 读超时：与服务端断连时不能让领地页一直转圈。 */
const READ_TIMEOUT_MS = 5000;

/**
 * 从 rsp 里读 `repeated uint32 cellId` 数组。
 *
 * ⚠️ 正常是**普通 `number[]`**（`uint32` 不是 `uint64`，protobufjs 不会给 `Long`），
 * 这里仍做 `Number()` 归一 —— 万一运行时换了解码器，也不会静默拿到对象被 `Number()` 变 `NaN`。
 * 非法项（`NaN` / 非整数 / 负数）直接丢，不让脏数据进本地进度。
 */
function readCellIdArray(rsp: unknown): number[] {
    const raw = (rsp as { cellId?: unknown } | null)?.cellId;
    if (!Array.isArray(raw)) return [];
    const out: number[] = [];
    for (const item of raw) {
        const cell = Number(item);
        if (Number.isInteger(cell) && cell >= 0) out.push(cell);
    }
    return out;
}

export class TerritoryCellRepository {
    private state: ITerritoryCellState | null = null;

    /**
     * 最近一次拉到的快照；从未拉过返回 `null`。
     *
     * ⚠️ **别返回空快照**冒充"服务端说没有数据" —— 两者含义完全不同：
     * 前者= 还没问过，后者 = 问过了确实是空的。领地页靠它决定要不要回落本地存档。
     */
    get snapshot(): ITerritoryCellState | null {
        return this.state;
    }

    /** 只排除请求回调实际收到的响应对象；在途请求不能吞掉其它章节或主动推送。 */
    private readonly fetchedResponses = new WeakSet<object>();

    /** 解析页面收到的完整快照；请求响应由 fetchChapterCells 自己处理。 */
    readCellInfo(msg: unknown, maxCell?: number): ITerritoryCellState | null {
        if (msg && typeof msg === 'object' && this.fetchedResponses.has(msg)) {
            this.fetchedResponses.delete(msg);
            return null;
        }
        const record = msg as { levelChapter?: unknown } | null;
        const chapter = this.normalizeChapter(Number(record?.levelChapter));
        const state = this.readState(msg, chapter, maxCell, true);
        if (state) this.state = state;
        return state;
    }

    /** Bro 的 cellId 是普通 uint32 列表，不是快照使用的 uint64 位集。 */
    readPassCellsBro(msg: unknown): { readonly levelChapter: number; readonly cellIds: readonly number[] } | null {
        const record = msg as { levelChapter?: unknown; cellId?: unknown } | null;
        if (!record || typeof record !== 'object') return null;
        const raw = record.cellId;
        const cellIds = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
            .map(Number)
            .filter((cell) => Number.isInteger(cell) && cell >= 0);
        if (cellIds.length === 0) return null;
        return { levelChapter: this.normalizeChapter(Number(record.levelChapter)), cellIds };
    }

    /**
     * 拉一章的格子状态。
     *
     * @param levelChapter 章节号（= 领地侧 `chapterId`）
     * @param maxCell 该章格子总数（`rows × columns`）。服务端若已扩容章节而客户端拿的是旧地图，
     *   超出的格子会被裁掉 —— 否则领地页会算出越界坐标。
     * @param caller 生命周期宿主（关界面时用来断回调）
     */
    async fetchChapterCells(
        levelChapter: number,
        maxCell: number,
        caller?: object,
    ): Promise<TerritoryCellFetchResult> {
        const chapter = this.normalizeChapter(levelChapter);
        let resolved: ITerritoryCellState | null = null;
        const sent = await this.send(
            () => new RequestTerritoryCellInfo({ levelChapter: chapter }, caller, (rsp) => {
                if (rsp && typeof rsp === 'object') this.fetchedResponses.add(rsp);
                resolved = this.readState(rsp, chapter, maxCell);
            }),
            '[TerritoryCell] 拉取章节格子信息失败',
        );
        if (sent !== TERRITORY_REQUEST_STATUS.ok) return this.failFetch(sent, chapter);
        // ⚠️ `ok` 只代表**包发出去了且没抛**，回调可能还没跑（超时兜底会先返回）。
        // 这里必须判null ⇒ invalid，而不是拿 `emptyCellState` 当正常结果 ——
        // 否则"回包没到"会表现成"服务端说这章一个格子都没有"。
        if (!resolved) return this.failFetch(TERRITORY_REQUEST_STATUS.invalid, chapter);
        this.state = resolved;
        return { ok: true, state: resolved };
    }

    /**
     * 解锁格子。
     *
     * ## 🔴 回包的 `cellId` 是**数组**，可能一次解锁**整片区域**
     *
     * 实机日志（2026-10-10）：请求 `cellId: 327`，回包 `cellId: [327, 328]` —— 服务端按
     * 「相同 `configId` = 一片战斗区域」把同区域的一起解锁了。
     * 早期只读 `succ`、把 `cellId` 整个丢掉 ⇒ 界面上**只显示一格解锁**（同区域其余格仍是锁态），
     * 玩家会以为要一格格点。
     *
     * 所以这里把回包里的格子清单原样带出去，由调用方**逐格**记账。
     * 空数组（服务端没给）时退回请求的那一格 —— 保守但不会把本次解锁记丢。
     */
    async unlockCell(levelChapter: number, cellId: number, caller?: object): Promise<TerritoryWriteResult> {
        let unlocked: number[] = [];
        let rewards: ITerritoryGrantedReward[] = [];
        const result = await this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryUnlockCell(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller,
                (rsp) => {
                    unlocked = readCellIdArray(rsp);
                    const success = Number((rsp as { succ?: unknown })?.succ) === 1;
                    recordSuccess(success);
                    if (success) rewards = readTerritoryGrantedRewards(rsp?.tlCmdGoods);
                },
            ),
            '[TerritoryCell] 解锁格子失败',
        );
        if (!result.ok) return result;
        return { ok: true, unlockedCellIds: unlocked.length ? unlocked : [cellId], rewards };
    }

    /** 通关格子（占领）。 */
    async passCell(levelChapter: number, cellId: number, caller?: object): Promise<TerritoryWriteResult> {
        let rewards: ITerritoryGrantedReward[] = [];
        const result = await this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryPassCell(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller,
            (rsp) => {
                const success = Number((rsp as { succ?: unknown })?.succ) === 1;
                recordSuccess(success);
                if (success) rewards = readTerritoryGrantedRewards(rsp?.tlCmdGoods);
            },
            ),
            '[TerritoryCell] 通关格子失败',
        );
        return result.ok ? { ...result, rewards } : result;
    }

    /**
     * 章节关开战：请求战斗信息（`CmdStartBattleReqMsg`），battleType = 1002，
     * battleParams = [子类型, 章节id, cellid]（子类型 1 = 格子战斗，由调用方
     * `chapterCellBattleParams` 组好）。返回空（未连接/超时/失败）统一为 `failed`。
     */
    async startBattle(
        battleType: number,
        battleParams: readonly string[],
        caller?: object,
    ): Promise<TerritoryStartBattleResult> {
        const started = await requestStartBattle(battleType, battleParams, caller);
        if (!started) return { ok: false, reason: TERRITORY_REQUEST_STATUS.failed };
        return { ok: true, battle: started };
    }

    /** 章节扫荡。 */
    async sweep(levelChapter: number, cellId: number, caller?: object): Promise<TerritoryWriteResult> {
        return this.writeWithSucc(
            (recordSuccess) => new RequestTerritorySweep(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller,
                (rsp) => { recordSuccess(Number((rsp as { succ?: unknown })?.succ) === 1); },
            ),
            '[TerritoryCell] 章节扫荡失败',
        );
    }

    /**
     * 领挂机奖励。回包带 `idleTime`（上次挂机时间戳，秒）。
     * 领奖态由服务端 `rewardState` 权威给出，客户端不自行推断。
     */
    async claimIdleReward(levelChapter: number, caller?: object): Promise<TerritoryWriteResult> {
        return this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryIdleReward(
                { levelChapter: this.normalizeChapter(levelChapter) },
                caller,
                (rsp) => {
                    const time = Number((rsp as { idleTime?: unknown })?.idleTime);
                    this.lastIdleTime = Number.isFinite(time) && time > 0 ? time : 0;
                    // ⚠️ 这条 rsp **没有 succ 字段**（proto里只有 idleTime）⇒ 只要回包到达就算成功。
                    recordSuccess(true);
                },
            ),
            '[TerritoryCell] 领挂机奖励失败',
        );
    }

    /** 最近一次领奖回包里的挂机时间戳（秒）；没领过或没给有效值时为 0。 */
    get lastIdleTimeSeconds(): number {
        return this.lastIdleTime;
    }

    /** 清掉内存快照（切章节 / 登出）。 */
    clear(): void {
        this.state = null;
        this.lastIdleTime = 0;
    }

    // ============================================================
    // 内部
    // ============================================================

    private lastIdleTime = 0;

    /** 章节号归一：0 /负数 / NaN 一律当第 1 章，避免服务端收到 `levelChapter=0`。 */
    private normalizeChapter(levelChapter: number): number {
        const parsed = Math.floor(Number(levelChapter));
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    }

    /**
     * 发包 + 收口。返回 `'ok'` 表示包已成功发出，**不保证回包已到**。
     *
     * ⚠️ `withTimeout` 必加：`GameNet.send` 没有按请求的超时，服务端不回就永悬
     * ⇒ 界面卡在「加载中」再也不刷新（连线失败也一样）。
     */
    private async send(build: () => unknown, label: string): Promise<'ok' | TerritoryRequestTransportFailure> {
        const net = GameNet.instance;
        // ⚠️ 必须 early-return offline：连不上就发包会挂在 Promise 上，界面永远"加载中"。
        if (!net?.isConnected) return TERRITORY_REQUEST_STATUS.offline;
        try {
            const sent = await withTimeout(net.send(build() as never, false), READ_TIMEOUT_MS, () => false);
            return sent === true ? TERRITORY_REQUEST_STATUS.ok : TERRITORY_REQUEST_STATUS.failed;
        } catch (error) {
            console.warn(label, error);
            return TERRITORY_REQUEST_STATUS.failed;
        }
    }

    /** 写请求公共壳：离线早退 + 超时兜底 + `succ` 判定。 */
    private async writeWithSucc(
        build: (recordSuccess: (success: boolean) => void) => unknown,
        label: string,
    ): Promise<TerritoryWriteResult> {
        let isSuccess = false;
        const sent = await this.send(() => build((success) => { isSuccess = success; }), label);
        if (sent === TERRITORY_REQUEST_STATUS.offline) return { ok: false, reason: TERRITORY_REQUEST_STATUS.offline };
        if (sent === TERRITORY_REQUEST_STATUS.failed) return { ok: false, reason: TERRITORY_REQUEST_STATUS.failed };
        if (!isSuccess) return { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected };
        return { ok: true };
    }

    private failFetch(reason: TerritoryRequestTransportFailure, chapter: number): TerritoryCellFetchResult {
        return {
            ok: false,
            reason,
            state: this.state ?? emptyCellState(chapter),
        };
    }

    /**
     * 把 rsp（`unknown` 形状）收敛成 {@link ITerritoryCellState}。
     *
     * `unlockCells / passCells` 是 `repeated uint64`，解出来是 `Long` 对象（本工程真机）
     * 或 `number`（runtime 万一被换），由 `decodeCellBitSet` 统一处理。
     * 任一块解不出就返回 `null` —— **不返回半截格子集**，否则领地页会按"缺格子"渲染，
     * 等于凭空吃掉玩家已通关的领地。
     */
    private readState(
        rsp: unknown,
        chapter: number,
        maxCell: number | undefined,
        quiet: boolean = false,
    ): ITerritoryCellState | null {
        if (!rsp || typeof rsp !== 'object') return null;
        const record = rsp as {
            levelChapter?: unknown;
            rewardState?: unknown;
            unlockCells?: unknown;
            passCells?: unknown;
        };
        const unlock = decodeCellBitSet(record.unlockCells as readonly unknown[] | undefined, maxCell);
        const pass = decodeCellBitSet(record.passCells as readonly unknown[] | undefined, maxCell);
        if (!unlock.cells || !pass.cells) {
            console.warn(
                `[TerritoryCell] 第 ${chapter} 章格子 bitSet 解析失败：`,
                unlock.reason ?? pass.reason,
            );
            return null;
        }
        // ⚠️ 诊断日志：浏览器对长数组默认折叠，rsp 里的 unlockCells 常常看不全 ——
        // 「服务端到底给了哪些格子」必须在这里落成一行可读文本，否则只能靠猜。
        // 截断到前 64 个，避免 400 格章节刷屏。
        const brief = (cells: readonly number[]): string =>
            `${cells.length} 格 [${cells.slice(0, 64).join(',')}${cells.length > 64 ? ',…' : ''}]`;
        // quiet（主动下发的重复解析）不打印诊断日志，避免和 fetch 那次重复刷屏。
        if (!quiet) {
            console.log(
                `[TerritoryCell] 第 ${chapter} 章服务端格子：`
                + `unlock=${brief(unlock.cells)} pass=${brief(pass.cells)}`
                + ` 地图共 ${maxCell} 格`,
            );
        }
        return {
            levelChapter: chapter,
            rewardState: Number(record.rewardState) || 0,
            unlockCells: unlock.cells,
            passCells: pass.cells,
        };
    }
}

/** 便捷判定：这份快照里该章的章节奖励是否已领。 */
export function territoryRewardClaimed(state: ITerritoryCellState | null): boolean {
    return state ? isRewardClaimed(state) : false;
}

export type { ITerritoryCellState };
