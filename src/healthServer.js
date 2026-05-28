const http = require('http');
const crypto = require('crypto');

function sendJson(res, data, statusCode = 200, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendForbidden(res, message) {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';').map(item => item.trim());
  const matched = cookies.find(item => item.startsWith(`${name}=`));

  return matched ? decodeURIComponent(matched.slice(name.length + 1)) : '';
}

function hasAuth(req, options) {
  const sessionToken = getCookie(req, 'amg_session');

  if (sessionToken && options.sessions.has(sessionToken)) {
    return true;
  }

  return req.headers['x-admin-password'] === options.adminPassword;
}

function requireAuth(req, res, options) {
  if (!options.adminPassword) {
    sendForbidden(res, '未配置 HEALTH_ADMIN_PASSWORD，管理面板已禁用');
    return false;
  }

  if (hasAuth(req, options)) {
    return true;
  }

  sendJson(res, { error: 'unauthorized' }, 401);
  return false;
}

function renderSetupRequired() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Mail Guardian</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f3ee;color:#28231d}.box{max-width:520px;background:#fffaf2;border:1px solid #e5d8c7;border-radius:22px;padding:28px;box-shadow:0 24px 70px rgba(71,55,36,.1)}h1{margin-top:0;letter-spacing:-.04em}code{background:#efe5d8;padding:2px 6px;border-radius:6px}</style></head>
<body><div class="box"><h1>请先设置管理员密码</h1><p>为了避免误开公网后泄露邮件数据，管理面板默认禁用。</p><p>请在 <code>.env</code> 中配置 <code>HEALTH_ADMIN_PASSWORD</code> 后重启服务。</p></div></body></html>`;
}

function renderDashboard() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Mail Guardian</title>
  <style>
    :root { color-scheme: light; --bg: #f6f3ee; --panel: #fffaf2; --line: #e5d8c7; --text: #28231d; --muted: #7b6f62; --accent: #245c4f; --accent-2: #c9793d; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: radial-gradient(circle at top left, #fbefe0, transparent 34%), var(--bg); color: var(--text); }
    main { max-width: 1240px; margin: 0 auto; padding: 34px 24px; }
    .hero { display: flex; justify-content: space-between; gap: 20px; align-items: end; margin-bottom: 28px; }
    h1 { margin: 0 0 10px; font-size: clamp(32px, 5vw, 58px); letter-spacing: -0.05em; line-height: 0.95; }
    h2 { margin-top: 32px; letter-spacing: -0.03em; }
    .muted { color: var(--muted); }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 8px 12px; background: rgba(255, 250, 242, 0.75); color: var(--muted); white-space: nowrap; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin: 22px 0; }
    .card { background: rgba(255, 250, 242, 0.9); border: 1px solid var(--line); border-radius: 18px; padding: 18px; box-shadow: 0 20px 60px rgba(71, 55, 36, 0.08); }
    .value { font-size: 28px; font-weight: 800; margin-top: 8px; color: var(--accent); letter-spacing: -0.04em; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 18px; background: rgba(255, 250, 242, 0.9); box-shadow: 0 20px 60px rgba(71, 55, 36, 0.08); }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 13px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #efe5d8; color: #5f5144; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    .error { color: #a84736; }
    button { background: var(--accent); border: 0; border-radius: 999px; color: #fff; cursor: pointer; padding: 7px 12px; font-weight: 700; }
    pre { white-space: pre-wrap; word-break: break-word; background: #fffdf8; border: 1px solid var(--line); border-radius: 14px; padding: 12px; margin: 8px 0 0; color: #3a3028; }
    .detail { display: none; background: #fbf5ec; }
    .detail.open { display: table-row; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .modal { position: fixed; inset: 0; display: none; place-items: center; background: rgba(40, 35, 29, 0.22); backdrop-filter: blur(10px); padding: 20px; }
    .modal.open { display: grid; }
    .login { width: min(420px, 100%); background: #fffaf2; border: 1px solid var(--line); border-radius: 24px; padding: 24px; box-shadow: 0 24px 80px rgba(71, 55, 36, 0.18); }
    input { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: 16px; background: #fffdf8; color: var(--text); }
    .login button { width: 100%; margin-top: 12px; padding: 12px 14px; }
    .login-error { min-height: 22px; color: #a84736; margin-top: 10px; }
    @media (max-width: 720px) { .hero { display: block; } .pill { display: inline-block; margin-top: 12px; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>AI Mail Guardian</h1>
        <div class="muted">邮件监听、AI 分析、自动回复与安全状态面板</div>
      </div>
      <div class="pill">本地管理面板</div>
    </section>
    <section class="cards" id="cards"></section>
    <h2>最近邮件</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>时间</th><th>账号</th><th>发件人</th><th>主题</th><th>AI</th><th>回复</th><th>通知</th><th>已读</th><th>详情</th></tr></thead>
      <tbody id="mails"></tbody>
    </table></div>
  </main>
  <div class="modal open" id="loginModal">
    <form class="login" id="loginForm">
      <h2>输入管理员密码</h2>
      <p class="muted">仅需要密码，不需要用户名。</p>
      <input id="passwordInput" type="password" autocomplete="current-password" placeholder="管理员密码" autofocus>
      <button type="submit">进入面板</button>
      <div class="login-error" id="loginError"></div>
    </form>
  </div>
  <script>
    function showLogin(message) {
      document.getElementById('loginModal').classList.add('open');
      document.getElementById('loginError').textContent = message || '';
      setTimeout(() => document.getElementById('passwordInput').focus(), 0);
    }
    async function login(password) {
      const response = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        showLogin('密码错误');
        return false;
      }
      document.getElementById('loginModal').classList.remove('open');
      return true;
    }
    document.getElementById('loginForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (await login(document.getElementById('passwordInput').value)) {
        load();
      }
    });
    async function load() {
      const statusResponse = await fetch('/api/status');
      if (statusResponse.status === 401 || statusResponse.status === 403) { showLogin(); return; }
      const status = await statusResponse.json();
      const mailsResponse = await fetch('/api/mails?limit=50');
      if (mailsResponse.status === 401 || mailsResponse.status === 403) { showLogin(); return; }
      const mails = await mailsResponse.json();
      document.getElementById('loginModal').classList.remove('open');
      const counts = status.database.counts || {};
      document.getElementById('cards').innerHTML = [
        ['运行时间', Math.floor(status.uptime) + 's'],
        ['监听账号', status.accounts.length],
        ['已处理', counts.processed || 0],
        ['处理中', counts.processing || 0],
        ['通知失败', counts.notify_failed || 0],
        ['最近收信', status.lastMailAt || '无']
      ].map(([label, value]) => '<div class="card"><div class="muted">' + label + '</div><div class="value">' + value + '</div></div>').join('');
      function parseJson(value) {
        if (!value) return null;
        try { return JSON.parse(value); } catch { return null; }
      }
      function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      }
      function detailHtml(mail, index) {
        const analysis = parseJson(mail.analysis_json) || {};
        const reply = parseJson(mail.reply_json) || {};
        const decision = parseJson(mail.decision_json) || {};
        const sourceRisk = parseJson(mail.source_risk_json) || {};
        return '<tr class="detail" id="detail-' + index + '"><td colspan="9"><div class="grid">' +
          '<div><strong>AI 判断</strong><pre>' + escapeHtml(JSON.stringify({ summary: analysis.summary, intent: analysis.intent, category: analysis.category, priority: analysis.priority, securityRisk: analysis.securityRisk, needsReply: analysis.needsReply, needsHumanReview: analysis.needsHumanReview, risks: analysis.risks }, null, 2)) + '</pre></div>' +
          '<div><strong>回复内容</strong><pre>' + escapeHtml(reply.preview?.text || analysis.replyText || '无') + '</pre></div>' +
          '<div><strong>规则决策</strong><pre>' + escapeHtml(JSON.stringify(decision, null, 2)) + '</pre></div>' +
          '<div><strong>来源风控</strong><pre>' + escapeHtml(JSON.stringify(sourceRisk, null, 2)) + '</pre></div>' +
        '</div></td></tr>';
      }
      document.getElementById('mails').innerHTML = mails.map((mail, index) => '<tr>' +
        '<td>' + (mail.updated_at || '') + '</td>' +
        '<td>' + (mail.account_name || '') + '</td>' +
        '<td>' + (mail.sender || '') + '</td>' +
        '<td>' + (mail.subject || '') + '</td>' +
        '<td>' + (mail.ai_status || '') + '</td>' +
        '<td>' + (mail.reply_status || '') + '</td>' +
        '<td>' + (mail.notify_status || '') + '</td>' +
        '<td>' + (mail.mark_seen_status || '') + '</td>' +
        '<td><button data-detail-index="' + index + '">查看</button></td>' +
      '</tr>' + detailHtml(mail, index)).join('');
      document.querySelectorAll('[data-detail-index]').forEach(button => {
        button.addEventListener('click', () => {
          document.getElementById('detail-' + button.dataset.detailIndex).classList.toggle('open');
        });
      });
    }
    load();
    setInterval(load, 10000);
  </script>
</body>
</html>`;
}

function startHealthServer(options) {
  if (!options.enabled) {
    return null;
  }

  options.sessions = new Set();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(res, { ok: true, uptime: process.uptime() });
      return;
    }

    if (url.pathname === '/' && !options.adminPassword) {
      sendHtml(res, renderSetupRequired());
      return;
    }

    if (url.pathname === '/') {
      sendHtml(res, renderDashboard());
      return;
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      if (!options.adminPassword) {
        sendForbidden(res, '未配置 HEALTH_ADMIN_PASSWORD，管理面板已禁用');
        return;
      }

      try {
        const body = JSON.parse(await readRequestBody(req) || '{}');

        if (body.password !== options.adminPassword) {
          sendJson(res, { error: 'invalid_password' }, 401);
          return;
        }

        const token = crypto.randomUUID();
        options.sessions.add(token);
        sendJson(res, { ok: true }, 200, {
          'Set-Cookie': `amg_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
        });
      } catch {
        sendJson(res, { error: 'bad_request' }, 400);
      }
      return;
    }

    if (!requireAuth(req, res, options)) {
      return;
    }

    if (url.pathname === '/status' || url.pathname === '/api/status') {
      sendJson(res, options.getStatus());
      return;
    }

    if (url.pathname === '/api/mails') {
      sendJson(res, options.getMails(Number(url.searchParams.get('limit') || 50)));
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
    port: Number(env.HEALTH_PORT || 3000),
    adminPassword: env.HEALTH_ADMIN_PASSWORD || ''
  };
}

module.exports = {
  loadHealthOptions,
  startHealthServer
};
