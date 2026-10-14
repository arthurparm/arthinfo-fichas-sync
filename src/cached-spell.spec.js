import { describe, expect, it } from 'vitest';
import { isCachedSpell } from './cached-spell.js';

describe('isCachedSpell (FDD-117)', () => {
  it('reconhece a magia em cache do dnd5e pela flag cachedFor', () => {
    expect(isCachedSpell({ flags: { dnd5e: { cachedFor: '.Item.abc.Activity.def' } } })).toBe(true);
  });

  it('item comum, sem flags ou nulo não é cache', () => {
    expect(isCachedSpell({ flags: { dnd5e: {} } })).toBe(false);
    expect(isCachedSpell({ flags: {} })).toBe(false);
    expect(isCachedSpell({})).toBe(false);
    expect(isCachedSpell(null)).toBe(false);
  });
});
