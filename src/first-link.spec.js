import { describe, expect, it } from 'vitest';
import { actorIsExistingCharacter, shouldSeedDraftFromActor } from './first-link.js';
import { MODULE_ID } from './module-id.js';

function makeActor({ pending, itemTypes = [] }) {
  return {
    items: { contents: itemTypes.map((type) => ({ type })) },
    getFlag: (scope, key) => (scope === MODULE_ID && key === 'pendingFirstSync' && pending ? true : undefined),
    flags: {},
  };
}

describe('primeiro vínculo (FDD-60)', () => {
  it('Ator com classe é personagem existente', () => {
    expect(actorIsExistingCharacter(makeActor({ itemTypes: ['feat', 'class'] }))).toBe(true);
    expect(actorIsExistingCharacter(makeActor({ itemTypes: ['feat'] }))).toBe(false);
  });

  it('o Ator semeia a ficha só no primeiro sync de um Ator que já é personagem', () => {
    expect(shouldSeedDraftFromActor(makeActor({ pending: true, itemTypes: ['class'] }))).toBe(true);
  });

  it('vínculo antigo (sem flag pendente) segue o fluxo normal', () => {
    expect(shouldSeedDraftFromActor(makeActor({ pending: false, itemTypes: ['class'] }))).toBe(false);
  });

  it('Ator vazio recém-criado a partir da ficha continua recebendo os atributos do site', () => {
    expect(shouldSeedDraftFromActor(makeActor({ pending: true, itemTypes: [] }))).toBe(false);
  });
});
