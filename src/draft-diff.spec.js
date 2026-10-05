import { describe, expect, it } from 'vitest';
import { UNSUPPORTED, applyPatchLocally, buildPatch, deepEqual } from './draft-diff.js';

const base = () => ({
  id: 'd1',
  updatedAt: 't0',
  concept: { name: 'Lyra', heroStatement: 'só do site' },
  derivedStats: { currentHp: 12, maxHp: 12, tempHp: 0 },
  equipment: { armorId: 'cota' },
  conditions: [],
  items: [
    { _id: 'a', name: 'Espada', system: { quantity: 1 } },
    { _id: 'b', name: 'Escudo', system: { quantity: 1 } },
  ],
});

function withChange(change) {
  const after = structuredClone(base());
  change(after);
  return after;
}

describe('buildPatch', () => {
  it('devolve null quando nada mudou', () => {
    expect(buildPatch(base(), base())).toBeNull();
  });

  it('manda só o caminho que mudou, sem tocar em items', () => {
    const patch = buildPatch(base(), withChange((d) => { d.derivedStats.currentHp = 5; }));
    expect(patch).toEqual({ set: { 'derivedStats.currentHp': 5 } });
    expect(patch.lists).toBeUndefined();
  });

  it('não apaga caminho que o overlay não tocou (undefined)', () => {
    const after = withChange((d) => { delete d.derivedStats.tempHp; });
    expect(buildPatch(base(), after)).toBe(UNSUPPORTED); // sumiu da ficha: só o PUT representa
  });

  it('conditions mudou: substitui o array inteiro', () => {
    const patch = buildPatch(base(), withChange((d) => { d.conditions = [{ id: 'prone' }]; }));
    expect(patch).toEqual({ set: { conditions: [{ id: 'prone' }] } });
  });

  it('items: upsert do alterado e do novo, remove do que sumiu, ignora o igual', () => {
    const after = withChange((d) => {
      d.items[0].system.quantity = 2; // a mudou
      d.items.pop(); // b removido
      d.items.push({ _id: 'c', name: 'Corda' }); // c novo
    });
    const patch = buildPatch(base(), after);
    expect(patch.lists.items.upsert.map((i) => i._id)).toEqual(['a', 'c']);
    expect(patch.lists.items.remove).toEqual(['b']);
    expect(patch.set).toBeUndefined();
  });

  it('HP e item no mesmo patch', () => {
    const after = withChange((d) => {
      d.derivedStats.currentHp = 3;
      d.items.push({ _id: 'c', name: 'Corda' });
    });
    const patch = buildPatch(base(), after);
    expect(patch.set).toEqual({ 'derivedStats.currentHp': 3 });
    expect(patch.lists.items.upsert).toEqual([{ _id: 'c', name: 'Corda' }]);
  });

  it('campo fora da allowlist que mudou faz cair no PUT (nada se perde)', () => {
    expect(buildPatch(base(), withChange((d) => { d.equipment.armorId = 'couro'; }))).toBe(UNSUPPORTED);
    const mixed = withChange((d) => {
      d.derivedStats.currentHp = 1;
      d.equipment.armorId = 'couro';
    });
    expect(buildPatch(base(), mixed)).toBe(UNSUPPORTED);
  });

  it('item sem _id ou com _id repetido não é patchável', () => {
    const noId = withChange((d) => { d.items.push({ name: 'sem id' }); });
    expect(buildPatch(base(), noId)).toBe(UNSUPPORTED);
    const dup = withChange((d) => { d.items.push({ _id: 'a', name: 'dup' }); });
    expect(buildPatch(base(), dup)).toBe(UNSUPPORTED);
  });

  it('primeira sincronização de itens (ficha sem items) vira upsert de todos', () => {
    const before = base();
    delete before.items;
    const patch = buildPatch(before, base());
    expect(patch.lists.items.upsert).toHaveLength(2);
    expect(patch.lists.items.remove).toEqual([]);
  });

  it('proficiência de perícia e resistência entram no set', () => {
    const before = { ...base(), proficiencies: { skills: { athletics: false }, savingThrows: { strength: false } } };
    const after = structuredClone(before);
    after.proficiencies.skills.athletics = 'half';
    after.proficiencies.savingThrows.strength = true;
    expect(buildPatch(before, after).set).toEqual({
      'proficiencies.skills.athletics': 'half',
      'proficiencies.savingThrows.strength': true,
    });
  });

  it('aplicar o patch na base reproduz exatamente a ficha pretendida', () => {
    const after = withChange((d) => {
      d.derivedStats.currentHp = 2;
      d.conditions = [{ id: 'poisoned' }];
      d.items[1].name = 'Escudo +1';
    });
    expect(applyPatchLocally(base(), buildPatch(base(), after))).toEqual(after);
  });
});

describe('deepEqual', () => {
  it('compara objetos e arrays por valor e ignora chaves undefined', () => {
    expect(deepEqual({ a: [1, { b: 2 }], c: undefined }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: [1] }, { a: [2] })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});
