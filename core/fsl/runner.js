// core\fsl\runner.js
//
// Orquestrador do fluxo FSL.
// Gera um token 2FA, passa para o step de login, executa os 8 steps
// sequencialmente, devolve { saId, senha, steps, logs, twoFaToken }.

const crypto = require('crypto');
const FSL_CONFIG = require('./config');
const { launchBrowser, closeBrowser } = require('./browser');
const webhookEmail = require('./webhookEmail');
const STEPS = require('./steps');

function makeRunnerLogger(logger) {
  return {
    log:   (m) => logger.log?.(`[FSL][runner] ${m}`),
    warn:  (m) => logger.warn?.(`[FSL][runner] ${m}`),
    error: (m) => logger.error?.(`[FSL][runner] ${m}`),
  };
}

function pickSteps(dryRun) {
  if (dryRun === 'login') {
    return STEPS.filter(s => s.name === 'login');
  }
  return STEPS;
}

async function run(input, baseLogger = console) {
  const logger = makeRunnerLogger(baseLogger);
  const { fslUrl, fslUser, fslPass, sa, ambiente } = input;

  if (!fslUrl)  throw new Error('runner: fslUrl é obrigatório');
  if (!fslUser) throw new Error('runner: fslUser é obrigatório');
  if (!fslPass) throw new Error('runner: fslPass é obrigatório');
  if (input.dryRun !== 'login' && !sa) {
    throw new Error('runner: SA é obrigatório no fluxo completo');
  }

  const twoFaToken = input.twoFaToken || crypto.randomUUID();
  const ctx = {
    input: {
      ...input,
      ambiente: ambiente || 'TRG',
      twoFaToken,
    },
    page: null,
    browser: null,
    context: null,
    senha: null,
    steps: [],
    logs: [],
  };

  const stepsToRun = pickSteps(input.dryRun);
  logger.log(`iniciando fluxo FSL (${stepsToRun.length} step(s))${input.dryRun ? ` [dryRun=${input.dryRun}]` : ''}`);
  logger.log(`SA=${sa || '(dry-run)'} | ambiente=${ctx.input.ambiente} | url=${fslUrl}`);
  logger.log(`token 2FA: ${twoFaToken}`);

  const { browser, context, page } = await launchBrowser({ logger: baseLogger, stepName: 'session' });
  ctx.browser = browser;
  ctx.context = context;
  ctx.page = page;

  try {
    for (const stepMod of stepsToRun) {
      logger.log(`---- step: ${stepMod.name} ----`);
      try {
        await stepMod.step(ctx);
        logger.log(`step ${stepMod.name} OK`);
      } catch (err) {
        logger.error(`step ${stepMod.name} falhou: ${err.message}`);
        throw err;
      }
    }

    return {
      ok: true,
      saId: sa,
      senha: ctx.senha,
      steps: ctx.steps,
      twoFaToken,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      steps: ctx.steps,
      twoFaToken,
    };
  } finally {
    if (twoFaToken) webhookEmail.cancelPending(twoFaToken, 'runner_finalizado');
    await closeBrowser({ browser, context }, { logger: baseLogger });
  }
}

module.exports = { run };