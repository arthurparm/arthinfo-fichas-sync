import { getDraftIdsLinkedToOtherActors } from './draft-selector.js';
import { LEGACY_MODULE_ID, MODULE_ID, readFlag } from './module-id.js';

export function inheritedDraftId(document, data) {
  const fromFlag = typeof document?.getFlag === 'function' ? readFlag(document, 'draftId') : undefined;
  if (fromFlag) return fromFlag;
  return data?.flags?.[MODULE_ID]?.draftId ?? data?.flags?.[LEGACY_MODULE_ID]?.draftId;
}

export function shouldStripInheritedDraftId(actors, draftId, creatingActorId) {
  if (!draftId) return false;
  return getDraftIdsLinkedToOtherActors(actors, creatingActorId).has(draftId);
}

export function actorsSharingDraftId(actors) {
  const byDraft = new Map();
  for (const actor of actors ?? []) {
    const draftId = readFlag(actor, 'draftId');
    if (!draftId) continue;
    if (!byDraft.has(draftId)) byDraft.set(draftId, []);
    byDraft.get(draftId).push(actor);
  }
  return [...byDraft.values()].filter((group) => group.length > 1);
}

export function keepOldestActor(actors) {
  return [...actors].sort((a, b) => (a._stats?.createdTime ?? 0) - (b._stats?.createdTime ?? 0));
}

export function stripInheritedDraftFlagSource() {
  // remove nos dois escopos: o vínculo herdado pode ser do módulo antigo
  return { [`flags.${MODULE_ID}.-=draftId`]: null, [`flags.${LEGACY_MODULE_ID}.-=draftId`]: null };
}
