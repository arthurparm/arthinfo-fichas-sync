// Redução de imagem do Foundry para o site (FDD-71). Um caminho do Foundry
// (worlds/.../foto.png) não existe no site, e a URL absoluta
// (http://localhost:30000/...) só abre pra quem tem aquele Foundry. O módulo lê
// a imagem (mesma origem do Foundry), reduz num canvas e devolve WebP.
// Quem usa: image-store.js (envia pra API e vira referência por hash) e, como
// reserva quando a API não aceita imagens, o retrato embutido na ficha.

export const PORTRAIT_MAX_SIDE = 256;
export const ICON_MAX_SIDE = 128;
export const IMAGE_QUALITY = 0.8;
// Teto do texto gravado no draft quando o retrato vai embutido (reserva).
export const PORTRAIT_MAX_CHARS = 80_000;
// Teto dos bytes de uma imagem enviada à API (ela aceita 128 KB).
export const IMAGE_MAX_BYTES = 96 * 1024;

// Arte padrão do Foundry/dnd5e não identifica ninguém: melhor sem retrato.
export function isGenericPortrait(img) {
  if (!img) return true;
  const path = String(img);
  return path.includes('mystery-man') || path.includes('icons/svg/');
}

export function fitWithin(width, height, max = PORTRAIT_MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function loadImage(src, doc) {
  return new Promise((resolve, reject) => {
    const image = new doc.defaultView.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Não foi possível carregar a imagem ${src}`));
    image.src = src;
  });
}

/**
 * Lê uma imagem do Foundry e devolve um data URL WebP reduzido (lado maior até
 * `maxSide`, com uma segunda tentativa menor se passar de `maxChars`), ou ''
 * quando não dá. Nunca lança: imagem é enfeite e não pode impedir o sync.
 */
export async function encodeImage(
  img,
  { maxSide = ICON_MAX_SIDE, maxChars = Math.ceil((IMAGE_MAX_BYTES * 4) / 3), doc = globalThis.document, load = loadImage } = {},
) {
  if (!img || !doc) return '';
  try {
    const image = await load(String(img), doc);
    const sourceWidth = image.naturalWidth || image.width || maxSide;
    const sourceHeight = image.naturalHeight || image.height || maxSide;
    const attempts = [
      { side: maxSide, quality: IMAGE_QUALITY },
      { side: Math.round(maxSide * 0.6), quality: 0.6 },
    ];
    for (const { side, quality } of attempts) {
      const size = fitWithin(sourceWidth, sourceHeight, side);
      if (!size.width) return '';
      const canvas = doc.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
      const url = canvas.toDataURL('image/webp', quality);
      if (url.startsWith('data:image/webp') && url.length <= maxChars) return url;
    }
    return '';
  } catch (error) {
    console.warn('Arthinfo Fichas | Imagem do Foundry não foi reduzida:', error);
    return '';
  }
}

/** Reserva: retrato embutido na ficha, para quando a API ainda não guarda imagens. */
export async function encodePortrait(img, options = {}) {
  if (isGenericPortrait(img)) return '';
  return encodeImage(img, { maxSide: PORTRAIT_MAX_SIDE, maxChars: PORTRAIT_MAX_CHARS, ...options });
}
