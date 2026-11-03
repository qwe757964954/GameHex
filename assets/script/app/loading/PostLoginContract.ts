export interface PostLoginIdentity { readonly roleId: string; readonly serverId: string; }
export const POST_LOGIN_ERROR_MESSAGE = '加载失败，请重新进入游戏';

function identityId(value: unknown): string | null {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    return typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value) ? value : null;
}
function identity(value: unknown): PostLoginIdentity | null {
    if (!value || typeof value !== 'object' || !('roleId' in value) || !('selectServerId' in value)) return null;
    const roleId = identityId(value.roleId), serverId = identityId(value.selectServerId);
    return roleId && serverId ? { roleId, serverId } : null;
}
/** 入口和缓存各自必须是完整身份，禁止跨来源拼接角色/服务器。 */
export function resolvePostLoginIdentity(params: unknown, saved: string | null): PostLoginIdentity | null {
    const fromEntry = params && typeof params === 'object' && 'session' in params ? identity(params.session) : null;
    if (fromEntry) return fromEntry;
    try { return saved ? identity(JSON.parse(saved)) : null; } catch { return null; }
}
export function normalizedProgress(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
/** 会话准备占剩余进度 70%，Main 首屏占 30%。 */
export function postLoginProgress(start: number, stage: 'session' | 'main', ratio: number): number {
    const initial = normalizedProgress(start), progress = normalizedProgress(ratio);
    return initial + (1 - initial) * (stage === 'session' ? progress * 0.7 : 0.7 + progress * 0.3);
}
