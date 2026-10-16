# ZCDS Render and View Boundaries Implementation Plan

> **For agentic workers:** Execute inline in this session. Preserve the feature's pure model and Cocos view boundary.

**Goal:** Make battle rendering consume a read-only projection and explicit presentation events, clarify battle phases, and split cohesive rendering responsibilities without changing gameplay or prefab bindings.

**Architecture:** `ZCGameModel` remains the pure simulation owner and produces an immutable render projection plus an explicit drain for one-shot presentation events. `ZCGame` remains the Cocos composition root, but delegates phase transitions to a small pure controller. Rendering responsibilities are extracted behind feature-specific collaborators with explicit dependencies; no parent component is passed as a service locator.

**Tech Stack:** Cocos Creator 3.8, TypeScript, Node `tsx --test`.

**Spec:** `docs/AI架构与代码规范.md` §§2.1, 3.2, 4.1, 4.3, 4.6.

## Global Constraints

- `model/**` remains pure TypeScript and does not import Cocos, app view, platform, or framework modules.
- Render code consumes read-only DTOs; one-shot events are drained at an explicit orchestration boundary.
- `ZCGame` remains the battle composition root; no generic manager or whole-parent dependency is introduced.
- Do not change prefab, scene, meta, serialized component fields, or gameplay timing as part of the extraction.
- Add regression tests before each behavior or interface change; preserve existing battle behavior.

## Review Focus

- Frames with no completed 0.05-second model step still render the same snapshot and interpolation progress.
- Building-shake events are consumed exactly once even when static and dynamic rendering are called separately.
- Spawn-selection maps and fixed-map battles render from the same explicit map source.
- Victory and retreat paths still complete cleanup and settlement exactly once.
- Reused pooled hex views reset all animation and presentation state before rendering a new frame.

---

### Task 1: Read-only render frame and presentation event handoff

**Files:**
- Modify: `assets/script/app/zcds/model/ZCGameModel.ts`
- Create: `assets/script/app/zcds/model/ZCGameRenderFrame.ts`
- Modify: `assets/script/app/zcds/view/ZCGameRenderWorld.ts`
- Modify: `assets/script/app/zcds/ZCGame.ts`
- Test: `tests/zcds-model.test.ts`, `tests/zcds-render-performance.test.ts`

**Interfaces:**
- Produces `ZCGameRenderFrame`: immutable snapshot, map, active owners, per-hex render facts, unit definitions, and time-based presentation collections.
- Produces `ZCBattlePresentationEvents`: one-shot building-shake events drained once by `ZCGame` and passed to `renderDynamic`.
- `ZCGameRenderWorld.renderStatic(frame)` and `renderDynamic(frame, events)` no longer receive `ZCGameModel`.

- [x] Add tests proving frame projection values match model query values and event draining is take-once.
- [x] Run the new test and confirm it fails before implementation.
- [x] Implement the frame DTO and explicit drain boundary.
- [x] Convert renderer call sites and remove model dependencies from `ZCGameRenderWorld`.
- [x] Run the render-frame test and relevant renderer/model regressions.

### Task 2: Explicit battle phase controller

**Files:**
- Create: `assets/script/app/zcds/application/ZCBattlePhaseController.ts`
- Modify: `assets/script/app/zcds/ZCGame.ts`
- Test: `tests/zcds-battle-phase.test.ts`

**Interfaces:**
- Phases: `spawn-selection`, `playing`, `settlement-presentation`, `settlement`, `leaving`.
- Transitions are explicit and idempotent; only `ZCGame` performs Cocos side effects in response.

- [x] Add transition tests for fixed-map entry, selected-spawn completion, outcome, retreat, duplicate shutdown.
- [x] Run tests red before implementing the controller.
- [x] Replace overlapping lifecycle booleans where the phase state fully represents them; keep the one-shot component initialization guard.
- [x] Run phase and game lifecycle regressions.

### Task 3: Extract focused render collaborators

**Files:**
- Create: feature-local renderer files under `assets/script/app/zcds/view/` for board/static hex rendering and transient presentation rendering.
- Modify: `assets/script/app/zcds/view/ZCGameRenderWorld.ts`
- Modify: `assets/script/app/zcds/view/ZCHexView.ts`
- Test: existing focused ZCDS render tests plus new collaborator tests where behavior moves.

**Interfaces:**
- Collaborators receive explicit Cocos layers, maps, and view registries needed for their work; they do not receive `ZCGame` or the full `ZCGameRenderWorld`.
- `ZCHexView` remains the prefab-bound component and delegates pure animation progression or cohesive rendering work without changing Inspector properties.

- [x] Add/adjust characterization tests for the responsibilities being extracted.
- [x] Extract unit interpolation into a focused collaborator, preserving prefab bindings and reusing scratch state.
- [x] Make map initialization require an explicit map and remove the renderer's hidden global-map fallback.
- [x] Run targeted render tests and the broader relevant ZCDS suite.

## Completion Checks

- `ZCGameRenderWorld` has no `ZCGameModel` import or method calls.
- Model code remains Cocos-free.
- Existing snapshot, deterministic simulation, spawn-selection, victory/settlement, and render lifecycle tests pass.
- TypeScript transpilation diagnostics are clear for changed modules; report any project-wide compiler gate that is blocked by existing generated declarations.
