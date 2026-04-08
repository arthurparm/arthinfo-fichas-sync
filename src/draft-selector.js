import { collection, query, where, getDocs } from 'firebase/firestore';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildDraftLoadErrorMessage(err, firebaseClient) {
  const isPermissionError =
    err?.code === 'permission-denied' ||
    err?.message?.includes('Missing or insufficient permissions');

  if (!isPermissionError) {
    return `<p>Erro ao carregar fichas: ${escapeHtml(err?.message || 'Erro desconhecido.')}</p>`;
  }

  const projectId = firebaseClient?.app?.options?.projectId || 'desconhecido';
  const uid = firebaseClient?.auth?.currentUser?.uid || 'não disponível';

  return `
    <p>O login funcionou, mas o Firestore bloqueou a leitura das fichas.</p>
    <p><strong>Projeto:</strong> ${escapeHtml(projectId)}<br><strong>UID:</strong> ${escapeHtml(uid)}<br><strong>Coleção:</strong> character_drafts</p>
    <p>Verifique se as regras do Firestore permitem ler documentos de <code>character_drafts</code> quando o usuário autenticado for o dono do documento, por exemplo usando o campo <code>ownerId</code>.</p>
    <p>Se isso continuar mesmo com as regras corretas, confira se o módulo está apontando para o projeto Firebase certo.</p>
  `;
}

export class DraftSelectorDialog {
  constructor(firebaseClient, actor, syncManager) {
    this.firebaseClient = firebaseClient;
    this.actor = actor;
    this.syncManager = syncManager;
  }

  async render(force = true) {
    const { DialogV2 } = foundry.applications.api;

    try {
      const user = await this.firebaseClient.waitForAuthReady({ requireUser: true });
      const q = query(
        collection(this.firebaseClient.db, 'character_drafts'),
        where('ownerId', '==', user.uid)
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
        content: buildDraftLoadErrorMessage(err, this.firebaseClient),
        ok: { label: "Fechar" }
      });
    }
  }
}
