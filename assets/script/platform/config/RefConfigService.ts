import type { ConfigService } from '../../core/config/ConfigService';
import { RefUtil } from '../../framework/ref/RefUtil';

/** 把迁移期 RefUtil 包装成稳定的配置端口。 */
export class RefConfigService implements ConfigService {
    private initialized = false;
    private initializing: Promise<void> | null = null;

    initialize(): Promise<void> {
        if (this.initialized) return Promise.resolve();
        if (!this.initializing) {
            this.initializing = RefUtil.loadRefSmallAll()
                .then(() => {
                    this.initialized = true;
                    this.initializing = null;
                }, (error) => {
                    this.initializing = null;
                    throw error;
                });
        }
        return this.initializing;
    }

    async getTable<T = unknown>(name: string): Promise<readonly T[]> {
        await this.initialize();
        const value = await RefUtil.instance.getRefAllAsync(name);
        return Array.isArray(value) ? value as T[] : [];
    }
}
