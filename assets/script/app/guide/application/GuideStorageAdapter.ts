/**
 * 引导存档的引擎适配层，本模块是链路上唯一 import cc 的文件。
 * GuideSaveStore 保持纯 TS，测试只 import model 即可，不用造引擎桩。
 */

import { sys } from 'cc';
import { readRoleRow } from '../../main/MainRoleRow';
import { toIdString } from '../../net/RequestGuard';
import { GuideSaveStore } from '../model/GuideSaveStore';
import type { IGuideSaveOwner } from '../model/GuideSaveStore';

/**
 * 读当前账号身份，与领地存档同一套 serverId + roleId 口径。
 * 未登录或无角色返回 null，此时存档只写内存不落盘。
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
