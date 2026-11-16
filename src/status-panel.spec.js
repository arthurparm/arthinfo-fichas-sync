import { describe, expect, it } from 'vitest';
import { escapeHtml, findMesaId, formatAgo, onlineByDraft, renderStatusPanelHtml } from './status-panel.js';

const NOW = 1_700_000_000_000;

function model(overrides = {}) {
  return {
    configured: true,
    now: NOW,
    health: { ok: true, version: '0.0.53', db: 'ok', checkedAt: NOW - 3000 },
    status: { lastSyncAt: NOW - 10_000, lastError: null, actors: [] },
    presence: { online: [] },
    presenceError: null,
    ...overrides,
  };
}

describe('status-panel (FDD-75)', () => {
  it('formatAgo', () => {
    expect(formatAgo(null, NOW)).toBe('nunca');
    expect(formatAgo(NOW - 2000, NOW)).toBe('agora');
    expect(formatAgo(NOW - 42_000, NOW)).toBe('há 42 s');
    expect(formatAgo(NOW - 180_000, NOW)).toBe('há 3 min');
  });

  it('findMesaId pega a primeira ficha de mesa', () => {
    expect(findMesaId([{ id: 'p', mesaId: null }, { id: 'd', mesaId: 'm1' }])).toBe('m1');
    expect(findMesaId([{ id: 'p' }])).toBeNull();
  });

  it('onlineByDraft usa apelido, nome ou uid curto', () => {
    const map = onlineByDraft({
      online: [
        { userId: 'u1', nickname: 'Nina', displayName: 'Ana', draftIds: ['d1'] },
        { userId: 'abcdefghijk', nickname: '', displayName: '', draftIds: ['d1', 'd2'] },
      ],
    });
    expect(map.get('d1')).toEqual(['Nina', 'Usuário abcdefgh']);
    expect(map.get('d2')).toEqual(['Usuário abcdefgh']);
  });

  it('sem chave mostra só a instrução', () => {
    expect(renderStatusPanelHtml(model({ configured: false }))).toContain('chave da mesa não está configurada');
  });

  it('mostra Atores, estado, quem está online e escapa HTML', () => {
    const html = renderStatusPanelHtml(
      model({
        status: {
          lastSyncAt: NOW - 10_000,
          lastError: { name: 'Thorin', message: '<b>409</b>', at: NOW - 5000 },
          actors: [
            {
              actorId: 'a1',
              name: '<script>x</script>',
              draftId: 'd1',
              stream: 'open',
              state: 'conflict',
              lastSyncAt: NOW - 10_000,
              lastError: { message: 'Ficha modificada', at: NOW },
            },
            { actorId: 'a2', name: 'Bilbo', draftId: 'd2', stream: 'reconnecting', state: 'pending', lastSyncAt: null, lastError: null },
          ],
        },
        presence: {
          online: [
            { userId: 'u1', nickname: 'Nina', role: 'player', draftIds: ['d1'], watchingMesa: false },
            { userId: 'gm', displayName: 'Mestre', role: 'gm', draftIds: [], watchingMesa: true },
          ],
        },
      }),
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;409&lt;/b&gt;');
    expect(html).toContain('1 de 2 abertas');
    expect(html).toContain('1 reconectando');
    expect(html).toContain('Conflito');
    expect(html).toContain('Pendente');
    expect(html).toContain('Nina');
    expect(html).toContain('página da mesa');
    expect(html).toContain('a API pode ter reiniciado');
  });

  it('API fora do ar e erro de presença aparecem no texto', () => {
    const html = renderStatusPanelHtml(
      model({
        health: { ok: false, error: 'Failed to fetch', checkedAt: NOW },
        presence: null,
        presenceError: 'Sem a API no ar, não dá para saber quem está online.',
      }),
    );
    expect(html).toContain('fora do ar');
    expect(html).toContain('Sem a API no ar');
    expect(html).toContain('a API pode ter reiniciado');
  });

  it('escapeHtml', () => {
    expect(escapeHtml('a&<>"\'')).toBe('a&amp;&lt;&gt;&quot;&#39;');
  });
});
