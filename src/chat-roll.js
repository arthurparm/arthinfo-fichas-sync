// Rolagem feita na ficha (POST /api/drafts/:id/rolls) chega aqui via SSE
// `event: roll`. O dado já foi sorteado no servidor — o Foundry só publica
// o resultado no chat, sem re-rolar.

const KIND_LABEL = {
  skill: 'Perícia',
  save: 'Resistência',
  attack: 'Ataque',
  ability: 'Atributo',
  'hit-die': 'Dado de vida',
  damage: 'Dano',
  heal: 'Cura',
};

export function flavorFor(roll) {
  const kind = KIND_LABEL[roll?.kind] ?? 'Rolagem';
  const label = typeof roll?.label === 'string' ? roll.label.trim() : '';
  return label ? `${kind} — ${label}` : kind;
}

export function formulaFor(roll) {
  const count = Math.max(1, Number(roll?.diceCount) || 1);
  const dieSize = Number(roll?.dieSize) || 20;
  const dice = `${count}d${dieSize}`;
  const modifier = Number(roll?.modifier) || 0;
  if (modifier === 0) return dice;
  return `${dice} ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}`;
}

export function facesFrom(roll) {
  if (Array.isArray(roll?.dice) && roll.dice.length > 0) {
    return roll.dice.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
  }
  const count = Number(roll?.diceCount) || 1;
  if (count === 1 && Number.isInteger(roll?.rawRoll) && roll.rawRoll > 0) {
    return [roll.rawRoll];
  }
  return [];
}

function alreadyPosted(rollId) {
  const messages = game.messages?.contents ?? [];
  return messages.some((message) => message.getFlag?.('runarcana-sync', 'rollId') === rollId);
}

function buildEvaluatedRoll(roll) {
  const faces = facesFrom(roll);
  if (faces.length === 0 || typeof Roll !== 'function' || typeof Roll.fromTerms !== 'function') {
    return null;
  }

  const Die = foundry?.dice?.terms?.Die;
  const OperatorTerm = foundry?.dice?.terms?.OperatorTerm;
  const NumericTerm = foundry?.dice?.terms?.NumericTerm;
  if (!Die) return null;

  const dieSize = Number(roll.dieSize) || 20;
  const die = new Die({
    number: faces.length,
    faces: dieSize,
    results: faces.map((result) => ({ result, active: true })),
  });
  if ('_evaluated' in die) die._evaluated = true;

  const terms = [die];
  const modifier = Number(roll.modifier) || 0;
  if (modifier !== 0 && OperatorTerm && NumericTerm) {
    const operator = new OperatorTerm({ operator: modifier > 0 ? '+' : '-' });
    const numeric = new NumericTerm({ number: Math.abs(modifier) });
    if ('_evaluated' in operator) operator._evaluated = true;
    if ('_evaluated' in numeric) numeric._evaluated = true;
    terms.push(operator, numeric);
  }

  const foundryRoll = Roll.fromTerms(terms);
  foundryRoll._evaluated = true;
  foundryRoll._total = roll.total;
  return foundryRoll;
}

export async function postSiteRollToChat(actor, roll) {
  if (!actor || !roll?.id) return;
  if (!game.user?.isGM) return;
  if (alreadyPosted(roll.id)) return;

  const flavor = flavorFor(roll);
  const flags = { 'runarcana-sync': { rollId: roll.id, kind: roll.kind } };
  const speaker = typeof ChatMessage.getSpeaker === 'function' ? ChatMessage.getSpeaker({ actor }) : { alias: actor.name };

  const content = `<div class="dice-roll"><div class="dice-result"><h4 class="dice-total">${roll.total}</h4><div class="dice-formula">${formulaFor(roll)}</div></div></div>`;

  try {
    let foundryRoll = null;
    try {
      foundryRoll = buildEvaluatedRoll(roll);
    } catch (error) {
      console.warn('Runarcana Sync | não deu pra montar o Roll do Foundry:', error);
    }

    if (foundryRoll && typeof foundryRoll.toMessage === 'function') {
      try {
        await foundryRoll.toMessage({ speaker, flavor, flags });
        return;
      } catch (error) {
        // dnd5e D20Roll/toMessage recusa Die genérico em teste de atributo,
        // perícia, save e ataque — sem este fallback a rolagem some do chat.
        console.warn('Runarcana Sync | toMessage falhou, publicando HTML no chat:', error);
      }
    }

    await ChatMessage.create({ speaker, flavor, flags, content });
  } catch (error) {
    console.error('Runarcana Sync | Falha ao publicar rolagem no chat:', error);
  }
}
