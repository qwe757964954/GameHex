---
name: funplay-cocos-mcp-workflow
description: "Edit, inspect, validate, preview, and debug Cocos Creator projects through Funplay Cocos MCP. Use when working with scenes, nodes, prefabs, assets, TypeScript, logs, screenshots, preview behavior, runtime state, or MCP connectivity."
---

# Funplay Cocos MCP Workflow

## Instructions

## Operating Loop

1. Establish context.
   - Before writes, independently match the intended project to initialize.funplay.context; do not adopt whichever server answered. For old endpoints, reconnects, or frame-paced gestures, read [project identity and input](references/project-identity-and-input.md).
   - Read `cocos://project/context` or call `get_editor_state` before assuming the project, active scene, MCP URL, selection, visible windows, or tool profile.
   - Inspect the active scene with `get_scene_info` and `get_hierarchy`; use `get_selection`, `list_scenes`, `list_assets`, or `list_prefabs` when identity or ownership is unclear.
   - Treat user-provided node and asset names as hints. Resolve the real hierarchy path, node UUID, asset UUID, or `db://assets/...` URL before editing.
   - Call `get_tool_catalog` when a required tool may be hidden by the `core`, `full`, or custom exposure profile.
2. Choose the edit surface.
   - Edit TypeScript and ordinary project files with repository tools or the MCP file tools, then refresh the affected asset and run diagnostics.
   - Edit live scene nodes with focused scene/component tools or `execute_javascript` using `context="scene"`; save the scene when the change must persist.
   - Use `execute_javascript` with `context="editor"` for asset-db, Editor messages, project orchestration, and filesystem work that belongs in the editor process.
   - Inspect prefab ownership and references before mutation. Prefer focused prefab tools, or edit a verified linked instance and apply it back through the editor workflow.
   - Preserve an existing UI or gameplay prefab hierarchy and change only the necessary nodes, components, and serialized fields; do not rebuild the entire prefab unless explicitly requested.
3. Execute the smallest coherent change.
   - Prefer one guarded `execute_javascript` operation for tightly related editor work, but use focused tools when they provide clearer validation or safer arguments.
   - Keep JavaScript safety checks enabled unless the code and its paths were reviewed explicitly.
   - Null-check every scene, node, component, asset, and filesystem lookup. Return concise structured before/after values, including stable UUIDs or asset URLs where useful.
   - Save or refresh only the assets and scenes intentionally changed.
   - Do not guess alternate paths, silently create replacement objects, or run self-healing fallback loops after a missing reference or unsupported editor message.
4. Read back and validate.
   - Re-inspect the exact node, component, prefab instance, or asset after mutation; a successful command response alone is not proof of the final editor state.
   - Run `run_script_diagnostics` or `get_script_diagnostic_context` after TypeScript changes, then use `validate_scene` and project logs before claiming success.
   - For visual or runtime work, run the appropriate browser, Game View, or simulator preview and verify with runtime state, input, logs, and screenshots.
   - State exactly what was verified and what still requires a native build, device, network, store, or manual check.

## Scene, Prefab, and Asset Safety

- Do not treat Cocos `.scene`, `.prefab`, or `.meta` files as ordinary text. Prefer scene-process, prefab, and asset-db operations that preserve UUID references and editor import state.
- If `edit_prefab_json` is used, target a verified prefab path and the smallest exact JSON path or literal replacement, then run `validate_prefab_references` and inspect the result.
- Before structural prefab work, call `inspect_prefab`; for scene instances, call `inspect_prefab_instance` and choose deliberately between apply and revert.
- Replacing a prefab at the same path can keep the asset UUID while changing internal object IDs and breaking serialized references, animation tracks, nested prefab links, and scene overrides.
- Inspect dependencies with `inspect_asset_dependencies` and validate them with `validate_asset_dependencies` before and after sensitive asset changes.
- Never copy a `.meta` file when duplicating an asset. Use `duplicate_prefab` or asset-db operations so the new asset receives its own UUID.

## Tool Exposure and Execution Contexts

- The default `core` profile exposes the main inspection, diagnostics, logs, screenshots, scene, asset, and unified JavaScript workflow.
- The `full` profile adds focused mutation tools for nodes, components, prefabs, UI, runtime control, input simulation, files, and project preview.
- If a named tool is unavailable under a custom profile, adapt to the exposed catalog and report the missing capability instead of pretending it ran.
- In scene context, use the Cocos runtime and scene APIs for live hierarchy and component work. In editor context, use `Editor` APIs and messages for asset-db and extension orchestration.
- Use `execute_scene_script` and `execute_editor_script` only as compatibility entrypoints; prefer `execute_javascript` with an explicit context for new workflows.

## Readiness and Preview Evidence

- For imports, scripts, preview startup, calibrated input, or persistence checks, read [project readiness](references/project-readiness.md). Do not load this conditional reference for an unrelated inspection.
- `check_asset_ready` checks stable AssetDB identity, not script compilation or runtime loading. Discover its exposure before use.
- `get_runtime_state` describes the editor Game View and toolbar, not browser/simulator runtime or edit-scene counters.
- Read `get_recent_logs` or `search_project_logs` for relevant errors. Do not clear persistent logs without explicit confirmation.

## Failure Handling

- If MCP is unreachable, limit claims to safe filesystem inspection or code edits; do not claim scene, prefab, editor, preview, or runtime verification.
- If a node lookup is ambiguous, return the matching paths and UUIDs and choose only after identifying the user-visible or prefab-owned target.
- If editor readback and serialized text disagree, trust editor and asset-db readback first and investigate whether the wrong asset, scene instance, or stale import was inspected.
- Fix diagnostics or new error logs caused by the change before visual or runtime validation.
