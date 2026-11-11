// advancementOrigin do dnd5e é "<id do item no Ator>.<id do advancement>".
// O site, quando passar a gravar o vínculo do dote, manda
// "<_id do dote no draft>.<advId>". O id do draft não existe no Ator: a
// tradução troca só esse prefixo pelo id local, depois que o dote foi criado.
//
// Qualquer outro texto fica como está. O site de hoje grava
// "<id do compêndio>.adv" (não é o _id do dote). Módulo antigo trata isso
// como texto opaco; este também, senão um sync novo reescreve a origem que
// o site ainda não decidiu mudar.

import { readFlag } from './module-id.js';

export function splitAdvancementOrigin(origin) {
  if (typeof origin !== 'string') return null;
  const dot = origin.indexOf('.');
  if (dot <= 0 || dot >= origin.length - 1) return null;
  return { id: origin.slice(0, dot), rest: origin.slice(dot) };
}

// idMap: prefixo atual → prefixo desejado. Prefixo ausente ou igual não muda.
export function rewriteAdvancementOrigin(origin, idMap) {
  const parts = splitAdvancementOrigin(origin);
  if (!parts || !idMap) return origin;
  const mapped = idMap.get(parts.id);
  if (!mapped || mapped === parts.id) return origin;
  return `${mapped}${parts.rest}`;
}

export function rewriteItemAdvancementOrigin(item, idMap) {
  const origin = item?.flags?.dnd5e?.advancementOrigin;
  if (typeof origin !== 'string') return;
  const next = rewriteAdvancementOrigin(origin, idMap);
  if (next !== origin) item.flags.dnd5e.advancementOrigin = next;
}

// Dote (e característica, type "feat" no dnd5e) vinculado ao draft.
// Classe/raça/antecedente ficam de fora: o "<compendiumId>.adv" atual aponta
// pra eles e tem de sobreviver à ida e à volta.
export function draftFeatIdsToLocalIds(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item?.type !== 'feat' || !item.id) continue;
    const draftId = readFlag(item, 'sourceId');
    if (!draftId) continue;
    map.set(draftId, item.id);
  }
  return map;
}

export function localFeatIdsToDraftIds(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item?.type !== 'feat' || !item.id) continue;
    const draftId = readFlag(item, 'sourceId');
    if (!draftId || draftId === item.id) continue;
    map.set(item.id, draftId);
  }
  return map;
}

// createEmbeddedDocuments devolve os documentos com o id local. Sem isso a
// magia criada no mesmo passe não enxerga o dote novo; o próximo sync corrige.
export function rememberCreatedFeats(created, draftToLocal) {
  if (!Array.isArray(created) || !draftToLocal) return;
  for (const doc of created) {
    if (doc?.type !== 'feat' || !doc.id) continue;
    const draftId = readFlag(doc, 'sourceId');
    if (!draftId) continue;
    draftToLocal.set(draftId, doc.id);
  }
}

export function forgetDeletedFeatIds(draftToLocal, deletedLocalIds) {
  if (!draftToLocal || !deletedLocalIds?.length) return;
  const gone = new Set(deletedLocalIds);
  for (const [draftId, localId] of draftToLocal) {
    if (gone.has(localId)) draftToLocal.delete(draftId);
  }
}
