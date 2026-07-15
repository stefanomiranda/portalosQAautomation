// public/js/instalacao-encerramento.js
// Frontend da esteira Instalação com Encerramento Externo.
// Credenciais: opcionais no card. Se vazias, o backend usa .env.

(function () {
  'use strict';

  const API = '/api/instalacao-encerramento';

  const state = {
    ambiente:   'TRG',
    jobAtual:   null,
    pollHandle: null,
  };

  const $ = (id) => document.getElementById(id);

  function show(el)   { el.classList.remove('ie-hidden'); }
  function hide(el)   { el.classList.add('ie-hidden'); }
  function setText(el, text) { el.textContent = text; }

  function setMessage(text, kind) {
    const el = $('statusMessage');
    if (!text) { hide(el); return; }
    el.className = `message ${kind || 'info'}`;
    el.textContent = text;
    show(el);
  }

  window.onAmbienteChange = function () {
    const sel = $('ambienteSelect');
    state.ambiente = sel.value;
    $('ambienteExecSelect').value = state.ambiente;
    atualizarBadgeAmbiente();
    carregarBolsao();
    carregarHistorico();
  };

  function atualizarBadgeAmbiente() {
    const badge = $('envBadge');
    badge.className = `env-badge ${state.ambiente}`;
    setText($('envBadgeText'), state.ambiente);
  }

  function init() {
    const url = new URL(window.location.href);
    const amb = (url.searchParams.get('ambiente') || 'TRG').toUpperCase();
    if (['TRG', 'TRG2', 'TI'].includes(amb)) {
      $('ambienteSelect').value = amb;
    }
    window.onAmbienteChange();
  }

  window.carregarBolsao = async function () {
    const container = $('bolsaoContainer');
    const countEl = $('bolsaoCount');
    container.innerHTML = '<div class="ie-bolsao-empty">Carregando lista do bolsão…</div>';
    countEl.textContent = '— OSs';

    try {
      const r    = await fetch(`${API}/bolsao?ambiente=${state.ambiente}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'erro ao carregar bolsão');
      const items = data.items || [];
      countEl.textContent = `${items.length} OS${items.length === 1 ? '' : 's'}`;

      if (items.length === 0) {
        container.innerHTML =
          '<div class="ie-bolsao-empty">— bolsão vazio para este ambiente —<br>digite SA + AssociatedDocument manualmente</div>';
        return;
      }

      container.innerHTML = items.map((it) => {
        const sa  = it.saId || it.ordemId || '?';
        const ad  = it.associatedDocument || '';
        const sub = it.subscriberId || '';
        const src = it.flowType || '';
        return `
          <div class="ie-bolsao-item" data-sa="${sa}" data-ad="${ad}">
            <div class="sa">${sa} <span style="color:var(--vtal-gray-medium);font-weight:400;">→</span> <code>${ad}</code></div>
            <div class="meta">${sub ? 'Subscriber: <code>' + sub + '</code> · ' : ''}${src ? '[<strong>' + src + '</strong>]' : ''}</div>
          </div>`;
      }).join('');

      container.querySelectorAll('.ie-bolsao-item').forEach((el) => {
        el.addEventListener('click', () => {
          $('saInput').value = el.dataset.sa || '';
          $('adInput').value = el.dataset.ad || '';
          setMessage(`Bolsão: SA=${el.dataset.sa} · AD=${el.dataset.ad}`, 'info');
        });
      });
    } catch (e) {
      container.innerHTML = `<div class="ie-bolsao-empty" style="color:var(--error-color);">— erro: ${e.message} —</div>`;
    }
  };

  window.iniciarExecucao = async function () {
    const sa = $('saInput').value.trim();
    const ad = $('adInput').value.trim();
    const amb = $('ambienteExecSelect').value;
    const somUser = $('somUserInput').value.trim();
    const somPass = $('somPassInput').value;

    if (!sa) { setMessage('Informe a SA antes de iniciar.', 'warning'); $('saInput').focus(); return; }
    if (!amb) { setMessage('Selecione o ambiente de execução.', 'warning'); return; }

    const btn = $('iniciarBtn');
    btn.disabled = true;
    show($('resultSection'));
    $('resultPanel').classList.remove('error');
    $('resultPanel').textContent = '';
    const credsInfo = (somUser || somPass) ? 'credenciais=card' : 'credenciais=.env';
    setLog(`▶ Iniciando esteira (SA=${sa}, AD=${ad || '(vazio — será resolvido do bolsão)'}, ambiente=${amb}, ${credsInfo})...\n\n`);
    resetSteps();
    setMessage('', null);

    try {
      const r = await fetch(`${API}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sa,
          associatedDocument: ad || null,
          ambiente: amb,
          somUser: somUser || null,
          somPass: somPass || null,
        }),
      });
      const data = await r.json().catch(() => ({}));

      if (r.status === 409) {
        appendLog(`\n⛔ CONFLITO (409): ${data.error || 'job em andamento'}\n`);
        appendLog(`   jobId em andamento: ${data.jobId}\n`);
        setMessage(`Já existe job em andamento para esta SA (jobId: ${data.jobId}). Aguarde ou verifique o histórico.`, 'error');
        btn.disabled = false;
        return;
      }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

      state.jobAtual = data.jobId;
      appendLog(`✔ Job criado: ${data.jobId}\n`);
      appendLog(`   passos: ${(data.steps || []).join(' → ')}\n\n`);
      setMessage(`Job ${data.jobId} em execução. Acompanhe no log ao lado.`, 'info');
      startPolling();
    } catch (e) {
      appendLog(`\n❌ ERRO ao iniciar: ${e.message}\n`);
      setMessage(`Falha ao iniciar esteira: ${e.message}`, 'error');
      btn.disabled = false;
    }
  };

  window.limparForm = function () {
    $('saInput').value = '';
    $('adInput').value = '';
    $('somUserInput').value = '';
    $('somPassInput').value = '';
    setMessage('', null);
    setLog('Aguardando início…');
    hide($('resultSection'));
    resetSteps();
    $('iniciarBtn').disabled = false;
  };

  function resetSteps() {
    document.querySelectorAll('.ie-step').forEach((s) => {
      s.classList.remove('active', 'ok', 'erro');
    });
  }

  function setLog(msg) { $('logPanel').textContent = msg; }
  function appendLog(m) {
    const el = $('logPanel');
    el.textContent += m;
    el.scrollTop = el.scrollHeight;
  }

  function startPolling() {
    if (state.pollHandle) clearInterval(state.pollHandle);
    state.pollHandle = setInterval(pollJob, 1500);
    pollJob();
  }

  async function pollJob() {
    if (!state.jobAtual) return;
    try {
      const r    = await fetch(`${API}/job/${state.jobAtual}`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'erro ao consultar job');
      renderJob(data);

      if (['sucesso', 'erro', 'cancelado'].includes(data.status)) {
        clearInterval(state.pollHandle);
        state.pollHandle = null;
        $('iniciarBtn').disabled = false;
        carregarHistorico();
      }
    } catch (e) {
      appendLog(`(polling) ${e.message}\n`);
    }
  }

  function renderJob(job) {
    if (Array.isArray(job.steps)) {
      job.steps.forEach((s) => {
        const el = document.querySelector(`.ie-step[data-step="${s.name}"]`);
        if (!el) return;
        el.classList.remove('active', 'ok', 'erro');
        if (s.status === 'em_andamento') el.classList.add('active');
        else if (s.status === 'ok')       el.classList.add('ok');
        else if (s.status === 'erro')     el.classList.add('erro');
      });
    }

    let txt = `Job ${job.jobId} — status: ${String(job.status).toUpperCase()}\n`;
    if (Array.isArray(job.steps)) {
      job.steps.forEach((s) => {
        txt += `\n[${s.name}] ${s.status}\n`;
        if (s.log && s.log.length) {
          s.log.forEach((l) => (txt += `  ${l.ts} — ${l.msg}\n`));
        }
      });
    }
    $('logPanel').textContent = txt;

    const resultSection = $('resultSection');
    const resultPanel   = $('resultPanel');
    if (job.status === 'sucesso' && job.result) {
      show(resultSection);
      resultPanel.classList.remove('error');
      const r = job.result;
      resultPanel.textContent =
        `✔ OS ENCERRADA COM SUCESSO\n\n` +
        `   ordemId:             ${r.ordemId || ''}\n` +
        `   associatedDocument:  ${r.associatedDocument || ''}\n` +
        `   ambiente:            ${r.ambiente || ''}\n` +
        `   subscriberId:        ${r.subscriberId || '(não lido do SOM)'}\n` +
        `   codigoONT:           ${r.codigoONT || ''}\n` +
        `   numeroSerie:         ${r.numeroSerie || ''}\n` +
        `   matricula:           ${r.matriculaTecnico || ''}\n` +
        `   caboDrop:            ${r.caboDrop || ''}\n` +
        `   encerradaEm:         ${r.encerradaEm || ''}`;
      setMessage(`OS ${r.ordemId || ''} encerrada com sucesso no ambiente ${r.ambiente || ''}.`, 'success');
    } else if (job.status === 'erro') {
      show(resultSection);
      resultPanel.classList.add('error');
      const errMsg = (job.error && job.error.message) || JSON.stringify(job.error);
      resultPanel.textContent =
        `❌ FALHA\n\n${errMsg}` +
        (job.persistError ? `\n\n(persistência local: ${job.persistError})` : '');
      setMessage(`Job ${job.jobId} falhou: ${errMsg}`, 'error');
    }
  }

  async function carregarHistorico() {
    try {
      const r    = await fetch(`${API}/bolsao-pendentes?ambiente=${state.ambiente}`);
      const data = await r.json();
      if (!data.ok) return;
      const items = data.items || [];
      const tbody = document.querySelector('#historicoTable tbody');
      if (items.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="5" style="text-align:center;color:var(--vtal-gray-dark);padding:18px;">— nenhum encerramento externo ainda —</td></tr>';
        return;
      }
      tbody.innerHTML = items.map((it) => `
        <tr>
          <td><code>${it.saId || it.ordemId || ''}</code></td>
          <td><code>${it.associatedDocument || ''}</code></td>
          <td><code>${it.codigoONT || ''}</code></td>
          <td><code>${it.numeroSerie || ''}</code></td>
          <td>${it.encerradaEm || ''}</td>
        </tr>`).join('');
    } catch (_) {}
  }

  init();
})();