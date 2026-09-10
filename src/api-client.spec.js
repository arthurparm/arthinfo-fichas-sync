import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunarcanaApiClient } from './api-client.js';

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}
MockEventSource.instances = [];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeClient(overrides = {}) {
  return new RunarcanaApiClient({
    mesaKey: 'ra_mesa_abc',
    baseUrl: 'https://api.runarcana.org/',
    ...overrides,
  });
}

beforeEach(() => {
  global.foundry = { utils: { randomID: () => 'client-test-id' } };
  global.fetch = vi.fn();
  MockEventSource.instances = [];
  global.EventSource = MockEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RunarcanaApiClient', () => {
  it('envia X-Mesa-Key e Authorization Bearer ao listar fichas', async () => {
    fetch.mockResolvedValue(jsonResponse([]));
    await makeClient().listDrafts();

    expect(fetch).toHaveBeenCalledWith('https://api.runarcana.org/api/drafts', {
      headers: {
        'X-Mesa-Key': 'ra_mesa_abc',
        Authorization: 'Bearer ra_mesa_abc',
      },
    });
  });

  it('envia os mesmos headers no GET e PUT de uma ficha, com X-Client-Id no PUT', async () => {
    fetch.mockResolvedValue(jsonResponse({ id: 'd1' }));
    const client = makeClient();

    await client.getDraft('d1');
    expect(fetch).toHaveBeenLastCalledWith('https://api.runarcana.org/api/drafts/d1', {
      headers: {
        'X-Mesa-Key': 'ra_mesa_abc',
        Authorization: 'Bearer ra_mesa_abc',
      },
    });

    await client.saveDraft('d1', { title: 'A', assignedUserId: 'player-1' });
    expect(fetch).toHaveBeenLastCalledWith('https://api.runarcana.org/api/drafts/d1', {
      method: 'PUT',
      headers: {
        'X-Mesa-Key': 'ra_mesa_abc',
        Authorization: 'Bearer ra_mesa_abc',
        'Content-Type': 'application/json',
        'X-Client-Id': 'client-test-id',
      },
      body: JSON.stringify({ title: 'A' }),
    });
  });

  it('retorna null quando o GET da ficha responde 404', async () => {
    fetch.mockResolvedValue(jsonResponse(null, 404));
    expect(await makeClient().getDraft('missing')).toBeNull();
  });

  it('falha sem chave da mesa, sem chamar fetch', async () => {
    const client = makeClient({ mesaKey: '  ' });
    await expect(client.listDrafts()).rejects.toThrow('Chave da mesa não configurada.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('autentica o PUT de compêndio só com X-Sync-Key, não com a chave da mesa', async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true }));

    await expect(makeClient().putCompendiumItemsBatch([{ name: 'Adaga' }])).rejects.toThrow(
      'Chave de sincronização de compêndio não configurada.',
    );
    expect(fetch).not.toHaveBeenCalled();

    await makeClient({ syncKey: 'global-sync' }).putCompendiumItemsBatch([{ name: 'Adaga' }]);
    expect(fetch.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'X-Sync-Key': 'global-sync',
    });
  });

  it('abre o SSE com a chave no query token e não agenda refresh periódico', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const handle = await makeClient().openStream('d1', () => {}, () => {});

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      'https://api.runarcana.org/api/drafts/d1/stream?token=ra_mesa_abc',
    );
    expect(setIntervalSpy).not.toHaveBeenCalled();

    handle.close();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });
});

describe('listDrafts', () => {
  it('propaga o status HTTP no erro para a UI distinguir chave inválida', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'Token inválido ou ausente.' }, 401));

    await expect(makeClient().listDrafts()).rejects.toMatchObject({ status: 401 });
  });

  it('propaga o status também quando a falha não é de autenticação', async () => {
    fetch.mockResolvedValue(jsonResponse({}, 500));

    await expect(makeClient().listDrafts()).rejects.toMatchObject({ status: 500 });
  });
});
