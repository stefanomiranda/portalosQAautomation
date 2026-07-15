// core/fsl/steps/concluirStatus.js
//
// Step 4/8 — Loop de avanço de status até a SA chegar no estado que
// habilita o botão "Consumo de Materiais e Equipamentos".
//
// MODELO DO FSL:
//   O FSL tem um wizard de transições de status. Cada clique em
//   "Marcar Status como Completo" AVANÇA UMA ETAPA do wizard
//   (Received → On the move → Running → Final Status). Não é uma
//   ação idempotente — é uma sequência de transições.
//
//   O Lightning abre um modal "Status alterado com sucesso!" com
//   botão "Finish" (em inglês) APÓS cada clique bem-sucedido. O
//   portal precisa clicar no "Finish" para fechar o modal antes
//   de tentar o próximo clique. Antes, o modal ficava aberto
//   bloqueando o próximo "Marcar Status como Completo", causando
//   9 timeouts seguidos de 15s cada (total: 2+ minutos de loop
//   inútil).
//
//   O botão de Consumo pode aparecer em PT-BR ("Consumo de
//   Materiais e Equipamentos") ou EN ("Consumption of Materials
//   and Equipment"), dependendo do locale do usuário. O regex
//   casa ambos.
//
//   O botão "Consumo de Materiais e Equipamentos" só aparece
//   quando a SA chega no estado "Final Status". Esse estado é
//   dinâmico, então não dá pra hardcodar "Em Execução" como
//   critério de parada.

const { makeLogger, takeScreenshot, smartLocator, waitForSAReady } = require('../utils');
const anteciparStatus = require('./anteciparStatus');
const FSL_CONFIG = require('../config');

const STEP_NAME = 'concluirStatus';

// Casa PT-BR e EN — o Lightning pode renderizar em qualquer idioma
const CONSUMO_BUTTON_RE = /(Consumo de Materiais e Equipamentos|Consumption of Materials and Equipment)/i;
const MARCAR_BUTTON_RE = /Marcar Status como Completo/i;
const CONFIRMAR_BUTTON_RE = /^Confirmar$/i;

// Regex que identificam modal de AVISO/BLOQUEIO ou SUCESSO do Lightning.
// SUCESSO: o Lightning abre o modal "Marcar Status como Completo" com
// a mensagem "Status alterado com sucesso!" e um único botão "Finish"
// APÓS cada clique bem-sucedido. Esse modal precisa ser detectado e
// fechado (clicando no Finish) antes do próximo clique no Marcar.
const PADROES_AVISO = [
  /status alterado com sucesso/i,
  /n[ãa]o [ée] poss[íi]vel colocar/i,
  /n[ãa]o [ée] poss[íi]vel antecipar/i,
  /n[ãa]o [ée] poss[íi]vel encontrar/i,
  /n[ãa]o [ée] poss[íi]vel realizar/i,
  /em deslocamento/i,
  /sa [ée] inv[áa]lida/i,
  /j[áa] foi antecipad/i,
  /opera[çc][ãa]o n[ãa]o permitid/i,
  /janela de agendamento/i,
  /antes do in[íi]cio/i,
];

/**
 * Detecta se um modal de AVISO/SUCESSO/BLOQUEIO está aberto na página.
 *
 * Sinais de modal:
 *   1) Botão "Finish" presente (em inglês) — esse é o ÚNICO botão do
 *      modal de sucesso/aviso, e o Lightning sempre usa "Finish" para
 *      esses casos. Verificação rápida primeiro.
 *   2) Texto característico ("Status alterado com sucesso!", "Não é
 *      possível..." etc.)
 */
async function detectarModalAvisoBloqueio(page, log, timeoutMs = 2_000) {
  // Checagem rápida do "Finish" primeiro
  try {
    const finishBtn = page.getByRole('button', { name: /^Finish$/i }).first();
    if (await finishBtn.isVisible({ timeout: 300 }).catch(() => false)) {
      let texto = '';
      try {
        texto = (await page.locator('[role="dialog"]').first().innerText().catch(() => '') || '').slice(0, 200);
      } catch (_) { /* ignore */ }
      log.log(`[concluirStatus] ⚠️ modal com "Finish" detectado: "${texto.slice(0, 100)}"`);
      return { isAviso: true, texto };
    }
  } catch (_) { /* ignore */ }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const re of PADROES_AVISO) {
      try {
        const el = page.locator('text=' + re.source).first();
        if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
          const texto = (await el.textContent().catch(() => '') || '').trim();
          const finishBtn = page.getByRole('button', { name: /^Finish$/i }).first();
          const temFinish = await finishBtn.isVisible({ timeout: 200 }).catch(() => false);
          if (temFinish) {
            return { isAviso: true, texto };
          }
          if (texto.length < 300) {
            return { isAviso: true, texto };
          }
        }
      } catch (_) { /* ignore */ }
    }
    await page.waitForTimeout(200);
  }
  return { isAviso: false, texto: '' };
}

/**
 * Clica no botão "Finish" do modal de aviso/sucesso. Melhor-esforço.
 */
async function clicarFinishSeAviso(page, log) {
  try {
    const finishBtn = page.getByRole('button', { name: /^Finish$/i }).first();
    const deadline = Date.now() + 5_000;
    let botao = null;
    while (Date.now() < deadline) {
      if (await finishBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        botao = finishBtn;
        break;
      }
      await page.waitForTimeout(200);
    }
    if (!botao) {
      log.log('[concluirStatus] ⚠️ Finish não encontrado após 5s');
      return false;
    }
    await botao.click();
    log.log('[concluirStatus] ✅ botão "Finish" clicado (modal fechado)');
    await page.waitForTimeout(1_000);
    return true;
  } catch (e) {
    log.log(`[concluirStatus] erro ao clicar Finish: ${e.message.slice(0, 150)}`);
    return false;
  }
}

/**
 * Tenta localizar o botão "Marcar Status como Completo" na página.
 */
async function localizarBotaoMarcar(page) {
  const candidates = [
    smartLocator(page, { role: 'button', name: MARCAR_BUTTON_RE }),
    smartLocator(page, { text: MARCAR_BUTTON_RE }),
    page.locator('button:has-text("Marcar Status como Completo")'),
    page.locator('lightning-button:has-text("Marcar Status como Completo")'),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.first().isVisible({ timeout: 800 }).catch(() => false)) {
        return loc.first();
      }
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Tenta localizar o botão de Consumo de Materiais e Equipamentos.
 * Casa PT-BR e EN.
 */
async function localizarBotaoConsumo(page) {
  const candidates = [
    smartLocator(page, { role: 'button', name: CONSUMO_BUTTON_RE }),
    smartLocator(page, { text: CONSUMO_BUTTON_RE }),
    page.locator('button:has-text("Consumo de Materiais e Equipamentos")'),
    page.locator('button:has-text("Consumption of Materials and Equipment")'),
    page.locator('lightning-button:has-text("Consumo de Materiais e Equipamentos")'),
    page.locator('lightning-button:has-text("Consumption of Materials and Equipment")'),
  ];
  for (const loc of candidates) {
    try {
      if (await loc.first().isVisible({ timeout: 600 }).catch(() => false)) {
        return loc.first();
      }
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Clica no botão Confirmar (se aparecer) após o clique em "Marcar".
 */
async function clicarConfirmarSeAparecer(page, log) {
  try {
    await page.waitForTimeout(500);
    const confirma = page.getByRole('button', { name: CONFIRMAR_BUTTON_RE }).first();
    if (await confirma.isVisible({ timeout: 1_500 }).catch(() => false)) {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        if (!(await confirma.isDisabled().catch(() => true))) break;
        await page.waitForTimeout(200);
      }
      if (!(await confirma.isDisabled().catch(() => true))) {
        await confirma.click();
        log.log('[concluirStatus] Confirmar clicado');
        return true;
      } else {
        log.log('[concluirStatus] Confirmar visível mas desabilitado — seguindo');
        return false;
      }
    }
  } catch (err) {
    log.log(`[concluirStatus] erro no Confirmar: ${err.message.slice(0, 80)}`);
  }
  return false;
}

/**
 * Espera modais abertos fecharem (best-effort).
 */
async function esperarModaisFecharem(page, log, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let stillOpen = false;
    try {
      stillOpen = await page
        .locator('.slds-modal--open:visible, [role="dialog"]:visible')
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
    } catch (_) { /* ignore */ }
    if (!stillOpen) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function tentarAutoAntecipar(ctx, log, iterNum) {
  try {
    log.log(`[concluirStatus] 🔄 auto-heal: re-chamando anteciparStatus (iteração ${iterNum})`);
    await anteciparStatus.step(ctx);
    log.log(`[concluirStatus] ✅ anteciparStatus re-executou com sucesso`);
    return true;
  } catch (e) {
    log.log(`[concluirStatus] ❌ anteciparStatus falhou no auto-heal: ${e.message.slice(0, 200)}`);
    return false;
  }
}

async function step(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page, input } = ctx;

  const saDigits = String(input.sa).replace(/\D+/g, '');
  const saQuery = `SA-${saDigits}`;

  // ====================================================================
  // ETAPA 0 — garantir SA pronta
  // ====================================================================
  log.log(`[concluirStatus] aguardando SA ${saQuery} ficar pronta`);
  try {
    const ready = await waitForSAReady(page, saQuery, {
      timeoutMs: 30_000,
      stepName: STEP_NAME,
      label: 'concluirStatus-inicio',
    });
    log.log(`[concluirStatus] ✅ SA pronta | h1="${ready.h1}"`);
  } catch (e) {
    await takeScreenshot(page, STEP_NAME, 'sa-not-ready-inicio');
    throw new Error(
      `concluirStatus: SA ${saQuery} não ficou pronta em 30s. ` +
      `Provável página em hidratação. ${e.message}`
    );
  }

  await esperarModaisFecharem(page, log, 2_000);

  // ====================================================================
  // ETAPA 0.0 — checagem inicial: tem modal de aviso/sucesso aberto?
  // ====================================================================
  const avisoInicial = await detectarModalAvisoBloqueio(page, log, 1_500);
  if (avisoInicial.isAviso) {
    log.log(`[concluirStatus] ⚠️ modal aberto no início: "${avisoInicial.texto.slice(0, 120)}"`);
    await takeScreenshot(page, STEP_NAME, 'aviso-inicial');
    await clicarFinishSeAviso(page, log);
    await esperarModaisFecharem(page, log, 2_000);
  }

  // ====================================================================
  // ETAPA 0.5 — checagem inicial: o botão de Consumo já está visível?
  // ====================================================================
  const consumoInicial = await localizarBotaoConsumo(page);
  if (consumoInicial) {
    log.log('[concluirStatus] ✅ botão de Consumo já está visível — nada a fazer');
    ctx.steps = ctx.steps || [];
    ctx.steps.push({
      step: STEP_NAME,
      status: 'ok_consumo_disponivel',
      iterations: 0,
    });
    return ctx;
  }

  // ====================================================================
  // ETAPA 1 — LOOP DE AVANÇO DE STATUS
  // ====================================================================
  const maxIter = FSL_CONFIG.TIMEOUTS.STEP_LOOP_MAX;
  let antecipacaoJaChamada = false;
  let cliquesDados = 0;
  log.log(`loop de avanço de status (máx ${maxIter} iterações)`);

  for (let i = 1; i <= maxIter; i++) {
    await esperarModaisFecharem(page, log, 1_000);

    // ============================================================
    // NOVO: ANTES de qualquer coisa, verifica se tem modal de
    // sucesso/aviso aberto da iteração anterior. Esse é o caso
    // que estava quebrando — o Lightning abre o modal
    // "Status alterado com sucesso!" após cada clique, e sem
    // essa checagem o loop ficava 15s esperando o "Marcar"
    // ficar clicável, sem sucesso.
    // ============================================================
    const avisoAntesDoClique = await detectarModalAvisoBloqueio(page, log, 800);
    if (avisoAntesDoClique.isAviso) {
      log.log(`[concluirStatus] iteração ${i}: modal aberto antes do clique, fechando com Finish`);
      await clicarFinishSeAviso(page, log);
      await esperarModaisFecharem(page, log, 1_500);
    }

    if (i > 1) {
      try {
        await waitForSAReady(page, saQuery, {
          timeoutMs: 10_000,
          stepName: STEP_NAME,
          label: `concluirStatus-iter-${i}`,
        });
      } catch (e) {
        log.log(`[concluirStatus] ⚠️ SA perdeu estado pronto na iteração ${i}: ${e.message.slice(0, 150)}`);
      }
    }

    // (a) Critério de parada: botão de Consumo visível
    const consumo = await localizarBotaoConsumo(page);
    if (consumo) {
      log.log(`[concluirStatus] ✅ iteração ${i}: botão de Consumo apareceu!`);
      log.log(`[concluirStatus] 📊 cliques dados: ${cliquesDados}`);
      try {
        await takeScreenshot(page, STEP_NAME, `consumo-visivel-iter-${i}`);
      } catch (_) { /* ignore */ }
      ctx.steps = ctx.steps || [];
      ctx.steps.push({
        step: STEP_NAME,
        iterations: i,
        cliques: cliquesDados,
        status: 'ok_consumo_disponivel',
      });
      return ctx;
    }

    // (b) Procura o botão "Marcar Status como Completo"
    const marcar = await localizarBotaoMarcar(page);
    if (!marcar) {
      log.log(`[concluirStatus] ⚠️ iteração ${i}: nem "Marcar" nem "Consumo" visíveis`);
      try {
        await takeScreenshot(page, STEP_NAME, `sem-botoes-iter-${i}`);
      } catch (_) { /* ignore */ }

      const avisoSemBotao = await detectarModalAvisoBloqueio(page, log, 1_500);
      if (avisoSemBotao.isAviso) {
        log.log(`[concluirStatus] modal de aviso detectado: "${avisoSemBotao.texto.slice(0, 120)}"`);
        await clicarFinishSeAviso(page, log);
        await esperarModaisFecharem(page, log, 1_500);
        continue;
      }

      if (!antecipacaoJaChamada) {
        antecipacaoJaChamada = true;
        const ok = await tentarAutoAntecipar(ctx, log, i);
        if (ok) {
          try {
            await waitForSAReady(page, saQuery, {
              timeoutMs: 20_000,
              stepName: STEP_NAME,
              label: `concluirStatus-pos-antecipar-iter-${i}`,
            });
            log.log(`[concluirStatus] SA revalidada após antecipação — voltando ao loop`);
            continue;
          } catch (e) {
            log.log(`[concluirStatus] ⚠️ SA não voltou a ficar pronta após antecipação: ${e.message.slice(0, 150)}`);
          }
        }
      }

      const reason = antecipacaoJaChamada
        ? 'sem-botoes-apos-antecipar'
        : 'sem-botoes';
      log.log(`[concluirStatus] ⚠️ não foi possível avançar o status (iteração ${i}, reason=${reason})`);
      log.log(`[concluirStatus] ⚠️ seguindo o fluxo — próximo step pode falhar`);
      ctx.steps = ctx.steps || [];
      ctx.steps.push({
        step: STEP_NAME,
        iterations: i,
        cliques: cliquesDados,
        status: 'skipped',
        reason,
      });
      return ctx;
    }

    // (c) Clica em "Marcar Status como Completo"
    try {
      await marcar.click();
      cliquesDados++;
      log.log(`[concluirStatus] ✓ clique ${cliquesDados}: "Marcar Status como Completo" (iteração ${i})`);
    } catch (e) {
      log.log(`[concluirStatus] ❌ erro ao clicar em Marcar (iter ${i}): ${e.message.slice(0, 150)}`);
      try {
        await takeScreenshot(page, STEP_NAME, `clique-falhou-iter-${i}`);
      } catch (_) { /* ignore */ }
      continue;
    }

    // (d) PÓS-CLIQUE: detecta modal de SUCESSO/AVISO
    await page.waitForTimeout(1_200);
    const avisoPosClique = await detectarModalAvisoBloqueio(page, log, 2_000);
    if (avisoPosClique.isAviso) {
      const texto = avisoPosClique.texto.slice(0, 150);

      // Modal de SUCESSO ("Status alterado com sucesso!") significa
      // que o clique FOI processado — devemos fechar e continuar o loop
      if (/status alterado com sucesso/i.test(texto)) {
        log.log(`[concluirStatus] ✅ iteração ${i}: status alterado com sucesso (clique processado)`);
        await takeScreenshot(page, STEP_NAME, `sucesso-pos-clique-iter-${i}`);
        await clicarFinishSeAviso(page, log);
        await esperarModaisFecharem(page, log, 1_500);
        // Continua o loop para a próxima iteração (próximo estado)
        continue;
      }

      // Modal de AVISO/BLOQUEIO: o clique NÃO foi processado, terminamos
      log.log(`[concluirStatus] ⚠️ modal de AVISO detectado pós-clique (iteração ${i})`);
      log.log(`[concluirStatus] texto: "${texto}"`);
      await takeScreenshot(page, STEP_NAME, `aviso-pos-clique-iter-${i}`);
      await clicarFinishSeAviso(page, log);
      await esperarModaisFecharem(page, log, 1_500);
      await page.waitForTimeout(1_000);
      ctx.steps = ctx.steps || [];
      ctx.steps.push({
        step: STEP_NAME,
        iterations: i,
        cliques: cliquesDados,
        status: 'skipped',
        reason: `modal-de-aviso: ${texto.slice(0, 80)}`,
      });
      return ctx;
    }

    // (e) Confirma se modal de confirmação apareceu
    await clicarConfirmarSeAparecer(page, log);

    // (f) Espera modais fecharem e repaint assentar
    await esperarModaisFecharem(page, log, 3_000);
    await page.waitForTimeout(1_000);
  }

  // Esgotou maxIter sem o botão de Consumo aparecer
  log.log(`[concluirStatus] ❌ loop encerrou sem o botão de Consumo aparecer (maxIter=${maxIter})`);
  log.log(`[concluirStatus] 📊 cliques dados: ${cliquesDados}`);
  try {
    await takeScreenshot(page, STEP_NAME, 'max-iter-atingido');
  } catch (_) { /* ignore */ }
  ctx.steps = ctx.steps || [];
  ctx.steps.push({
    step: STEP_NAME,
    iterations: maxIter,
    cliques: cliquesDados,
    status: 'skipped',
    reason: 'max-iter-atingido',
  });
  return ctx;
}

module.exports = { step, name: STEP_NAME };