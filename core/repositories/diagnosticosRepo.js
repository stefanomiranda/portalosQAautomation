// automation/diagnosticoJobsRepo.js
// Repositorio da tabela diagnostico_jobs.
// Cada job representa uma execução assíncrona do Diagnóstico V2 disparada
// pelo orquestrador /api/automation/diagnostico.
//
// Decisão de desenho: o resultado (NOK | SUCESSO) mora APENAS nesta tabela.
// A tabela diagnosticos continua intocada (NOK é inferido do response_payload).
//
// Anti-regressão: tiebreaker rowid DESC no findLatestActiveJob — datetime('now')
// do SQLite tem precisão de 1s, e 2 INSERTs no mesmo segundo recebem o mesmo
// started_at; sem o rowid DESC, o ORDER BY started_at DESC LIMIT 1 ficava
// instável (50% de chance de pegar o job errado).

const db = require('../../database');

// =====================================================================
// Helpers de mapeamento snake_case (DB) <-> camelCase (JS)
// =====================================================================

function rowToJob(row) {
  if (!row) return null;
  const safeParse = (v) => {
    if (v == null) return null;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return v; }
  };
  return {
    id: row.id,
    ambiente: row.ambiente,
    cp: row.cp,
    subscriberId: row.subscriber_id,
    gpon: row.gpon,
    status: row.status,
    diagnosticoId: row.diagnostico_id == null ? null : row.diagnostico_id,
    requestSnapshot: safeParse(row.request_snapshot),
    responseSnapshot: safeParse(row.response_snapshot),
    resultado: row.resultado,
    erroMsg: row.erro_msg,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    timeoutMs: row.timeout_ms
  };
}

function jobToRow(j) {
  return {
    id: j.id,
    ambiente: j.ambiente,
    cp: j.cp,
    subscriber_id: j.subscriberId,
    gpon: j.gpon,
    status: j.status,
    diagnostico_id: j.diagnosticoId == null ? null : j.diagnosticoId,
    request_snapshot: j.requestSnapshot != null ? JSON.stringify(j.requestSnapshot) : null,
    response_snapshot: j.responseSnapshot != null ? JSON.stringify(j.responseSnapshot) : null,
    resultado: j.resultado == null ? null : j.resultado,
    erro_msg: j.erroMsg == null ? null : j.erroMsg,
    timeout_ms: j.timeoutMs == null ? 900000 : j.timeoutMs
  };
}

// =====================================================================
// Criação
// =====================================================================

// Cria um job EM_ANDAMENTO. Retorna { insertId, affectedRows } seguindo o
// contrato do database.js (mesmo padrão do diagnosticosRepo).
async function createJob(job) {
  const r = jobToRow(job);
  const res = await db.execute(
    `INSERT INTO diagnostico_jobs
       (id, ambiente, cp, subscriber_id, gpon, status, request_snapshot, timeout_ms)
     VALUES (?, ?, ?, ?, ?, 'EM_ANDAMENTO', ?, ?)`,
    [r.id, r.ambiente, r.cp, r.subscriber_id, r.gpon, r.request_snapshot, r.timeout_ms]
  );
  return res; // { insertId, affectedRows }
}

// =====================================================================
// Leituras
// =====================================================================

// Busca um job por id. Retorna o objeto no formato camelCase ou null.
async function getJobById(id) {
  const rows = await db.query(
    `SELECT * FROM diagnostico_jobs WHERE id = ? LIMIT 1`,
    [id]
  );
  const arr = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  return rowToJob(arr[0] || null);
}

// Idempotência do POST /api/automation/diagnostico.
// Retorna o último job ainda "vivo" para o par (subscriber_id, gpon):
// status EM_ANDAMENTO ou CONCLUIDO com resultado != null (não expirou).
// Critério: started_at DESC com tiebreaker rowid DESC (anti-regressão).
async function findLatestActiveJob({ subscriberId, gpon }) {
  const rows = await db.query(
    `SELECT * FROM diagnostico_jobs
     WHERE subscriber_id = ? AND gpon = ?
       AND (
         status = 'EM_ANDAMENTO'
         OR (status = 'CONCLUIDO' AND resultado IS NOT NULL)
       )
     ORDER BY started_at DESC, rowid DESC
     LIMIT 1`,
    [subscriberId, gpon]
  );
  const arr = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  return rowToJob(arr[0] || null);
}

// Listar jobs orfãos (EM_ANDAMENTO) — usado no recovery on boot do PR6.
// rowid ASC para que o reprocessamento ocorra na ordem de criação.
async function listOrphanJobs() {
  const rows = await db.query(
    `SELECT * FROM diagnostico_jobs
     WHERE status = 'EM_ANDAMENTO'
     ORDER BY rowid ASC`
  );
  const arr = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  return arr.map(rowToJob);
}

// =====================================================================
// Atualizações
// =====================================================================

// Marca um job como CONCLUIDO com diagnosticoId, responseSnapshot e resultado.
async function completeJob(id, { diagnosticoId, responseSnapshot, resultado }) {
  return db.execute(
    `UPDATE diagnostico_jobs
     SET status = 'CONCLUIDO',
         diagnostico_id = ?,
         response_snapshot = ?,
         resultado = ?,
         finished_at = datetime('now')
     WHERE id = ?`,
    [
      diagnosticoId == null ? null : diagnosticoId,
      responseSnapshot != null ? JSON.stringify(responseSnapshot) : null,
      resultado == null ? null : resultado,
      id
    ]
  );
}

// Marca um job como ERRO com mensagem. Não altera finished_at — quem decide
// isso é o orquestrador (pode rerodar).
async function failJob(id, { erroMsg }) {
  return db.execute(
    `UPDATE diagnostico_jobs
     SET status = 'ERRO',
         erro_msg = ?,
         finished_at = datetime('now')
     WHERE id = ?`,
    [erroMsg == null ? null : String(erroMsg), id]
  );
}

// Marca um job como EXPIRADO. Disparado pelo recovery on boot do PR6 quando
// um job EM_ANDAMENTO ultrapassou timeout_ms.
async function expireJob(id) {
  return db.execute(
    `UPDATE diagnostico_jobs
     SET status = 'EXPIRADO',
         finished_at = datetime('now'),
         erro_msg = COALESCE(erro_msg, 'timeout excedido sem retorno do V2')
     WHERE id = ?`,
    [id]
  );
}

// Patch genérico de status (usado pelo orquestrador em transições intermediárias,
// se necessário). finished_at é setado sempre que status muda para terminal.
async function updateJobStatus(id, { status, finishedAt }) {
  return db.execute(
    `UPDATE diagnostico_jobs
     SET status = ?,
         finished_at = COALESCE(?, finished_at)
     WHERE id = ?`,
    [status, finishedAt == null ? null : finishedAt, id]
  );
}

// =====================================================================
// Exports
// =====================================================================

module.exports = {
  // criação
  createJob,
  // leituras
  getJobById,
  findLatestActiveJob,
  listOrphanJobs,
  // atualizações
  completeJob,
  failJob,
  expireJob,
  updateJobStatus,
  // helpers (úteis para testes de unidade)
  _rowToJob: rowToJob,
  _jobToRow: jobToRow
};