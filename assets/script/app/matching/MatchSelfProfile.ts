/** 身份优先读 CmdRole，登录会话仅兜底 roleId；战斗数值等待服务端回包。 */
import { sys } from 'cc';
import { CacheMgr } from '../net/CacheMgr';
import { toIdString } from '../net/RequestGuard';
import { applyHeadArt } from '../HeadArtModel';
import type { MatchProfileLookup } from '../battle/BattleStartModel';
import { LOCAL_PLAYER } from './MatchPool';
import type { MatchPlayerData } from './MatchTypes';

export interface SelfIdentity {
    readonly roleId: string;
    readonly name: string;
    /** head 表中的头像 id，非资源名。 */
    readonly avatarId: string;
}

const LOGIN_SESSION_KEY = 'login_session';

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

/** 不缓存空身份，避免登录数据稍后到达时仍读不到。 */
export function readSelfIdentity(): SelfIdentity | null {
    return readFromRoleCache() ?? readFromLoginSession();
}

/** 返回独立展示副本，昵称与头像分别覆盖。 */
export function buildSelfPlayerData(
    identity: SelfIdentity | null = readSelfIdentity(),
    lookup?: MatchProfileLookup | null,
): MatchPlayerData {
    const next: MatchPlayerData = { ...LOCAL_PLAYER, stats: [] };
    if (!identity) return next;
    if (identity.name) next.name = identity.name;
    applyHeadArt(next, identity.avatarId, lookup?.headArt);
    return next;
}
