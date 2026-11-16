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
 * 选对手：真人局先比战力差再比胜负场差，PVE 只从关卡配好的机器人里挑。
 * 排序是确定性的，服务端给了候选池也能直接复用。
*/
export function selectZCOpponent(
    player: ZCMatchProfile,
    candidates: readonly ZCMatchProfile[],
    mode: ZCMatchMode,
): ZCMatchProfile | null {
    const pool = candidates.filter((candidate) =>
        candidate.id !== player.id && (mode === 'pve' ? candidate.isBot : !candidate.isBot));
    if (!pool.length) return null;

    if (mode === 'pve') {
        return pool.sort((a, b) =>
            (a.fixedPriority || 0) - (b.fixedPriority || 0) || a.id.localeCompare(b.id))[0];
    }

    return pool.sort((a, b) => {
        const powerGap = Math.abs(a.power - player.power) - Math.abs(b.power - player.power);
        if (powerGap !== 0) return powerGap;
        const recordGap = Math.abs(winBalance(a) - winBalance(player)) - Math.abs(winBalance(b) - winBalance(player));
        return recordGap || a.id.localeCompare(b.id);
    })[0];
}
