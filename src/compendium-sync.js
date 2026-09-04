// foundry-module/src/compendium-sync.js
// Lê compêndios de itens curados pelo mestre no Foundry e sincroniza pro
// backend (runarcana-api), em lotes. Não depende de nenhum compêndio
// "oficial" do módulo — funciona com qualquer compêndio do tipo Item que
// já exista no mundo.

const BATCH_SIZE = 50;

export function listItemCompendia() {
  return game.packs.filter((pack) => pack.documentName === 'Item');
}

/**
 * Procura, nos compêndios locais de Item, quais têm a flag
 * flags.runarcana-sync.catalogKey batendo com algum dos ids pedidos. Usa o
 * índice (leve) em vez de carregar os documentos inteiros — só busca o
 * documento completo depois, sob demanda, pra quem realmente vai ser usado.
 *
 * Nota: isso só funciona pra itens com a flag catalogKey setada — o módulo
 * do Foundry não conhece os "labels" do catálogo do site (só os ids, ex:
 * 'adaga'), então não dá pra casar por nome aqui como o site faz.
 *
 * O scope da flag precisa ser o id do módulo ("runarcana-sync") — o Foundry
 * rejeita getFlag/getIndex com um scope que não seja um pacote ativo.
 */
export async function findItemsByCatalogKeys(catalogKeys) {
  const wanted = new Set((catalogKeys || []).filter(Boolean));
  const found = new Map();
  if (wanted.size === 0) return found;

  for (const pack of listItemCompendia()) {
    let index;
    try {
      index = await pack.getIndex({ fields: ['flags.runarcana-sync.catalogKey'] });
    } catch (error) {
      console.warn(`Runarcana Sync | Falha ao ler índice do compêndio ${pack.collection}:`, error);
      continue;
    }

    for (const entry of index) {
      const key = entry.flags?.['runarcana-sync']?.catalogKey;
      if (key && wanted.has(key) && !found.has(key)) {
        found.set(key, { packId: pack.collection, foundryId: entry._id });
      }
    }
  }

  return found;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sincroniza os compêndios escolhidos (array de ids de pack, ex:
 * pack.collection) pro backend, em lotes de BATCH_SIZE itens.
 * onProgress(loteAtual, totalLotes) é chamado a cada lote enviado.
 */
export async function syncCompendiums(apiClient, syncKey, packIds, onProgress) {
  const allItems = [];
  const packSummaries = [];

  for (const packId of packIds) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    const documents = await pack.getDocuments();
    const items = documents.map((doc) => ({
      packId,
      foundryId: doc.id,
      name: doc.name,
      img: doc.img,
      itemType: doc.type,
      catalogKey: doc.getFlag('runarcana-sync', 'catalogKey') ?? null,
      system: doc.toObject().system,
    }));

    allItems.push(...items);
    packSummaries.push({ packId, label: pack.metadata.label, count: items.length });
  }

  const batches = chunk(allItems, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    await apiClient.putCompendiumItemsBatch(batches[i], syncKey);
    onProgress?.(i + 1, batches.length);
  }

  return { totalSynced: allItems.length, packSummaries };
}
