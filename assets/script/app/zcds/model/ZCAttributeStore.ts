import type { ZCUnitDefinition } from './ZCCombatCatalog';
import { applyZCTypedUnitModifiers, type ZCStatBreakdown, type ZCTypedModifier } from './ZCStatSchema';

/**
 * 单位属性的分层缓存。静态成长只计算一次，战斗中 Buff 变化时只替换 dynamic 层并失效缓存。
 * GameModel 可逐步把临时状态接到这里，而无需再次遍历旧修改器表。
 */
export class ZCAttributeStore {
    private dynamic: readonly ZCTypedModifier[] = [];
    private cached: { definition: ZCUnitDefinition; breakdown: readonly ZCStatBreakdown[] } | null = null;

    constructor(
        private readonly base: ZCUnitDefinition,
        private readonly staticModifiers: readonly ZCTypedModifier[] = [],
    ) {}

    setDynamicModifiers(modifiers: readonly ZCTypedModifier[]): void {
        this.dynamic = modifiers.slice();
        this.cached = null;
    }

    snapshot(): { definition: ZCUnitDefinition; breakdown: readonly ZCStatBreakdown[] } {
        if (!this.cached) {
            this.cached = applyZCTypedUnitModifiers(this.base, [...this.staticModifiers, ...this.dynamic]);
        }
        return this.cached;
    }
}
