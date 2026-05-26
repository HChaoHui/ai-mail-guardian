const nodemailer = require('nodemailer');
const { validateReplySafety } = require('./replyGuard');

function loadSmtpOptions(env) {
  return {
    enabled: env.AUTO_REPLY_ENABLED === 'true',
    dryRun: env.AUTO_REPLY_DRY_RUN !== 'false'
  };
}

function getReplyAddress(mail) {
  const match = String(mail.from || '').match(/<([^>]+)>/);

  if (match) {
    return match[1];
  }

  return mail.from;
}

function buildFrom(options) {
  if (!options.fromName) {
    return options.user;
  }

  return `"${options.fromName}" <${options.user}>`;
}

async function sendReply(mail, analysis, options) {
  if (!analysis?.needsReply) {
    return {
      skipped: true,
      reason: 'AI 判断无需回复'
    };
  }

  if (!analysis.replyText) {
    return {
      skipped: true,
      reason: 'AI 未生成回复正文'
    };
  }

  const to = getReplyAddress(mail);

  if (!to) {
    return {
      skipped: true,
      reason: '无法识别收件人地址'
    };
  }

  const accountSmtp = mail.smtp || {};
  const subject = analysis.replySubject || `Re: ${mail.subject || '无主题'}`;
  const safetyResult = validateReplySafety(mail, analysis);

  if (!safetyResult.safe) {
    return {
      skipped: true,
      blocked: true,
      reason: `安全策略拦截: ${safetyResult.reasons.join('；')}`,
      preview: {
        to,
        subject,
        text: analysis.replyText
      }
    };
  }

  if (!options.enabled || options.dryRun) {
    return {
      skipped: true,
      reason: '自动回复未启用或处于演练模式',
      preview: {
        to,
        subject,
        text: analysis.replyText
      }
    };
  }

  const transporter = nodemailer.createTransport({
    host: accountSmtp.host,
    port: accountSmtp.port,
    secure: accountSmtp.secure,
    auth: {
      user: accountSmtp.user,
      pass: accountSmtp.pass
    }
  });

  const result = await transporter.sendMail({
    from: buildFrom(accountSmtp),
    to,
    subject,
    text: analysis.replyText,
    inReplyTo: mail.messageId,
    references: mail.messageId ? [mail.messageId] : undefined
  });

  return {
    skipped: false,
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected
  };
}

module.exports = {
  loadSmtpOptions,
  sendReply
};
