import { game, native, sys } from 'cc';

/** 与 localStorage 键名一致；main.js 的注入片段读同一个键，改名会直接导致热更不生效。 */
export const HOT_UPDATE_SEARCH_PATHS_KEY = 'HotUpdateSearchPaths';
/** 记录上次启动时的客户端版本，用于大版本升级时清理旧缓存。 */
export const HOT_UPDATE_CLIENT_VERSION_KEY = 'hotupdate.clientVersion';

/** AssetsManager 事件（只列本模块用得到的字段，避免依赖引擎类型定义）。 */
export interface INativeAssetsManagerEvent {
    getEventCode(): number;
    getMessage?(): string;
    getAssetId?(): string;
    /** Creator 3.8.8 返回 0~1 的字节比例。 */
    getPercent?(): number;
    /** Creator 3.8.8 返回 0~1 的文件比例。 */
    getPercentByFile?(): number;
    getDownloadedBytes?(): number;
    getTotalBytes?(): number;
    getDownloadedFiles?(): number;
    getTotalFiles?(): number;
}

export interface INativeAssetsManagerManifest {
    isLoaded?(): boolean;
    getSearchPaths?(): string[];
}

export interface INativeAssetsManager {
    setEventCallback(callback: ((event: INativeAssetsManagerEvent) => void) | null): void;
    setVerifyCallback(callback: ((path: string, asset: unknown) => boolean) | null): void;
    setVersionCompareHandle?(handle: ((left: string, right: string) => number) | null): void;
    setMaxConcurrentTask?(task: number): void;
    /**
     * 只能传 manifestUrl 一个参数。引擎另一个重载首参是 Manifest 对象，
     * 传路径字符串会被当 Manifest* 解引用，同步 SIGSEGV（实测，无 JS 栈）。
     * storagePath 已在构造器里给过，引擎载入时会重置到该值。
     */
    loadLocalManifest(manifest: string): boolean;
    getLocalManifest(): INativeAssetsManagerManifest | null;
    getState(): number;
    checkUpdate(): void;
    update(): void;
    downloadFailedAssets(): void;
}

/** 引擎侧的常量表（jsb.EventAssetsManager / jsb.AssetsManager.State）。 */
export interface INativeAssetsManagerEnvironment {
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
 * 原生环境端口：把 jsb/localStorage/game.restart 挡在接口后面，
 * 编排器才能在没有引擎的环境里被单测覆盖。
 */
export interface INativeHotUpdateHost {
    readonly supported: boolean;
    readonly environment: INativeAssetsManagerEnvironment;
    /** 应用可写目录下的热更缓存目录，必须以 / 结尾（对齐引擎 _temp/ 约定）。 */
    resolveStoragePath(dirName: string): string;
    /** 定位随包 project.manifest；override 为配置里显式指定的绝对路径。 */
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
     * 刻意不接受 versionCompareHandle：引擎在原生下载线程上同步调用它，
     * 传 JS 函数就是跨线程调 JS，同步 SIGSEGV。版本比较走引擎默认 cmpVersion，
     * 全序比较放在 JS 侧的 compareReleaseVersion。
     */
createAssetsManager(storagePath: string): INativeAssetsManager | null;
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
 * Cocos 原生实现。main.js 注入片段用 window.jsb，native 命名空间只能 import，
 * 这里统一走 globalThis.jsb，两边指向同一份绑定。
 */
export class CocosNativeHotUpdateHost implements INativeHotUpdateHost {
    private readonly jsb = getRuntime();

    get supported(): boolean {
        return !!this.jsb && !!this.jsb.AssetsManager && !!this.jsb.fileUtils && sys.isNative;
    }

    /**
     * 常量按 native → jsb → AssetsManager 三路探测。EventAssetsManager 声明在
     * native 命名空间下，全局 jsb 可能没有；取不到就抛错，猜测值会让事件码
     * 全部错位、Promise 永不 resolve，且失败点在无栈的原生回调里。
     */
    get environment(): INativeAssetsManagerEnvironment {
        const candidates: Record<string, unknown>[] = [];
        // cc 导出的 native（官方推荐）
        const nativeNS = (native as unknown as Record<string, unknown> | undefined)?.EventAssetsManager;
        if (nativeNS) candidates.push(nativeNS as Record<string, unknown>);
        // 旧版全局 jsb
        const jsbNS = this.jsb?.EventAssetsManager;
        if (jsbNS) candidates.push(jsbNS as Record<string, unknown>);
        // 部分版本挂在 AssetsManager 下
        const managerNS = this.jsb?.AssetsManager;
        if (managerNS) candidates.push(managerNS as Record<string, unknown>);

        const read = (key: string): number => {
            for (const source of candidates) {
                const value = source[key];
                if (typeof value === 'number') return value;
            }
            // 不猜：假常量会让事件匹配全部失配，且失败点在无栈的原生回调里。
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

    createAssetsManager(storagePath: string): INativeAssetsManager | null {
        const AssetsManager = this.jsb?.AssetsManager;
        if (!AssetsManager) return null;
        try {
            // 首参留空让 init 跳过自动载入，随包清单由后面显式 loadLocalManifest 载入；
            // 远端地址取随包清单里的 remoteManifestUrl。不要加第三个参数，理由见接口注释。
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
