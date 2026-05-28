const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const DEFAULT_RECONNECT_DELAY = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(message);
      error.code = 'Timeout';
      reject(error);
    }, ms);
  });
}

function isNoConnectionError(error) {
  return error?.code === 'NoConnection' || /connection not available/i.test(error?.message || '');
}

function createMailWatcher(options) {
  const processedUids = new Set();
  let stopped = false;
  let client = null;

  async function markMessageSeen(uid) {
    if (!options.markSeen) {
      return;
    }

    try {
      let timedOut = false;
      const markSeenTask = client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });

      markSeenTask
        .then(() => {
          if (timedOut) {
            console.log(`邮件已读状态已同步完成: ${options.accountName} UID=${uid}`);
          }
        })
        .catch(error => {
          if (timedOut && !isNoConnectionError(error)) {
            console.error(`邮件已读状态后台同步失败: ${options.accountName} UID=${uid}`, error.message);
          }
        });

      await Promise.race([
        markSeenTask,
        timeoutAfter(options.markSeenTimeout, `标记已读超过 ${options.markSeenTimeout}ms`)
      ]);
      console.log(`邮件已标记为已读: ${options.accountName} UID=${uid}`);
      return { success: true };
    } catch (error) {
      if (error.code === 'Timeout') {
        console.warn(`标记已读等待超时，已交给 IMAP 后台继续同步: ${options.accountName} UID=${uid}`);
        return { success: true, pending: true };
      }

      if (isNoConnectionError(error)) {
        console.warn(`标记邮件已读时连接已断开，将等待重连后继续监听: ${options.accountName} UID=${uid}`);
        return { success: false, error: 'IMAP 连接已断开' };
      }

      console.error(`标记邮件已读失败: ${options.accountName} UID=${uid}`, error.message);
      return { success: false, error: error.message };
    }
  }

  async function moveMessage(uid, targetMailbox) {
    if (!targetMailbox) {
      return { success: true, skipped: true };
    }

    try {
      await client.messageMove(uid, targetMailbox, { uid: true });
      console.log(`邮件已移动: ${options.accountName} UID=${uid} -> ${targetMailbox}`);
      return { success: true };
    } catch (error) {
      if (isNoConnectionError(error)) {
        console.warn(`移动邮件时连接已断开: ${options.accountName} UID=${uid}`);
        return { success: false, error: 'IMAP 连接已断开' };
      }

      console.error(`移动邮件失败: ${options.accountName} UID=${uid} -> ${targetMailbox}`, error.message);
      return { success: false, error: error.message };
    }
  }

  async function processUnseenMessages(onNewMail) {
    const messages = client.fetch(
      { seen: false },
      {
        uid: true,
        envelope: true,
        source: true
      }
    );

    for await (const message of messages) {
      if (processedUids.has(message.uid)) {
        continue;
      }

      processedUids.add(message.uid);

      const parsed = await simpleParser(message.source);
      const returnPath = parsed.headers?.get('return-path');

      await onNewMail({
        accountName: options.accountName,
        accountUser: options.user,
        smtp: options.smtp,
        mailbox: options.mailbox,
        uid: message.uid,
        messageId: parsed.messageId,
        from: parsed.from?.text,
        replyTo: parsed.replyTo?.text,
        returnPath: returnPath ? String(returnPath) : undefined,
        to: parsed.to?.text,
        cc: parsed.cc?.text,
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        date: parsed.date,
        attachments: parsed.attachments,
        markSeen: () => markMessageSeen(message.uid),
        moveTo: targetMailbox => moveMessage(message.uid, targetMailbox)
      });
    }
  }

  async function connectAndWatch(onNewMail) {
    client = new ImapFlow({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: {
        user: options.user,
        pass: options.pass
      },
      logger: false
    });

    client.on('error', error => {
      if (isNoConnectionError(error)) {
        console.warn(`IMAP 连接已断开: ${options.accountName}`);
        return;
      }

      console.error('IMAP 连接错误:', error.message);
      options.onError?.(`IMAP 连接错误: ${options.accountName}`, error);
    });

    await client.connect();

    const lock = await client.getMailboxLock(options.mailbox);

    try {
      console.log(`IMAP 已连接，正在监听账号: ${options.accountName}，邮箱目录: ${options.mailbox}`);

      await processUnseenMessages(onNewMail);

      client.on('exists', async () => {
        try {
          await processUnseenMessages(onNewMail);
        } catch (error) {
          if (isNoConnectionError(error)) {
            console.warn(`处理新邮件时连接已断开，将由外层自动重连: ${options.accountName}`);
            return;
          }

          console.error('处理新邮件失败:', error);
          options.onError?.(`处理新邮件失败: ${options.accountName}`, error);
        }
      });

      await new Promise((resolve, reject) => {
        client.once('close', resolve);
        client.once('error', reject);
      });
    } finally {
      lock.release();

      if (!client.closed) {
        await client.logout().catch(() => {});
      }
    }
  }

  return {
    async start(onNewMail) {
      while (!stopped) {
        try {
          await connectAndWatch(onNewMail);
        } catch (error) {
          if (isNoConnectionError(error)) {
            console.warn(`IMAP 连接不可用，准备重连: ${options.accountName}`);
          } else {
            console.error('IMAP 监听中断:', error.message);
            options.onError?.(`IMAP 监听中断: ${options.accountName}`, error);
          }
        }

        if (!stopped) {
          console.log(`${options.reconnectDelay}ms 后尝试重连 IMAP...`);
          await sleep(options.reconnectDelay);
        }
      }
    },

    async stop() {
      stopped = true;

      if (client) {
        await client.logout().catch(() => {});
      }
    }
  };
}

module.exports = {
  createMailWatcher
};
