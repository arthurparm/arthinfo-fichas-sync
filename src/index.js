// foundry-module/src/index.js
import { FirebaseClient } from './firebase-client.js';
import { RunarcanaApiClient } from './api-client.js';
import { RunarcanaLoginDialog } from './login-dialog.js';
import { DraftSelectorDialog } from './draft-selector.js';
import { CompendiumSyncDialog } from './compendium-sync-dialog.js';
import { SyncManager } from './sync-manager.js';

let firebaseClient = null;
let apiClient = null;
let syncManager = null;

function openCompendiumSyncDialog() {
  if (!apiClient) {
    ui.notifications.warn('Configure a URL do backend nas configurações do módulo primeiro.');
    return;
  }
  new CompendiumSyncDialog(apiClient).render();
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

// Config padrão do serviço central Runarcana (o mesmo projeto Firebase e
// backend usados pelo site) — quem instala o módulo não precisa ter/criar
// nada próprio, só logar. Esses valores já são públicos (o apiKey do
// Firebase Web não é segredo) e já estão embutidos no runtime-config.json
// do site. Continuam editáveis nas configurações do módulo só pra quem
// quiser rodar uma instância própria/self-hosted.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBrsYNloHwMgf2x9QKFScMFZmWf6t2Yiak',
  authDomain: 'rpg-fichas-centralizadas.firebaseapp.com',
  projectId: 'rpg-fichas-centralizadas',
  appId: '1:233256160629:web:7a9a8e05edb429e407973c',
};

Hooks.once('init', () => {
  // Configuração amigável: Campos separados para cada credencial do Firebase
  game.settings.register('runarcana-sync', 'apiKey', {
    name: 'Firebase API Key',
    hint: 'Sua chave de API web do Firebase (apiKey). Já vem preenchida com o serviço central Runarcana.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_FIREBASE_CONFIG.apiKey,
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'authDomain', {
    name: 'Firebase Auth Domain',
    hint: 'Seu domínio de autenticação (authDomain). Já vem preenchida com o serviço central Runarcana.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_FIREBASE_CONFIG.authDomain,
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'projectId', {
    name: 'Firebase Project ID',
    hint: 'O ID do seu projeto no Firebase (projectId). Já vem preenchida com o serviço central Runarcana.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_FIREBASE_CONFIG.projectId,
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'appId', {
    name: 'Firebase App ID',
    hint: '(Opcional) O ID do aplicativo (appId). Já vem preenchida com o serviço central Runarcana.',
    scope: 'world',
    config: true,
    type: String,
    default: DEFAULT_FIREBASE_CONFIG.appId,
    requiresReload: true
  });

  // Campo Opcional / Legado (Caso o usuário prefira colar o JSON inteiro de uma vez)
  game.settings.register('runarcana-sync', 'firebaseConfigJSON', {
    name: 'Firebase Config (JSON Avançado)',
    hint: '(Opcional) Só preencha se for rodar seu próprio projeto Firebase em vez do serviço central Runarcana. Se preenchido, sobrepõe os campos individuais acima.',
    scope: 'world',
    config: true,
    type: String,
    default: '',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'backendUrl', {
    name: 'URL do Backend Runarcana',
    hint: 'URL base do servidor runarcana-api. Já vem preenchida com o serviço central Runarcana — só troque se for rodar sua própria instância. É ele quem guarda as fichas e distribui as mudanças ao vivo — o Firebase acima serve só para login.',
    scope: 'world',
    config: true,
    type: String,
    default: 'https://api.runarcana.org',
    requiresReload: true
  });

  game.settings.register('runarcana-sync', 'compendiumSyncKey', {
    name: 'Chave de Sincronização de Compêndio',
    hint: 'Chave usada só para sincronizar itens de compêndio (não é login). Peça a chave da sua assinatura, ou configure a sua própria se estiver rodando um backend próprio.',
    scope: 'world',
    config: true,
    type: String,
    default: ''
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
});

Hooks.once('ready', async () => {
  // Ponto de entrada estável pra abrir a sincronização de compêndio via
  // macro, caso o botão do menu de configurações não apareça na sua versão
  // do Foundry: game.modules.get('runarcana-sync').api.openCompendiumSync()
  const thisModule = game.modules.get('runarcana-sync');
  if (thisModule) {
    thisModule.api = { openCompendiumSync: openCompendiumSyncDialog };
  }

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

      const backendUrl = getStringSetting('backendUrl');
      if (backendUrl) {
        apiClient = new RunarcanaApiClient(firebaseClient, backendUrl);
        syncManager = new SyncManager(apiClient);

        // Espera o Firebase terminar de restaurar a sessão persistida (ex:
        // depois de um reload) antes de tentar reconectar — sem isso,
        // auth.currentUser ainda está null nesse ponto e todo mundo já
        // logado toma "Usuário não autenticado" no hook ready, mesmo
        // continuando logado de verdade um instante depois.
        await firebaseClient.waitForAuthReady();

        // Start listening for already linked actors
        game.actors.forEach(actor => syncManager.startListening(actor));
        console.log('Runarcana Sync | Firebase (login) e backend configurados e rodando.');

        // Exposto pra depuração/macros: game.modules.get('runarcana-sync').api
        thisModule.api.firebaseClient = firebaseClient;
        thisModule.api.syncManager = syncManager;
      } else {
        console.warn('Runarcana Sync | URL do backend não configurada nas configurações do módulo.');
      }
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
    onclick: () => {
      if (!firebaseClient || !apiClient) {
        return ui.notifications.warn('Configure o Firebase e a URL do backend nas configurações do módulo primeiro.');
      }
      if (!firebaseClient.auth.currentUser) {
        new RunarcanaLoginDialog(firebaseClient).render(true);
      } else {
        new DraftSelectorDialog(apiClient, actor, syncManager).render(true);
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
      if (!firebaseClient || !apiClient) {
        return ui.notifications.warn('Configure o Firebase e a URL do backend nas configurações do módulo primeiro.');
      }
      if (!firebaseClient.auth.currentUser) {
        new RunarcanaLoginDialog(firebaseClient).render(true);
      } else {
        new DraftSelectorDialog(apiClient, actor, syncManager).render(true);
      }
    }
  });
});
