-- 001_portalnode_diagnostico_tt.sqlite.sql
-- Schema SQLite para o PortalNode (substitui o .sql MySQL).
-- Como rodar:
--   node -e "require('./database').getDb().exec(require('fs').readFileSync('001_portalnode_diagnostico_tt.sqlite.sql', 'utf8'))"
-- Ou entao, de dentro do Node, qualquer chamada query/execute cria a conexao
-- e este script pode ser executado uma unica vez.

CREATE TABLE IF NOT EXISTS diagnosticos (
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
);

CREATE TABLE IF NOT EXISTS trouble_tickets (
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
);

-- Indices para as queries mais comuns
CREATE INDEX IF NOT EXISTS idx_diagnosticos_ambiente    ON diagnosticos(ambiente);
CREATE INDEX IF NOT EXISTS idx_diagnosticos_subscriber  ON diagnosticos(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_tt_ambiente               ON trouble_tickets(ambiente);
CREATE INDEX IF NOT EXISTS idx_tt_diagnostico           ON trouble_tickets(diagnostico_id);
CREATE INDEX IF NOT EXISTS idx_tt_status                ON trouble_tickets(status);