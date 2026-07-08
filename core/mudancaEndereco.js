// core/mudancaEndereco.js
// ============================================================
// Fluxo de Mudança de Endereço:
//   1) buscarSlotsMudancaEndereco   -> slots no ENDEREÇO NOVO
//   2) criarOrdemServicoMudancaEndereco -> OS de Instalação no ENDEREÇO NOVO
//   3) criarOrdemServicoRetirada    -> OS de Retirada no ENDEREÇO ANTIGO
//
// ✅ Princípio: o payload da Retirada é IGUAL ao da OS original,
//    trocando apenas:
//      - type: "Instalacao" -> "Retirada"
//      - products.product.action: "adicionar" -> "remover"
//      - sem bloco `appointment` (Retirada é sistêmica)
//      - correlationOrder  = subscriberId NOVO (a OS que está sendo criada)
//      - associatedDocument = subscriberId ANTIGO
//      - correlationOrderOriginal = mesmo da Instalação nova (amarração)
//      - address.id / address.inventoryId = ENDEREÇO ANTIGO
//        (vem do front — não há endpoint V.tal pra buscar isso)
// ============================================================

const { buscarSlotsDisponiveis } = require('./agendamento');
const { criarOrdemServico } = require('./ordemServico');

/**
 * Resolve o associatedDocument da Retirada com fallback em cascata.
 */
function resolveAssociatedDocumentRetirada(oldSubscriberId, retiradaAssociatedDocument) {
    return String(retiradaAssociatedDocument || oldSubscriberId || '').trim();
}


/**
 * Passo 1 — buscar slots no ENDEREÇO NOVO.
 * (Não muda nada em relação à versão anterior.)
 */
async function buscarSlotsMudancaEndereco({
    cp_selection,
    addressId,
    newSubscriberId,
    oldSubscriberId,
    retiradaAssociatedDocument,
    productType,
    accessToken,
    ambiente = 'TRG'
}) {
    const associatedDocument = resolveAssociatedDocumentRetirada(oldSubscriberId, retiradaAssociatedDocument);

    if (!associatedDocument) {
        throw new Error('associatedDocument da retirada é obrigatório (retiradaAssociatedDocument ou oldSubscriberId).');
    }

    return buscarSlotsDisponiveis(
        addressId,
        newSubscriberId,
        productType,
        accessToken,
        cp_selection,
        ambiente,
        {
            associatedDocument,
            addressChangeFlag: true,
            orderType: 'Instalacao'
        }
    );
}


/**
 * Passo 2 — criar a OS de Instalação no ENDEREÇO NOVO.
 * (Não muda nada em relação à versão anterior.)
 */
async function criarOrdemServicoMudancaEndereco({
    cp_selection,
    addressId,
    complementoSelecionado,
    produtoSelecionado,
    slotSelecionado,
    agendamentoId,
    accessToken,
    newSubscriberId,
    oldSubscriberId,
    retiradaAssociatedDocument,
    inventoryId,
    ambiente = 'TRG'
}) {
    if (!oldSubscriberId) {
        throw new Error('oldSubscriberId é obrigatório para criar a OS de Instalação da mudança.');
    }

    console.log(`[MUDANCA_ENDERECO] Instalação - subscriberIdOld (vai no payload): ${oldSubscriberId}`);

    const result = await criarOrdemServico(
        cp_selection,
        addressId,
        complementoSelecionado,
        produtoSelecionado,
        slotSelecionado,
        agendamentoId,
        accessToken,
        newSubscriberId,
        inventoryId,
        ambiente,
        {
            orderType: 'Instalacao',
            addressChangeFlag: true,
            subscriberIdOld: oldSubscriberId
        }
    );

    console.log(`[MUDANCA_ENDERECO] Instalação criada com correlationOrder: ${result.correlationOrder}`);

    return result;
}


/**
 * Passo 3 — criar a OS de Retirada no ENDEREÇO ANTIGO.
 *
 * ✅ NÃO chama nenhum endpoint de busca de OS antiga da V.tal
 *    (esse endpoint não existe — confirmado no log:
 *    "Operation GET /api/productOrdering/v2/productOrder/search is unsupported").
 *
 * ✅ Espera receber do front:
 *    - oldSubscriberId  = TDMQAOSS9844920851
 *    - oldAddressId    = id do ENDEREÇO ANTIGO (vem do front após buscarEndereco do CEP antigo)
 *    - oldInventoryId  = inventoryId do ENDEREÇO ANTIGO (vem do front após verificarDisponibilidade do CEP antigo)
 *    - oldComplemento  = complemento do ENDEREÇO ANTIGO (se houver)
 *
 * ✅ Monta o payload IGUALZINHO ao da Instalação original, trocando:
 *    - type "Instalacao" -> "Retirada"
 *    - action "adicionar" -> "remover"
 *    - sem appointment
 *    - correlationOrder  = subscriberId NOVO (a OS que está sendo criada)
 *    - associatedDocument = subscriberId ANTIGO
 *    - correlationOrderOriginal = o correlationOrder da Instalação (mesma OS)
 *    - customer.subscriberId = subscriberId ANTIGO
 *    - customer.subscriberIdOld = subscriberId NOVO
 *    - address.id / inventoryId = ENDEREÇO ANTIGO
 *    - product.action = "remover"
 */
async function criarOrdemServicoRetirada({
    cp_selection,
    accessToken,
    oldSubscriberId,
    oldAddressId,
    oldInventoryId,
    oldComplemento,           // { type, value } ou null
    retiradaAssociatedDocument,
    produtoSelecionado,
    complementoSelecionado,    // ignorado — mantido só pra compat
    correlationOrderOriginal,
    subscriberIdNovo,          // para correlationOrder da Retirada
    ambiente = 'TRG'
}) {
    // Validações mínimas
    if (!oldSubscriberId) {
        throw new Error('oldSubscriberId é obrigatório para criar a OS de Retirada.');
    }
    if (!oldAddressId) {
        throw new Error('oldAddressId é obrigatório para a Retirada (CEP+número do endereço antigo precisam ser consultados antes).');
    }
    if (!produtoSelecionado || !produtoSelecionado.catalogId) {
        throw new Error('produtoSelecionado.catalogId é obrigatório para a Retirada.');
    }
    if (!subscriberIdNovo) {
        throw new Error('subscriberIdNovo é obrigatório para a Retirada (correlationOrder = subscriberId novo).');
    }

    // associatedDocument da Retirada = o subscriberId ANTIGO
    const associatedDocumentFinal = String(
        retiradaAssociatedDocument || oldSubscriberId
    ).trim();

    // correlationOrder da Retirada = o subscriberId NOVO
    const correlationOrderFinal = String(subscriberIdNovo).trim();

    console.log(`[MUDANCA_ENDERECO] Retirada - correlationOrder (subscriberId novo): ${correlationOrderFinal}`);
    console.log(`[MUDANCA_ENDERECO] Retirada - associatedDocument (subscriberId antigo): ${associatedDocumentFinal}`);
    console.log(`[MUDANCA_ENDERECO] Retirada - correlationOrderOriginal (amarração com Instalação): ${correlationOrderOriginal || '(N/A)'}`);
    console.log(`[MUDANCA_ENDERECO] Retirada - endereço ANTIGO: addressId=${oldAddressId}, inventoryId=${oldInventoryId || '(N/A)'}`);

    return criarOrdemServico(
        cp_selection,
        oldAddressId,                       // ← ENDEREÇO ANTIGO
        oldComplemento || null,             // complemento do ENDEREÇO ANTIGO
        produtoSelecionado,                 // mesmo produto
        null,                               // sem slot (sistêmica)
        null,                               // sem agendamentoId
        accessToken,
        oldSubscriberId,                    // subscriberId = ANTIGO
        oldInventoryId || null,             // inventoryId do ENDEREÇO ANTIGO
        ambiente,
        {
            orderType: 'Retirada',
            associatedDocument: associatedDocumentFinal,         // subscriberId ANTIGO
            correlationOrderOriginal: correlationOrderOriginal,  // amarração
            addressChangeFlag: false,
            correlationOrderOverride: correlationOrderFinal      // subscriberId NOVO
        }
    );
}

module.exports = {
    buscarSlotsMudancaEndereco,
    criarOrdemServicoMudancaEndereco,
    criarOrdemServicoRetirada,
    resolveAssociatedDocumentRetirada
};