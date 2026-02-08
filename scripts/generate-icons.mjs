/**
 * Script para generar íconos PWA desde favicon.svg
 *
 * Uso: node scripts/generate-icons.mjs
 *
 * Requiere: npm install sharp
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = join(rootDir, 'public', 'favicon.svg');
const outputDir = join(rootDir, 'public', 'icons');

async function generateIcons() {
  console.log('Generando íconos PWA...');

  // Crear directorio si no existe
  await mkdir(outputDir, { recursive: true });

  for (const size of sizes) {
    const outputPath = join(outputDir, `icon-${size}x${size}.png`);

    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`✓ Generado: icon-${size}x${size}.png`);
  }

  // Generar apple-touch-icon (180x180)
  await sharp(inputSvg)
    .resize(180, 180)
    .png()
    .toFile(join(outputDir, 'apple-touch-icon.png'));
  console.log('✓ Generado: apple-touch-icon.png');

  // Generar favicon-32x32
  await sharp(inputSvg)
    .resize(32, 32)
    .png()
    .toFile(join(outputDir, 'favicon-32x32.png'));
  console.log('✓ Generado: favicon-32x32.png');

  // Generar favicon-16x16
  await sharp(inputSvg)
    .resize(16, 16)
    .png()
    .toFile(join(outputDir, 'favicon-16x16.png'));
  console.log('✓ Generado: favicon-16x16.png');

  console.log('\n¡Todos los íconos generados exitosamente!');
}

generateIcons().catch(console.error);
