// PV máximo de Ator criado pelo site.
//
// O dnd5e calcula `system.attributes.hp.max` somando o avanço "HitPoints" da
// classe (o valor de cada nível). O builder do site grava a classe sem o resto do
// avanço, e versões antigas gravavam sem avanço nenhum: o Ator ficava com
// hp.max 0 e "caído" (FDD-90). Este módulo repara isso no Ator, usando o próprio
// formato do dnd5e, sem o site mandar PV calculado.

const HIT_POINTS = 'HitPoints';

// O avanço vem como lista (versões antigas) ou como objeto por _id (dnd5e 5+).
export function advancementEntries(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((entry, index) => [String(entry?._id ?? index), entry]);
  }
  return Object.entries(raw);
}

export function findHitPoints(raw) {
  const found = advancementEntries(raw).find(([, entry]) => entry?.type === HIT_POINTS);
  return found ? { id: found[0], entry: found[1] } : null;
}

// Devolve o `update` do item que deixa o nível 1 no máximo, ou null se já está.
export function buildHitPointsUpdate(itemData, newId) {
  if (!itemData || itemData.type !== 'class') return null;
  if (!(Number(itemData.system?.levels) >= 1)) return null;

  const raw = itemData.system?.advancement;
  const existing = findHitPoints(raw);
  if (existing && existing.entry?.value?.[1] !== undefined) return null;

  if (existing) {
    if (Array.isArray(raw)) {
      return {
        'system.advancement': raw.map((entry) =>
          entry?._id === existing.entry._id || entry === existing.entry
            ? { ...entry, value: { ...(entry.value ?? {}), 1: 'max' } }
            : entry,
        ),
      };
    }
    return { [`system.advancement.${existing.id}.value.1`]: 'max' };
  }

  const id = newId();
  const entry = { _id: id, type: HIT_POINTS, configuration: {}, value: { 1: 'max' }, flags: {}, hint: '' };
  if (Array.isArray(raw)) {
    return { 'system.advancement': [...raw, entry] };
  }
  return { [`system.advancement.${id}`]: entry };
}

// Repara todas as classes do Ator. Devolve quantas foram reparadas.
export async function repairClassHitPoints(actor) {
  let repaired = 0;

  for (const item of actor.items?.contents ?? actor.items ?? []) {
    if (item.type !== 'class') continue;
    const update = buildHitPointsUpdate(item.toObject(), () => foundry.utils.randomID(16));
    if (!update) continue;
    await item.update(update);
    repaired += 1;
  }
  return repaired;
}

export function actorHasNoMaxHp(actor) {
  return !(Number(actor?.system?.attributes?.hp?.max) > 0);
}

// Ator que ganhou PV máximo agora (classe criada ou reparada) começa com a vida
// cheia: um personagem recém-criado não nasce caído (0/máx). Quem já tinha PV
// máximo antes, ou já tem vida atual, não é curado.
export async function startAtFullHitPoints(actor, hadNoMaxHp) {
  if (!hadNoMaxHp) return false;
  const hp = actor.system?.attributes?.hp;
  if (!(Number(hp?.max) > 0) || Number(hp?.value) > 0) return false;
  await actor.update({ 'system.attributes.hp.value': hp.max });
  return true;
}
