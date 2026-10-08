// Migração única do id antigo do módulo ('runarcana-sync') para o novo
// ('arthinfo-fichas-sync'). Roda no `ready`, só pro GM, ANTES do sync começar a
// ouvir os Atores — assim os updates daqui não viram escrita pro backend.
//
// O que migra em lote:
//   - o vínculo Ator <-> ficha (flags.<id>.draftId), que é o que o usuário
//     perderia de vista;
//   - as configurações do módulo (chave da mesa, URL do backend...), copiadas só
//     se a configuração nova ainda estiver vazia.
// O que NÃO migra em lote (leitura com fallback em readFlag, ver module-id.js):
// flags de Itens (sourceId), de mensagens de chat (rollId) e do compêndio
// (catalogKey) — atualizar todos geraria uma enxurrada de updateItem.
import { LEGACY_MODULE_ID, MODULE_ID } from './module-id.js';

const SETTING_KEYS = ['mesaKey', 'backendUrl', 'compendiumSyncSelection'];

function parseStored(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Lê uma configuração de mundo gravada com o id legado, direto do armazenamento
// (o Foundry não deixa `game.settings.get` em chave não registrada).
function readLegacyWorldSetting(game, key) {
  const fullKey = `${LEGACY_MODULE_ID}.${key}`;
  const store = game.settings?.storage?.get?.('world');
  const doc =
    store?.getSetting?.(fullKey) ?? store?.find?.((setting) => setting.key === fullKey);
  if (!doc) return undefined;
  return parseStored(doc.value);
}

function isEmpty(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

// Configurações que já nascem com um valor padrão: o padrão conta como "não
// configurado" (senão uma URL personalizada do usuário nunca seria migrada).
const DEFAULT_VALUES = { backendUrl: 'https://api.runarcana.org' };

export async function migrateLegacySettings(game) {
  if (!game.user?.isGM) return 0;
  let migrated = 0;
  for (const key of SETTING_KEYS) {
    try {
      const legacy = readLegacyWorldSetting(game, key);
      if (isEmpty(legacy)) continue;
      const current = game.settings.get(MODULE_ID, key);
      if (!isEmpty(current) && current !== DEFAULT_VALUES[key]) continue; // já configurado no módulo novo
      if (current === legacy) continue;
      await game.settings.set(MODULE_ID, key, legacy);
      migrated += 1;
    } catch (error) {
      console.warn(`Arthinfo Fichas | Não consegui migrar a configuração "${key}" do módulo antigo.`, error);
    }
  }
  return migrated;
}

export async function migrateLegacyActorLinks(game) {
  if (!game.user?.isGM) return 0;
  let migrated = 0;
  for (const actor of game.actors ?? []) {
    const legacyDraftId = actor.flags?.[LEGACY_MODULE_ID]?.draftId;
    if (!legacyDraftId) continue;
    try {
      const current = actor.getFlag(MODULE_ID, 'draftId');
      const update = { [`flags.${LEGACY_MODULE_ID}.-=draftId`]: null };
      if (!current) update[`flags.${MODULE_ID}.draftId`] = legacyDraftId;
      await actor.update(update);
      migrated += 1;
    } catch (error) {
      console.warn(`Arthinfo Fichas | Não consegui migrar o vínculo de "${actor.name}".`, error);
    }
  }
  return migrated;
}

export async function runLegacyMigration(game) {
  const settings = await migrateLegacySettings(game);
  const links = await migrateLegacyActorLinks(game);
  if (settings || links) {
    console.log(
      `Arthinfo Fichas | Migração do módulo antigo: ${links} vínculo(s) de ficha e ${settings} configuração(ões).`,
    );
  }
  return { settings, links };
}
