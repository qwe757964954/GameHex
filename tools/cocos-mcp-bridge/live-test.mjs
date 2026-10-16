import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'cocos-live-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./bridge.mjs', import.meta.url))],
  env: {
    ...process.env,
    COCOS_MCP_URL: process.env.COCOS_MCP_URL || 'http://127.0.0.1:3000/mcp',
  },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length === 0) {
    throw new Error('Cocos MCP returned no tools.');
  }

  const called = await client.callTool({
    name: 'server_server_information',
    arguments: { action: 'get_port' },
  });
  if (called.isError) {
    throw new Error(`Read-only server query failed: ${JSON.stringify(called.content)}`);
  }

  console.log(`Live Cocos MCP test passed: ${listed.tools.length} tools, server query succeeded.`);
} finally {
  await client.close();
}
