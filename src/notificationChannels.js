const fs = require('fs');
const path = require('path');

function readJsonIfExists(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function loadNotificationChannels(env) {
  const configPath = env.NOTIFY_CONFIG_PATH || 'notify.config.json';
  const config = readJsonIfExists(configPath);

  if (config?.channels?.length) {
    return config.channels.filter(channel => channel.enabled !== false);
  }

  return [];
}

function selectChannels(channels, names) {
  if (!names?.length) {
    return channels;
  }

  const nameSet = new Set(names);

  return channels.filter(channel => nameSet.has(channel.name));
}

async function postJson(url, payload, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);

  try {
    const response = await fetch(url, {
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`通知请求失败: ${response.status} ${errorText}`);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function sendWeCom(channel, content) {
  const response = await postJson(channel.webhookUrl, {
    msgtype: 'markdown',
    markdown: { content }
  }, { timeout: channel.timeout });
  const result = await response.json();

  if (result.errcode !== 0) {
    throw new Error(`企业微信通知失败: ${result.errcode} ${result.errmsg}`);
  }
}

async function sendGenericWebhook(channel, event) {
  await postJson(channel.url, event, {
    method: channel.method || 'POST',
    headers: channel.headers || {},
    timeout: channel.timeout
  });
}

async function notifyChannels(channels, event, names) {
  const targets = selectChannels(channels, names);

  if (targets.length === 0) {
    return {
      skipped: true,
      reason: '没有可用通知渠道'
    };
  }

  const results = await Promise.allSettled(targets.map(async channel => {
    if (channel.type === 'wecom') {
      await sendWeCom(channel, event.content);
      return channel.name;
    }

    if (channel.type === 'generic-webhook') {
      await sendGenericWebhook(channel, event);
      return channel.name;
    }

    throw new Error(`不支持的通知渠道类型: ${channel.type}`);
  }));

  const failed = results.filter(result => result.status === 'rejected');

  if (failed.length > 0) {
    throw new Error(failed.map(result => result.reason.message).join('；'));
  }

  return {
    skipped: false,
    channels: targets.map(channel => channel.name)
  };
}

module.exports = {
  loadNotificationChannels,
  notifyChannels
};
