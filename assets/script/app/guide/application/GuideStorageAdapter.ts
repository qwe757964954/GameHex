/**
 * 引导存档的引擎适配器 —— **本模块是引导存档链路上唯一 import `cc` 的文件**。
 *
 * 分层口径对齐 `TerritorySaveStoreAdapter`：
 *
 * ```
 * GuideSaveStore（model，纯 TS，注入 IGuideStorage）
 *        ↑ 由本文件注入 sys.localStorage
 * GuideStorageAdapter（application，唯一引擎 I/O 边界）
 * ```
 *
 * 这样 `tests/` 只 import `model/GuideSaveStore` 就能跑，不用造引擎桩。
 */

import { sys } from 'cc';
import { readRoleRow } from '../../main/MainRoleRow';
import { toIdString } from '../../net/RequestGuard';
import { GuideSaveStore } from '../model/GuideSaveStore';
import type { IGuideSaveOwner } from '../model/GuideSaveStore';

/**
 * 读当前账号身份。
 *
 * 与 `readTerritorySaveOwner`（`territory/application/ChapterSelectLoader.ts`）**同一套口径**
 * （`serverId` + `roleId`）—— 两套存档的 key 命名空间可对照，排查时不会出现"领地有档、引导没档"却查不出原因。
 * 未登录 / 无角色返回 `null`：此时存档只写内存，不落盘。
 */
export function readGuideSaveOwner(): IGuideSaveOwner | null {
    const role = readRoleRow();
    return role
        ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) }
        : null;
}

/** 建存档句柄。省略 owner 时按当前登录角色解析。 */
export function createGuideSaveStore(owner: IGuideSaveOwner | null = readGuideSaveOwner()): GuideSaveStore {
    return new GuideSaveStore(owner, {
        getItem: (key) => sys.localStorage.getItem(key),
        setItem: (key, value) => sys.localStorage.setItem(key, value),
    });
}
