/**
 * 读 `CmdRole` 缓存里本机那一行。
 *
 * 单独成文件而不是塞进 `MainResBar.ts`（`cc.Component`）或 `MainResBarTypes.ts`
 * （测试契约要求它只依赖零引擎模块）：调用方 `common/ResBar`、`bigmap/BigMapEntry`、
 * `MainTerritoryMap` 只需要这一行数据，不该为此连带依赖引擎；也不该让
 * `MainResBarTypes` 的依赖链多出 `CacheMgr`。
 */

import { CacheMgr } from '../net/CacheMgr';

/**
 * 从 `CmdRole` 缓存里取本机那一行（多行时取第一条，正常情况下只有自己）。
 *
 *  缓存没初始化（`FW.CacheMgr` / `protoCache.json` 未加载）时**不抛**，返回 `null`
 *  交给调用方走占位分支 —— 与 `MatchSelfProfile.readFromRoleCache` 同一口径。
 */
export function readRoleRow(): CmdRole | null {
    try {
        const rows = CacheMgr.instance.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (row) return row;
        }
        return null;
    } catch (error) {
        console.warn('[MainRoleRow] CmdRole 缓存不可用', error);
        return null;
    }
}
