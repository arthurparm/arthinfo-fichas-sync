import { getDraftIdsLinkedToOtherActors } from './draft-selector.js';

export function inheritedDraftId(document, data) {
  const fromFlag =
    typeof document?.getFlag === 'function' ? document.getFlag('runarcana-sync', 'draftId') : undefined;
  if (fromFlag) return fromFlag;
  return data?.flags?.['runarcana-sync']?.draftId;
}

export function shouldStripInheritedDraftId(actors, draftId, creatingActorId) {
  if (!draftId) return false;
  return getDraftIdsLinkedToOtherActors(actors, creatingActorId).has(draftId);
}

export function actorsSharingDraftId(actors) {
  const byDraft = new Map();
  for (const actor of actors ?? []) {
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
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
  return { 'flags.runarcana-sync.-=draftId': null };
}
