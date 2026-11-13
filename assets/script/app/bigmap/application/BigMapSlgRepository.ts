import { toCount, withTimeout } from '../../net/RequestGuard';
import {
    bigMapServerInstanceId, bigMapServerRecord, bigMapServerUint, normalizeBigMapBuild,
    normalizeBigMapBuildInfo, normalizeBigMapBuildQueue, normalizeBigMapGameInfo, projectBigMapServerBase,
    type IBigMapServerBuild, type IBigMapServerBuildInfo, type IBigMapServerGameInfo,
} from '../model/BigMapServerState';
import type { IBigMapBaseState, IBigMapConfig } from '../model/BigMapTypes';

export type IBigMapSlgRequestName = 'CmdSlgActionUpdateReqMsg' | 'CmdSlgGameInfoReqMsg' | 'CmdSlgBuildInfoReqMsg'
    | 'CmdSlgBuildReqMsg' | 'CmdSlgBuildUpgradeReqMsg' | 'CmdSlgBuildCancelReqMsg' | 'CmdSlgBuildMoveReqMsg'
    | 'CmdSlgBuildCollectReqMsg' | 'CmdSlgBuildUnlockQueueReqMsg';

/** 请求体只承载标量与实例 ID 列表，批量协议（领取产出）用数组。 */
export type IBigMapSlgRequestBody = Readonly<Record<string, number | readonly number[]>>;

export interface IBigMapSlgGateway {
    dispose?(): void;
    request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<unknown>;
}

export interface IBigMapSlgReward { readonly resId: number; readonly amount: number }
export interface IBigMapSlgResult {
    readonly ok: boolean;
    readonly message: string;
    readonly rewards?: readonly IBigMapSlgReward[];
}

const SLG_TEXT = {
    failed: '服务器未确认操作，请刷新后重试', loading: '正在同步基地信息', busy: '操作处理中，请稍候',
    /**
     *首帧同步确实失败过（不是还在路上）时的文案。
     *
     *只用 `loading` 的话，玩家看到的是「正在同步基地信息」，等十秒也没变化，
     *既不知道是不是卡死、也不知道该不该重试 —— 2026-11-11 用户反馈的正是这个。
     */
    syncFailed: '基地信息同步失败，请检查网络后重试',
    disposed: '页面已关闭', invalid: '操作参数无效', built: '已提交建造', upgraded: '已提交升级',
    cancelled: '已取消建造或升级', moved: '建筑已移动', collected: '已领取产出', unlocked: '建造队列已解锁',
} as const;

/** 页级服务端状态。超时不重试写请求，不本地结算资源或完成队列。 */
export class BigMapSlgRepository {
    private info: IBigMapServerBuildInfo | null = null;
    private game: IBigMapServerGameInfo | null = null;
    private base: IBigMapBaseState | null = null;
    private readonly listeners = new Set<() => void>();
    private buildTask: Promise<boolean> | null = null;
    private actionTask: Promise<boolean> | null = null;
    private gameTask: Promise<boolean> | null = null;
    private refreshAgain = false;
    private refreshAfterWrite = false;
    private revision = 0;
    private isWriting = false;
    private isDisposed = false;
    private isBuildDirty = false;
    private actionRecoverAt: number | null = null;
    private nextPollAt = 0;
    /** 首帧同步是否确实失败过（区别于「还在路上」），决定 `write` 该说哪句话。 */
    private hasSyncFailed = false;
    /** 回包被丢弃的诊断只打一次，避免 500ms 轮询刷屏。 */
    private snapshotReported = false;
    /** 首次拿到可用快照时打一条摘要（之后不再打）。 */
    private firstSnapshotLogged = false;
    /** `实例 id → 已同步过的 finishAt`：倒计时到点只拉一次，避免对着同一完成时间反复请求。 */
    private readonly syncedFinishAt = new Map<number, number>();

    constructor(private readonly gateway: IBigMapSlgGateway, private readonly config: IBigMapConfig,
        private readonly now: () => number, private readonly timeoutMs = 5000) {}

    invalidate(kind: 'game' | 'build'): void {
        if (this.isDisposed) return;
        this.revision += 1;
        if (this.isWriting) this.refreshAfterWrite = true;
        else void this.refreshBuildInfo(true);
        if (kind === 'game') {
            //广播还带游戏信息（所处城池会变），不能只刷行动力。
            void this.refreshGame(true);
            void this.refreshAction();
        }
    }

    get ready(): boolean { return this.info !== null && !this.isBuildDirty; }
    get actionRemainingSeconds(): number | null {
        return this.actionRecoverAt === null ? null : Math.max(0, Math.ceil(this.actionRecoverAt - this.now()));
    }
    /**
     *我所处的城池 id（协议 `SlgGameInfo.toCampId`，0 = 未归属）。
     *
     *收到 game 包之前是 0 —— 调用方必须把 0 当「未知」而不是「没有城」，
     *「在不在势力范围内」的判定为此保留距离回退（见 `bigMapWithinCityRange`）。
     */
    get campId(): number { return this.game?.campId ?? 0; }
    /** 已击杀的最高野怪等级（协议 `SlgGameInfo.maxMonsterLevel`）。 */
    get maxClearedMonsterLevel(): number { return this.game?.maxMonsterLevel ?? 0; }
    projectBase(): IBigMapBaseState | null { return this.base; }
    serverInstanceId(id: number): number | null { return this.hasInstance(id) ? id : null; }
    queueInstanceId(slotIndex: number): number | null {
        return this.info?.queues.find((queue) => queue.queueId === slotIndex + 1)?.instanceId ?? null;
    }
    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    async initialize(): Promise<boolean> {
        const [game, builds, action] = await Promise.all([
            this.refreshGame(), this.refreshBuildInfo(), this.refreshAction(),
        ]);
        const ok = !this.isDisposed && game && builds && action;
        //记住「确实失败过」：`write` 据此把「正在同步」换成「同步失败，请检查网络后重试」。
        this.hasSyncFailed = !ok;
        return ok;
    }

    /**
     *拉游戏信息（所处城池 / 最高野怪等级）。
     *
     *解析失败不清空已有值：坏回包只会让这次刷新返回 false，
     *否则一次超时就能把「我在哪座城」从界面上抹掉。
     */
    refreshGame(force = false): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        if (this.gameTask) return force ? this.gameTask.then(() => this.refreshGame()) : this.gameTask;
        this.gameTask = this.loadGame().finally(() => { this.gameTask = null; });
        return this.gameTask;
    }

    private async loadGame(): Promise<boolean> {
        const response = bigMapServerRecord(await this.request('CmdSlgGameInfoReqMsg', {}));
        if (this.isDisposed) return false;
        const info = normalizeBigMapGameInfo(response?.info);
        if (!info) return false;
        this.game = info;
        this.emit();
        return true;
    }

    refreshBuildInfo(invalidated = false): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        if (this.buildTask) {
            if (invalidated) this.refreshAgain = true;
            return this.buildTask;
        }
        this.buildTask = this.loadBuildInfo().finally(() => { this.buildTask = null; });
        return this.buildTask;
    }

    /**
     *快照合法但投影不成「可展示基地」—— 多半是表对不上，不是网络问题。
     *
     *`apply` 里两道关：合并校验（`normalizeBigMapBuildInfo`）与投影（`projectBigMapServerBase`），
     *任何一座建筑的 buildingId / level / position 对不上本端配置，整份快照都进不来。
     */
    private reportProjectRejected(info: IBigMapServerBuildInfo): void {
        if (this.snapshotReported) return;
        this.snapshotReported = true;
        const maxQueue = this.config.queue.maxBuildQueue;
        const cellCount = this.config.queue.plotRows * this.config.queue.plotCols;
        const problems: string[] = [];
        if (info.unlockQueue > maxQueue) problems.push(`unlockQueue=${info.unlockQueue} > 上限 ${maxQueue}`);
        for (const build of info.builds) {
            const known = this.config.buildings.has(build.buildingId);
            const levels = this.config.levels.get(build.buildingId);
            const levelOk = levels?.has(Math.max(1, build.level)) ?? false;
            problems.push(`#${build.instanceId} buildingId=${build.buildingId}${known ? '' : '(不在 baseBuilding 表)'}`
                + ` position=${build.position}${build.position >= cellCount ? `(≥格数 ${cellCount})` : ''}`
                + ` level=${build.level}${levelOk ? '' : '(等级表缺该级)'}`);
        }
        console.warn(`[BigMap] 基地快照投影失败：${problems.join('；') || '(无建筑)'}`
            + ` —— 本端格数 ${cellCount}（plotRows×plotCols）、队列上限 ${maxQueue}`);
    }

    private async loadBuildInfo(): Promise<boolean> {
        let applied = false;
        do {
            this.refreshAgain = false;
            const revision = this.revision;
            const raw = await this.request('CmdSlgBuildInfoReqMsg', {});
            if (this.isDisposed) return false;
            const response = bigMapServerRecord(raw);
            const info = normalizeBigMapBuildInfo(response?.info);
            if (!info) this.reportSnapshotRejected(response);
            if (info && revision === this.revision && !this.isWriting) {
                applied = this.apply(info);
                if (!applied) this.reportProjectRejected(info);
            }
        } while (this.refreshAgain && !this.isDisposed);
        return applied;
    }

    /**
     *快照被丢弃时，把「为什么」打到控制台。
     *
     *不写这条的话，`ready === false` 的表现是完全静默的：界面一句
     *「正在同步基地信息」，建造请求一帧都不发，抓包看不到 `CmdSlgBuildReqMsg`，
     *没法判断是「没回包」还是「回包不合规」（2026-11-11 用户反馈）。
     */
    private reportSnapshotRejected(response: Record<string, unknown> | null): void {
        if (this.snapshotReported) return;
        this.snapshotReported = true;
        if (!response) {
            console.warn('[BigMap] CmdSlgBuildInfoReqMsg 没有回包（超时 / 未连接 / 服务端无此协议），'
                + '基地信息无法就绪 ⇒ 建造不会发出');
            return;
        }
        const info = bigMapServerRecord(response.info);
        const builds = Array.isArray(info?.builds) ? info.builds.length : `非数组(${typeof info?.builds})`;
        const queues = Array.isArray(info?.queues) ? info.queues.length : `非数组(${typeof info?.queues})`;
        console.warn(`[BigMap] CmdSlgBuildInfoReqMsg 回包被丢弃：unlockQueue=${String(info?.unlockQueue)} `
            + `builds=${builds} queues=${queues}。`
            + '整包拒绝的常见原因：unlockQueue 非法 / builds·queues 不是数组 / '
            + '某条 build 的 buildingId 不在本端配置、position 越界或重复 / state≠0 却不在 queues 里');
    }

    refreshAction(): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        if (this.actionTask) return this.actionTask;
        this.actionTask = this.loadAction().finally(() => { this.actionTask = null; });
        return this.actionTask;
    }

    private async loadAction(): Promise<boolean> {
        const response = bigMapServerRecord(await this.request('CmdSlgActionUpdateReqMsg', {}));
        const remaining = bigMapServerUint(bigMapServerRecord(response?.info)?.nextRevertTime);
        if (this.isDisposed || remaining === null) return false;
        //`nextRevertTime` 是剩余秒数，不是 Unix 时间，也不代表当前行动力数量 ——
        //协议里没有余额字段，界面只展示倒计时，不拿它反推总量。
        //`0` = 当前没有恢复计划（体力满）⇒ `actionRecoverAt` 置 0，`tick` 据此停止轮询。
        this.actionRecoverAt = remaining > 0 ? this.now() + remaining : 0;
        this.emit();
        return true;
    }

    /**
     *由 `BigMapController` 每 500ms 调一次（内部 5 秒节流），只负责行动力轮询。
     *
     *行动力是轮询的（2026-10-30 山猫口径）：`SlgGameActionInfo.nextRevertTime` 是
     *「距下次恢复的剩余秒数」，客户端折算成 `actionRecoverAt`；到点就再发一次
     *`CmdSlgActionUpdateReqMsg`，回包重新设定下一次 —— 如此循环，直到服务端说「没有恢复计划」。
     *
     * `CmdSlgBuildInfoReqMsg` 的触发点只有四个：首次 `initialize()`、`CmdSlgBuildInfoBroMsg`
     *失效通知、写操作回包应用失败后的重拉，以及某个队列 `finishTime` 到点（2026-11-11 服务端口径）。
     *前三个是「状态变了要拉」，第四个是「该问一句建完没有」—— 但拉回来才改状态：
     *客户端从不自己把 `state` 翻成已完成，也不本地结算产出。
     *
     *三个取舍：
     *1. `nextRevertTime = 0` ⇒ `actionRecoverAt = 0` ⇒ 停止轮询。0 的含义是「当前没有待恢复」
     *   （体力已满 / 服务端不给计划），继续轮询就是每 5 秒白打一次服务器。
     *2. 到点后最多延迟 5 秒才发（节流窗口），对分钟级的行动力恢复可接受；
     *   要更准就调小这里的步长，但别去掉节流 —— `tick` 本身是 500ms 一次的。
     *3. 请求失败不改 `actionRecoverAt`（`loadAction` 里 `remaining === null` 直接 return，
     *   旧时间戳原地不动）⇒ 下一轮 tick 自然重试，不会把倒计时抹成 0 或 NaN。
     */
    tick(): void {
        if (this.isDisposed || this.now() < this.nextPollAt) return;
        this.nextPollAt = this.now() + 5;
        if (this.actionRecoverAt === null || (this.actionRecoverAt > 0 && this.now() >= this.actionRecoverAt)) void this.refreshAction();
        this.syncFinishedQueue();
    }

    /**
     *建造 / 升级 `finishTime` 到点 ⇒ 主动拉一次 `CmdSlgBuildInfoReqMsg`。
     *
     *服务端口径（2026-11-11）：「finishTime 倒计时结束要向服务器拉取一次，同步最新」。
     *客户端只拉不判：不把 `state` 自己翻成已完成、不本地结算产出 ——
     *建筑到底建完没、产出算到哪一秒，都只认这次回包。倒计时归零只是「该问一次了」的信号。
     *
     *每个 `(实例, finishAt)` 只拉一次，记在 `syncedFinishAt` 里：同一座建筑再升级会拿到
     *新的 `finishAt`，自然再拉一次；否则 500ms 的 tick 会对着同一个完成时间反复打服务器。
     */
    private syncFinishedQueue(): void {
        if (!this.info) return;
        const now = this.now();
        for (const queue of this.info.queues) {
            const build = this.info.builds.find((entry) => entry.instanceId === queue.instanceId);
            if (!build || build.finishAt <= 0 || now < build.finishAt) continue;
            if (this.syncedFinishAt.get(build.instanceId) === build.finishAt) continue;
            this.syncedFinishAt.set(build.instanceId, build.finishAt);
            //`refreshBuildInfo` 自带 in-flight 合并：一轮只打一次，多了也只算一次。
            void this.refreshBuildInfo(true);
            return;
        }
    }

    build(buildingId: number, position: number, instant = false): Promise<IBigMapSlgResult> {
        if (!this.config.buildings.has(buildingId) || !this.validPosition(position)) return this.invalid();
        //进入写链路就留痕：`ready=false` 时下面会直接返回、请求不会发出去，
        //抓包看到"没有 CmdSlgBuildReqMsg"时，这一行能立刻区分「压根没进来」和「进来了但被门禁挡」。
        console.log(`[BigMap] 提交建造 ${buildingId}@${position}，ready=${this.ready}`
            + `（info=${this.info ? '有' : '无'} dirty=${this.isBuildDirty}）`);
        return this.write('CmdSlgBuildReqMsg', { buildingId, position, instant: instant ? 1 : 0 }, (rsp) => {
            const build = normalizeBigMapBuild(rsp.build);
            return build && build.buildingId === buildingId && build.position === position && this.applyBuildResponse(build, rsp.queue);
        }, SLG_TEXT.built);
    }

    upgrade(instanceId: number, instant = false): Promise<IBigMapSlgResult> {
        if (!this.hasInstance(instanceId)) return this.invalid();
        return this.write('CmdSlgBuildUpgradeReqMsg', { buildInstId: instanceId, instant: instant ? 1 : 0 }, (rsp) => {
            const build = normalizeBigMapBuild(rsp.build);
            return build && build.instanceId === instanceId && this.applyBuildResponse(build, rsp.queue);
        }, SLG_TEXT.upgraded);
    }

    cancel(instanceId: number): Promise<IBigMapSlgResult> {
        if (!this.hasInstance(instanceId)) return this.invalid();
        return this.write('CmdSlgBuildCancelReqMsg', { buildInstId: instanceId }, (rsp) => {
            if (!this.info || bigMapServerInstanceId(rsp.buildInstId) !== instanceId) return false;
            const build = rsp.build == null ? null : normalizeBigMapBuild(rsp.build);
            if (rsp.build != null && (!build || build.instanceId !== instanceId)) return false;
            const old = this.info.builds.find((item) => item.instanceId === instanceId);
            if (!old || (!build && old.state !== 1)) return false;
            //新建取消时无 build；升级取消必须有服务端回退后的建筑。
            const builds = this.info.builds.filter((item) => item.instanceId !== instanceId);
            if (build) builds.push(build);
            return this.apply({ ...this.info, builds, queues: this.info.queues.filter((queue) => queue.instanceId !== instanceId) });
        }, SLG_TEXT.cancelled);
    }

    move(instanceId: number, position: number): Promise<IBigMapSlgResult> {
        if (!this.hasInstance(instanceId) || !this.validPosition(position)) return this.invalid();
        return this.write('CmdSlgBuildMoveReqMsg', { buildInstId: instanceId, position }, (rsp) => {
            const build = normalizeBigMapBuild(rsp.build);
            return build && build.instanceId === instanceId && build.position === position && this.replaceBuild(build);
        }, SLG_TEXT.moved);
    }

    /** 批量领取：服务端按实例列表一次结算，并回写这些建筑的权威状态。 */
    collect(instanceIds: readonly number[]): Promise<IBigMapSlgResult> {
        if (instanceIds.length === 0 || instanceIds.some((id) => !this.hasInstance(id))) return this.invalid();
        const requested = new Set(instanceIds);
        let rewards: IBigMapSlgReward[] = [];
        return this.write('CmdSlgBuildCollectReqMsg', { buildInstIds: instanceIds }, (rsp) => {
            if (!Array.isArray(rsp.tlCmdGoods)) return false;
            const parsed: IBigMapSlgReward[] = [];
            for (const item of rsp.tlCmdGoods) {
                const row = bigMapServerRecord(item);
                const resId = toCount(row?.resId);
                const amount = toCount(row?.number);
                if (!row || !Number.isSafeInteger(resId) || resId <= 0
                    || !Number.isSafeInteger(amount) || amount < 0 || row.number == null
                    || (typeof row.number === 'string' && !/^\d+$/.test(row.number))) return false;
                if (amount > 0) parsed.push({ resId, amount });
            }
            rewards = parsed;
            //领取后服务端回写建筑事实；只接受本次请求过的实例，坏回包整单失败。
            if (rsp.builds == null) return true;
            if (!Array.isArray(rsp.builds) || !this.info) return false;
            const updated = new Map<number, IBigMapServerBuild>();
            for (const item of rsp.builds) {
                const build = normalizeBigMapBuild(item);
                if (!build || !requested.has(build.instanceId)) return false;
                updated.set(build.instanceId, build);
            }
            if (updated.size === 0) return true;
            return this.apply({ ...this.info,
                builds: this.info.builds.map((build) => updated.get(build.instanceId) ?? build) });
        }, SLG_TEXT.collected).then((result) => result.ok ? { ...result, rewards } : result);
    }

    unlockQueue(queueId: number): Promise<IBigMapSlgResult> {
        if (!this.info || queueId !== this.info.unlockQueue + 1 || queueId > this.config.queue.maxBuildQueue) return this.invalid();
        return this.write('CmdSlgBuildUnlockQueueReqMsg', { queueId }, (rsp) => {
            const count = bigMapServerUint(rsp.unlockQueue);
            return this.info && count === queueId && this.apply({ ...this.info, unlockQueue: count });
        }, SLG_TEXT.unlocked);
    }

    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.gateway.dispose?.();
        this.revision += 1;
        this.listeners.clear();
    }

    private validPosition(position: number): boolean {
        return Number.isInteger(position) && position >= 0 && position < this.config.queue.plotRows * this.config.queue.plotCols;
    }
    private hasInstance(id: number): boolean {
        return bigMapServerInstanceId(id) !== null && !!this.info?.builds.some((build) => build.instanceId === id);
    }
    private invalid(): Promise<IBigMapSlgResult> { return Promise.resolve({ ok: false, message: SLG_TEXT.invalid }); }

    private async request(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody): Promise<unknown> {
        if (this.isDisposed) return null;
        try { return await withTimeout(this.gateway.request(name, body), this.timeoutMs, () => null); }
        catch { return null; }
    }

    private async write(name: IBigMapSlgRequestName, body: IBigMapSlgRequestBody,
        apply: (rsp: Record<string, unknown>) => unknown, message: string): Promise<IBigMapSlgResult> {
        if (this.isDisposed) return { ok: false, message: SLG_TEXT.disposed };
        if (!this.ready) {
            //还没拿到权威快照：可能是首帧 `initialize()` 没回，也可能是上次写失败置了 `isBuildDirty`。
            //只回一句「正在同步基地信息」就完事，玩家看到的是「点了没反应、服务器也没收到」——
            //所以这里主动补拉一次（`refreshBuildInfo` 自己有 in-flight 合并，不会打爆服务器）。
            void this.refreshBuildInfo(true);
            return { ok: false, message: this.hasSyncFailed ? SLG_TEXT.syncFailed : SLG_TEXT.loading };
        }
        if (this.isWriting) return { ok: false, message: SLG_TEXT.busy };
        this.isWriting = true;
        this.revision += 1;
        try {
            const response = bigMapServerRecord(await this.request(name, body));
            if (this.isDisposed) return { ok: false, message: SLG_TEXT.disposed };
            if (!response || !apply(response)) {
                //服务端可能已执行但回包丢失，只重拉事实，禁止重新发送这次写操作。
                this.isBuildDirty = true;
                this.revision += 1;
                this.refreshAfterWrite = true;
                return { ok: false, message: SLG_TEXT.failed };
            }
            this.revision += 1;
            this.emit();
            return { ok: true, message };
        } finally {
            this.isWriting = false;
            if (this.refreshAfterWrite && !this.isDisposed) {
                this.refreshAfterWrite = false;
                void this.refreshBuildInfo(true);
            }
        }
    }

    private replaceBuild(build: IBigMapServerBuild): boolean {
        return !!this.info && this.apply({ ...this.info,
            builds: [...this.info.builds.filter((item) => item.instanceId !== build.instanceId), build] });
    }

    private applyBuildResponse(build: IBigMapServerBuild, rawQueue: unknown): boolean {
        if (!this.info) return false;
        //instant 成功也可能返回一个默认的空队列，只有进行中的建筑需要占用它。
        const queue = build.state === 0 ? null : normalizeBigMapBuildQueue(rawQueue);
        if (build.state !== 0 && (!queue || queue.instanceId !== build.instanceId || queue.type !== build.state)) return false;
        const queues = this.info.queues.filter((item) => item.instanceId !== build.instanceId && item.queueId !== queue?.queueId);
        if (queue) queues.push(queue);
        return this.apply({ ...this.info, queues, builds: [...this.info.builds.filter((item) => item.instanceId !== build.instanceId), build] });
    }

    private apply(info: IBigMapServerBuildInfo): boolean {
        //合并响应也走与全量快照相同的不变量，防止坏回包污染已展示的基地。
        const validated = normalizeBigMapBuildInfo({ unlockQueue: info.unlockQueue,
            builds: info.builds.map((build) => ({ ...build, buildInstId: build.instanceId, finishTime: build.finishAt })),
            queues: info.queues.map((queue) => ({ ...queue, buildInstId: queue.instanceId })),
        });
        if (!validated) return false;
        const base = projectBigMapServerBase(validated, this.config, this.now());
        if (!base) return false;
        this.info = validated;
        this.base = base;
        this.isBuildDirty = false;
        //拿到一次权威快照就算同步成功过；补拉成功即恢复，不必等下次开页。
        this.hasSyncFailed = false;
        //首次就绪打一条摘要：`unlockQueue=0`（没解锁队列）和 `builds=0`（服务端没下发建筑）
        //都能让建造失败，但表现完全不同，必须一眼能分。
        if (!this.firstSnapshotLogged) {
            this.firstSnapshotLogged = true;
            console.log(`[BigMap] 基地快照已就绪：unlockQueue=${validated.unlockQueue}`
                + ` builds=${validated.builds.length} queues=${validated.queues.length}`);
        }
        this.emit();
        return true;
    }
    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}
