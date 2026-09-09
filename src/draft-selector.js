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

function buildDraftLoadErrorMessage(err) {
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

      let html = `<form><div class="form-group"><label>Ficha:</label><select name="draftId">`;
      if (drafts.length === 0) {
        html += `<option value="">Nenhuma ficha encontrada</option>`;
      } else {
        drafts.forEach(d => {
          html += `<option value="${escapeHtml(d.id)}">${escapeHtml(formatDraftOptionLabel(d))}</option>`;
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
            if (!draftId) return;
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
