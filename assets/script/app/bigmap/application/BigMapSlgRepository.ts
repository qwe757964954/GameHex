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

    constructor(private readonly gateway: IBigMapSlgGateway, private readonly config: IBigMapConfig,
        private readonly now: () => number, private readonly timeoutMs = 5000) {}

    invalidate(kind: 'game' | 'build'): void {
        if (this.isDisposed) return;
        this.revision += 1;
        if (this.isWriting) this.refreshAfterWrite = true;
        else void this.refreshBuildInfo(true);
        if (kind === 'game') {
            // 广播还带游戏信息（所处城池会变），不能只刷行动力。
            void this.refreshGame();
            void this.refreshAction();
        }
    }

    get ready(): boolean { return this.info !== null && !this.isBuildDirty; }
    get actionRemainingSeconds(): number | null {
        return this.actionRecoverAt === null ? null : Math.max(0, Math.ceil(this.actionRecoverAt - this.now()));
    }
    /**
     * 我所处的城池 id（协议 `SlgGameInfo.toCampId`，0 = 未归属）。
     *
     * 收到 game 包之前是 0 —— 调用方必须把 0 当「未知」而不是「没有城」，
     * 「在不在势力范围内」的判定为此保留距离回退（见 `bigMapWithinCityRange`）。
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
        return !this.isDisposed && game && builds && action;
    }

    /**
     * 拉游戏信息（所处城池 / 最高野怪等级）。
     *
     * 解析失败**不清空**已有值：坏回包只会让这次刷新返回 false，
     * 否则一次超时就能把「我在哪座城」从界面上抹掉。
     */
    refreshGame(): Promise<boolean> {
        if (this.isDisposed) return Promise.resolve(false);
        if (this.gameTask) return this.gameTask;
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

    private async loadBuildInfo(): Promise<boolean> {
        let applied = false;
        do {
            this.refreshAgain = false;
            const revision = this.revision;
            const response = bigMapServerRecord(await this.request('CmdSlgBuildInfoReqMsg', {}));
            if (this.isDisposed) return false;
            const info = normalizeBigMapBuildInfo(response?.info);
            if (info && revision === this.revision && !this.isWriting) applied = this.apply(info);
        } while (this.refreshAgain && !this.isDisposed);
        return applied;
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
        // nextRevertTime 是剩余秒数，不是 Unix 时间，也不代表当前行动力数量。
        this.actionRecoverAt = remaining > 0 ? this.now() + remaining : 0;
        this.emit();
        return true;
    }

    tick(): void {
        if (this.isDisposed || this.now() < this.nextPollAt) return;
        this.nextPollAt = this.now() + 5;
        if (!this.info || this.isBuildDirty || this.info.builds.some((build) => build.state !== 0 && build.finishAt <= this.now())) void this.refreshBuildInfo();
        if (this.actionRecoverAt === null || (this.actionRecoverAt > 0 && this.now() >= this.actionRecoverAt)) void this.refreshAction();
    }

    build(buildingId: number, position: number, instant = false): Promise<IBigMapSlgResult> {
        if (!this.config.buildings.has(buildingId) || !this.validPosition(position)) return this.invalid();
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
            // 新建取消时无 build；升级取消必须有服务端回退后的建筑。
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
            // 领取后服务端回写建筑事实；只接受本次请求过的实例，坏回包整单失败。
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
        if (!this.ready) return { ok: false, message: SLG_TEXT.loading };
        if (this.isWriting) return { ok: false, message: SLG_TEXT.busy };
        this.isWriting = true;
        this.revision += 1;
        try {
            const response = bigMapServerRecord(await this.request(name, body));
            if (this.isDisposed) return { ok: false, message: SLG_TEXT.disposed };
            if (!response || !apply(response)) {
                // 服务端可能已执行但回包丢失，只重拉事实，禁止重新发送这次写操作。
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
        // instant 成功也可能返回一个默认的空队列，只有进行中的建筑需要占用它。
        const queue = build.state === 0 ? null : normalizeBigMapBuildQueue(rawQueue);
        if (build.state !== 0 && (!queue || queue.instanceId !== build.instanceId || queue.type !== build.state)) return false;
        const queues = this.info.queues.filter((item) => item.instanceId !== build.instanceId && item.queueId !== queue?.queueId);
        if (queue) queues.push(queue);
        return this.apply({ ...this.info, queues, builds: [...this.info.builds.filter((item) => item.instanceId !== build.instanceId), build] });
    }

    private apply(info: IBigMapServerBuildInfo): boolean {
        // 合并响应也走与全量快照相同的不变量，防止坏回包污染已展示的基地。
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
        this.emit();
        return true;
    }
    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}
