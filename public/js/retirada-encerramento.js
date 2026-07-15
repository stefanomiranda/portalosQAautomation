// public/js/retirada-encerramento.js
//
// Frontend do card "Retirada com Encerramento Externo". Espelha o
// instalacao-encerramento.js, com 3 steps no indicador (sem T046).
//
// Endpoints (relativos, montados conforme o ambiente):
//   GET  /api/retirada-encerramento/bolsao-pendentes?ambiente=…
//   POST /api/retirada-encerramento/iniciar
//   GET  /api/retirada-encerramento/job/:id
//
// Cada chamada de API envia ?ambiente=XX (header X-Ambiente também é aceito).

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 15 * 60 * 1000;  // 15 min

let POLL_HANDLE = null;
let POLL_STARTED_AT = 0;


// ────────────────────────────────────────────────────────────────────────
// Util
// ────────────────────────────────────────────────────────────────────────

function getAmbiente() {
  return (document.getElementById('ambienteExecSelect')?.value
       || document.getElementById('ambienteSelect')?.value
       || 'TRG').toUpperCase();
}

function apiBase() {
  return '/api/retirada-encerramento';
}

function statusMessage(text, kind = 'info') {
  const el = document.getElementById('statusMessage');
  el.className = `message ${kind}`;
  el.textContent = text;
  el.classList.remove('re-hidden');
}

function hideStatusMessage() {
  document.getElementById('statusMessage').classList.add('re-hidden');
}

function logLine(msg) {
  const panel = document.getElementById('logPanel');
  if (!panel) return;
  const ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  panel.textContent += `[${ts}] ${msg}\n`;
  panel.scrollTop = panel.scrollHeight;
}

function setStepState(stepName, state) {
  const el = document.querySelector(`.re-step[data-step="${stepName}"]`);
  if (!el) return;
  el.classList.remove('active', 'ok', 'erro');
  if (state) el.classList.add(state);
}

function clearStepStates() {
  document.querySelectorAll('.re-step').forEach(el => {
    el.classList.remove('active', 'ok', 'erro');
  });
}

function showResultado(obj, isError = false) {
  const section = document.getElementById('resultSection');
  const panel   = document.getElementById('resultPanel');
  panel.classList.toggle('error', !!isError);
  panel.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  section.classList.remove('re-hidden');
}


// ────────────────────────────────────────────────────────────────────────
// Bolsão
// ────────────────────────────────────────────────────────────────────────

async function carregarBolsao() {
  const container = document.getElementById('bolsaoContainer');
  const countEl   = document.getElementById('bolsaoCount');
  container.innerHTML = '<div class="re-bolsao-empty">Carregando…</div>';
  try {
    const resp = await fetch(`${apiBase()}/bolsao-pendentes?ambiente=${getAmbiente()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha ao listar bolsão');

    const items = json.items || [];
    countEl.textContent = `${items.length} OS${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
      container.innerHTML = '<div class="re-bolsao-empty">Nenhuma OS de Retirada no bolsão para este ambiente.</div>';
      return;
    }

    container.innerHTML = '';
    items.forEach((it) => {
      const el = document.createElement('div');
      el.className = 're-bolsao-item';
      el.innerHTML = `
        <div class="sa">${it.saId || it.ordemId || '?'}</div>
        <div class="meta">
          ${it.associatedDocument ? `AD: <code>${it.associatedDocument}</code> · ` : ''}
          ${it.subscriberId ? `Sub: <code>${it.subscriberId}</code> · ` : ''}
          flowType: <code>${it.flowType || '?'}</code>
        </div>
      `;
      el.addEventListener('click', () => {
        document.getElementById('saInput').value = it.saId || it.ordemId || '';
        if (it.associatedDocument) {
          document.getElementById('adInput').value = it.associatedDocument;
        }
        statusMessage(`OS ${it.saId || it.ordemId} importada do bolsão.`, 'info');
      });
      container.appendChild(el);
    });
  } catch (e) {
    container.innerHTML = `<div class="re-bolsao-empty">Erro: ${e.message}</div>`;
  }
}


// ────────────────────────────────────────────────────────────────────────
// Iniciar esteira
// ────────────────────────────────────────────────────────────────────────

async function iniciarExecucao() {
  const sa = document.getElementById('saInput').value.trim();
  const ad = document.getElementById('adInput').value.trim();
  const ambiente = getAmbiente();
  const somUser = document.getElementById('somUserInput').value.trim();
  const somPass = document.getElementById('somPassInput').value;

  if (!sa) {
    statusMessage('Informe a SA.', 'error');
    return;
  }

  // Limpa UI
  hideStatusMessage();
  document.getElementById('logPanel').textContent = '';
  document.getElementById('resultSection').classList.add('re-hidden');
  clearStepStates();
  setStepState('loginSOM', 'active');

  const btn = document.getElementById('iniciarBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Executando…';

  try {
    const resp = await fetch(`${apiBase()}/iniciar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ambiente': ambiente },
      body: JSON.stringify({
        sa,
        associatedDocument: ad || null,
        ambiente,
        somUser: somUser || undefined,
        somPass: somPass || undefined,
      }),
    });
    const json = await resp.json();
    if (!json.ok) {
      throw new Error(json.error || `HTTP ${resp.status}`);
    }
    statusMessage(`Esteira iniciada (jobId=${json.jobId}). Acompanhe o log abaixo.`, 'info');
    logLine(`jobId=${json.jobId} sa=${json.sa} ambiente=${json.ambiente} status=${json.status}`);
    logLine(`steps: ${json.steps.join(' → ')}`);
    startPolling(json.jobId);
  } catch (e) {
    statusMessage(`Falha ao iniciar: ${e.message}`, 'error');
    logLine(`ERRO ao iniciar: ${e.message}`);
    setStepState('loginSOM', 'erro');
    btn.disabled = false;
    btn.textContent = '▶ Iniciar Esteira';
  }
}


// ────────────────────────────────────────────────────────────────────────
// Polling do job
// ────────────────────────────────────────────────────────────────────────

function startPolling(jobId) {
  if (POLL_HANDLE) clearInterval(POLL_HANDLE);
  POLL_STARTED_AT = Date.now();

  POLL_HANDLE = setInterval(async () => {
    if (Date.now() - POLL_STARTED_AT > POLL_TIMEOUT_MS) {
      clearInterval(POLL_HANDLE);
      statusMessage('Timeout de polling (15 min). Verifique o backend.', 'error');
      restoreBotao();
      return;
    }
    try {
      const resp = await fetch(`${apiBase()}/job/${jobId}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || 'job não encontrado');
      applyJobState(json);
      if (json.status === 'sucesso' || json.status === 'erro' || json.status === 'cancelado') {
        clearInterval(POLL_HANDLE);
        onJobFinalizado(json);
      }
    } catch (e) {
      logLine(`[poll] erro: ${e.message}`);
    }
  }, POLL_INTERVAL_MS);
}

function applyJobState(job) {
  // Steps
  (job.steps || []).forEach((s) => {
    let state = null;
    if (s.status === 'em_andamento') state = 'active';
    else if (s.status === 'ok')        state = 'ok';
    else if (s.status === 'erro')      state = 'erro';
    if (state) setStepState(s.name, state);
  });

  // Logs do backend
  (job.steps || []).forEach((s) => {
    (s.log || []).forEach((entry) => {
      // Evita duplicar — logLine já imprime
    });
  });
}

function onJobFinalizado(job) {
  restoreBotao();
  if (job.status === 'sucesso') {
    statusMessage(`Encerramento externo de Retirada concluído. jobId=${job.jobId}`, 'success');
    showResultado({
      jobId: job.jobId,
      sa:    job.sa,
      ambiente: job.ambiente,
      flowType: 'RetiradaEncerramentoExterno',
      result: job.result,
    });
    logLine(`✓ SUCESSO — ${new Date().toLocaleTimeString('pt-BR', { hour12: false })}`);
  } else {
    statusMessage(`Esteira terminou com erro: ${job.error?.message || '?'}`, 'error');
    showResultado({ jobId: job.jobId, error: job.error, persistError: job.persistError }, true);
    logLine(`✗ ERRO — ${job.error?.message || '?'}`);
  }
  carregarBolsao();
  carregarHistorico();
}

function restoreBotao() {
  const btn = document.getElementById('iniciarBtn');
  btn.disabled = false;
  btn.textContent = '▶ Iniciar Esteira';
}


function limparForm() {
  document.getElementById('saInput').value = '';
  document.getElementById('adInput').value = '';
  document.getElementById('somUserInput').value = '';
  document.getElementById('somPassInput').value = '';
  document.getElementById('logPanel').textContent = 'Aguardando início…';
  document.getElementById('resultSection').classList.add('re-hidden');
  clearStepStates();
  hideStatusMessage();
}


// ────────────────────────────────────────────────────────────────────────
// Histórico
// ────────────────────────────────────────────────────────────────────────

async function carregarHistorico() {
  const tbody = document.querySelector('#historicoTable tbody');
  if (!tbody) return;
  try {
    const resp = await fetch(`${apiBase()}/bolsao-pendentes?ambiente=${getAmbiente()}`);
    const json = await resp.json();
    const items = (json.items || []).filter((it) => it.flowType === 'RetiradaEncerramentoExterno');
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--vtal-gray-dark);padding:18px;">— nenhuma retirada encerrada externamente ainda —</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((it) => `
      <tr>
        <td><code>${it.saId || it.ordemId || '?'}</code></td>
        <td><code>${it.associatedDocument || '—'}</code></td>
        <td><code>${it.numeroSerieRetirado || '—'}</code></td>
        <td><code>${it.matriculaTecnico || '—'}</code></td>
        <td>${it.encerradaEm ? new Date(it.encerradaEm).toLocaleString('pt-BR') : '—'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#721c24;padding:18px;">Erro: ${e.message}</td></tr>`;
  }
}


// ────────────────────────────────────────────────────────────────────────
// Ambiente
// ────────────────────────────────────────────────────────────────────────

function onAmbienteChange() {
  const selAmb = document.getElementById('ambienteSelect');
  const selExec = document.getElementById('ambienteExecSelect');
  if (selAmb && selExec) selExec.value = selAmb.value;
  const badge = document.getElementById('envBadge');
  const txt   = document.getElementById('envBadgeText');
  if (badge && txt) {
    badge.className = `env-badge ${selAmb.value}`;
    txt.textContent = selAmb.value;
  }
  carregarBolsao();
  carregarHistorico();
}


// ────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const selAmb = document.getElementById('ambienteSelect');
  if (selAmb) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ambiente')) selAmb.value = params.get('ambiente').toUpperCase();
  }
  onAmbienteChange();
});
