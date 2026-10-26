import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ImageStore, imageRef, isImageRef } from './image-store.js';
import { SyncManager } from './sync-manager.js';

const webpBytes = (seed) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from(seed)]);
const dataUrl = (seed) => `data:image/webp;base64,${webpBytes(seed).toString('base64')}`;
const hashOf = (seed) => createHash('sha256').update(webpBytes(seed)).digest('hex');

function makeStore(apiOverrides = {}) {
  const api = {
    missingImages: vi.fn(async (hashes) => hashes),
    uploadImages: vi.fn(async () => ({ stored: 1, existing: 0 })),
    ...apiOverrides,
  };
  const encode = vi.fn(async (path) => (path.endsWith('falha.png') ? '' : dataUrl(path)));
  return { api, encode, store: new ImageStore(api, { encode, now: () => 1_000_000 }) };
}

describe('ImageStore (FDD-71)', () => {
  it('reconhece só referência img:<sha256>', () => {
    expect(isImageRef(imageRef('a'.repeat(64)))).toBe(true);
    expect(isImageRef('img:abc')).toBe(false);
    expect(isImageRef('/icons/x.webp')).toBe(false);
  });

  it('envia só o que a API não tem e passa a devolver a referência por caminho', async () => {
    const known = hashOf('icons/a.webp');
    const { api, store } = makeStore({ missingImages: vi.fn(async (hashes) => hashes.filter((h) => h !== known)) });
    await store.ensure(['icons/a.webp', 'icons/b.webp']);

    expect(api.uploadImages).toHaveBeenCalledTimes(1);
    const sent = api.uploadImages.mock.calls[0][0];
    expect(sent.map((image) => image.hash)).toEqual([hashOf('icons/b.webp')]);
    expect(sent[0]).toMatchObject({ mime: 'image/webp' });
    expect(store.get('icons/a.webp')).toBe(imageRef(known));
    expect(store.get('icons/b.webp')).toBe(imageRef(hashOf('icons/b.webp')));
    expect(store.pathOf(imageRef(known))).toBe('icons/a.webp');
  });

  it('não refaz nem reenvia o que já tem referência, e ignora arte padrão', async () => {
    const { api, encode, store } = makeStore();
    await store.ensure(['icons/a.webp', 'icons/svg/mystery-man.svg']);
    await store.ensure(['icons/a.webp']);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(api.missingImages).toHaveBeenCalledTimes(1);
  });

  it('imagem que não dá pra reduzir fica sem referência (o chamador usa o caminho)', async () => {
    const { store } = makeStore();
    await store.ensure(['icons/falha.png']);
    expect(store.get('icons/falha.png')).toBeUndefined();
  });

  it('API sem suporte a imagens não derruba nada: sem referência e sem insistir a cada save', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { api, encode, store } = makeStore({ missingImages: vi.fn(async () => { throw new Error('HTTP 404'); }) });
    await store.ensure(['icons/a.webp']);
    expect(store.get('icons/a.webp')).toBeUndefined();
    await store.ensure(['icons/a.webp']);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(api.uploadImages).not.toHaveBeenCalled();
  });

  it('divide o envio em lotes', async () => {
    const { api, store } = makeStore();
    const paths = Array.from({ length: 45 }, (_, i) => `icons/${i}.webp`);
    await store.ensure(paths);
    expect(api.uploadImages.mock.calls.map(([batch]) => batch.length)).toEqual([20, 20, 5]);
  });
});

describe('SyncManager com imagens por hash (FDD-71)', () => {
  const props = {
    getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o),
    setProperty: (o, p, v) => {
      const keys = p.split('.');
      const last = keys.pop();
      keys.reduce((a, k) => (a[k] ??= {}), o)[last] = v;
    },
    deepClone: (v) => JSON.parse(JSON.stringify(v)),
  };

  function actorWith(items, img = 'worlds/m/lucas.png') {
    return {
      id: 'a1',
      name: 'Lucas',
      img,
      system: { abilities: {}, attributes: { hp: { max: 10, value: 10 } }, skills: {} },
      effects: [],
      items: items.map((item) => ({
        ...item,
        getFlag: () => undefined,
        toObject: () => ({ _id: item.id, name: item.name, type: 'feat', img: item.img, system: {}, flags: {} }),
      })),
    };
  }

  it('o draft recebe img:<hash> nos itens e no retrato, nunca o caminho do Foundry', () => {
    global.foundry = { utils: props };
    const manager = new SyncManager({});
    const ref = (p) => imageRef(hashOf(p));
    manager.images.refs.set('icons/espada.webp', ref('icons/espada.webp'));
    manager.images.refs.set('worlds/m/lucas.png', ref('worlds/m/lucas.png'));
    const actor = actorWith([{ id: 'i1', name: 'Espada', img: 'icons/espada.webp' }]);

    const base = { concept: {}, items: [] };
    manager._overlayItemsOntoDraft(actor, base);
    manager._overlayActorOntoDraft(actor, base);

    expect(base.items[0].img).toBe(ref('icons/espada.webp'));
    expect(base.concept.portraitUrl).toBe(ref('worlds/m/lucas.png'));
  });

  it('sem referência (API antiga) cai no caminho como antes', () => {
    global.foundry = { utils: props };
    const manager = new SyncManager({});
    const actor = actorWith([{ id: 'i1', name: 'Espada', img: 'icons/espada.webp' }]);
    const base = { items: [] };
    manager._overlayItemsOntoDraft(actor, base);
    expect(base.items[0].img).toBe('icons/espada.webp');
  });

  it('a referência do site nunca é gravada no Ator: item novo recebe o caminho conhecido, item existente mantém o dele', async () => {
    global.foundry = { utils: props };
    const manager = new SyncManager({});
    const refNovo = imageRef(hashOf('icons/novo.webp'));
    const refVelho = imageRef(hashOf('icons/velho.webp'));
    manager.images.paths.set(refNovo, 'icons/novo.webp');

    const velho = {
      id: 'L1',
      type: 'feat',
      img: 'icons/velho.webp',
      flags: {},
      getFlag: () => 'S-velho',
      toObject: () => ({ _id: 'L1', name: 'Velho', type: 'feat', img: 'icons/velho.webp', system: {}, flags: {} }),
    };
    const actor = {
      id: 'a1',
      system: { abilities: {}, attributes: { hp: { max: 10, value: 10 } }, skills: {} },
      items: { contents: [velho] },
      update: vi.fn(async () => undefined),
      createEmbeddedDocuments: vi.fn(async () => undefined),
      updateEmbeddedDocuments: vi.fn(async () => undefined),
      deleteEmbeddedDocuments: vi.fn(async () => undefined),
    };
    await manager._applyRemoteDraft(actor, {
      items: [
        { _id: 'S-velho', name: 'Velho', type: 'feat', img: refVelho, system: {}, flags: {} },
        { _id: 'S-novo', name: 'Novo', type: 'feat', img: refNovo, system: {} },
      ],
    });

    const [, created] = actor.createEmbeddedDocuments.mock.calls[0];
    expect(created[0].img).toBe('icons/novo.webp');
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
