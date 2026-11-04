import { ImageStore } from './image-store.js';
import { LEGACY_MODULE_ID, MODULE_ID, readFlag } from './module-id.js';
// foundry-module/src/compendium-sync.js
// Lê compêndios de itens curados pelo mestre no Foundry e sincroniza pro
// backend (arthinfo-fichas-api), em lotes. Não depende de nenhum compêndio
// "oficial" do módulo — funciona com qualquer compêndio do tipo Item que
// já exista no mundo.

const BATCH_SIZE = 50;

// Compêndios do próprio sistema (dnd5e) carregam o SRD, que já está no catálogo
// público do site (FDD-74): não são oferecidos pra sincronizar. O que vai pra mesa
// é o conteúdo de fora do SRD — módulos de livros e compêndios do mundo.
export function isSystemPack(pack) {
  return pack?.metadata?.packageType === 'system';
}

export function listItemCompendia() {
  return game.packs.filter((pack) => pack.documentName === 'Item' && !isSystemPack(pack));
}

/**
 * Procura, nos compêndios locais de Item, quais têm a flag
 * flags.<id do módulo>.catalogKey (novo ou legado) batendo com algum dos ids pedidos. Usa o
 * índice (leve) em vez de carregar os documentos inteiros — só busca o
 * documento completo depois, sob demanda, pra quem realmente vai ser usado.
 *
 * Nota: isso só funciona pra itens com a flag catalogKey setada — o módulo
 * do Foundry não conhece os "labels" do catálogo do site (só os ids, ex:
 * 'adaga'), então não dá pra casar por nome aqui como o site faz.
 *
 * O scope da flag precisa ser o id do módulo ("arthinfo-fichas-sync") — o Foundry
 * rejeita getFlag/getIndex com um scope que não seja um pacote ativo.
 */
export async function findItemsByCatalogKeys(catalogKeys) {
  const wanted = new Set((catalogKeys || []).filter(Boolean));
  const found = new Map();
  if (wanted.size === 0) return found;

  for (const pack of listItemCompendia()) {
    let index;
    try {
      index = await pack.getIndex({
        fields: [`flags.${MODULE_ID}.catalogKey`, `flags.${LEGACY_MODULE_ID}.catalogKey`],
      });
    } catch (error) {
      console.warn(`Arthinfo Fichas | Falha ao ler índice do compêndio ${pack.collection}:`, error);
      continue;
    }

    for (const entry of index) {
      const key = entry.flags?.[MODULE_ID]?.catalogKey ?? entry.flags?.[LEGACY_MODULE_ID]?.catalogKey;
      if (key && wanted.has(key) && !found.has(key)) {
        found.set(key, { packId: pack.collection, foundryId: entry._id });
      }
    }
  }

  return found;
}

// img no Foundry é sempre um caminho relativo ao próprio servidor (ex:
// "icons/magic/foo.webp") — sem transformar em URL absoluta aqui, o site
// (outra origem) não tem como montar a imagem.
export function absoluteImg(img) {
  if (!img) return img;
  try {
    return new URL(img, window.location.origin).href;
  } catch {
    return img;
  }
}

// No compêndio do backend a img é caminho da raiz do Foundry ("/icons/..."), não
// URL absoluta: gravar "http://localhost:30000/..." na coluna `img` faz todo
// jogador disparar GET no localhost dele (FDD-18). O site monta a imagem a
// partir do caminho. O mesmo vale pro draft (retrato, item, condição, efeito):
// o sync grava caminho da raiz, nunca http://localhost:30000/... (FDD-71).
export function compendiumImg(img) {
  if (!img) return img;
  const raw = String(img).trim();
  if (/^data:/i.test(raw)) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) return `${url.pathname}${url.search}`;
    return url.href;
  } catch {
    return raw;
  }
}

/**
 * Listas de magia (classes) a que uma magia pertence, segundo o registro do dnd5e
 * (dnd5e.registry.spellLists, alimentado pelas páginas de lista de magia do
 * sistema e dos módulos). O site só tem as listas do SRD por id; o compêndio da
 * mesa traz magias de outros packs, então a classe sai daqui (FDD-127).
 * Devolve undefined quando não há o que informar (não é magia, registro
 * indisponível ou magia em nenhuma lista de classe): o site cai no comportamento
 * antigo, em vez de tratar "sem dado" como "nenhuma classe".
 */
export function spellClassesOf(doc) {
  if (doc?.type !== 'spell') return undefined;
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if (typeof registry?.forSpell !== 'function' || !doc.uuid) return undefined;
  const ids = new Set();
  for (const list of registry.forSpell(doc.uuid)) {
    const { type, identifier } = list?.metadata ?? {};
    if (type === 'class' && identifier) ids.add(String(identifier).toLowerCase());
  }
  return ids.size > 0 ? [...ids].sort() : undefined;
}

// As listas carregam de forma assíncrona depois do ready; sincronizar antes
// disso mandaria magia sem classe. Espera um pouco e segue sem elas se não vier.
async function waitSpellListsReady(timeoutMs = 10000) {
  const registry = globalThis.dnd5e?.registry?.spellLists;
  const started = Date.now();
  while (registry && registry.ready === false && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
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
export async function syncCompendiums(apiClient, packIds, onProgress, { onImages, imageStore = new ImageStore(apiClient) } = {}) {
  const allItems = [];
  const packSummaries = [];
  await waitSpellListsReady();

  for (const packId of packIds) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    const documents = await pack.getDocuments();
    const items = documents.map((doc) => ({
      packId,
      foundryId: doc.id,
      name: doc.name,
      img: compendiumImg(doc.img),
      rawImg: doc.img,
      itemType: doc.type,
      catalogKey: readFlag(doc, 'catalogKey') ?? null,
      system: doc.toObject().system,
      spellClasses: spellClassesOf(doc),
    }));

    allItems.push(...items);
    packSummaries.push({ packId, label: pack.metadata.label, count: items.length });
  }

  // Ícones guardados na API por hash (FDD-71): o item leva img:<hash> em vez do
  // caminho do Foundry. Sem suporte na API, o item segue com o caminho.
  const uniquePaths = [...new Set(allItems.map((item) => item.rawImg).filter(Boolean))];
  const IMAGE_CHUNK = 100;
  for (let i = 0; i < uniquePaths.length; i += IMAGE_CHUNK) {
    await imageStore.ensure(uniquePaths.slice(i, i + IMAGE_CHUNK));
    onImages?.(Math.min(i + IMAGE_CHUNK, uniquePaths.length), uniquePaths.length);
  }
  const payload = allItems.map(({ rawImg, ...item }) => ({ ...item, img: imageStore.get(rawImg) ?? item.img }));

  const batches = chunk(payload, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    await apiClient.putCompendiumItemsBatch(batches[i]);
    onProgress?.(i + 1, batches.length);
  }

  return { totalSynced: allItems.length, packSummaries };
}
