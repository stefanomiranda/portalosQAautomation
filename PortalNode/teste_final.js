const axios = require('axios');

async function testar() {
    try {
        const res = await axios.post('http://localhost:3000/api/buscar_endereco', {
            cep: '25965455', 
            fachada: '1',
            cp_selection: 'CC9999'
        });
        console.log("Resultado final:", res.data);
    } catch (e) {
        console.error("Erro no cliente de teste:", e.response ? e.response.data : e.message);
    }
}
testar();