// Id do módulo no Foundry. É o escopo de TODAS as flags e configurações:
//   - Ator:    flags.<id>.draftId  (vínculo Ator <-> ficha)
//   - Item:    flags.<id>.sourceId (id do item no lado do site) e catalogKey
//   - Mensagem de chat: flags.<id>.rollId
//   - Configurações do módulo (mesaKey, backendUrl, ...)
// O id mudou de 'runarcana-sync' para 'arthinfo-fichas-sync'. Dado gravado com o
// id antigo continua no banco do mundo, então a leitura cai pro escopo legado.
export const MODULE_ID = 'arthinfo-fichas-sync';
export const LEGACY_MODULE_ID = 'runarcana-sync';

// IMPORTANTE: não usar `doc.getFlag(LEGACY_MODULE_ID, ...)`. O Foundry recusa
// (lança erro) escopo de flag que não é um módulo ativo, e o id antigo deixou de
// existir. A leitura do legado é pela propriedade crua `doc.flags`, que sempre
// existe — o Foundry guarda a flag mesmo de módulo inativo.
export function readFlag(doc, key) {
  const current = doc?.getFlag?.(MODULE_ID, key);
  if (current !== undefined && current !== null) return current;
  return doc?.flags?.[LEGACY_MODULE_ID]?.[key];
}

// `flags.runarcana-sync` não segue no dado. O que o escopo novo ainda não tem
// passa para `flags.arthinfo-fichas-sync` e o escopo antigo sai do objeto.
// Não grava no documento: quem tem o Ator na mão usa legacyModuleFlagDeletions.
export function adoptLegacyModuleFlags(data) {
  const flags = data?.flags;
  const legacy = flags?.[LEGACY_MODULE_ID];
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return data;
  const current = {
    ...(flags[MODULE_ID] && typeof flags[MODULE_ID] === 'object' && !Array.isArray(flags[MODULE_ID])
      ? flags[MODULE_ID]
      : {}),
  };
  for (const [key, value] of Object.entries(legacy)) {
    if (key.startsWith('-=')) continue;
    if (current[key] === undefined || current[key] === null) current[key] = value;
  }
  if (Object.keys(current).length > 0) flags[MODULE_ID] = current;
  delete flags[LEGACY_MODULE_ID];
  return data;
}

// Update do Foundry que apaga o escopo antigo e preenche o novo quando falta.
// Foundry v14 usa ForcedDeletion; v13 só entende "-=chave".
export function legacyModuleFlagDeletions(doc) {
  const legacy = doc?.flags?.[LEGACY_MODULE_ID];
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  const update = {};
  let any = false;
  for (const [key, value] of Object.entries(legacy)) {
    if (key.startsWith('-=')) continue;
    any = true;
    if (ForcedDeletion) update[`flags.${LEGACY_MODULE_ID}.${key}`] = new ForcedDeletion();
    else update[`flags.${LEGACY_MODULE_ID}.-=${key}`] = null;
    const current = doc.flags?.[MODULE_ID]?.[key] ?? doc.getFlag?.(MODULE_ID, key);
    if ((current === undefined || current === null) && value !== undefined && value !== null) {
      update[`flags.${MODULE_ID}.${key}`] = value;
    }
  }
  return any ? update : null;
}

// Remove o vínculo nos dois escopos (novo e legado).
export async function clearFlag(doc, key) {
  await doc.unsetFlag(MODULE_ID, key);
  if (doc.flags?.[LEGACY_MODULE_ID]?.[key] !== undefined) {
    await doc.update({ [`flags.${LEGACY_MODULE_ID}.-=${key}`]: null });
  }
}
