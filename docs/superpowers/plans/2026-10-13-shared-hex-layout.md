# Shared Hex Layout Implementation Plan

> **For agentic workers:** Execute these tasks in order with test driven development. This session uses inline execution.

**Goal:** Make territory and battle consume one pure TypeScript contract for hex positions, map bounds, and tile paint order.

**Architecture:** `core/hex/HexGridLayout.ts` owns geometry. Territory and battle keep their own views, resources, state, and node lifecycles. Battle retains rounded logical coordinates for old snapshots and applies their uniform origin offset when consuming shared view positions.

**Tech Stack:** Cocos Creator 3.8, TypeScript, Node test runner via `tsx`.

**Spec:** Approved design in the conversation of 2026-10-13.

## Global Constraints

- `core/**` stays free of `cc`, I/O, and feature imports.
- Board layers remain declared in `ZCGameBoard.prefab`; this change does not modify Prefabs.
- Preserve unrelated workspace content. The repository currently reports these source files as untracked.

## Review Focus

- Empty dimensions return an empty, finite layout.
- Paint order puts smaller screen `y` above larger `y`, with stable `x` ordering for ties.
- Battle playable holes retain full-map bounds but create no tile node.
- Territory changes chapter dimensions without keeping stale nodes.
- Battle logical and view coordinates agree with shared grid positions.
- Old battle snapshots retain the established integer logical coordinate system.

---

### Task 1: Shared grid contract

**Files:** `assets/script/core/hex/HexGridLayout.ts`, `tests/hex-grid-layout.test.ts`

**Interfaces:** `buildHexGridLayout(rows, columns): IHexGridLayout`, containing `points`, `width`, `height`, and `paintOrder`.

- [x] Add failing tests for bounds, paint order, and empty dimensions; run targeted tests.
- [x] Implement pure layout builder and run targeted tests.

### Task 2: Feature adapters and coordinate alignment

**Files:** `assets/script/app/territory/model/TerritoryMapLayout.ts`, `assets/script/app/territory/view/TerritoryMapView.ts`, `assets/script/app/zcds/model/ZCMapConfig.ts`, `assets/script/app/zcds/view/ZCGameRenderWorld.ts`, `assets/script/app/zcds/view/ZCGameViewUtil.ts`, `tests/territory-map-layout.test.ts`, `tests/zcds-progress.test.ts`

**Interfaces:** Both feature views consume shared positions and `paintOrder`; battle model's rounded logical point differs only by a uniform origin offset.

- [x] Add cross-feature alignment tests and verify the existing implementation fails them.
- [x] Replace duplicated geometry in feature adapters while preserving resource and node ownership.
- [x] Run targeted tests, then the full project test suite and type check. Targeted tests and pure TypeScript checks pass. Final full `npm.cmd test`: 2458 pass, 102 fail across project suites; full project `tsc` is also blocked by engine and generated declarations.
