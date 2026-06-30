// public/js/viabilidadeLote.js

document.addEventListener('DOMContentLoaded', () => {
    const cpSelect             = document.getElementById('cpSelect');
    const spreadsheetFileInput = document.getElementById('spreadsheetFile');
    const fileNameDisplay      = document.getElementById('fileNameDisplay');
    const fileSelectedInfo     = document.getElementById('fileSelectedInfo');
    const processSpreadsheetBtn = document.getElementById('processSpreadsheetBtn');
    const downloadResultBtn    = document.getElementById('downloadResultBtn');
    const statusMessage        = document.getElementById('statusMessage');
    const dropZone             = document.getElementById('dropZone');

    if (!cpSelect || !spreadsheetFileInput || !processSpreadsheetBtn || !downloadResultBtn || !statusMessage) {
        console.error('[LOTE] Elementos HTML essenciais não encontrados.');
        return;
    }

    let processedFileName = null;

    // ✅ Lê o ambiente da URL (?ambiente=TI) passado pelo index.html
    const urlParams  = new URLSearchParams(window.location.search);
    const ambURL     = urlParams.get('ambiente');
    const VALID_ENVS = ['TRG', 'TI', 'TRG2'];
    let   currentAmbiente = 'TRG';

    if (ambURL && VALID_ENVS.includes(ambURL.toUpperCase())) {
        currentAmbiente = ambURL.toUpperCase();
    }

    // Atualiza o badge de ambiente
    updateAmbienteBadge(currentAmbiente);

    function updateAmbienteBadge(ambiente) {
        const badge     = document.getElementById('envBadge');
        const badgeText = document.getElementById('envBadgeText');
        if (!badge || !badgeText) return;

        badge.className = `env-badge ${ambiente}`;
        const labels = { TRG: '🟡 TRG', TI: '🟢 TI', TRG2: '🔵 TRG2' };
        badgeText.textContent = labels[ambiente] || ambiente;
    }

    // ─────────────────────────────────────────────
    // Mensagens de Status
    // ─────────────────────────────────────────────
    function showMessage(message, type) {
        statusMessage.classList.remove('hidden', 'success', 'error', 'info');
        statusMessage.textContent = message;
        statusMessage.classList.add(type);
    }

    // ─────────────────────────────────────────────
    // Carregar CPs
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    // Habilitar/Desabilitar botão de processar
    // ─────────────────────────────────────────────
    function checkReadyToProcess() {
        const hasFile = spreadsheetFileInput.files && spreadsheetFileInput.files.length > 0;
        const hasCp   = cpSelect.value !== '';
        processSpreadsheetBtn.disabled = !(hasFile && hasCp);
    }

    // ─────────────────────────────────────────────
    // ✅ Drag & Drop na zona de upload
    // ─────────────────────────────────────────────
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
                // Injeta o arquivo no input
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                spreadsheetFileInput.files = dt.files;
                handleFileSelected(files[0]);
            }
        });
    }

    // ─────────────────────────────────────────────
    // Arquivo selecionado via input
    // ─────────────────────────────────────────────
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

        // Esconde resultado anterior
        downloadResultBtn.classList.add('hidden');
        downloadResultBtn.disabled = true;
        processedFileName = null;

        checkReadyToProcess();
    }

    function handleFileClear() {
        if (fileNameDisplay)  fileNameDisplay.textContent = 'Nenhum arquivo selecionado';
        if (fileSelectedInfo) fileSelectedInfo.classList.remove('show');
        checkReadyToProcess();
    }

    // ─────────────────────────────────────────────
    // CP selecionado
    // ─────────────────────────────────────────────
    cpSelect.addEventListener('change', () => {
        checkReadyToProcess();
    });

    // ─────────────────────────────────────────────
    // Processar Planilha
    // ─────────────────────────────────────────────
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

        showMessage(`⏳ Processando planilha no ambiente ${currentAmbiente}...`, 'info');
        processSpreadsheetBtn.disabled = true;
        downloadResultBtn.classList.add('hidden');
        downloadResultBtn.disabled = true;

        const formData = new FormData();
        formData.append('spreadsheet',  file);
        formData.append('cp_selection', cp_selection);
        formData.append('ambiente',     currentAmbiente); // ✅ Envia ambiente via FormData

        try {
            const response = await fetch('/api/upload-viabilidade-lote', {
                method: 'POST',
                body:   formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (result.status === 'sucesso') {
                showMessage('✅ Planilha processada com sucesso! Clique em Baixar Resultado.', 'success');
                processedFileName = result.fileName;
                downloadResultBtn.classList.remove('hidden');
                downloadResultBtn.disabled = false;
            } else {
                showMessage(`❌ Erro no processamento: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('[LOTE] Erro ao processar planilha:', error);
            showMessage(`❌ Erro ao processar planilha: ${error.message}`, 'error');
        } finally {
            processSpreadsheetBtn.disabled = false;
            checkReadyToProcess();
        }
    });

    // ─────────────────────────────────────────────
    // Download do Resultado
    // ─────────────────────────────────────────────
    downloadResultBtn.addEventListener('click', () => {
        if (processedFileName) {
            window.location.href = `/api/download-viabilidade-lote?fileName=${processedFileName}`;
        } else {
            showMessage('Nenhum arquivo processado para baixar.', 'error');
        }
    });
});