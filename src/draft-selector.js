import { collection, query, where, getDocs } from 'firebase/firestore';

export class DraftSelectorDialog extends Dialog {
  constructor(firebaseClient, actor, syncManager) {
    super({
      title: "Vincular Ficha Runarcana",
      content: "<p>Carregando fichas...</p>",
      buttons: {}
    });
    this.firebaseClient = firebaseClient;
    this.actor = actor;
    this.syncManager = syncManager;
  }

  async render(force, options) {
    super.render(force, options);
    await this.loadDrafts();
  }

  async loadDrafts() {
    try {
      const q = query(
        collection(this.firebaseClient.db, 'character_drafts'),
        where('ownerId', '==', this.firebaseClient.auth.currentUser.uid)
      );
      const snap = await getDocs(q);
      const drafts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      let html = `<form><div class="form-group"><label>Ficha:</label><select name="draftId">`;
      drafts.forEach(d => {
        html += `<option value="${d.id}">${d.concept?.name || 'Sem Nome'} (${d.classBuild?.classId || 'Sem Classe'})</option>`;
      });
      html += `</select></div></form>`;

      this.data.content = html;
      this.data.buttons = {
        link: {
          icon: '<i class="fas fa-link"></i>',
          label: "Vincular",
          callback: async (html) => {
            const draftId = html.find('[name="draftId"]').val();
            await this.actor.setFlag('runarcana-sync', 'draftId', draftId);
            ui.notifications.info(`Actor vinculado à ficha ${draftId}`);
            if (this.syncManager) {
              this.syncManager.startListening(this.actor);
            }
          }
        }
      };
      super.render(true);
    } catch(err) {
      this.data.content = `<p>Erro ao carregar fichas: ${err.message}</p>`;
      super.render(true);
    }
  }
}
