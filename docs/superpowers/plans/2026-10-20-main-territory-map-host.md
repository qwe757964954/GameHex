# 主城内嵌领地地图归属调整实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move the main-city map page host and its Prefab into `main`, remove the duplicate territory HUD, and keep territory rules and map feature views in `territory`.

**Architecture:** `MainTabHost` injects `AssetService` into `MainTerritoryMap` before activation. The moved host continues to compose `TerritoryPresenter`, `TerritoryMapView`, station views and detail UI from `app/territory`. The main-only Prefab contains the map viewport and map layers; it has no `HudLayer` or `TerritoryHeaderView` component.

**Tech Stack:** Cocos Creator 3.8, TypeScript, Cocos MCP, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-main-territory-map-host-design.md`

## Global Constraints

- Keep `TerritoryPresenter`, map/station/detail views, resource loaders, map layout and rules under `app/territory/**`.
- Inject `AssetService` before `setParent` activates the page component.
- Keep map child render order, `ScrollView` clipping, `cellId` reuse, station click handling and detail flow unchanged.
- Modify Prefabs only through Cocos MCP; move assets through Cocos asset operations; do not hand-edit Prefab JSON or `.meta`.
- Preserve all unrelated user modifications in the dirty shared workspace.

## Review Focus

- Main page activation must inject assets before the moved component's `onLoad` and still start the Presenter.
- ArenaRoot's nested map Prefab reference must remain valid after the asset move.
- Removing the HUD must not remove any map layers, station/detail references, or alter render order.
- A station click must still open details and navigate to the existing PVE route.
- Territory map-only rendering must not dereference a removed `TerritoryHeaderView` or rely on HUD state.

---

### Task 1: Move the map-only host and Prefab into `main`

**Files:**
- Move: `assets/script/app/territory/view/TerritoryPage.ts` → `assets/script/app/main/MainTerritoryMap.ts`
- Move: `assets/resources/ui/territory/TerritoryPage.prefab` → `assets/resources/ui/main/MainTerritoryMap.prefab`
- Modify: `assets/script/app/main/MainTabHost.ts`
- Modify via Cocos MCP: `MainTerritoryMap.prefab`, `ArenaRoot.prefab`
- Test: `tests/territory-page-split.test.ts`, `tests/main-tab-adventure-route.test.ts`, `tests/territory-page-current-json.test.ts`, `tests/territory-presenter.test.ts`, `tests/territory-idle-reward.test.ts`, `tests/territory-resource-gain.test.ts`, `tests/territory-cell-protocol.test.ts`, `tests/component-destroy-off-guard.test.ts`

**Interfaces:**
- Produces `MainTerritoryMap extends Component` with `initialize(assets: AssetService): void`.
- `MainTabHost.showPage` locates `MainTerritoryMap` under the main page, calls `initialize` before `setParent`, and no longer calls `setHudVisible`.

- [x] **Step 1: Write failing ownership, map-only and injection assertions**
  - Update the split test to read `app/main/MainTerritoryMap.ts` and `ui/main/MainTerritoryMap.prefab`; require no HUD component or branch, while preserving the map viewport, layer order, map bindings and detail panel.
  - Update the route test to require `MainTerritoryMap` lookup and initialization before `setParent`.
  - Update territory source-contract tests to read the moved host path so they continue to exercise the same integration behavior.
- [x] **Step 2: Run focused tests and confirm failure on the old ownership/HUD shape**
  - Run: `npx.cmd tsx --test --test-name-pattern="TerritoryPage.prefab" tests/territory-page-split.test.ts`
  - Run: `npx.cmd tsx --test --test-name-pattern="challenge tab|领地格 = 主城页|PVE settlement" tests/main-tab-adventure-route.test.ts`
  - Expected: FAIL because the new host/Prefab paths and map-only contract do not exist yet.
- [x] **Step 3: Move the host script using Cocos asset operations**
  - Preserve the script asset UUID and update imports from its new `app/main` location.
  - Rename the class/decorator to `MainTerritoryMap`; retain the Presenter/map/detail lifecycle and remove HUD references, chapter event subscriptions and HUD rendering.
- [x] **Step 4: Move and edit the Prefab using Cocos MCP**
  - Move the asset through Cocos asset operations so the asset database owns the `.meta` and UUID.
  - Remove `HudLayer` and `TerritoryHeaderView` from the Prefab while preserving all map/detail nodes and bindings. Save and exit Prefab edit mode.
- [x] **Step 5: Update `MainTabHost` to inject before activation and refresh assets**
  - Find `MainTerritoryMap` under `ArenaRoot`, call `initialize(this.assets)` before `page.setParent`, and remove `setHudVisible` handling.
  - Refresh `db://assets/script/app/main` and `db://assets/resources/ui/main` through Cocos MCP.
- [x] **Step 6: Run focused tests and validate both Prefabs**
  - Run: `npx.cmd tsx --test tests/territory-page-split.test.ts`
  - Run: `npx.cmd tsx --test --test-name-pattern="challenge tab|领地格 = 主城页|PVE settlement" tests/main-tab-adventure-route.test.ts`
  - Validate `db://assets/resources/ui/main/MainTerritoryMap.prefab` and `db://assets/resources/ui/main/ArenaRoot.prefab` through Cocos MCP.

### Task 2: Remove obsolete header module and update territory ownership docs

**Files:**
- Delete if no remaining references: `assets/script/app/territory/view/TerritoryHeaderView.ts` and its `.meta`
- Modify: `docs/zcds-表现层与领地规范.md` §3.1
- Test: `tests/territory-page-split.test.ts`

- [x] **Step 1: Add a no-reference assertion for the obsolete header component**
- [x] **Step 2: Run the split test and confirm it fails while the header module remains referenced**
- [x] **Step 3: Delete the header component via Cocos asset operations if `rg` confirms no runtime consumers**
- [x] **Step 4: Update §3.1 to assign page host/Prefab to main and feature views/rules to territory**
- [x] **Step 5: Run `npx.cmd tsx --test tests/territory-page-split.test.ts` and confirm the new ownership contract passes**

### Task 3: Verify territory behavior and record completion

**Files:**
- Verify: moved main host, map Prefab, ArenaRoot reference and territory feature tests.

- [x] Run the required focused tests:
  - `npx.cmd tsx --test tests/territory-page-split.test.ts`
  - `npx.cmd tsx --test tests/territory-presenter.test.ts`
  - `npx.cmd tsx --test tests/territory-cell-center-align.test.ts`
  - `npx.cmd tsx --test tests/territory-hex-flip.test.ts`
  - `npx.cmd tsx --test tests/territory-building-shake.test.ts`
  - `npx.cmd tsx --test --test-name-pattern="challenge tab|领地格 = 主城页|PVE settlement" tests/main-tab-adventure-route.test.ts`
- [x] Refresh modified script/resource folders through Cocos MCP and revalidate the two Prefabs.
- [x] Inspect only the task diff and report any unrelated baseline failures without changing their files.
