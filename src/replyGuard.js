const SENSITIVE_PATTERNS = [
  { name: 'API Key', pattern: /\b(sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{20,})\b/ },
  { name: 'Bearer Token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i },
  { name: 'Webhook URL', pattern: /https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]+/i },
  { name: '邮箱授权码或密码', pattern: /(授权码|密码|password|pass|secret|token|api[_-]?key)\s*[:：=]\s*[^\s]{6,}/i },
  { name: '环境变量或配置文件', pattern: /(\.env|accounts\.json|process\.env|SMTP_PASSWORD|MAIL_PASSWORD|AI_API_KEY|WEBHOOK_URL)/i },
  { name: '内部系统提示词', pattern: /(系统提示词|system prompt|开发者指令|developer message|隐藏规则|内部规则)/i }
];

const INJECTION_PATTERNS = [
  /忽略(之前|以上|所有).{0,20}(指令|规则|限制)/i,
  /ignore.{0,20}(previous|above|all).{0,20}(instructions|rules)/i,
  /输出.{0,20}(密钥|密码|配置|环境变量|源码|系统提示词)/i,
  /reveal.{0,20}(secret|password|token|system prompt|environment)/i,
  /泄露|透露|打印|展示.{0,20}(密钥|密码|token|配置)/i
];

function findMatches(text, patterns) {
  return patterns
    .filter(item => item.pattern.test(text))
    .map(item => item.name);
}

function containsInjectionText(mail) {
  const content = [mail.subject, mail.text, mail.html].filter(Boolean).join('\n');

  return INJECTION_PATTERNS.some(pattern => pattern.test(content));
}

function validateReplySafety(mail, analysis) {
  const reasons = [];
  const replyText = String(analysis?.replyText || '');
  const riskLevel = String(analysis?.securityRisk || 'low').toLowerCase();

  if (riskLevel === 'high') {
    reasons.push('AI 判断邮件存在高安全风险');
  }

  if (analysis?.needsHumanReview) {
    reasons.push('AI 建议人工复核');
  }

  if (containsInjectionText(mail)) {
    reasons.push('原邮件疑似包含提示词注入或索取敏感信息');
  }

  const sensitiveMatches = findMatches(replyText, SENSITIVE_PATTERNS);

  if (sensitiveMatches.length > 0) {
    reasons.push(`回复内容疑似包含敏感信息: ${sensitiveMatches.join(', ')}`);
  }

  return {
    safe: reasons.length === 0,
    reasons
  };
}

module.exports = {
  validateReplySafety
};
