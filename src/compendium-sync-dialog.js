// foundry-module/src/compendium-sync-dialog.js
import { listItemCompendia, syncCompendiums } from './compendium-sync.js';

const SELECTION_SETTING = 'compendiumSyncSelection';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class CompendiumSyncDialog {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async render() {
    const { DialogV2 } = foundry.applications.api;
    const packs = listItemCompendia();

    if (packs.length === 0) {
      return DialogV2.prompt({
        window: { title: 'Sincronizar Compêndio de Itens' },
        content: '<p>Nenhum compêndio do tipo Item foi encontrado neste mundo.</p>',
        ok: { label: 'Fechar' },
      });
    }

    let lastSelection = [];
    try {
      lastSelection = game.settings.get('runarcana-sync', SELECTION_SETTING) ?? [];
    } catch {
      lastSelection = [];
    }
    const lastSelectionSet = new Set(lastSelection);

    let html = `
      <form>
        <p>Escolha os compêndios de itens a sincronizar (ex: um compêndio próprio,
        curado com os itens liberados na sua mesa):</p>
        <div class="form-group" style="max-height: 260px; overflow-y: auto;">`;

    for (const pack of packs) {
      const checked = lastSelectionSet.has(pack.collection) ? 'checked' : '';
      html += `
          <label style="display:block;margin:4px 0;">
            <input type="checkbox" name="pack" value="${escapeHtml(pack.collection)}" ${checked} />
            ${escapeHtml(pack.metadata.label)}
            <small>(${escapeHtml(pack.metadata.packageName || pack.metadata.system || '')})</small>
          </label>`;
    }

    html += `
        </div>
      </form>`;

    const apiClient = this.apiClient;

    return DialogV2.wait({
      window: { title: 'Sincronizar Compêndio de Itens' },
      content: html,
      buttons: [
        {
          action: 'sync',
          label: 'Sincronizar Selecionados',
          icon: 'fas fa-sync',
          default: true,
          callback: async (event, button, dialog) => {
            const checkboxes = dialog.element.querySelectorAll('input[name="pack"]:checked');
            const packIds = Array.from(checkboxes).map((el) => el.value);

            if (packIds.length === 0) {
              ui.notifications.warn('Runarcana Sync: selecione ao menos um compêndio.');
              return;
            }

            const syncKey = game.settings.get('runarcana-sync', 'compendiumSyncKey');
            if (!syncKey) {
              ui.notifications.error(
                'Runarcana Sync: configure a Chave de Sincronização de Compêndio nas configurações do módulo primeiro.',
              );
              return;
            }

            await game.settings.set('runarcana-sync', SELECTION_SETTING, packIds);

            try {
              const result = await syncCompendiums(apiClient, syncKey, packIds, (current, total) => {
                ui.notifications.info(`Runarcana Sync: sincronizando lote ${current} de ${total}...`);
              });
              ui.notifications.info(
                `Runarcana Sync: ${result.totalSynced} itens sincronizados de ${result.packSummaries.length} compêndio(s).`,
              );
            } catch (error) {
              console.error('Runarcana Sync | Erro ao sincronizar compêndio:', error);
              ui.notifications.error(`Runarcana Sync: erro ao sincronizar compêndio: ${error.message}`);
            }
          },
        },
        {
          action: 'cancel',
          label: 'Cancelar',
        },
      ],
    });
  }
}
