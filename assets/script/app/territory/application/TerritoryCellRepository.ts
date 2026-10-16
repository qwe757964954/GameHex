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
 * 走 `GameNet.addEvent` 订阅（见 `listenPassCellsBro`），不走 req、也不进 `CacheMgr`。
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
    | { readonly ok: false; readonly reason: 'offline' | 'failed' | 'invalid'; readonly state: ITerritoryCellState };

/** 写操作结果：`rejected` 表示服务端明确回了 `succ = 0`（业务拒绝，不是网络问题）。 */
export type TerritoryWriteResult =
    | { readonly ok: true; readonly unlockedCellIds?: readonly number[]; readonly rewards?: readonly ITerritoryGrantedReward[] }
    | { readonly ok: false; readonly reason: 'offline' | 'failed' | 'rejected' | 'invalid' };

/** Boss 关开战（`CmdStartBattleReqMsg`）结果；`rejected` = 服务端拒绝（业务原因）。 */
export type TerritoryStartBattleResult =
    | { readonly ok: true; readonly battle: ZCBattleStart }
    | { readonly ok: false; readonly reason: 'offline' | 'failed' | 'rejected' | 'invalid' };

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

    // ============================================================
    // 服务端主动推送：通关格子广播
    // ============================================================

    /** Bro 订阅句柄（`GameNet.removeCallerEvent` 的凭据），没订阅过为 `null`。 */
    private broListener: object | null = null;

    /** Bro 落地回调：由 `TerritoryPresenter` 注入（它才有 `TerritoryProgress` 与刷新能力）。 */
    private onPassCellsBro: ((levelChapter: number, cellIds: readonly number[]) => void) | null = null;

    /**
     * 订阅「通关格子」广播（`CmdCityChapterPassCellBroMsg`）。
     *
     * ## 为什么必须显式订阅
     *
     * `RequestMsg` 那套只管**自己发起的 req→rsp**；服务端主动推的消息只能靠
     * `GameNet.addEvent(消息名, …)` 接（`ChatRepository` 的 `CmdChatBroMsg` 同款）。
     * **不订阅的症状是零报错的静默失效** —— 联机时看不到别人的通关，界面一切正常。
     *
     * ## ⚠️ `cellId` 是**数组**（`repeated uint32`），不是单值
     *
     * 一次广播可能带多个格子（`[327]` / `[12, 27, 33]`），所以转发的是 `readonly number[]`。
     * protobufjs 把它解成普通 `number[]`（`uint32` 不是 `uint64`，**没有 `Long` 转换问题**，
     * 与 `decodeCellBitSet` 处理的 `repeated uint64` 不同 —— 别在这儿套那个函数）。
     *
     * ## 重复订阅幂等
     *
     * 领地页可能反复 `open`；已订阅时只换回调、不重复挂监听 ——
     * 否则同一个包会被处理多次，表现为「一次广播新增了 N 个格子」。
     */
    listenPassCellsBro(onPassCells: (levelChapter: number, cellIds: readonly number[]) => void): void {
        this.onPassCellsBro = onPassCells;
        if (this.broListener) return;
        this.broListener = {};
        GameNet.instance.addEvent(
            'CmdCityChapterPassCellBroMsg',
            this.broListener as never,
            (msg: unknown) => this.onBroMessage(msg),
        );
    }

    /** 退订并清掉回调（关界面 / 登出）。 */
    unlistenPassCellsBro(): void {
        this.onPassCellsBro = null;
        if (!this.broListener) return;
        GameNet.instance.removeCallerEvent(this.broListener as never);
        this.broListener = null;
    }

    // ============================================================
    // 服务端主动推送：章节格子状态（战斗结束 / 通关后不经请求下发）
    // ============================================================

    /** CellInfo 订阅句柄，没订阅过为 `null`。 */
    private cellInfoListener: object | null = null;

    /** CellInfo 落地回调：由 `TerritoryPresenter` 注入。 */
    private onCellInfo: ((state: ITerritoryCellState) => void) | null = null;

    /** 裁剪上界（`rows × columns`），注册时由 Presenter 传入。 */
    private cellInfoMaxCell = 0;

    /**
     * 章节格子拉取是否正在进行。用来在事件回调里**排除 fetchChapterCells 自己的响应**：
     * 每条响应都会经 `msgEventProxy` 广播，fetch 那次已在 RequestMsg 回调里 readState 处理，
     * 不该再当"主动推"落地；主动下发时没有在途 fetch，才处理。
     */
    private fetchInProgress = false;

    /**
     * 订阅服务端**主动下发**的章节格子状态（`CmdCityChapterCellInfoRspMsg`）。
     *
     * ## 为什么要单独订阅
     *
     * 战斗结束、关卡通关后，后端会不经请求下发一条 `CmdCityChapterCellInfoRspMsg`
     * （用户明确：前端不需要再发 `CmdCityChapterPassCellReqMsg`，那只会被回
     * 「章节格子非资源类型」）。这条消息不是 Bro（名字不以 `BroMsg` 结尾），
     * 走 `GameNet.addEvent` 接，且需在收到时让 Presenter 刷新。
     *
     * ⚠️ 框架在收到"无匹配请求的非 Bro 响应"时会打一条 `返回协议没有找到发送的msgResult`
     * 日志，那是误报（这确实是主动推），但消息仍会通过 `msgEventProxy` 广播到这里。
     *
     * @param maxCell 本章格子总数（`rows × columns`），用于裁剪上界
     * @param onState 收到完整快照时的回调
     */
    listenCellInfo(maxCell: number, onState: (state: ITerritoryCellState) => void): void {
        this.onCellInfo = onState;
        this.cellInfoMaxCell = maxCell;
        if (this.cellInfoListener) return;
        this.cellInfoListener = {};
        GameNet.instance.addEvent(
            'CmdCityChapterCellInfoRspMsg',
            this.cellInfoListener as never,
            (msg: unknown) => this.onCellInfoMessage(msg),
        );
    }

    /** 退订并清掉回调（关界面 / 登出）。 */
    unlistenCellInfo(): void {
        this.onCellInfo = null;
        if (!this.cellInfoListener) return;
        GameNet.instance.removeCallerEvent(this.cellInfoListener as never);
        this.cellInfoListener = null;
    }

    /** 把主动下发的 CellInfo 收敛成快照再回调；fetch 自己的响应（在途 fetch）忽略。 */
    private onCellInfoMessage(msg: unknown): void {
        if (this.fetchInProgress) return;
        const record = msg as { levelChapter?: unknown } | null;
        const chapter = this.normalizeChapter(Number(record?.levelChapter));
        // quiet 解析：主动下发不重复打印诊断日志。
        const state = this.readState(msg, chapter, this.cellInfoMaxCell, true);
        if (state) {
            this.state = state;
            this.onCellInfo?.(state);
        }
    }

    /**
     * 把 Bro 报文收敛成 `(levelChapter, cellIds)` 再交给回调。
     *
     * ⚠️ **章节号必须归一到与 req 同一口径**（`normalizeChapter`）：Bro 里的 `levelChapter=0`
     * 若不归一会与「正在看的 chapterId」比不上，格子就白收了（症状：格子没变但也没报错）。
     *
     * ⚠️ `cellId` 只做「**非负整数**」过滤，不做上界裁剪：上界要靠地图 `rows × columns`，
     * 而 Repository 这层没有地图（`applyServerState` 里已有 `validCell` 会按 `total` 裁）。
     * 这里重复裁一遍反而会与「服务端已扩容、客户端地图是旧的」打架。
     */
    private onBroMessage(msg: unknown): void {
        const record = msg as { levelChapter?: unknown; cellId?: unknown } | null;
        if (!record || typeof record !== 'object') return;
        const raw = record.cellId;
        const cellIds = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw])
            .map(Number)
            .filter((cell) => Number.isInteger(cell) && cell >= 0);
        // 空数组 = 服务端只广播了章节号、没有格子 ⇒ 无事可做，别去惊动界面。
        if (cellIds.length === 0) return;
        this.onPassCellsBro?.(this.normalizeChapter(Number(record.levelChapter)), cellIds);
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
        caller?: unknown,
    ): Promise<TerritoryCellFetchResult> {
        const chapter = this.normalizeChapter(levelChapter);
        // 标记在途 fetch：响应到达时（同一次收包同步广播）onCellInfoMessage 据此忽略，
        // 不把自己的响应当主动推重复落地。
        this.fetchInProgress = true;
        try {
            let resolved: ITerritoryCellState | null = null;
            const sent = await this.send(
                () => new RequestTerritoryCellInfo({ levelChapter: chapter }, caller as never, (rsp) => {
                    resolved = this.readState(rsp, chapter, maxCell);
                }),
                '[TerritoryCell] 拉取章节格子信息失败',
            );
            if (sent !== 'ok') return this.failFetch(sent, chapter);
            // ⚠️ `ok` 只代表**包发出去了且没抛**，回调可能还没跑（超时兜底会先返回）。
            // 这里必须判null ⇒ invalid，而不是拿 `emptyCellState` 当正常结果 ——
            // 否则"回包没到"会表现成"服务端说这章一个格子都没有"。
            if (!resolved) return this.failFetch('invalid', chapter);
            this.state = resolved;
            return { ok: true, state: resolved };
        } finally {
            this.fetchInProgress = false;
        }
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
    async unlockCell(levelChapter: number, cellId: number, caller?: unknown): Promise<TerritoryWriteResult> {
        let unlocked: number[] = [];
        let rewards: ITerritoryGrantedReward[] = [];
        const result = await this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryUnlockCell(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller as never,
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
    async passCell(levelChapter: number, cellId: number, caller?: unknown): Promise<TerritoryWriteResult> {
        let rewards: ITerritoryGrantedReward[] = [];
        const result = await this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryPassCell(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller as never,
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
        caller?: unknown,
    ): Promise<TerritoryStartBattleResult> {
        const started = await requestStartBattle(battleType, battleParams, caller);
        if (!started) return { ok: false, reason: 'failed' };
        return { ok: true, battle: started };
    }

    /** 章节扫荡。 */
    async sweep(levelChapter: number, cellId: number, caller?: unknown): Promise<TerritoryWriteResult> {
        return this.writeWithSucc(
            (recordSuccess) => new RequestTerritorySweep(
                { levelChapter: this.normalizeChapter(levelChapter), cellId },
                caller as never,
                (rsp) => { recordSuccess(Number((rsp as { succ?: unknown })?.succ) === 1); },
            ),
            '[TerritoryCell] 章节扫荡失败',
        );
    }

    /**
     * 领挂机奖励。回包带 `idleTime`（上次挂机时间戳，秒）。
     * 领奖态由服务端 `rewardState` 权威给出，客户端不自行推断。
     */
    async claimIdleReward(levelChapter: number, caller?: unknown): Promise<TerritoryWriteResult> {
        return this.writeWithSucc(
            (recordSuccess) => new RequestTerritoryIdleReward(
                { levelChapter: this.normalizeChapter(levelChapter) },
                caller as never,
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
    private async send(build: () => unknown, label: string): Promise<'ok' | 'offline' | 'failed'> {
        const net = GameNet.instance;
        // ⚠️ 必须 early-return offline：连不上就发包会挂在 Promise 上，界面永远"加载中"。
        if (!net?.isConnected) return 'offline';
        try {
            const sent = await withTimeout(net.send(build() as never, false), READ_TIMEOUT_MS, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn(label, error);
            return 'failed';
        }
    }

    /** 写请求公共壳：离线早退 + 超时兜底 + `succ` 判定。 */
    private async writeWithSucc(
        build: (recordSuccess: (success: boolean) => void) => unknown,
        label: string,
    ): Promise<TerritoryWriteResult> {
        let isSuccess = false;
        const sent = await this.send(() => build((success) => { isSuccess = success; }), label);
        if (sent === 'offline') return { ok: false, reason: 'offline' };
        if (sent === 'failed') return { ok: false, reason: 'failed' };
        if (!isSuccess) return { ok: false, reason: 'rejected' };
        return { ok: true };
    }

    private failFetch(reason: 'offline' | 'failed' | 'invalid', chapter: number): TerritoryCellFetchResult {
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
        maxCell: number,
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
