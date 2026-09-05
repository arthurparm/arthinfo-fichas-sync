// foundry-module/src/sync-manager.js
import { ATTR_MAP, ABILITY_KEYS, SKILL_KEY_MAP, readActorTraits, readFoundryBiography, readFoundryIdentity } from './data-mapper.js';
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

function resolveActorPortrait(img) {
  const url = absoluteImg(img);
  if (!url) return '';
  if (String(url).includes('mystery-man') || String(url).includes('icons/svg/item-bag')) return '';
  return url;
}

function statusList(effect) {
  const statuses = effect.statuses;
  if (!statuses) return [];
  if (typeof statuses.size === 'number') return [...statuses].map(String);
  if (Array.isArray(statuses)) return statuses.map(String);
  if (typeof statuses === 'object') return Object.keys(statuses);
  return [];
}

function collectApplicableEffects(actor) {
  if (typeof actor.allApplicableEffects === 'function') {
    return [...actor.allApplicableEffects()];
  }
  const collection = actor.effects;
  return collection?.contents ?? (Array.isArray(collection) ? collection : []);
}

function isEnchantmentEffect(effect) {
  return effect.type === 'enchantment' || effect.isAppliedEnchantment === true;
}

function effectDurationLabel(effect) {
  const label = effect.duration?.label;
  if (!label) return '';
  const normalized = String(label).trim();
  if (!normalized) return '';
  if (/^(none|nenhum|permanent|permanente|indefinid)/i.test(normalized)) return '';
  return normalized;
}

function effectSourceName(effect, actor) {
  const parent = effect.parent;
  if (parent && parent !== actor && parent.name) return parent.name;
  return '';
}

function serializeEffectEntry(effect, actor) {
  const entry = { name: effect.name };
  const img = absoluteImg(effect.img || effect.icon);
  if (img) entry.img = img;
  if (effect.disabled) entry.disabled = true;
  if (effect.isSuppressed) entry.isSuppressed = true;
  if (effect.isTemporary) entry.isTemporary = true;
  const statuses = statusList(effect);
  if (statuses.length) entry.statuses = statuses;
  const durationLabel = effectDurationLabel(effect);
  if (durationLabel) entry.durationLabel = durationLabel;
  const source = effectSourceName(effect, actor);
  if (source) entry.source = source;
  return entry;
}

// Condição de status de verdade (enfeitiçado, envenenado, etc.) tem
// effect.statuses preenchido. Efeitos passivos de item (Defesa Desarmada)
// também vêm com disabled: false, mas statuses vazio — não entram aqui.
function serializeActorConditions(actor) {
  return collectApplicableEffects(actor)
    .filter((effect) => !effect.disabled && !effect.isSuppressed && effect.name && !isEnchantmentEffect(effect))
    .map((effect) => serializeEffectEntry(effect, actor))
    .filter((entry) => {
      const statuses = entry.statuses ?? [];
      if (statuses.length === 0) return false;
      return !statuses.every((status) => status === 'exhaustion');
    })
    .map((entry) => {
      const condition = { name: entry.name, statuses: entry.statuses };
      if (entry.img) condition.img = entry.img;
      return condition;
    });
}

// Aba Efeitos do Foundry: passivos, inativos, temporários e suprimidos.
function serializeActorEffects(actor) {
  return collectApplicableEffects(actor)
    .filter((effect) => effect?.name && !isEnchantmentEffect(effect))
    .map((effect) => serializeEffectEntry(effect, actor));
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
          // Publica campos só-Foundry (retrato, death saves, condições)
          // e os itens do Ator (classe/raça/feats) que o draft remoto
          // ainda não tem — sem isso o cabeçalho da ficha fica com a
          // classe/origem da wiki e a aba Características perde a Fúria.
          await this._executeActorUpdate(actor, draftId);
          await this._executeItemUpdate(actor, draftId);
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

    // 2b. Proficiência de resistência (0/1 no Foundry, booleano no site)
    ABILITY_KEYS.forEach(({ foundry: ab, firebase: fbKey }) => {
      const remoteProficient = foundry.utils.getProperty(data, `proficiencies.savingThrows.${fbKey}`);
      if (remoteProficient === undefined) return;
      const remoteVal = remoteProficient ? 1 : 0;
      const currentVal = actor.system.abilities?.[ab]?.proficient ?? 0;
      if (currentVal !== remoteVal) {
        updateData[`system.abilities.${ab}.proficient`] = remoteVal;
      }
    });

    // 2c. Proficiência de perícia (0/0.5/1/2 no Foundry <-> false/'expertise' no site)
    SKILL_KEY_MAP.forEach(({ foundry: sk, id }) => {
      const remoteLevel = foundry.utils.getProperty(data, `proficiencies.skills.${id}`);
      if (remoteLevel === undefined) return;
      const remoteVal = remoteLevel === 'expertise' ? 2 : remoteLevel === true ? 1 : 0;
      const currentVal = actor.system.skills?.[sk]?.value ?? 0;
      if (currentVal !== remoteVal) {
        updateData[`system.skills.${sk}.value`] = remoteVal;
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

      // Só apaga o que o sync criou a partir do draft (tem sourceId).
      // Itens nativos do Foundry (classe, raça, Fúria...) não têm essa
      // flag — se o site ainda não os conhece, não podem sumir do Ator.
      for (const lItem of localItems) {
        const sourceId = lItem.getFlag('runarcana-sync', 'sourceId');
        if (!sourceId) continue;
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

    // Proficiência de resistência: Foundry manda (0/1 -> booleano do site)
    ABILITY_KEYS.forEach(({ foundry: ab, firebase: fbKey }) => {
      const proficient = actor.system.abilities?.[ab]?.proficient;
      if (proficient === undefined) return;
      foundry.utils.setProperty(base, `proficiencies.savingThrows.${fbKey}`, proficient >= 1);
    });

    // Proficiência de perícia: Foundry manda (0/0.5/1/2 -> ProficiencyLevel
    // do site; meia-proficiência não tem equivalente e vira `false`)
    SKILL_KEY_MAP.forEach(({ foundry: sk, id }) => {
      const value = actor.system.skills?.[sk]?.value;
      if (value === undefined) return;
      const level = value >= 2 ? 'expertise' : value >= 1 ? true : false;
      foundry.utils.setProperty(base, `proficiencies.skills.${id}`, level);
    });

    // Habilidade de conjuração: só Foundry -> site (não editável na ficha).
    // Cobre só a classe conjuradora principal (system.attributes.spellcasting
    // é um campo único no ator, dnd5e não separa por classe em multiclasse).
    const spellcastingAbility = actor.system.attributes?.spellcasting;
    if (spellcastingAbility) {
      const match = ABILITY_KEYS.find(({ foundry: ab }) => ab === spellcastingAbility);
      if (match) {
        foundry.utils.setProperty(base, 'spellcasting.ability', match.firebase);
      }
    }

    // Retrato: só Foundry -> site. A ficha não deve alterar o img do Ator.
    foundry.utils.setProperty(base, 'concept.portraitUrl', resolveActorPortrait(actor.img));
    base.conditions = serializeActorConditions(actor);
    base.effects = serializeActorEffects(actor);
    // Sentidos, resistências, proficiências de armadura/arma e idiomas —
    // listas/objetos, só Foundry -> site (evita eco de Set vs array).
    base.traits = readActorTraits(actor);
    base.foundryIdentity = readFoundryIdentity(actor);
    const biography = readFoundryBiography(actor);
    base.identity = { ...(base.identity ?? {}), ...biography.identity };
    base.description = { ...(base.description ?? {}), ...biography.description };

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

    const itemsData = [];
    for (const item of actor.items) {
      try {
        const data = item.toObject();
        data._id = item.getFlag('runarcana-sync', 'sourceId') || data._id;
        data.img = absoluteImg(data.img);
        const cleaned = cleanItemData(data);
        // advancement de classe/raça é enorme e não é lido pela ficha —
        // sem isso o PUT às vezes falha e o item de classe some do draft.
        if (['class', 'subclass', 'race', 'background'].includes(cleaned.type) && cleaned.system) {
          delete cleaned.system.advancement;
        }
        itemsData.push(cleaned);
      } catch (error) {
        console.warn(`Runarcana Sync | Não foi possível serializar ${item.name} (${item.type}):`, error);
        itemsData.push({
          _id: item.getFlag('runarcana-sync', 'sourceId') || item.id,
          name: item.name,
          type: item.type,
          img: absoluteImg(item.img),
          system: item.type === 'class' ? { levels: item.system?.levels } : {},
        });
      }
    }

    const base = foundry.utils.deepClone(this.lastKnownDraft.get(actor.id));
    base.items = itemsData;
    base.foundryIdentity = readFoundryIdentity(actor);
    base.conditions = serializeActorConditions(actor);
    base.effects = serializeActorEffects(actor);

    try {
      const saved = await this.apiClient.saveDraft(draftId, base);
      this.lastKnownDraft.set(actor.id, saved);
    } catch (error) {
      this.notifyApiError('salvar os itens de', error, actor);
      throw error;
    }
  }
}
