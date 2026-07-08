# tools\outlook-2fa-webhook.ps1
#
# Disparado pela regra do Outlook quando um email 2FA chega.
# Extrai o código de 6 dígitos do corpo/assunto e faz POST
# para o endpoint /api/fsl/email-2fa.
#
# Configurar via variavel de ambiente FSL_BASE_URL (ex: http://localhost:3000).
# Por default usa http://localhost:3000.

param(
    [Parameter(Mandatory=$false)]
    [string]$Subject = "",
    
    [Parameter(Mandatory=$false)]
    [string]$Body = ""
)

$ErrorActionPreference = "Stop"
$baseUrl = if ($env:FSL_BASE_URL) { $env:FSL_BASE_URL } else { "http://localhost:3000" }

# 1) Pega o token pendente do /api/fsl/2fa-token
try {
    $pendingResp = Invoke-RestMethod -Uri "$baseUrl/api/fsl/2fa-token" -Method GET -TimeoutSec 5
    $pendingToken = $pendingResp.pending | Select-Object -First 1 -ExpandProperty token
} catch {
    Write-Output "[FSL-Webhook] Nao foi possivel consultar tokens pendentes: $_"
    exit 0
}

if (-not $pendingToken) {
    Write-Output "[FSL-Webhook] Nenhum token 2FA pendente. Saindo."
    exit 0
}

# 2) Extrai codigo de 6 digitos (ou 4-8 digitos) do body ou subject
$combined = "$Subject`n$Body"
$codeMatch = [regex]::Match($combined, '\b(\d{4,8})\b')

if (-not $codeMatch.Success) {
    Write-Output "[FSL-Webhook] Codigo nao encontrado no email. Subject: $Subject"
    exit 0
}

$code = $codeMatch.Groups[1].Value
Write-Output "[FSL-Webhook] Codigo extraido: $code (token ${pendingToken.Substring(0,8)}...)"

# 3) Faz POST para entregar o codigo
try {
    $payload = @{
        token = $pendingToken
        code  = $code
        from  = $env:FSL_FROM
        subject = $Subject
    } | ConvertTo-Json
    
    $resp = Invoke-RestMethod -Uri "$baseUrl/api/fsl/email-2fa" -Method POST `
        -ContentType "application/json" -Body $payload -TimeoutSec 5
    
    Write-Output "[FSL-Webhook] Codigo entregue com sucesso: $($resp | ConvertTo-Json -Compress)"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Output "[FSL-Webhook] Erro ao entregar codigo (HTTP $statusCode): $($_.Exception.Message)"
}