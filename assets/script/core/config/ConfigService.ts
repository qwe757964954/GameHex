/** 引擎无关的只读配置入口。 */
export interface ConfigService {
    initialize(): Promise<void>;
    getTable<T = unknown>(name: string): Promise<readonly T[]>;
}
