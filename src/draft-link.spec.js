import { describe, expect, it } from 'vitest';
import {
  actorsSharingDraftId,
  inheritedDraftId,
  keepOldestActor,
  shouldStripInheritedDraftId,
  stripInheritedDraftFlagSource,
} from './draft-link.js';

function makeActor(id, draftId, createdTime = 0) {
  return {
    id,
    _stats: { createdTime },
    getFlag: (scope, key) => (scope === 'arthinfo-fichas-sync' && key === 'draftId' ? draftId : undefined),
  };
}

describe('inheritedDraftId', () => {
  it('lê o flag do documento e cai nos dados crus da criação', () => {
    expect(inheritedDraftId(makeActor('a1', 'draft-1'), {})).toBe('draft-1');
    expect(
      inheritedDraftId(
        { getFlag: () => undefined },
        { flags: { 'arthinfo-fichas-sync': { draftId: 'draft-9' } } },
      ),
    ).toBe('draft-9');
  });
});

describe('shouldStripInheritedDraftId (FDD-25)', () => {
  it('tira o draftId só quando outro Ator já está vinculado à mesma ficha', () => {
    const actors = [makeActor('original', 'draft-1'), makeActor('copy', 'draft-1')];
    expect(shouldStripInheritedDraftId(actors, 'draft-1', 'copy')).toBe(true);
    expect(shouldStripInheritedDraftId(actors, 'draft-1', 'original')).toBe(true);
    expect(shouldStripInheritedDraftId(actors, 'draft-2', 'copy')).toBe(false);
    expect(shouldStripInheritedDraftId(actors, undefined, 'copy')).toBe(false);
  });
});

describe('actorsSharingDraftId / keepOldestActor', () => {
  it('agrupa duplicatas e mantém o Ator mais antigo', () => {
    const original = makeActor('a1', 'draft-1', 10);
    const copy = makeActor('a2', 'draft-1', 99);
    const other = makeActor('a3', 'draft-2', 1);
    const groups = actorsSharingDraftId([original, copy, other]);
    expect(groups).toHaveLength(1);
    const [keep, ...rest] = keepOldestActor(groups[0]);
    expect(keep.id).toBe('a1');
    expect(rest.map((actor) => actor.id)).toEqual(['a2']);
  });
});

describe('compatibilidade com o id antigo do módulo (runarcana-sync)', () => {
  // Ator de um mundo que ainda tem o vínculo gravado no escopo legado. O getFlag
  // do Foundry lança erro nesse escopo (módulo inativo), então só vale o dado cru.
  function makeLegacyActor(id, draftId, createdTime = 0) {
    return {
      id,
      _stats: { createdTime },
      flags: { 'runarcana-sync': { draftId } },
      getFlag: (scope) => {
        if (scope === 'runarcana-sync') throw new Error('escopo inativo');
        return undefined;
      },
    };
  }

  it('enxerga o vínculo legado ao herdar e ao agrupar duplicatas', () => {
    expect(inheritedDraftId(makeLegacyActor('a1', 'draft-1'), {})).toBe('draft-1');
    expect(inheritedDraftId({ getFlag: () => undefined }, { flags: { 'runarcana-sync': { draftId: 'draft-7' } } })).toBe('draft-7');
    const groups = actorsSharingDraftId([makeLegacyActor('a1', 'draft-1', 1), makeLegacyActor('a2', 'draft-1', 2)]);
    expect(groups).toHaveLength(1);
  });

  it('o update que remove o vínculo herdado limpa os dois escopos', () => {
    expect(stripInheritedDraftFlagSource()).toEqual({
      'flags.arthinfo-fichas-sync.-=draftId': null,
      'flags.runarcana-sync.-=draftId': null,
    });
  });
});
