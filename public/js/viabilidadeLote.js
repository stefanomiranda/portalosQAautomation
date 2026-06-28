// public/js/viabilidadeLote.js

document.addEventListener('DOMContentLoaded', () => {
    // Adicione verificações para garantir que os elementos existem
    // Use os IDs que estão no seu HTML
    const cpSelect = document.getElementById('cpSelect'); // Este já estava correto
    const spreadsheetFileInput = document.getElementById('spreadsheetFile'); // CORRIGIDO AQUI
    const fileNameDisplay = document.getElementById('fileNameDisplay'); // Este já estava correto
    const processSpreadsheetBtn = document.getElementById('processSpreadsheetBtn'); // CORRIGIDO AQUI
    const downloadResultBtn = document.getElementById('downloadResultBtn'); // CORRIGIDO AQUI
    const statusMessage = document.getElementById('statusMessage'); // Este já estava correto

    // Se algum elemento essencial não for encontrado, logar um erro e parar
    if (!cpSelect || !spreadsheetFileInput || !processSpreadsheetBtn || !downloadResultBtn || !statusMessage) {
        console.error('Erro: Um ou mais elementos HTML essenciais não foram encontrados no DOM.');
        console.error('cpSelect:', cpSelect);
        console.error('spreadsheetFileInput:', spreadsheetFileInput);
        console.error('processSpreadsheetBtn:', processSpreadsheetBtn);
        console.error('downloadResultBtn:', downloadResultBtn);
        console.error('statusMessage:', statusMessage);
        return; // Interrompe a execução do script se os elementos não forem encontrados
    }

    let processedFileName = null; // Use null para indicar que nenhum arquivo foi processado ainda

    // Função para exibir mensagens
    function showMessage(message, type) {
        statusMessage.classList.remove('hidden', 'success', 'error', 'info');
        statusMessage.textContent = message;
        statusMessage.classList.add(type);
    }

    // Carregar CPs disponíveis
    async function loadCps() {
        try {
            const response = await fetch('/api/cps');
            const cps = await response.json();
            cpSelect.innerHTML = ''; // Limpa opções existentes
            if (cps && cps.length > 0) {
                cps.forEach(cp => {
                    const option = document.createElement('option');
                    option.value = cp;
                    option.textContent = cp;
                    cpSelect.appendChild(option);
                });
                cpSelect.disabled = false;
                // Habilita o botão de processar se já houver arquivo selecionado E um CP válido
                processSpreadsheetBtn.disabled = !spreadsheetFileInput.files[0] || cpSelect.value === '';
            } else {
                cpSelect.innerHTML = '<option value="">Nenhum CP disponível</option>';
                cpSelect.disabled = true;
                processSpreadsheetBtn.disabled = true;
                showMessage('Nenhum CP disponível para seleção.', 'error');
            }
        } catch (error) {
            console.error('Erro ao carregar CPs:', error);
            showMessage('Erro ao carregar CPs. Verifique o console.', 'error');
            cpSelect.innerHTML = '<option value="">Erro ao carregar CPs</option>';
            cpSelect.disabled = true;
            processSpreadsheetBtn.disabled = true;
        }
    }

    // Chama a função para carregar os CPs ao iniciar
    loadCps();

    // Event listener para o input de arquivo
    spreadsheetFileInput.addEventListener('change', () => { // CORRIGIDO AQUI
        if (spreadsheetFileInput.files.length > 0) {
            fileNameDisplay.textContent = spreadsheetFileInput.files[0].name;
            // Habilita o botão de processar se houver arquivo E um CP selecionado
            processSpreadsheetBtn.disabled = cpSelect.value === '';
            showMessage('Arquivo selecionado. Pronto para processar.', 'info');
        } else {
            fileNameDisplay.textContent = 'Nenhum arquivo selecionado';
            processSpreadsheetBtn.disabled = true;
            showMessage('Nenhum arquivo selecionado.', 'info');
        }
        downloadResultBtn.classList.add('hidden'); // Esconde o botão de download
        downloadResultBtn.disabled = true;
    });

    // Event listener para o select de CP (para habilitar/desabilitar o botão de processar)
    cpSelect.addEventListener('change', () => {
        // Habilita o botão de processar se houver arquivo E um CP selecionado
        processSpreadsheetBtn.disabled = !spreadsheetFileInput.files[0] || cpSelect.value === '';
    });


    // Lógica para o botão de processar
    processSpreadsheetBtn.addEventListener('click', async () => { // CORRIGIDO AQUI
        const file = spreadsheetFileInput.files[0];
        const cp_selection = cpSelect.value; // Obtém o CP selecionado

        if (!file) {
            showMessage('Por favor, selecione um arquivo Excel para processar.', 'error');
            return;
        }
        if (!cp_selection) {
            showMessage('Por favor, selecione um CP.', 'error');
            return;
        }

        showMessage('Iniciando processamento da planilha...', 'info');
        processSpreadsheetBtn.disabled = true;
        downloadResultBtn.classList.add('hidden');
        downloadResultBtn.disabled = true;

        const formData = new FormData();
        formData.append('spreadsheet', file);
        formData.append('cp_selection', cp_selection); // <--- ENVIANDO O CP SELECIONADO

        try {
            const response = await fetch('/api/upload-viabilidade-lote', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            if (result.status === 'sucesso') {
                showMessage('Planilha processada com sucesso! Você pode baixar o resultado.', 'success');
                processedFileName = result.fileName;
                downloadResultBtn.classList.remove('hidden');
                downloadResultBtn.disabled = false;
            } else {
                showMessage(`Erro no processamento: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('Erro ao processar planilha:', error);
            showMessage(`Erro ao processar planilha: ${error.message}`, 'error');
        } finally {
            processSpreadsheetBtn.disabled = false;
        }
    });

    // Event listener para o botão de download
    downloadResultBtn.addEventListener('click', () => { // CORRIGIDO AQUI
        if (processedFileName) {
            window.location.href = `/api/download-viabilidade-lote?fileName=${processedFileName}`;
        } else {
            showMessage('Nenhum arquivo processado para baixar.', 'error');
        }
    });
});