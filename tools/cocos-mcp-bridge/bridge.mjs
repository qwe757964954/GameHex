import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const endpoint = process.env.COCOS_MCP_URL || 'http://127.0.0.1:3000/mcp';
const requestTimeoutMs = Number(process.env.COCOS_MCP_TIMEOUT_MS || 30000);
let nextRequestId = 1;

async function callCocos(method, params = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextRequestId++,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Cocos MCP returned HTTP ${response.status}`);
    }

    const message = await response.json();
    if (message.error) {
      throw new Error(message.error.message || JSON.stringify(message.error));
    }
    return message.result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Cocos MCP request timed out after ${requestTimeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const server = new Server(
  {
    name: 'zcds-cocos-mcp-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const result = await callCocos('tools/list');
  return { tools: result?.tools || [] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await callCocos('tools/call', {
      name: request.params.name,
      arguments: request.params.arguments || {},
    });

    return {
      content: result?.content || [
        {
          type: 'text',
          text: JSON.stringify(result ?? null),
        },
      ],
      isError: Boolean(result?.isError),
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Cocos MCP bridge error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

