/**
 * Conversión de audio grabado a WAV mono 16 kHz.
 *
 * MediaRecorder produce webm/opus en Android y mp4/aac en iOS, y Gemini no
 * acepta ninguno de los dos: su lista es wav, mp3, aiff, aac, ogg y flac.
 * En vez de pelear con el formato de cada navegador se decodifica lo grabado
 * con Web Audio (que sí entiende ambos) y se re-arma un WAV, que es el único
 * formato que funciona igual en todos lados.
 *
 * 16 kHz mono es lo que usan los modelos de voz; más resolución solo engorda
 * el archivo sin mejorar la transcripción.
 */

const TARGET_SAMPLE_RATE = 16000;

/** Mezcla todos los canales a uno solo promediándolos */
function toMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0);

  const mono = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= numberOfChannels;
  return mono;
}

/** Remuestreo lineal simple: suficiente para voz, sin dependencias */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

/** Empaqueta muestras float en un WAV PCM 16-bit */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);        // tamaño del bloque fmt
  view.setUint16(20, 1, true);         // PCM sin comprimir
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true);         // alineación de bloque
  view.setUint16(34, 16, true);        // bits por muestra
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

/** Convierte un ArrayBuffer a base64 sin reventar el stack con archivos grandes */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Convierte lo grabado por MediaRecorder en WAV mono 16 kHz codificado en base64,
 * listo para mandar a la API de transcripción.
 */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const mono = toMono(decoded);
    const resampled = resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return toBase64(encodeWav(resampled, TARGET_SAMPLE_RATE));
  } finally {
    // Safari deja el contexto abierto y agota los disponibles tras varias grabaciones
    ctx.close().catch(() => {});
  }
}
