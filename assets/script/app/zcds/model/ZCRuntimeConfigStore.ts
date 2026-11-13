import type { ZCCardRarityMeta, ZCDeckCard } from './ZCCombatCatalog';
import type { IZCPvpCompiledConfig } from './ZCPvpConfigCompiler';

export interface IZCRuntimeCatalogs extends Partial<IZCPvpCompiledConfig> {
    readonly cardCatalog?: ReadonlyMap<string, ZCDeckCard>;
    readonly rarityMeta?: readonly ZCCardRarityMeta[];
}

/** 共享配置归属；正式流程由组合根初始化，登录会话 clear 时整体失效。 */
export class ZCRuntimeConfigStore {
    private catalogs: Readonly<IZCRuntimeCatalogs> = Object.freeze({});
    private compiled = false;
    private revisionValue = 0;
    private pending: Promise<boolean> | null = null;

    get snapshot(): Readonly<IZCRuntimeCatalogs> { return this.catalogs; }
    get ready(): boolean { return this.compiled; }
    get revision(): number { return this.revisionValue; }

    install(compiled: IZCPvpCompiledConfig): void {
        this.revisionValue++;
        this.catalogs = Object.freeze({
            rarityMeta: this.catalogs.rarityMeta,
            ...compiled,
            cardCatalog: new Map(compiled.cards.map(card => [card.id, card])),
        });
        this.compiled = true;
    }

    /** 编辑器阵容预览只加载部分表；外观元数据也在同一作用域内补充。 */
    updateCatalogs(catalogs: IZCRuntimeCatalogs): void {
        this.catalogs = Object.freeze({ ...this.catalogs, ...catalogs });
    }

    reset(): void {
        this.revisionValue++;
        this.catalogs = Object.freeze({});
        this.compiled = false;
        this.pending = null;
    }

    ensure(load: () => Promise<IZCPvpCompiledConfig>): Promise<boolean> {
        if (this.compiled) return Promise.resolve(true);
        if (this.pending) return this.pending;
        const revision = this.revisionValue;
        const task = (async () => {
            try {
                const compiled = await load();
                if (revision !== this.revisionValue) return false;
                this.install(compiled);
                return true;
            } catch (error) {
                if (revision !== this.revisionValue) return false;
                throw error;
            }
        })().finally(() => {
            if (this.pending === task) this.pending = null;
        });
        this.pending = task;
        return task;
    }
}

/** 应用内唯一的配置服务；无每局状态，由 ProcedureBootstrap 的会话端口负责 reset。 */
export const ZC_RUNTIME_CONFIG = new ZCRuntimeConfigStore();
