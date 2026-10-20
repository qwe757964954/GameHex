import type { ConfigService } from '../../core/config/ConfigService';
import type { AssetService } from '../../core/asset/AssetService';
import type { SessionAssetService, SessionLoadProgress } from '../../core/asset/SessionAssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { loadCommonArt, releaseArtCache } from '../card/CardLineupIcons';
import { MAP_DIRECTORY } from '../zcds/ZCGame';
import { ZCGameLoader } from '../zcds/application/ZCGameLoader';
import { ZCGamePreload } from '../zcds/application/ZCGamePreload';

interface LoadTask {
    readonly message: string;
    readonly run: () => Promise<unknown>;
    readonly validate?: (value: unknown) => boolean;
}

const COMMON_ART = ['anniu_01', 'anniu_02', 'btn_close'] as const;
const MAX_CONCURRENCY = 4;

/** app 层能力：匹配流程接管登录后已经完成的对局预加载。 */
export interface BattlePreloadProvider {
    takeBattlePreload(): ZCGamePreload | null;
}

/** 应用登录会话内常驻的配置和首屏动态美术。 */
export class AppSessionAssetService implements SessionAssetService {
    private scope: ResourceScope | null = null;
    private preparing: Promise<void> | null = null;
    private _ready = false;
    private battlePreload: ZCGamePreload | null = null;

    constructor(
        private readonly assets: AssetService,
        private readonly configs: ConfigService,
    ) {}

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
            {
                message: '正在准备地图、单位与战斗资源',
                run: () => this.prepareBattleResources(),
                validate: Boolean,
            },
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
            })
            .catch((error) => {
                if (this.scope === scope) {
                    this.releaseBattlePreload();
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
        this.releaseBattlePreload();
        this.scope?.dispose();
        this.scope = null;
        this.preparing = null;
        this._ready = false;
    }

    /** 只允许匹配流程接管一次；接管后资源由匹配/对局流程负责释放。 */
    takeBattlePreload(): ZCGamePreload | null {
        const preload = this.battlePreload;
        this.battlePreload = null;
        return preload;
    }

    private prepareBattleResources() {
        if (!this.battlePreload) {
            this.battlePreload = new ZCGamePreload(new ZCGameLoader(this.assets, this.configs, MAP_DIRECTORY));
        }
        return this.battlePreload.ready;
    }

    private releaseBattlePreload(): void {
        this.battlePreload?.releaseFromMatching();
        this.battlePreload = null;
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
