// Imagens do Foundry guardadas na API por hash (FDD-71). O draft não leva a
// imagem nem uma URL do Foundry: leva `img:<sha256>`, e o site monta a URL da
// API a partir do hash. Cada imagem sobe uma vez só (a API diz quais faltam).
import { encodeImage, ICON_MAX_SIDE, PORTRAIT_MAX_SIDE, isGenericPortrait } from './portrait.js';

const REF_PREFIX = 'img:';
const REF_RE = /^img:([0-9a-f]{64})$/;
// A API aceita até 40 imagens por requisição, num corpo JSON de até 2 MB.
const UPLOAD_BATCH_IMAGES = 20;
const UPLOAD_BATCH_BYTES = 1_000_000;
const CHECK_BATCH = 500;
// Depois de uma falha (API antiga/fora do ar), não insiste a cada save.
const RETRY_AFTER_MS = 60_000;

export const imageRef = (hash) => `${REF_PREFIX}${hash}`;
export const isImageRef = (value) => typeof value === 'string' && REF_RE.test(value);

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('crypto.subtle indisponível (o Foundry precisa estar em localhost ou https).');
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

export class ImageStore {
  constructor(apiClient, { encode = encodeImage, now = () => Date.now() } = {}) {
    this.apiClient = apiClient;
    this.encode = encode;
    this.now = now;
    // caminho do Foundry -> referência; e o inverso, pra volta draft -> Ator.
    this.refs = new Map();
    this.paths = new Map();
    this.failedAt = new Map();
  }

  /** Referência já pronta pro caminho, ou undefined (o chamador usa o caminho). */
  get(path) {
    return this.refs.get(path);
  }

  /** Caminho do Foundry de uma referência gerada nesta sessão. */
  pathOf(ref) {
    return this.paths.get(ref);
  }

  /**
   * Garante que cada caminho tenha imagem na API. `portraits` são os caminhos
   * que ficam maiores (retrato). Nunca lança: o que falhar fica sem referência.
   */
  async ensure(paths, portraits = new Set()) {
    const todo = [...new Set(paths)].filter(
      (path) =>
        path &&
        !this.refs.has(path) &&
        !isGenericPortrait(path) &&
        !isImageRef(path) &&
        this.now() - (this.failedAt.get(path) ?? -Infinity) > RETRY_AFTER_MS,
    );
    if (todo.length === 0) return;

    const prepared = [];
    for (const path of todo) {
      try {
        const side = portraits.has(path) ? PORTRAIT_MAX_SIDE : ICON_MAX_SIDE;
        const dataUrl = await this.encode(path, { maxSide: side });
        if (!dataUrl) throw new Error('sem imagem utilizável');
        const bytes = dataUrlToBytes(dataUrl);
        prepared.push({
          path,
          mime: 'image/webp',
          data: dataUrl.slice(dataUrl.indexOf(',') + 1),
          hash: await sha256Hex(bytes),
        });
      } catch {
        this.failedAt.set(path, this.now());
      }
    }
    if (prepared.length === 0) return;

    try {
      const byHash = new Map(prepared.map((image) => [image.hash, image]));
      const missing = new Set();
      for (const hashes of chunk([...byHash.keys()], CHECK_BATCH)) {
        for (const hash of await this.apiClient.missingImages(hashes)) missing.add(hash);
      }
      await this.upload([...missing].map((hash) => byHash.get(hash)));
      for (const image of prepared) {
        const ref = imageRef(image.hash);
        this.refs.set(image.path, ref);
        if (!this.paths.has(ref)) this.paths.set(ref, image.path);
      }
    } catch (error) {
      // API antiga (sem /api/images), fora do ar ou chave inválida: segue com o
      // caminho; tenta de novo em 1 minuto.
      console.warn(
        'Arthinfo Fichas | Imagens não enviadas à API; a ficha usa o caminho do Foundry por enquanto:',
        error?.message ?? error,
      );
      for (const image of prepared) this.failedAt.set(image.path, this.now());
    }
  }

  async upload(images) {
    let batch = [];
    let batchBytes = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      await this.apiClient.uploadImages(batch.map(({ hash, mime, data }) => ({ hash, mime, data })));
      batch = [];
      batchBytes = 0;
    };
    for (const image of images) {
      if (batch.length >= UPLOAD_BATCH_IMAGES || batchBytes + image.data.length > UPLOAD_BATCH_BYTES) await flush();
      batch.push(image);
      batchBytes += image.data.length;
    }
    await flush();
  }
}
