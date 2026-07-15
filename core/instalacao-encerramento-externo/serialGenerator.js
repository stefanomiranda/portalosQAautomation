// core/instalacao-encerramento-externo/serialGenerator.js
// Gerador de códigos únicos para o equipamento da OS na T046.
// Formato: 6 dígitos + 2 letras maiúsculas (ex: 123456AB).
// Anti-colisão: persiste cada candidato em `seriais_usados` (PK = serial).
//               Em colisão, gera outro candidato e tenta de novo.

const { getDb } = require('../../database');

// Resolve a instância de better-sqlite3 sob demanda.
// getDb() é um singleton (cache interno) — chamar várias vezes retorna a mesma conexão.
function db() {
  return getDb();
}

const MAX_TENTATIVAS = 20;

/** Tipos aceitos. Reservamos nomes estáveis para auditoria e consultas futuras. */
const TIPOS = Object.freeze({
  CODIGO_ONT: 'codigo_ont',
  NUMERO_SERIE: 'numero_serie',
});

/** Gera string aleatória no formato NNNNNNLL (6 dígitos + 2 letras maiúsculas). */
function gerarCandidato() {
  const digitos = Array.from(
    { length: 6 },
    () => Math.floor(Math.random() * 10)
  ).join('');
  const letras = Array.from(
    { length: 2 },
    () => String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).join('');
  return digitos + letras;
}

/**
 * Reserva 1 serial no banco. Lança erro após MAX_TENTATIVAS colisões consecutivas.
 *
 * @param {string} tipo     - 'codigo_ont' | 'numero_serie'
 * @param {object} ctx
 * @param {string} ctx.sa
 * @param {string} [ctx.ordemId]
 * @param {string} [ctx.jobId]
 * @returns {string} serial reservado
 */
function reservarSerial(tipo, ctx) {
  if (!Object.values(TIPOS).includes(tipo)) {
    throw new Error(`Tipo inválido: "${tipo}". Esperado um de: ${Object.values(TIPOS).join(', ')}`);
  }
  if (!ctx || !ctx.sa) {
    throw new Error('ctx.sa é obrigatório para reservar serial');
  }

  const stmt = db().prepare(`
    INSERT OR IGNORE INTO seriais_usados (serial, tipo, ordem_id, sa_id, job_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    const candidato = gerarCandidato();
    const result = stmt.run(
      candidato,
      tipo,
      ctx.ordemId || null,
      ctx.sa,
      ctx.jobId || null
    );
    if (result.changes === 1) {
      return candidato;
    }
    // changes === 0 → PK duplicado (já existia). Tenta outro candidato.
  }

  throw new Error(
    `Não foi possível gerar serial único após ${MAX_TENTATIVAS} tentativas (tipo=${tipo}, sa=${ctx.sa})`
  );
}

/**
 * Gera o par (codigoONT, numeroSerie) para a T046, persistindo ambos.
 * Cada valor vira uma linha em `seriais_usados` com seu `tipo`.
 *
 * @param {{ sa: string, ordemId?: string, jobId?: string }} ctx
 * @returns {{ codigoONT: string, numeroSerie: string }}
 */
function gerarPares(ctx) {
  if (!ctx || !ctx.sa) {
    throw new Error('gerarPares exige ctx.sa');
  }
  return {
    codigoONT:   reservarSerial(TIPOS.CODIGO_ONT,    ctx),
    numeroSerie: reservarSerial(TIPOS.NUMERO_SERIE,  ctx),
  };
}

/**
 * Lista seriais (para debug / endpoint admin do card).
 *
 * @param {object} [opts]
 * @param {string} [opts.sa]      - filtra por SA
 * @param {string} [opts.tipo]    - 'codigo_ont' | 'numero_serie'
 * @param {number} [opts.limit=50]
 * @returns {Array}
 */
function listarSeriais(opts = {}) {
  const where = [];
  const params = [];
  if (opts.sa)   { where.push('sa_id = ?'); params.push(opts.sa); }
  if (opts.tipo) { where.push('tipo = ?');   params.push(opts.tipo); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit || 50, 500));
  params.push(limit);
  return db()
    .prepare(`SELECT * FROM seriais_usados ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...params);
}

module.exports = {
  TIPOS,
  MAX_TENTATIVAS,
  gerarCandidato,
  reservarSerial,
  gerarPares,
  listarSeriais,
};