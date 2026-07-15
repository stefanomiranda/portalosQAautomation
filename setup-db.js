// setup-db.js
// Roda uma vez para criar o schema SQLite do PortalNode.
// Uso:  node setup-db.js

const path = require('path');
const fs   = require('fs');
const dbModule = require('./database');
const db = dbModule.getDb();

const statements = [

  // ===== subscriber_addresses (Retirada automática) =====
  `CREATE TABLE IF NOT EXISTS subscriber_addresses (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     subscriber_id        TEXT    NOT NULL,
     ambiente             TEXT    NOT NULL,
     cp                   TEXT,
     order_id             TEXT,
     correlation_order    TEXT,
     associated_document  TEXT,
     address_id           INTEGER,
     inventory_id         INTEGER,
     complement_type      TEXT,
     complement_value     TEXT,
     product_catalog_id   TEXT,
     flow_type            TEXT,
     created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
     UNIQUE(subscriber_id, ambiente)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_sa_subscriber_id
     ON subscriber_addresses(subscriber_id)`,

  `CREATE INDEX IF NOT EXISTS idx_sa_associated_document
     ON subscriber_addresses(associated_document)`,

  // ===== diagnosticos =====
  `CREATE TABLE IF NOT EXISTS diagnosticos (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     ambiente          TEXT    NOT NULL,
     cp                TEXT,
     subscriber_id     TEXT,
     status            TEXT    NOT NULL,
     suite             TEXT    NOT NULL DEFAULT 'SUITE_1',
     request_payload   TEXT,
     response_payload  TEXT,
     auditoria_payload TEXT,
     erro_msg          TEXT,
     created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE INDEX IF NOT EXISTS idx_diagnosticos_ambiente
     ON diagnosticos(ambiente)`,

  `CREATE INDEX IF NOT EXISTS idx_diagnosticos_subscriber
     ON diagnosticos(subscriber_id)`,

  // ===== trouble_tickets =====
  `CREATE TABLE IF NOT EXISTS trouble_tickets (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     ambiente             TEXT    NOT NULL,
     diagnostico_id       INTEGER,
     created_order_id     INTEGER,
     tt_id_externo        TEXT,
     tt_protocolo         TEXT,
     status               TEXT    NOT NULL DEFAULT 'ABERTO',
     t088_status          TEXT    NOT NULL DEFAULT 'PENDENTE_HUMANO',
     slot_id              TEXT,
     agendamento_id       TEXT,
     request_open         TEXT,
     response_open        TEXT,
     request_patch        TEXT,
     response_patch       TEXT,
     notificacoes_payload TEXT,
     erro_msg             TEXT,
     created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
     updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
   )`,

  `CREATE INDEX IF NOT EXISTS idx_tt_ambiente
     ON trouble_tickets(ambiente)`,

  `CREATE INDEX IF NOT EXISTS idx_tt_diagnostico
     ON trouble_tickets(diagnostico_id)`,

  `CREATE INDEX IF NOT EXISTS idx_tt_status
     ON trouble_tickets(status)`
     
   `CREATE TABLE IF NOT EXISTS seriais_usados (
   serial     TEXT PRIMARY KEY,
   tipo       TEXT NOT NULL,
   ordem_id   TEXT,
   sa_id      TEXT,
   job_id     TEXT,
   created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`
];

for (let i = 0; i < statements.length; i++) {
  try {
    db.exec(statements[i]);
  } catch (err) {
    console.error(`ERRO no statement #${i + 1}:`);
    console.error(statements[i]);
    console.error('-->', err.message);
    process.exit(1);
  }
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'portalnode.db');
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();

console.log('OK Schema criado.');
console.log('OK Arquivo do banco:', dbPath);
console.log('OK Arquivo existe?', fs.existsSync(dbPath) ? 'sim' : 'nao');
console.log('OK Tamanho:', fs.existsSync(dbPath) ? (fs.statSync(dbPath).size + ' bytes') : 'n/a');
console.log('OK Tabelas criadas:', tables.map(t => t.name).join(', '));

dbModule.close();