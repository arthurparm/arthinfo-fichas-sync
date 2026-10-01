import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRest } from './apply-rest.js';

function makeActor() {
  return {
    name: 'Karon',
    longRest: vi.fn(async () => ({})),
    shortRest: vi.fn(async () => ({})),
  };
}

describe('applyRest', () => {
  beforeEach(() => {
    global.game = { user: { id: 'gm-1' }, users: { activeGM: { id: 'gm-1' } } };
  });

  it('long: chama actor.longRest sem diálogo', async () => {
    const actor = makeActor();
    await applyRest(actor, { type: 'long' });
    expect(actor.longRest).toHaveBeenCalledWith({ dialog: false });
    expect(actor.shortRest).not.toHaveBeenCalled();
  });

  it('short: chama actor.shortRest sem diálogo', async () => {
    const actor = makeActor();
    await applyRest(actor, { type: 'short' });
    expect(actor.shortRest).toHaveBeenCalledWith({ dialog: false });
    expect(actor.longRest).not.toHaveBeenCalled();
  });

  it('não descansa quando este cliente não é o GM ativo', async () => {
    global.game = { user: { id: 'gm-2' }, users: { activeGM: { id: 'gm-1' } } };
    const actor = makeActor();
    await applyRest(actor, { type: 'long' });
    expect(actor.longRest).not.toHaveBeenCalled();
  });

  it('ignora tipo desconhecido e payload ausente', async () => {
    const actor = makeActor();
    await applyRest(actor, { type: 'pleno' });
    await applyRest(actor, undefined);
    expect(actor.longRest).not.toHaveBeenCalled();
    expect(actor.shortRest).not.toHaveBeenCalled();
  });

  it('erro do Foundry no descanso não estoura', async () => {
    const actor = makeActor();
    actor.longRest.mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(applyRest(actor, { type: 'long' })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
