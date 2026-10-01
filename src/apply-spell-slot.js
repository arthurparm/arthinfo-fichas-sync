// Ajuste manual de slot de magia pela ficha (clique no pip). Valor absoluto,
// limitado a 0..max do Ator — o site nunca consegue passar do máximo real.
// Só o GM ativo aplica (mesmo guard dos demais comandos do site).
export async function applySpellSlot(actor, spellSlot) {
  if (!actor || !spellSlot) return;
  if (game.user?.id !== game.users?.activeGM?.id) return;

  const key = spellSlot.level === 'pact' ? 'pact' : `spell${Number(spellSlot.level)}`;
  const band = actor.system?.spells?.[key];
  const value = Number(spellSlot.value);
  if (!band || !Number.isInteger(value) || value < 0) return;

  const clamped = Math.min(value, Number(band.max) || 0);
  if (clamped === band.value) return;

  try {
    await actor.update({ [`system.spells.${key}.value`]: clamped });
  } catch (error) {
    console.error('Arthinfo Fichas | Falha ao ajustar slot de magia:', error);
  }
}
