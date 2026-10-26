// Retrato do Ator para o site (FDD-71). Um caminho do Foundry (worlds/.../foto.png)
// não existe no site, e a URL absoluta (http://localhost:30000/...) só abre pra
// quem tem aquele Foundry. Então o módulo reduz a imagem e grava ela mesma no
// draft, como data URL: o retrato viaja junto com a ficha, sem armazenamento
// novo e sem o site precisar alcançar o Foundry.

export const PORTRAIT_MAX_SIDE = 256;
export const PORTRAIT_QUALITY = 0.8;
// Teto do texto gravado no draft (a API aceita 2 MB por ficha inteira, e o
// retrato viaja em todo evento do stream). Acima disso, tenta menor; se ainda
// passar, fica sem retrato (o site mostra as iniciais).
export const PORTRAIT_MAX_CHARS = 80_000;

// Arte padrão do Foundry/dnd5e não identifica ninguém: melhor sem retrato.
export function isGenericPortrait(img) {
  if (!img) return true;
  const path = String(img);
  return (
    path.includes('mystery-man') ||
    path.includes('icons/svg/') ||
    path.includes('icons/svg/item-bag')
  );
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
    image.onerror = () => reject(new Error(`Não foi possível carregar o retrato ${src}`));
    image.src = src;
  });
}

/**
 * Lê a imagem do Ator (mesma origem do Foundry) e devolve um data URL reduzido,
 * ou '' quando não há retrato utilizável. Nunca lança: retrato é enfeite e não
 * pode impedir o sync da ficha.
 */
export async function encodePortrait(img, { doc = globalThis.document, load = loadImage } = {}) {
  if (isGenericPortrait(img) || !doc) return '';
  try {
    const image = await load(String(img), doc);
    const attempts = [
      { side: PORTRAIT_MAX_SIDE, quality: PORTRAIT_QUALITY },
      { side: 160, quality: 0.6 },
    ];
    for (const { side, quality } of attempts) {
      const size = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height, side);
      if (!size.width) return '';
      const canvas = doc.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
      const url = canvas.toDataURL('image/webp', quality);
      if (url.startsWith('data:image/') && url.length <= PORTRAIT_MAX_CHARS) return url;
    }
    return '';
  } catch (error) {
    console.warn('Arthinfo Fichas | Retrato do Ator não foi embutido na ficha:', error);
    return '';
  }
}
