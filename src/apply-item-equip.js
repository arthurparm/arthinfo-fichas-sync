import { readFlag } from './module-id.js';
// Equipar/desequipar arma pelo site (POST /api/drafts/:id/items/:itemId/equip)
// não muda o Ator sozinho — o POST só distribui o evento (mesmo padrão de
// rolagem, ver chat-roll.js/consume-hit-die.js). Este módulo aplica a
// mudança real no item do Ator; o hook `updateItem` já existente
// (src/index.js) cuida de mandar o draft atualizado de volta pro site — não
// precisa de nenhum código novo pra esse lado da volta.
//
// `itemId` chega no formato que o site conhece (draft.items[].id), que é
// `sourceId` quando o item nasceu do site (ver _overlayItemsOntoDraft em
// sync-manager.js) ou o `_id` real do Foundry no caso comum (item criado
// direto no Ator). Resolver pelos dois evita quebrar silenciosamente no
// caso raro.

export async function applyItemEquip(actor, itemEquip) {
  if (!actor || typeof itemEquip?.itemId !== 'string' || typeof itemEquip?.equipped !== 'boolean') {
    return;
  }
  // Mesmo raciocínio de consume-hit-die.js/chat-roll.js: isGM sozinho deixa
  // cada GM conectado aplicar a mesma mudança separadamente. activeGM
  // garante um único aplicador entre todos os clientes.
  if (game.user?.id !== game.users?.activeGM?.id) return;

  const { itemId, equipped } = itemEquip;
  const item = actor.items.find((candidate) => (readFlag(candidate, 'sourceId') || candidate.id) === itemId);
  if (!item) {
    console.warn(`Arthinfo Fichas | Item ${itemId} não encontrado em ${actor.name} pra (des)equipar.`);
    return;
  }
  if (item.system?.equipped === equipped) return;

  try {
    await item.update({ 'system.equipped': equipped });
  } catch (error) {
    console.error('Arthinfo Fichas | Falha ao (des)equipar item no Ator:', error);
  }
}
