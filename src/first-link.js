// FDD-60: no primeiro vínculo, um Ator que já é um personagem de verdade (tem
// classe) manda nos números — o draft recém-criado só tem os defaults de
// createEmptyDraft (8 em todos os atributos) e não pode atropelar o Ator.
// Depois do primeiro sync a ficha é semeada a partir do Ator e o fluxo normal
// (site e Foundry editando os dois lados) volta.
//
// O pedido de "primeira sincronização" é gravado como flag no momento de
// vincular (draft-selector), não deduzido no reload: assim vínculos antigos não
// viram "primeiro vínculo" de novo a cada abertura do mundo.
import { clearFlag, MODULE_ID, readFlag } from './module-id.js';

const PENDING_FLAG = 'pendingFirstSync';

export function actorIsExistingCharacter(actor) {
  const items = actor?.items?.contents ?? actor?.items ?? [];
  return [...items].some((item) => item?.type === 'class');
}

export function isFirstSyncPending(actor) {
  return readFlag(actor, PENDING_FLAG) === true;
}

/** True quando o Ator deve ser a fonte dos valores neste primeiro sync. */
export function shouldSeedDraftFromActor(actor) {
  return isFirstSyncPending(actor) && actorIsExistingCharacter(actor);
}

export async function markFirstSyncPending(actor) {
  await actor.setFlag(MODULE_ID, PENDING_FLAG, true);
}

export async function clearFirstSyncPending(actor) {
  if (readFlag(actor, PENDING_FLAG) === undefined) return;
  await clearFlag(actor, PENDING_FLAG);
}
