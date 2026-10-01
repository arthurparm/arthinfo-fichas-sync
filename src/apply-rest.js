// Descanso pedido pelo site (POST /api/drafts/:id/rest). O dnd5e já sabe o
// que cada descanso restaura (PV, dados de vida, slots, cargas de item,
// recursos) — a ficha só pede, sem reimplementar a regra. `dialog: false`
// pula o diálogo de dados de vida (o jogador gasta DV pelo HUD da ficha).
// Só o GM ativo aplica, pra não descansar duas vezes com dois GMs abertos.
export async function applyRest(actor, rest) {
  if (!actor || !rest) return;
  if (game.user?.id !== game.users?.activeGM?.id) return;

  try {
    if (rest.type === 'long') {
      await actor.longRest({ dialog: false });
    } else if (rest.type === 'short') {
      await actor.shortRest({ dialog: false });
    }
  } catch (error) {
    console.error('Arthinfo Fichas | Falha ao aplicar descanso:', error);
  }
}
