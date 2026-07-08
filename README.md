# Módulo FSL — Instalação automatizada

> Resumo dos arquivos do Lote 4 (UI) e como ligá-los ao projeto.

## Arquivos criados

```
core/fsl/
  ├─ config.js          # URLs, timeouts, IMAP, browser
  ├─ imapReader.js      # Lê código 2FA do email (imapflow)
  ├─ browser.js         # Factory Playwright (chromium headless)
  ├─ utils.js           # smartLocator, takeScreenshot, waitForCondition
  ├─ runner.js          # Orquestra os 8 steps
  ├─ steps/
  │   ├─ login.js               (1/8)
  │   ├─ buscarSA.js            (2/8)
  │   ├─ anteciparStatus.js     (3/8)
  │   ├─ concluirStatus.js      (4/8 — loop até "Em Execução")
  │   ├─ consumoEquipamentos.js (5/8 — FTTH ONT + cômodo sala)
  │   ├─ consumoMateriais.js    (6/8 — Home Gateway)
  │   ├─ verSenha.js            (7/8 — captura senha)
  │   └─ encerramento.js        (8/8 — encerra o SA)
  └─ steps/index.js     # exporta array dos 8 steps na ordem

routes/fsl.js           # POST /api/fsl/instalar, GET /api/fsl/health
public/fsl.html         # Tela: input SA + botões + log + card da senha
public/js/fsl.js        # Orquestra UI e chama a API

PATCH-APP-JS.md         # 1 linha de patch para app.js
PATCH-INDEX-HTML.md     # 1 card novo + 1 linha no onAmbienteChange
```

## Passo a passo para integrar no seu projeto

### 1. Copiar arquivos

Copie as pastas/arquivos acima para o seu projeto, **mesma estrutura relativa**:

```bash
# backend
cp -r outputs/fsl-module/core/fsl/ ./core/fsl/
cp    outputs/fsl-module/routes/fsl.js ./routes/fsl.js

# frontend
mkdir -p public/js
cp outputs/fsl-module/public/fsl.html ./public/fsl.html
cp outputs/fsl-module/public/js/fsl.js ./public/js/fsl.js
```

### 2. Patch no app.js (1 linha)

Siga `PATCH-APP-JS.md` — adicione:

```js
app.use('/api/fsl', require('./routes/fsl'));
```

### 3. Patch no index.html (1 card + 1 linha)

Siga `PATCH-INDEX-HTML.md` — adicione o card "Instalar via FSL" e a
linha em `onAmbienteChange()`.

### 4. Instalar dependências

```bash
npm install imapflow
npx playwright install chromium
```

> Se você já tem `@playwright/test` (estava no `package.json` que
> veio nos anexos), o binário do Chromium **não** é instalado
> automaticamente — rode o `npx playwright install chromium`.

### 5. Variáveis de ambiente (opcionais)

```bash
export FSL_URL=https://fsl.vtal.com.br
export FSL_HEADLESS=true           # default true; false = roda com janela
export FSL_RECORD_VIDEO=false      # true grava .webm em internal/fsl-artifacts/
export FSL_SLOW_MO=0               # ms entre ações (debug)
```

### 6. Testar

```bash
# Sobe o app (modo dev, como você já faz)
node app.js

# Em outro terminal:
curl -s http://localhost:PORT/api/fsl/health
# → {"ok":true,"module":"fsl","ts":"..."}

# Abra a tela:
# http://localhost:PORT/fsl.html?ambiente=TRG
# Marque "Dry-run" e clique em "Iniciar Instalação"
# → deve rodar login + 2FA, devolver senha (ou erro útil se algo falhar)
```

## Validações já executadas

- ✅ 15 arquivos passam em `node --check` (sintaxe)
- ✅ Require chain carrega sem erros (mocks de playwright + imapflow)
- ✅ `GET /api/fsl/health` → 200 `{ok:true,module:"fsl"}`
- ✅ `POST /api/fsl/instalar` (sem campos) → 400 com lista de faltantes
- ✅ `POST /api/fsl/instalar/login` (dryRun) → 200 com `ok:true`, step login completa
- ✅ Fluxo completo (8 steps) → entra no login e aguarda 2FA (comportamento correto)

## Pendências (você descobre no reconhecimento ao vivo)

| Step | O que pode precisar de ajuste |
|---|---|
| `login` | Texto exato do App Launcher e labels de usuário/senha |
| `buscarSA` | Texto do item "Compromisso de Serviço relacionado ao SA" |
| `anteciparStatus` | Opções exatas de "Período" e "Tipo" |
| `concluirStatus` | Como o status é exibido (classe CSS ou badge) |
| `consumoEquipamentos` | Texto do cômodo "sala" e fluxo "Associar" |
| `consumoMateriais` | Texto do "Adicionar materiais" e "Adicionar 1" |
| `verSenha` | Como a senha é renderizada (input/div/aria-label) |
| `encerramento` | Texto fixo do `ENCERRAMENTO_TEXT` (stub por enquanto) |

Tudo isso é **centralizado**: ajuste nos arquivos `steps/*.js` e
reinicie o servidor. Zero mudança no `app.js`, no `core/` existente,
em `clients.js`, `config.js`, `package.json` ou `index.html`
(além do card novo).
