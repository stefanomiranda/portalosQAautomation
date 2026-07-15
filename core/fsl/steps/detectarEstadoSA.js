// core/fsl/steps/detectarEstadoSA.js
//
// Lê a página da SA e devolve quais botões de ação estão visíveis.
// É o "olho" do orquestradorPosSA — ele olha, decide, e o
// orquestrador age.

const { makeLogger, smartLocator } = require('../utils');

const STEP_NAME = 'detectarEstadoSA';

// Casa PT-BR e EN — o Lightning pode renderizar em qualquer idioma
const CONSUMO_BUTTON_RE = /(Consumo de Materiais e Equipamentos|Consumption of Materials and Equipment)/i;
const MARCAR_BUTTON_RE = /Marcar Status como Completo/i;
const ANTEcipar_BUTTON_RE = /Antecipa[çc][aã]o|Antecipar Status/i;
const ENCERRAR_BUTTON_RE = /(Closing|Encerramento|Encerrar|Finalizar)/i;

/**
 * Verifica se um botão está visível na página.
 */
async function isBotaoVisivel(page, regex, candidatesExtras = []) {
  const candidates = [
    smartLocator(page, { role: 'button', name: regex }),
    smartLocator(page, { text: regex }),
    ...candidatesExtras,
  ];
  for (const loc of candidates) {
    try {
      if (await loc.first().isVisible({ timeout: 500 }).catch(() => false)) {
        return true;
      }
    } catch (_) { /* ignore */ }
  }
  return false;
}

/**
 * Lê o campo Status da SA usando seletores específicos do Lightning.
 * 3 estratégias em ordem:
 *   1) records-record-layout-item[data-fieldname="Status"] > lightning-formatted-text
 *   2) lightning-pill (alguns layouts FSL mostram como pill/badge)
 *   3) Painel de header do FSL (highlightPanel)
 *
 * CORREÇÃO: o regex anterior pegava "Status" em qualquer lugar do
 * body, incluindo a string "Marcar Status como Completo" do botão
 * — o que fazia o detector retornar "como Completo" como se fosse
 * o status da SA. Seletores específicos do Lightning resolvem isso.
 */
async function lerCampoStatus(page, log) {
  // Estratégia 1: campo Status do layout
  try {
    const layoutField = page
      .locator(
        'records-record-layout-item[data-fieldname="Status"] lightning-formatted-text, ' +
        '[data-fieldname="Status"] span[part="formatted-text"]'
      )
      .first();

    if (await layoutField.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const text = (await layoutField.textContent() || '').trim();
      if (text && text.length < 100) {
        log.log(`[detector] status via layout: "${text}"`);
        return text;
      }
    }
  } catch (err) {
    log.log(`[detector] estratégia 1 falhou: ${err.message.slice(0, 80)}`);
  }

  // Estratégia 2: pill/badge de status
  try {
    const statusPill = page
      .locator('lightning-pill, .slds-pill')
      .filter({
        hasText: /On the move|Scheduled|None|In Progress|Dispatched|Canceled|Completed|Cannot/i,
      })
      .first();

    if (await statusPill.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const text = (await statusPill.textContent() || '').trim();
      if (text) {
        log.log(`[detector] status via pill: "${text}"`);
        return text;
      }
    }
  } catch (_) { /* ignore */ }

  // Estratégia 3: painel de header do FSL
  try {
    const headerStatus = page
      .locator(
        '[class*="slds-page-header"] lightning-formatted-text, ' +
        '[class*="highlightPanel" i] lightning-formatted-text'
      )
      .filter({
        hasText: /On the move|Scheduled|None|In Progress|Dispatched|Canceled|Completed|Cannot/i,
      })
      .first();

    if (await headerStatus.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const text = (await headerStatus.textContent() || '').trim();
      if (text) {
        log.log(`[detector] status via header: "${text}"`);
        return text;
      }
    }
  } catch (_) { /* ignore */ }

  log.log('[detector] ⚠️ status não localizado nas 3 estratégias');
  return '';
}

async function detectarEstadoSA(ctx) {
  const log = makeLogger(STEP_NAME);
  const { page } = ctx;
  const url = page.url();
  log.log(`detectando estado em ${url}`);

  const anteciparDisponivel = await isBotaoVisivel(page, ANTEcipar_BUTTON_RE, [
    page.locator('button:has-text("Antecipação")'),
    page.locator('button:has-text("Antecipar Status")'),
  ]);
  const marcarDisponivel = await isBotaoVisivel(page, MARCAR_BUTTON_RE, [
    page.locator('button:has-text("Marcar Status como Completo")'),
  ]);
  const consumoDisponivel = await isBotaoVisivel(page, CONSUMO_BUTTON_RE, [
    page.locator('button:has-text("Consumo de Materiais e Equipamentos")'),
    page.locator('button:has-text("Consumption of Materials and Equipment")'),
  ]);
  const encerrarDisponivel = await isBotaoVisivel(page, ENCERRAR_BUTTON_RE, [
    page.locator('button:has-text("Closing")'),
    page.locator('button:has-text("Encerramento")'),
    page.locator('button:has-text("Encerrar")'),
  ]);

  // Lê o status real com seletores específicos do Lightning
  const statusTexto = await lerCampoStatus(page, log);

  // Infere a fase do wizard a partir do que está visível
  let fase = 'desconhecida';
  if (consumoDisponivel) fase = 'final_status';
  else if (marcarDisponivel) fase = 'pre_final_status';
  else if (anteciparDisponivel) fase = 'received';
  else if (statusTexto) fase = statusTexto.toLowerCase().replace(/\s+/g, '_');

  const estado = {
    statusTexto,
    anteciparDisponivel,
    marcarDisponivel,
    consumoDisponivel,
    encerrarDisponivel,
    url,
    fase,
  };

  log.log(
    `estado: fase="${fase}" | status="${statusTexto}" | ` +
    `antecipar=${anteciparDisponivel} | marcar=${marcarDisponivel} | ` +
    `consumo=${consumoDisponivel} | encerrar=${encerrarDisponivel}`
  );

  return estado;
}

module.exports = { detectarEstadoSA, name: STEP_NAME };