import type { ZCBattleStart } from '../../battle/BattleStartModel';
import { startBattle as requestStartBattle } from '../../battle/BattleStartService';
import { GameNet } from '../../net/GameNet';
import type { RequestMsg } from '../../../framework/net/RequestMsg';
import {
    decodeCellBitSet,
    emptyCellState,
    ITerritoryCellState,
} from '../model/TerritoryCellBitSet';
import type { ITerritoryGrantedReward } from '../model/TerritoryGrantedReward';
import { readTerritoryGrantedRewards } from '../model/TerritoryGrantedReward';
import {
    readTerritoryMonsterBox,
    readTerritoryMonsterBoxes,
    withTerritoryMonsterBox,
    type ITerritoryMonsterBox,
} from '../model/TerritoryMonsterBox';
import { normalizeTerritoryChapter } from '../model/TerritoryProgress';
import { TERRITORY_REQUEST_STATUS, type TerritoryRequestFailure, type TerritoryRequestTransportFailure } from '../model/TerritoryRequestStatus';
import type { TerritorySendStatus } from './TerritoryModel';
import {
    RequestTerritoryCellInfo,
    RequestTerritoryIdleReward,
    RequestTerritoryPassCell,
    RequestTerritorySweep,
    RequestTerritoryUnlockCell,
    RequestTerritoryUpMonsterBoxLv,
} from './RequestTerritoryCellInfoMsg';

import { READ_TIMEOUT_MS_LONG as READ_TIMEOUT_MS } from '../../net/Timeouts';

/** 组包 + 入队（本帧同步开销）超过这个毫秒数就留痕：单帧 16.7ms，预留一半给渲染。 */
const TERRITORY_SEND_WARN_MS = 8;
/**
 * 占城（领地）· 服务端数据端口。
 *
 * 只做「与服务端说话 + 把回包搬成快照」，**不碰本地存档**——
 * 落地要交给 `TerritoryProgress`（它有"起点必占领""探索中的格不可重复占领"等规则）。
 * 合并策略见 `TerritoryPage.mergeServerState`。
 *
 * 走主动请求而不是 `CacheMgr`
 *
 * 这几条**格子状态表**服务端不按 key 推（`protoCache.json` 里没有），
 * `CacheMgr` 那套「按 key 查已推送缓存」用不上 ⇒ 必须主动 req。
 * 误用 `CacheMgr.getTl…()` 会拿到**恒空数组**，症状是"格子状态永远是空的、零报错" ——
 * 这正是 `ProcedureMatching` 踩过的坑（推送表没人写却当数据源用）。
 *
 * 例外是 **`CmdCityChapterPassCellBroMsg`（通关格子广播）**—— 它是**真的服务端主动推**，
 * 由 `MainTerritoryMap` 通过 `GameNet.addEvent` 订阅，不走 req、也不进 `CacheMgr`。
 * 所以「服务端一条都不推」只对 **req 侧那张表**成立，别拿它当「没有推送」的证据。
 *
 * 写请求一律**不乐观更新**
 *
 * 解锁 / 通关 / 扫荡 / 领奖都等服务端 `succ`，成功才由调用方改本地状态。
 * 乐观更新（先改本地、失败再回滚）在这种场景特别糟：
 * ① 回滚容易漏（多处读同一个快照）；② 断线时"看起来成功了"的假象会误导玩家；
 * ③ 本地存档是**唯一**副本（`TerritorySaveStore` 走 localStorage），弄脏了没法恢复。
 *
 * **Bro 是唯一例外**：它是服务端权威事实的主动通知（别人打通了格子），
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

/**
 * 升级怪物宝箱结果。
 *
 * 与 {@link TerritoryWriteResult} 分开：回包除了 `succ` 还带**那一格的新等级**
 * （`monsterBoxInfo`），且升级本身不发奖（奖励在打掉宝箱时结算），没有 `tlCmdGoods`。
 *
 * `monsterBox === null` 的语义是「**升级成功但等级未知**」（`succ = 1` 而回包条目缺失/脏），
 * 不是失败 —— 见 {@link TerritoryCellRepository.upMonsterBoxLv}。
 */
export type TerritoryMonsterBoxUpgradeResult =
    | { readonly ok: true; readonly monsterBox: ITerritoryMonsterBox | null }
    | { readonly ok: false; readonly reason: TerritoryRequestFailure };

/**
 * 领挂机奖励结果。
 *
 * 回包 **没有 `succ`**（`CmdCityChapterIdleRewardRspMsg` 只有 `idleTime` + `tlCmdGoods`）
 * ⇒ 不能用 `writeWithSucc` 那套判定：**回包到达即成功**，`tlCmdGoods` 为空只是「这次没产出」。
 * 判失败只认「包没发出去 / 超时 / 回包没到」。
 */
export type TerritoryIdleRewardResult =
    | {
        readonly ok: true;
        /** 服务端实际发放的物品（可能为空数组）。**必须原样展示**，不要拿本地配置重算。 */
        readonly rewards: readonly ITerritoryGrantedReward[];
        /** 回包里的 `idleTime`（秒）＝新的挂机起点；0 = 服务端没给有效值。 */
        readonly idleTimeSeconds: number;
    }
    | { readonly ok: false; readonly reason: TerritoryRequestFailure };


/** 读超时：与服务端断连时不能让领地页一直转圈。 */

/**
 * 从 rsp 里读 `repeated uint32 cellId` 数组。
 *
 * 正常是**普通 `number[]`**（`uint32` 不是 `uint64`，protobufjs 不会给 `Long`），
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

/**
 * `idleTime` 是 `uint32` **秒**（不是 `Long`），非法值一律归 0。
 *
 * 不要用 `Number.isFinite` 就放行：0 / 负数当「服务端没给有效起点」处理，
 * 否则会把 1970 年当起点，UI 直接顶到 8h 上限。
 */
function readSeconds(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export class TerritoryCellRepository {
    /**
     * @param caller 请求宿主（页面 Entry）：构造时注入，作为各方法 `caller` 的默认值。
     *
     * 有了它，仓储本身就满足 `ITerritoryCellGateway`，装配处不必再写一层
     * 「`(chapterId, cellId) => cells.unlockCell(chapterId, cellId, this)`」的转发 lambda；
     * 需要换宿主的调用（测试、跨页面）仍可显式传第三参覆盖。
     */
    constructor(private readonly caller: object | null = null) {}

    private state: ITerritoryCellState | null = null;

    /**
     * 写请求**没拿到成功回包**的通知口（服务端拒绝 / 超时 / 取消），由装配层接到 Model。
     *
     * 服务端拒绝时下发的是 `CmdTips`，不是对应的 `Rsp`：`ConnectedNetState` 只把那条
     * `NetworkRequest` 置为 rejected（`onReject('server_error')`），**不派发 Rsp 事件** ⇒
     * 事件通道上的业务一句都收不到，只能等各自 5 秒的硬超时。实测日志：`CmdTips` 20ms
     * 就到，全屏 loading 转到 5.7s 才由 `fastTick` 收尾。
     *
     * `NetworkRequest` 会把 `reqMsg.fErrorCallback` 留到 `onReject` 时调用（按 clientIndex
     * 精确对应那一条请求），所以这里接出来就能把等待压到同一个 tick。
     */
    onWriteError: ((requestName: string, reason: string) => void) | null = null;

    /** 只排除请求回调实际收到的响应对象；在途请求不能吞掉其它章节或主动推送。 */
    private readonly fetchedResponses = new WeakSet<object>();

    /** 解析页面收到的完整快照；请求响应由 fetchChapterCells 自己处理。 */
    readCellInfo(msg: unknown, maxCell?: number): ITerritoryCellState | null {
        if (msg && typeof msg === 'object' && this.fetchedResponses.has(msg)) {
            this.fetchedResponses.delete(msg);
            return null;
        }
        const record = msg as { levelChapter?: unknown } | null;
        const chapter = normalizeTerritoryChapter(Number(record?.levelChapter));
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
        return { levelChapter: normalizeTerritoryChapter(Number(record.levelChapter)), cellIds };
    }

    /**
     * 拉一章的格子状态。
     *
     * @param levelChapter 章节号（= 领地侧 `chapterId`）
     * @param maxCell 该章格子总数（`rows × columns`）。服务端若已扩容章节而客户端拿的是旧地图，
     * 超出的格子会被裁掉 —— 否则领地页会算出越界坐标。
     * @param caller 生命周期宿主（关界面时用来断回调）
     */
    async fetchChapterCells(
        levelChapter: number,
        maxCell: number,
        caller: object | null = this.caller,
    ): Promise<TerritoryCellFetchResult> {
        const chapter = normalizeTerritoryChapter(levelChapter);
        let resolved: ITerritoryCellState | null = null;
        const sent = await this.send(
            () => new RequestTerritoryCellInfo({ levelChapter: chapter }, caller, (rsp) => {
                if (rsp && typeof rsp === 'object') this.fetchedResponses.add(rsp);
                resolved = this.readState(rsp, chapter, maxCell);
            }),
            '[TerritoryCell] 拉取章节格子信息失败',
        );
        if (sent !== TERRITORY_REQUEST_STATUS.ok) return this.failFetch(sent, chapter);
        // `ok` 只代表**包发出去了且没抛**，回调可能还没跑（超时兜底会先返回）。
        // 这里必须判null ⇒ invalid，而不是拿 `emptyCellState` 当正常结果 ——
        // 否则"回包没到"会表现成"服务端说这章一个格子都没有"。
        if (!resolved) return this.failFetch(TERRITORY_REQUEST_STATUS.invalid, chapter);
        this.state = resolved;
        return { ok: true, state: resolved };
    }

    // ============================================================
    // 写请求：只发不等（回包走 GameNet 事件通道）
    // ============================================================

    /** 解锁格子（`CmdCityChapterUnlockCellReqMsg`）。 */
    sendUnlockCell(levelChapter: number, cellId: number, caller: object | null = this.caller): TerritorySendStatus {
        return this.dispatch(() => new RequestTerritoryUnlockCell(
            { levelChapter: normalizeTerritoryChapter(levelChapter), cellId }, caller,
        ), '解锁格子');
    }

    /** 通关格子（= 占领）。 */
    sendPassCell(levelChapter: number, cellId: number, caller: object | null = this.caller): TerritorySendStatus {
        return this.dispatch(() => new RequestTerritoryPassCell(
            { levelChapter: normalizeTerritoryChapter(levelChapter), cellId }, caller,
        ), '通关格子');
    }

    /** 章节扫荡；`times` 非法值（0 / 负数 / 小数 / NaN）一律归 1。 */
    sendSweep(levelChapter: number, cellId: number, times: number = 1,
        caller: object | null = this.caller): TerritorySendStatus {
        const sweepTimes = Number.isSafeInteger(times) && times > 0 ? times : 1;
        return this.dispatch(() => new RequestTerritorySweep(
            { levelChapter: normalizeTerritoryChapter(levelChapter), cellId, times: sweepTimes }, caller,
        ), '章节扫荡');
    }

    /** 领挂机奖励（空请求体）。 */
    sendIdleReward(caller: object | null = this.caller): TerritorySendStatus {
        return this.dispatch(() => new RequestTerritoryIdleReward({}, caller), '领挂机奖励');
    }

    /** 升级怪物宝箱（消耗由服务端按当前等级扣）。 */
    sendUpMonsterBoxLv(levelChapter: number, cellId: number,
        caller: object | null = this.caller): TerritorySendStatus {
        return this.dispatch(() => new RequestTerritoryUpMonsterBoxLv(
            { levelChapter: normalizeTerritoryChapter(levelChapter), cellId }, caller,
        ), '升级怪物宝箱');
    }

    /**
     * 章节关开战：请求战斗信息（`CmdStartBattleReqMsg`），battleType = 1002，
     * battleParams = [子类型, 章节id, cellid]（子类型 1 = 格子战斗，由调用方
     * `chapterCellBattleParams` 组好）。返回空（未连接/超时/失败）统一为 `failed`。
     *
     * 这条仍保留 Promise：`BattleStartService` 是匹配页 / 大地图共用的开战入口，
     * 回包的归一化与并发合并都在那边，领地不另建一份解析。
     */
    async startBattle(
        battleType: number,
        battleParams: readonly string[],
        caller: object | null = this.caller,
    ): Promise<TerritoryStartBattleResult> {
        const started = await requestStartBattle(battleType, battleParams, caller);
        if (!started) return { ok: false, reason: TERRITORY_REQUEST_STATUS.failed };
        return { ok: true, battle: started };
    }

    // ============================================================
    // 写回包解码（Controller 收到 Rsp 后调用，再回灌 Model）
    // ============================================================

    /** 解锁回包：`succ` + 整片区域的 `cellId` 数组 + `tlCmdGoods`。 */
    readUnlockRsp(msg: unknown): TerritoryWriteResult {
        const record = msg as { succ?: unknown; tlCmdGoods?: unknown } | null;
        if (Number(record?.succ) !== 1) return { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected };
        return { ok: true, unlockedCellIds: readCellIdArray(msg), rewards: readTerritoryGrantedRewards(record?.tlCmdGoods) };
    }

    /** 通关回包：`succ` + `tlCmdGoods`。 */
    readPassRsp(msg: unknown): TerritoryWriteResult {
        const record = msg as { succ?: unknown; tlCmdGoods?: unknown } | null;
        if (Number(record?.succ) !== 1) return { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected };
        return { ok: true, rewards: readTerritoryGrantedRewards(record?.tlCmdGoods) };
    }

    /** 扫荡回包：`succ` + 实际发放的 `tlCmdGoods`。 */
    readSweepRsp(msg: unknown): TerritoryWriteResult {
        const record = msg as { succ?: unknown; tlCmdGoods?: unknown } | null;
        if (Number(record?.succ) !== 1) return { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected };
        return { ok: true, rewards: readTerritoryGrantedRewards(record?.tlCmdGoods) };
    }

    /**
     * 领挂机奖励回包：**到达即成功**（这条 rsp 没有 `succ`）。
     * `tlCmdGoods` 为空只是「这一段时间没产出」，不是失败。
     */
    readIdleRewardRsp(msg: unknown): TerritoryIdleRewardResult {
        const record = msg as { idleTime?: unknown; tlCmdGoods?: unknown } | null;
        const idleTimeSeconds = readSeconds(record?.idleTime);
        this.lastIdleTime = idleTimeSeconds;
        return { ok: true, rewards: readTerritoryGrantedRewards(record?.tlCmdGoods), idleTimeSeconds };
    }

    /** 升级怪物宝箱回包：`succ` + `monsterBoxInfo`（等级真源，不本地 +1）。 */
    readMonsterBoxRsp(msg: unknown): TerritoryMonsterBoxUpgradeResult {
        const record = msg as { succ?: unknown; monsterBoxInfo?: unknown } | null;
        if (Number(record?.succ) !== 1) return { ok: false, reason: TERRITORY_REQUEST_STATUS.rejected };
        const box = readTerritoryMonsterBox(record?.monsterBoxInfo);
        // 成功且等级已知 ⇒ 同步本仓储快照，供拉取失败时的兜底沿用（不本地 +1）。
        if (box && this.state) {
            this.state = { ...this.state, monsterBoxes: withTerritoryMonsterBox(this.state.monsterBoxes, box) };
        }
        return { ok: true, monsterBox: box };
    }

    /** 最近一次领奖回包里的挂机时间戳，秒。 */
    get lastIdleTimeSeconds(): number {
        return this.lastIdleTime;
    }

    /** 清掉内存快照（切章节 / 登出）。 */
    clear(): void {
        this.state = null;
        this.lastIdleTime = 0;
    }

    private lastIdleTime = 0;

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 发包与传输结果收口；业务响应仍由请求回调处理。
     *

     */
    private async send(build: () => unknown, label: string): Promise<'ok' | TerritoryRequestTransportFailure> {
        return GameNet.sendRequest(build, { timeoutMs: READ_TIMEOUT_MS, tag: label });
    }

    /**
     * 写请求「只发不等」：离线当场返回 `offline`（不会再有回包），发送异常返回 `failed`。
     * 回包走 `GameNet.addEvent('CmdCityChapterXxxRspMsg')` 的事件通道，由 Controller 解码后回灌 Model。
     *
     * `build` 的类型是 `RequestMsg` 而不是 `unknown`：组包与入队都是**本帧同步开销**
     * （protobuf 编码 + 入队），留痕要能报出协议名 —— 匿名 `() => unknown` 既拿不到名字，
     * 也没法和网络层的 `ModelCollectTimeConsumingLog` / 抓包记录对号。
     */
    private dispatch(build: () => RequestMsg<unknown, unknown>, label: string): TerritorySendStatus {
        if (!GameNet.instance.isConnected) return 'offline';
        let request: RequestMsg<unknown, unknown>;
        const buildStartedAt = Date.now();
        try {
            request = build();
        } catch (error) {
            console.warn(`[TerritoryCell] ${label}：组包失败`, error);
            return 'failed';
        }
        const builtAt = Date.now();
        // 协议名先取出来：回调里别再持有消息实例（等回包期间没必要把它一起留住）。
        const messageName = request.getReqMsgProtoName();
        // 服务端拒绝 / 超时 / 取消都从这里回灌：`send` 的返回值只有 boolean，分不出原因。
        // 必须在 `send` **之前**挂 —— `NetworkRequest.packageRequest` 会把它取走并清空。
        request.fErrorCallback = (reason: string): void => {
            console.warn(`[TerritoryCell] ${messageName} 未确认（${reason}），回灌业务按失败收尾`);
            this.onWriteError?.(messageName, reason);
        };
        try {
            // `send` 里的编码 + 入队是同步的：这一段就是本帧的真实成本。
            const pending = GameNet.instance.send(request, false);
            const enqueuedAt = Date.now();
            // 组包 + 入队都是本帧同步开销：超阈值才留痕（单帧 16.7ms，预留一半给渲染）。
            if (enqueuedAt - buildStartedAt >= TERRITORY_SEND_WARN_MS) {
                console.warn(`[TerritoryCell] ${messageName} 发送偏慢：`
                    + `组包 ${builtAt - buildStartedAt}ms / 入队 ${enqueuedAt - builtAt}ms`);
            }
            // 编码失败 / 发送异常才会走 reject（失败回灌已由上面的 `fErrorCallback` 接走），
            // 这里只负责别让它变成 unhandled rejection。
            void pending.catch((error: unknown) => {
                console.warn(`[TerritoryCell] ${messageName} 发送异常`, error);
            });
            return 'ok';
        } catch (error) {
            console.warn(`[TerritoryCell] ${label}：请求未发出`, error);
            return 'failed';
        }
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
            monsterBoxInfos?: unknown;
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
        // 诊断日志：浏览器对长数组默认折叠，rsp 里的 unlockCells 常常看不全 ——
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
            // 附属信息 ⇒ **逐条丢弃脏数据**，不像 bitSet 那样整包作废（见 `TerritoryMonsterBox` 文件头）。
            monsterBoxes: readTerritoryMonsterBoxes(record.monsterBoxInfos, maxCell),
        };
    }
}

export type { ITerritoryCellState };

