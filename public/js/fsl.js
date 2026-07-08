// public\js\fsl.js
const $ = (id) => document.getElementById(id);

let currentJobId = null;
let currentToken = null;
let jobPollInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const amb = params.get('ambiente') || 'TRG';
  $('ambiente').value = amb.toUpperCase();
  $('ambiente-badge').textContent = amb.toUpperCase();

  $('ambiente').addEventListener('change', () => {
    $('ambiente-badge').textContent = $('ambiente').value;
    carregarBolsao();
  });

  carregarBolsao();
});

async function carregarBolsao() {
  const ambiente = $('ambiente').value;
  const container = $('bolsao-container');
  container.innerHTML = '<div class="fsl-bolsao-empty">Carregando…</div>';

  try {
    const resp = await fetch(`/api/fsl/bolsao-pendentes?ambiente=${encodeURIComponent(ambiente)}`);
    const data = await resp.json();

    if (!data.ok) throw new Error(data.error || 'Erro ao carregar bolsão');

    if (!data.items || data.items.length === 0) {
      container.innerHTML = `<div class="fsl-bolsao-empty">Nenhuma OS pendente em <strong>${data.ambiente}</strong>.</div>`;
      return;
    }

    container.innerHTML = '<div class="fsl-bolsao-list">' +
      data.items.map(os => `
        <div class="fsl-bolsao-item" onclick='selecionarOS(${JSON.stringify(os)})'>
          <div class="sa">SA ${escapeHtml(os.saId || '—')}</div>
          <div class="meta">
            ${escapeHtml(os.subscriberId || '')}
            ${os.address ? ' • ' + escapeHtml(os.address) : ''}
            ${os.slotDate ? ' • ' + new Date(os.slotDate).toLocaleString('pt-BR') : ''}
          </div>
        </div>
      `).join('') +
      '</div>';
  } catch (err) {
    container.innerHTML = `<div class="fsl-bolsao-empty" style="color:#ef4444;">Erro: ${escapeHtml(err.message)}</div>`;
  }
}

function selecionarOS(os) {
  $('sa').value = os.saId || '';
  if (os.ambiente) $('ambiente').value = os.ambiente.toUpperCase();
  $('ambiente-badge').textContent = $('ambiente').value;
  $('sa').focus();
  appendLog(`✓ OS ${os.saId} selecionada do bolsão`, 'ok');
}

async function iniciarInstalacao() {
  const sa       = $('sa').value.trim();
  const ambiente = $('ambiente').value;
  const fslUrl   = $('fslUrl').value.trim();
  const fslUser  = $('fslUser').value.trim();
  const fslPass  = $('fslPass').value;
  const dryRun   = $('dryRun').checked;

  if (!fslUrl || !fslUser || !fslPass) {
    alert('Preencha URL, usuário e senha do FSL.');
    return;
  }
  if (!dryRun && !sa) {
    alert('Preencha o número do SA ou marque "Dry-run".');
    return;
  }

  resetUI();
  $('btnInstalar').disabled = true;
  $('btnCancelar').style.display = 'inline-block';
  $('result').style.display = 'none';
  $('log').innerHTML = '<div class="log-line">Iniciando...</div>';

  try {
    const resp = await fetch('/api/fsl/instalar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sa, ambiente, fslUrl, fslUser, fslPass, dryRun: dryRun ? 'login' : null }),
    });

    const data = await resp.json();

    if (!data.ok) {
      showResult('err', data.error || 'Erro desconhecido', data);
      appendLog(`✗ Falha: ${data.error || 'erro'}`, 'err');
      cleanup();
      return;
    }

    // Resposta IMEDIATA: backend iniciou o job em background
    currentJobId = data.jobId;
    currentToken = data.twoFaToken;
    $('token-box').style.display = 'block';
    $('token-valor').textContent = currentToken;
    appendLog(`✓ Job ${currentJobId.slice(0, 8)}... iniciado`, 'ok');
    appendLog(`✓ Token 2FA: ${currentToken.slice(0, 8)}...`, 'ok');
    appendLog('⏳ Backend executando login + aguardando 2FA...', 'warn');

    startJobPolling();

  } catch (err) {
    showResult('err', err.message, null);
    appendLog(`✗ Erro de rede: ${err.message}`, 'err');
    cleanup();
  }
}

function startJobPolling() {
  stopJobPolling();
  jobPollInterval = setInterval(async () => {
    if (!currentJobId) return;
    try {
      const resp = await fetch(`/api/fsl/job/${currentJobId}`);
      const data = await resp.json();

      if (!data.ok) {
        stopJobPolling();
        showResult('err', data.error || 'Job não encontrado', null);
        appendLog(`✗ ${data.error || 'Job não encontrado'}`, 'err');
        cleanup();
        return;
      }

      if (data.status === 'completed') {
        stopJobPolling();
        showResult('ok', 'Instalação concluída com sucesso', data.result);
        appendLog('✓ Concluído com sucesso', 'ok');
        cleanup();
      } else if (data.status === 'failed') {
        stopJobPolling();
        showResult('err', data.result?.error || 'Falha', data.result);
        appendLog(`✗ Falha: ${data.result?.error || 'erro'}`, 'err');
        cleanup();
      }
      // else: ainda rodando, continua polling
    } catch (err) { /* erro transitório, ignora */ }
  }, 1500);
}

function stopJobPolling() {
  if (jobPollInterval) { clearInterval(jobPollInterval); jobPollInterval = null; }
}

function cancelarExecucao() {
  appendLog('⚠ Cancelamento solicitado (job continua até o fim no backend)', 'warn');
  cleanup();
}

function resetUI() {
  stopJobPolling();
  currentJobId = null;
  currentToken = null;
  $('token-box').style.display = 'none';
}

function cleanup() {
  $('btnInstalar').disabled = false;
  $('btnCancelar').style.display = 'none';
  $('token-box').style.display = 'none';
  currentJobId = null;
  currentToken = null;
  stopJobPolling();
}

async function enviarCodigoManual() {
  if (!currentToken) {
    alert('Nenhum token 2FA ativo no momento.');
    return;
  }
  const input = $('codigo-manual');
  const code = (input.value || '').trim().replace(/\s+/g, '');

  if (!code || !/^\d{4,8}$/.test(code)) {
    alert('Digite um código de 4 a 8 dígitos.');
    input.focus();
    return;
  }

  const btn = $('btn-codigo-manual');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const resp = await fetch('/api/fsl/email-2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken, code: code, from: 'manual', subject: 'colar manual' }),
    });
    const data = await resp.json();

    if (!data.ok) {
      appendLog(`✗ Falha ao enviar código: ${data.error || 'erro'}`, 'err');
      btn.disabled = false;
      btn.textContent = 'Enviar';
    } else {
      appendLog(`✓ Código ${code} enviado — login prossegue`, 'ok');
      input.value = '';
      btn.disabled = true;
      btn.textContent = '✓ Enviado';
    }
  } catch (err) {
    appendLog(`✗ Erro: ${err.message}`, 'err');
    btn.disabled = false;
    btn.textContent = 'Enviar';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'codigo-manual') {
    enviarCodigoManual();
  }
});

function appendLog(msg, kind = '') {
  const log = $('log');
  const line = document.createElement('div');
  line.className = 'log-line' + (kind ? ' log-' + kind : '');
  const ts = new Date().toLocaleTimeString('pt-BR');
  line.textContent = `[${ts}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function showResult(kind, msg, data) {
  const r = $('result');
  r.className = 'fsl-result ' + kind;
  let html = `<strong>${escapeHtml(msg)}</strong>`;
  if (data) {
    html += '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
  }
  r.innerHTML = html;
  r.style.display = 'block';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}