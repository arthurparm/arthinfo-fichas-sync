import { describe, expect, it, vi } from 'vitest';
import { SyncStatusTracker } from './sync-status.js';

const actor = { id: 'a1', name: 'Thorin' };

function makeTracker() {
  let now = 1000;
  const tracker = new SyncStatusTracker({ now: () => now });
  return {
    tracker,
    tick: (ms = 1000) => {
      now += ms;
    },
  };
}

describe('SyncStatusTracker (FDD-75)', () => {
  it('track começa conectando e sincronizado; avisa os ouvintes', () => {
    const { tracker } = makeTracker();
    const listener = vi.fn();
    tracker.onChange(listener);
    tracker.track(actor, 'd1');
    expect(tracker.snapshot().actors).toEqual([
      { actorId: 'a1', name: 'Thorin', draftId: 'd1', stream: 'connecting', state: 'synced', lastSyncAt: null, lastError: null },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('edição pendente some só quando o save que começou depois dela termina', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    tracker.markPending('a1');
    const first = tracker.checkpoint();
    tracker.markPending('a1'); // editou de novo durante o save
    tracker.markSynced('a1', first);
    expect(tracker.snapshot().actors[0].state).toBe('pending');
    expect(tracker.snapshot().lastSyncAt).toBe(1000);

    const second = tracker.checkpoint();
    tracker.markSynced('a1', second);
    expect(tracker.snapshot().actors[0].state).toBe('synced');
  });

  it('save do Ator bem-sucedido não esconde falha anterior do save de itens', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    tracker.markPending('a1', 'items');
    tracker.checkpoint();
    tracker.markError('a1', new Error('HTTP 413'), 'items');
    tracker.markPending('a1', 'actor');
    tracker.markSynced('a1', tracker.checkpoint(), 'actor');
    expect(tracker.snapshot().actors[0]).toMatchObject({ state: 'error', lastError: { message: 'HTTP 413' } });

    tracker.markPending('a1', 'items');
    tracker.markSynced('a1', tracker.checkpoint(), 'items');
    expect(tracker.snapshot().actors[0]).toMatchObject({ state: 'synced', lastError: null });
  });

  it('item na fila continua pendente depois que o save do Ator termina', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    tracker.markPending('a1', 'items');
    tracker.markPending('a1', 'actor');
    tracker.markSynced('a1', tracker.checkpoint(), 'actor');
    expect(tracker.snapshot().actors[0].state).toBe('pending');
  });

  it('nome vem do Ator na hora (renomear aparece no painel)', () => {
    const { tracker } = makeTracker();
    const live = { id: 'a9', name: 'Antes' };
    tracker.track(live, 'd9');
    live.name = 'Depois';
    expect(tracker.snapshot().actors[0].name).toBe('Depois');
  });

  it('ficha do site aplicada não esconde edição local pendente', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    tracker.markPending('a1');
    tracker.markRemoteApplied('a1');
    expect(tracker.snapshot().actors[0].state).toBe('pending');
    expect(tracker.snapshot().actors[0].lastSyncAt).toBe(1000);

    tracker.markSynced('a1', tracker.checkpoint());
    tracker.markRemoteApplied('a1');
    expect(tracker.snapshot().actors[0].state).toBe('synced');
  });

  it('conflito e erro guardam a mensagem e viram o erro recente', () => {
    const { tracker, tick } = makeTracker();
    tracker.track(actor, 'd1');
    tick();
    tracker.markConflict('a1', Object.assign(new Error('Ficha modificada'), { status: 409 }));
    const snap = tracker.snapshot();
    expect(snap.actors[0]).toMatchObject({ state: 'conflict', lastError: { message: 'Ficha modificada', at: 2000 } });
    expect(snap.lastError).toEqual({ actorId: 'a1', name: 'Thorin', message: 'Ficha modificada', at: 2000 });

    tracker.markSynced('a1', tracker.checkpoint());
    expect(tracker.snapshot().actors[0]).toMatchObject({ state: 'synced', lastError: null });
    // O erro recente global continua visível para o mestre.
    expect(tracker.snapshot().lastError.message).toBe('Ficha modificada');
  });

  it('ficha apagada não volta para pendente com nova edição', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    tracker.markMissing('a1');
    tracker.markPending('a1');
    expect(tracker.snapshot().actors[0].state).toBe('missing');
  });

  it('setStream só avisa quando muda; forget remove', () => {
    const { tracker } = makeTracker();
    tracker.track(actor, 'd1');
    const listener = vi.fn();
    tracker.onChange(listener);
    tracker.setStream('a1', 'open');
    tracker.setStream('a1', 'open');
    expect(listener).toHaveBeenCalledTimes(1);
    tracker.forget('a1');
    expect(tracker.snapshot().actors).toEqual([]);
  });

  it('ouvinte que lança não derruba os outros', () => {
    const { tracker } = makeTracker();
    const good = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    tracker.onChange(() => {
      throw new Error('boom');
    });
    tracker.onChange(good);
    tracker.track(actor, 'd1');
    expect(good).toHaveBeenCalled();
    spy.mockRestore();
  });
});
