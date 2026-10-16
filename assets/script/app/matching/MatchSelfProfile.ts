/**
 * 匹配中我方信息条的自己资料（找对手时就要显示，不等对手）。
 * 身份来源：CmdRole 缓存（服务端权威）→ localStorage.login_session（兜底 roleId）→ null。
 * 只能给昵称 / roleId / 头像 id；战力段位奖杯等开始游戏回包才有，本模块不造。
 * 头像 id 就在 CmdRole.img 里，登录后即可查资源名显示。
 */
import { sys } from 'cc';
import { CacheMgr } from '../net/CacheMgr';
import { toIdString } from '../net/RequestGuard';
import { applyHeadArt } from '../HeadArtModel';
import type { MatchProfileLookup } from '../battle/BattleStartModel';
import { LOCAL_PLAYER } from './MatchPool';
import type { MatchPlayerData } from './MatchTypes';

/** 本机身份。name 允许为空。 */
export interface SelfIdentity {
    readonly roleId: string;
    readonly name: string;
    /** 头像 id（head 表 resId，不是资源名）。空串 = 无此列。 */
    readonly avatarId: string;
}

const LOGIN_SESSION_KEY = 'login_session';

/** 从 CmdRole 缓存取本机行。 */
function readFromRoleCache(): SelfIdentity | null {
    let rows: readonly CmdRole[] = [];
    try {
        rows = CacheMgr.instance.getTlCmdRole() ?? [];
    } catch (error) {
        console.warn('[MatchSelfProfile] CmdRole 缓存不可用，退回登录会话', error);
        return null;
    }
    for (const row of rows) {
        if (!row) continue;
        const roleId = row.id == null ? '' : String(row.id);
        if (!roleId) continue;
        return {
            roleId,
            name: typeof row.name === 'string' ? row.name : '',
            avatarId: toIdString(row.img),
        };
    }
    return null;
}

/** 从登录会话取 roleId（会话里只有身份）。 */
function readFromLoginSession(): SelfIdentity | null {
    try {
        const raw = sys.localStorage.getItem(LOGIN_SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw) as { roleId?: unknown };
        const roleId = session && session.roleId != null ? String(session.roleId) : '';
        return roleId ? { roleId, name: '', avatarId: '' } : null;
    } catch (error) {
        console.warn('[MatchSelfProfile] 登录会话解析失败', error);
        return null;
    }
}

/** 读本机身份。每次重读缓存（CmdRole 登录后才落地，缓存空值会被钉死）。 */
export function readSelfIdentity(): SelfIdentity | null {
    return readFromRoleCache() ?? readFromLoginSession();
}

/**
 * 我方信息条起始数据：本地占位 + 本机昵称 + 本机头像。
 * 昵称、头像各自独立覆盖；战力等保留本地值等回包。
 */
export function buildSelfPlayerData(
    identity: SelfIdentity | null = readSelfIdentity(),
    lookup?: MatchProfileLookup | null,
): MatchPlayerData {
    // 返回副本：LOCAL_PLAYER 是共享常量，就地改写会污染下次匹配。
    if (!identity) return { ...LOCAL_PLAYER };
    const next: MatchPlayerData = { ...LOCAL_PLAYER };
    if (identity.name) next.name = identity.name;
    // 头像连根目录一起换，查不到保留占位图。
    applyHeadArt(next, identity.avatarId, lookup?.headArt);
    return next;
}
