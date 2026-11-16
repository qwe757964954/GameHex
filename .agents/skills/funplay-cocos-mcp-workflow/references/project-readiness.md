# Project, import, and preview readiness

## Asset and script changes

- Resolve the exact AssetDB UUID or db:// URL. Refresh only the changed source assets; do not guess an extension or silently substitute another asset.
- Import is asynchronous. If exposed, use `check_asset_ready` with the exact target after refresh/import and before assigning the asset or attaching its script. A stable imported UUID/URL identity is not proof that the importer queue is empty, TypeScript compiled, or the preview loaded those bytes.
- `check_asset_ready` is a Full-profile read-only tool. Discover exposure with `get_tool_catalog`; do not change a custom allowlist without authorization. If unavailable, query exact asset info and report the narrower evidence instead of claiming full readiness.
- After TypeScript edits, run `run_script_diagnostics` and inspect import/preview errors. Its no-emit compiler result is separate from Creator's compilation and preview loading.
- A zero-wait readiness query is one observation, not stable readiness. Busy, missing, importing, timeout, unavailable, and unknown results are not success. Wait within a bounded budget or report the unresolved state; never repeat a mutation to obtain a cleaner response.
- Check APIs against the actual Creator version and loaded project components, not only a package.json declaration. Preserve existing dependencies and project conventions.

## Preview evidence

- Query `get_preview_mode` before choosing browser, editor Game View, or simulator. Browser `localUrl` is same-host; `networkUrl` is Creator's LAN address.
- `get_runtime_state`, pause, and resume address the editor Game View and its native toolbar. They do not inspect external browser/simulator runtime state. Edit-scene director counters and time scale are not Game View state.
- A listening MCP server, opened window, non-empty screenshot, current scene drawing, and correct business behavior are different claims. Verify only the layers relevant to the user's request and identify missing evidence.
- Use `capture_scene_screenshot` for editor Scene composition and Game/preview capture for game output. For real pointer testing, bind `simulate_mouse_click` or drag to the returned `captureId` with `coordinateSpace="image-pixels"`; use coordinates from that exact image.
- Recapture after a resize, zoom, reload, scene change, or stale-capture rejection. Do not scale coordinates from an unrelated/resized reference image yourself. Button event emission tests handlers but does not prove hit testing, clipping, focus, or occlusion.
- If an input reports an unknown outcome, inspect the resulting state before deciding on another action. Do not automatically resend it. Restore only temporary state owned by this task; preserve user changes.

## Persistence

- Prefer scene-process, prefab, and AssetDB tools for .scene/.prefab/.meta changes. A successful native message alone does not prove saved content or preserved UUID links.
- Reinspect the exact object and relevant serialized references, save only the requested changes, and reopen when persistence matters. Keep incomplete checks explicit.

Sources: [Creator messages](https://docs.cocos.com/creator/3.8/manual/en/editor/extension/messages.html) and [asset workflow](https://docs.cocos.com/creator/3.8/manual/en/asset/asset-workflow.html).
