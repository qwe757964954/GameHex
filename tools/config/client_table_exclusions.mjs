import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const unusedClientTablesFile = resolve(repositoryRoot, 'tools', 'ref', 'unused_client_tables.txt');

/** 读取客户端未使用表清单；文件缺失时按空清单处理。 */
export function readUnusedClientTables() {
    if (!existsSync(unusedClientTablesFile)) return [];
    return readFileSync(unusedClientTablesFile, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

/**
 * 从指定客户端 JSON 目录移除未使用表。
 * 只处理客户端目录；服务端目录由调用方决定是否保留。
 */
export function removeUnusedClientTables(directory, tables = readUnusedClientTables()) {
    if (!existsSync(directory)) return;
    for (const table of tables) {
        const file = join(directory, `${table}.json`);
        if (existsSync(file)) rmSync(file, { force: true });
    }
}
