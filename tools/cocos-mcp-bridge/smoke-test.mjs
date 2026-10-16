import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const mock = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const message = JSON.parse(body);
    let result;

    if (message.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'server_info',
            description: 'Mock Cocos server information',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };
    } else if (message.method === 'tools/call') {
      result = {
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      };
    } else {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method' } }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
});

mock.listen(0, '127.0.0.1');
await once(mock, 'listening');
const address = mock.address();

const client = new Client({ name: 'bridge-smoke-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./bridge.mjs', import.meta.url))],
  env: {
    ...process.env,
    COCOS_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
  },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 1 || listed.tools[0].name !== 'server_info') {
    throw new Error(`Unexpected tools response: ${JSON.stringify(listed)}`);
  }

  const called = await client.callTool({ name: 'server_info', arguments: {} });
  if (called.isError || called.content?.[0]?.text !== '{"ok":true}') {
    throw new Error(`Unexpected tool response: ${JSON.stringify(called)}`);
  }

  console.log('Cocos MCP bridge smoke test passed.');
} finally {
  await client.close();
  mock.close();
}
