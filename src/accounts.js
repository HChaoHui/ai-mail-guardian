const fs = require('fs');
const path = require('path');

function requireValue(value, fieldPath) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`账号配置缺少字段: ${fieldPath}`);
  }

  return value;
}

function normalizeAccount(account, index) {
  const name = requireValue(account.name, `accounts[${index}].name`);
  const imap = account.imap || {};
  const smtp = account.smtp || {};

  const imapUser = requireValue(imap.user, `accounts[${index}].imap.user`);
  const imapPass = requireValue(imap.pass, `accounts[${index}].imap.pass`);
  const smtpUser = smtp.user || imapUser;
  const smtpPass = smtp.pass || imapPass;

  return {
    name,
    provider: account.provider || 'custom',
    enabled: account.enabled !== false,
    imap: {
      accountName: name,
      host: requireValue(imap.host, `accounts[${index}].imap.host`),
      port: Number(imap.port || 993),
      secure: imap.secure !== false,
      user: imapUser,
      pass: imapPass,
      mailbox: imap.mailbox || 'INBOX',
      markSeen: imap.markSeen !== false,
      markSeenTimeout: Number(imap.markSeenTimeout || 10000),
      reconnectDelay: Number(imap.reconnectDelay || 5000)
    },
    smtp: {
      host: requireValue(smtp.host, `accounts[${index}].smtp.host`),
      port: Number(smtp.port || 465),
      secure: smtp.secure !== false,
      user: smtpUser,
      pass: smtpPass,
      fromName: smtp.fromName || ''
    }
  };
}

function loadAccounts(filePath) {
  const resolvedPath = path.resolve(filePath || 'accounts.json');
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const config = JSON.parse(raw);

  if (!Array.isArray(config.accounts)) {
    throw new Error('accounts.json 必须包含 accounts 数组');
  }

  const accounts = config.accounts
    .map(normalizeAccount)
    .filter(account => account.enabled);

  if (accounts.length === 0) {
    throw new Error('没有启用任何邮箱账号');
  }

  return accounts;
}

module.exports = {
  loadAccounts
};
