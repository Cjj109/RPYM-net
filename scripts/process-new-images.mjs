import sharp from 'sharp';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');

// Imagenes a procesar
const images = [
  { input: 'delivery.jpeg', name: 'delivery' },
  { input: 'cerrado.png', name: 'cerrado' },
  { input: 'pesca.jpeg', name: 'pesca' },
  { input: 'camaronlogo.jpeg', name: 'camaronlogo' },
  { input: 'camaronchef.jpeg', name: 'camaronchef' },
  { input: 'sanvalentin.png', name: 'sanvalentin' },
  { input: 'carnaval.png', name: 'carnaval' },
  { input: 'image.png', name: 'navidad' },
];

// Tamaños de salida
const sizes = [
  { suffix: '-lg', width: 500 }, // Grande (para hero)
  { suffix: '', width: 400 },    // Tamaño por defecto
  { suffix: '-md', width: 300 }, // Mediano
  { suffix: '-sm', width: 200 }, // Pequeño
];

async function removeWhiteBackground(inputBuffer) {
  // Obtener metadata
  const metadata = await sharp(inputBuffer).metadata();

  // Convertir a raw pixels con alpha
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);

  // Umbral para considerar blanco (0-255)
  const threshold = 240;

  // Recorrer cada pixel (RGBA = 4 bytes)
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Si el pixel es casi blanco, hacerlo transparente
    if (r >= threshold && g >= threshold && b >= threshold) {
      pixels[i + 3] = 0; // Alpha = 0 (transparente)
    }
  }

  // Reconstruir la imagen
  return sharp(Buffer.from(pixels), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function processImage(imageName, inputPath) {
  console.log(`\nProcesando: ${inputPath}`);

  try {
    const inputBuffer = await readFile(inputPath);

    // Remover fondo blanco
    console.log('  Removiendo fondo blanco...');
    const transparentBuffer = await removeWhiteBackground(inputBuffer);

    // Generar cada tamaño
    for (const size of sizes) {
      const outputName = `${imageName}${size.suffix}.webp`;
      const outputPath = join(publicDir, outputName);

      await sharp(transparentBuffer)
        .resize(size.width, null, { fit: 'inside' })
        .webp({ quality: 85 })
        .toFile(outputPath);

      console.log(`  Generado: ${outputName} (${size.width}px)`);
    }

    console.log(`  OK: ${imageName} procesado`);
  } catch (error) {
    console.error(`  ERROR procesando ${imageName}:`, error.message);
  }
}

async function main() {
  console.log('=== Procesando nuevas imagenes ===\n');

  for (const img of images) {
    const inputPath = join(rootDir, img.input);
    await processImage(img.name, inputPath);
  }

  console.log('\n=== Proceso completado ===');
}

main();
