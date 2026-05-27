function truncate(value, maxLength) {
  const text = String(value || '无');

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

function formatDate(date) {
  if (!date) {
    return '未知';
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return String(date);
  }

  return parsed.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
}

function formatLevel(level) {
  const levelMap = {
    low: '低',
    medium: '中',
    high: '高'
  };

  return levelMap[String(level || '').toLowerCase()] || level || '未知';
}

function buildReplyText(analysis, replyResult) {
  if (!analysis?.needsReply) {
    return '否';
  }

  if (replyResult?.skipped) {
    const prefix = replyResult.blocked ? '是，但被安全策略拦截' : '是，但未发送';

    return `${prefix}：${replyResult.reason}\n> 回复内容：${truncate(analysis.replyText, 1200)}`;
  }

  return `是，已发送\n> 回复内容：${truncate(analysis.replyText, 1200)}`;
}

function buildNotificationContent(mail, analysis, replyResult) {
  const summary = analysis?.summary || analysis?.raw || 'AI 未返回摘要';
  const sourceRisk = mail.sourceRisk;
  const coreContent = [
    `摘要：${truncate(summary, 800)}`,
    `意图：${truncate(analysis?.intent, 300)}`,
    `分类：${analysis?.category || '未知'}`,
    `优先级：${formatLevel(analysis?.priority)}`,
    `安全风险：${formatLevel(analysis?.securityRisk)}`,
    `是否需要人工复核：${analysis?.needsHumanReview ? '是' : '否'}`,
    `风险：${truncate(analysis?.risks, 500)}`,
    `来源风控：${sourceRisk?.reasons?.length ? truncate(sourceRisk.reasons.join('；'), 500) : '未发现明显异常'}`
  ].join('\n> ');

  return [
    '### 邮件处理通知',
    `> 收件邮箱：${mail.accountName || mail.accountUser || '未知'}`,
    `> 发件人：${mail.from || '未知'}`,
    `> 发件时间：${formatDate(mail.date)}`,
    `> 主题：${mail.subject || '无主题'}`,
    `> 核心内容：${coreContent}`,
    `> AI 是否回复：${buildReplyText(analysis, replyResult)}`
  ].join('\n');
}

function buildSystemNotificationContent(title, details) {
  return [
    `### ${title}`,
    ...details.map(item => `> ${item}`)
  ].join('\n');
}

module.exports = {
  buildNotificationContent,
  buildSystemNotificationContent
};
