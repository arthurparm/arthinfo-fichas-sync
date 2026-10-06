// foundry-module/src/sync-manager.js
import {
  ATTR_MAP,
  ONE_WAY_FOUNDRY_TO_SITE,
  NON_BLANK_FOUNDRY_PATHS,
  ABILITY_KEYS,
  SKILL_KEY_MAP,
  readActorTraits,
  readFoundryBiography,
  readFoundryIdentity,
  foundrySkillValueToProficiencyLevel,
  proficiencyLevelToFoundrySkillValue,
} from './data-mapper.js';
import { UNSUPPORTED, buildPatch } from './draft-diff.js';
import { findItemsByCatalogKeys, absoluteImg } from './compendium-sync.js';
import { postSiteRollToChat } from './chat-roll.js';
import { consumeSiteHitDieRoll } from './consume-hit-die.js';
import { getDraftIdsLinkedToOtherActors } from './draft-selector.js';
import { applyItemEquip } from './apply-item-equip.js';
import { applyItemCast } from './apply-item-cast.js';
import { applyRest } from './apply-rest.js';
import { applySpellSlot } from './apply-spell-slot.js';
import { LEGACY_MODULE_ID, MODULE_ID, readFlag } from './module-id.js';
import { actorHasNoMaxHp, repairClassHitPoints, startAtFullHitPoints } from './class-hit-points.js';

// Utilitário de debounce para agrupar atualizações rápidas
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

const KEEP_LOCAL_ADVANCEMENT_TYPES = new Set(['class', 'subclass', 'race', 'background']);

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
    // IMPORTANTE: Nunca delete a flag <id do módulo>.sourceId (novo ou legado) durante a limpeza,
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
  // Se o backend enviar como array por engano, convertemos para objeto (dicionário)
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

function isDraftClaimedByAnotherActor(actor, draftId) {
  if (typeof game === 'undefined' || !game.actors) return false;
  return getDraftIdsLinkedToOtherActors(game.actors, actor.id).has(draftId);
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
    // Cauda de PUTs por ator: o debounce do Ator e o de itens são separados,
    // então dois PUT full-replace podem disparar juntos (FDD-36). Cada um
    // clonaria a mesma base e o mais lento sobrescreveria o mais rápido.
    // Serializar garante que o segundo parta do draft que o primeiro salvou.
    this.saveQueues = new Map();

    this.debouncedActorUpdate = debounce(this._executeActorUpdate.bind(this), 1000);
    this.debouncedItemUpdate = debounce(this._executeItemUpdate.bind(this), 1000);
  }

  notifyApiError(action, error, actor) {
    console.error(`Arthinfo Fichas | Falha ao ${action} a ficha ${actor?.name || actor?.id || 'desconhecida'}:`, error);
    ui.notifications.error(`Arthinfo Fichas: erro ao ${action} a ficha ${actor?.name || actor?.id || ''}: ${error?.message || 'erro desconhecido'}`);
  }

  async startListening(actor) {
    const draftId = readFlag(actor, 'draftId');
    if (!draftId || this.streams.has(actor.id)) return;
    if (isDraftClaimedByAnotherActor(actor, draftId)) {
      console.warn(
        `Arthinfo Fichas | ${actor.name} não inicia sync: a ficha ${draftId} já está vinculada a outro Ator.`,
      );
      return;
    }
    // Marca a vaga antes de qualquer await, pra uma segunda chamada concorrente
    // (ex: duplo clique) não abrir dois streams pro mesmo ator. Removida no
    // catch caso a inicialização falhe (ex: chave inválida), pra uma
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
          if (message.roll) {
            await postSiteRollToChat(actor, message.roll);
            await consumeSiteHitDieRoll(actor, message.roll);
            return;
          }
          if (message.itemEquip) {
            await applyItemEquip(actor, message.itemEquip);
            return;
          }
          if (message.itemCast) {
            await applyItemCast(actor, message.itemCast);
            return;
          }
          if (message.rest) {
            await applyRest(actor, message.rest);
            return;
          }
          if (message.spellSlot) {
            await applySpellSlot(actor, message.spellSlot);
            return;
          }
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
          console.warn('Arthinfo Fichas | Stream desconectado, tentando reconectar automaticamente:', error);
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
    // Antes de criar/atualizar itens: se o Ator ainda não tem PV máximo, quem
    // der PV a ele (classe nova ou reparada) também o deixa com a vida cheia.
    const hadNoMaxHp = actorHasNoMaxHp(actor);
    const remoteMaxHp = foundry.utils.getProperty(data, 'derivedStats.maxHp');
    const siteHasNoHp = typeof remoteMaxHp === 'number' && remoteMaxHp <= 0;

    // 1. Processamento dinâmico de todos os atributos mapeados
    for (const [foundryPath, firebasePath] of Object.entries(ATTR_MAP)) {
      if (foundryPath.startsWith('system.abilities')) continue;
      if (ONE_WAY_FOUNDRY_TO_SITE.has(foundryPath)) continue;
      // Ficha sem PV máximo (0 herdado de Ator sem classe): o hp.value dela
      // não é um PV real e não pode zerar o Ator ao reconectar (FDD-90).
      if (siteHasNoHp && foundryPath.startsWith('system.attributes.hp.')) continue;
      const remoteValue = foundry.utils.getProperty(data, firebasePath);
      if (NON_BLANK_FOUNDRY_PATHS.has(foundryPath) && (typeof remoteValue !== 'string' || !remoteValue.trim())) continue;
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

    // 2c. Proficiência de perícia (0/0.5/1/2 no Foundry <-> false/'half'/true/'expertise' no site, FDD-10)
    SKILL_KEY_MAP.forEach(({ foundry: sk, id }) => {
      const remoteLevel = foundry.utils.getProperty(data, `proficiencies.skills.${id}`);
      if (remoteLevel === undefined) return;
      const remoteVal = proficiencyLevelToFoundrySkillValue(remoteLevel);
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
          readFlag(i, 'sourceId') === rItem._id || i.id === rItem._id
        );

        // Sanitiza e formata o item (Especialmente as Activities de magias como Marca da Presa)
        const sanitizedRemoteItem = sanitizeActivities(foundry.utils.deepClone(rItem));

        if (!lItem) {
          // Criação de novo item vindo do backend
          const newItem = sanitizedRemoteItem;
          foundry.utils.setProperty(newItem, `flags.${MODULE_ID}.sourceId`, rItem._id);
          delete newItem._id; // O Foundry DEVE gerar o _id local
          toCreate.push(newItem);
        } else {
          // Atualização de item existente
          const lItemClean = cleanItemData(lItem.toObject());
          const rItemClean = cleanItemData(sanitizedRemoteItem);
          // O avanço de classe/raça/antecedente é do Foundry: o site só manda o de PV
          // na criação. Comparar ou reescrever aqui apagaria o avanço real do Ator.
          if (KEEP_LOCAL_ADVANCEMENT_TYPES.has(lItemClean.type)) {
            if (lItemClean.system) delete lItemClean.system.advancement;
            if (rItemClean.system) delete rItemClean.system.advancement;
          }

          // Iguala os IDs temporariamente para a comparação de diff não falhar por isso
          rItemClean._id = lItemClean._id;
          for (const scope of [MODULE_ID, LEGACY_MODULE_ID]) {
            if (lItemClean.flags?.[scope]) delete lItemClean.flags[scope];
            if (rItemClean.flags?.[scope]) delete rItemClean.flags[scope];
          }

          // Compara os objetos limpos
          if (JSON.stringify(lItemClean) !== JSON.stringify(rItemClean)) {
            const updatePayload = sanitizedRemoteItem;
            updatePayload._id = lItem.id; // Usa o ID local do Foundry
            if (KEEP_LOCAL_ADVANCEMENT_TYPES.has(lItemClean.type) && updatePayload.system) {
              delete updatePayload.system.advancement;
            }
            foundry.utils.setProperty(updatePayload, `flags.${MODULE_ID}.sourceId`, rItem._id);
            toUpdate.push(updatePayload);
          }
        }
      }

      // Só apaga o que o sync criou a partir do draft (tem sourceId).
      // Itens nativos do Foundry (classe, raça, Fúria...) não têm essa
      // flag — se o site ainda não os conhece, não podem sumir do Ator.
      for (const lItem of localItems) {
        const sourceId = readFlag(lItem, 'sourceId');
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

    // 3b. Classe sem avanço de PV (Ator criado por versão antiga do builder):
    // sem isso hp.max fica 0 e o personagem aparece caído.
    try {
      await repairClassHitPoints(actor);
    } catch (error) {
      console.warn('Arthinfo Fichas | Não foi possível reparar o PV da classe:', error);
    }
    try {
      await startAtFullHitPoints(actor, hadNoMaxHp);
    } catch (error) {
      console.warn('Arthinfo Fichas | Não foi possível encher o PV do Ator:', error);
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
      console.warn('Arthinfo Fichas | Falha ao procurar itens de equipamento no compêndio:', error);
      return;
    }
    if (matches.size === 0) return;

    const localItems = actor.items.contents;
    const toCreate = [];

    for (const [catalogKey, ref] of matches) {
      const alreadyEquipped = localItems.some(
        (item) => readFlag(item, 'catalogKey') === catalogKey
      );
      if (alreadyEquipped) continue;

      const pack = game.packs.get(ref.packId);
      const sourceDoc = pack ? await pack.getDocument(ref.foundryId) : null;
      if (!sourceDoc) continue;

      const itemData = sourceDoc.toObject();
      delete itemData._id;
      foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.catalogKey`, catalogKey);
      toCreate.push(itemData);
    }

    if (toCreate.length > 0) {
      await actor.createEmbeddedDocuments('Item', toCreate);
    }
  }

  async handleActorUpdate(actor, changes) {
    if (this.activeSyncs.has(actor.id)) return;

    const draftId = readFlag(actor, 'draftId');
    if (!draftId) return;
    if (isDraftClaimedByAnotherActor(actor, draftId)) return;

    this.debouncedActorUpdate(actor, draftId);
  }

  _overlayActorOntoDraft(actor, base) {
    // Ator sem classe/PV aplicado (hp.max 0) ainda não tem PV de verdade:
    // não envia hp.* pro site, que senão mostra 0/0 e "caído" (FDD-90).
    const actorHasNoHp = !(foundry.utils.getProperty(actor, 'system.attributes.hp.max') > 0);
    for (const [foundryPath, firebasePath] of Object.entries(ATTR_MAP)) {
      if (foundryPath.startsWith('system.abilities')) continue;
      if (actorHasNoHp && foundryPath.startsWith('system.attributes.hp.')) continue;
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
    // do site, incluindo 'half' pra meia-proficiência, FDD-10)
    SKILL_KEY_MAP.forEach(({ foundry: sk, id }) => {
      const value = actor.system.skills?.[sk]?.value;
      if (value === undefined) return;
      foundry.utils.setProperty(base, `proficiencies.skills.${id}`, foundrySkillValueToProficiencyLevel(value));
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
  }

  _overlayItemsOntoDraft(actor, base) {
    const itemsData = [];
    for (const item of actor.items) {
      try {
        const data = item.toObject();
        data._id = readFlag(item, 'sourceId') || data._id;
        data.img = absoluteImg(data.img);
        const cleaned = cleanItemData(data);
        // advancement de classe/raça é enorme e não é lido pela ficha —
        // sem isso o PUT às vezes falha e o item de classe some do draft.
        if (['class', 'subclass', 'race', 'background'].includes(cleaned.type) && cleaned.system) {
          delete cleaned.system.advancement;
        }
        itemsData.push(cleaned);
      } catch (error) {
        console.warn(`Arthinfo Fichas | Não foi possível serializar ${item.name} (${item.type}):`, error);
        itemsData.push({
          _id: readFlag(item, 'sourceId') || item.id,
          name: item.name,
          type: item.type,
          img: absoluteImg(item.img),
          system: item.type === 'class' ? { levels: item.system?.levels } : {},
        });
      }
    }

    base.items = itemsData;
    base.foundryIdentity = readFoundryIdentity(actor);
    base.conditions = serializeActorConditions(actor);
    base.effects = serializeActorEffects(actor);
  }

  _saveDraftFromActor(actor, draftId, overlay, errorAction) {
    const previous = this.saveQueues.get(actor.id) ?? Promise.resolve();
    const run = previous.then(() => this._saveDraftFromActorNow(actor, draftId, overlay, errorAction));
    // A fila segue mesmo se este save falhar; quem chamou ainda recebe o erro.
    const tail = run.catch(() => {});
    this.saveQueues.set(actor.id, tail);
    tail.then(() => {
      if (this.saveQueues.get(actor.id) === tail) this.saveQueues.delete(actor.id);
    });
    return run;
  }

  // Grava só o que mudou (PATCH, FDD-78). Cai no PUT inteiro quando o diff sai
  // da allowlist da API ou quando a API é antiga e não tem PATCH. Devolve o
  // draft salvo, ou null se nada mudou (não chama a API).
  async _persistDraft(draftId, before, next) {
    if (this.patchSupported === false) return this.apiClient.saveDraft(draftId, next);

    const patch = buildPatch(before, next);
    if (patch === null) return null;
    if (patch === UNSUPPORTED) return this.apiClient.saveDraft(draftId, next);

    try {
      return await this.apiClient.patchDraft(draftId, patch, before.updatedAt);
    } catch (error) {
      // Ficha apagada (404 com code) e 409/401/403... sobem; só "API sem PATCH"
      // (404/405 genérico) ou patch recusado (400/413) viram PUT.
      const apiWithoutPatch =
        (error?.status === 404 && error.code !== 'DRAFT_NOT_FOUND') || error?.status === 405;
      if (apiWithoutPatch) this.patchSupported = false;
      if (apiWithoutPatch || error?.status === 400 || error?.status === 413) {
        console.warn(`Arthinfo Fichas | PATCH recusado (HTTP ${error.status}); enviando a ficha inteira por PUT.`);
        return this.apiClient.saveDraft(draftId, next);
      }
      throw error;
    }
  }

  async _saveDraftFromActorNow(actor, draftId, overlay, errorAction) {
    const writeOnce = async () => {
      if (!this.lastKnownDraft.has(actor.id)) {
        console.warn(`Arthinfo Fichas | Ignorando atualização de ${actor.name}: ainda não temos uma cópia da ficha vinda do backend.`);
        return null;
      }
      const before = this.lastKnownDraft.get(actor.id);
      const base = foundry.utils.deepClone(before);
      overlay(actor, base);
      return this._persistDraft(draftId, before, base);
    };

    try {
      const saved = await writeOnce();
      if (saved) this.lastKnownDraft.set(actor.id, saved);
    } catch (error) {
      // 409: o site (ou outro Ator) escreveu por cima. Não descarta a mudança
      // do Ator — troca a base pela cópia atual do servidor e reaplica HP/itens.
      if (error?.status === 409 && error.current) {
        this.lastKnownDraft.set(actor.id, error.current);
        try {
          const saved = await writeOnce();
          if (saved) this.lastKnownDraft.set(actor.id, saved);
          return;
        } catch (retryError) {
          this.notifyApiError(errorAction, retryError, actor);
          throw retryError;
        }
      }
      this.notifyApiError(errorAction, error, actor);
      throw error;
    }
  }

  async _executeActorUpdate(actor, draftId) {
    // O PUT substitui a ficha inteira no backend, então partimos da última
    // ficha conhecida (preserva campos só-Web como concept/identity/equipment)
    // e sobrepomos só os campos que o Foundry conhece, com o valor atual do ator.
    // Sem uma ficha base conhecida (ex: falha na carga inicial), NÃO salvamos —
    // um PUT sem base apagaria concept/identity/equipment no backend.
    if (!this.lastKnownDraft.has(actor.id)) {
      console.warn(`Arthinfo Fichas | Ignorando atualização de ${actor.name}: ainda não temos uma cópia da ficha vinda do backend.`);
      return;
    }
    await this._saveDraftFromActor(actor, draftId, (currentActor, base) => {
      this._overlayActorOntoDraft(currentActor, base);
    }, 'salvar');
  }

  async handleItemUpdate(actor) {
    if (this.activeSyncs.has(actor.id)) return;
    const draftId = readFlag(actor, 'draftId');
    if (!draftId) return;
    if (isDraftClaimedByAnotherActor(actor, draftId)) return;

    this.debouncedItemUpdate(actor, draftId);
  }

  async _executeItemUpdate(actor, draftId) {
    // Mesmo motivo do guard em _executeActorUpdate: sem uma ficha base
    // conhecida, um PUT aqui apagaria concept/identity/equipment no backend.
    if (!this.lastKnownDraft.has(actor.id)) {
      console.warn(`Arthinfo Fichas | Ignorando atualização de itens de ${actor.name}: ainda não temos uma cópia da ficha vinda do backend.`);
      return;
    }

    await this._saveDraftFromActor(actor, draftId, (currentActor, base) => {
      this._overlayItemsOntoDraft(currentActor, base);
    }, 'salvar os itens de');
  }
}
