# Layout and design fidelity

## Resolution and safe area

- User requirements and explicit design specifications take priority. Preserve an established project's design resolution and Fit Width/Fit Height policy unless a change is requested. For a new screen without a baseline, a full-page design image may define the baseline; a crop, conflicting images, or unclear intended dimensions need clarification. Do not impose a fixed phone resolution.
- Keep authored spacing and full-bleed composition. Inspect existing SafeArea components and runtime adaptation before changing them. Do not proactively add SafeArea containers, adaptation scripts, extra margins, or a second inset; new adaptation needs an explicit request or a demonstrated overlap confirmed with the user.
- If safe-area adaptation is requested, distinguish full-bleed art from critical controls and apply it once. Cocos SafeArea uses sys.getSafeAreaRect and Widget; preserve the project's existing ownership of position/size.
- Separate Canvas adaptation from gameplay camera composition. Correct Widget constraints do not prove that the world camera shows the desired area.

## Property ownership

- UITransform owns contentSize and anchor point. Keep ordinary layout scale at one; change dimensions or constraints rather than stretching transforms to approximate a design.
- Widget owns selected edges/centers and may overwrite position or size. Choose ONCE, ON_WINDOW_RESIZE, or ALWAYS from actual behavior; do not animate a property continuously rewritten by Widget.
- Layout drives children or container according to ResizeMode. Putting Layout and Widget on the same node can create competing ownership. Read back driven sizes after layout settles; call updateLayout only when same-frame measurement is required.
- Verify grid cell/constraint policy, padding, spacing, axis and growth direction. Keep nested layout chains shallow and batch repeated content changes.
- Responsive region patterns are options, not permission to reorganize existing prefabs. Reposition only the regions needed by the requested aspect-ratio change; retain roots, identities, references and animation tracks.

## Scrolling and clipping

- Use a ScrollView root, masked view and content node. Verify the actual content reference, enabled axes, inertia/brake/bounce, child-button cancellation and nested scrolling.
- Respect Mask renderer constraints and clipping boundaries. Do not add Sprite/Label renderers to a Mask node where its renderer is owned by the mask implementation.
- Pool large repeated lists. Test first/last items, resize, overflow and dynamic content in preview; dimensions alone do not prove visibility or input.

Sources: [Widget](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/widget.html), [Layout](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/layout.html), [SafeArea](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/safearea.html), [multi-resolution adaptation](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/engine/multi-resolution.html).
