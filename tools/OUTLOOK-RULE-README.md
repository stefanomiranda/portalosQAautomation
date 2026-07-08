`markdown
# Regra do Outlook para 2FA do FSL

## Objetivo

Quando o email de verificação 2FA do Salesforce chegar na sua caixa, o Outlook
dispara automaticamente um script que extrai o código e envia para o nosso
backend (`/api/fsl/email-2fa`). Sem essa regra, o login no FSL fica travado
aguardando o código.

## Pré-requisitos

- Outlook desktop instalado (não funciona com Outlook Web)
- PowerShell disponível (já vem no Windows)
- Política do Windows permitindo a execução do script:
  - Abrir PowerShell como Admin e rodar: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
  - Aceitar a pergunta com "S"

## Passo a passo

### 1. Definir a variável de ambiente `FSL_BASE_URL`

- Win+R → `sysdm.cpl` → aba "Avançado" → "Variáveis de Ambiente"
- Em "Variáveis de usuário", adicionar:
  - Nome: `FSL_BASE_URL`
  - Valor: `http://localhost:3000` (ou a porta do seu PortalNode)
- Reiniciar o Outlook para ele enxergar a variável

### 2. Criar a regra

- No Outlook, ir em **Arquivo → Gerenciar Regras e Alertas** (ou Home → Rules → Manage Rules)
- Clicar em **Nova Regra...**
- Em "Começar com um modelo em branco", escolher **"Aplicar regra às mensagens que eu receber"**
- Condição: marcar **"com palavras específicas no assunto"** OU **"com palavras específicas no corpo"**
  - Em "passo 1" do assistente, clicar em "palavras específicas"
  - Adicionar pelo menos uma das:
    - `verification code`
    - `código de verificação`
    - `verification`
  - Clicar em OK
- Ação: marcar **"iniciar aplicativo"**
  - Em "passo 1", clicar em "aplicativo"
  - Apontar para: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
  - Em "argumentos", colocar: 
  -NoProfile -ExecutionPolicy Bypass -File "C:\Users\vt419418\STEFANO\PortalNode\tools\outlook-2fa-webhook.ps1" -Subject "%Subject%" -Body "%Body%"

  - **Importante**: ajustar o caminho do `.ps1` para o seu `PortalNode`
- Exceções: deixar em branco
- Nome da regra: **"FSL — Encaminhar código 2FA"**
- Marcar **"Ativar esta regra"** e finalizar

### 3. Testar

- Fazer um login no FSL pelo PortalNode (rota `/fsl.html`)
- Quando o email de 2FA chegar na caixa, a regra dispara o script
[FSL][route-fsl][INFO] webhook 2FA token=xxxxxxxx code=6 dígitos from=… subject=…
- No PowerShell onde o PortalNode está rodando, deve aparecer:
  - O login no FSL prossegue automaticamente

## Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Regra não dispara | Outlook não vê a regra ativa | Abrir Regras e Alertas, confirmar que a regra está com check "Ativar" |
| PowerShell não roda | Política de execução | Rodar o comando `Set-ExecutionPolicy` do pré-requisito |
| `[FSL-Webhook] Nenhum token 2FA pendente` | Email chegou ANTES do login disparar o token | Pode ignorar — o próximo email que chegar após o login vai funcionar |
| `[FSL-Webhook] Codigo nao encontrado` | Email do Salesforce tem formato diferente | Me mandar print do email e eu ajusto a regex em 1 linha |
| HTTP 404 na entrega | Token expirou (login não submeteu a tempo) | Ajustar timeout no `config.js` (`TIMEOUTS.CODE_2FA_WAIT`) |

## Desativar temporariamente

- Regras e Alertas → desmarcar a regra "FSL — Encaminhar código 2FA"
- A regra fica salva, só não executa
