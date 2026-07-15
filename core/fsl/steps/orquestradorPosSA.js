// core/fsl/steps/orquestradorPosSA.js
//
// Orquestrador do fluxo pos-busca da SA.
//
// Fluxo, derivado do documento "Conclusao de Instalacao via FSL":
//   1) Antecipacao            - so se o status permite
//   2) Marcar como Completo   - loop ate status = "Em Execucao" OU
//                               botao "Consumo" aparecer (o que vier 1o)
//   3) Consumo de Material
//   4) Consumo de Equipamento
//   5) Ver Senha              - salva a senha em ctx.senhaInstalacao
//   6) Encerramento           - usa ctx.senhaInstalacao
//
// Arquitetura: state machine linear. Cada fase re-detecta o estado
// uma unica vez e executa o que precisa. Nao ha `continue` em loop
// de deteccao, que era a fonte da regressao das 8 iteracoes.

const { makeLogger, takeScreenshot } = require('../utils');
const { detectarEstadoSA } = require('./detectarEstadoSA');
const anteciparStatus = require('./anteciparStatus');
const concluirStatus = require('./concluirStatus');
const consumoMateriais = require('./consumoMateriais');
const consumoEquipamentos = require('./consumoEquipamentos');
const encerramento = require('./encerramento');

// verSenha pode nao existir ainda. Carrega com seguranca para o
// orquestrador nao quebrar quando o modulo ainda nao foi criado.
let verSenha = null;
try { verSenha = require('./verSenha'); } catch (_) { /* modulo ausente */ }

const STEP_NAME = 'orquestradorPosSA';
const MAX_MARCAR_ITER = 5; // 3 cliques costuma bastar; 5 e folga

// Status que indicam SA ja em curso - antecipar nao e aplicavel.
// Casa PT-BR e EN. Usa \u escapes para o TS nao reclamar.
// (aceita "On the move", "Em deslocamento", "In Progress",
//  "Em Execucao", "Dispatched", "Despachado", "Completed",
//  "Concluido", "Canceled", "Cannot Complete", etc.)
const STATUS_EM_CURSO =
  /on the move|em deslocamento|in progress|em execu[\u00e7c][a\u00e3]o|dispatched|despachado|completed|conclu[i\u00ed]do|canceled|cancelado|can\s*not complete|cannot complete|n[a\u00e3]o\s+pode\s+concluir/i;

// Status que indicam SA em "Em Execucao" - alvo do loop de marcar.
const STATUS_EM_EXECUCAO = /em execu[\u00e7c][a\u00e3]o|in progress/i;

async function tentarStep(ctx, log, stepModule, nome) {
  if (!stepModule || typeof stepModule.step !== 'function') {
    log.log(`\u26A0\uFE0F step ${nome} nao disponivel (modulo ausente)`);
    return { ok: false, skipped: true, motivo: 'modulo ausente' };
  }
  try {
    log.log(`\u25B6 executando step: ${nome}`);
    await stepModule.step(ctx);
    log.log(`\u2705 step ${nome} concluido`);
    return { ok: true };
  } catch (e) {
    const msg = (e.message || '').slice(0, 250);
    const isExpectedSkip =
      /nem\s+".+"\s+encontrad/i.test(msg) ||
      /n[a\u00e3]o\s+foi\s+poss[i\u00ed]vel\s+(?:localizar|efetivar)/i.test(msg) ||
      /timeout.*exceeded/i.test(msg) ||
      /bot[a\u00e3]o.*n[a\u00e3]o\s+(?:foi\s+)?(?:encontrado|habilitou)/i.test(msg) ||
      /skipped/i.test(msg);

    if (isExpectedSkip) {
      log.log(`\u26A0\uFE0F step ${nome} pulado (nao aplicavel): ${msg}`);
      return { ok: false, skipped: true, motivo: msg };
    }
    log.log(`\u274C step ${nome} falhou: ${msg}`);
    return { ok: false, skipped: false, erro: msg };
  }
}

async function safeScreen(ctx, log, suffix) {
  return takeScreenshot(ctx.page, STEP_NAME, suffix).catch(() => {});
}

async function step(ctx) {
  const log = makeLogger(STEP_NAME);

  log.log('\u2550\u2550\u2550 orquestradorPosSA iniciado \u2550\u2550\u2550');
  ctx.passosExecutados = ctx.passosExecutados || [];
  ctx.estadosPorFase = [];

  // =================================================================
  // FASE 1: Antecipacao
  //   - 1 unica deteccao de estado. 1 unica chamada (ou skip).
  //   - Nao ha loop aqui, entao nao ha como regredir.
  // =================================================================
  log.log('\u2500\u2500 fase 1/6: antecipacao \u2500\u2500');
  const estado1 = await detectarEstadoSA(ctx);
  ctx.estadosPorFase.push({ fase: 'antecipacao', estado: estado1 });

  if (!estado1.anteciparDisponivel) {
    log.log('antecipar pulado: botao "Antecipacao"/"Antecipar Status" nao esta visivel');
    ctx.passosExecutados.push({
      step: 'anteciparStatus', ok: false, skipped: true, motivo: 'botao nao disponivel',
    });
  } else if (STATUS_EM_CURSO.test(estado1.statusTexto)) {
    log.log(`antecipar pulado: status "${estado1.statusTexto}" indica SA ja em curso`);
    ctx.passosExecutados.push({
      step: 'anteciparStatus', ok: false, skipped: true, motivo: 'status em curso',
    });
  } else {
    await safeScreen(ctx, log, 'fase1-antecipar-antes');
    const r = await tentarStep(ctx, log, anteciparStatus, 'anteciparStatus');
    ctx.passosExecutados.push({ step: 'anteciparStatus', ...r });
    await safeScreen(ctx, log, 'fase1-antecipar-depois');
  }

  // =================================================================
  // FASE 2: Marcar Status como Completo (loop)
  //   - Sai quando:
  //       (a) status == "Em Execucao" / "In Progress"   OU
  //       (b) botao de Consumo visivel                   OU
  //       (c) botao "Marcar" nao esta visivel           OU
  //       (d) atingiu MAX_MARCAR_ITER (defesa)
  // =================================================================
  log.log('\u2500\u2500 fase 2/6: marcar como completo (loop) \u2500\u2500');
  let marcarIter = 0;
  let marcarSaiuPor = 'nao_executado';

  while (marcarIter < MAX_MARCAR_ITER) {
    marcarIter++;

    let estado2;
    try {
      estado2 = await detectarEstadoSA(ctx);
    } catch (e) {
      log.log(`\u26A0\uFE0F falha em detectar estado na iteracao ${marcarIter}: ${e.message.slice(0, 200)}`);
      break;
    }
    ctx.estadosPorFase.push({ fase: `marcar_iter_${marcarIter}`, estado: estado2 });

    if (STATUS_EM_EXECUCAO.test(estado2.statusTexto)) {
      log.log(`[marcar] it ${marcarIter}: status "${estado2.statusTexto}" \u2192 ja em execucao, saindo do loop`);
      marcarSaiuPor = 'status_em_execucao';
      break;
    }
    if (estado2.consumoDisponivel) {
      log.log(`[marcar] it ${marcarIter}: botao de Consumo apareceu, saindo do loop`);
      marcarSaiuPor = 'botao_consumo_visivel';
      break;
    }
    if (!estado2.marcarDisponivel) {
      log.log(`[marcar] it ${marcarIter}: botao "Marcar Status como Completo" nao esta visivel, saindo do loop`);
      marcarSaiuPor = 'botao_marcar_indisponivel';
      break;
    }

    log.log(`[marcar] it ${marcarIter}: status="${estado2.statusTexto}" | clicando "Marcar Status como Completo"`);
    await safeScreen(ctx, log, `fase2-marcar-iter-${marcarIter}-antes`);
    const r = await tentarStep(ctx, log, concluirStatus, 'concluirStatus');
    ctx.passosExecutados.push({ step: 'concluirStatus', iter: marcarIter, ...r });
    await safeScreen(ctx, log, `fase2-marcar-iter-${marcarIter}-depois`);
  }

  if (marcarIter >= MAX_MARCAR_ITER) {
    log.log(`\u26A0\uFE0F loop de marcar atingiu limite de ${MAX_MARCAR_ITER} iteracoes`);
    marcarSaiuPor = 'max_iter';
  }

  log.log(`[marcar] loop encerrado apos ${marcarIter} iteracao(oes) | saiu por: ${marcarSaiuPor}`);

  // =================================================================
  // FASE 3: Consumo de Material
  // =================================================================
  log.log('\u2500\u2500 fase 3/6: consumo de material \u2500\u2500');
  {
    const estado3 = await detectarEstadoSA(ctx);
    ctx.estadosPorFase.push({ fase: 'consumo_material', estado: estado3 });

    if (estado3.consumoDisponivel) {
      await safeScreen(ctx, log, 'fase3-consumo-material-antes');
      const r = await tentarStep(ctx, log, consumoMateriais, 'consumoMateriais');
      ctx.passosExecutados.push({ step: 'consumoMateriais', ...r });
      await safeScreen(ctx, log, 'fase3-consumo-material-depois');
    } else {
      log.log('consumo de material pulado: botao nao disponivel');
      ctx.passosExecutados.push({
        step: 'consumoMateriais', ok: false, skipped: true, motivo: 'botao nao disponivel',
      });
    }
  }

  // =================================================================
  // FASE 4: Consumo de Equipamento
  // =================================================================
  log.log('\u2500\u2500 fase 4/6: consumo de equipamento \u2500\u2500');
  {
    const estado4 = await detectarEstadoSA(ctx);
    ctx.estadosPorFase.push({ fase: 'consumo_equipamento', estado: estado4 });

    if (estado4.consumoDisponivel) {
      await safeScreen(ctx, log, 'fase4-consumo-equipamento-antes');
      const r = await tentarStep(ctx, log, consumoEquipamentos, 'consumoEquipamentos');
      ctx.passosExecutados.push({ step: 'consumoEquipamentos', ...r });
      await safeScreen(ctx, log, 'fase4-consumo-equipamento-depois');
    } else {
      log.log('consumo de equipamento pulado: botao nao disponivel');
      ctx.passosExecutados.push({
        step: 'consumoEquipamentos', ok: false, skipped: true, motivo: 'botao nao disponivel',
      });
    }
  }

  // =================================================================
  // FASE 5: Ver Senha
  //   - Captura a senha e armazena em ctx.senhaInstalacao
  //   - O step encerramento le esse valor
  // =================================================================
  log.log('\u2500\u2500 fase 5/6: ver senha \u2500\u2500');
  {
    const estado5 = await detectarEstadoSA(ctx);
    ctx.estadosPorFase.push({ fase: 'ver_senha', estado: estado5 });

    if (verSenha) {
      await safeScreen(ctx, log, 'fase5-ver-senha-antes');
      const r = await tentarStep(ctx, log, verSenha, 'verSenha');
      ctx.passosExecutados.push({ step: 'verSenha', ...r });
      await safeScreen(ctx, log, 'fase5-ver-senha-depois');

      if (ctx.senhaInstalacao) {
        const len = String(ctx.senhaInstalacao).length;
        const masked = '*'.repeat(Math.min(len, 20));
        log.log(`\u2705 senha capturada em ctx.senhaInstalacao (${masked}, length=${len})`);
      } else {
        log.log('\u26A0\uFE0F verSenha executou mas ctx.senhaInstalacao nao foi preenchida');
        log.log('   verifique se o step verSenha salva o valor em ctx.senhaInstalacao');
      }
    } else {
      log.log('\u26A0\uFE0F step verSenha nao implementado (core/fsl/steps/verSenha.js nao existe)');
      log.log('   o step encerramento nao tera senha para preencher');
      ctx.passosExecutados.push({
        step: 'verSenha', ok: false, skipped: true, motivo: 'modulo ausente',
      });
    }
  }

  // =================================================================
  // FASE 6: Encerramento
  //   - Usa ctx.senhaInstalacao (capturado na fase 5)
  // =================================================================
  log.log('\u2500\u2500 fase 6/6: encerramento \u2500\u2500');
  {
    const estado6 = await detectarEstadoSA(ctx);
    ctx.estadosPorFase.push({ fase: 'encerramento', estado: estado6 });

    await safeScreen(ctx, log, 'fase6-encerramento-antes');
    const r = await tentarStep(ctx, log, encerramento, 'encerramento');
    ctx.passosExecutados.push({ step: 'encerramento', ...r });
    await safeScreen(ctx, log, 'fase6-encerramento-depois');
  }

  log.log('\u2550\u2550\u2550 orquestradorPosSA finalizado \u2550\u2550\u2550');
  log.log(`passos executados: ${ctx.passosExecutados.map(p => p.step).join(' \u2192 ') || '(nenhum)'}`);

  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME,
    status: 'ok',
    passosExecutados: ctx.passosExecutados,
    estadosPorFase: ctx.estadosPorFase,
  });

  return ctx;
}

module.exports = { step, name: STEP_NAME };