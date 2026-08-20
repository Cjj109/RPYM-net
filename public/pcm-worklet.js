/**
 * AudioWorklet que entrega PCM16 para la transcripción en vivo.
 *
 * Corre en el hilo de audio, así que no se traba aunque la interfaz esté
 * ocupada. El AudioContext ya se crea a 24 kHz —la tasa que pide la API de
 * transcripción en tiempo real— por lo que acá no hay que remuestrear: solo
 * acumular y convertir de float a entero de 16 bits.
 *
 * Se agrupa en bloques de 2048 muestras (~85 ms) en vez de mandar los 128 que
 * entrega cada llamada: menos mensajes entre hilos y menos tramas de WebSocket,
 * sin latencia perceptible.
 */

const TAMANO_BLOQUE = 2048;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(TAMANO_BLOQUE);
    this.escritos = 0;
    this.activo = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.activo = false;
    };
  }

  /** Float [-1,1] a PCM16 little-endian */
  aPcm16(muestras) {
    const salida = new Int16Array(muestras.length);
    for (let i = 0; i < muestras.length; i++) {
      const s = Math.max(-1, Math.min(1, muestras[i]));
      salida[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return salida;
  }

  process(inputs) {
    if (!this.activo) return false;

    const canal = inputs[0]?.[0];
    if (!canal) return true;

    for (let i = 0; i < canal.length; i++) {
      this.buffer[this.escritos++] = canal[i];
      if (this.escritos === TAMANO_BLOQUE) {
        const pcm = this.aPcm16(this.buffer);
        // El buffer se transfiere en vez de copiarse
        this.port.postMessage(pcm, [pcm.buffer]);
        this.escritos = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
