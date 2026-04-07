// foundry-module/src/sync-manager.js
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

export class SyncManager {
  constructor(firebaseClient) {
    this.firebaseClient = firebaseClient;
    this.subscriptions = new Map();
    this.isApplyingRemote = false;
  }

  startListening(actor) {
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId || this.subscriptions.has(actor.id)) return;

    const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
    const unsub = onSnapshot(docRef, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      
      const currentHp = actor.system.attributes?.hp?.value || 0;
      const remoteHp = data.derivedStats?.maxHp || 0;
      
      this.isApplyingRemote = true;

      // 1. Sync Base Attributes
      if (currentHp !== remoteHp) {
        await actor.update({
          'system.attributes.hp.max': data.derivedStats?.maxHp || 10,
          'system.attributes.hp.value': data.derivedStats?.maxHp || 10,
          'system.abilities.str.value': (data.attributes?.scores?.strength || 10) + (data.attributes?.originBonuses?.strength || 0)
        });
      }

      // 2. Sync Items (Deep Sync)
      if (data.items && Array.isArray(data.items)) {
        const remoteItems = data.items;
        const localItems = actor.items.contents;
        
        const toCreate = [];
        const toUpdate = [];
        const toDelete = [];

        // Find items to Create or Update
        for (const rItem of remoteItems) {
          const lItem = localItems.find(i => i.id === rItem._id);
          if (!lItem) {
            toCreate.push(rItem);
          } else {
            // Compare stringified versions to avoid unnecessary updates
            const lItemJson = JSON.stringify(lItem.toObject());
            const rItemJson = JSON.stringify(rItem);
            if (lItemJson !== rItemJson) {
              toUpdate.push(rItem);
            }
          }
        }

        // Find items to Delete
        for (const lItem of localItems) {
          const existsRemote = remoteItems.some(i => i._id === lItem.id);
          if (!existsRemote) {
            toDelete.push(lItem.id);
          }
        }

        // Apply batch operations
        if (toDelete.length > 0) {
          await actor.deleteEmbeddedDocuments("Item", toDelete);
        }
        if (toCreate.length > 0) {
          await actor.createEmbeddedDocuments("Item", toCreate);
        }
        if (toUpdate.length > 0) {
          await actor.updateEmbeddedDocuments("Item", toUpdate);
        }
      }

      this.isApplyingRemote = false;
    });

    this.subscriptions.set(actor.id, unsub);
  }

  async handleActorUpdate(actor, changes) {
    // If update came from our onSnapshot, ignore it (anti-echo)
    if (this.isApplyingRemote) return;
    
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    // Check if relevant fields changed
    const newHpMax = changes.system?.attributes?.hp?.max;
    if (newHpMax !== undefined) {
      const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
      await updateDoc(docRef, {
        'derivedStats.maxHp': newHpMax
      });
    }
  }

  async handleItemUpdate(actor) {
    if (this.isApplyingRemote) return;
    
    const draftId = actor.getFlag('runarcana-sync', 'draftId');
    if (!draftId) return;

    // Convert all items to plain JSON objects to store in Firebase
    const itemsData = actor.items.map(item => item.toObject());
    
    const docRef = doc(this.firebaseClient.db, 'character_drafts', draftId);
    await updateDoc(docRef, {
      items: itemsData
    });
  }
}
