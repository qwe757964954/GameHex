/**
 * `verify.mjs` 的类型声明 —— 让 `tests/*.test.ts` 能直接 import 这个 Node 脚本做断言。
 *
 * 本文件是 `.d.mts` 不是 `.d.ts`：主工程 `tsconfig.json` 没有 `include`/`exclude`，
 * 会扫全工程，任何多余的 `.ts` 都会被算进编译产物；`.d.mts` 只做类型声明、不产出代码。
 * 同理 `verify.mjs` 也不能写成 `verify.ts`。
 */
export interface IVerifyRouteRow {
    title: string;
    paths: string;
    keys: readonly string[];
    tests: readonly string[];
}

export interface IVerifySelectionHit {
    file: string;
    importers: readonly string[];
    routes: readonly string[];
    fallback: readonly string[];
}

export interface IVerifySelection {
    tests: readonly string[];
    hits: readonly IVerifySelectionHit[];
    wide: readonly string[];
    routeOk: boolean;
    routeSources: readonly string[];
}

export declare function norm(path: string): string;
export declare function parseRows(lines: readonly string[]): IVerifyRouteRow[];
export declare function routeSources(): string[];
export declare function parseRoutes(): { rows: IVerifyRouteRow[]; ok: boolean; sources: string[] };
export declare function matchRoute(row: IVerifyRouteRow, file: string): boolean;
export declare function selectTests(files: readonly string[]): IVerifySelection;
export declare function printRouteHits(selection: IVerifySelection, files: readonly string[]): number;
export declare function runCli(argv: readonly string[]): number;
