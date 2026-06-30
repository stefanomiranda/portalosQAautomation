// teste_auth.js
const { CLIENTS } = require('./clients');
const { getTokenForCp } = require('./core/auth');

// Você precisa setar a URL via process.env ou ajustá-la no código para o teste
process.env.TOKEN_URL = 'https://apitrg.vtal.com.br/auth/oauth/v2/token';

async function rodarTeste() {
    console.log("--- Iniciando Teste de Autenticação ---");

    // Escolhendo um CP para teste (ex: CC9999)
    const cpTeste = "CC9999";

    if (!CLIENTS[cpTeste]) {
        console.error("CP selecionado não existe na lista!");
        return;
    }

    const tokenData = await getTokenForCp(cpTeste, CLIENTS);

    if (tokenData && tokenData.access_token) {
        console.log("Teste PASSED: Token obtido com sucesso.");
        console.log("Token Preview:", tokenData.access_token.substring(0, 10) + "...");
    } else {
        console.error("Teste FAILED: Não foi possível obter o token.");
    }
}

rodarTeste();