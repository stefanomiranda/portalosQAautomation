// teste_fluxo.js
const axios = require('axios');

async function testarFluxo() {
    console.log("--- Iniciando Teste E2E ---");
    try {
        // Testa a rota de buscar_endereco
        const res = await axios.post('http://localhost:3000/api/buscar_endereco', {
            cep: '01001000', // Exemplo válido
            fachada: '100',
            cp_selection: 'CC9999'
        });
        console.log("Sucesso no Endereço:", res.data);
    } catch (err) {
        console.error("Erro no Fluxo:", err.response ? err.response.data : err.message);
    }
}
testarFluxo();