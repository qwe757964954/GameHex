import { Prefab } from 'cc';
import type { ConfigService } from '../../core/config/ConfigService';
import type { AssetService } from '../../core/asset/AssetService';
import type { SessionAssetService, SessionLoadProgress } from '../../core/asset/SessionAssetService';
import { ScopedAssetCache } from '../../core/asset/ScopedAssetCache';
import { ZC_BATTLE_COMMON_PREFABS, ZC_BATTLE_DOWNLOAD_PREFABS } from '../zcds/model/ZCGameResourcePlan';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { BATTLE_BUNDLE } from '../../core/asset/BundleCatalog';
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


/** app 层能力：匹配流程接管登录后已经完成的对局预加载。 */
export interface BattlePreloadProvider {
    takeBattlePreload(): ZCGamePreload | null;
}

/** 应用登录会话内常驻的配置和首屏动态美术。 */
export class AppSessionAssetService implements SessionAssetService {
    readonly reusableAssets: ScopedAssetCache;
    private battleWarmTask: Promise<void> | null = null;
    private battleWarmScope: ResourceScope | null = null;
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
        this.reusableAssets = new ScopedAssetCache(assets, { maxEntries: 64, idleMs: 120000 }, () => Date.now());
    }

    get ready(): boolean {
        return this._ready;
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
        let cursor = 0;
        const isCurrent = (): boolean => this.scope === scope && !scope.disposed && revision === this.warmRevision;
        const worker = async (): Promise<void> => {
            while (isCurrent() && cursor < ZC_BATTLE_DOWNLOAD_PREFABS.length) {
                const path = ZC_BATTLE_DOWNLOAD_PREFABS[cursor++];
                if (this.warmedPaths.has(path)) continue;
                try {
                    await preload.call(this.assets, path, { scope, bundle: BATTLE_BUNDLE });
                    if (isCurrent()) this.warmedPaths.add(path);
                } catch (error) {
                    if (isCurrent()) console.warn(`[SessionAssets] 公共资源预下载失败：${path}`, error);
                }
            }
        };
        const task = Promise.all(Array.from({ length: WARMUP_CONCURRENCY }, worker)).then(() => {}).finally(() => {
            if (this.warmTask === task) this.warmTask = null;
        });
        this.warmTask = task;
        return task;
    }

    /** 详情出现后逐项解析公共外壳；不读表、不选地图，前台可随时停止派发。 */
    warmupBattle(): Promise<void> {
        if (this.battleWarmTask) return this.battleWarmTask;
        if (!this._ready || !this.scope || this.scope.disposed) return Promise.resolve();
        const scope = new ResourceScope('battle-common-warmup');
        this.battleWarmScope = scope;
        this.ensureCachePruning();
        const task = (async () => {
            for (const path of ZC_BATTLE_COMMON_PREFABS) {
                if (scope.disposed) break;
                try {
                    await this.reusableAssets.load(path, Prefab, { scope, bundle: BATTLE_BUNDLE });
                } catch (error) {
                    if (!scope.disposed) console.warn(`[SessionAssets] 公共资源解析失败：${path}`, error);
                }
                if (!scope.disposed) await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
        })().finally(() => {
            scope.dispose();
            if (this.battleWarmScope === scope) this.battleWarmScope = null;
            if (this.battleWarmTask === task) this.battleWarmTask = null;
        });
        this.battleWarmTask = task;
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
        this.battleWarmScope?.dispose();
        this.battleWarmScope = null;
        this.battleWarmTask = null;
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
