// foundry-module/src/sync-utils.js

/**
 * Função auxiliar para comparação profunda de objetos
 */
export function isDeepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
  
  const isArr1 = Array.isArray(obj1);
  const isArr2 = Array.isArray(obj2);
  if (isArr1 !== isArr2) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key) || !isDeepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Extrai apenas as propriedades "core" relevantes para a sincronização,
 * ignorando metadados e propriedades injetadas pelo Foundry VTT 
 * (ex: _stats, sort, ownership, flags.core, etc).
 */
export function extractCoreItemData(itemData) {
  if (!itemData) return {};
  
  return {
    name: itemData.name,
    type: itemData.type,
    img: itemData.img,
    system: itemData.system ? foundry.utils.deepClone(itemData.system) : {}
  };
}

/**
 * Compara dois itens focando apenas nos campos que importam para o sistema.
 * Retorna true se os itens forem iguais estruturalmente, false se houver mudanças reais.
 */
export function compareItems(localItemData, remoteItemData) {
  const lCore = extractCoreItemData(localItemData);
  const rCore = extractCoreItemData(remoteItemData);
  
  return isDeepEqual(lCore, rCore);
}

/**
 * Limpa o objeto do item antes de enviá-lo para o Firebase.
 * Remove chaves temporárias e mantém o banco de dados enxuto.
 */
export function cleanItemDataForFirebase(itemData) {
  const core = extractCoreItemData(itemData);
  // Restaura o _id necessário para rastreamento no Firebase
  if (itemData._id) {
    core._id = itemData._id;
  }
  return core;
}

/**
 * INTEGRAÇÃO DE ACTIVITIES (D&D 5e v3+)
 * Mescla as activities do item remoto com as locais,
 * para não perder referências dos botões (IDs) gerados no Foundry.
 */
export function mergeActivities(localItemData, remoteItemData) {
  const lActivities = localItemData.system?.activities || {};
  
  if (!remoteItemData.system) remoteItemData.system = {};

  // Fallback: Se o Web App não enviou activities, preservamos as locais
  if (!remoteItemData.system.activities && Object.keys(lActivities).length > 0) {
    remoteItemData.system.activities = foundry.utils.deepClone(lActivities);
  } else if (remoteItemData.system.activities && Object.keys(lActivities).length > 0) {
    // Se o Web App enviou activities, tentamos parear com as locais
    const rActivities = remoteItemData.system.activities;
    const lActArray = Object.entries(lActivities);
    const usedLocalIds = new Set();
    
    // Precisamos iterar sobre uma cópia das keys para poder modificar o objeto original
    for (const rActId of Object.keys(rActivities)) {
      const rAct = rActivities[rActId];
      if (lActivities[rActId]) {
        usedLocalIds.add(rActId);
        continue; // Já existe
      }
      
      // Procura activity local similar (mesmo tipo e nome) que ainda não foi pareada
      const match = lActArray.find(([lId, lAct]) => 
        !usedLocalIds.has(lId) && lAct.type === rAct.type && (lAct.name === rAct.name || !rAct.name)
      );
      
      if (match) {
        const [matchedId] = match;
        usedLocalIds.add(matchedId);
        rActivities[matchedId] = rAct;
        rActivities[matchedId]._id = matchedId;
        delete rActivities[rActId];
      }
    }
  }
}
