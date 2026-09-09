// foundry-module/src/index.js
import { RunarcanaApiClient } from './api-client.js';
import { DraftSelectorDialog } from './draft-selector.js';
import { CompendiumSyncDialog } from './compendium-sync-dialog.js';
import { SyncManager } from './sync-manager.js';

let apiClient = null;
let syncManager = null;

function getStringSetting(key) {
  const value = game.settings.get('runarcana-sync', key);
  return typeof value === 'string' ? value.trim() : '';
}

function openCompendiumSyncDialog() {
  const syncKey = getStringSetting('compendiumSyncKey');
  if (!syncKey) {
    ui.notifications.warn('Cole a chave de sincronização de compêndio nas configurações do módulo.');
    return;
  }
  const backendUrl = getStringSetting('backendUrl');
  if (!backendUrl) {
    ui.notifications.warn('Configure a URL do backend nas configurações do módulo primeiro.');
    return;
  }
  const client = new RunarcanaApiClient({
    mesaKey: getStringSetting('mesaKey'),
    baseUrl: backendUrl,
    syncKey,
  });
  new CompendiumSyncDialog(client).render();
}

async function unlinkActor(actor) {
  syncManager?.stopListening(actor);
  await actor.unsetFlag('runarcana-sync', 'draftId');
  ui.notifications.info(`${actor.name}: desvinculado da ficha.`);
}

// Ator já vinculado não pode trocar de ficha direto — evita sobrescrever o
// flag em silêncio e deixar o SyncManager escutando o draftId antigo (ver
// issue #13: startListening() já ignora uma segunda chamada se o stream do
// Ator ainda está de pé).
async function openDraftSelector(actor) {
  if (!getStringSetting('mesaKey')) {
    return ui.notifications.warn('Cole a chave da mesa nas configurações do módulo');
  }
  if (!apiClient) {
    return ui.notifications.warn('Configure a URL do backend nas configurações do módulo primeiro.');
  }

  const currentDraftId = actor.getFlag('runarcana-sync', 'draftId');
  if (currentDraftId) {
    const { DialogV2 } = foundry.applications.api;
    const wantsUnlink = await DialogV2.confirm({
      window: { title: 'Ator já vinculado' },
      content: `<p><strong>${actor.name}</strong> já está vinculado à ficha <code>${currentDraftId}</code>.</p>
        <p>Desvincular agora para escolher outra ficha? A sincronização com a ficha atual para.</p>`,
      yes: { label: 'Desvincular' },
      no: { label: 'Cancelar' },
    });
    if (!wantsUnlink) return;
    await unlinkActor(actor);
  }

  new DraftSelectorDialog(apiClient, actor, syncManager).render(true);
}

// Adaptador mínimo pra aparecer como botão no painel de configurações do
// módulo (game.settings.registerMenu exige uma classe estilo Application).
// Se o botão não renderizar certinho na sua versão do Foundry, use o macro
// documentado no README (game.modules.get('runarcana-sync').api.openCompendiumSync()).
class CompendiumSyncMenuApp extends FormApplication {
  constructor() {
    super({});
  }

  render() {
    openCompendiumSyncDialog();
    return this;
  }

  async _updateObject() {}
}

Hooks.once('init', () => {
  game.settings.register('runarcana-sync', 'mesaKey', {
    name: 'Chave da mesa',
    hint: 'Gerada no site, na página da mesa. Cole aqui.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'compendiumSyncKey', {
    name: 'Chave de Sincronização de Compêndio',
    hint: 'Só para enviar itens ao catálogo compartilhado do site (COMPENDIUM_SYNC_KEY). Não é a chave da mesa nem login.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  // Guarda a última seleção de compêndios pro diálogo de sincronização não
  // precisar remarcar tudo toda vez. Não aparece no painel de config.
  game.settings.register('runarcana-sync', 'compendiumSyncSelection', {
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu('runarcana-sync', 'compendiumSyncMenu', {
    name: 'Sincronizar Compêndio de Itens',
    label: 'Abrir Sincronização',
    hint: 'Escolhe quais compêndios de itens do mundo sincronizar com o backend, pra alimentar o seletor de equipamento do site.',
    icon: 'fas fa-box-open',
    type: CompendiumSyncMenuApp,
    restricted: true
  });

  game.settings.register('runarcana-sync', 'backendUrl', {
    name: 'URL do Backend Runarcana',
    hint: 'URL base do runarcana-api. Só altere se estiver hospedando o backend por conta própria.',
    scope: 'world',
    config: true,
    type: String,
    default: 'https://api.runarcana.org',
    requiresReload: true
  });
});

Hooks.once('ready', () => {
  // Ponto de entrada estável pra abrir a sincronização de compêndio via
  // macro, caso o botão do menu de configurações não apareça na sua versão
  // do Foundry: game.modules.get('runarcana-sync').api.openCompendiumSync()
  const thisModule = game.modules.get('runarcana-sync');
  if (thisModule) {
    thisModule.api = { openCompendiumSync: openCompendiumSyncDialog };
  }

  const mesaKey = getStringSetting('mesaKey');
  const backendUrl = getStringSetting('backendUrl');

  if (!mesaKey) {
    console.warn('Runarcana Sync | Chave da mesa não configurada nas configurações do módulo.');
    return;
  }
  if (!backendUrl) {
    console.warn('Runarcana Sync | URL do backend não configurada nas configurações do módulo.');
    return;
  }

  apiClient = new RunarcanaApiClient({
    mesaKey,
    baseUrl: backendUrl,
    syncKey: getStringSetting('compendiumSyncKey'),
  });
  syncManager = new SyncManager(apiClient);

  game.actors.forEach(actor => syncManager.startListening(actor));
  console.log('Runarcana Sync | Backend configurado e ouvindo atores vinculados.');

  if (thisModule) {
    thisModule.api.apiClient = apiClient;
    thisModule.api.syncManager = syncManager;
  }
});

Hooks.on('updateActor', (actor, changes, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  syncManager.handleActorUpdate(actor, changes);
});

Hooks.on('createItem', (item, options, userId) => {
  if (userId !== game.user.id || !syncManager || !item.parent) return;
  syncManager.handleItemUpdate(item.parent);
});

Hooks.on('updateItem', (item, changes, options, userId) => {
  if (userId !== game.user.id || !syncManager || !item.parent) return;
  syncManager.handleItemUpdate(item.parent);
});

Hooks.on('deleteItem', (item, options, userId) => {
  if (userId !== game.user.id || !syncManager || !item.parent) return;
  syncManager.handleItemUpdate(item.parent);
});

function actorOfEffect(effect) {
  const parent = effect?.parent;
  if (!parent) return null;
  if (parent.documentName === 'Actor') return parent;
  if (parent.documentName === 'Item' && parent.parent?.documentName === 'Actor') return parent.parent;
  return null;
}

Hooks.on('createActiveEffect', (effect, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  const actor = actorOfEffect(effect);
  if (actor) syncManager.handleActorUpdate(actor, {});
});

Hooks.on('updateActiveEffect', (effect, changes, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  const actor = actorOfEffect(effect);
  if (actor) syncManager.handleActorUpdate(actor, changes);
});

Hooks.on('deleteActiveEffect', (effect, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  const actor = actorOfEffect(effect);
  if (actor) syncManager.handleActorUpdate(actor, {});
});

// Compatibilidade Ampla: Injetando botão tanto em ApplicationV1 (Legado) quanto ApplicationV2 (Novo v13+)

// Hook para janelas baseadas na API V1 do Foundry (Fichas antigas e alguns módulos)
Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
  const actor = app.object;
  if (!actor || actor.documentName !== 'Actor') return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');

  buttons.unshift({
    class: 'runarcana-sync-btn',
    icon: 'fas fa-sync',
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    onclick: () => openDraftSelector(actor)
  });
});

// Hook para a NOVA API V2 do Foundry (Ficha oficial do D&D 5e v3+ rodando no Foundry v13/v14)
Hooks.on('getHeaderControlsActorSheetV2', (app, controls) => {
  const actor = app.document;
  if (!actor || actor.documentName !== 'Actor') return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');

  controls.unshift({
    action: 'runarcana-sync',
    icon: 'fas fa-sync',
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    class: 'runarcana-sync-btn',
    onClick: () => openDraftSelector(actor)
  });
});
