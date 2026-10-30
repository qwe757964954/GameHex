# BigMap UI Prefab Migration

> Execute inline with superpowers:executing-plans. Preserve the existing dirty workspace; no commits requested.

**Goal:** bigmap/view no longer creates UI nodes or adds UI components at runtime.

**Architecture:** AssetService/ResourceScope loads an editable page prefab. Serialized component references bind the page, buttons, build rows and base plots. Only repeated rows/plots are instantiated from templates. Geometry rendering and responsive positioning remain code responsibilities.

**Tech Stack:** Cocos Creator 3.8, TypeScript, tsx tests, Cocos MCP.

- [x] Add migration guards and verify they fail on current runtime builders.
- [x] Create editable page prefab with mandatory Inspector references and repeated item templates; replace builders and remove unused factories.
- [x] Adapt lifecycle/render regression fixtures, run focused tests, refresh and validate assets through Cocos MCP.
- [x] Fresh final review, resolve actionable findings and document results.

Ruling: retain Graphics only for geometry and existing panel styling, with components preattached in the prefab. An editor-visible panel component stores its style in Inspector; it never creates nodes or components.


Review: independent reviewer found a short-screen loading-label position omission and a build-row redraw on the empty-plot menu path. Both reproduced by regression assertions, then fixed. All current UI instances use serialized component references; Cocos engine recognized the bindings and executed the 390×900 layout without errors. Probe nodes were removed without saving or changing the user's scene asset.

Verification: see docs/bigmap-系统实现说明.md §5.14. Full TypeScript checking remains blocked by existing repository/engine diagnostics; no bigmap/view diagnostics were reported. Existing headquarters artwork hash mismatch remains unrelated and unchanged.

Final suite: 407 tests, 406 passed; sole failure is the existing sprites/headquarters.png manifest hash mismatch. Focused binding/style checks also pass after preserving original fallback button text colors. No commits made.
