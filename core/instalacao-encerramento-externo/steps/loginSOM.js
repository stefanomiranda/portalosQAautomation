// core/instalacao-encerramento-externo/steps/loginSOM.js
// Step 1 — autentica o Playwright no SOM.
//
// Sem 2FA (decisão de produto: SOM_USER + SOM_PASS direto).
// A URL do SOM é resolvida por ambiente (TI/TRG/TRG2) via config.urlsPorAmbiente,
// com fallback hardcoded caso a config não tenha sido populada.
// Credenciais: aceita override via parâmetro `credentials` (vindo do front),
// com fallback em process.env.SOM_USER / SOM_PASS.

const config = require('../config');
const { smartLocator, waitForCondition, takeScreenshot } = require('../utils');

/** Resolve a URL de login do SOM para o ambiente informado. */
function resolveLoginUrl(ambiente) {
  if (config.urlsPorAmbiente && config.urlsPorAmbiente[ambiente]) {
    return config.urlsPorAmbiente[ambiente];
  }
  const fallback = {
    TI:   'http://osmsqx02a.local:7003/OrderManagement/Login.jsp',
    TRG:  'http://osmsqx12a.local:7003/OrderManagement/Login.jsp',
    TRG2: 'http://osmsqx22a.local:7003/OrderManagement/Login.jsp',
  };
  return fallback[ambiente] || fallback.TRG;
}

/** Lê credenciais. Override (do front) tem prioridade sobre .env. */
function credenciais(override) {
  const user = (override && override.user) ? String(override.user).trim()
                                          : (process.env.SOM_USER || '').trim();
  const pass = (override && override.pass) ? String(override.pass)
                                          : (process.env.SOM_PASS || '');
  if (!user || !pass) {
    throw new Error(
      'Credenciais do SOM não configuradas. Defina SOM_USER e SOM_PASS no .env, ' +
      'ou preencha os campos "Usuário" e "Senha" no card da esteira.'
    );
  }
  return { user, pass };
}

/**
 * Step de login. Retorna void em sucesso; lança Error em falha.
 */
async function loginSOM({ page, ambiente, credentials, onLog = () => {}, helpers = {} }) {
  const log = (m) => onLog(`[loginSOM] ${m}`);

  const url = resolveLoginUrl(ambiente);
  const { user, pass } = credenciais(credentials);
  log(`autenticando como usuário: ${user}`);

  log(`navegando para ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await takeScreenshot(page, 'loginSOM__carregado', onLog);

  const userField = await smartLocator(page, [
    ['input[name="username"]',                (p) => p.locator('input[name="username"]')],
    ['input[name="userName"]',                (p) => p.locator('input[name="userName"]')],
    ['input[name="user"]',                    (p) => p.locator('input[name="user"]')],
    ['input[id*="username" i]',               (p) => p.locator('input[id*="username" i]')],
    ['input[type="text"]:near(:text("Login"))', (p) => p.locator('input[type="text"]').first()],
  ], { timeout: 8000 });
  log(`campo usuário localizado via estratégia: ${userField.strategy}`);
  await userField.locator.first().fill(user);

  const passField = await smartLocator(page, [
    ['input[name="password"]',  (p) => p.locator('input[name="password"]')],
    ['input[type="password"]',  (p) => p.locator('input[type="password"]')],
  ], { timeout: 4000 });
  await passField.locator.first().fill(pass);

  const submitFound = await smartLocator(page, [
    ['button[type="submit"]',            (p) => p.locator('button[type="submit"]')],
    ['input[type="submit"]',             (p) => p.locator('input[type="submit"]')],
    ['button:has-text("Login")',         (p) => p.locator('button:has-text("Login")')],
    ['button:has-text("Entrar")',        (p) => p.locator('button:has-text("Entrar")')],
    ['input[value="Login" i]',           (p) => p.locator('input[value="Login" i]')],
  ], { timeout: 3000 }).then((r) => r.locator).catch(() => null);

  if (submitFound) {
    log('submetendo formulário de login (click)');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
      submitFound.first().click(),
    ]);
  } else {
    log('botão de submit não encontrado — usando ENTER no campo senha');
    await passField.locator.first().press('Enter');
  }

  await waitForCondition(
    () => !page.url().toLowerCase().includes('login.jsp'),
    { timeoutMs: 15000, label: 'sair de Login.jsp' }
  );

  await takeScreenshot(page, 'loginSOM__sucesso', onLog);
  log(`login OK — URL atual: ${page.url()}`);
}

module.exports = loginSOM;