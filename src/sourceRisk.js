const fs = require('fs');
const path = require('path');

function readJsonIfExists(filePath) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function loadSecurityConfig(filePath) {
  const config = readJsonIfExists(filePath || 'security.config.json') || {};

  return {
    trustedDomains: new Set((config.trustedDomains || []).map(domain => String(domain).toLowerCase())),
    blockedDomains: new Set((config.blockedDomains || []).map(domain => String(domain).toLowerCase()))
  };
}

function extractEmail(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  const email = match ? match[1] : String(value || '').trim();

  return email.toLowerCase();
}

function extractDomain(value) {
  const email = extractEmail(value);
  const parts = email.split('@');

  return parts.length === 2 ? parts[1] : '';
}

function findUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s<>'")]+/gi) || [];
}

function analyzeSourceRisk(mail, securityConfig) {
  const reasons = [];
  const fromDomain = extractDomain(mail.from);
  const replyToDomain = extractDomain(mail.replyTo);
  const returnPathDomain = extractDomain(mail.returnPath);
  const content = [mail.subject, mail.text, mail.html].filter(Boolean).join('\n');
  const urls = findUrls(content);
  const externalUrlDomains = [...new Set(urls.map(extractDomain).filter(Boolean))];
  const trusted = securityConfig?.trustedDomains?.has(fromDomain) || false;
  const blocked = securityConfig?.blockedDomains?.has(fromDomain) || false;

  if (blocked) {
    reasons.push(`发件域名在黑名单中: ${fromDomain}`);
  }

  if (trusted) {
    reasons.push(`发件域名在白名单中: ${fromDomain}`);
  }

  if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
    reasons.push(`Reply-To 域名与发件人域名不一致: ${replyToDomain}`);
  }

  if (returnPathDomain && fromDomain && returnPathDomain !== fromDomain) {
    reasons.push(`Return-Path 域名与发件人域名不一致: ${returnPathDomain}`);
  }

  if (urls.some(url => /\b(ipfs|bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly)\b/i.test(url))) {
    reasons.push('邮件包含短链接或高风险链接');
  }

  if (/验证码|verification code|reset password|重置密码|登录确认/i.test(content)) {
    reasons.push('邮件包含验证码或账号安全相关内容');
  }

  return {
    level: blocked ? 'high' : reasons.filter(reason => !reason.includes('白名单')).length >= 2 ? 'medium' : reasons.length === 1 ? 'low' : 'low',
    reasons,
    trusted,
    blocked,
    fromDomain,
    replyToDomain,
    returnPathDomain,
    externalUrlDomains
  };
}

module.exports = {
  analyzeSourceRisk,
  loadSecurityConfig
};
