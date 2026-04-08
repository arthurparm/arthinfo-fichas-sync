import { collection, query, where, getDocs } from 'firebase/firestore';

export class DraftSelectorDialog {
  constructor(firebaseClient, actor, syncManager) {
    this.firebaseClient = firebaseClient;
    this.actor = actor;
    this.syncManager = syncManager;
  }

  async render(force = true) {
    const { DialogV2 } = foundry.applications.api;

    try {
      const q = query(
        collection(this.firebaseClient.db, 'character_drafts'),
        where('ownerId', '==', this.firebaseClient.auth.currentUser.uid)
      );
      const snap = await getDocs(q);
      const drafts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      let html = `<form><div class="form-group"><label>Ficha:</label><select name="draftId">`;
      if (drafts.length === 0) {
        html += `<option value="">Nenhuma ficha encontrada</option>`;
      } else {
        drafts.forEach(d => {
          html += `<option value="${d.id}">${d.concept?.name || 'Sem Nome'} (${d.classBuild?.classId || 'Sem Classe'})</option>`;
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
        content: `<p>Erro ao carregar fichas: ${err.message}</p>`,
        ok: { label: "Fechar" }
      });
    }
  }
}
