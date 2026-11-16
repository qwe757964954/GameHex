# Input, animation, and visual verification

- Verify Button/Toggle/Slider/EditBox target nodes, serialized component/handler/custom data, disabled state, hit area and focus behavior. Bind once; don't make duplicate listeners to compensate for an unresolved reference.
- Emitting Button click events checks callbacks, not real pointer dispatch. For hit testing use the actual Game View/preview and calibrated screenshot coordinates; verify the resulting state or screenshot rather than treating event delivery as the business outcome.
- Screenshot `captureId` identifies one image and its observed geometry. Use `coordinateSpace="image-pixels"` with coordinates in that exact PNG. Calibration maps to Electron content coordinates and rejects stale or changed targets. It does not identify a Button or prove absence of occlusion.
- Keep UIOpacity, active state, Button interactability and BlockInputEvents consistent. A transparent modal may still block input; a visible scrim may not block anything. Check sibling order, masks and hidden states in preview.
- Animate a Visual/Container child when Widget or Layout owns the root. Cancel/reconcile prior tweens, and verify deterministic position, scale, opacity, active state and close/reopen behavior. Use an explicit UI clock only if menus must animate during gameplay pause.
- Test only requested interactions. An input with unknown delivery/outcome must be followed by readback, not automatic replay. Restore temporary preview state only if still owned by this task.
- Use `validate_scene`, exact component/reference readback and screenshots as complementary evidence. A complete hierarchy or non-empty image does not prove correct layout, visible text, hit testing or business behavior.
- `get_performance_snapshot` reports edit-scene node/component/UI/depth/memory counters, not browser/Game View draw calls or GPU performance. Use actual runtime/platform measurements before making performance claims.
- Choose representative aspect ratios and locales for the target project. Record which checks passed, failed, were incomplete or require a device; avoid claiming universal validation from one screenshot.

Sources: [UI system](https://docs.cocos.com/creator/3.8/manual/en/2d-object/ui-system/) and [node hierarchy](https://docs.cocos.com/creator/3.8/manual/en/concepts/scene/node-tree.html).
