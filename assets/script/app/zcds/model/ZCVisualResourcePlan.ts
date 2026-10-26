export interface IZCVisualDependency {
    readonly unitId: string;
    readonly details: unknown;
}

/** 只识别目录中真实存在的单位 ID，保守保留技能、召唤和替换模型传递依赖。 */
export function resolveZCVisualUnitIds(
    knownIds: readonly string[],
    heroIds: readonly number[],
    dependencies: readonly IZCVisualDependency[],
): ReadonlySet<string> {
    const known = new Set(knownIds);
    const required = new Set(heroIds.map(String).filter((id) => known.has(id)));
    const visit = (value: unknown): void => {
        if (typeof value === 'string' || typeof value === 'number') {
            if (known.has(String(value))) required.add(String(value));
        } else if (Array.isArray(value)) {
            for (const entry of value) visit(entry);
        } else if (value && typeof value === 'object') {
            for (const entry of Object.values(value)) visit(entry);
        }
    };
    for (const unitId of required) {
        for (const dependency of dependencies) if (dependency.unitId === unitId) visit(dependency.details);
    }
    return required;
}
