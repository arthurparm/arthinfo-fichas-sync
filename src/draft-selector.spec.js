import { describe, expect, it } from 'vitest';
import { formatDraftOptionLabel, getDraftIdsLinkedToOtherActors } from './draft-selector.js';

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

  it('mostra assignedUserId como texto secundário quando a API manda', () => {
    expect(formatDraftOptionLabel({
      concept: { name: 'Lyra' },
      classBuild: { classId: 'mago' },
      assignedUserId: 'uid-jogador',
    })).toBe('Lyra (mago) — uid-jogador');
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
