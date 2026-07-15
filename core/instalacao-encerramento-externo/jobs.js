// core/instalacao-encerramento-externo/jobs.js
// Registro de jobs em memória, com lock por SA (uma execução por SA).
//
// Contrato:
//   criarJob({ sa, ambiente })            -> { jobId, status, steps: [], createdAt }
//   registrarLock(jobId, sa)              -> true (conseguiu) | { jobId, error } (bloqueado)
//   liberarLock(jobId)
//   getJob(id)                            -> job | null
//   setStep(jobId, index, status, log?)
//   setStatus(jobId, status)
//   listarPendentes(ambiente?)            -> jobs[]
//   listarBolsao(ambiente)                -> jobs[] (mesma shape que o FSL devolve)

const crypto = require('crypto');

/** Estados de um job. */
const STATUS = Object.freeze({
  PENDENTE: 'pendente',
  EM_ANDAMENTO: 'em_andamento',
  SUCESSO: 'sucesso',
  ERRO: 'erro',
  CANCELADO: 'cancelado',
});

/** Estados de cada step. */
const STEP_STATUS = Object.freeze({
  PENDENTE: 'pendente',
  EM_ANDAMENTO: 'em_andamento',
  OK: 'ok',
  ERRO: 'erro',
  PULADO: 'pulado',
});

/** Mapa principal: jobId -> job. */
const jobs = new Map();

/** Lock por SA: saId -> jobId. Garante 1 execução por SA. */
const lockPorSa = new Map();

/** Gera id curto. */
function novoId() {
  return 'ie_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Cria a estrutura inicial do job. NÃO registra o lock (faça isso no `iniciar`).
 *
 * @param {{ sa: string, ambiente: ('TI'|'TRG'|'TRG2') }} input
 * @returns {object} job
 */
function criarJob({ sa, ambiente }) {
  const jobId = novoId();
  const job = {
    jobId,
    sa,                 // canônico (SA-NNNNNN)
    ambiente,           // TI | TRG | TRG2
    status: STATUS.PENDENTE,
    steps: [],          // preenchido pelo runner
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    result: null,       // { codigoONT, numeroSerie, matricula, ... } no fim
    error: null,        // { message, stack, step? } no fim
  };
  jobs.set(jobId, job);
  return job;
}

/**
 * Tenta registrar o lock para a SA. Se já houver um job em andamento,
 * devolve `{ jobId: <job em andamento>, error: '...' }` e o caller responde 409.
 *
 * @param {string} jobId
 * @param {string} sa
 * @returns {true | { jobId: string, error: string }}
 */
function registrarLock(jobId, sa) {
  const existente = lockPorSa.get(sa);
  if (existente && existente !== jobId) {
    const job = jobs.get(existente);
    const status = job ? job.status : 'desconhecido';
    return {
      jobId: existente,
      error: `Já existe job em andamento para SA ${sa} (jobId=${existente}, status=${status})`,
    };
  }
  lockPorSa.set(sa, jobId);
  return true;
}

/** Libera o lock. Idempotente. */
function liberarLock(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  // Só remove se o lock atual ainda aponta pra este job (evita race)
  if (lockPorSa.get(job.sa) === jobId) {
    lockPorSa.delete(job.sa);
  }
}

/** Devolve o job pelo id, ou null. */
function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/** Atualiza o status global do job. */
function setStatus(jobId, status) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  if (status === STATUS.EM_ANDAMENTO && !job.startedAt) job.startedAt = new Date().toISOString();
  if (status === STATUS.SUCESSO || status === STATUS.ERRO || status === STATUS.CANCELADO) {
    job.finishedAt = new Date().toISOString();
  }
}

/** Atualiza o status de um step e, opcionalmente, anexa uma linha de log. */
function setStep(jobId, index, status, log) {
  const job = jobs.get(jobId);
  if (!job) return;
  const step = job.steps[index];
  if (!step) return;
  step.status = status;
  if (status === STEP_STATUS.EM_ANDAMENTO && !step.startedAt) step.startedAt = new Date().toISOString();
  if (status === STEP_STATUS.OK || status === STEP_STATUS.ERRO || status === STEP_STATUS.PULADO) {
    step.finishedAt = new Date().toISOString();
  }
  if (log) {
    step.log = step.log || [];
    step.log.push({ ts: new Date().toISOString(), msg: log });
  }
}

/**
 * Lista jobs pendentes/em andamento para o bolsão do front
 * (mesmo formato que o FSL retorna em /bolsao-pendentes).
 *
 * @param {('TI'|'TRG'|'TRG2')} ambiente
 * @returns {Array}
 */
function listarBolsao(ambiente) {
  const out = [];
  for (const job of jobs.values()) {
    if (ambiente && job.ambiente !== ambiente) continue;
    if (job.status === STATUS.SUCESSO || job.status === STATUS.CANCELADO) continue;
    out.push({
      saId: job.sa,
      subscriberId: job.result?.subscriberId || null,
      jobId: job.jobId,
      status: job.status,
      address: job.result?.address || null,
      slotDate: job.result?.slotDate || null,
      createdAt: job.createdAt,
    });
  }
  return out;
}

/** Lista jobs com status pendente/em andamento (para diagnóstico). */
function listarPendentes(ambiente) {
  const out = [];
  for (const job of jobs.values()) {
    if (job.status !== STATUS.PENDENTE && job.status !== STATUS.EM_ANDAMENTO) continue;
    if (ambiente && job.ambiente !== ambiente) continue;
    out.push({
      jobId: job.jobId,
      sa: job.sa,
      ambiente: job.ambiente,
      status: job.status,
      steps: job.steps.map((s) => ({ name: s.name, status: s.status })),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
    });
  }
  return out;
}

/** (Para debug) estado do lock. */
function dumpLock() {
  return Object.fromEntries(lockPorSa.entries());
}

module.exports = {
  STATUS,
  STEP_STATUS,
  criarJob,
  registrarLock,
  liberarLock,
  getJob,
  setStatus,
  setStep,
  listarBolsao,
  listarPendentes,
  dumpLock,
};