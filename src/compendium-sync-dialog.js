// foundry-module/src/compendium-sync-dialog.js
import { listItemCompendia, syncCompendiums } from './compendium-sync.js';

const SELECTION_SETTING = 'compendiumSyncSelection';

// :has() é suportado desde Chrome/Electron 105 (2022) — bem abaixo do que o
// Foundry V12+ exige — então não depende do tema do sistema pintar
// `:indeterminate`: essas regras cuidam do desenho do checkbox-pai sozinhas.
const COMPENDIUM_SYNC_STYLES = `
  .rs-compendium-sync .rs-group-toggle {
    position: relative;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    border: 1px solid var(--color-border-light-tertiary, #7a7971);
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .rs-compendium-sync .rs-group-toggle input[type="checkbox"] {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .rs-compendium-sync .rs-group-toggle::after {
    content: "";
    font-weight: 900;
    font-size: 12px;
    line-height: 1;
    color: #1b1a17;
    pointer-events: none;
  }
  .rs-compendium-sync .rs-group-toggle:has(input:checked),
  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate) {
    background: #c9a227;
  }
  .rs-compendium-sync .rs-group-toggle:has(input:checked)::after {
    content: "\\2713";
  }
  .rs-compendium-sync .rs-group-toggle:has(input:indeterminate)::after {
    content: "\\2212";
  }
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Descobre a que pacote (módulo, sistema ou mundo) um compêndio pertence,
 * usando os próprios metadados do Foundry — nada de lista fixa de nomes,
 * então um módulo novo instalado no mundo já aparece agrupado sozinho.
 */
export function resolvePackGroup(pack) {
  const meta = pack.metadata ?? {};

  if (meta.packageType === 'module') {
    const mod = typeof game !== 'undefined' ? game.modules?.get(meta.packageName) : undefined;
    return { id: `module:${meta.packageName}`, label: mod?.title || meta.packageName || 'Módulo' };
  }

  if (meta.packageType === 'system') {
    const systemTitle = typeof game !== 'undefined' ? game.system?.title : undefined;
    const baseLabel = systemTitle || meta.packageName || meta.system || 'Sistema';
    // O sistema dnd5e empacota tanto o conteúdo atual quanto o SRD 2014
    // (legado) sob o mesmo pacote — só dá pra distinguir pelo próprio label
    // do compêndio, que o sistema já sufixa com "(SRD)".
    const isSrd = /\(SRD\)/i.test(meta.label ?? '');
    return {
      id: `system:${meta.packageName || meta.system}${isSrd ? ':srd' : ''}`,
      label: isSrd ? `${baseLabel} (Legacy)` : baseLabel,
    };
  }

  return { id: 'world', label: 'Compêndios do mundo' };
}

/**
 * Agrupa os compêndios pelo pacote de origem (resolvePackGroup) e ordena
 * grupos e itens por label, pra a lista de seleção sair estável e não na
 * ordem arbitrária de `game.packs`.
 */
export function groupPacksBySource(packs) {
  const groups = new Map();

  for (const pack of packs) {
    const group = resolvePackGroup(pack);
    if (!groups.has(group.id)) groups.set(group.id, { id: group.id, label: group.label, packs: [] });
    groups.get(group.id).packs.push(pack);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      packs: group.packs.slice().sort((a, b) => (a.metadata.label ?? '').localeCompare(b.metadata.label ?? '', 'pt-BR')),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

/**
 * O checkbox do compêndio-pai tem 3 estágios: vazio (nenhum filho marcado,
 * livro bloqueado), "-" indeterminado (alguns filhos marcados) e marcado
 * (todos os filhos marcados). Clicar nele sempre vai pro extremo: de vazio
 * ou indeterminado -> marca e libera todos os filhos; de marcado -> desmarca
 * e bloqueia todos (o livro inteiro fica de fora). O estágio indeterminado só
 * aparece de volta quando o próprio usuário desmarca um filho individual.
 *
 * O visual dos 3 estágios é CSS puro (:has(input:checked)/:has(input:indeterminate)
 * em COMPENDIUM_SYNC_STYLES) em vez de pintado por JS — o navegador já
 * mantém isso em sincronia sozinho sempre que `.checked`/`.indeterminate`
 * mudam, então este arquivo só precisa setar essas duas propriedades.
 */
function updateGroupMasterState(section) {
  const master = section.querySelector('input[data-action="toggleGroup"]');
  if (!master) return;
  const items = Array.from(section.querySelectorAll('input[data-action="toggleItem"]'));
  const checkedCount = items.filter((checkbox) => checkbox.checked).length;
  master.checked = checkedCount > 0 && checkedCount === items.length;
  master.indeterminate = checkedCount > 0 && checkedCount < items.length;
}

function onToggleGroup(event, target) {
  const section = target.closest('[data-pack-group]');
  if (!section) return;
  const enabled = target.checked;
  section.querySelectorAll('input[data-action="toggleItem"]').forEach((checkbox) => {
    checkbox.disabled = !enabled;
    checkbox.checked = enabled;
  });
  target.indeterminate = false;
}

function onToggleItem(event, target) {
  const section = target.closest('[data-pack-group]');
  if (!section) return;
  updateGroupMasterState(section);
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
    const groups = groupPacksBySource(packs);

    let html = `
      <style>${COMPENDIUM_SYNC_STYLES}</style>
      <form class="rs-compendium-sync">
        <p>Escolha os compêndios de itens a sincronizar (ex: um compêndio próprio,
        curado com os itens liberados na sua mesa):</p>
        <div style="max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; column-count: 1; column-width: auto;">`;

    for (const group of groups) {
      const checkedCount = group.packs.filter((pack) => lastSelectionSet.has(pack.collection)).length;
      const masterChecked = checkedCount > 0 && checkedCount === group.packs.length;

      html += `
          <fieldset data-pack-group style="border:0;margin:0 0 12px 0;padding:0;break-inside:avoid;-webkit-column-break-inside:avoid;">
            <label style="display:flex;align-items:center;gap:6px;font-weight:700;text-transform:uppercase;font-size:0.85em;letter-spacing:0.02em;border-bottom:1px solid var(--color-border-light-tertiary, #7a7971);padding-bottom:4px;margin-bottom:6px;cursor:pointer;">
              <span class="rs-group-toggle">
                <input type="checkbox" data-action="toggleGroup" ${masterChecked ? 'checked' : ''} />
              </span>
              ${escapeHtml(group.label)}
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;">`;

      for (const pack of group.packs) {
        const checked = lastSelectionSet.has(pack.collection) ? 'checked' : '';
        html += `
              <label style="display:block;margin:2px 0;">
                <input type="checkbox" name="pack" data-action="toggleItem" value="${escapeHtml(pack.collection)}" ${checked} />
                ${escapeHtml(pack.metadata.label)}
              </label>`;
      }

      html += `
            </div>
          </fieldset>`;
    }

    html += `
        </div>
      </form>`;

    const apiClient = this.apiClient;

    return DialogV2.wait({
      window: { title: 'Sincronizar Compêndio de Itens' },
      content: html,
      actions: {
        toggleGroup: onToggleGroup,
        toggleItem: onToggleItem,
      },
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

            await game.settings.set('runarcana-sync', SELECTION_SETTING, packIds);

            try {
              const result = await syncCompendiums(apiClient, packIds, (current, total) => {
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
