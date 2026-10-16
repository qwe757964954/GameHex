// Local-only CORS bridge for the endpoints used by the legacy Cocos 2.4 login flow.
// Start with: npm run proxy
const http = require('http');
const https = require('https');

const PORT = 8099;
const ALLOWED_HOSTS = new Set([
    'cdn-msdf.fdsf675.com',
    'cosfate-1254042967.cos.ap-guangzhou.myqcloud.com',
    '175.27.170.110',
]);

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let target;
    try {
        const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
        target = new URL(requestUrl.searchParams.get('url'));
        if (!ALLOWED_HOSTS.has(target.hostname) || !['http:', 'https:'].includes(target.protocol)) {
            throw new Error('target is not allow-listed');
        }
    } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message }));
        return;
    }

    const transport = target.protocol === 'https:' ? https : http;
    const proxyRequest = transport.get(target, { timeout: 15000 }, (proxyResponse) => {
        const headers = { ...proxyResponse.headers };
        delete headers['access-control-allow-origin'];
        res.writeHead(proxyResponse.statusCode || 502, headers);
        proxyResponse.pipe(res);
    });
    proxyRequest.on('timeout', () => proxyRequest.destroy(new Error('upstream timeout')));
    proxyRequest.on('error', (error) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.message }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`City1001 CORS proxy: http://127.0.0.1:${PORT}`);
});
