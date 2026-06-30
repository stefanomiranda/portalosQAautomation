// core/viabilidadeLoteProcessor.js
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getTokenForCp } = require('./auth');
const { buscarEndereco, verificarDisponibilidade, buscarSlots } = require('./viabilidade');

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function clean(v) {
  const s = String(v ?? '').trim();
  if (s === '"' || s === '""') return '';
  return s;
}

function pick(row, aliases) {
  const map = {};
  for (const k of Object.keys(row)) map[norm(k)] = row[k];
  for (const a of aliases) {
    const v = map[norm(a)];
    if (v !== undefined) return clean(v);
  }
  return '';
}

function mapRow(row) {
  const cep = pick(row, ['CEP']);
  const fachada = pick(row, ['Nº FACHADA', 'N° FACHADA', 'NUMERO FACHADA', 'FACHADA']);
  const endereco = pick(row, ['LOGRADOURO', 'ENDEREÇO', 'ENDERECO']);
  const comp1 = pick(row, ['COMPLEMENTO 1', 'COMPLEMENTOS']);
  const comp2 = pick(row, ['COMPLEMENTO 2']);
  const comp3 = pick(row, ['COMPLEMENTO 3']);
  const complementos = [comp1, comp2, comp3].filter(Boolean).join(' | ');

  return {
    cep,
    fachada,
    endereco,
    complementos,
    municipio: pick(row, ['MUNICÍPIO', 'MUNICIPIO']),
    bairro: pick(row, ['BAIRRO']),
    uf: pick(row, ['UF']),
    codigoLogradouro: pick(row, ['CÓDIGO LOGRADOURO', 'CODIGO LOGRADOURO']),
    codigoCDO: pick(row, ['CÓDIGO CDO', 'CODIGO CDO']),
    raw: row
  };
}

function getSubscriberId(clientsConfig, cp_selection) {
  const cpCfg = clientsConfig?.[cp_selection] || {};
  return (
    cpCfg.subscriberId ||
    cpCfg.subscriber_id ||
    cpCfg.subscriber ||
    ''
  );
}

async function processarPlanilhaViabilidade(filePath, cp_selection, clientsConfig) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  if (!clientsConfig?.[cp_selection]) {
    throw new Error(`Config do CP não encontrada: ${cp_selection}`);
  }

  const tokenData = await getTokenForCp(cp_selection, clientsConfig);
  const accessToken = tokenData?.access_token;

  if (!accessToken) {
    throw new Error('Não foi possível obter token.');
  }

  const subscriberId = getSubscriberId(clientsConfig, cp_selection);

  const results = [];
  let total = 0, ok = 0, erro = 0, ignorado = 0;

  for (const raw of rows) {
    total++;
    const r = mapRow(raw);

    if (!r.cep || !r.endereco) {
      ignorado++;
      results.push({
        ...raw,
        STATUS: 'IGNORADO',
        MOTIVO: 'CEP/Logradouro ausente após mapeamento'
      });
      continue;
    }

    try {
      // Sempre usar token original obtido no início
      const token = accessToken;
      if (!token) {
        throw new Error('Token vazio antes de buscar endereço');
      }

      const enderecoResp = await buscarEndereco(
        r.cep,          // CEP
        r.fachada,      // Número/fachada
        token,          // token
        r.endereco,     // extras, se função aceitar
        r.complementos, // extras, se função aceitar
        cp_selection    // extras, se função aceitar
      );

      const addressId = enderecoResp?.addresses?.address?.[0]?.id;
      const complemento = r.complementos || '';

      if (!addressId) {
        throw new Error('addressId não encontrado no retorno de buscarEndereco');
      }

      // Log curto para garantir que o token está indo
      console.log('[VIAB-LOTE] verificarDisponibilidade params:', {
        addressId,
        cp_selection,
        subscriberId,
        tokenPreview: token ? `${token.slice(0, 10)}...` : 'N/A'
      });

      const disponibilidade = await verificarDisponibilidade(
  addressId,
  complemento,
  cp_selection,
  accessToken,
  subscriberId
);

      const slots = await buscarSlots(
  addressId,
  complemento,
  cp_selection,
  accessToken,
  subscriberId
);

      ok++;
      results.push({
        ...raw,
        CEP_NORMALIZADO: r.cep,
        FACHADA_NORMALIZADA: r.fachada,
        ENDERECO_NORMALIZADO: r.endereco,
        COMPLEMENTOS_NORMALIZADOS: r.complementos,
        STATUS: 'PROCESSADO',
        DISPONIBILIDADE: JSON.stringify(disponibilidade || {}),
        SLOTS: JSON.stringify(slots || {})
      });

    } catch (e) {
      erro++;
      results.push({
        ...raw,
        STATUS: 'ERRO',
        MOTIVO: e.message
      });
    }
  }

  console.log('[VIAB-LOTE] total:', total, 'ok:', ok, 'erro:', erro, 'ignorado:', ignorado, 'saida:', results.length);

  const outDir = path.join(__dirname, '../processed_spreadsheets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `viabilidade_resultado_${Date.now()}.xlsx`);
  const outWb = XLSX.utils.book_new();
  const outWs = XLSX.utils.json_to_sheet(results);
  XLSX.utils.book_append_sheet(outWb, outWs, 'Resultados Viabilidade');
  XLSX.writeFile(outWb, outPath);

  return outPath;
}

module.exports = { processarPlanilhaViabilidade };