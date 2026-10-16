import { game, native, sys } from 'cc';

/** 与 localStorage 键名一致；main.js 的注入片段读同一个键，改名会直接导致热更不生效。 */
export const HOT_UPDATE_SEARCH_PATHS_KEY = 'HotUpdateSearchPaths';
/** 记录上次启动时的客户端版本，用于大版本升级时清理旧缓存。 */
export const HOT_UPDATE_CLIENT_VERSION_KEY = 'hotupdate.clientVersion';

/** AssetsManager 事件（只列本模块用得到的字段，避免依赖引擎类型定义）。 */
export interface NativeAssetsManagerEvent {
    getEventCode(): number;
    getMessage?(): string;
    getAssetId?(): string;
    getPercent?(): number;
    getPercentByFile?(): number;
    getDownloadedBytes?(): number;
    getTotalBytes?(): number;
    getDownloadedFiles?(): number;
    getTotalFiles?(): number;
}

export interface NativeAssetsManagerManifest {
    isLoaded?(): boolean;
    getSearchPaths?(): string[];
}

export interface NativeAssetsManager {
    setEventCallback(callback: ((event: NativeAssetsManagerEvent) => void) | null): void;
    setVerifyCallback(callback: ((path: string, asset: unknown) => boolean) | null): void;
    setVersionCompareHandle?(handle: ((left: string, right: string) => number) | null): void;
    setMaxConcurrentTask?(task: number): void;
    /**
     * 🔴 **只能传 manifestUrl 一个参数。**
     *
     * 引擎（3.8 `native.AssetsManager`）有两个重载：
     *   1. `loadLocalManifest(manifestUrl: string): boolean`
     *   2. `loadLocalManifest(localManifest: Manifest, storagePath: string): boolean`
     * 重载 2 的第一个参数是 **`Manifest` 对象**。传路径字符串会被引擎当 `Manifest*`
     * 解引用 ⇒ **同步 SIGSEGV（fault addr 0x0、无 JS 栈）**。已实测踩过。
     *
     * 这里刻意**不声明** `storagePath` 参数：它已在 `new AssetsManager('', storagePath)`
     * 里给过，而引擎 `loadLocalManifest` 的第 1 步就是「Reset storage path」到该值。
     */
    loadLocalManifest(manifest: string): boolean;
    getLocalManifest(): NativeAssetsManagerManifest | null;
    getState(): number;
    checkUpdate(): void;
    update(): void;
    downloadFailedAssets(): void;
}

/** 引擎侧的常量表（jsb.EventAssetsManager / jsb.AssetsManager.State）。 */
export interface NativeAssetsManagerEnvironment {
    readonly UNINITED: number;
    readonly ERROR_NO_LOCAL_MANIFEST: number;
    readonly ERROR_DOWNLOAD_MANIFEST: number;
    readonly ERROR_PARSE_MANIFEST: number;
    readonly ERROR_UPDATING: number;
    readonly ERROR_DECOMPRESS: number;
    readonly ALREADY_UP_TO_DATE: number;
    readonly NEW_VERSION_FOUND: number;
    readonly UPDATE_PROGRESSION: number;
    /** 每下载完一个文件就会派发；漏了它会导致进度事件序列判断不完整。 */
    readonly ASSET_UPDATED: number;
    readonly UPDATE_FINISHED: number;
    readonly UPDATE_FAILED: number;
}

/**
 * 原生环境端口。
 *
 * 把 jsb / localStorage / game.restart 全部挡在这个接口后面，业务编排
 * （`NativeHotUpdateRuntime`）才能在没有引擎的环境里被单测覆盖。
 */
export interface NativeHotUpdateHost {
    readonly supported: boolean;
    readonly environment: NativeAssetsManagerEnvironment;
    /** 应用可写目录下的热更缓存目录，**必须以 `/` 结尾**（与引擎的 `_temp/` 约定对齐）。 */
    resolveStoragePath(dirName: string): string;
    /** 定位随包 project.manifest；`override` 为配置里显式指定的绝对路径。 */
    resolveLocalManifestPath(override?: string): string | null;
    readTextFile(path: string): string | null;
    fileExists(path: string): boolean;
    readSearchPaths(): string[];
    applySearchPaths(paths: readonly string[]): void;
    persistSearchPaths(paths: readonly string[]): void;
    clearPersistedSearchPaths(): void;
    readPersistedClientVersion(): string | null;
    writePersistedClientVersion(version: string): void;
    removeDirectory(path: string): void;
    /**
 * 🔴 **刻意不接受 `versionCompareHandle`。**
 *
 * 引擎会在 `onSuccess → parseVersion()` 里**同步调用**这个 handle，而那条链位于
 * `onFileTaskSuccess` 回调上 = **原生下载线程**。传 JS 函数进去就是跨线程调 JS
 * ⇒ 同步 SIGSEGV（实测 `SEGV_MAPERR`、`fault addr 0xd5e4` 固定偏移、Thread-2）。
 *
 * 详见 `HotUpdateNativePlan.ts` 里已删除的 `buildNativeVersionCompare` 处的说明。
 * 版本比较走引擎默认 `cmpVersion`，全序比较放在 JS 侧的 `compareReleaseVersion`。
 */
createAssetsManager(storagePath: string): NativeAssetsManager | null;
    restartGame(delayMs: number): void;
    info(message: string): void;
    warn(message: string, error?: unknown): void;
}

function getRuntime(): Record<string, any> | null {
    const globalObject = globalThis as unknown as Record<string, any>;
    const jsb = globalObject.jsb;
    return jsb && typeof jsb === 'object' ? jsb : null;
}

/**
 * Cocos 原生（Android/iOS）实现。
 *
 * 注意：注入到 main.js 的片段用的是 `window.jsb`，而 TS 里 `native` 命名空间只能 import，
 * 所以这里统一走 `globalThis.jsb`，两边指向同一份绑定。
 */
export class CocosNativeHotUpdateHost implements NativeHotUpdateHost {
    private readonly jsb = getRuntime();

    get supported(): boolean {
        return !!this.jsb && !!this.jsb.AssetsManager && !!this.jsb.fileUtils && sys.isNative;
    }

    /**
     * 引擎事件 / 状态常量表。
     *
     * 🔴 **取值路径必须走 `native.EventAssetsManager`，不能只读全局 `jsb`。**
     *
     * 引擎 `cocos/native-binding/index.ts` 里 `EventAssetsManager` 声明在
     * `native` 命名空间下，且原文注明「全局 `jsb` 对象已废弃，推荐用 `cc` 导出的
     * `native`，且 `native` 是 `jsb` 的**子集**」⇒ `jsb.EventAssetsManager`
     * 可能**根本不存在**。
     *
     * 原实现只读 `jsb` 且每个常量都带 `?? 0/1/2/…` 的**猜测兜底值**：
     * 取不到时全部常量退化成 0~9 的连续假值，与引擎真实事件码错位 ⇒
     * `checkUpdate()` 派发的每个事件都匹配不上 ⇒ Promise 永不 resolve，
     * 而引擎的下载线程还在继续派发事件（原生侧没有任何 JS 栈可读）。
     * **猜测兜底在这里等于把静默失效做成崩溃。**
     *
     * 现在：多路探测（`native` → `jsb` → `AssetsManager` 命名空间），
     * 且**取不到就抛错**，绝不猜。
     */
    get environment(): NativeAssetsManagerEnvironment {
        const candidates: Record<string, unknown>[] = [];
        // ① 官方推荐路径：cc 导出的 native
        const nativeNS = (native as unknown as Record<string, unknown> | undefined)?.EventAssetsManager;
        if (nativeNS) candidates.push(nativeNS as Record<string, unknown>);
        // ② 旧版全局 jsb（保留兼容，但不作为唯一来源）
        const jsbNS = this.jsb?.EventAssetsManager;
        if (jsbNS) candidates.push(jsbNS as Record<string, unknown>);
        // ③ 有些版本挂在 AssetsManager 下
        const managerNS = this.jsb?.AssetsManager;
        if (managerNS) candidates.push(managerNS as Record<string, unknown>);

        const read = (key: string): number => {
            for (const source of candidates) {
                const value = source[key];
                if (typeof value === 'number') return value;
            }
            // 🔴 不猜：猜出来的常量会让事件匹配全部失配，且失败点在无栈的原生回调里。
            throw new Error(
                `[NativeHotUpdate] 读不到引擎常量 ${key}；已尝试 native.EventAssetsManager /`
                + ' jsb.EventAssetsManager / jsb.AssetsManager 三处。'
                + '这通常意味着引擎版本不匹配或绑定未导出该常量。',
            );
        };

        const nativeAssetsManager = (native as unknown as Record<string, unknown> | undefined)?.AssetsManager;
        const states = ((typeof nativeAssetsManager === 'object' && nativeAssetsManager !== null
            ? (nativeAssetsManager as Record<string, unknown>).State
            : undefined)
            ?? this.jsb?.AssetsManager?.State ?? {}) as Record<string, unknown>;
        return {
            UNINITED: typeof states.UNINITED === 'number' ? states.UNINITED : 0,
            ERROR_NO_LOCAL_MANIFEST: read('ERROR_NO_LOCAL_MANIFEST'),
            ERROR_DOWNLOAD_MANIFEST: read('ERROR_DOWNLOAD_MANIFEST'),
            ERROR_PARSE_MANIFEST: read('ERROR_PARSE_MANIFEST'),
            ERROR_UPDATING: read('ERROR_UPDATING'),
            ERROR_DECOMPRESS: read('ERROR_DECOMPRESS'),
            ALREADY_UP_TO_DATE: read('ALREADY_UP_TO_DATE'),
            NEW_VERSION_FOUND: read('NEW_VERSION_FOUND'),
            UPDATE_PROGRESSION: read('UPDATE_PROGRESSION'),
            ASSET_UPDATED: read('ASSET_UPDATED'),
            UPDATE_FINISHED: read('UPDATE_FINISHED'),
            UPDATE_FAILED: read('UPDATE_FAILED'),
        };
    }

    resolveStoragePath(dirName: string): string {
        const writable = this.fileUtils()?.getWritablePath?.() ?? '';
        const base = `${writable}${dirName}`;
        return base.endsWith('/') ? base : `${base}/`;
    }

    resolveLocalManifestPath(override?: string): string | null {
        const utils = this.fileUtils();
        if (!utils) return null;
        const candidates: string[] = [];
        if (override) candidates.push(override);
        // 首选：交给引擎在所有搜索路径里找随包 project.manifest。
        const resolved = utils.fullPathForFilename?.('project.manifest');
        if (resolved) candidates.push(resolved);
        const writable = utils.getWritablePath?.();
        if (writable) candidates.push(`${writable}project.manifest`);
        const resourceRoot = utils.getDefaultResourceRootPath?.();
        if (resourceRoot) candidates.push(`${resourceRoot}/project.manifest`);
        for (const candidate of candidates) {
            if (candidate && this.fileExists(candidate)) return candidate;
        }
        return null;
    }

    readTextFile(path: string): string | null {
        const content = this.fileUtils()?.getStringFromFile?.(path);
        return typeof content === 'string' && content ? content : null;
    }

    fileExists(path: string): boolean {
        return this.fileUtils()?.isFileExist?.(path) === true;
    }

    readSearchPaths(): string[] {
        const paths = this.fileUtils()?.getSearchPaths?.();
        return Array.isArray(paths) ? Array.from(paths as string[]) : [];
    }

    applySearchPaths(paths: readonly string[]): void {
        this.fileUtils()?.setSearchPaths?.(Array.from(paths));
    }

    persistSearchPaths(paths: readonly string[]): void {
        const storage = this.localStorage();
        if (!storage) {
            this.warn('无法访问 localStorage，热更搜索路径无法持久化，重启后会退回包内脚本');
            return;
        }
        storage.setItem(HOT_UPDATE_SEARCH_PATHS_KEY, JSON.stringify(Array.from(paths)));
    }

    clearPersistedSearchPaths(): void {
        this.localStorage()?.removeItem?.(HOT_UPDATE_SEARCH_PATHS_KEY);
    }

    readPersistedClientVersion(): string | null {
        const value = this.localStorage()?.getItem?.(HOT_UPDATE_CLIENT_VERSION_KEY);
        return typeof value === 'string' && value ? value : null;
    }

    writePersistedClientVersion(version: string): void {
        this.localStorage()?.setItem?.(HOT_UPDATE_CLIENT_VERSION_KEY, version);
    }

    removeDirectory(path: string): void {
        this.fileUtils()?.removeDirectory?.(path);
    }

    createAssetsManager(storagePath: string): NativeAssetsManager | null {
        const AssetsManager = this.jsb?.AssetsManager;
        if (!AssetsManager) return null;
        try {
            // 第一个参数留空：`init()` 里 `if (!manifestUrl.empty()) loadLocalManifest(...)`
            // 会跳过，随包清单由后面显式 `loadLocalManifest(url)` 载入。
            // 远端地址由随包清单里的 remoteManifestUrl 决定。
            // ⚠️ **不要加第三个参数（版本比较 handle）**：它会在原生下载线程上被调用，
            // 传 JS 函数就是跨线程调 JS ⇒ SIGSEGV。
            return new AssetsManager('', storagePath);
        } catch (error) {
            this.warn('创建 AssetsManager 失败', error);
            return null;
        }
    }

    restartGame(delayMs: number): void {
        setTimeout(() => {
            try {
                game.restart();
            } catch (error) {
                this.warn('重启游戏失败，请手动重启以应用热更新', error);
            }
        }, delayMs);
    }

    info(message: string): void {
        console.log('[NativeHotUpdate]', message);
    }

    warn(message: string, error?: unknown): void {
        console.warn('[NativeHotUpdate]', message, error ?? '');
    }

    private fileUtils(): Record<string, any> | null {
        const utils = this.jsb?.fileUtils;
        return utils && typeof utils === 'object' ? utils : null;
    }

    private localStorage(): Record<string, any> | null {
        const globalObject = globalThis as unknown as Record<string, any>;
        const storage = globalObject.localStorage ?? globalObject.sys?.localStorage;
        return storage && typeof storage === 'object' ? storage : null;
    }
}
