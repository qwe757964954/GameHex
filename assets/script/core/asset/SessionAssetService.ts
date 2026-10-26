import type { AssetService } from './AssetService';

export interface SessionLoadProgress {
    readonly completed: number;
    readonly total: number;
    readonly ratio: number;
    readonly message: string;
}

/** 登录成功后、退出登录前持续持有的基础资源。 */
export interface SessionAssetService {
    readonly ready: boolean;
    /** 可选的会话资产复用入口；资源仍通过调用方作用域租用。 */
    readonly reusableAssets?: AssetService;
    /** 用户进入战斗详情后解析公共外壳，不包含地图或阵容状态。 */
    warmupBattle?(): Promise<void>;
    prepare(onProgress?: (progress: SessionLoadProgress) => void): Promise<void>;
    /** 首屏完成后尽力预下载公共资源，失败不影响会话就绪。 */
    warmup?(): Promise<void>;
    /** 前台加载开始时停止派发尚未启动的后台任务。 */
    pauseWarmup?(): void;
    clear(): void;
}
