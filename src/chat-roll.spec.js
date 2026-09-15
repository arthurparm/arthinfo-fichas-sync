import { beforeEach, describe, expect, it, vi } from 'vitest';
import { facesFrom, flavorFor, formulaFor, postSiteRollToChat } from './chat-roll.js';

describe('flavorFor / formulaFor / facesFrom', () => {
  it('monta o flavor de dano com o nome da magia', () => {
    expect(flavorFor({ kind: 'damage', label: 'Chama Sagrada (dano)' })).toBe(
      'Dano — Chama Sagrada (dano)',
    );
  });

  it('monta o flavor de teste de atributo', () => {
    expect(flavorFor({ kind: 'ability', label: 'Força' })).toBe('Atributo — Força');
  });

  it('monta a fórmula NdX + modificador', () => {
    expect(formulaFor({ diceCount: 2, dieSize: 8, modifier: 4 })).toBe('2d8 + 4');
    expect(formulaFor({ diceCount: 1, dieSize: 12, modifier: 0 })).toBe('1d12');
  });

  it('usa as faces do servidor e não inventa dado quando só tem a soma', () => {
    expect(facesFrom({ dice: [5, 3], diceCount: 2, rawRoll: 8 })).toEqual([5, 3]);
    expect(facesFrom({ diceCount: 2, rawRoll: 8 })).toEqual([]);
    expect(facesFrom({ diceCount: 1, rawRoll: 7 })).toEqual([7]);
  });
});

describe('postSiteRollToChat', () => {
  beforeEach(() => {
    global.game = {
      user: { isGM: true },
      messages: { contents: [] },
    };
    global.ChatMessage = {
      getSpeaker: vi.fn(() => ({ alias: 'Karon' })),
      create: vi.fn(async () => ({})),
    };
    global.foundry = { dice: { terms: {} } };
    global.Roll = undefined;
  });

  it('não publica se o usuário não é GM', async () => {
    game.user.isGM = false;
    await postSiteRollToChat({ name: 'Karon' }, { id: 'roll-1', kind: 'damage', total: 7 });
    expect(ChatMessage.create).not.toHaveBeenCalled();
  });

  it('não republica a mesma rolagem', async () => {
    game.messages.contents = [{ getFlag: () => 'roll-1' }];
    await postSiteRollToChat({ name: 'Karon' }, { id: 'roll-1', kind: 'damage', total: 7 });
    expect(ChatMessage.create).not.toHaveBeenCalled();
  });

  it('publica dano no chat com o total do servidor, sem re-rolar', async () => {
    await postSiteRollToChat(
      { name: 'Karon' },
      {
        id: 'roll-1',
        kind: 'damage',
        label: 'Chama Sagrada (dano)',
        diceCount: 1,
        dieSize: 8,
        modifier: 0,
        rawRoll: 5,
        total: 5,
        dice: [5],
      },
    );

    expect(ChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        flavor: 'Dano — Chama Sagrada (dano)',
        flags: { 'runarcana-sync': { rollId: 'roll-1', kind: 'damage' } },
        content: expect.stringContaining('5'),
      }),
    );
    expect(ChatMessage.create.mock.calls[0][0].content).toContain('1d8');
  });

  it('se toMessage falha ainda publica o HTML no chat', async () => {
    function Die() {}
    function OperatorTerm() {}
    function NumericTerm() {}
    const toMessage = vi.fn(async () => {
      throw new Error('D20 die must be an instance of D20Die');
    });
    global.foundry = { dice: { terms: { Die, OperatorTerm, NumericTerm } } };
    function RollClass() {}
    RollClass.fromTerms = vi.fn(() => ({ toMessage }));
    global.Roll = RollClass;

    await postSiteRollToChat(
      { name: 'Karon' },
      {
        id: 'roll-ability',
        kind: 'ability',
        label: 'Força',
        diceCount: 1,
        dieSize: 20,
        modifier: 5,
        rawRoll: 12,
        total: 17,
        dice: [12],
      },
    );

    expect(toMessage).toHaveBeenCalled();
    expect(ChatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        flavor: 'Atributo — Força',
        flags: { 'runarcana-sync': { rollId: 'roll-ability', kind: 'ability' } },
        content: expect.stringContaining('17'),
      }),
    );
  });
});
