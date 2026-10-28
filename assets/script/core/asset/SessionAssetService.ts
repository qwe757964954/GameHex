import type { AssetService } from './AssetService';

export interface SessionLoadProgress {
    readonly completed: number;
    readonly total: number;
    readonly ratio: number;
    readonly message: string;
}

export interface ISessionWarmupProgress {
    readonly completed: number;
    readonly total: number;
    /** 本会话累计成功预解析的路径数，不表示当前仍持有的条目。 */
    readonly parsed: number;
    readonly cached: number;
    /** 核心外壳的会话租约，包含在 cached 预算内。 */
    readonly pinned?: number;
}

/** 登录成功后、退出登录前持续持有的基础资源。 */
export interface SessionAssetService {
    readonly ready: boolean;
    readonly warmupProgress?: ISessionWarmupProgress;
    /** 可选的会话资产复用入口；资源仍通过调用方作用域租用。 */
    readonly reusableAssets?: AssetService;
    /** 兼容旧入口，行为同 warmup；不创建节点或对局状态。 */
    warmupBattle?(): Promise<void>;
    prepare(onProgress?: (progress: SessionLoadProgress) => void): Promise<void>;
    /** 主界面显示后静默下载，并逐项解析公共外壳/单位；失败不影响会话就绪。 */
    warmup?(): Promise<void>;
    /** 前台加载开始时停止派发尚未启动的后台任务。 */
    pauseWarmup?(): void;
    clear(): void;
}
