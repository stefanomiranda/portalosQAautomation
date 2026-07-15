// routes/retirada-encerramento.js
// Endpoints HTTP da esteira Retirada com Encerramento Externo no SOM.

const express = require('express');
const router  = express.Router();

const jobs         = require('../core/retirada-encerramento-externo/jobs');
const persistence  = require('../core/retirada-encerramento-externo/persistence');
const runner       = require('../core/retirada-encerramento-externo/runner');
const { normalizeSa } = require('../core/shared-som/utils');

const AMBIENTES = ['TI', 'TRG', 'TRG2'];

function validarBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Body ausente ou inválido');
  }
  const { sa, associatedDocument, ambiente, somUser, somPass } = body;
  if (!ambiente || !AMBIENTES.includes(String(ambiente).toUpperCase())) {
    throw new Error(`ambiente inválido: "${ambiente}". Esperado um de: ${AMBIENTES.join(', ')}`);
  }
  if (!sa || typeof sa !== 'string') {
    throw new Error('sa é obrigatória (ex: "123456" ou "SA-123456")');
  }
  if (somUser !== undefined && somUser !== null && (typeof somUser !== 'string' || somUser.length > 200)) {
    throw new Error('somUser inválido');
  }
  if (somPass !== undefined && somPass !== null && (typeof somPass !== 'string' || somPass.length > 500)) {
    throw new Error('somPass inválido');
  }
  return {
    sa: normalizeSa(sa),
    associatedDocument: associatedDocument ? String(associatedDocument).trim() : null,
    ambiente: String(ambiente).toUpperCase(),
    credentials: (somUser || somPass) ? { user: String(somUser || ''), pass: String(somPass || '') } : null,
  };
}


router.get('/health', (_req, res) => {
  res.json({ ok: true, module: 'retirada-encerramento', ts: new Date().toISOString() });
});

router.get('/bolsao-pendentes', (req, res) => {
  const ambiente = req.query.ambiente ? String(req.query.ambiente).toUpperCase() : null;
  try {
    const items = persistence.listarEncerradasExterno(ambiente);
    res.json({ ok: true, ambiente, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

router.post('/iniciar', async (req, res) => {
  let input;
  try {
    input = validarBody(req.body);
  } catch (e) {
    return res.status(400).json({ ok: false, error: (e && e.message) || String(e) });
  }

  const job = jobs.criarJob({ sa: input.sa, ambiente: input.ambiente });

  const lockResult = jobs.registrarLock(job.jobId, input.sa);
  if (lockResult !== true) {
    return res.status(409).json({
      ok: false,
      error: lockResult.error,
      jobId: lockResult.jobId,
      jobEmAndamento: jobs.getJob(lockResult.jobId),
    });
  }

  jobs.setStatus(job.jobId, jobs.STATUS.EM_ANDAMENTO);

  const onLog = (msg) => {
    console.log(`[retirada-encerramento ${job.jobId}] ${msg}`);
  };

  (async () => {
    try {
      const result = await runner.executar({
        jobId: job.jobId,
        sa: input.sa,
        associatedDocument: input.associatedDocument,
        ambiente: input.ambiente,
        credentials: input.credentials,
        ordemId: input.sa,
        jobs,
        onLog,
      });

      let persistError = null;
      try {
        const persist = persistence.persistir(result);
        if (persist.sqlite && !persist.sqlite.ok) persistError = persist.sqlite.error;
        job.result = result;
        job.persistError = persistError;
      } catch (e) {
        persistError = (e && e.message) || String(e);
        job.persistError = persistError;
      }

      jobs.setStatus(job.jobId, jobs.STATUS.SUCESSO);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      job.error = { message: msg, ts: new Date().toISOString() };
      jobs.setStatus(job.jobId, jobs.STATUS.ERRO);
      console.error(`[retirada-encerramento ${job.jobId}] ERRO: ${msg}`);
    } finally {
      jobs.liberarLock(job.jobId);
    }
  })();

  res.status(202).json({
    ok: true,
    jobId: job.jobId,
    sa: input.sa,
    ambiente: input.ambiente,
    status: job.status,
    steps: job.steps.map((s) => s.name),
    message: 'Esteira iniciada em background. Acompanhe via GET /job/:id',
  });
});

router.get('/job/:id', (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'job não encontrado' });
  }
  res.json({
    ok: true,
    jobId: job.jobId,
    sa: job.sa,
    ambiente: job.ambiente,
    status: job.status,
    steps: job.steps,
    result: job.result,
    error: job.error,
    persistError: job.persistError,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

router.get('/jobs/pendentes', (req, res) => {
  const ambiente = req.query.ambiente ? String(req.query.ambiente).toUpperCase() : null;
  res.json({ ok: true, items: jobs.listarPendentes(ambiente) });
});

router.get('/bolsao', (req, res) => {
  const ambiente = req.query.ambiente ? String(req.query.ambiente).toUpperCase() : null;
  try {
    const items = persistence.listarBolsao(ambiente);
    res.json({ ok: true, ambiente, count: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
});

module.exports = router;
