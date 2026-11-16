/** `{0}` / `{1}` 占位替换；缺参与 null 的处理由调用方显式选择。 */
export interface IPlaceholderOptions {
    readonly missing: 'empty' | 'keep';
    readonly nullish: 'string' | 'keep';
}

export function formatPlaceholders(
    template: string,
    args: readonly (string | number | null | undefined)[],
    options: IPlaceholderOptions,
): string {
    return template.replace(/\{(\d+)\}/g, (whole, indexText: string) => {
        const value = args[Number(indexText)];
        if (value === undefined) return options.missing === 'keep' ? whole : '';
        if (value === null) return options.nullish === 'keep' ? whole : String(value);
        return String(value);
    });
}
