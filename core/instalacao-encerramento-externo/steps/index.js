// core/instalacao-encerramento-externo/steps/index.js
// Barrel dos steps da esteira Instalação com Encerramento Externo.
//
// Cada step é um módulo isolado, com a mesma assinatura:
//   async function step({ page, sa, ambiente, onLog, ctx, helpers }) { ... }
//
// O runner importa daqui:
//   const steps = require('./steps');
//   await steps.loginSOM({ page, ... });
//
// A ordem abaixo reflete o fluxo descrito no documento "Doc Ordem de
// Instalação com Encerramento Externo" (T046 antes de T017, conforme o
// próprio doc orienta). A etapa de auditoria SOA foi removida do escopo
// desta esteira por decisão do time — o encerramento termina na T017.

const loginSOM        = require('./loginSOM');
const buscarWorklist  = require('./buscarWorklist');
const t046            = require('./t046');
const t017            = require('./t017');

/** Sequência canônica executada pelo runner. */
const SEQUENCE = [
  { name: 'loginSOM',       fn: loginSOM },
  { name: 'buscarWorklist', fn: buscarWorklist },
  { name: 't046',           fn: t046 },
  { name: 't017',           fn: t017 },
];

module.exports = {
  SEQUENCE,
  loginSOM,
  buscarWorklist,
  t046,
  t017,
};