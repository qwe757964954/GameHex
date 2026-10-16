# Cocos MCP bridge for Codex

This bridge exposes the vendored Cocos Creator extension's HTTP JSON-RPC
endpoint as a standard MCP STDIO server for Codex.

## Runtime

1. Open the project in Cocos Creator 3.8.8.
2. The extension starts its local server on `127.0.0.1:3000` using
   `settings/mcp-server.json`.
3. Start a new Codex task so it reloads the global `cocos-creator` MCP entry.

The registered command is equivalent to:

```powershell
codex mcp add cocos-creator `
  --env COCOS_MCP_URL=http://127.0.0.1:3000/mcp `
  --env COCOS_MCP_TIMEOUT_MS=30000 `
  -- "D:\Program Files\nodejs\node.exe" `
  "D:\City1001\Demo3.8\tools\cocos-mcp-bridge\bridge.mjs"
```

## Verification

```powershell
npm.cmd test
npm.cmd run test:live
```

`test` verifies the bridge against a mock Cocos endpoint. `test:live` verifies
tool discovery and a read-only server query against the running editor.
