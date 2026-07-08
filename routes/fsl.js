// routes\fsl.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const runner  = require('../core/fsl/runner');
const webhook = require('../core/fsl/webhookEmail');

const jobs = new Map(); // jobId -> { status, createdAt, twoFaToken, result }

function log(msg) {
  console.log(`[FSL][route-fsl][INFO] ${msg}`);
}

function pickAmbiente(req) {
  return (req.query.ambiente || req.body?.ambiente || 'TRG').toString().toUpperCase();
}

function getBolaoOS() {
  try {
    const arr = (global.createdOrders && Array.isArray(global.createdOrders)) ? global.createdOrders : [];
    return arr;
  } catch (_) {
    return [];
  }
}

function isPendente(os) {
  if (!os) return false;
  if (os.status && /conclu[ií]d|encerrad|cancelad/i.test(String(os.status))) return false;
  return true;
}

function isVencida(os) {
  if (!os?.slotDate) return false;
  const t = Date.parse(os.slotDate);
  return Number.isFinite(t) && t < Date.now();
}

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    module: 'fsl',
    pending2fa: webhook.listPending().length,
    activeJobs: jobs.size,
    ts: new Date().toISOString(),
  });
});

router.get('/bolsao-pendentes', (req, res) => {
  const ambiente = pickAmbiente(req);
  const all = getBolaoOS();
  const filtered = all
    .filter(o => (o.ambiente || '').toString().toUpperCase() === ambiente)
    .filter(isPendente)
    .filter(o => !isVencida(o))
    .map(o => ({
      saId: o.saId,
      orderId: o.orderId,
      ambiente: o.ambiente,
      subscriberId: o.subscriberId,
      address: o.address,
      slotDate: o.slotDate,
      product: o.product || o.produto || null,
    }));

  res.json({ ok: true, ambiente, total: filtered.length, items: filtered });
});

// ---------- POST /instalar (ASYNC: retorna jobId imediatamente) ----------
router.post('/instalar', (req, res) => {
  const body = req.body || {};
  log(`POST /instalar ${JSON.stringify({
    sa: body.sa, ambiente: body.ambiente, fslUrl: body.fslUrl,
    fslUser: body.fslUser, fslPass: '***', dryRun: body.dryRun,
  })}`);

  const required = ['fslUrl', 'fslUser', 'fslPass'];
  if (body.dryRun !== 'login') required.push('sa');
  const missing = required.filter(k => !body[k]);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Campos obrigatórios faltando: ${missing.join(', ')}` });
  }

  const jobId = crypto.randomUUID();
  const twoFaToken = crypto.randomUUID();

  jobs.set(jobId, {
    status: 'running',
    createdAt: Date.now(),
    twoFaToken,
    result: null,
  });

  // Inicia em background — não bloqueia a resposta
  runner.run({
    fslUrl:  body.fslUrl,
    fslUser: body.fslUser,
    fslPass: body.fslPass,
    sa:      body.sa,
    ambiente: body.ambiente || 'TRG',
    dryRun:  body.dryRun || null,
    twoFaToken,
  }, console).then(result => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = result.ok ? 'completed' : 'failed';
      job.result = result;
    }
  }).catch(err => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.result = { ok: false, error: err.message };
    }
  });

  log(`job ${jobId.slice(0,8)}... iniciado (token 2FA: ${twoFaToken.slice(0,8)}...)`);

  // Resposta IMEDIATA: frontend já pode mostrar o input box
  res.json({ ok: true, jobId, twoFaToken });
});

// ---------- GET /job/:jobId (polling de status) ----------
router.get('/job/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'job não encontrado (servidor reiniciado?)' });
  }
  res.json({
    ok: true,
    jobId: req.params.jobId,
    status: job.status,
    twoFaToken: job.twoFaToken,
    result: job.result,
    ageMs: Date.now() - job.createdAt,
  });
});

router.post('/instalar/login', (req, res) => {
  req.body.dryRun = 'login';
  return router.handle(Object.assign(req, { url: '/instalar', method: 'POST' }), res, () => {});
});

router.post('/email-2fa', (req, res) => {
  const { token, code, from, subject } = req.body || {};
  if (!token || !code) {
    return res.status(400).json({ ok: false, error: 'token e code são obrigatórios' });
  }
  log(`webhook 2FA token=${token.slice(0,8)}... code=${String(code).length} dígitos from=${from || '?'} subject=${(subject || '').slice(0, 60)}`);
  const result = webhook.deliverCode(token, String(code).trim(), { from, subject });
  if (!result.ok) return res.status(404).json(result);
  res.json({ ok: true, token });
});

router.get('/2fa-token', (req, res) => {
  res.json({ ok: true, pending: webhook.listPending() });
});

module.exports = router;