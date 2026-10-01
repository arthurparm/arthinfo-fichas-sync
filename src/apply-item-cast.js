import { readFlag } from './module-id.js';
// Conjurar magia pelo site (POST /api/drafts/:id/items/:itemId/cast) não
// desconta nada sozinho — o POST só distribui o comando (mesmo padrão de
// chat-roll.js/apply-item-equip.js). Este módulo aplica o efeito real:
//
// - using: 'slot' — desconta 1 do slot de magia do círculo escolhido no
//   Ator (`system.spells.spellN.value`).
// - using: 'itemUses' — desconta 1 carga própria do item: a "conjuração
//   gratuita" que magia "Sempre Preparada" ganha no dnd5e 2024 (ver
//   activity tipo `forward` no item), recarrega no descanso longo.
// - using: 'gm' — magia com mecânica real demais pra automatizar (mais de
//   uma activity de efeito, ex. Bola de Fogo de Explosão Retardada usa um
//   recurso próprio em várias etapas) posta um aviso no chat pro mestre
//   resolver manualmente no Foundry, em vez de arriscar descontar o
//   recurso errado.

function resolveItem(actor, itemId) {
  return actor.items.find(
    (candidate) => (readFlag(candidate, 'sourceId') || candidate.id) === itemId,
  );
}

async function applySlotConsumption(actor, item, slotLevel) {
  const key = `spell${slotLevel}`;
  const band = actor.system?.spells?.[key];
  if (!band || (band.value ?? 0) <= 0) {
    console.warn(
      `Arthinfo Fichas | Sem slot de ${slotLevel}º círculo disponível em ${actor.name} pra conjurar ${item.name}.`,
    );
    return;
  }
  await actor.update({ [`system.spells.${key}.value`]: band.value - 1 });
}

async function applyItemUsesConsumption(item) {
  const uses = item.system?.uses;
  const max = Number(uses?.max);
  const spent = uses?.spent ?? 0;
  if (!uses || !Number.isFinite(max) || spent >= max) {
    console.warn(`Arthinfo Fichas | Sem carga própria disponível em ${item.name} pra conjurar de graça.`);
    return;
  }
  await item.update({ 'system.uses.spent': spent + 1 });
}

async function postGmNotice(actor, item) {
  const speaker =
    typeof ChatMessage.getSpeaker === 'function' ? ChatMessage.getSpeaker({ actor }) : { alias: actor.name };
  const content = `<p><strong>${actor.name}</strong> quer conjurar <strong>${item.name}</strong> — mecânica complexa demais pra automatizar pela ficha, resolver no Foundry.</p>`;
  await ChatMessage.create({ speaker, content });
}

export async function applyItemCast(actor, itemCast) {
  if (!actor || !itemCast || typeof itemCast.itemId !== 'string') return;
  // Mesmo raciocínio de apply-item-equip.js/consume-hit-die.js: activeGM
  // garante um único aplicador entre todos os clientes conectados.
  if (game.user?.id !== game.users?.activeGM?.id) return;

  const item = resolveItem(actor, itemCast.itemId);
  if (!item) {
    console.warn(`Arthinfo Fichas | Item ${itemCast.itemId} não encontrado em ${actor.name} pra conjurar.`);
    return;
  }

  try {
    if (itemCast.using === 'slot') {
      const slotLevel = Number(itemCast.slotLevel);
      if (!Number.isInteger(slotLevel) || slotLevel < 1 || slotLevel > 9) return;
      await applySlotConsumption(actor, item, slotLevel);
    } else if (itemCast.using === 'itemUses') {
      await applyItemUsesConsumption(item);
    } else if (itemCast.using === 'gm') {
      await postGmNotice(actor, item);
    }
  } catch (error) {
    console.error('Arthinfo Fichas | Falha ao aplicar conjuração de magia:', error);
  }
}
