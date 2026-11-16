/** 任务展示分组：可领取置顶、进行中居中、已领取沉底。 */
export type TaskPhase = 'claimable' | 'taken' | 'undone' | 'goto';

export function taskPhaseRank(phase: TaskPhase): number {
    if (phase === 'claimable') return 0;
    if (phase === 'taken') return 2;
    return 1;
}
