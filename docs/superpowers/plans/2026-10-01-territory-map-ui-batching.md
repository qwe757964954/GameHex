# Territory Map UI Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make territory station rendering batch by visual channel instead of producing per-station Graphics and renderer switches.

**Architecture:** Keep `TerritoryStation.prefab` as the style and hit-test template. At runtime, `TerritoryStationView` reparents icon, caption background, caption text, and badge nodes into global layers owned by `TerritoryMapView`, preserves prefab offsets, and owns cleanup of detached nodes.

**Tech Stack:** Cocos Creator 3.8.8, TypeScript, node:test/tsx, Cocos MCP prefab editor.

**Spec:** `docs/superpowers/specs/2026-10-01-territory-map-ui-batching-design.md`

## Global Constraints

- Prefab and Inspector changes are performed through Cocos MCP and verified after save.
- Cocos component references remain required `null!` bindings; no `as any` or optional chaining hides binding failures.
- Rendering remains idempotent, and detached visual nodes are destroyed when a station is removed.
- UI geometry and offsets remain authored by Prefab, not hard-coded in TypeScript.
- Existing JSON-driven map layout and ScrollView behavior do not change.

## Review Focus

- Repeated initialization must not reparent nodes or register duplicate click callbacks.
- Removing or switching a site must not leak detached visual nodes.
- Start station has no click callback but follows the same visual layers.
- Missing icon and empty badge retain current visibility behavior.
- Chapter reload must preserve visual offsets and map positions after reuse.

---

### Task 1: Lock the optimized Prefab contract

**Files:**
- Modify: `tests/territory-page-split.test.ts`
- Modify: `tests/territory-page-current-json.test.ts`

**Interfaces:**
- Consumes: serialized Cocos Prefab JSON and script CIDs.
- Produces: failing contract tests for five station layers, `captionSprite`, Sprite caption background, and Label CHAR cache mode.

- [x] Write contract assertions for the five layers and updated station component bindings.
- [x] Run `npx.cmd tsx --test tests/territory-page-split.test.ts tests/territory-page-current-json.test.ts` and verify failure names the missing batching contract.

### Task 2: Implement station visual-channel ownership

**Files:**
- Modify: `assets/script/app/territory/view/TerritoryStationView.ts`
- Modify: `assets/script/app/territory/view/TerritoryMapView.ts`
- Create: `tests/territory-station-batching.test.ts`

**Interfaces:**
- Consumes: `ITerritoryStationLayers` containing `icon`, `caption`, `text`, `badge`, and `hit` Nodes.
- Produces: `initialize(layers, onClick?)`, `setMapPosition(x, y, z)`, `dispose()`, and idempotent `render()` using `captionSprite`.

- [x] Write a runtime test that loads the real view class with a minimal Cocos fixture and asserts one-time reparenting, preserved offsets, position synchronization, visibility, and idempotent cleanup.
- [x] Run the new test and verify it fails because the new interface is absent.
- [x] Replace per-station Graphics with Sprite coloring and implement visual-layer migration and cleanup.
- [x] Update map creation, movement, and removal to pass the layer bundle and call `dispose()`.
- [x] Run the runtime test and verify it passes.

### Task 3: Update Prefabs through Cocos MCP

**Files:**
- Modify through MCP: `assets/resources/ui/territory/TerritoryPage.prefab`
- Modify through MCP: `assets/resources/ui/territory/TerritoryStation.prefab`

**Interfaces:**
- Consumes: TypeScript component properties from Task 2.
- Produces: five MapLayer children and valid Inspector bindings; CaptionBg Sprite; CHAR labels.

- [x] Enter TerritoryStation prefab mode, replace CaptionBg Graphics with Sprite, configure SLICED mode and frame, set Label cache modes, and bind `captionSprite`.
- [x] Save, exit, and validate TerritoryStation prefab.
- [x] Enter TerritoryPage prefab mode, add/reuse five station layers, bind all TerritoryMapView layer properties, and preserve sibling render order.
- [x] Save and validate TerritoryPage prefab.
- [x] Run Task 1 contract tests and verify they pass.

### Task 4: Regression and runtime readiness

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-territory-map-ui-batching-design.md`

**Interfaces:**
- Consumes: optimized code and saved Prefabs.
- Produces: verified static contract and an explicit runtime profiling handoff.

- [x] Update the spec to record the approved MCP editing workflow.
- [x] Run `npx.cmd tsx --test tests/territory-page-split.test.ts tests/territory-page-current-json.test.ts tests/territory-station-batching.test.ts`.
- [x] Run `npx.cmd tsx --test tests/territory-*.test.ts` and report all pre-existing failures separately from new failures.
- [x] Validate all three territory Prefabs with Cocos MCP and inspect editor errors.
- [x] Record that Draw Call comparison still requires preview/native runtime because MCP performance stats are unavailable in edit mode.
