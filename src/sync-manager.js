// foundry-module/src/sync-manager.js
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { ATTR_MAP, ABILITY_KEYS } from './data-mapper.js';

// Utilitário de debounce para agrupar atualizações rápidas
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Utilitário para achatar objetos JSON complexos (para Dot-Notation no Firebase)
function flattenObject(ob) {
  var toReturn = {};
  for (var i in ob) {
    if (!ob.hasOwnProperty(i)) continue;
    if ((typeof ob[i]) == 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
      var flatObject = flattenObject(ob[i]);
      for (var x in flatObject) {
        if (!flatObject.hasOwnProperty(x)) continue;
        toReturn[i + '.' + x] = flatObject[x];
      }
    } else {
      toReturn[i] = ob[i];
    }
  }
  return toReturn;
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
  constructor(firebaseClient) {
    this.firebaseClient = firebaseClient;
    this.subscriptions = new Map();
    this.activeSyncs = new Set();
    
    this.debouncedActorUpdate = debounce(this._executeActorUpdate.bind(this), 1000);
    this.debouncedItemUpdate = debounce(this._executeItemUpdate.bind(this), 1000);
  }

  startListening(actor) {
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId || this.subscriptions.has(actor.id)) return;

    const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
    const unsub = onSnapshot(docRef, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      
      this.activeSyncs.add(actor.id);
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
            // Criação de novo item vindo do Firebase
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

        // Verifica itens deletados no Firebase para deletar localmente
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

      this.activeSyncs.delete(actor.id);
    });

    this.subscriptions.set(actor.id, unsub);
  }

  async handleActorUpdate(actor, changes) {
    if (this.activeSyncs.has(actor.id)) return;
    
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    this.debouncedActorUpdate(actor, changes, draftId);
  }

  async _executeActorUpdate(actor, changes, draftId) {
    const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
    const updatePayload = {};

    const flatChanges = flattenObject(changes);

    for (const [foundryChangeKey, value] of Object.entries(flatChanges)) {
      if (foundryChangeKey.startsWith('_')) continue;
      
      if (ATTR_MAP[foundryChangeKey]) {
        const firebasePath = ATTR_MAP[foundryChangeKey];
        updatePayload[firebasePath] = value;
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      await updateDoc(docRef, updatePayload);
    }
  }

  async handleItemUpdate(actor) {
    if (this.activeSyncs.has(actor.id)) return;
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    this.debouncedItemUpdate(actor, draftId);
  }

  async _executeItemUpdate(actor, draftId) {
    const itemsData = actor.items.map(item => {
      // Pega o objeto bruto do item, incluindo as "Activities" geradas pelo sistema dnd5e
      const data = item.toObject();
      
      // Preserva o ID do Firebase para garantir o vínculo bidirecional
      data._id = item.getFlag('runarcana-sync', 'sourceId') || data._id;
      
      return cleanItemData(data);
    });
    
    const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
    // Envia o array de itens completo para o Firebase, incluindo as activities complexas
    await updateDoc(docRef, { items: itemsData });
  }
}