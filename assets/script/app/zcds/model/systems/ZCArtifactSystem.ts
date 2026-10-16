import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';

export interface ZCArtifactState {
    artifactReadyUses: number;
    artifactCharge: number;
    artifactCooldown: number;
    enemyFrozenSeconds: number;
}

export type ZCArtifactActivation =
    | { ok: true }
    | { ok: false; reason: 'cooldown' | 'not-ready' };

/** 神器充能、存储、冷却和激活状态机；伤害目标由模型编排层提供。 */
export class ZCArtifactSystem {
    static normalize(state: ZCArtifactState, rules: Readonly<ZCRuntimeRules>): void {
        state.artifactReadyUses = Number.isFinite(state.artifactReadyUses)
            ? Math.max(0, Math.min(rules.artifactMaxStored, Math.floor(state.artifactReadyUses)))
            : 0;
        state.artifactCharge = Number.isFinite(state.artifactCharge)
            ? Math.max(0, state.artifactCharge)
            : 0;
        while (state.artifactCharge >= rules.artifactChargeFull
            && state.artifactReadyUses < rules.artifactMaxStored) {
            state.artifactReadyUses += 1;
            state.artifactCharge -= rules.artifactChargeFull;
        }
        if (state.artifactReadyUses >= rules.artifactMaxStored) state.artifactCharge = 0;
        state.artifactCharge = Math.min(state.artifactCharge, rules.artifactChargeFull);
        state.artifactCooldown = Number.isFinite(state.artifactCooldown)
            ? Math.max(0, Math.min(state.artifactCooldown, rules.artifactCooldownSeconds))
            : 0;
        state.enemyFrozenSeconds = Number.isFinite(state.enemyFrozenSeconds)
            ? Math.max(0, state.enemyFrozenSeconds)
            : 0;
    }

    static chargeFromDevelopment(state: ZCArtifactState, rules: Readonly<ZCRuntimeRules>): void {
        if (state.artifactReadyUses >= rules.artifactMaxStored) {
            state.artifactCharge = 0;
            return;
        }
        state.artifactCharge += rules.artifactChargePerDevelopment;
        if (state.artifactCharge < rules.artifactChargeFull) return;
        state.artifactReadyUses = Math.min(rules.artifactMaxStored, state.artifactReadyUses + 1);
        state.artifactCharge = 0;
    }

    static activate(state: ZCArtifactState, rules: Readonly<ZCRuntimeRules>): ZCArtifactActivation {
        if (state.artifactCooldown > 0) return { ok: false, reason: 'cooldown' };
        if (state.artifactReadyUses <= 0) return { ok: false, reason: 'not-ready' };
        state.artifactReadyUses -= 1;
        state.artifactCooldown = rules.artifactCooldownSeconds;
        state.enemyFrozenSeconds = rules.artifactFreezeSeconds;
        return { ok: true };
    }

    static tick(state: ZCArtifactState, deltaSeconds: number): void {
        state.artifactCooldown = Math.max(0, state.artifactCooldown - deltaSeconds);
        state.enemyFrozenSeconds = Math.max(0, state.enemyFrozenSeconds - deltaSeconds);
    }
}
