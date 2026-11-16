/**
 * 引导存档的引擎适配层，本模块是链路上唯一 import cc 的文件。
 * GuideSaveStore / GuideSyncOutbox 保持纯 TS，测试只 import model 即可，不用造引擎桩。
 */

import { sys } from 'cc';
import { readRoleRow } from '../../main/MainRoleRow';
import { toIdString } from '../../net/RequestGuard';
import { GuideSaveStore } from '../model/GuideSaveStore';
import type { IGuideSaveOwner, IGuideStorage } from '../model/GuideSaveStore';
import { GuideSyncOutbox } from '../model/GuideSyncOutbox';

/**
 * 读当前账号身份，与领地存档同一套 serverId + roleId 口径。
 * 未登录或无角色返回 null，此时存档与待发队列都只进内存。
 */
export function readGuideSaveOwner(): IGuideSaveOwner | null {
    const role = readRoleRow();
    return role
        ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) }
        : null;
}

/** 同一账号的存档与待发队列；共用一份 storage 适配器，避免两套 key / I/O 规则。 */
export interface IGuidePersistence {
    readonly store: GuideSaveStore;
    readonly outbox: GuideSyncOutbox;
}

/** 建存档与待发队列。省略 owner 时按当前登录角色解析。 */
export function createGuidePersistence(owner: IGuideSaveOwner | null = readGuideSaveOwner()): IGuidePersistence {
    const storage: IGuideStorage = {
        getItem: (key) => sys.localStorage.getItem(key),
        setItem: (key, value) => sys.localStorage.setItem(key, value),
    };
    return {
        store: new GuideSaveStore(owner, storage),
        outbox: new GuideSyncOutbox(owner, storage),
    };
}
