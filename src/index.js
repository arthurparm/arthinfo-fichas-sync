// foundry-module/src/index.js
import { ArthinfoApiClient } from './api-client.js';
import { DraftSelectorDialog, getDraftIdsLinkedToOtherActors } from './draft-selector.js';
import { CompendiumSyncDialog } from './compendium-sync-dialog.js';
import {
  actorsSharingDraftId,
  inheritedDraftId,
  keepOldestActor,
  shouldStripInheritedDraftId,
  stripInheritedDraftFlagSource,
} from './draft-link.js';
import { SyncManager } from './sync-manager.js';
import { runLegacyMigration } from './legacy-migration.js';
import { MODULE_ID, clearFlag, readFlag } from './module-id.js';

let apiClient = null;
let syncManager = null;

function getStringSetting(key) {
  const value = game.settings.get(MODULE_ID, key);
  return typeof value === 'string' ? value.trim() : '';
}

function openCompendiumSyncDialog() {
  const mesaKey = getStringSetting('mesaKey');
  if (!mesaKey) {
    ui.notifications.warn('Cole a chave da mesa nas configurações do módulo para sincronizar o compêndio.');
    return;
  }
  const backendUrl = getStringSetting('backendUrl');
  if (!backendUrl) {
    ui.notifications.warn('Configure a URL do backend nas configurações do módulo primeiro.');
    return;
  }
  const client = new ArthinfoApiClient({
    mesaKey,
    baseUrl: backendUrl,
  });
  new CompendiumSyncDialog(client).render();
}

async function unlinkActor(actor, message) {
  syncManager?.stopListening(actor);
  await clearFlag(actor, 'draftId');
  ui.notifications.info(message ?? `${actor.name}: desvinculado da ficha.`);
}

// Limpeza pra duplicatas que já existiam no mundo antes do hook createActor
// (acima) começar a prevenir isso — ex: Atores duplicados numa sessão
// anterior. Roda a cada `ready`, só pro GM (unsetFlag em Ator de outro dono
// pode não ter permissão), e não faz nada se não achar duplicata.
// Entre Atores vinculados à mesma ficha, mantém o mais antigo
// (_stats.createdTime) e desvincula o(s) resto — o mais antigo é o
// candidato mais provável a ser o original, não a cópia.
async function cleanupDuplicateDraftLinks() {
  if (!game.user.isGM) return;

  for (const actors of actorsSharingDraftId(game.actors)) {
    const [keep, ...duplicates] = keepOldestActor(actors);
    for (const duplicate of duplicates) {
      await unlinkActor(
        duplicate,
        `Arthinfo Fichas: ${duplicate.name} estava vinculado à mesma ficha que ${keep.name} — desvinculado automaticamente (limpeza de duplicata).`,
      );
    }
    ui.notifications.warn(
      `Arthinfo Fichas: ${duplicates.length + 1} Atores compartilhavam a mesma ficha; só ${keep.name} (o mais antigo) permanece vinculado.`,
    );
  }
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

  const currentDraftId = readFlag(actor, 'draftId');
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
// documentado no README (game.modules.get(MODULE_ID).api.openCompendiumSync()).
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
  game.settings.register(MODULE_ID, 'mesaKey', {
    name: 'Chave da mesa',
    hint: 'Gerada no site, na página da mesa. Cole aqui.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  // Guarda a última seleção de compêndios pro diálogo de sincronização não
  // precisar remarcar tudo toda vez. Não aparece no painel de config.
  game.settings.register(MODULE_ID, 'compendiumSyncSelection', {
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, 'compendiumSyncMenu', {
    name: 'Sincronizar Compêndio de Itens',
    label: 'Abrir Sincronização',
    hint: 'Escolhe quais compêndios de itens do mundo sincronizar com a sua mesa (usa a Chave da mesa), pra alimentar o seletor de equipamento do site. Também limpa o que você já enviou.',
    icon: 'fas fa-box-open',
    type: CompendiumSyncMenuApp,
    restricted: true
  });

  game.settings.register(MODULE_ID, 'backendUrl', {
    name: 'URL do Backend Arthinfo Fichas',
    hint: 'URL base do arthinfo-fichas-api. Só altere se estiver hospedando o backend por conta própria.',
    scope: 'world',
    config: true,
    type: String,
    default: 'https://arthinfo-api.arthur-paraiso-mar.workers.dev',
    requiresReload: true
  });
});

Hooks.once('ready', async () => {
  // Ponto de entrada estável pra abrir a sincronização de compêndio via
  // macro, caso o botão do menu de configurações não apareça na sua versão
  // do Foundry: game.modules.get(MODULE_ID).api.openCompendiumSync()
  const thisModule = game.modules.get(MODULE_ID);
  if (thisModule) {
    thisModule.api = { openCompendiumSync: openCompendiumSyncDialog };
  }

  // Traz vínculos e configurações do id antigo ('runarcana-sync'). Precisa vir
  // antes de ler as configurações e de o sync começar a ouvir os Atores.
  await runLegacyMigration(game);

  const mesaKey = getStringSetting('mesaKey');
  const backendUrl = getStringSetting('backendUrl');

  if (!mesaKey) {
    console.warn('Arthinfo Fichas | Chave da mesa não configurada nas configurações do módulo.');
    return;
  }
  if (!backendUrl) {
    console.warn('Arthinfo Fichas | URL do backend não configurada nas configurações do módulo.');
    return;
  }

  apiClient = new ArthinfoApiClient({
    mesaKey,
    baseUrl: backendUrl,
  });
  syncManager = new SyncManager(apiClient);

  await cleanupDuplicateDraftLinks();
  game.actors.forEach(actor => syncManager.startListening(actor));
  console.log('Arthinfo Fichas | Backend configurado e ouvindo atores vinculados.');

  if (thisModule) {
    thisModule.api.apiClient = apiClient;
    thisModule.api.syncManager = syncManager;
  }
});

Hooks.on('updateActor', (actor, changes, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  syncManager.handleActorUpdate(actor, changes);
});

// Duplicar um Ator no Foundry copia os flags junto — inclusive
// <id do módulo>.draftId. O seletor de vínculo já recusa draft ligado a
// outro Ator; Duplicate nativo não passa por ele. Tirar a flag no
// preCreateActor (antes do documento existir) evita que createItem/
// updateActor da cópia façam PUT no mesmo draftId (FDD-25).
Hooks.on('preCreateActor', (document, data, options, userId) => {
  if (userId !== game.user.id) return;
  const draftId = inheritedDraftId(document, data);
  if (!shouldStripInheritedDraftId(game.actors, draftId, document.id)) return;
  try {
    document.updateSource(stripInheritedDraftFlagSource());
  } catch (error) {
    console.warn('Arthinfo Fichas | Não foi possível tirar o draftId herdado antes da criação:', error);
  }
});

Hooks.on('createActor', async (actor, options, userId) => {
  if (userId !== game.user.id) return;
  const draftId = readFlag(actor, 'draftId');
  if (!draftId) return;

  const linkedElsewhere = getDraftIdsLinkedToOtherActors(game.actors, actor.id);
  if (!linkedElsewhere.has(draftId)) return;

  await clearFlag(actor, 'draftId');
  syncManager?.stopListening(actor);
  ui.notifications.warn(
    `Arthinfo Fichas: ${actor.name} veio com um vínculo herdado (provavelmente de uma duplicação) de uma ficha já vinculada a outro Ator — desvinculado automaticamente.`,
  );
});

// Sem isso, apagar o Ator deixava a stream SSE e o lastKnownDraft dele
// vazando pra sempre (nada chamava stopListening).
Hooks.on('deleteActor', (actor, options, userId) => {
  if (userId !== game.user.id || !syncManager) return;
  syncManager.stopListening(actor);
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

  const isLinked = !!readFlag(actor, 'draftId');

  buttons.unshift({
    class: 'arthinfo-fichas-sync-btn',
    icon: 'fas fa-sync',
    label: isLinked ? 'Arthinfo (Vinculado)' : 'Arthinfo Fichas Sync',
    onclick: () => openDraftSelector(actor)
  });
});

// Hook para a NOVA API V2 do Foundry (Ficha oficial do D&D 5e v3+ rodando no Foundry v13/v14)
Hooks.on('getHeaderControlsActorSheetV2', (app, controls) => {
  const actor = app.document;
  if (!actor || actor.documentName !== 'Actor') return;

  const isLinked = !!readFlag(actor, 'draftId');

  controls.unshift({
    action: 'arthinfo-fichas-sync',
    icon: 'fas fa-sync',
    label: isLinked ? 'Arthinfo (Vinculado)' : 'Arthinfo Fichas Sync',
    class: 'arthinfo-fichas-sync-btn',
    onClick: () => openDraftSelector(actor)
  });
});
