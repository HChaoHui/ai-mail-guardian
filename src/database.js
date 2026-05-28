const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function now() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function stringify(value) {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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

  addColumnIfMissing(db, 'mail_records', 'analysis_json', 'TEXT');
  addColumnIfMissing(db, 'mail_records', 'reply_json', 'TEXT');
  addColumnIfMissing(db, 'mail_records', 'decision_json', 'TEXT');
  addColumnIfMissing(db, 'mail_records', 'source_risk_json', 'TEXT');

  const statements = {
    findByUid: db.prepare('SELECT * FROM mail_records WHERE account_name = ? AND uid = ? LIMIT 1'),
    findByMessageId: db.prepare('SELECT * FROM mail_records WHERE account_name = ? AND message_id = ? LIMIT 1'),
    upsert: db.prepare(`
      INSERT INTO mail_records (
        account_name, uid, message_id, subject, sender, status,
        ai_status, reply_status, notify_status, mark_seen_status,
        error, analysis_json, reply_json, decision_json, source_risk_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        analysis_json = COALESCE(excluded.analysis_json, mail_records.analysis_json),
        reply_json = COALESCE(excluded.reply_json, mail_records.reply_json),
        decision_json = COALESCE(excluded.decision_json, mail_records.decision_json),
        source_risk_json = COALESCE(excluded.source_risk_json, mail_records.source_risk_json),
        updated_at = excluded.updated_at
    `),
    recent: db.prepare(`
      SELECT account_name, uid, subject, sender, status, ai_status, reply_status,
        notify_status, mark_seen_status, error, updated_at
      FROM mail_records
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    list: db.prepare(`
      SELECT account_name, uid, subject, sender, status, ai_status, reply_status,
        notify_status, mark_seen_status, error, analysis_json, reply_json,
        decision_json, source_risk_json, created_at, updated_at
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
        stringify(record.analysis),
        stringify(record.replyResult),
        stringify(record.decision),
        stringify(record.sourceRisk),
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

    listMails(limit = 50) {
      return statements.list.all(Math.min(Number(limit) || 50, 200));
    },

    close() {
      db.close();
    }
  };
}

module.exports = {
  createDatabase
};
