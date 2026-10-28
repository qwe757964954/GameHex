import type { ZCSnapshot, ZCHexState } from '../ZCGameTypes';
import type { ZCMatchMap } from '../ZCMatchConfig';
import type { ZCOwner } from '../ZCMapConfig';

/** 地块状态与城墙暴露规则。 */
export class ZCTileSystem {
    static refresh(state: ZCSnapshot, map: ZCMatchMap): void {
        for (const hex of state.hexes) {
            if (hex.building !== 'none' && hex.hp > 0) {
                hex.state = 'developed';
                continue;
            }
            if (hex.developmentResolved) {
                hex.state = 'developed';
                continue;
            }
            if (hex.state === 'ruins') continue;
            if (hex.owner === 'neutral') {
                // 中立格只记粗粒度事实：相邻任一方有锚点即 developable；具体哪一方能开发由 canDevelopFor() 按本方复核。
                hex.state = this.hasAdjacentAnchor(state, map, hex.id) ? 'developable' : 'occupiable';
                continue;
            }
            hex.state = this.hasAdjacentDeveloped(state, map, hex.id, hex.owner) ? 'developable' : 'occupied';
        }
    }

    /**
     * 某一方现在能不能开发这一格。
     * - 己方格：state 为 developable 即可（状态本来就按本方锚点算）；
     * - 中立格：必须按 owner 复核锚点 —— state 的 developable 只表示「某一方可开发」，
     *   不复核会让敌方建筑旁的中立格我方也能买。开发即宣告归属（见 `ZCGameModel.developFor`）。
     *
     * 中立资源格（宝箱 / 金矿 / 金币）走「相邻自动领取」（`claimAdjacentNeutralResources`），
     * 不花钱开发、不可点；已领走的 `neutralResourceId` 被清空，由下面的 `developmentResolved` 自然排除。
     */
    static canDevelopFor(
        state: ZCSnapshot, map: ZCMatchMap, hexId: number, owner: ZCOwner,
    ): boolean {
        const hex = state.hexes[hexId];
        const config = map.hexes[hexId];
        // 虚空格没有邻居、也没有地块类型，永远不可开发（它连 state 都是 occupiable）。
        if (!hex || !config?.playable) return false;
        if (hex.neutralResourceId) return false;
        // 废墟是建筑被摧毁后的永久状态，不可重建。
        if (hex.state === 'ruins' || hex.developmentResolved || hex.building !== 'none') return false;
        if (hex.owner === owner) return hex.state === 'developable';
        if (hex.owner !== 'neutral' || hex.state !== 'developable') return false;
        return this.hasAdjacentDeveloped(state, map, hexId, owner);
    }

    private static hasAdjacentDeveloped(state: ZCSnapshot, map: ZCMatchMap, hexId: number, owner: ZCOwner): boolean {
        return map.hexes[hexId].neighbors.some((neighborId) => {
            const neighbor = state.hexes[neighborId];
            return neighbor.owner === owner && this.isDevelopedAnchor(neighbor);
        });
    }

    /** 中立格用：**任一方**的已开发锚点都算点亮（粗粒度，精确到方见 canDevelopFor）。 */
    private static hasAdjacentAnchor(state: ZCSnapshot, map: ZCMatchMap, hexId: number): boolean {
        return map.hexes[hexId].neighbors.some((neighborId) => {
            const neighbor = state.hexes[neighborId];
            return neighbor.owner !== 'neutral' && this.isDevelopedAnchor(neighbor);
        });
    }

    /**
     * 只有已完成开发的地块或存活建筑才提供锚点；废墟只保留归属，不解锁周边。
     * 只读标志位，单趟遍历中判定与迭代顺序无关 —— 不要依赖同趟刚算出的 state。
     */
    private static isDevelopedAnchor(neighbor: ZCHexState): boolean {
        return neighbor.developmentResolved
            || (neighbor.building !== 'none' && neighbor.hp > 0);
    }

    static hasExposedWall(state: ZCSnapshot, map: ZCMatchMap, hex: ZCHexState): boolean {
        if (hex.owner === 'neutral' || hex.wallHp <= 0
            || (!hex.developmentResolved && hex.building === 'none')) return false;
        const neighbors = map.hexes[hex.id].neighbors;
        if (neighbors.length < 6) return true;
        return neighbors.some((neighborId) => {
            const neighbor = state.hexes[neighborId];
            return neighbor.owner !== hex.owner
                || (!neighbor.developmentResolved && neighbor.building === 'none');
        });
    }

}
