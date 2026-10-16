export interface SessionLoadProgress {
    readonly completed: number;
    readonly total: number;
    readonly ratio: number;
    readonly message: string;
}

/** 登录成功后、退出登录前持续持有的基础资源。 */
export interface SessionAssetService {
    readonly ready: boolean;
    prepare(onProgress?: (progress: SessionLoadProgress) => void): Promise<void>;
    clear(): void;
}
