/**
 * `constant-guard.mjs` 的类型声明 —— 让 `tests/constant-guard.test.ts` 直接 import 断言。
 *
 * 与 verify.d.mts 同理，用 `.d.mts` 而不是 `.d.ts`：本文件不产出运行时代码，
 * 也不会被 Cocos 的脚本编译当成业务模块。
 */
export interface IConstantRule {
    title: string;
    severity: 'error' | 'warn';
}

export interface IConstantViolation {
    rule: string;
    severity: 'error' | 'warn';
    file: string;
    line: number;
    symbol: string;
    message: string;
    /** 基线身份：`rule|file|symbol`，不含行号。 */
    fingerprint: string;
}

export interface IConstantBaseline {
    fingerprints: Set<string>;
    files: Map<string, number>;
}

export interface IConstantContext {
    externalCounts?: Map<string, number>;
    /** 生产代码（assets/script）内的引用次数；缺省同 externalCounts。 */
    productionCounts?: Map<string, number>;
}

export interface IConstantAnalysis {
    files: string[];
    violations: IConstantViolation[];
    exportCounts: Map<string, number>;
}

export interface IConstantAudit {
    files: number;
    exportConst: number;
    byRule: Record<string, number>;
    colorOutsideTheme: number;
    warnings: number;
    violations: IConstantViolation[];
    atomic: IConstantViolation[];
}

export declare const RULES: Record<string, IConstantRule>;
export declare function countReferences(root: string, names: Iterable<string>): Map<string, Map<string, number>>;
export declare function analyzeSource(relFile: string, text: string, context?: IConstantContext): IConstantViolation[];
export declare function lexicalExportEntries(relFile: string, text: string): Array<{
    name: string;
    value: string | undefined;
    line: number;
    file: string;
}>;
export declare function duplicateViolations(files: ReadonlyArray<{ rel: string; text: string }>): IConstantViolation[];
export declare function atomicWarnings(exportCounts: Map<string, number>, baselineFiles: Map<string, number> | null): IConstantViolation[];
export declare function loadBaseline(file?: string): IConstantBaseline | null;
export declare function saveBaseline(root: string, exportCounts: Map<string, number>, violations: readonly IConstantViolation[], file?: string): string;
export declare function newViolations(current: readonly IConstantViolation[], baseline: IConstantBaseline | null): IConstantViolation[];
export declare function changedSourceFiles(root: string): string[];
export declare function runCli(argv: readonly string[], root?: string): number;
