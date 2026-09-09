import { describe, expect, it } from 'vitest';
import { formatDraftOptionLabel } from './draft-selector.js';

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
