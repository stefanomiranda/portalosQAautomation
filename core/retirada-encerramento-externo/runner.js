// core/retirada-encerramento-externo/runner.js
//
// Orquestra os 3 steps da esteira de Retirada com Encerramento Externo no SOM:
//   1) loginSOM          — autentica no Oracle OSM
//   2) buscarWorklist    — localiza a OS de Retirada na Worklist (filtro por associatedDocument)
//   3) t063              — abre a Tarefa T063 (Retirar Equipamento) e encerra externamente
//
// Diferenças em relação a instalacao-encerramento-externo/runner.js:
//   - Sem passo de T046 (a retirada não associa equipamento — o equipamento já está em campo)
//   - 3 steps no indicador (vs. 4 da Instalação)
//   - Step final é t063 (vs. t017)
//   - Tag de log: [retirada-encerramento] (vs. [instalacao-encerramento])
//
// FIX: alinhado ao padrão de core/instalacao-encerramento-externo/browser.js
//   - Import dinâmico do Playwright (await import) — resolve o módulo real,
//     não o stub que o require() estava pegando.
//   - channel: 'msedge' desde o início (mesmo da Instalação).
//   - createSession + withSession para garantir cleanup robusto.

const path = require('path');
const fs = require('fs');

// Steps da esteira (todos do core/shared-som/, exceto t063 que é local)
const loginSOM         = require('../shared-som/loginSOM');
const buscarWorklist   = require('../shared-som/buscarWorklist');
const t063             = require('./steps/t063');

// Driver do Playwright — import dinâmico (ESM), mesmo padrão do browser.js da Instalação.
// Cache da promise para não reimportar a cada execução.
let _chromiumPromise = null;
function getChromium() {
  if (!_chromiumPromise) {
    _chromiumPromise = import('playwright')
      .then((m) => {
        console.log('[retirada-encerramento] playwright carregado: chromium=' + typeof m.chromium + ', hasLaunch=' + typeof m.chromium?.launch);
        return m.chromium;
      })
      .catch((e) => {
        console.warn('[retirada-encerramento] playwright não disponível:', e && e.message);
        return null;
      });
  }
  return _chromiumPromise;
}


/** Garante o diretório de artefatos (screenshots) por ambiente. */
function ensureArtifactsDir(ambiente, jobId) {
  const base = path.resolve(process.cwd(), 'internal/som-artifacts/retirada-encerramento-externo');
  const dir  = path.join(base, String(ambiente || 'TRG').toUpperCase(), jobId || 'no-job');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}


/**
 * Estrutura inicial dos steps do job (alimenta o GET /job/:id e o front).
 */
function buildSteps() {
  return [
    { name: 'loginSOM',        status: 'pendente', startedAt: null, finishedAt: null, log: [] },
    { name: 'buscarWorklist',  status: 'pendente', startedAt: null, finishedAt: null, log: [] },
    { name: 't063',            status: 'pendente', startedAt: null, finishedAt: null, log: [] },
  ];
}


/**
 * Cria uma sessão Playwright isolada (browser + context + page + helpers).
 * Mesmo padrão do core/instalacao-encerramento-externo/browser.js.
 */
async function createSession(opts = {}) {
  const { ambiente, jobId, onLog = () => {} } = opts;
  const log = (msg) => onLog(`[browser] ${msg}`);

  const chromium = await getChromium();
  if (!chromium) {
    throw new Error('runner: Playwright não está disponível no ambiente');
  }

  log(`lançando chromium (ambiente=${ambiente || '?'}, jobId=${jobId || '?'}, channel=msedge)`);

  const browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  /** Fecha page, context e browser silenciosamente (idempotente). */
  async function close() {
    try { await page.close(); } catch (_) { /* ignora */ }
    try { await context.close(); } catch (_) { /* ignora */ }
    try { await browser.close(); } catch (_) { /* ignora */ }
    log('sessão encerrada');
  }

  return { browser, context, page, close, log };
}


/**
 * Helper: cria sessão, executa `fn(session)`, garante fechamento mesmo em erro.
 * Se createSession lançar, o finally só age se a sessão chegou a existir.
 */
async function withSession(opts, fn) {
  let session;
  try {
    session = await createSession(opts);
    return await fn(session);
  } finally {
    if (session) {
      try { await session.close(); } catch (_) { /* ignora */ }
    }
  }
}


/**
 * Executa a esteira completa.
 *
 * @param {{
 *   jobId: string,
 *   sa: string,
 *   associatedDocument?: string,
 *   ambiente: 'TI'|'TRG'|'TRG2',
 *   credentials?: { user: string, pass: string } | null,
 *   ordemId: string,
 *   jobs: object,   // instância de jobs.js (para setStep/setStatus)
 *   onLog?: (msg: string) => void,
 * }} input
 * @returns {Promise<object>} result (consumido pelo persistence.js)
 */
async function executar(input) {
  const {
    jobId,
    sa,
    associatedDocument,
    ambiente,
    credentials = null,
    ordemId,
    jobs,
    onLog = () => {},
  } = input;

  if (!jobs) {
    throw new Error('runner.executar: `jobs` (módulo de jobs) é obrigatório');
  }

  const log = (m) => onLog(m);
  const STEP = { LOGIN: 0, WORKLIST: 1, T063: 2 };

  // Prepara estrutura de steps no job (para o front ver o indicador progredir)
  if (!input.jobRef) input.jobRef = { steps: buildSteps() };
  // Espelha no Map global
  const jobGlobal = jobs.getJob(jobId);
  if (jobGlobal) {
    if (!jobGlobal.steps || jobGlobal.steps.length === 0) {
      jobGlobal.steps = buildSteps();
    }
  }

  const artifactDir = ensureArtifactsDir(ambiente, jobId);
  log(`[retirada-encerramento] artefatos em: ${artifactDir}`);

  const startedAt = new Date().toISOString();
  let finalError = null;
  let result = null;

  try {
    result = await withSession(
      { ambiente, jobId, onLog },
      async (session) => {
        const { page } = session;

        // ─────────────────────────────────────────────────────────────────
        // Step 1: loginSOM
        // ─────────────────────────────────────────────────────────────────
        if (jobGlobal) jobs.setStep(jobId, STEP.LOGIN, jobs.STEP_STATUS.EM_ANDAMENTO);
        log(`[retirada-encerramento] step 1/3 — loginSOM (ambiente=${ambiente})`);
        try {
          await loginSOM({ page, ambiente, credentials, onLog });
          if (jobGlobal) jobs.setStep(jobId, STEP.LOGIN, jobs.STEP_STATUS.OK, 'loginSOM concluído');
          log(`[retirada-encerramento] ✓ loginSOM`);
        } catch (e) {
          if (jobGlobal) jobs.setStep(jobId, STEP.LOGIN, jobs.STEP_STATUS.ERRO, e.message);
          throw e;
        }

        // ─────────────────────────────────────────────────────────────────
        // Step 2: buscarWorklist
        // ─────────────────────────────────────────────────────────────────
        if (jobGlobal) jobs.setStep(jobId, STEP.WORKLIST, jobs.STEP_STATUS.EM_ANDAMENTO);
        log(`[retirada-encerramento] step 2/3 — buscarWorklist (sa=${sa}, ad=${associatedDocument || '?'})`);
        try {
          await buscarWorklist({ page, sa, associatedDocument, onLog });
          if (jobGlobal) jobs.setStep(jobId, STEP.WORKLIST, jobs.STEP_STATUS.OK, 'buscarWorklist concluído');
          log(`[retirada-encerramento] ✓ buscarWorklist`);
        } catch (e) {
          if (jobGlobal) jobs.setStep(jobId, STEP.WORKLIST, jobs.STEP_STATUS.ERRO, e.message);
          throw e;
        }

        // ─────────────────────────────────────────────────────────────────
        // Step 3: t063 (Retirar Equipamento + Encerramento Externo)
        // ─────────────────────────────────────────────────────────────────
        if (jobGlobal) jobs.setStep(jobId, STEP.T063, jobs.STEP_STATUS.EM_ANDAMENTO);
        log(`[retirada-encerramento] step 3/3 — t063 (Retirar Equipamento)`);
        try {
          await t063({
            page,
            sa,
            associatedDocument,
            ordemId,
            jobId,
            matricula: 'vt419418',
            onLog,
          });
          if (jobGlobal) jobs.setStep(jobId, STEP.T063, jobs.STEP_STATUS.OK, 'T063 concluída com sucesso');
          log(`[retirada-encerramento] ✓ t063`);
        } catch (e) {
          if (jobGlobal) jobs.setStep(jobId, STEP.T063, jobs.STEP_STATUS.ERRO, e.message);
          throw e;
        }

        return { ok: true };
      }
    );
  } catch (e) {
    finalError = e;
    log(`[retirada-encerramento] ERRO no runner: ${e.message}`);
  }

  if (finalError) {
    const err = new Error(finalError.message);
    err.stack = finalError.stack;
    throw err;
  }

  // Resultado final (consumido pelo persistence.js)
  const finishedAt = new Date().toISOString();
  return {
    jobId,
    ordemId:       ordemId || sa,
    saId:          sa,
    sa,
    associatedDocument: associatedDocument || null,
    ambiente,
    // Campos específicos de Retirada — preenchidos pelo persistence/builder se vierem
    matriculaTecnico:   'TR101010',
    numeroSerieRetirado: null,
    motivoRetirada:      null,
    startedAt,
    finishedAt,
    flowType:     'RetiradaEncerramentoExterno',
    status:       'encerrada_externo_retirada',
  };
}


module.exports = { executar, buildSteps, createSession, withSession };