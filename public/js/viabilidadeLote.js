// public/js/viabilidadeLote.js
//
// ✅ CORREÇÕES APLICADAS (zero regressão funcional):
//    1. Upload agora chama /api/upload-viabilidade-lote/start (retorna jobId em ~200ms).
//    2. Frontend faz polling de progresso a cada 2s em /api/viabilidade-lote/progresso.
//    3. Quando status=concluido, mostra botão "Baixar Resultado".
//    4. Resolve o 504 do proxy: o Node responde rápido e o trabalho roda em background.

document.addEventListener('DOMContentLoaded', () => {
    const cpSelect             = document.getElementById('cpSelect');
    const spreadsheetFileInput = document.getElementById('spreadsheetFile');
    const fileNameDisplay      = document.getElementById('fileNameDisplay');
    const fileSelectedInfo     = document.getElementById('fileSelectedInfo');
    const processSpreadsheetBtn = document.getElementById('processSpreadsheetBtn');
    const downloadResultBtn    = document.getElementById('downloadResultBtn');
    const statusMessage        = document.getElementById('statusMessage');
    const dropZone             = document.getElementById('dropZone');
    const progressBar          = document.getElementById('progressBar');
    const progressText         = document.getElementById('progressText');

    if (!cpSelect || !spreadsheetFileInput || !processSpreadsheetBtn || !downloadResultBtn || !statusMessage) {
        console.error('[LOTE] Elementos HTML essenciais não encontrados.');
        return;
    }

    let processedFileName = null;
    let progressTimer    = null;
    let currentJobId     = null;

    const urlParams  = new URLSearchParams(window.location.search);
    const ambURL     = urlParams.get('ambiente');
    const VALID_ENVS = ['TRG', 'TI', 'TRG2'];
    let   currentAmbiente = 'TRG';

    if (ambURL && VALID_ENVS.includes(ambURL.toUpperCase())) {
        currentAmbiente = ambURL.toUpperCase();
    }

    updateAmbienteBadge(currentAmbiente);

    function updateAmbienteBadge(ambiente) {
        const badge     = document.getElementById('envBadge');
        const badgeText = document.getElementById('envBadgeText');
        if (!badge || !badgeText) return;

        badge.className = `env-badge ${ambiente}`;
        const labels = { TRG: '🟡 TRG', TI: '🟢 TI', TRG2: '🔵 TRG2' };
        badgeText.textContent = labels[ambiente] || ambiente;
    }

    function showMessage(message, type) {
        statusMessage.classList.remove('hidden', 'success', 'error', 'info');
        statusMessage.textContent = message;
        statusMessage.classList.add(type);
    }

    function setProgress(processadas, total, ok, erro, ignorado) {
        if (!progressBar || !progressText) return;
        const pct = total > 0 ? Math.round((processadas / total) * 100) : 0;
        progressBar.style.width = `${pct}%`;
        progressBar.textContent = `${pct}%`;
        progressText.textContent =
            `Linha ${processadas} de ${total} | ok: ${ok} | erro: ${erro} | ignorado: ${ignorado}`;
    }

    function resetProgress() {
        if (progressBar) { progressBar.style.width = '0%'; progressBar.textContent = '0%'; }
        if (progressText) progressText.textContent = '';
    }

    function stopProgressPolling() {
        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }
    }

    async function loadCps() {
        try {
            const response = await fetch('/api/cps');
            const cps      = await response.json();
            cpSelect.innerHTML = '<option value="">Selecione um CP</option>';

            if (cps && cps.length > 0) {
                cps.forEach(cp => {
                    const option       = document.createElement('option');
                    option.value       = cp;
                    option.textContent = cp;
                    cpSelect.appendChild(option);
                });
                cpSelect.disabled = false;
            } else {
                cpSelect.innerHTML = '<option value="">Nenhum CP disponível</option>';
                cpSelect.disabled  = true;
                showMessage('Nenhum CP disponível para seleção.', 'error');
            }
        } catch (error) {
            console.error('[LOTE] Erro ao carregar CPs:', error);
            showMessage('Erro ao carregar CPs. Verifique o console.', 'error');
            cpSelect.innerHTML = '<option value="">Erro ao carregar CPs</option>';
            cpSelect.disabled  = true;
        }
        checkReadyToProcess();
    }

    loadCps();

    function checkReadyToProcess() {
        const hasFile = spreadsheetFileInput.files && spreadsheetFileInput.files.length > 0;
        const hasCp   = cpSelect.value !== '';
        processSpreadsheetBtn.disabled = !(hasFile && hasCp);
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                spreadsheetFileInput.files = dt.files;
                handleFileSelected(files[0]);
            }
        });
    }

    spreadsheetFileInput.addEventListener('change', () => {
        if (spreadsheetFileInput.files.length > 0) {
            handleFileSelected(spreadsheetFileInput.files[0]);
        } else {
            handleFileClear();
        }
    });

    function handleFileSelected(file) {
        if (fileNameDisplay)  fileNameDisplay.textContent = file.name;
        if (fileSelectedInfo) fileSelectedInfo.classList.add('show');
        showMessage(`📂 Arquivo selecionado: ${file.name}`, 'info');

        downloadResultBtn.classList.add('hidden');
        downloadResultBtn.disabled = true;
        processedFileName = null;

        resetProgress();
        checkReadyToProcess();
    }

    function handleFileClear() {
        if (fileNameDisplay)  fileNameDisplay.textContent = 'Nenhum arquivo selecionado';
        if (fileSelectedInfo) fileSelectedInfo.classList.remove('show');
        checkReadyToProcess();
    }

    cpSelect.addEventListener('change', () => {
        checkReadyToProcess();
    });

    processSpreadsheetBtn.addEventListener('click', async () => {
        const file         = spreadsheetFileInput.files[0];
        const cp_selection = cpSelect.value;

        if (!file) {
            showMessage('Por favor, selecione um arquivo Excel.', 'error');
            return;
        }
        if (!cp_selection) {
            showMessage('Por favor, selecione um CP.', 'error');
            return;
        }

        showMessage(`⏳ Iniciando processamento no ambiente ${currentAmbiente}...`, 'info');
        processSpreadsheetBtn.disabled = true;
        downloadResultBtn.classList.add('hidden');
        downloadResultBtn.disabled = true;
        resetProgress();

        const formData = new FormData();
        formData.append('spreadsheet',  file);
        formData.append('cp_selection', cp_selection);
        formData.append('ambiente',     currentAmbiente);

        try {
            // 1) Chama a rota /start — Node responde em ~200ms com { jobId }
            const startResp = await fetch('/api/upload-viabilidade-lote/start', {
                method: 'POST',
                body:   formData
            });

            if (!startResp.ok) {
                const errorText = await startResp.text();
                throw new Error(`Erro HTTP ${startResp.status}: ${errorText}`);
            }

            const startData = await startResp.json();
            if (startData.status !== 'sucesso' || !startData.jobId) {
                throw new Error(startData.message || 'Falha ao iniciar o job.');
            }

            currentJobId = startData.jobId;
            showMessage(`⏳ Job ${currentJobId} iniciado. Aguardando processamento...`, 'info');

            // 2) Inicia polling de progresso a cada 2s
            stopProgressPolling();
            progressTimer = setInterval(async () => {
                try {
                    const r = await fetch(`/api/viabilidade-lote/progresso?jobId=${currentJobId}`, { cache: 'no-store' });
                    if (!r.ok) {
                        console.warn('[LOTE] Progresso retornou', r.status);
                        return;
                    }
                    const p = await r.json();
                    if (!p || p.status !== 'sucesso') {
                        console.warn('[LOTE] Resposta de progresso inválida', p);
                        return;
                    }

                    setProgress(p.processadas, p.total, p.ok, p.erro, p.ignorado);

                    if (p.jobStatus === 'processando' || p.jobStatus === 'iniciado') {
                        showMessage(
                            `⏳ Processando: linha ${p.processadas} de ${p.total} | ok: ${p.ok} | erro: ${p.erro} | ignorado: ${p.ignorado}`,
                            'info'
                        );
                    } else if (p.jobStatus === 'concluido') {
                        stopProgressPolling();
                        processedFileName = p.arquivo;
                        showMessage(
                            `✅ Concluído! ${p.processadas} linhas processadas (ok: ${p.ok}, erro: ${p.erro}). Clique em Baixar Resultado.`,
                            'success'
                        );
                        downloadResultBtn.classList.remove('hidden');
                        downloadResultBtn.disabled = false;
                    } else if (p.jobStatus === 'erro') {
                        stopProgressPolling();
                        showMessage(`❌ Erro no job: ${p.erroMsg || 'desconhecido'}`, 'error');
                    }
                } catch (e) {
                    console.warn('[LOTE] Erro no polling (silencioso):', e.message);
                }
            }, 2000);

        } catch (error) {
            console.error('[LOTE] Erro ao iniciar processamento:', error);
            showMessage(`❌ Erro ao iniciar: ${error.message}`, 'error');
        } finally {
            processSpreadsheetBtn.disabled = false;
            checkReadyToProcess();
        }
    });

    downloadResultBtn.addEventListener('click', () => {
        if (processedFileName) {
            window.location.href = `/api/download-viabilidade-lote?fileName=${processedFileName}`;
        } else {
            showMessage('Nenhum arquivo processado para baixar.', 'error');
        }
    });
});