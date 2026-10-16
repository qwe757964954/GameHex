import type { HotUpdateBundleDescriptor } from '../../core/update/HotUpdateTypes';

/** 让普通 AssetService 能按当前激活 Manifest 定位远端 Bundle。 */
export class CocosBundleRegistry {
    private static bundles = new Map<string, HotUpdateBundleDescriptor>();

    static resolve(name: string): HotUpdateBundleDescriptor | undefined {
        return this.bundles.get(name);
    }

    static replace(values: Readonly<Record<string, HotUpdateBundleDescriptor>>): void {
        this.bundles = new Map(Object.entries(values));
    }

    static snapshot(): Readonly<Record<string, HotUpdateBundleDescriptor>> {
        return Object.fromEntries(this.bundles.entries());
    }

    static clear(): void {
        this.bundles.clear();
    }
}
