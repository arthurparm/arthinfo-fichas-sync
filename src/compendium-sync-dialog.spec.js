import { beforeEach, describe, expect, it } from 'vitest';
import { groupPacksBySource, resolvePackGroup } from './compendium-sync-dialog.js';

function makePack(label, packageType, packageName, extra = {}) {
  return { collection: `${packageName}.${label}`, metadata: { label, packageType, packageName, ...extra } };
}

beforeEach(() => {
  global.game = {
    modules: new Map([
      ['dnd-players-handbook', { title: 'Livro do Jogador' }],
      ['astarions-book-of-hungers', { title: "Astarion's Book of Hungers" }],
    ]),
    system: { title: 'D&D 5th Edition' },
  };
});

describe('resolvePackGroup', () => {
  it('usa o título do módulo quando o pacote é um módulo conhecido', () => {
    expect(resolvePackGroup(makePack('Feats', 'module', 'dnd-players-handbook'))).toEqual({
      id: 'module:dnd-players-handbook',
      label: 'Livro do Jogador',
    });
  });

  it('cai no id do pacote quando o módulo não está instalado/ativo', () => {
    expect(resolvePackGroup(makePack('Itens', 'module', 'modulo-desconhecido'))).toEqual({
      id: 'module:modulo-desconhecido',
      label: 'modulo-desconhecido',
    });
  });

  it('usa o título do sistema ativo para compêndios do sistema', () => {
    expect(resolvePackGroup(makePack('Spells', 'system', 'dnd5e'))).toEqual({
      id: 'system:dnd5e',
      label: 'D&D 5th Edition',
    });
  });

  it('separa o conteúdo SRD (legado) do sistema num grupo próprio', () => {
    expect(resolvePackGroup(makePack('Items (SRD)', 'system', 'dnd5e'))).toEqual({
      id: 'system:dnd5e:srd',
      label: 'D&D 5th Edition (Legacy)',
    });
  });

  it('agrupa compêndios do próprio mundo separadamente', () => {
    expect(resolvePackGroup(makePack('Meu Compêndio', 'world', undefined))).toEqual({
      id: 'world',
      label: 'Compêndios do mundo',
    });
  });
});

describe('groupPacksBySource', () => {
  it('agrupa por pacote de origem e ordena grupos e itens por label (pt-BR)', () => {
    const packs = [
      makePack('Spells', 'system', 'dnd5e'),
      makePack('Feats', 'module', 'dnd-players-handbook'),
      makePack('Equipment', 'module', 'dnd-players-handbook'),
      makePack('Items (SRD)', 'system', 'dnd5e'),
    ];

    const groups = groupPacksBySource(packs);

    expect(groups.map((g) => g.label)).toEqual(['D&D 5th Edition', 'D&D 5th Edition (Legacy)', 'Livro do Jogador']);
    expect(groups[0].packs.map((p) => p.metadata.label)).toEqual(['Spells']);
    expect(groups[1].packs.map((p) => p.metadata.label)).toEqual(['Items (SRD)']);
    expect(groups[2].packs.map((p) => p.metadata.label)).toEqual(['Equipment', 'Feats']);
  });

  it('lida com lista vazia', () => {
    expect(groupPacksBySource([])).toEqual([]);
  });
});
