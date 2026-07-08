const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'portalnode.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

async function query(sql, params = []) {
  const stmt = getDb().prepare(sql);
  return stmt.all(...(Array.isArray(params) ? params : [params]));
}

async function execute(sql, params = []) {
  const stmt = getDb().prepare(sql);
  const info = stmt.run(...(Array.isArray(params) ? params : [params]));
  return { insertId: info.lastInsertRowid, affectedRows: info.changes };
}

async function transaction(workFn) {
  const conn = getDb();
  const wrapped = conn.transaction((arg) => workFn({
    query:  (sql, p = []) => conn.prepare(sql).all(...(Array.isArray(p) ? p : [p])),
    execute: (sql, p = []) => {
      const info = conn.prepare(sql).run(...(Array.isArray(p) ? p : [p]));
      return { insertId: info.lastInsertRowid, affectedRows: info.changes };
    }
  }));
  return wrapped();
}

function close() {
  if (db) { db.close(); db = null; }
}

module.exports = { getDb, query, execute, transaction, close };