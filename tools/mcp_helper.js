const http = require('http');

function callMcp(name, args = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args }
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 23148,
      path: '/mcp/project/644af1bc1c3b8c68dbd10723/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { callMcp };

if (require.main === module) {
  const [,, tool, argsJson] = process.argv;
  if (!tool) {
    console.log('Usage: node mcp_helper.js <tool> [argsJson]');
    process.exit(0);
  }
  const args = argsJson ? JSON.parse(argsJson) : {};
  callMcp(tool, args).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error);
}
