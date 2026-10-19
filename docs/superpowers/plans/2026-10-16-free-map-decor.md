# Free Map Decor Implementation Plan

> **For agentic workers:** Execute inline with TDD; keep the user's existing workspace changes intact.

**Goal:** Add freely positioned, non-blocking map decorations with editor placement and transform controls.

**Architecture:** Store every decoration in `art.freeDecor` with map-local x/y, width/height, rotation, and flips. The editor owns placement and selection state; `ZCMapConfig` validates the optional data boundary; `ZCGameViewUtil` converts entries to sprite placements; `ZCGameRenderWorld` installs them in the existing DecorLayer.

**Tech Stack:** Cocos Creator 3.8, TypeScript, SVG map editor, Node test runner with tsx.

**Spec:** Conversation design on 2026-10-16: free placement independent of void cells; direct canvas selection/move; optional grid snap; numeric transform controls; duplicate/delete/lock; warning overlays for important gameplay areas; one sprite per decoration with atlas-backed assets.

## Global Constraints

- Ignore legacy `art.tiles` row/column decoration keys; old maps are rearranged in the editor.
- Free decorations are visual only and never affect movement, building, or territory rules.
- Map coordinates are board-local and remain stable under editor zoom/pan.
- Keep `ZCGameBoard.prefab` layer declarations unchanged; render through the existing `DecorLayer`.
- Do not overwrite unrelated user modifications.

## Review Focus

- Maps without `art.freeDecor` load with no scene decorations.
- Malformed free-decor entries are ignored at the config/render boundary.
- Move/transform actions are undoable and preserve stable IDs.
- Optional snapping uses board-local coordinates and does not impose void-cell constraints.
- Mirroring and map resize do not silently move or delete free placements.

---

### Task 1: Free decor data contract and runtime placement

**Files:**
- Modify: `assets/script/app/zcds/model/ZCMapConfig.ts`
- Modify: `assets/script/app/zcds/view/ZCGameViewUtil.ts`
- Modify: `assets/script/app/zcds/ZCGame.ts`
- Modify: `assets/script/app/zcds/view/ZCGameRenderWorld.ts`
- Test: `tests/zcds-decor.test.ts`

**Interfaces:** `ZCMapArt.freeDecor?: readonly ZCMapFreeDecor[]`; placement builder accepts optional free-decor entries and appends valid map-local placements. Render placements carry rotation and flip flags.

- [x] Add failing tests for a free decoration on a playable tile, transform propagation, and malformed-entry rejection.
- [x] Run `npx tsx --test tests/zcds-decor.test.ts` and confirm the expected failures.
- [x] Add the data type, placement conversion, and renderer transform application.
- [x] Run the focused decor test and `npm run check:zcds`.

### Task 2: Editor interactions and persistence

**Files:**
- Modify: `tools/map-editor/app.js`
- Modify: `tools/map-editor/index.html`
- Test: `tests/map-editor.test.ts`

**Interfaces:** Expose testable editor methods for creating, selecting, moving, transforming, duplicating, deleting, and locking free decor; serialize to `art.freeDecor`.

- [x] Add failing tests for free placement on a non-void cell, snapshot/undo, duplication/deletion, locking, and serialization.
- [x] Run `npx tsx --test tests/map-editor.test.ts` and confirm the expected failures.
- [x] Add a free-decor tool, canvas preview/selection/drag, inspector controls, optional snapping, and undoable edits.
- [x] Run the focused editor test and available editor checks.

### Task 3: Regression and documentation

**Files:**
- Modify: `tests/zcds-decor.test.ts`
- Modify: `tests/map-editor.test.ts`
- Modify: `docs/AI架构与代码规范.md` (map editor decor data note, if required)

- [x] Run the full test suite and TypeScript checks relevant to changed code.
- [x] Review the diff for unrelated changes and report remaining risks.
