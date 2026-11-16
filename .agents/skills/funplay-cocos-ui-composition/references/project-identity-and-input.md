# Project identity and frame-paced input

## Before editing through MCP

Generated connections use /mcp/project/<project-id>/ on the existing project port. Independently compare initialize.funplay.context.project_path and project_id to the user's intended project. Context metadata identifies an extension/Editor lifetime, not authentication or permission to edit another project.

Legacy / and /mcp addresses still support initialization and exposed read-only tools. Mutating tools require expected_context from that verified initialization, either as a tool argument or params._meta.expected_context. A project-scoped URL binds the project; an explicit expected_context also pins the extension/Editor instance. Missing, wrong-project, conflicting or stale pins execute nothing. Never automatically fetch a token from an arbitrary responding server just to bypass a rejection.

Prefer reconfiguration from MCP Server's existing connection/Skills notice, then reconnect or restart the client. Existing user edits remain protected. Unreadable client files need review; unrelated entries and historical shared entries are not silently deleted. A reload can invalidate the instance pin and calibrated screenshots even while the port remains the same. Read fresh identity and capture again; never replay a mutation solely to get a cleaner reply.

## Frame-paced mouse drag (Full profile)

Use this only when a drag test is requested and the originating input tool is exposed. Keep legacy timing for existing steps/stepDelayMs callers. For a new frame-paced gesture, capture the exact target, use coordinateSpace=image-pixels with its captureId, and choose a unique requestKey. Set timing=frame-paced and supply startX/startY/endX/endY from that PNG. durationMs is 50..10000 (default 600); pressHoldMs and endHoldMs are 0..2000 (default 100). Each edge still gets separate renderer frames at zero hold. Do not mix legacy step timing with these fields.

The tool waits up to waitMs (default 1200), then may return a running receipt. Read it through the SAME tool with action=status and jobId or requestKey; cancel through action=cancel without coordinates. A retained identical start recovers its original receipt and never dispatches the gesture again. Changed arguments conflict. Only the latest 32 receipts are retained; these are not durable transactions across eviction/reload. A missing receipt requires inspection of the resulting state, not an automatic retry with a new key. The preview wrapper and direct mouse-drag tool have separate ownership; do not change custom exposure lists to access another tool's receipts.

Frame-paced input observes the captured Electron renderer's requestAnimationFrame callbacks. Native Game View pause/stop state is checked separately; renderer progression does not prove that native game Update advanced or a game accepted the gesture. Receipts deliberately report nativeGameUpdateVerified=false and businessOutcomeVerified=false. Compare authored state, actual preview/game state and fresh screenshots independently. This is mouse input, not touch injection or proof of physical-device provenance.

Focus loss, stale geometry, stalled frames, cancellation, preview pause/stop and extension shutdown interrupt the job. Only its own mouse release is attempted, without business callbacks or a legacy fallback. Cleanup failure leaves the target window locked; explicitly cancel that job to retry cleanup. Status reads never send input. No background/focus policy, preview pause state, project input setting or dependency is automatically changed.

Sources: [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Electron input](https://www.electronjs.org/docs/latest/api/web-contents#contentssendinputeventinputevent) and [Creator Director](https://docs.cocos.com/creator/3.8/api/en/class/Director).
