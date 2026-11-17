import { describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, startPresenceHeartbeat } from './presence-heartbeat.js';

function setup({ active = true, other = false, post } = {}) {
  const apiClient = { postFoundryPresence: post ?? vi.fn(async () => ({})) };
  const state = { active, other };
  let tick = null;
  let pageHide = null;
  const clearInterval = vi.fn();
  const onError = vi.fn();
  const handle = startPresenceHeartbeat(apiClient, {
    isActiveGM: () => state.active,
    otherGmActive: () => state.other,
    setInterval: (fn, ms) => {
      tick = { fn, ms };
      return 7;
    },
    clearInterval,
    addPageHideListener: (fn) => {
      pageHide = fn;
    },
    onError,
  });
  return { apiClient, handle, state, clearInterval, onError, tick: () => tick, pageHide: () => pageHide };
}

describe('startPresenceHeartbeat', () => {
  it('quem não é o GM ativo não manda online nem offline', () => {
    const { apiClient, tick, pageHide } = setup({ active: false });
    tick().fn();
    pageHide()();
    expect(apiClient.postFoundryPresence).not.toHaveBeenCalled();
  });

  it('manda online ao iniciar e a cada intervalo; reavalia o GM ativo a cada sinal', () => {
    const { apiClient, tick, state } = setup();
    expect(apiClient.postFoundryPresence).toHaveBeenCalledWith('online');
    expect(tick().ms).toBe(HEARTBEAT_INTERVAL_MS);
    tick().fn();
    expect(apiClient.postFoundryPresence).toHaveBeenCalledTimes(2);
    state.active = false;
    tick().fn();
    expect(apiClient.postFoundryPresence).toHaveBeenCalledTimes(2);
  });

  it('manda offline com keepalive ao fechar a página quando é o último GM', () => {
    const { apiClient, pageHide } = setup();
    pageHide()();
    expect(apiClient.postFoundryPresence).toHaveBeenLastCalledWith('offline', { keepalive: true });
  });

  it('não manda offline se outro GM continua no mundo', () => {
    const { apiClient, pageHide } = setup({ other: true });
    pageHide()();
    expect(apiClient.postFoundryPresence).toHaveBeenCalledTimes(1);
  });

  it('stop() para os sinais', () => {
    const { apiClient, handle, tick, clearInterval, pageHide } = setup();
    handle.stop();
    tick().fn();
    pageHide()();
    expect(clearInterval).toHaveBeenCalledWith(7);
    expect(apiClient.postFoundryPresence).toHaveBeenCalledTimes(1);
  });

  it('erro de rede não propaga e segue tentando', async () => {
    const post = vi.fn(async () => {
      throw Object.assign(new Error('x'), { status: 500 });
    });
    const { onError, tick, clearInterval } = setup({ post });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    tick().fn();
    expect(post).toHaveBeenCalledTimes(2);
    expect(clearInterval).not.toHaveBeenCalled();
  });

  it('404 (API sem a rota) para o heartbeat', async () => {
    const post = vi.fn(async () => {
      throw Object.assign(new Error('x'), { status: 404 });
    });
    const { clearInterval, tick } = setup({ post });
    await vi.waitFor(() => expect(clearInterval).toHaveBeenCalledWith(7));
    tick().fn();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
