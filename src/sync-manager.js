// foundry-module/src/sync-manager.js
import { ATTR_MAP, ABILITY_KEYS } from './data-mapper.js';
import { findItemsByCatalogKeys, absoluteImg } from './compendium-sync.js';

// Utilitário de debounce para agrupar atualizações rápidas
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Limpa metadados do Foundry para evitar falsos positivos no diffing
function cleanItemData(itemData) {
  const cleaned = foundry.utils.deepClone(itemData);
  delete cleaned._stats;
  delete cleaned.sort;
  delete cleaned.ownership;
  delete cleaned.folder;
  if (cleaned.flags) {
    delete cleaned.flags.core;
    delete cleaned.flags.exportSource;
    // IMPORTANTE: Nunca delete a flag runarcana-sync.sourceId durante a limpeza,
    // pois ela é a chave primária de sincronização.
  }
  return cleaned;
}

/**
 * Garante que a estrutura de "Activities" de magias complexas (como Marca da Presa)
 * seja formatada e preservada corretamente para o D&D 5e v3+.
 */
function sanitizeActivities(itemData) {
  // Se não tem activities, não faz nada
  if (!itemData.system || !itemData.system.activities) return itemData;

  const activities = itemData.system.activities;

  // O Foundry D&D 5e v3+ espera que as activities sejam um dicionário de objetos
  // Se o Firebase enviar como array por engano, convertemos para objeto (dicionário)
  if (Array.isArray(activities)) {
    const dict = {};
    activities.forEach((act, index) => {
      // Gera um ID ou usa o existente
      const actId = act._id || foundry.utils.randomID();
      act._id = actId;
      dict[actId] = act;
    });
    itemData.system.activities = dict;
  } else if (typeof activities === 'object') {
    // Garante que cada atividade dentro do objeto tenha seu próprio _id correspondente à chave
    for (const [key, act] of Object.entries(activities)) {
      if (!act._id) act._id = key;
    }
  }

  return itemData;
}

export class SyncManager {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.streams = new Map();
    this.activeSyncs = new Set();
    // Última ficha completa conhecida por ator, pra poder mesclar os campos
    // que o Foundry não conhece (concept, identity, equipment, etc.) ao
    // gravar via PUT, que substitui o registro inteiro no backend.
    this.lastKnownDraft = new Map();

    this.debouncedActorUpdate = debounce(this._executeActorUpdate.bind(this), 1000);
    this.debouncedItemUpdate = debounce(this._executeItemUpdate.bind(this), 1000);
  }

  notifyApiError(action, error, actor) {
    console.error(`Runarcana Sync | Falha ao ${action} a ficha ${actor?.name || actor?.id || 'desconhecida'}:`, error);
    ui.notifications.error(`Runarcana Sync: erro ao ${action} a ficha ${actor?.name || actor?.id || ''}: ${error?.message || 'erro desconhecido'}`);
  }

  async startListening(actor) {
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId || this.streams.has(actor.id)) return;
    // Marca a vaga antes de qualquer await, pra uma segunda chamada concorrente
    // (ex: duplo clique) não abrir dois streams pro mesmo ator. Removida no
    // catch caso a inicialização falhe (ex: sem login ainda), pra uma
    // próxima tentativa não ficar travada indefinidamente.
    this.streams.set(actor.id, { close() {} });

    try {
      try {
        const initialDraft = await this.apiClient.getDraft(draftId);
        if (initialDraft) {
          this.lastKnownDraft.set(actor.id, initialDraft);
          await this._applyRemoteDraft(actor, initialDraft);
        }
      } catch (error) {
        this.notifyApiError('carregar', error, actor);
      }

      const handle = await this.apiClient.openStream(
        draftId,
        async (message) => {
          if (message.sourceClientId === this.apiClient.clientId) {
            // Eco da própria escrita deste cliente: já refletido localmente.
            this.lastKnownDraft.set(actor.id, message.data);
            return;
          }
          this.lastKnownDraft.set(actor.id, message.data);
          this.activeSyncs.add(actor.id);
          try {
            await this._applyRemoteDraft(actor, message.data);
          } finally {
            this.activeSyncs.delete(actor.id);
          }
        },
        (error) => {
          console.warn('Runarcana Sync | Stream desconectado, tentando reconectar automaticamente:', error);
        },
      );

      this.streams.set(actor.id, handle);
    } catch (error) {
      this.streams.delete(actor.id);
      this.notifyApiError('conectar ao stream de', error, actor);
    }
  }

  stopListening(actor) {
    const handle = this.streams.get(actor.id);
    if (handle) {
      handle.close();
      this.streams.delete(actor.id);
    }
    this.lastKnownDraft.delete(actor.id);
  }

  async _applyRemoteDraft(actor, data) {
    const updateData = {};

    // 1. Processamento dinâmico de todos os atributos mapeados
    for (const [foundryPath, firebasePath] of Object.entries(ATTR_MAP)) {
      if (foundryPath.startsWith('system.abilities')) continue;
      const remoteValue = foundry.utils.getProperty(data, firebasePath);
      const localValue = foundry.utils.getProperty(actor, foundryPath);
      if (remoteValue !== undefined && remoteValue !== null && remoteValue !== localValue) {
        updateData[foundryPath] = remoteValue;
      }
    }

    // 2. Processamento Específico: Atributos com Bônus Racial
    ABILITY_KEYS.forEach(({ foundry: ab, firebase: fbKey }) => {
      const currentVal = actor.system.abilities?.[ab]?.value || 0;
      const baseScore = foundry.utils.getProperty(data, `attributes.scores.${fbKey}`) || 10;
      const racialBonus = foundry.utils.getProperty(data, `attributes.originBonuses.${fbKey}`) || 0;

      const remoteVal = baseScore + racialBonus;
      if (currentVal !== remoteVal) {
        updateData[`system.abilities.${ab}.value`] = remoteVal;
      }
    });

    if (Object.keys(updateData).length > 0) {
      await actor.update(updateData);
    }

    // 3. Deep Sync Inteligente de Itens (Garantindo suporte a Magias Complexas)
    if (data.items && Array.isArray(data.items)) {
      const remoteItems = data.items;
      const localItems = actor.items.contents;

      const toCreate = [];
      const toUpdate = [];
      const toDelete = [];

      for (const rItem of remoteItems) {
        // Busca pelo ID original salvo nas flags, ou pelo ID direto
        const lItem = localItems.find(i =>
          i.getFlag('runarcana-sync', 'sourceId') === rItem._id || i.id === rItem._id
        );

        // Sanitiza e formata o item (Especialmente as Activities de magias como Marca da Presa)
        const sanitizedRemoteItem = sanitizeActivities(foundry.utils.deepClone(rItem));

        if (!lItem) {
          // Criação de novo item vindo do backend
          const newItem = sanitizedRemoteItem;
          foundry.utils.setProperty(newItem, 'flags.runarcana-sync.sourceId', rItem._id);
          delete newItem._id; // O Foundry DEVE gerar o _id local
          toCreate.push(newItem);
        } else {
          // Atualização de item existente
          const lItemClean = cleanItemData(lItem.toObject());
          const rItemClean = cleanItemData(sanitizedRemoteItem);

          // Iguala os IDs temporariamente para a comparação de diff não falhar por isso
          rItemClean._id = lItemClean._id;
          if(lItemClean.flags?.['runarcana-sync']) delete lItemClean.flags['runarcana-sync'];
          if(rItemClean.flags?.['runarcana-sync']) delete rItemClean.flags['runarcana-sync'];

          // Compara os objetos limpos
          if (JSON.stringify(lItemClean) !== JSON.stringify(rItemClean)) {
            const updatePayload = sanitizedRemoteItem;
            updatePayload._id = lItem.id; // Usa o ID local do Foundry
            foundry.utils.setProperty(updatePayload, 'flags.runarcana-sync.sourceId', rItem._id);
            toUpdate.push(updatePayload);
          }
        }
      }

      // Verifica itens deletados no backend para deletar localmente
      for (const lItem of localItems) {
        const sourceId = lItem.getFlag('runarcana-sync', 'sourceId') || lItem.id;
        const existsRemote = remoteItems.some(i => i._id === sourceId);
        if (!existsRemote) {
          toDelete.push(lItem.id);
        }
      }

      // Executa as mutações no banco local do Foundry em Lote
      if (toDelete.length > 0) await actor.deleteEmbeddedDocuments("Item", toDelete);
      if (toCreate.length > 0) await actor.createEmbeddedDocuments("Item", toCreate);
      if (toUpdate.length > 0) await actor.updateEmbeddedDocuments("Item", toUpdate);
    }

    // 4. Equipar itens reais do compêndio local, quando o equipamento do
    // draft (armorId/weaponIds/gearIds) bater com a flag catalogKey de um
    // item de compêndio já sincronizado. Sem correspondência, não faz nada
    // (comportamento passivo, sem regressão).
    if (data.equipment) {
      await this._applyEquipmentFromCompendium(actor, data.equipment);
    }
  }

  async _applyEquipmentFromCompendium(actor, equipment) {
    const wantedIds = [
      equipment.armorId,
      ...(equipment.weaponIds || []),
      ...(equipment.gearIds || []),
    ].filter(Boolean);
    if (wantedIds.length === 0) return;

    let matches;
    try {
      matches = await findItemsByCatalogKeys(wantedIds);
    } catch (error) {
      console.warn('Runarcana Sync | Falha ao procurar itens de equipamento no compêndio:', error);
      return;
    }
    if (matches.size === 0) return;

    const localItems = actor.items.contents;
    const toCreate = [];

    for (const [catalogKey, ref] of matches) {
      const alreadyEquipped = localItems.some(
        (item) => item.getFlag('runarcana-sync', 'catalogKey') === catalogKey
      );
      if (alreadyEquipped) continue;

      const pack = game.packs.get(ref.packId);
      const sourceDoc = pack ? await pack.getDocument(ref.foundryId) : null;
      if (!sourceDoc) continue;

      const itemData = sourceDoc.toObject();
      delete itemData._id;
      foundry.utils.setProperty(itemData, 'flags.runarcana-sync.catalogKey', catalogKey);
      toCreate.push(itemData);
    }

    if (toCreate.length > 0) {
      await actor.createEmbeddedDocuments('Item', toCreate);
    }
  }

  async handleActorUpdate(actor, changes) {
    if (this.activeSyncs.has(actor.id)) return;

    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    this.debouncedActorUpdate(actor, draftId);
  }

  async _executeActorUpdate(actor, draftId) {
    // O PUT substitui a ficha inteira no backend, então partimos da última
    // ficha conhecida (preserva campos só-Web como concept/identity/equipment)
    // e sobrepomos só os campos que o Foundry conhece, com o valor atual do ator.
    // Sem uma ficha base conhecida (ex: falha na carga inicial), NÃO salvamos —
    // um PUT sem base apagaria concept/identity/equipment no backend.
    if (!this.lastKnownDraft.has(actor.id)) {
      console.warn(`Runarcana Sync | Ignorando atualização de ${actor.name}: ainda não temos uma cópia da ficha vinda do backend.`);
      return;
    }
    const base = foundry.utils.deepClone(this.lastKnownDraft.get(actor.id));

    for (const [foundryPath, firebasePath] of Object.entries(ATTR_MAP)) {
      if (foundryPath.startsWith('system.abilities')) continue;
      const currentValue = foundry.utils.getProperty(actor, foundryPath);
      if (currentValue !== undefined) {
        foundry.utils.setProperty(base, firebasePath, currentValue);
      }
    }

    ABILITY_KEYS.forEach(({ foundry: ab, firebase: fbKey }) => {
      const currentVal = actor.system.abilities?.[ab]?.value;
      if (currentVal === undefined) return;
      const racialBonus = foundry.utils.getProperty(base, `attributes.originBonuses.${fbKey}`) || 0;
      foundry.utils.setProperty(base, `attributes.scores.${fbKey}`, currentVal - racialBonus);
    });

    try {
      const saved = await this.apiClient.saveDraft(draftId, base);
      this.lastKnownDraft.set(actor.id, saved);
    } catch (error) {
      this.notifyApiError('salvar', error, actor);
      throw error;
    }
  }

  async handleItemUpdate(actor) {
    if (this.activeSyncs.has(actor.id)) return;
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    this.debouncedItemUpdate(actor, draftId);
  }

  async _executeItemUpdate(actor, draftId) {
    // Mesmo motivo do guard em _executeActorUpdate: sem uma ficha base
    // conhecida, um PUT aqui apagaria concept/identity/equipment no backend.
    if (!this.lastKnownDraft.has(actor.id)) {
      console.warn(`Runarcana Sync | Ignorando atualização de itens de ${actor.name}: ainda não temos uma cópia da ficha vinda do backend.`);
      return;
    }

    const itemsData = actor.items.map(item => {
      // Pega o objeto bruto do item, incluindo as "Activities" geradas pelo sistema dnd5e
      const data = item.toObject();

      // Preserva o ID do backend para garantir o vínculo bidirecional
      data._id = item.getFlag('runarcana-sync', 'sourceId') || data._id;
      // img vem relativo ao servidor do Foundry — sem isso a ficha do site
      // (outra origem) não consegue montar a URL do ícone do item.
      data.img = absoluteImg(data.img);

      return cleanItemData(data);
    });

    const base = foundry.utils.deepClone(this.lastKnownDraft.get(actor.id));
    base.items = itemsData;

    try {
      const saved = await this.apiClient.saveDraft(draftId, base);
      this.lastKnownDraft.set(actor.id, saved);
    } catch (error) {
      this.notifyApiError('salvar os itens de', error, actor);
      throw error;
    }
  }
}
