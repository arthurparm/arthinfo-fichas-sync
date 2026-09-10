function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDraftOptionLabel(draft) {
  const name = draft?.concept?.name || draft?.title || 'Sem Nome';
  const klass = draft?.classBuild?.classId || 'Sem Classe';
  const assigned = draft?.assignedUserId ? ` — ${draft.assignedUserId}` : '';
  return `${name} (${klass})${assigned}`;
}

// Ids de draft já vinculados a outros Atores deste mundo (flag
// runarcana-sync.draftId), pra não deixar dois Atores escrevendo na mesma
// ficha. Exclui o próprio Ator que está abrindo o seletor.
export function getDraftIdsLinkedToOtherActors(actors, currentActorId) {
  const linked = new Set();
  for (const actor of actors ?? []) {
    if (actor.id === currentActorId) continue;
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (draftId) linked.add(draftId);
  }
  return linked;
}

// 401 é sempre problema da chave (ausente, errada ou revogada — a API não
// distingue de propósito). Dizer isso evita mandar o mestre conferir a URL do
// backend e o servidor quando o que ele precisa é gerar outra chave no site.
export function buildDraftLoadErrorMessage(err) {
  if (err?.status === 401) {
    return `<p>Chave da mesa inválida ou revogada.</p>
      <p>Gere uma nova na página da mesa no site e cole em Configurações do módulo &rsaquo; Chave da mesa.</p>`;
  }
  return `<p>Erro ao carregar fichas: ${escapeHtml(err?.message || 'Erro desconhecido.')}</p>
    <p>Verifique se a chave da mesa e a URL do backend estão configuradas corretamente nas configurações do módulo e
    se o servidor (runarcana-api) está no ar.</p>`;
}

export class DraftSelectorDialog {
  constructor(apiClient, actor, syncManager) {
    this.apiClient = apiClient;
    this.actor = actor;
    this.syncManager = syncManager;
  }

  async render(force = true) {
    const { DialogV2 } = foundry.applications.api;

    try {
      const drafts = await this.apiClient.listDrafts();
      const linkedElsewhere = getDraftIdsLinkedToOtherActors(game.actors, this.actor.id);

      let html = `<form><div class="form-group"><label>Ficha:</label><select name="draftId">`;
      if (drafts.length === 0) {
        html += `<option value="">Nenhuma ficha encontrada</option>`;
      } else {
        drafts.forEach(d => {
          const taken = linkedElsewhere.has(d.id);
          const label = taken
            ? `${formatDraftOptionLabel(d)} (vinculado a outro Ator)`
            : formatDraftOptionLabel(d);
          html += `<option value="${escapeHtml(d.id)}" ${taken ? 'disabled' : ''}>${escapeHtml(label)}</option>`;
        });
      }
      html += `</select></div></form>`;

      return DialogV2.wait({
        window: { title: "Vincular Ficha Runarcana" },
        content: html,
        buttons: [{
          action: "link",
          label: "Vincular",
          icon: "fas fa-link",
          callback: async (event, button, dialog) => {
            const select = dialog.element.querySelector('[name="draftId"]');
            const draftId = select.value;
            const selectedOption = select.selectedOptions?.[0];
            if (!draftId || selectedOption?.disabled) return;
            await this.actor.setFlag('runarcana-sync', 'draftId', draftId);
            ui.notifications.info(`Actor vinculado à ficha ${draftId}`);
            if (this.syncManager) {
              this.syncManager.startListening(this.actor);
            }
          }
        }]
      });
    } catch(err) {
      return DialogV2.prompt({
        window: { title: "Erro" },
        content: buildDraftLoadErrorMessage(err),
        ok: { label: "Fechar" }
      });
    }
  }
}
