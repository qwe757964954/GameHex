export type ZCMatchMode = 'ranked' | 'casual' | 'pve';

export interface ZCMatchProfile {
    id: string;
    power: number;
    wins: number;
    losses: number;
    isBot?: boolean;
    fixedPriority?: number;
}

function winBalance(profile: ZCMatchProfile): number {
    return profile.wins - profile.losses;
}

/**
 * 真人匹配依次比较战力差、胜负场差；PVE 只选择关卡配置指定的机器人。
 * 服务端返回候选池后可直接复用这一确定性排序。
 */
export function selectZCOpponent(
    player: ZCMatchProfile,
    candidates: readonly ZCMatchProfile[],
    mode: ZCMatchMode,
): ZCMatchProfile | null {
    const eligible = candidates.filter((candidate) => candidate.id !== player.id && (mode === 'pve' ? candidate.isBot : !candidate.isBot));
    if (!eligible.length) return null;
    if (mode === 'pve') {
        return [...eligible].sort((a, b) => (a.fixedPriority || 0) - (b.fixedPriority || 0) || a.id.localeCompare(b.id))[0];
    }
    return [...eligible].sort((a, b) => {
        const powerGap = Math.abs(a.power - player.power) - Math.abs(b.power - player.power);
        if (powerGap !== 0) return powerGap;
        const recordGap = Math.abs(winBalance(a) - winBalance(player)) - Math.abs(winBalance(b) - winBalance(player));
        return recordGap || a.id.localeCompare(b.id);
    })[0];
}
