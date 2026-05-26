const http = require('http');

function startHealthServer(options) {
  if (!options.enabled) {
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }

    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(options.getStatus(), null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  server.listen(options.port, options.host, () => {
    console.log(`健康检查服务已启动: http://${options.host}:${options.port}`);
  });

  return server;
}

function loadHealthOptions(env) {
  return {
    enabled: env.HEALTH_ENABLED !== 'false',
    host: env.HEALTH_HOST || '127.0.0.1',
    port: Number(env.HEALTH_PORT || 3000)
  };
}

module.exports = {
  loadHealthOptions,
  startHealthServer
};
