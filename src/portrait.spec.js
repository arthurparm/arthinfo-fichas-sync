import { describe, expect, it, vi } from 'vitest';
import { PORTRAIT_MAX_CHARS, encodeImage, encodePortrait, fitWithin, isGenericPortrait } from './portrait.js';
import { SyncManager } from './sync-manager.js';

function fakeDoc(dataUrl, { onCanvas, ctxs = [] } = {}) {
  return {
    createElement: () => {
      const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
      ctxs.push(ctx);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: (type, quality) => {
          onCanvas?.(canvas, type, quality);
          return typeof dataUrl === 'function' ? dataUrl(canvas) : dataUrl;
        },
      };
      return canvas;
    },
  };
}

const load = (width, height) => async () => ({ naturalWidth: width, naturalHeight: height });

describe('SVG ganha fundo escuro (FDD-154)', () => {
  it('pinta o fundo antes de desenhar SVG, e não para outros formatos', async () => {
    const ctxs = [];
    const doc = fakeDoc('data:image/webp;base64,AAAA', { ctxs });
    await encodeImage('systems/dnd5e/icons/svg/items/spell.svg', { doc, load: load(64, 64) });
    expect(ctxs[0].fillRect).toHaveBeenCalledWith(0, 0, 64, 64);
    expect(ctxs[0].fillStyle).toBe('#1c1915');
    const png = [];
    await encodeImage('icons/x.png', { doc: fakeDoc('data:image/webp;base64,AAAA', { ctxs: png }), load: load(64, 64) });
    expect(png[0].fillRect).not.toHaveBeenCalled();
  });

  it('query string não esconde a silhueta do ator', () => {
    expect(isGenericPortrait('systems/dnd5e/icons/svg/actors/character.svg?v=1')).toBe(true);
  });
});

describe('retrato embutido na ficha (FDD-71)', () => {
  it('arte padrão do Foundry não vira retrato', () => {
    expect(isGenericPortrait('icons/svg/mystery-man.svg')).toBe(true);
    expect(isGenericPortrait('icons/svg/item-bag.svg')).toBe(true);
    expect(isGenericPortrait('systems/dnd5e/icons/svg/actors/character.svg')).toBe(true);
    expect(isGenericPortrait('systems/dnd5e/icons/svg/actors/npc.svg')).toBe(true);
    expect(isGenericPortrait('systems/dnd5e/icons/svg/items/spell.svg')).toBe(false);
    expect(isGenericPortrait('')).toBe(true);
    expect(isGenericPortrait('worlds/mundo/tokens/lucas.webp')).toBe(false);
  });

  it('reduz mantendo a proporção e não amplia imagem pequena', () => {
    expect(fitWithin(1024, 512, 256)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
  });

  it('devolve um data URL reduzido, sem nenhuma referência ao Foundry', async () => {
    let size;
    const url = await encodePortrait('worlds/mundo/lucas.png', {
      doc: fakeDoc('data:image/webp;base64,AAAA', { onCanvas: (c) => (size = [c.width, c.height]) }),
      load: load(2048, 1024),
    });
    expect(url).toBe('data:image/webp;base64,AAAA');
    expect(size).toEqual([256, 128]);
    expect(url).not.toMatch(/localhost|https?:/);
  });

  it('imagem pesada demais tenta menor e, se ainda passar do teto, fica sem retrato', async () => {
    const huge = `data:image/webp;base64,${'A'.repeat(PORTRAIT_MAX_CHARS)}`;
    const sizes = [];
    const url = await encodePortrait('worlds/mundo/lucas.png', {
      doc: fakeDoc(huge, { onCanvas: (c) => sizes.push(c.width) }),
      load: load(2000, 2000),
    });
    expect(url).toBe('');
    expect(sizes).toEqual([256, 154]);
  });

  it('falha ao carregar a imagem não derruba o sync: devolve vazio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = await encodePortrait('worlds/mundo/sumiu.png', {
      doc: fakeDoc('data:image/webp;base64,AAAA'),
      load: async () => {
        throw new Error('404');
      },
    });
    expect(url).toBe('');
  });
});

describe('SyncManager — retrato no draft (FDD-71)', () => {
  const baseActor = (img) => ({
    id: 'a1',
    name: 'Lucas',
    img,
    system: { abilities: {}, attributes: { hp: { max: 10, value: 10 } }, skills: {} },
    items: [],
  });

  it('grava o retrato embutido no draft e mantém o que já havia enquanto ele não foi gerado', () => {
    global.foundry = {
      utils: {
        getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o),
        setProperty: (o, p, v) => {
          const keys = p.split('.');
          const last = keys.pop();
          keys.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
        },
      },
    };
    const manager = new SyncManager({});
    const actor = baseActor('worlds/mundo/lucas.png');
    const before = { concept: { portraitUrl: '/assets/antigo.png' } };

    manager._overlayActorOntoDraft(actor, before);
    expect(before.concept.portraitUrl).toBe('/assets/antigo.png');

    manager.portraits.set('a1', { img: 'worlds/mundo/lucas.png', dataUrl: 'data:image/webp;base64,AAAA' });
    const after = { concept: {} };
    manager._overlayActorOntoDraft(actor, after);
    expect(after.concept.portraitUrl).toBe('data:image/webp;base64,AAAA');
  });
});
