// server.js (Este é o arquivo principal que inicia o servidor)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Importe o seu arquivo de rotas (agora chamado app.js)
const apiRoutes = require('./app'); // <-- Certifique-se que o caminho está correto

// Middlewares
app.use(cors()); // Habilita CORS para todas as rotas
app.use(bodyParser.json()); // Para parsear o corpo das requisições JSON
app.use(bodyParser.urlencoded({ extended: true })); // Para parsear o corpo das requisições URL-encoded

// Sirva arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Monte as rotas da API sob o prefixo /api
app.use('/api', apiRoutes);

// Rota para servir o index.html para qualquer outra requisição (SPA fallback)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});