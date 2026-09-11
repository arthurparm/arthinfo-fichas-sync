import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunarcanaApiClient } from './api-client.js';

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    this.readyState = 0;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}
MockEventSource.instances = [];
MockEventSource.CONNECTING = 0;
MockEventSource.OPEN = 1;
MockEventSource.CLOSED = 2;

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

    await client.saveDraft('d1', { title: 'A', assignedUserId: 'player-1', updatedAt: '2026-01-01T10:00:00.000Z' });
    expect(fetch).toHaveBeenLastCalledWith('https://api.runarcana.org/api/drafts/d1', {
      method: 'PUT',
      headers: {
        'X-Mesa-Key': 'ra_mesa_abc',
        Authorization: 'Bearer ra_mesa_abc',
        'Content-Type': 'application/json',
        'X-Client-Id': 'client-test-id',
        'If-Match': '2026-01-01T10:00:00.000Z',
      },
      body: JSON.stringify({ title: 'A', updatedAt: '2026-01-01T10:00:00.000Z' }),
    });
  });

  it('em 409 expõe o draft atual do servidor sem descartar o status', async () => {
    fetch.mockResolvedValue(
      jsonResponse(
        {
          error: 'Ficha foi modificada por outra origem desde a última leitura.',
          current: { id: 'd1', updatedAt: '2026-01-01T10:05:00.000Z', concept: { name: 'Lyra' } },
        },
        409,
      ),
    );

    await expect(
      makeClient().saveDraft('d1', { title: 'A', updatedAt: '2026-01-01T10:00:00.000Z' }),
    ).rejects.toMatchObject({
      status: 409,
      current: { id: 'd1', updatedAt: '2026-01-01T10:05:00.000Z', concept: { name: 'Lyra' } },
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

});

describe('openStream — ticket em vez da chave na URL (FDD-46)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function ticketResponse(ticket = 'tkt-1') {
    return jsonResponse({ ticket, expiresAt: '2026-01-01T10:02:00.000Z' }, 201);
  }

  it('pede o ticket por POST com a chave no header e abre o SSE só com ?ticket=', async () => {
    fetch.mockResolvedValue(ticketResponse('tkt-1'));
    const handle = await makeClient().openStream('d1', () => {}, () => {});

    expect(fetch).toHaveBeenCalledWith('https://api.runarcana.org/api/drafts/d1/stream-ticket', {
      method: 'POST',
      headers: {
        'X-Mesa-Key': 'ra_mesa_abc',
        Authorization: 'Bearer ra_mesa_abc',
      },
    });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe(
      'https://api.runarcana.org/api/drafts/d1/stream?ticket=tkt-1',
    );
    expect(MockEventSource.instances[0].url).not.toContain('ra_mesa_');

    handle.close();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it('falha na primeira conexão propaga o status pro chamador (chave inválida = 401)', async () => {
    fetch.mockResolvedValue(jsonResponse({ error: 'Token inválido ou ausente.' }, 401));

    await expect(makeClient().openStream('d1', () => {}, () => {})).rejects.toMatchObject({ status: 401 });
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('entrega mensagens parseadas ao onMessage', async () => {
    fetch.mockResolvedValue(ticketResponse());
    const onMessage = vi.fn();
    await makeClient().openStream('d1', onMessage, () => {});

    MockEventSource.instances[0].onmessage({ data: JSON.stringify({ draftId: 'd1', data: { hp: 3 } }) });

    expect(onMessage).toHaveBeenCalledWith({ draftId: 'd1', data: { hp: 3 } });
  });

  it('ticket vencido (EventSource CLOSED) → reabre com ticket novo depois do backoff', async () => {
    fetch.mockResolvedValueOnce(ticketResponse('tkt-1')).mockResolvedValueOnce(ticketResponse('tkt-2'));
    const onError = vi.fn();
    await makeClient().openStream('d1', () => {}, onError);
    const first = MockEventSource.instances[0];

    first.readyState = 2;
    first.onerror(new Error('401'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2000);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('ticket=tkt-2');
  });

  it('queda curta (EventSource CONNECTING) deixa o nativo reconectar — não pede ticket novo', async () => {
    fetch.mockResolvedValue(ticketResponse());
    await makeClient().openStream('d1', () => {}, () => {});
    const source = MockEventSource.instances[0];

    source.readyState = 0;
    source.onerror(new Error('blip'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(source.closed).toBe(false);
  });

  it('POST do ticket com 403/404 na reconexão não fica em loop', async () => {
    fetch
      .mockResolvedValueOnce(ticketResponse('tkt-1'))
      .mockResolvedValueOnce(jsonResponse({ error: 'Sem permissão para esta ficha.' }, 403));
    const onError = vi.fn();
    await makeClient().openStream('d1', () => {}, onError);

    MockEventSource.instances[0].readyState = 2;
    MockEventSource.instances[0].onerror(new Error('401'));
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ status: 403 }));
  });

  it('close() cancela a reconexão pendente e não reabre nada', async () => {
    fetch.mockResolvedValue(ticketResponse());
    const handle = await makeClient().openStream('d1', () => {}, () => {});

    MockEventSource.instances[0].readyState = 2;
    MockEventSource.instances[0].onerror(new Error('401'));
    handle.close();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);
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
