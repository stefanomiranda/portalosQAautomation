// core/instalacao-encerramento-externo/steps/t017.js
//
// Step 4 — T017 (Instalar Equipamento / Encerramento Externo) — DO MANUAL.
//
// FLUXO (caminho B, validado pelo manual + screenshots):
//   0) Worklist + Filtro por associatedDocument
//   1) Radio "Change State/Status" (value="changeState")
//   2) "..." da T017 → OSM abre "Task State/Status" (NÃO é menu)
//   3) Radio da linha "Assign To User" (value$="/assignOrder")
//   4) <select name="AssignToUser"> → selectOption(matricula)
//   5) Update do Assign
//   6) Reabrir Worklist + Filtro
//   7) Radio "Editor" (value="oe")
//   8) "..." da T017 → form abre
//   9) Validar cabeçalho "T017 - Instalar Equipamento"
//  10) DEBUG: dump do form (URL + selects + botões)
//  11) #completionStatusList → "Encerramento externo com sucesso"
//  12) ESPERAR o form re-renderizar (o campo TR101010 só aparece após o dropdown)
//  13) Localizar campo de matrícula (input[name*="matricula" i] ou novo id dinâmico)
//  14) Preencher TR101010
//  15) #completeTaskButton → Update
//  16) Pós-Update: esperar página mudar
//
// FIX: seletores sem [tabindex] (excesso restritivo — o dump mostrou
//   que id existe mas o seletor composto não casa), e ordem correta
//   (dropdown ANTES de procurar matrícula, porque o campo só
//   aparece após selecionar "Encerramento externo com sucesso").

const { smartLocator, takeScreenshot, waitForCondition } = require('../utils');
const worklist = require('./worklistHelper');

async function marcarRadioWorklist(page, value, onLog) {
  const log = (m) => onLog(`[t017] ${m}`);
  log(`marcando radio name="orderListOption" value="${value}"...`);

  const result = await page.evaluate((radioValue) => {
    const radios = Array.from(document.querySelectorAll('input.radio[name="orderListOption"]'));
    for (const r of radios) {
      if (r.value === radioValue) {
        r.click();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: r.value, name: r.name, isChecked: r.checked };
      }
    }
    return { ok: false, allValues: radios.map(r => r.value) };
  }, value);

  if (result.ok) {
    log(`✓ radio marcado: value="${result.value}" checked=${result.isChecked}`);
  } else {
    log(`✗ radio "${value}" NÃO encontrado. Opções disponíveis: [${result.allValues.join(', ')}]`);
  }
  return result;
}

async function t017({ page, sa, associatedDocument, ordemId, jobId, matricula, onLog = () => {} }) {
  const log = (m) => onLog(`[t017] ${m}`);

  if (!sa) throw new Error('t017: `sa` obrigatório');
  if (!associatedDocument) throw new Error('t017: `associatedDocument` obrigatório (filtro da worklist)');

  const userMatricula = (matricula || 'vt419418').toUpperCase();
  const tecnicoMatricula = 'TR101010';

  // ════════════════════════════════════════════════════════════════════════
  // 0) WORKLIST + FILTRO
  // ════════════════════════════════════════════════════════════════════════
  log('0) abrindo Worklist + filtrando por associatedDocument...');
  await worklist.abrirWorklist(page, onLog);
  await worklist.buscarPorReference(page, associatedDocument, onLog);
  log(`✓ Worklist filtrada`);

  // ════════════════════════════════════════════════════════════════════════
  // 1) RADIO "Change State/Status"
  // ════════════════════════════════════════════════════════════════════════
  log('1) marcando radio "Change State/Status"...');
  const csResult = await marcarRadioWorklist(page, 'changeState', onLog);
  if (!csResult.ok) throw new Error('t017: radio "Change State/Status" não encontrado');
  await page.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 2) LOCALIZAR "..." DA T017
  // ════════════════════════════════════════════════════════════════════════
  log('2) localizando botão "..." da T017...');
  const t017BtnHandle = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/T017\s*-\s*Instalar/i.test(text)) {
        const firstTd = tr.querySelector('td');
        return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
      }
    }
    return null;
  });
  const t017Btn = t017BtnHandle.asElement();
  if (!t017Btn) throw new Error('t017: botão "..." da T017 não encontrado');
  log('✓ botão "..." da T017 encontrado');

  // ════════════════════════════════════════════════════════════════════════
  // 3) CLICAR "..." → abre página "Task State/Status" (NÃO menu)
  // ════════════════════════════════════════════════════════════════════════
  log('3) clicando no "..." da T017...');
  const popupPromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await t017BtnHandle.evaluate(el => el.click());
  const popup = await popupPromise;
  let assignPage = page;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null);
    assignPage = popup;
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
  }
  log(`DEBUG assignPage: url=${assignPage.url()}`);
  await takeScreenshot(assignPage, 't017__assign_page', onLog);

  log('3.5) esperando "Task State/Status" carregar...');
  await waitForCondition(async () => {
    return await assignPage.evaluate(() => {
      const body = document.body.textContent || '';
      return /Task\s+State\s*\/?\s*Status/i.test(body) ||
             !!document.querySelector('select[name="AssignToUser"]');
    });
  }, { timeoutMs: 15000, intervalMs: 300, label: 'página de assign' }).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 4) MARCAR RADIO "Assign To User" (via value, não texto)
  // ════════════════════════════════════════════════════════════════════════
  log('4) marcando radio "Assign To User" (value$="/assignOrder")...');
  const radioClicado = await assignPage.evaluate(() => {
    const radiosByValue = Array.from(document.querySelectorAll('input[type="radio"]'));
    for (const r of radiosByValue) {
      if (r.value && /\/assignOrder$/i.test(r.value)) {
        r.click();
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: r.value, name: r.name, by: 'value' };
      }
    }
    const trs = Array.from(document.querySelectorAll('tr'));
    for (const tr of trs) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Assign\s+To\s+User$/i.test(text)) {
        const radio = tr.querySelector('input[type="radio"]');
        if (radio) {
          radio.click();
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: radio.value, name: radio.name, by: 'exact-text' };
        }
      }
    }
    return { ok: false, allRadios: radiosByValue.map(r => r.value).slice(0, 20) };
  });
  if (!radioClicado.ok) {
    await takeScreenshot(assignPage, 't017__assign_radio_nao_encontrado', onLog);
    throw new Error(`t017: radio "Assign To User" não encontrado (radios: ${radioClicado.allRadios.join(', ')})`);
  }
  log(`✓ radio Assign To User marcado: value="${radioClicado.value}" (by=${radioClicado.by})`);
  await assignPage.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 5) SELECIONAR USUÁRIO (FIX: usar `opt.text` em vez de `optionEncontrada?.text`)
  // ════════════════════════════════════════════════════════════════════════
  log(`5) selecionando usuário "${userMatricula}"...`);
  const selectOk = await assignPage.evaluate((matricula) => {
    const sel = document.querySelector('select[name="AssignToUser"]');
    if (!sel) return { ok: false, reason: 'select[name="AssignToUser"] não encontrado' };
    for (const opt of sel.options) {
      if ((opt.value || '').toUpperCase() === matricula.toUpperCase() ||
          (opt.text || '').trim().toUpperCase() === matricula.toUpperCase()) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: sel.value, text: opt.text.trim() };
      }
    }
    return { ok: false, reason: `matrícula "${matricula}" não está nas options`, opcoes: Array.from(sel.options).slice(0, 10).map(o => o.value) };
  }, userMatricula);
  if (!selectOk.ok) {
    await takeScreenshot(assignPage, 't017__select_usuario_nao_encontrado', onLog);
    throw new Error(`t017: ${selectOk.reason}`);
  }
  log(`✓ usuário selecionado: value="${selectOk.value}" text="${selectOk.text}"`);

  // ════════════════════════════════════════════════════════════════════════
  // 6) UPDATE DO ASSIGN
  // ════════════════════════════════════════════════════════════════════════
  log('6) clicando Update do assign...');
  const updAssign = await smartLocator(assignPage, [
    ['button:has-text("Update")',  (p) => p.locator('button:has-text("Update")')],
    ['input.button[value="Update" i]', (p) => p.locator('input.button[value="Update" i]')],
    ['input[value="Update" i]',    (p) => p.locator('input[value="Update" i]')],
  ], { timeout: 5000 });
  await updAssign.locator.first().click();
  log('✓ Update do assign clicado');
  await page.waitForLoadState('domcontentloaded').catch(() => null);
  await takeScreenshot(page, 't017__apos_update_assign', onLog);
  log('✓ T017 reatribuída');

  // ════════════════════════════════════════════════════════════════════════
  // 7) REABRIR WORKLIST + FILTRAR
  // ════════════════════════════════════════════════════════════════════════
  log('7) reabrindo Worklist + filtrando...');
  await worklist.abrirWorklist(page, onLog);
  await worklist.buscarPorReference(page, associatedDocument, onLog);
  log('✓ Worklist reaberta e filtrada');

  // ════════════════════════════════════════════════════════════════════════
  // 8) RADIO "Editor" (value="oe")
  // ════════════════════════════════════════════════════════════════════════
  log('8) marcando radio "Editor" (value="oe")...');
  let edResult = await marcarRadioWorklist(page, 'oe', onLog);
  if (!edResult.ok) edResult = await marcarRadioWorklist(page, 'editor', onLog);
  if (!edResult.ok) throw new Error('t017: radio "Editor" não encontrado');
  await page.waitForTimeout(500).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 9) CLICAR "..." DA T017 (modo Editor) → form abre
  // ════════════════════════════════════════════════════════════════════════
  log('9) localizando botão "..." da T017 (modo Editor)...');
  const t017BtnHandle2 = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('tr.context-menu-target'));
    for (const tr of rows) {
      const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
      if (/T017\s*-\s*Instalar/i.test(text)) {
        const firstTd = tr.querySelector('td');
        return firstTd ? firstTd.querySelector('input.tableAction[name="move"]') : null;
      }
    }
    return null;
  });
  const t017Btn2 = t017BtnHandle2.asElement();
  if (!t017Btn2) throw new Error('t017: botão "..." da T017 não encontrado (modo Editor)');

  log('10) clicando no "..." da T017 (modo Editor)...');
  const popupPromise2 = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await t017BtnHandle2.evaluate(el => el.click());
  const popup2 = await popupPromise2;

  let editPage = page;
  if (popup2) {
    await popup2.waitForLoadState('domcontentloaded').catch(() => null);
    editPage = popup2;
  } else {
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await page.waitForTimeout(2000).catch(() => null);
  }

  if (!popup2) {
    const allPages = page.context().pages();
    log(`DEBUG: ${allPages.length} páginas abertas no context:`);
    for (let i = 0; i < allPages.length; i++) {
      log(`  [${i}] url=${allPages[i].url()}`);
    }
    if (allPages.length > 1) {
      const lastPage = allPages[allPages.length - 1];
      if (lastPage.url() !== page.url()) {
        editPage = lastPage;
        log(`→ usando página mais recente: ${editPage.url()}`);
      }
    }
  }

  log(`DEBUG editPage: url=${editPage.url()}`);
  await takeScreenshot(editPage, 't017__form_edicao_aberto', onLog);

  log('10.5) esperando #completionStatusList aparecer...');
  await waitForCondition(async () => {
    return await editPage.evaluate(() => !!document.querySelector('#completionStatusList'));
  }, { timeoutMs: 15000, intervalMs: 300, label: 'form da T017 carregar' }).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 11) VALIDAR CABEÇALHO
  // ════════════════════════════════════════════════════════════════════════
  log('11) confirmando cabeçalho "T017 - Instalar Equipamento"...');
  const t017Header = await editPage.evaluate(() => {
    const txt = (document.body.textContent || '').replace(/\s+/g, ' ').trim();
    const match = txt.match(/T0(\d{2})\s*[-–:]\s*([^\n\r]{3,80})/);
    return match ? { id: 'T0' + match[1], name: match[2].trim() } : null;
  });
  if (!t017Header) {
    await takeScreenshot(editPage, 't017__task_nao_aberta', onLog);
    throw new Error(`t017: cabeçalho "T0XX - ..." não encontrado (url=${editPage.url()})`);
  }
  if (t017Header.id !== 'T017') {
    throw new Error(`t017: abriu ${t017Header.id} (${t017Header.name}), esperava T017`);
  }
  log(`✓ T017 confirmada: "${t017Header.id} - ${t017Header.name}"`);

  // ════════════════════════════════════════════════════════════════════════
  // 12) DEBUG: dump do form
  // ════════════════════════════════════════════════════════════════════════
  log('12) DEBUG: dump do form (URL, selects, botões)...');
  const debugForm = await editPage.evaluate(() => {
    return {
      url: location.href,
      selects: Array.from(document.querySelectorAll('select')).map(s => ({
        id: s.id || '(sem id)',
        name: s.name,
        value: s.value,
        currentText: s.options[s.selectedIndex]?.text || '',
        options: Array.from(s.options).slice(0, 10).map(o => o.text.trim()),
      })),
      botoes: Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).map(b => ({
        tag: b.tagName,
        type: b.type,
        id: b.id || '(sem id)',
        text: (b.textContent || '').trim().substring(0, 30),
        value: b.value,
      })).slice(0, 15),
    };
  });
  log(`DEBUG form: url=${debugForm.url}`);
  log(`  ${debugForm.selects.length} selects:`);
  debugForm.selects.forEach(s => log(`    select#${s.id} name="${s.name}" value="${s.value}" currentText="${s.currentText}" options=[${s.options.join(' | ')}]`));
  log(`  ${debugForm.botoes.length} botões:`);
  debugForm.botoes.forEach(b => log(`    ${b.tag}[type=${b.type}] id="${b.id}" value="${b.value}" text="${b.text}"`));
  await takeScreenshot(editPage, 't017__apos_form_aberto', onLog);

  // ════════════════════════════════════════════════════════════════════════
  // 13) DROPDOWN STATUS — usar selectOption nativo do Playwright
  //     FIX: o `page.evaluate(() => s.value = ...)` não dispara o
  //     `ajaxAnywhere.onAfterResponseProcessing` do OSM. O `selectOption`
  //     do Playwright dispara change + blur + os listeners jQuery, que
  //     forçam o OSM a processar a mudança e re-renderizar o form.
  // ════════════════════════════════════════════════════════════════════════
  log('13) selecionando status "Encerramento externo com sucesso" via selectOption nativo...');
  const statusSelect = editPage.locator('#completionStatusList').first();
  await statusSelect.waitFor({ state: 'visible', timeout: 5000 });
  // selectOption dispara os eventos certos (não é o mesmo que s.value = ...)
  await statusSelect.selectOption({ label: 'Encerramento externo com sucesso' });
  // Garante que o blur também é disparado (alguns listeners do OSM só respondem a blur)
  await statusSelect.dispatchEvent('blur').catch(() => null);
  log('✓ status selecionado via selectOption');

  // ════════════════════════════════════════════════════════════════════════
  // 13.5) ESPERAR O AJAX DO OSM PROCESSAR A MUDANÇA
  //     A OSM usa ajaxAnywhere.onAfterResponseProcessing() que re-renderiza
  //     o form e expõe os campos dependentes (matrícula, pendência, etc.).
  //     Se clicarmos Update antes desse AJAX completar, o OSM recebe o
  //     status antigo → "Invalid status id" (Message Code: 302).
  // ════════════════════════════════════════════════════════════════════════
  log('13.5) aguardando AJAX do OSM processar a mudança de status (option 10224 aparecer)...');
  const ajaxOk = await waitForCondition(async () => {
    return await editPage.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('#completionStatusList'));
      return selects.some(s =>
        Array.from(s.options).some(o => o.value === '10224')
      );
    });
  }, { timeoutMs: 15000, intervalMs: 300, label: 'option 10224 (Encerramento externo com sucesso) aparecer' }).then(() => true).catch(() => false);

  if (!ajaxOk) {
    log('⚠ option 10224 não apareceu após 15s — tolerância: 3s adicionais');
    await editPage.waitForTimeout(3000).catch(() => null);
  }

  // Re-validar que o status foi aceito pelo OSM (não só visualmente)
  const statusValidado = await editPage.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('#completionStatusList'));
    return selects.map(s => ({
      value: s.value,
      text: s.options[s.selectedIndex]?.text || '',
      visible: !!(s.offsetWidth || s.offsetHeight),
    }));
  });
  log(`DEBUG status após AJAX: ${JSON.stringify(statusValidado)}`);

  // FIX: usar `some` em vez de `every`. O OSM tem 2 selects: o visível
  // (value muda) e um template/clone oculto (fica no valor antigo).
  // Quando o OSM valida no Update, ele lê o VISÍVEL. Exigir o clone
  // tinha o mesmo valor só serve para a esteira abortar.
  const statusOk = statusValidado.some(
    s => s.visible && (s.value === '10224' || /Encerramento\s+externo\s+com\s+sucesso/i.test(s.text))
  );
  if (!statusOk) {
    await takeScreenshot(editPage, 't017__status_nao_aceito', onLog);
    throw new Error(`t017: status não foi aceito pelo OSM (status: ${JSON.stringify(statusValidado)})`);
  }
  log(`✓ status aceito pelo OSM (selecionado: ${statusValidado.find(s => s.value === '10224')?.text || 'sim'})`);

  // ════════════════════════════════════════════════════════════════════════
  // 14) PENDÊNCIA — NÃO preencher
  //
  //     O OSM exige Pendência como LOOKUP (via lupa), não texto livre.
  //     Quando o usuário preenche com texto ("INSTALACAO"), o OSM rejeita:
  //     "not one of the valid choices for this field".
  //     Para "Encerramento externo com sucesso" a Pendência não é
  //     obrigatória, então deixamos o campo vazio. Se um dia precisar
  //     preencher, use a lupa (Find tool) para selecionar um valor válido
  //     do popup — mesmo padrão que o t046.js usa para o equipamento.
  // ════════════════════════════════════════════════════════════════════════
  log('14) Pendência NÃO preenchida (não é obrigatória para "com sucesso" — campo exige lookup via lupa)');
  await editPage.waitForTimeout(2000).catch(() => null);
  await takeScreenshot(editPage, 't017__apos_pendencia', onLog);

  // ════════════════════════════════════════════════════════════════════════
  // 14.5) "Passou novo cabo Drop?" = NAO
  //
  //     FIX: o algoritmo anterior buscava pelo label "Passou novo cabo Drop"
  //     e pegava o primeiro select do TR — que era o dropdown de PRIORIDADE
  //     (1-9, max/min) e não o de Drop. Agora a busca é pelas options
  //     NAO/SIM (única assinatura desse dropdown).
  // ════════════════════════════════════════════════════════════════════════
  log('14.5) preenchendo "Passou novo cabo Drop?" = NAO (busca por label + assinatura NAO/SIM)...');
  const dropResult = await editPage.evaluate(() => {
    // ESTRATÉGIA 1: label exato + assinatura NAO/SIM (mais seguro).
    // Exige que o <tr> (ou célula próxima) mencione "cabo drop" antes de
    // aceitar a heurística de options. Sem isso, qualquer select com
    // opções NAO/SIM na página seria candidato (ex.: "Houve mudança de
    // endereço?"), e pegaríamos o errado.
    const allCells = Array.from(document.querySelectorAll('td, th, label, span, div, font'));
    for (const c of allCells) {
      const t = (c.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/cabo\s+drop/i.test(t) || t.length > 120) continue;
      const tr = c.closest('tr');
      if (!tr) continue;
      const trSelects = Array.from(tr.querySelectorAll('select'));
      for (const sel of trSelects) {
        const opts = Array.from(sel.options).map(o => o.text.trim().toUpperCase());
        if (opts.includes('NAO') && opts.includes('SIM')) {
          for (const opt of sel.options) {
            if (/^nao$/i.test(opt.text.trim()) || /^nao$/i.test(opt.value)) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('blur', { bubbles: true }));
              return { ok: true, by: 'label-tr', value: opt.value, text: opt.text.trim(), selectId: sel.id };
            }
          }
        }
      }
    }
    // ESTRATÉGIA 2: fallback. Select com NAO/SIM (assinatura única) MAS
    // só é aceito se o TR/label vizinho mencionar "drop" OU "cabo".
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const optionTexts = Array.from(sel.options).map(o => o.text.trim().toUpperCase());
      if (!optionTexts.includes('NAO') || !optionTexts.includes('SIM') || optionTexts.length > 4) continue;
      const tr = sel.closest('tr');
      const trText = tr ? (tr.textContent || '').toLowerCase() : '';
      if (!/drop|cabo/.test(trText)) continue;  // exige contexto "drop/cabo"
      for (const opt of sel.options) {
        if (/^nao$/i.test(opt.text.trim()) || /^nao$/i.test(opt.value)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          sel.dispatchEvent(new Event('blur', { bubbles: true }));
          return { ok: true, by: 'options-tr-context', value: opt.value, text: opt.text.trim(), selectId: sel.id };
        }
      }
    }
    return { ok: false, reason: 'select de Drop (NAO/SIM com contexto "drop"/"cabo") não encontrado' };
  });
  if (dropResult.ok) {
    log(`✓ "Passou novo cabo Drop?" setado: "${dropResult.text}" (selectId="${dropResult.selectId}", by=${dropResult.by || 'options-match'})`);
  } else {
    log(`⚠ "Passou novo cabo Drop?": ${dropResult.reason} — pode quebrar o Update`);
  }
  await editPage.waitForTimeout(1000).catch(() => null);

  // ════════════════════════════════════════════════════════════════════════
  // 15) MATRÍCULA DO TÉCNICO — versão resiliente ao clear-silencioso do OSM
  //
  //     CAUSA RAIZ (confirmada no log):
  //       O input tem onchange="checkAction(...,18266)" que dispara AJAX
  //       no onblur. Em algumas ordens, o checkAction valida a matrícula
  //       contra uma regra de negócio do OSM e, se reprova, **limpa o
  //       valor em silêncio** (sem mostrar erro visível). O elemento
  //       continua o mesmo (mesmo id, isConnected=true), só o .value volta
  //       para "". Esse padrão é o "silent clear" típico do Oracle OSM.
  //
  //     DECISÃO (aprovada):
  //       Em vez de tentar descobrir a regra do checkAction(18266) (que
  //       depende de dados da OS e do técnico), a automação se torna
  //       tolerante: força o valor e clica Update ATOMICAMENTE no mesmo
  //       tick do browser, antes que o OSM tenha chance de limpar no
  //       submit. Se o OSM limpar mesmo assim, captura os erros visíveis
  //       e tenta de novo.
  //
  //     MECANISMO:
  //       1. garantirValorEstavel(): debounce de 400ms — só considera o
  //          valor "estável" quando ficou correto por 400ms contínuos.
  //          Elimina o falso-positivo do valor passar por um frame.
  //       2. tentarUpdateAtomico(): no MESMO page.evaluate, seta o valor,
  //          dispara change E clica no Update. O form é serializado com
  //          o valor correto antes do blur/click ter chance de limpar.
  //       3. coletarErrosOsm(): após cada tentativa, captura qualquer
  //          elemento que pareça erro (classes Error, OamError, role=alert,
  //          texto "Error:", etc.) e os retorna para o log.
  // ════════════════════════════════════════════════════════════════════════
  log('15) preenchendo Matrícula do Técnico (versão resiliente ao clear-silencioso do OSM)...');

  const tecnicoSel = 'input[vcard_name="vCard.textNode.18266"]';

  // ─── Helpers internos do passo 15 ────────────────────────────────────

  // Lê o input vivo (nunca o handle). Retorna info completa para diagnóstico.
  async function diagnosticarMatricula(etapa) {
    const info = await editPage.evaluate(({ sel, etapaAtual }) => {
      const el = document.querySelector(sel);
      if (!el) {
        return { etapa: etapaAtual, missing: true, isConnected: false, value: '' };
      }
      const normalizar = (v) =>
        String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const labelsRelacionados = Array.from(document.querySelectorAll('label'))
        .filter((label) => label.htmlFor === el.id)
        .map((label) => normalizar(label.textContent))
        .filter(Boolean);
      const tr = el.closest('tr');
      const fieldset = el.closest('fieldset');
      return {
        etapa: etapaAtual,
        missing: false,
        value: el.value,
        defaultValue: el.defaultValue,
        id: el.id || null,
        name: el.name || null,
        type: el.type || null,
        vcard_name: el.getAttribute('vcard_name'),
        readOnly: el.readOnly,
        disabled: el.disabled,
        required: el.required,
        isConnected: el.isConnected,
        tabindex: el.tabIndex,
        countMesmoSeletor: document.querySelectorAll(sel).length,
        labelsRelacionados,
        textoDaLinha: tr ? normalizar(tr.textContent) : null,
        textoDoFieldset: fieldset ? normalizar(fieldset.textContent).slice(0, 500) : null,
        onchange: el.getAttribute('onchange'),
        onblur: el.getAttribute('onblur'),
        oninput: el.getAttribute('oninput'),
        outerHTML: el.outerHTML.slice(0, 700),
      };
    }, { sel: tecnicoSel, etapaAtual: etapa });
    log(`DEBUG matrícula [${etapa}]: ${JSON.stringify(info)}`);
    return info;
  }

  // Espera o valor ficar correto E estável por ~400ms (debounce).
  // Retorna {ok, valorLido} onde valorLido é o que estava no DOM no momento
  // da última leitura (útil para diagnóstico se ok=false).
  async function garantirValorEstavel(sel, esperado, timeoutMs = 10000) {
    const t0 = Date.now();
    let lastValue = null;
    let lastChange = 0;
    let lastInfo = null;
    while (Date.now() - t0 < timeoutMs) {
      const info = await editPage.evaluate((s) => {
        const e = document.querySelector(s);
        return e ? { value: e.value, isConnected: e.isConnected, id: e.id } : null;
      }, sel);
      lastInfo = info;
      if (info && info.value === esperado) {
        if (lastValue === esperado && Date.now() - lastChange > 400) {
          return { ok: true, info };
        }
        if (lastValue !== esperado) {
          lastValue = esperado;
          lastChange = Date.now();
        }
      } else {
        lastValue = info ? info.value : null;
        lastChange = Date.now();
      }
      await editPage.waitForTimeout(150);
    }
    return { ok: false, info: lastInfo };
  }

  // Captura erros visíveis do OSM (qualquer elemento que pareça erro).
  // Usado em paralelo com o retry para documentar a regra raiz.
  async function coletarErrosOsm() {
    return await editPage.evaluate(() => {
      const seletores = [
        '[class*="error" i]',
        '[class*="Error" i]',
        '[class*="OamError" i]',
        '[class*="message" i]',
        '[id*="error" i]',
        '[role="alert"]',
        'font[color*="red"]',
        'span[style*="red"]',
        'div[style*="red"]',
        'td[style*="red"]',
      ];
      const textos = new Set();
      // Erros por classe/atributo
      for (const sel of seletores) {
        Array.from(document.querySelectorAll(sel)).forEach((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length > 3 && t.length < 400) textos.add(t);
        });
      }
      // Erros no body inteiro via regex (cobre "Error:", "Campo X obrigatório",
      // "is not one of the valid", etc.)
      const bodyText = document.body.textContent || '';
      const regex = /(Error\s*:|Campo\s+\w+.*obrigat[óo]rio|is not one of the valid|Please use the Find|Invalid\s+status|message\s+code\s*:\s*\d+)[^\n]{0,200}/gi;
      const matches = bodyText.match(regex) || [];
      matches.forEach((m) => textos.add(m.replace(/\s+/g, ' ').trim()));
      return Array.from(textos).slice(0, 10);
    });
  }

  // Tenta forçar o valor E clicar Update no MESMO tick do browser.
  // Atômico do ponto de vista do JS: nada acontece entre o set do valor
  // e o click do Update. Isso impede que o checkAction(onblur) limpe o
  // valor entre a leitura e o submit.
  async function tentarUpdateAtomico(sel, valor, btnSel) {
    return await editPage.evaluate(({ s, v, b }) => {
      const inp = document.querySelector(s);
      const btn = document.querySelector(b);
      if (!inp) return { ok: false, reason: 'input não encontrado' };
      if (!btn) return { ok: false, reason: 'botão Update não encontrado' };
      try {
        // Garante que o valor fica setado no DOM e nos listeners
        inp.focus();
        inp.value = v;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        // Clica o Update IMEDIATAMENTE — antes do blur disparar checkAction
        btn.click();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    }, { s: sel, v: valor, b: btnSel });
  }

  // ─── Loop principal do passo 15 ──────────────────────────────────────
  const MAX_TENTATIVAS = 5;
  let matOk = false;
  let ultimaTentativa = null;

  try {
    // Espera o input aparecer no DOM
    await waitForCondition(async () => {
      return await editPage.evaluate((sel) => !!document.querySelector(sel), tecnicoSel);
    }, { timeoutMs: 10000, intervalMs: 200, label: 'input da matrícula aparecer' });

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      ultimaTentativa = tentativa;
      log(`→ tentativa ${tentativa}/${MAX_TENTATIVAS}`);

      // 1) Preenche via Playwright (dispara change + blur na sequência,
      //    o que pode fazer o OSM já limpar o valor — tudo bem, vamos
      //    re-escrever e clicar atomicamente abaixo).
      await editPage.locator(tecnicoSel).first().fill(tecnicoMatricula);
      const aposFill = await diagnosticarMatricula(`T${tentativa}-apos-fill`);

      // 2) Espera estabilizar (debounce 400ms).
      const estavel = await garantirValorEstavel(tecnicoSel, tecnicoMatricula, 10000);

      if (!estavel.ok) {
        const erros = await coletarErrosOsm();
        log(`⚠ T${tentativa}: valor não estabilizou. valor="${estavel.info?.value || ''}" ` +
            `isConnected=${estavel.info?.isConnected} erros_OSM=${JSON.stringify(erros)}`);
        continue;
      }

      // 3) Valor estável: clica Update ATOMICAMENTE no mesmo tick.
      //    Isso impede o OSM de limpar no submit (a serialização do form
      //    já capturou o valor correto).
      const updateResult = await tentarUpdateAtomico(
        tecnicoSel,
        tecnicoMatricula,
        '#completeTaskButton'
      );

      if (!updateResult.ok) {
        log(`⚠ T${tentativa}: update atômico falhou: ${updateResult.reason}`);
        continue;
      }

      log(`✓ T${tentativa}: Update clicado atomicamente (valor estável + click no mesmo tick)`);
      matOk = true;
      break;
    }
  } catch (e) {
    log(`⚠ Matrícula: erro no fluxo (${e.message})`);
  }

  await takeScreenshot(editPage, 't017__apos_matricula', onLog);

  if (!matOk) {
    // Última chance: loga o estado final para diagnóstico
    const final = await diagnosticarMatricula('final-tentativa-' + (ultimaTentativa || '?'));
    const errosFinais = await coletarErrosOsm();
    log(`✗ Matrícula NÃO persistiu após ${MAX_TENTATIVAS} tentativas`);
    log(`  estado final: value="${final.value}" isConnected=${final.isConnected} id="${final.id}"`);
    log(`  erros visíveis do OSM: ${JSON.stringify(errosFinais)}`);
    throw new Error('t017: Matrícula do Técnico não foi persistida pelo OSM após ' +
                    `${MAX_TENTATIVAS} tentativas (erros OSM: ${JSON.stringify(errosFinais)})`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 16) PÓS-UPDATE — detecção honesta
  //
  //     FIX: a detecção anterior só olhava font[color*="red"] e [class*="error"].
  //     O OSM exibe os erros como texto dentro de divs/td genéricos com
  //     texto "Error:" ou "Campo X obrigatório". Agora também procura
  //     esses padrões no body inteiro.
  // ════════════════════════════════════════════════════════════════════════
log('16) aguardando pós-Update (até 5s para OSM processar ou navegar)...');

// Espera OU o form sumir (sucesso) OU erros aparecerem
const postResult = await Promise.race([
  // Caso 1: a página navegou (sucesso)
  editPage.waitForEvent('framenavigated', { timeout: 5000 }).then(() => ({ navigated: true })).catch(() => null),
  // Caso 2: erro detectado sem navegação (rejeição do OSM)
  editPage.waitForFunction(() => {
    const body = document.body && document.body.textContent || '';
    return /Error\s*:|Campo\s+\w+.*obrigat[óo]rio|is not one of the valid|Invalid\s+status|message\s+code\s*:\s*\d+/.test(body);
  }, null, { timeout: 5000 }).then(() => ({ errorVisible: true })).catch(() => null),
]).catch(() => null);

// Se navegou, é sucesso
if (postResult && postResult.navigated) {
  log(`✓ T017 fechada com sucesso (OSM navegou para fora do form)`);
  log(`T017 concluída — SA=${sa}`);
  return { status: 'completed' };
}

// Se ainda estamos no form, verifica erros
let errors = null;
try {
  errors = await editPage.evaluate(() => {
    // ... (mesma lógica de antes)
  });
} catch (e) {
  // Se o contexto foi destruído durante a evaluate, é porque navegou
  if (/Execution context was destroyed|detached Frame|Target closed/i.test(e.message)) {
    log(`✓ T017 fechada com sucesso (contexto destruído durante verificação)`);
    log(`T017 concluída — SA=${sa}`);
    return { status: 'completed' };
  }
  throw e;
}

log(`DEBUG pós-Update: ${JSON.stringify(errors)}`);
await takeScreenshot(editPage, 't017__concluida', onLog);

if (errors && errors.stillInForm) {
  const errTxt = [...(errors.errorElements || []), ...(errors.errorMatches || [])].filter(Boolean).join(' | ');
  throw new Error(`t017: Update rejeitado pelo OSM (form ainda aberto) — erros: ${errTxt || '(erros não detectados pela varredura — ver screenshot)'}`);
}
}

module.exports = t017;