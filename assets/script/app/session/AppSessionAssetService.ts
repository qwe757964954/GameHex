import { Prefab } from 'cc';
import type { ConfigService } from '../../core/config/ConfigService';
import type { AssetService } from '../../core/asset/AssetService';
import type { SessionAssetService, SessionLoadProgress } from '../../core/asset/SessionAssetService';
import { ScopedAssetCache } from '../../core/asset/ScopedAssetCache';
import { buildZCBattleWarmupPaths, buildZCBattleParsePaths, ZC_BATTLE_DOWNLOAD_PREFABS } from '../zcds/model/ZCGameResourcePlan';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { bundleForPath } from '../../core/asset/BundleCatalog';
import { loadCommonArt, releaseArtCache } from '../card/CardLineupIcons';
import type { ZCGamePreload } from '../zcds/application/ZCGamePreload';

interface LoadTask {
    readonly message: string;
    readonly run: () => Promise<unknown>;
    readonly validate?: (value: unknown) => boolean;
}

const COMMON_ART = ['anniu_01', 'anniu_02', 'btn_close'] as const;
const MAX_CONCURRENCY = 4;
const WARMUP_CONCURRENCY = 2;
const IDLE_ASSET_PRIORITY = -10;
const WARM_PARSE_YIELD_MS = 16;
const BATTLE_CACHE_MAX_ENTRIES = 64;
const BATTLE_CACHE_IDLE_MS = 10 * 60 * 1000;
const BATTLE_LOAD_CONCURRENCY = 4;

/** app 层能力：匹配流程接管登录后已经完成的对局预加载。 */
export interface BattlePreloadProvider {
    takeBattlePreload(): ZCGamePreload | null;
}

/** 应用登录会话内常驻的配置和首屏动态美术。 */
export class AppSessionAssetService implements SessionAssetService {
    readonly reusableAssets: ScopedAssetCache;
    private warmupPlanTask: Promise<{ downloads: readonly string[]; parsePaths: ReadonlySet<string> }> | null = null;
    private warmParseTail: Promise<void> = Promise.resolve();
    private warmParseScope: ResourceScope | null = null;
    private warmupTotal = 0;
    private readonly pinnedPaths = new Set<string>();
    private readonly parsedPaths = new Set<string>();
    private readonly pendingWarmPaths = new Map<string, Promise<void>>();
    private cachePruneTimer: ReturnType<typeof setTimeout> | null = null;
    private scope: ResourceScope | null = null;
    private preparing: Promise<void> | null = null;
    private _ready = false;
    private warmTask: Promise<void> | null = null;
    private warmRevision = 0;
    private readonly warmedPaths = new Set<string>();

    constructor(
        private readonly assets: AssetService,
        private readonly configs: ConfigService,
    ) {
        this.reusableAssets = new ScopedAssetCache(assets, {
            maxEntries: BATTLE_CACHE_MAX_ENTRIES,
            idleMs: BATTLE_CACHE_IDLE_MS,
            maxConcurrentLoads: BATTLE_LOAD_CONCURRENCY,
        }, () => Date.now());
    }

    get ready(): boolean {
        return this._ready;
    }

    get warmupProgress(): { completed: number; total: number; parsed: number; cached: number; pinned: number } {
        return { completed: this.warmedPaths.size, total: this.warmupTotal,
            parsed: this.parsedPaths.size, cached: this.reusableAssets.stats.entries, pinned: this.pinnedPaths.size };
    }

    prepare(onProgress?: (progress: SessionLoadProgress) => void): Promise<void> {
        if (this._ready) {
            onProgress?.({ completed: 1, total: 1, ratio: 1, message: '基础资源已就绪' });
            return Promise.resolve();
        }
        if (this.preparing) return this.preparing;

        const scope = new ResourceScope('login-session');
        scope.defer(releaseArtCache);
        this.scope = scope;

        const tasks: LoadTask[] = [
            { message: '正在初始化基础配置', run: () => this.configs.initialize() },
            ...COMMON_ART.map((name): LoadTask => ({
                message: `正在准备通用界面资源 ${name}`,
                run: () => loadCommonArt(name),
                validate: Boolean,
            })),
        ];

        const task = this.runTasks(tasks, onProgress)
            .then(() => {
                if (this.scope !== scope || scope.disposed) throw new Error('会话资源加载已取消');
                this._ready = true;
                this.ensureCachePruning();
            })
            .catch((error) => {
                if (this.scope === scope) {
                    this.pauseWarmup();
                    scope.dispose();
                    this.scope = null;
                    this._ready = false;
                }
                throw error;
            })
            .finally(() => {
                if (this.preparing === task) this.preparing = null;
            });
        this.preparing = task;
        return task;
    }

    clear(): void {
        this.pauseWarmup();
        this.warmedPaths.clear();
        this.parsedPaths.clear();
        this.pinnedPaths.clear();
        this.warmupTotal = 0;
        this.pendingWarmPaths.clear();
        this.warmupPlanTask = null;
        this.reusableAssets.clear();
        if (this.cachePruneTimer !== null) clearTimeout(this.cachePruneTimer);
        this.cachePruneTimer = null;
        this.scope?.dispose();
        this.scope = null;
        this.preparing = null;
        this._ready = false;
    }

    /** 只允许匹配流程接管一次；接管后资源由匹配/对局流程负责释放。 */
    takeBattlePreload(): ZCGamePreload | null {
        return null;
    }

    warmup(): Promise<void> {
        if (this.warmTask) return this.warmTask;
        const scope = this.scope;
        const preload = this.assets.preload;
        if (!this._ready || !scope || scope.disposed || !preload) return Promise.resolve();
        const revision = ++this.warmRevision;
        const parseScope = new ResourceScope('battle-idle-parse');
        this.warmParseScope = parseScope;
        const isCurrent = (): boolean => this.scope === scope && !scope.disposed && revision === this.warmRevision;
        const task = (async () => {
            const plan = await this.loadWarmupPlan();
            if (!isCurrent()) return;
            const paths = plan.downloads;
            this.warmupTotal = paths.length;
            const parseTasks: Promise<void>[] = [];
            let cursor = 0;
            const worker = async (): Promise<void> => {
                while (isCurrent() && cursor < paths.length) {
                    const path = paths[cursor++];
                    if (!this.warmedPaths.has(path)) await this.downloadWarmPath(path, scope, isCurrent);
                    if (isCurrent() && this.warmedPaths.has(path) && plan.parsePaths.has(path)) {
                        // 解析由单通道串行推进；下载名额不等它，避免慢 Prefab 堵住预下载。
                        parseTasks.push(this.queueWarmParse(path, parseScope, isCurrent));
                    }
                    // 每项让出事件循环，前台导航有机会暂停后续派发。
                    if (isCurrent()) await new Promise<void>(resolve => setTimeout(resolve, 0));
                }
            };
            await Promise.all(Array.from({ length: WARMUP_CONCURRENCY }, worker));
            // 下载结束并不代表解析结束，释放作用域前必须同时收拢两条通道。
            await Promise.all(parseTasks);
        })().finally(() => {
            parseScope.dispose();
            if (this.warmParseScope === parseScope) this.warmParseScope = null;
            if (this.warmTask === task) this.warmTask = null;
        });
        this.warmTask = task;
        return task;
    }

    /** 兼容旧入口；由主界面绘制后统一触发，详情页不直接调用。 */
    warmupBattle(): Promise<void> {
        return this.warmup();
    }

    private loadWarmupPlan(): Promise<{ downloads: readonly string[]; parsePaths: ReadonlySet<string> }> {
        if (!this.warmupPlanTask) {
            this.warmupPlanTask = Promise.all(['pvpCard', 'pvpSkill', 'pvpModifierOverride'].map(async name => {
                try { return await this.configs.getTable<unknown>(name); }
                catch (error) {
                    console.warn(`[SessionAssets] 预下载清单读取失败：${name}`, error);
                    return [];
                }
            })).then(([cards, skills, overrides]) => ({
                downloads: buildZCBattleWarmupPaths(cards, skills, overrides),
                parsePaths: new Set(buildZCBattleParsePaths(cards)),
            }));
        }
        return this.warmupPlanTask;
    }

    private async downloadWarmPath(path: string, scope: ResourceScope, isCurrent: () => boolean): Promise<void> {
        const preload = this.assets.preload;
        if (!preload) return;
        try {
            // 暂停只停派发，引擎中已开始的下载仍占用两个后台名额。
            while (!this.pendingWarmPaths.has(path) && this.pendingWarmPaths.size >= WARMUP_CONCURRENCY) {
                await Promise.race(this.pendingWarmPaths.values()).catch(() => {});
                if (!isCurrent()) return;
            }
            if (!isCurrent() || this.warmedPaths.has(path)) return;
            let pending = this.pendingWarmPaths.get(path);
            if (!pending) {
                pending = preload.call(this.assets, path, { scope, bundle: bundleForPath(path), priority: IDLE_ASSET_PRIORITY });
                this.pendingWarmPaths.set(path, pending);
            }
            try {
                await pending;
                // 暂停不丢弃已下载文件；退出登录的迟到结果不属于新会话。
                if (this.scope === scope && !scope.disposed) this.warmedPaths.add(path);
            } finally {
                if (this.pendingWarmPaths.get(path) === pending) this.pendingWarmPaths.delete(path);
            }
        } catch (error) {
            if (isCurrent()) console.warn(`[SessionAssets] 战斗资源预下载失败：${path}`, error);
        }
    }

    private queueWarmParse(path: string, scope: ResourceScope, isCurrent: () => boolean): Promise<void> {
        const task = this.warmParseTail.then(async () => {
            if (!isCurrent() || scope.disposed) return;
            await new Promise<void>(resolve => setTimeout(resolve, WARM_PARSE_YIELD_MS));
            if (!isCurrent() || scope.disposed) return;
            try {
                const retained = await this.reusableAssets.warm(path, Prefab, { scope, bundle: bundleForPath(path), priority: IDLE_ASSET_PRIORITY });
                if (retained && isCurrent()) {
                    this.parsedPaths.add(path);
                    const session = this.scope;
                    if (session && !session.disposed && ZC_BATTLE_DOWNLOAD_PREFABS.some(corePath => corePath === path)
                        && !this.pinnedPaths.has(path)) {
                        // 同一缓存项多一份会话租约，不增加缓存条目或额外加载。
                        const pinned = await this.reusableAssets.warm(path, Prefab, { scope: session, bundle: bundleForPath(path), priority: IDLE_ASSET_PRIORITY });
                        if (pinned && this.scope === session && !session.disposed) this.pinnedPaths.add(path);
                    }
                }
            } catch (error) {
                if (isCurrent()) console.warn(`[SessionAssets] 静默解析失败：${path}`, error);
            }
        });
        this.warmParseTail = task;
        return task;
    }

    private ensureCachePruning(): void {
        if (this.cachePruneTimer !== null) return;
        this.cachePruneTimer = setTimeout(() => {
            this.cachePruneTimer = null;
            this.reusableAssets.prune();
            if (this._ready) this.ensureCachePruning();
        }, 30000);
    }

    pauseWarmup(): void {
        this.warmParseScope?.dispose();
        this.warmParseScope = null;
        this.warmRevision += 1;
        this.warmTask = null;
    }

    private async runTasks(
        tasks: readonly LoadTask[],
        onProgress?: (progress: SessionLoadProgress) => void,
    ): Promise<void> {
        const total = tasks.length;
        let cursor = 0;
        let completed = 0;
        let stopped = false;
        onProgress?.({ completed, total, ratio: 0, message: '正在准备登录后基础资源' });

        const worker = async (): Promise<void> => {
            while (!stopped && cursor < total) {
                const current = tasks[cursor++];
                try {
                    const value = await current.run();
                    if (current.validate && !current.validate(value)) {
                        throw new Error(`${current.message}失败`);
                    }
                    completed += 1;
                    onProgress?.({
                        completed,
                        total,
                        ratio: completed / total,
                        message: current.message,
                    });
                } catch (error) {
                    stopped = true;
                    throw error;
                }
            }
        };

        const workerCount = Math.min(MAX_CONCURRENCY, total);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }
}
