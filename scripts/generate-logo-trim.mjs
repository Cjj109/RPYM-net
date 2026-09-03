/**
 * Genera public/camaronlogo-trim.webp (logo recortado al contenido) en alta
 * resolucion, partiendo del original camaronlogo.jpeg de 1536x1024.
 *
 * La tarjeta "factura" de la Vista WhatsApp muestra el logo a 280px y se
 * captura con html2canvas a escala 3, asi que se exporta a 1120px de ancho
 * (4x) para que nunca se vea escalado hacia arriba.
 */
import sharp from 'sharp';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = join(rootDir, 'camaronlogo.jpeg');
const OUTPUT = join(rootDir, 'public', 'camaronlogo-trim.webp');
const TARGET_WIDTH = 1120;
const WHITE_THRESHOLD = 240;

/** Vuelve transparente todo pixel casi blanco (mismo criterio que process-new-images.mjs) */
async function removeWhiteBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] >= WHITE_THRESHOLD && pixels[i + 1] >= WHITE_THRESHOLD && pixels[i + 2] >= WHITE_THRESHOLD) {
      pixels[i + 3] = 0;
    }
  }
  return sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const transparent = await removeWhiteBackground(await readFile(INPUT));

// Recortar el lienzo vacio que rodea al logo y dejar un respiro minimo para
// que las letras no queden pegadas al borde de la imagen
const trimmed = await sharp(transparent).trim({ threshold: 1 }).png().toBuffer();
const { width, height } = await sharp(trimmed).metadata();
const pad = Math.round(width * 0.02);
const padded = await sharp(trimmed)
  .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

await sharp(padded)
  .resize(TARGET_WIDTH, null, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(OUTPUT);

const out = await sharp(OUTPUT).metadata();
console.log(`recortado: ${width}x${height} (+${pad}px de margen) -> salida: ${out.width}x${out.height}`);
