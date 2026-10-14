import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSystemPack, listItemCompendia } from './compendium-sync.js';

function pack(collection, packageType, documentName = 'Item') {
  return { collection, documentName, metadata: { packageType, label: collection } };
}

describe('listItemCompendia (FDD-74)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não oferece os compêndios do sistema (SRD); mantém módulos e mundo', () => {
    vi.stubGlobal('game', {
      packs: [
        pack('dnd5e.items', 'system'),
        pack('dnd5e.classes24', 'system'),
        pack('dnd-players-handbook.classes', 'module'),
        pack('world.meus-itens', 'world'),
      ],
    });
    // game.packs é uma Collection do Foundry; aqui um array já tem .filter
    expect(listItemCompendia().map((p) => p.collection)).toEqual([
      'dnd-players-handbook.classes',
      'world.meus-itens',
    ]);
  });

  it('continua só com compêndios do tipo Item', () => {
    vi.stubGlobal('game', {
      packs: [pack('world.cenas', 'world', 'Scene'), pack('world.itens', 'world')],
    });
    expect(listItemCompendia().map((p) => p.collection)).toEqual(['world.itens']);
  });

  it('isSystemPack só é verdadeiro para packageType system', () => {
    expect(isSystemPack(pack('a', 'system'))).toBe(true);
    expect(isSystemPack(pack('a', 'module'))).toBe(false);
    expect(isSystemPack({})).toBe(false);
    expect(isSystemPack(undefined)).toBe(false);
  });
});
