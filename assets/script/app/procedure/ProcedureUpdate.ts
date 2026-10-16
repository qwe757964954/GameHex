import { Node, Prefab } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { isNativeHotUpdatePlatform } from '../../core/update/HotUpdateNativePlan';
import type { HotUpdateConfig, HotUpdateProgress, NativeHotUpdateProgress } from '../../core/update/HotUpdateTypes';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { createCocosHotUpdateManager, createNativeHotUpdateRuntime, detectHotUpdatePlatform } from '../../platform/hotupdate/CocosHotUpdateFactory';
import type { NativeHotUpdateRuntime } from '../../platform/hotupdate/NativeHotUpdateRuntime';
import { loadHotUpdateConfig } from '../../platform/hotupdate/HotUpdateConfigLoader';
import { LAUNCH_UPDATE_WEIGHT, LaunchProgressUI } from '../loading/LaunchProgressUI';

/** 失败后点击状态文字要做什么。 */
type RetryKind = 'none' | 'rerun' | 'native-resume';

/**
 * 启动首流程：在任何远端业务资源加载前完成版本收敛。
 *
 * 两条路径：
 * - **Android / iOS**：官方 `native.AssetsManager` 全构建目录热更（`src` + `assets` +
 *   `jsb-adapter` 逐文件 md5 比对），因此**脚本也能更新**，代价是必须重启游戏；
 * - 其他平台：原有的远程 Bundle 收敛路径（解决包体，不覆盖脚本）。
 *
 * 进度 UI 用 `LaunchProgressUI`（热更 + 登录后资源加载**共用同一个启动 UI**）：
 * 本流程把热更实际进度映射到 `[0, LAUNCH_UPDATE_WEIGHT]`，`ProcedurePostLogin` 接着走
 * `[LAUNCH_UPDATE_WEIGHT, 1]`，视觉上是一条连续进度条。节点挂在常驻 host 下，
 * `onLeave` 只隐藏不销毁（登录页期间保持隐藏，留给登录后加载复用）。
 */
export class ProcedureUpdate extends ProcedureBase {
    public static __cname: string = 'ProcedureUpdate';

    /** 启动进度 prefab（首包 resources，热更期可加载；随 resourceScope 释放）。 */
    private launchPrefab: Prefab | null = null;
    private launchUI: LaunchProgressUI | null = null;
    private generation = 0;
    private running = false;
    private retryKind: RetryKind = 'none';
    private nativeRuntime: NativeHotUpdateRuntime | null = null;
    private lastConfig: HotUpdateConfig | null = null;

    /** 预加载首包启动进度页（不进远程热更 bundle，启动早期即可用）。 */
    async onPreload(_params?: unknown, context?: ProcedurePreloadContext): Promise<void> {
        if (this.launchPrefab) return;
        const prefab = await this.assets.load('ui/loading/LaunchProgress', Prefab, { scope: context?.resources });
        if (context?.cancelled) return;
        this.launchPrefab = prefab;
    }

    onEnter(): void {
        this.launchUI = LaunchProgressUI.ensure(this.host)
            ?? (this.launchPrefab ? LaunchProgressUI.createFromPrefab(this.launchPrefab, this.host) : null);
        if (this.launchUI) {
            // 点击状态文字重试（失败态才响应，见 onRetry）。
            this.launchUI.node.on(Node.EventType.TOUCH_END, this.onRetry, this);
            this.launchUI.show();
        } else {
            console.error('[ProcedureUpdate] 启动进度 UI 不可用（LaunchProgress 未预加载或组件缺失）');
        }
        this.startRun();
    }

    onLeave(): void {
        this.generation += 1;
        if (this.launchUI) {
            this.launchUI.node.off(Node.EventType.TOUCH_END, this.onRetry, this);
            // 不销毁：启动 UI 归登录后加载（ProcedurePostLogin）继续用，这里只隐藏。
            this.launchUI.hide();
        }
        this.launchUI = null;
        this.launchPrefab = null;
        this.running = false;
        this.retryKind = 'none';
        this.nativeRuntime = null;
        this.lastConfig = null;
        this.releaseResourceScope();
    }

    private startRun(): void {
        if (this.running) return;
        const generation = ++this.generation;
        this.running = true;
        this.retryKind = 'none';
        this.setStatus('正在检查资源版本…');
        void this.run(generation).finally(() => {
            if (generation === this.generation) this.running = false;
        });
    }

    private async run(generation: number): Promise<void> {
        let requireRemoteOnFirstInstall = false;
        try {
            const config = await loadHotUpdateConfig();
            this.lastConfig = config;
            requireRemoteOnFirstInstall = config.requireRemoteOnFirstInstall;
            if (generation !== this.generation) return;
            const platform = config.platformOverride ?? detectHotUpdatePlatform();
            // 只有 Android / iOS（且配置启用）才做热更；web / 调试 / 小游戏等平台
            // 直接跳过更新流程进入登录——不展示「资源热更新未启用」提示。
            // 登录后基础资源加载（ProcedurePostLogin）仍复用同一个启动 UI。
            if (!config.enabled || !config.enabledPlatforms.includes(platform)) {
                console.log(`[ProcedureUpdate] 平台 ${platform} 未启用资源热更新，跳过更新流程`);
                this.navigate(GameRoute.Login);
                return;
            }
            if (isNativeHotUpdatePlatform(platform)) {
                await this.runNative(generation, config);
                return;
            }
            await this.runBundle(generation, config);
        } catch (error) {
            if (generation !== this.generation) return;
            console.error('[ProcedureUpdate] 热更新流程异常', error);
            if (requireRemoteOnFirstInstall) {
                this.retryKind = 'rerun';
                this.setStatus('必需资源更新失败，请检查网络后点击重试');
                return;
            }
            this.setStatus('更新检查异常，正在使用随包资源');
            this.navigate(GameRoute.Login);
        }
    }

    /** Android / iOS：官方原生全构建目录热更。 */
    private async runNative(generation: number, config: HotUpdateConfig): Promise<void> {
        const runtime = createNativeHotUpdateRuntime(this.network, config);
        this.nativeRuntime = runtime;
        const result = await runtime.run(config, (progress) => this.onNativeProgress(generation, progress));
        if (generation !== this.generation) return;

        if (result.error) console.warn('[ProcedureUpdate]', result.message, result.error);
        this.setStatus(result.message);

        if (result.status === 'failed' && runtime.canRetryFailedAssets) {
            // 失败但已下载分片仍在，点击只续传失败项，不从零重来。
            this.retryKind = 'native-resume';
            this.setStatus(`${result.message}\n点击重试`);
            return;
        }
        if (result.status === 'mandatory-client-update' || result.status === 'integrity-error') {
            this.retryKind = 'rerun';
            this.setStatus(`${result.message}\n点击重试检查更新`);
            return;
        }
        if (result.canContinue) {
            this.retryKind = 'none';
            // 热更完成：进度停在热更权重段终点，登录后加载（ProcedurePostLogin）从同一点续走。
            this.launchUI?.setProgress(LAUNCH_UPDATE_WEIGHT);
            this.navigate(GameRoute.Login);
            return;
        }
        // restart-required：更新线程已经安排好 game.restart()，这里保持停留即可。
        this.retryKind = 'none';
    }

    /** 其他平台：沿用远程 Bundle 收敛（不含脚本）。 */
    private async runBundle(generation: number, config: HotUpdateConfig): Promise<void> {
        const manager = createCocosHotUpdateManager(this.network, config);
        const result = await manager.run(config, (progress) => this.onProgress(generation, progress));
        if (generation !== this.generation) return;
        this.setStatus(result.message);
        if (result.error) console.warn('[ProcedureUpdate]', result.message, result.error);
        if (result.canContinue) {
            // 热更完成：进度停在热更权重段终点，登录后加载（ProcedurePostLogin）从同一点续走。
            this.launchUI?.setProgress(LAUNCH_UPDATE_WEIGHT);
            this.navigate(GameRoute.Login);
            return;
        }
        this.retryKind = 'rerun';
        this.setStatus(`${result.message}\n点击重试`);
    }

    private onRetry(): void {
        if (this.retryKind === 'rerun') {
            this.startRun();
            return;
        }
        if (this.retryKind === 'native-resume') void this.resumeNative();
    }

    private async resumeNative(): Promise<void> {
        const runtime = this.nativeRuntime;
        const config = this.lastConfig;
        if (!runtime || !config || this.running) return;
        const generation = this.generation;
        this.running = true;
        this.retryKind = 'none';
        this.setStatus('正在续传失败资源…');
        try {
            const result = await runtime.retryFailedAssets(config, (progress) => this.onNativeProgress(generation, progress));
            if (generation !== this.generation) return;
            this.setStatus(result.message);
            if (result.error) console.warn('[ProcedureUpdate]', result.message, result.error);
            if (result.status === 'failed' && runtime.canRetryFailedAssets) {
                this.retryKind = 'native-resume';
                this.setStatus(`${result.message}\n点击重试`);
                return;
            }
            if (result.canContinue) {
                // 热更完成：进度停在热更权重段终点，登录后加载（ProcedurePostLogin）从同一点续走。
                this.launchUI?.setProgress(LAUNCH_UPDATE_WEIGHT);
                this.navigate(GameRoute.Login);
                return;
            }
            this.retryKind = 'none';
        } finally {
            if (generation === this.generation) this.running = false;
        }
    }

    private onProgress(generation: number, progress: HotUpdateProgress): void {
        if (generation !== this.generation) return;
        const suffix = progress.total
            ? `（${progress.completed ?? 0}/${progress.total}）`
            : '';
        this.setStatus(`${progress.message}${suffix}`);
        // Bundle 收敛进度映射到热更权重段 [0, LAUNCH_UPDATE_WEIGHT]；
        // 无 completed/total（检查/校验/提交阶段）保持不动。
        this.launchUI?.setProgress(progress.total
            ? ((progress.completed ?? 0) / progress.total) * LAUNCH_UPDATE_WEIGHT
            : null);
    }

    private onNativeProgress(generation: number, progress: NativeHotUpdateProgress): void {
        if (generation !== this.generation) return;
        if (progress.phase !== 'downloading') {
            this.setStatus(progress.message);
            this.launchUI?.setProgress(null);
            return;
        }
        const percent = Math.round(progress.percent ?? 0);
        const files = progress.totalFiles ? `（${progress.downloadedFiles ?? 0}/${progress.totalFiles} 文件）` : '';
        const bytes = formatBytes(progress.downloadedBytes, progress.totalBytes);
        this.setStatus(`正在下载资源更新 ${percent}%${files}${bytes}`);
        this.launchUI?.setProgress(((progress.percent ?? progress.percentByFile ?? 0) / 100) * LAUNCH_UPDATE_WEIGHT);
    }

    private setStatus(message: string): void {
        this.launchUI?.setStatus(message);
        console.log(`[ProcedureUpdate] ${message}`);
    }
}

function formatBytes(downloaded?: number, total?: number): string {
    if (typeof total !== 'number' || total <= 0) return '';
    const toMb = (value: number) => (value / 1024 / 1024).toFixed(1);
    return ` ${toMb(downloaded ?? 0)}/${toMb(total)} MB`;
}
