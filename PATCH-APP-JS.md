# Patch no app.js — 1 linha, sem mexer em nada existente

O `routes/fsl.js` é um Router Express standalone. Ele **não** é importado em lugar
nenhum — você precisa adicionar a linha abaixo no seu `app.js`.

## Onde colar

Logo depois dos outros `app.use(...)` de rotas, **algures nesta região do app.js**:

```js
app.use('/api/viabilidade', require('./core/viabilidade'));
app.use('/api/agendamento',  require('./core/agendamento'));
app.use('/api/ordem-servico', require('./core/ordemServico'));
// ... (suas outras rotas)

// ⬇⬇⬇ ADICIONAR ESTA LINHA ⬇⬇⬇
app.use('/api/fsl', require('./routes/fsl'));
```

Pronto. Sem mais nada.

## Dependências novas

```bash
npm install imapflow
# Playwright (binário do Chromium):
npx playwright install chromium
# Se ainda não tiver o pacote "playwright":
# npm install playwright
```

> O `package.json` que veio nos anexos já tem `@playwright/test ^1.55.0` como
> devDep. Isso **não** instala o binário do Chromium. Você precisa rodar
> `npx playwright install chromium` uma vez.

## Variáveis de ambiente (opcional, com defaults sensatos)

```bash
# Já tem defaults no core/fsl/config.js. Só exporte se quiser sobrescrever:
export FSL_URL=https://fsl.vtal.com.br
export FSL_IMAP_HOST=outlook.office365.com
export FSL_IMAP_FROM_FILTER=noreply@
export FSL_IMAP_SUBJECT_REGEX='(c[oó]digo|code|2fa|verifica[cç][aã]o)'
export FSL_IMAP_CODE_REGEX='\b(\d{4,8})\b'
# Para debug:
export FSL_HEADLESS=false           # roda com janela
export FSL_RECORD_VIDEO=true        # grava .webm em internal/fsl-artifacts/
export FSL_SLOW_MO=200              # ms entre cada ação
```

## Como testar

### 1. Health check (não abre browser, valida que a rota subiu)

```bash
curl -s http://localhost:PORT/api/fsl/health
# { "ok": true, "module": "fsl", "ts": "..." }
```

### 2. Validar login + 2FA (dryRun) — **rode isso primeiro**

```bash
curl -X POST http://localhost:PORT/api/fsl/instalar/login \
  -H "Content-Type: application/json" \
  -d '{
    "sa": "1234567",
    "ambiente": "TRG",
    "fslUrl": "https://fsl.vtal.com.br",
    "fslUser": "tecnico@empresa.com",
    "fslPass": "senhaDoFSL",
    "imapUser": "tecnico@empresa.com",
    "imapPass": "SENHA_DE_APP_DO_EMAIL"
  }'
```

- Se retornar `ok: true` → login + 2FA funcionam, pode partir pro fluxo completo.
- Se retornar `ok: false` com `error` descritivo → veja os screenshots em `internal/fsl-artifacts/`.

### 3. Fluxo completo

```bash
curl -X POST http://localhost:PORT/api/fsl/instalar \
  -H "Content-Type: application/json" \
  -d '{
    "sa": "1234567",
    "ambiente": "TRG",
    "fslUrl": "https://fsl.vtal.com.br",
    "fslUser": "tecnico@empresa.com",
    "fslPass": "senhaDoFSL",
    "imapUser": "tecnico@empresa.com",
    "imapPass": "SENHA_DE_APP_DO_EMAIL"
  }'
```

Resposta em caso de sucesso:

```json
{
  "ok": true,
  "saId": "1234567",
  "senha": "ABC12345",
  "steps": [
    { "step": "login", "status": "ok" },
    { "step": "buscarSA", "sa": "1234567", "status": "ok" },
    ... (8 steps)
  ],
  "logs": [ ... ]
}
```

## Próximo passo (Lote 4)

Tela `public/fsl.html` + `public/js/fsl.js` (botão "Instalar via FSL" no index
existente). Aguardando seu OK no Lote 3 para seguir.
