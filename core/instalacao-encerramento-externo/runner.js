// core/instalacao-encerramento-externo/runner.js
// Orquestrador da esteira Instalação com Encerramento Externo.

const { withSession } = require('./browser');
const { SEQUENCE } = require('./steps');
const jobs = require('./jobs');

function resolverAssociatedDocument({ sa, associatedDocument }) {
  if (associatedDocument) return associatedDocument;
  try {
    const { buscarPorSa } = require('./persistence');
    const reg = buscarPorSa(sa, null);
    if (reg && reg.associatedDocument) return reg.associatedDocument;
  } catch (_) {}
  return sa;
}

async function executar({ jobId, sa, ambiente, associatedDocument, ordemId, credentials, onLog = () => {} }) {
  const log = (m) => onLog(`[runner] ${m}`);

  if (!jobId)    throw new Error('runner.executar: jobId é obrigatório');
  if (!sa)       throw new Error('runner.executar: sa é obrigatória');
  if (!ambiente) throw new Error('runner.executar: ambiente é obrigatório');

  const job = jobs.getJob(jobId);
  if (job) {
    job.steps = SEQUENCE.map(({ name }) => ({
      name,
      status: jobs.STEP_STATUS.PENDENTE,
      startedAt: null,
      finishedAt: null,
      log: [],
    }));
  }

  const ad = resolverAssociatedDocument({ sa, associatedDocument });
  log(`associatedDocument de trabalho: ${ad}${ad !== sa ? ` (resolvido do bolsão; SA=${sa})` : ''}`);

  const result = {
    ordemId:          ordemId || sa,
    sa,
    associatedDocument: ad,
    ambiente,
    subscriberId:     null,
    address:          null,
    slotDate:         null,
    codigoONT:        null,
    numeroSerie:      null,
    matriculaTecnico: null,
    caboDrop:         null,
    encerradaEm:      null,
  };

  await withSession(
    { ambiente, jobId, onLog },
    async (session) => {
      const { page } = session;
      const ctx = {
        sa,
        associatedDocument: ad,
        ordemId: result.ordemId,
        jobId,
        page,
        session,
      };

      for (let i = 0; i < SEQUENCE.length; i++) {
        const { name, fn } = SEQUENCE[i];

        if (job) jobs.setStep(jobId, i, jobs.STEP_STATUS.EM_ANDAMENTO);
        log(`▶ ${name} (step ${i + 1}/${SEQUENCE.length})`);

        try {
          const stepResult = await fn({
            page,
            sa,
            associatedDocument: ad,
            ordemId: result.ordemId,
            jobId,
            credentials,                  // repassado para loginSOM
            onLog,
            ctx,
          });

          if (stepResult && typeof stepResult === 'object') {
            Object.assign(result, stepResult);
          }

          if (job) jobs.setStep(jobId, i, jobs.STEP_STATUS.OK, `step ${name} concluído`);
          log(`✔ ${name}`);
        } catch (err) {
          if (job) {
            jobs.setStep(jobId, i, jobs.STEP_STATUS.ERRO, (err && err.message) || String(err));
          }
          throw new Error(`Step ${name} falhou: ${(err && err.message) || err}`);
        }
      }
    }
  );

  if (!result.encerradaEm) result.encerradaEm = new Date().toISOString();

  log(`esteira concluída — codigoONT=${result.codigoONT}, numeroSerie=${result.numeroSerie}`);
  return result;
}

module.exports = {
  executar,
  resolverAssociatedDocument,
};