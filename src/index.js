require('dotenv').config();

const { loadAccounts } = require('./accounts');
const { createDatabase } = require('./database');
const { createMailWatcher } = require('./mailWatcher');
const { analyzeMail, loadAiOptions } = require('./aiAnalyzer');
const { loadSmtpOptions, sendReply } = require('./mailSender');
const { loadNotifyOptions, sendNotification, sendSystemNotification } = require('./notifier');
const { analyzeSourceRisk } = require('./sourceRisk');
const { loadHealthOptions, startHealthServer } = require('./healthServer');

let aiOptions;
let smtpOptions;
let notifyOptions;
let database;
let healthServer;
const runtimeStatus = {
  startedAt: new Date().toISOString(),
  accounts: [],
  lastMailAt: null,
  lastError: null
};

async function notifySystemError(title, error) {
  runtimeStatus.lastError = {
    title,
    message: error.message,
    time: new Date().toISOString()
  };

  try {
    await sendSystemNotification(title, [
      `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `错误：${error.message}`
    ], notifyOptions);
  } catch (notifyError) {
    console.error('发送系统异常通知失败:', notifyError.message);
  }
}

async function handleNewMail(mail) {
  console.log('收到新邮件');
  console.log('收件邮箱:', mail.accountName || mail.accountUser || '未知');
  console.log('UID:', mail.uid);
  console.log('发件人:', mail.from || '未知');
  console.log('主题:', mail.subject || '无主题');
  runtimeStatus.lastMailAt = new Date().toISOString();

  let analysis = null;
  let replyResult = null;
  let notifyResult = null;
  let markSeenResult = null;

  if (database.isProcessed(mail)) {
    console.log(`邮件已处理过，跳过重复处理: ${mail.accountName} UID=${mail.uid}`);
    markSeenResult = await mail.markSeen();
    database.saveMailRecord(mail, {
      status: 'processed',
      markSeenStatus: markSeenResult.success ? 'success' : 'failed',
      error: markSeenResult.error
    });
    return;
  }

  database.saveMailRecord(mail, {
    status: 'processing'
  });

  try {
    mail.sourceRisk = analyzeSourceRisk(mail);
    analysis = await analyzeMail(mail, aiOptions);

    if (analysis) {
      console.log('AI 分析结果:', JSON.stringify(analysis, null, 2));

      replyResult = await sendReply(mail, analysis, smtpOptions);

      if (replyResult.skipped) {
        console.log('自动回复跳过:', replyResult.reason);

        if (replyResult.preview) {
          console.log('自动回复预览:', JSON.stringify(replyResult.preview, null, 2));
        }
      } else {
        console.log('自动回复已发送:', JSON.stringify(replyResult, null, 2));
      }
    }
  } catch (error) {
    console.error('邮件 AI 分析或自动回复失败:', error.message);
    await notifySystemError('邮件处理异常', error);
  } finally {
    try {
      notifyResult = await sendNotification(mail, analysis, replyResult, notifyOptions);

      if (notifyResult.skipped) {
        console.log('通知跳过:', notifyResult.reason);
      } else {
        console.log('处理摘要通知已发送');
        markSeenResult = { success: true, pending: true };
        mail.markSeen().then(result => {
          database.saveMailRecord(mail, {
            status: 'processed',
            aiStatus: analysis ? 'success' : 'failed',
            replyStatus: replyResult?.skipped ? 'skipped' : replyResult ? 'sent' : 'none',
            notifyStatus: 'success',
            markSeenStatus: result.success ? 'success' : 'failed',
            error: result.error || null
          });
        }).catch(error => {
          database.saveMailRecord(mail, {
            status: 'processed',
            aiStatus: analysis ? 'success' : 'failed',
            replyStatus: replyResult?.skipped ? 'skipped' : replyResult ? 'sent' : 'none',
            notifyStatus: 'success',
            markSeenStatus: 'failed',
            error: error.message
          });
        });
      }
    } catch (error) {
      console.error('发送处理摘要通知失败:', error.message);
      await notifySystemError('发送处理摘要通知失败', error);
    } finally {
      const notifySuccess = notifyResult && !notifyResult.skipped;
      const markSeenSuccess = markSeenResult?.success;
      const markSeenStatus = markSeenResult?.pending
        ? 'pending'
        : markSeenSuccess
          ? 'success'
          : markSeenResult
            ? 'failed'
            : 'not_started';

      database.saveMailRecord(mail, {
        status: notifySuccess ? 'processed' : 'notify_failed',
        aiStatus: analysis ? 'success' : 'failed',
        replyStatus: replyResult?.skipped ? 'skipped' : replyResult ? 'sent' : 'none',
        notifyStatus: notifySuccess ? 'success' : 'failed',
        markSeenStatus,
        error: markSeenResult?.error || null
      });
    }
  }
}

async function main() {
  const accounts = loadAccounts(process.env.ACCOUNTS_CONFIG_PATH || 'accounts.json');
  database = createDatabase(process.env.DB_PATH || 'data/mail-service.db');
  aiOptions = loadAiOptions(process.env);
  smtpOptions = loadSmtpOptions(process.env);
  notifyOptions = loadNotifyOptions(process.env);
  const healthOptions = loadHealthOptions(process.env);
  runtimeStatus.accounts = accounts.map(account => ({
    name: account.name,
    provider: account.provider,
    enabled: account.enabled
  }));

  healthServer = startHealthServer({
    ...healthOptions,
    getStatus: () => ({
      ...runtimeStatus,
      database: database.getStats()
    })
  });

  const watchers = accounts.map(account => createMailWatcher({
    ...account.imap,
    smtp: account.smtp,
    onError: notifySystemError
  }));

  async function shutdown() {
    console.log('正在停止邮件监听服务...');
    await Promise.all(watchers.map(watcher => watcher.stop()));

    if (healthServer) {
      healthServer.close();
    }

    if (database) {
      database.close();
    }

    process.exit(0);
  }

  process.on('SIGINT', shutdown);

  process.on('SIGTERM', shutdown);

  console.log(`已加载 ${accounts.length} 个邮箱账号`);

  await Promise.all(watchers.map(watcher => watcher.start(handleNewMail)));
}

main().catch(error => {
  console.error('邮件监听服务启动失败:', error);
  process.exit(1);
});
