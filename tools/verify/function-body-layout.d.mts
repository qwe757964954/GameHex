/**
 * `function-body-layout.mjs` 的类型声明 —— 让 `tests/function-body-layout.test.ts` 直接 import 断言。
 *
 * 与 verify.d.mts 同理，用 `.d.mts` 而不是 `.d.ts`：本文件不产出运行时代码，
 * 也不会被 Cocos 的脚本编译当成业务模块。
 */
export interface IFunctionBodyLayoutFinding {
    file: string;
    /** A：函数体跨多行但首句与左花括号同行；B：整个函数体同一行。 */
    category: 'A' | 'B';
    /** 文件内的限定名，例如 `ZCAttackResolutionSystem.resolveProjectileHit`。 */
    name: string;
    /** function / method / constructor / get / set / function-expression / arrow。 */
    kindTag: string;
    /** 形参原文（归一空白），用于同名函数的身份区分。 */
    params: string;
    /** 同文件同限定名同形参的序号，按源码顺序，从 0 开始。 */
    ordinal: number;
    line: number;
    column: number;
    bodyStartLine: number;
    bodyEndLine: number;
    /** 函数体语句数（不含空语句）。 */
    statementCount: number;
    /** 函数体压缩空白后的字符数，用于 B 类按体量分级判断。 */
    bodyChars: number;
    /** 首句压缩空白后的前 80 字符，便于报告定位。 */
    statementPreview: string;
    /** 基线身份：`name|kindTag|params|ordinal`，不含文件与行号。 */
    id: string;
}

export interface IFunctionBodyLayoutExcluded {
    total: number;
    byReason: Record<string, number>;
}

export interface IFunctionBodyLayoutCollection {
    files: string[];
    excluded: IFunctionBodyLayoutExcluded;
}

export interface IFunctionBodyLayoutFileResult {
    file: string;
    findings: IFunctionBodyLayoutFinding[];
    error?: string;
}

export interface IFunctionBodyLayoutNewViolation extends IFunctionBodyLayoutFinding {
    reason: 'new' | 'no-baseline';
}

export declare const SCAN_ROOTS: readonly string[];
export declare function collectSourceFiles(): IFunctionBodyLayoutCollection;
export declare function scanSource(text: string, file: string): IFunctionBodyLayoutFinding[];
export declare function scanFile(file: string): IFunctionBodyLayoutFinding[];
export declare function scanRepo(): { collection: IFunctionBodyLayoutCollection; results: IFunctionBodyLayoutFileResult[] };
export declare function summarize(results: readonly IFunctionBodyLayoutFileResult[]): {
    a: IFunctionBodyLayoutFinding[];
    b: IFunctionBodyLayoutFinding[];
    unreadable: IFunctionBodyLayoutFileResult[];
};
export declare function loadBaseline(file?: string): Map<string, Set<string>> | null;
export declare function saveBaseline(results: readonly IFunctionBodyLayoutFileResult[], file?: string): string;
export declare function newViolations(
    current: readonly IFunctionBodyLayoutFinding[],
    baseline: Map<string, Set<string>> | null,
    previousIdsOf: (file: string) => Set<string> | null,
): IFunctionBodyLayoutNewViolation[];
export declare function previousViolationIds(file: string): Set<string> | null;
export declare function syntaxFingerprint(text: string, fileName: string): string[];
export declare function compareSyntax(
    beforeText: string,
    afterText: string,
    fileName: string,
): { equal: boolean; index: number; before: string | null; after: string | null };
export declare function runCli(argv: readonly string[]): number;
