/**
 * `auto_atlas_capacity.mjs` 的类型声明 —— 让 `tests/*.test.ts` 能直接 import 这个 Node 脚本做断言。
 *
 * 与 `verify.d.mts` 同理：`.d.mts` 只做类型声明、不产出代码；主工程 tsconfig 无 include，
 * 任何多余的 `.ts` 都会被扫进编译产物。
 */
export interface IAtlasReport {
    dir: string;
    maxWidth: number;
    maxHeight: number;
    capacity: number;
    files: number;
    pixels: number;
    maxSingleW: number;
    maxSingleH: number;
    biggest: string;
    limitValid: boolean;
    oversizedSingle: boolean;
    overCapacity: boolean;
    ok: boolean;
    reasons: string[];
}

export declare const ROOT: string;
export declare function norm(path: string): string;
export declare function pngSize(file: string): { w: number; h: number };
export declare function listPngs(dir: string): string[];
export declare function listAtlases(roots?: readonly string[]): string[];
export declare function readAtlasLimit(metaPath: string): { maxWidth: number; maxHeight: number };
export declare function atlasReport(
    metaPath: string,
    override?: { maxWidth?: number; maxHeight?: number },
): IAtlasReport;
