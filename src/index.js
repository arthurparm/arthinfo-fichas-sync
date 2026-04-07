import { FirebaseClient } from './firebase-client.js';
import { RunarcanaLoginDialog } from './login-dialog.js';
import { DraftSelectorDialog } from './draft-selector.js';
import { SyncManager } from './sync-manager.js';

let firebaseClient = null;
let syncManager = null;

Hooks.once('init', () => {
  game.settings.register('runarcana-sync', 'firebaseConfig', {
    name: 'Firebase Config (JSON)',
    hint: 'Cole o JSON de configuração do Firebase do seu projeto Runarcana.',
    scope: 'world',
    config: true,
    type: String,
    default: '{}'
  });
});

Hooks.once('ready', () => {
  const configStr = game.settings.get('runarcana-sync', 'firebaseConfig');
  try {
    const config = JSON.parse(configStr);
    if (Object.keys(config).length > 0) {
      firebaseClient = new FirebaseClient(config);
      syncManager = new SyncManager(firebaseClient);
      
      // Start listening for already linked actors
      game.actors.forEach(actor => syncManager.startListening(actor));
    }
  } catch(e) {
    console.error("Runarcana Sync | Invalid Firebase config", e);
  }
});

Hooks.on('updateActor', (actor, changes, options, userId) => {
  // Only process if we are the user who made the change
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

Hooks.on('renderActorSheet', (app, html, data) => {
  const actor = app.object;
  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');
  const btn = $(`<a class="header-button"><i class="fas fa-sync"></i> ${isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync'}</a>`);
  
  btn.on('click', () => {
    if (!firebaseClient) return ui.notifications.warn("Configure o Firebase nas configurações do módulo primeiro.");
    if (!firebaseClient.auth.currentUser) {
      new RunarcanaLoginDialog(firebaseClient).render(true);
    } else {
      new DraftSelectorDialog(firebaseClient, actor, syncManager).render(true);
    }
  });
  html.closest('.app').find('.window-title').after(btn);
});
