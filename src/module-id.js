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

// Remove o vínculo nos dois escopos (novo e legado).
export async function clearFlag(doc, key) {
  await doc.unsetFlag(MODULE_ID, key);
  if (doc.flags?.[LEGACY_MODULE_ID]?.[key] !== undefined) {
    await doc.update({ [`flags.${LEGACY_MODULE_ID}.-=${key}`]: null });
  }
}
