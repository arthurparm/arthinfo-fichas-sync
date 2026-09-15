// Rolar dado de vida no site (POST /api/drafts/:id/rolls, kind: 'hit-die')
// não desconta nada sozinho — o POST só registra a rolagem. Este módulo
// aplica o resto do que Actor5e.rollHitDie() faria (ver
// "SISTEMA - NÃO ALTERAR/dnd5e/dnd5e.mjs", método rollHitDie), só sem a
// parte de rolar: o dado já foi sorteado no servidor e o jogador já viu o
// resultado (toast do site + chat via chat-roll.js), então rolar de novo
// aqui daria um número diferente e destoante.
//
// Dado de vida é dado que o Foundry manda (ver ONE_WAY_FOUNDRY_TO_SITE em
// data-mapper.js e o comentário sobre hp.max em AGENTS.md) — só um cliente
// aplica a atualização real no Ator (o GM, mesmo padrão de
// postSiteRollToChat), pra não descontar em dobro com vários clientes
// conectados na mesma ficha.

function resolveHitDiceClass(actor, denomination) {
  // actor.system.attributes.hd.classes é uma Collection do Foundry (tem
  // .find(), mas Array.isArray() nela dá false) — checar isso primeiro
  // fazia a função sempre sair sem achar nada, mesmo com a classe certa
  // disponível.
  const classes = actor.system?.attributes?.hd?.classes;
  if (!classes || typeof classes.find !== 'function') return null;
  return classes.find((cls) => cls.system?.hd?.denomination === denomination && cls.system?.hd?.value) ?? null;
}

export async function consumeSiteHitDieRoll(actor, roll) {
  if (!actor || roll?.kind !== 'hit-die') return;
  // Mesmo raciocínio de chat-roll.js: isGM sozinho deixa cada GM conectado
  // descontar o dado de vida separadamente. activeGM garante um único
  // aplicador entre todos os clientes.
  if (game.user?.id !== game.users?.activeGM?.id) return;

  const hd = actor.system?.attributes?.hd;
  if (!hd) return;

  const denomination = `d${Number(roll.dieSize) || 0}`;
  const actorUpdates = {};
  let cls = null;
  let classUpdate = null;

  if (actor.system?.isNPC) {
    if (!hd.value) return;
    actorUpdates['system.attributes.hd.spent'] = (hd.spent ?? 0) + 1;
  } else {
    cls = resolveHitDiceClass(actor, denomination);
    if (!cls) return;
    classUpdate = { 'system.hd.spent': cls.system.hd.spent + 1 };
  }

  const hp = actor.system?.attributes?.hp;
  const total = Math.max(0, Number(roll.total) || 0);
  if (hp) {
    const calculated =
      typeof actor.calculateDamage === 'function'
        ? actor.calculateDamage([{ type: 'healing', value: total }], { invertHealing: false })
        : null;
    const healAmount = calculated ? calculated.amount : total;
    const capacity = Math.max(0, (hp.effectiveMax ?? hp.max ?? 0) - (hp.value ?? 0));
    const dhp = Math.min(capacity, healAmount);
    if (dhp > 0) {
      actorUpdates['system.attributes.hp.value'] = (hp.value ?? 0) + dhp;
    }
  }

  try {
    if (Object.keys(actorUpdates).length > 0) await actor.update(actorUpdates);
    if (cls && classUpdate) await cls.update(classUpdate);
  } catch (error) {
    console.error('Runarcana Sync | Falha ao descontar dado de vida no Ator:', error);
  }
}
