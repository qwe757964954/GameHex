import { hexGridNeighborIds } from '../hex/HexGridLayout';

export interface ITerritoryRandomCellOpenInput {
    readonly cellId: number;
    readonly rows: number;
    readonly columns: number;
    readonly candidateCells: readonly number[];
    /** 已通关或已解锁的格子；服务端 unlockCells 中的固定资源点也能作为前置。 */
    readonly openedCells: readonly number[];
    readonly silver: number;
    readonly stamina: number;
    readonly silverCost: number;
    readonly staminaCost: number;
}

export type TerritoryRandomCellOpenCheck =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: 'notCandidate' | 'alreadyOpen' | 'needsNeighbor' | 'silver' | 'stamina' };

/** 候选格的本地开启预览；最终能否解锁仍以服务端回包为准。 */
export function canOpenTerritoryRandomCell(input: ITerritoryRandomCellOpenInput): TerritoryRandomCellOpenCheck {
    const { cellId, rows, columns } = input;
    if (!Number.isInteger(cellId) || cellId < 0 || cellId >= rows * columns
        || !input.candidateCells.includes(cellId)) return { ok: false, reason: 'notCandidate' };
    const opened = new Set(input.openedCells);
    if (opened.has(cellId)) return { ok: false, reason: 'alreadyOpen' };
    if (!hexGridNeighborIds(cellId, rows, columns).some((neighbor) => opened.has(neighbor))) {
        return { ok: false, reason: 'needsNeighbor' };
    }
    if (!Number.isFinite(input.silver) || input.silver < input.silverCost) {
        return { ok: false, reason: 'silver' };
    }
    if (!Number.isFinite(input.stamina) || input.stamina < input.staminaCost) {
        return { ok: false, reason: 'stamina' };
    }
    return { ok: true };
}

export interface ITerritoryRandomResourceSelection {
    readonly rows: number;
    readonly columns: number;
    readonly candidateCells: readonly number[];
    readonly occupiedCells: readonly number[];
    readonly blockedCells: readonly number[];
    readonly activeCells: readonly number[];
    readonly claimedCells: readonly number[];
    /** 默认生成优先选择已占领领地的相邻格；无相邻候选时退回全部空候选格。 */
    readonly ownedCells?: readonly number[];
    readonly maxActive: number;
}

/** Draw is a non-negative integer supplied by the authority; sorting makes input order irrelevant. */
export function selectTerritoryRandomResourceCell(
    input: ITerritoryRandomResourceSelection,
    draw: number,
): number | null {
    if (!Number.isSafeInteger(draw) || draw < 0) throw new RangeError('draw must be a non-negative safe integer');
    if (!Number.isInteger(input.rows) || !Number.isInteger(input.columns)
        || input.rows <= 0 || input.columns <= 0
        || !Number.isInteger(input.maxActive) || input.maxActive < 1) {
        throw new RangeError('invalid territory random resource dimensions or maxActive');
    }
    if (input.activeCells.length >= input.maxActive) return null;
    const excluded = new Set([
        ...input.occupiedCells,
        ...input.blockedCells,
        ...input.activeCells,
        ...input.claimedCells,
    ]);
    const total = input.rows * input.columns;
    const eligible = Array.from(new Set(input.candidateCells))
        .filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < total && !excluded.has(cell))
        .sort((a, b) => a - b);
    const owned = new Set(input.ownedCells ?? []);
    const adjacent = owned.size ? eligible.filter((cell) =>
        hexGridNeighborIds(cell, input.rows, input.columns).some((neighbor) => owned.has(neighbor))) : [];
    const pool = adjacent.length ? adjacent : eligible;
    return pool.length ? pool[draw % pool.length] : null;
}

export function canClaimTerritoryRandomResource(
    cellId: number,
    activeCells: readonly number[],
    ownedCells: readonly number[],
    dimensions: Readonly<{ rows: number; columns: number }>,
): boolean {
    if (!activeCells.includes(cellId) || ownedCells.includes(cellId)) return false;
    const owned = new Set(ownedCells);
    return hexGridNeighborIds(cellId, dimensions.rows, dimensions.columns)
        .some((neighbor) => owned.has(neighbor));
}

export interface ITerritoryRandomResourceState {
    readonly activeCells: readonly number[];
    readonly claimedCells: readonly number[];
}

export type ITerritoryRandomResourceClaim = ITerritoryRandomResourceState & {
    readonly ok: boolean;
};

/** Apply only after the reward grant succeeds; callers commit grant and state together. */
export function claimTerritoryRandomResource(
    cellId: number,
    state: ITerritoryRandomResourceState,
    ownedCells: readonly number[],
    dimensions: Readonly<{ rows: number; columns: number }>,
): ITerritoryRandomResourceClaim {
    if (state.claimedCells.includes(cellId)
        || !canClaimTerritoryRandomResource(cellId, state.activeCells, ownedCells, dimensions)) {
        return { ok: false, activeCells: [...state.activeCells], claimedCells: [...state.claimedCells] };
    }
    return {
        ok: true,
        activeCells: state.activeCells.filter((activeCell) => activeCell !== cellId),
        claimedCells: [...state.claimedCells, cellId].sort((a, b) => a - b),
    };
}
