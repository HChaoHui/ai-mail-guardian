const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function now() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createDatabase(dbPath) {
  const resolvedPath = path.resolve(dbPath || 'data/mail-service.db');
  ensureDir(resolvedPath);

  const db = new DatabaseSync(resolvedPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name TEXT NOT NULL,
      uid TEXT NOT NULL,
      message_id TEXT,
      subject TEXT,
      sender TEXT,
      status TEXT NOT NULL,
      ai_status TEXT,
      reply_status TEXT,
      notify_status TEXT,
      mark_seen_status TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(account_name, uid)
    );

    CREATE INDEX IF NOT EXISTS idx_mail_records_message_id
    ON mail_records(account_name, message_id);
  `);

  const statements = {
    findByUid: db.prepare('SELECT * FROM mail_records WHERE account_name = ? AND uid = ? LIMIT 1'),
    findByMessageId: db.prepare('SELECT * FROM mail_records WHERE account_name = ? AND message_id = ? LIMIT 1'),
    upsert: db.prepare(`
      INSERT INTO mail_records (
        account_name, uid, message_id, subject, sender, status,
        ai_status, reply_status, notify_status, mark_seen_status,
        error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_name, uid) DO UPDATE SET
        message_id = excluded.message_id,
        subject = excluded.subject,
        sender = excluded.sender,
        status = excluded.status,
        ai_status = excluded.ai_status,
        reply_status = excluded.reply_status,
        notify_status = excluded.notify_status,
        mark_seen_status = excluded.mark_seen_status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `),
    recent: db.prepare(`
      SELECT account_name, uid, subject, sender, status, ai_status, reply_status,
        notify_status, mark_seen_status, error, updated_at
      FROM mail_records
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    counts: db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM mail_records
      GROUP BY status
    `)
  };

  return {
    isProcessed(mail) {
      const accountName = mail.accountName || mail.accountUser || '未知';
      const uidRecord = statements.findByUid.get(accountName, String(mail.uid));

      if (uidRecord?.status === 'processed') {
        return true;
      }

      if (!mail.messageId) {
        return false;
      }

      const messageRecord = statements.findByMessageId.get(accountName, mail.messageId);

      return messageRecord?.status === 'processed';
    },

    saveMailRecord(mail, record) {
      const timestamp = now();

      statements.upsert.run(
        mail.accountName || mail.accountUser || '未知',
        String(mail.uid),
        mail.messageId || null,
        mail.subject || null,
        mail.from || null,
        record.status,
        record.aiStatus || null,
        record.replyStatus || null,
        record.notifyStatus || null,
        record.markSeenStatus || null,
        record.error || null,
        timestamp,
        timestamp
      );
    },

    getStats() {
      const counts = {};

      for (const row of statements.counts.all()) {
        counts[row.status] = row.count;
      }

      return {
        counts,
        recent: statements.recent.all(10)
      };
    },

    close() {
      db.close();
    }
  };
}

module.exports = {
  createDatabase
};
