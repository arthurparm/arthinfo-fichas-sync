import { describe, expect, it } from 'vitest';
import {
  buildDraftLoadErrorMessage,
  formatDraftOptionLabel,
  getDraftIdsLinkedToOtherActors,
} from './draft-selector.js';

function makeActor(id, draftId) {
  return { id, getFlag: (scope, key) => (scope === 'runarcana-sync' && key === 'draftId' ? draftId : undefined) };
}

describe('formatDraftOptionLabel', () => {
  it('usa o nome do conceito e a classe quando existem', () => {
    expect(formatDraftOptionLabel({
      concept: { name: 'Lyra' },
      classBuild: { classId: 'guerreiro' },
    })).toBe('Lyra (guerreiro)');
  });

  it('cai no título da ficha e marca classe ausente', () => {
    expect(formatDraftOptionLabel({ title: 'Rascunho' })).toBe('Rascunho (Sem Classe)');
  });

  it('sinaliza ficha atribuída sem vazar o uid do Firebase no dropdown', () => {
    const label = formatDraftOptionLabel({
      concept: { name: 'Lyra' },
      classBuild: { classId: 'mago' },
      assignedUserId: 'uid-jogador',
    });
    expect(label).toBe('Lyra (mago) — atribuída a um jogador');
    expect(label).not.toContain('uid-jogador');
  });

  it('não marca atribuição quando a ficha não tem jogador', () => {
    expect(formatDraftOptionLabel({
      concept: { name: 'Lyra' },
      classBuild: { classId: 'mago' },
    })).toBe('Lyra (mago)');
  });
});

describe('getDraftIdsLinkedToOtherActors', () => {
  it('retorna os draftIds de outros Atores, excluindo o Ator atual', () => {
    const actors = [makeActor('a1', 'draft-1'), makeActor('a2', 'draft-2'), makeActor('a3', undefined)];
    expect(getDraftIdsLinkedToOtherActors(actors, 'a1')).toEqual(new Set(['draft-2']));
  });

  it('ignora Atores sem vínculo', () => {
    const actors = [makeActor('a1', undefined), makeActor('a2', undefined)];
    expect(getDraftIdsLinkedToOtherActors(actors, 'a1').size).toBe(0);
  });

  it('lida com lista vazia ou ausente', () => {
    expect(getDraftIdsLinkedToOtherActors([], 'a1').size).toBe(0);
    expect(getDraftIdsLinkedToOtherActors(undefined, 'a1').size).toBe(0);
  });
});

describe('buildDraftLoadErrorMessage', () => {
  it('trata 401 como chave inválida e manda gerar outra no site', () => {
    const err = Object.assign(new Error('Falha ao listar fichas (HTTP 401).'), { status: 401 });
    const html = buildDraftLoadErrorMessage(err);
    expect(html).toContain('Chave da mesa inválida ou revogada');
    // Não manda conferir URL/servidor: nesse caso o problema não é esse.
    expect(html).not.toContain('runarcana-api');
  });

  it('mantém o diagnóstico genérico para erro que não é de autenticação', () => {
    const err = Object.assign(new Error('Failed to fetch'), { status: undefined });
    const html = buildDraftLoadErrorMessage(err);
    expect(html).toContain('Failed to fetch');
    expect(html).toContain('runarcana-api');
  });

  it('escapa a mensagem do erro no caminho genérico', () => {
    const html = buildDraftLoadErrorMessage(new Error('<img src=x onerror=alert(1)>'));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
