// foundry-module/src/index.js
import { FirebaseClient } from './firebase-client.js';
import { RunarcanaLoginDialog } from './login-dialog.js';
import { DraftSelectorDialog } from './draft-selector.js';
import { SyncManager } from './sync-manager.js';

let firebaseClient = null;
let syncManager = null;

function getStringSetting(key) {
  const value = game.settings.get('runarcana-sync', key);
  return typeof value === 'string' ? value.trim() : '';
}

function getFirebaseConfigFromSimpleFields() {
  const apiKey = getStringSetting('apiKey');
  const authDomain = getStringSetting('authDomain');
  const projectId = getStringSetting('projectId');
  const appId = getStringSetting('appId');

  const missingFields = [];
  if (!apiKey) missingFields.push('apiKey');
  if (!authDomain) missingFields.push('authDomain');
  if (!projectId) missingFields.push('projectId');

  if (missingFields.length > 0) {
    return { config: {}, missingFields };
  }

  const config = { apiKey, authDomain, projectId };
  if (appId) config.appId = appId;

  return { config, missingFields: [] };
}

function extractConfigFromAdvancedField(rawConfig) {
  if (!rawConfig) {
    return { config: {}, missingFields: [] };
  }

  try {
    const parsedConfig = JSON.parse(rawConfig);
    const apiKey = typeof parsedConfig.apiKey === 'string' ? parsedConfig.apiKey.trim() : '';
    const authDomain = typeof parsedConfig.authDomain === 'string' ? parsedConfig.authDomain.trim() : '';
    const projectId = typeof parsedConfig.projectId === 'string' ? parsedConfig.projectId.trim() : '';
    const appId = typeof parsedConfig.appId === 'string' ? parsedConfig.appId.trim() : '';

    const missingFields = [];
    if (!apiKey) missingFields.push('apiKey');
    if (!authDomain) missingFields.push('authDomain');
    if (!projectId) missingFields.push('projectId');

    if (missingFields.length > 0) {
      return { config: {}, missingFields };
    }

    const config = { ...parsedConfig, apiKey, authDomain, projectId };
    if (appId) config.appId = appId;

    return { config, missingFields: [] };
  } catch (parseError) {
    console.warn(
      'Runarcana Sync | Erro ao interpretar JSON Avançado. Tentando extrair chaves via Regex.',
      parseError
    );

    // Permite colar um objeto JS em vez de JSON estrito, por exemplo:
    // const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "..." }
    const extractKey = (key) => {
      const match = rawConfig.match(new RegExp(`${key}['"\\s]*:['"\\s]*([^'",\\s]+)`));
      return match ? match[1].trim() : '';
    };

    const apiKey = extractKey('apiKey');
    const authDomain = extractKey('authDomain');
    const projectId = extractKey('projectId');
    const appId = extractKey('appId');
    const storageBucket = extractKey('storageBucket');
    const messagingSenderId = extractKey('messagingSenderId');

    const missingFields = [];
    if (!apiKey) missingFields.push('apiKey');
    if (!authDomain) missingFields.push('authDomain');
    if (!projectId) missingFields.push('projectId');

    if (missingFields.length > 0) {
      return { config: {}, missingFields };
    }

    const config = { apiKey, authDomain, projectId };
    if (appId) config.appId = appId;
    if (storageBucket) config.storageBucket = storageBucket;
    if (messagingSenderId) config.messagingSenderId = messagingSenderId;

    return { config, missingFields: [] };
  }
}

Hooks.once('init', () => {
  // Configuração amigável: Campos separados para cada credencial do Firebase
  game.settings.register('runarcana-sync', 'apiKey', {
    name: 'Firebase API Key',
    hint: 'Sua chave de API web do Firebase (apiKey).',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'authDomain', {
    name: 'Firebase Auth Domain',
    hint: 'Seu domínio de autenticação (authDomain). Ex: seu-projeto.firebaseapp.com',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'projectId', {
    name: 'Firebase Project ID',
    hint: 'O ID do seu projeto no Firebase (projectId).',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'appId', {
    name: 'Firebase App ID',
    hint: '(Opcional) O ID do aplicativo (appId). Geralmente no formato 1:xxxxxxxxxx:web:xxxxxxxxxx.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  // Campo Opcional / Legado (Caso o usuário prefira colar o JSON inteiro de uma vez)
  game.settings.register('runarcana-sync', 'firebaseConfigJSON', {
    name: 'Firebase Config (JSON Avançado)',
    hint: '(Opcional) Cole o objeto JSON completo do Firebase aqui. Se preenchido, irá sobrepor os campos individuais acima.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });
});

Hooks.once('ready', () => {
  const advancedField = getStringSetting('firebaseConfigJSON');
  let config = {};
  let missingFields = [];

  try {
    if (advancedField) {
      const advancedResult = extractConfigFromAdvancedField(advancedField);
      config = advancedResult.config;
      missingFields = advancedResult.missingFields;

      if (Object.keys(config).length === 0 && missingFields.length > 0) {
        console.warn(
          `Runarcana Sync | JSON Avançado incompleto ou inválido. Campos ausentes: ${missingFields.join(', ')}. Tentando usar campos individuais.`
        );
      }
    }

    if (Object.keys(config).length === 0) {
      const fallback = getFirebaseConfigFromSimpleFields();
      config = fallback.config;
      missingFields = fallback.missingFields;
    }

    if (Object.keys(config).length > 0) {
      firebaseClient = new FirebaseClient(config);
      syncManager = new SyncManager(firebaseClient);

      // Start listening for already linked actors
      game.actors.forEach(actor => syncManager.startListening(actor));
      console.log('Runarcana Sync | Firebase configurado e rodando.');
    } else {
      console.warn(
        `Runarcana Sync | Firebase não configurado. Campos ausentes: ${missingFields.join(', ') || 'desconhecidos'}.`
      );
    }
  } catch (e) {
    console.error('Runarcana Sync | Erro ao iniciar o Firebase:', e);
    ui.notifications.error('Runarcana Sync: Configuração do Firebase inválida.');
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
  if (!actor || actor.documentName !== 'Actor') return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');

  buttons.unshift({
    class: 'runarcana-sync-btn',
    icon: 'fas fa-sync',
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    onclick: () => {
      if (!firebaseClient) {
        return ui.notifications.warn('Configure o Firebase nas configurações do módulo primeiro.');
      }
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
  if (!actor || actor.documentName !== 'Actor') return;

  const isLinked = !!actor.getFlag('runarcana-sync', 'draftId');

  controls.unshift({
    action: 'runarcana-sync',
    icon: 'fas fa-sync',
    label: isLinked ? 'Runarcana (Vinculado)' : 'Runarcana Sync',
    class: 'runarcana-sync-btn',
    onClick: () => {
      if (!firebaseClient) {
        return ui.notifications.warn('Configure o Firebase nas configurações do módulo primeiro.');
      }
      if (!firebaseClient.auth.currentUser) {
        new RunarcanaLoginDialog(firebaseClient).render(true);
      } else {
        new DraftSelectorDialog(firebaseClient, actor, syncManager).render(true);
      }
    }
  });
});
