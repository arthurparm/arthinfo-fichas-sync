// foundry-module/src/index.js
import { FirebaseClient } from './firebase-client.js';
import { RunarcanaLoginDialog } from './login-dialog.js';
import { DraftSelectorDialog } from './draft-selector.js';
import { SyncManager } from './sync-manager.js';

let firebaseClient = null;
let syncManager = null;

Hooks.once('init', () => {
  // Configuração amigável: Campos separados para cada credencial do Firebase
  game.settings.register('runarcana-sync', 'apiKey', {
    name: 'Firebase API Key',
    hint: 'Sua chave de API web do Firebase (apiKey).',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });

  game.settings.register('runarcana-sync', 'authDomain', {
    name: 'Firebase Auth Domain',
    hint: 'Seu domínio de autenticação (authDomain). Ex: seu-projeto.firebaseapp.com',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });

  game.settings.register('runarcana-sync', 'projectId', {
    name: 'Firebase Project ID',
    hint: 'O ID do seu projeto no Firebase (projectId).',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });
  
  // Campo Opcional / Legado (Caso o usuário prefira colar o JSON inteiro de uma vez)
  game.settings.register('runarcana-sync', 'firebaseConfigJSON', {
    name: 'Firebase Config (JSON Avançado)',
    hint: '(Opcional) Cole o objeto JSON completo do Firebase aqui. Se preenchido, irá sobrepor os campos individuais acima.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
  });
});

Hooks.once('ready', () => {
  const jsonStr = game.settings.get('runarcana-sync', 'firebaseConfigJSON');
  let config = {};

  try {
    if (jsonStr && jsonStr.trim() !== '') {
      // Prioriza o JSON se estiver preenchido
      config = JSON.parse(jsonStr);
    } else {
      // Caso contrário, monta o config com os campos individuais
      const apiKey = game.settings.get('runarcana-sync', 'apiKey');
      const authDomain = game.settings.get('runarcana-sync', 'authDomain');
      const projectId = game.settings.get('runarcana-sync', 'projectId');

      if (apiKey && authDomain && projectId) {
        config = { apiKey, authDomain, projectId };
      }
    }

    if (Object.keys(config).length > 0) {
      firebaseClient = new FirebaseClient(config);
      syncManager = new SyncManager(firebaseClient);
      
      // Start listening for already linked actors
      game.actors.forEach(actor => syncManager.startListening(actor));
      console.log("Runarcana Sync | Firebase configurado e rodando.");
    } else {
      console.warn("Runarcana Sync | Firebase não configurado. Preencha as configurações do módulo.");
    }
  } catch(e) {
    console.error("Runarcana Sync | Erro ao iniciar o Firebase:", e);
    ui.notifications.error("Runarcana Sync: Configuração do Firebase inválida.");
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

// Compatibilidade Ampla: Injetando botão tanto em ApplicationV1 (Legado) quanto ApplicationV2 (Novo v13+)

// Hook para janelas baseadas na API V1 do Foundry (Fichas antigas e alguns módulos)
Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
  const actor = app.object;
  if (!actor || actor.documentName !== "Actor") return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');
  
  buttons.unshift({
    class: "runarcana-sync-btn",
    icon: "fas fa-sync",
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    onclick: () => {
      if (!firebaseClient) return ui.notifications.warn("Configure o Firebase nas configurações do módulo primeiro.");
      if (!firebaseClient.auth.currentUser) {
        new RunarcanaLoginDialog(firebaseClient).render(true);
      } else {
        new DraftSelectorDialog(firebaseClient, actor, syncManager).render(true);
      }
    }
  });
});

// Hook para a NOVA API V2 do Foundry (Ficha oficial do D&D 5e v3+ rodando no Foundry v13/v14)
Hooks.on('getHeaderControlsActorSheetV2', (app, controls) => {
  const actor = app.document;
  if (!actor || actor.documentName !== "Actor") return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');
  
  controls.unshift({
    action: "runarcana-sync",
    icon: "fas fa-sync",
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    class: "runarcana-sync-btn",
    onClick: () => {
      if (!firebaseClient) return ui.notifications.warn("Configure o Firebase nas configurações do módulo primeiro.");
      if (!firebaseClient.auth.currentUser) {
        new RunarcanaLoginDialog(firebaseClient).render(true);
      } else {
        new DraftSelectorDialog(firebaseClient, actor, syncManager).render(true);
      }
    }
  });
});
