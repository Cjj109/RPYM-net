/**
 * Transcripción en vivo contra OpenAI por WebSocket.
 *
 * El audio viaja mientras el usuario habla, así que al callar la transcripción
 * ya está casi lista: solo falta procesar la cola. Eso es lo que quita la espera
 * de varios segundos del flujo por lotes.
 *
 * A propósito NO se exponen los resultados parciales. Llegan y se acumulan, pero
 * solo como red de seguridad por si el evento final se demora. Mostrarlos haría
 * que las palabras se reescriban solas mientras uno habla, que es justo lo que
 * hacía molesto al reconocimiento nativo del navegador.
 *
 * Quien llama debe tratar el fallo como algo normal: en el mercado la señal se
 * cae, y para eso existe la grabación local en paralelo.
 */

/** Cuánto se espera el evento final ANTES de conformarse con los parciales.
 *  Corto a propósito: con turn_detection en null los parciales van llegando
 *  mientras se habla, así que al cerrar el turno el texto ya suele estar
 *  completo y esperar el evento final solo agrega demora. */
const ESPERA_FINAL_MS = 700;
/** Si no hubo ningún parcial, sí vale la pena esperar más: no hay con qué
 *  responder todavía. */
const ESPERA_SIN_PARCIALES_MS = 5000;
/** Margen para abrir el socket antes de darlo por perdido */
const ESPERA_APERTURA_MS = 6000;

export interface LiveTranscriber {
  /** Envía un bloque de PCM16 a 24 kHz */
  sendPcm(pcm: Int16Array): void;
  /** Cierra el turno y espera la transcripción final */
  finish(): Promise<string>;
  /** Corta todo sin esperar nada */
  close(): void;
  /** true si el socket murió: hay que caer al respaldo */
  readonly broken: boolean;
}

/** PCM16 a base64, por bloques para no reventar el stack */
function pcmABase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const CHUNK = 0x8000;
  let binario = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binario += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binario);
}

/**
 * Pide el token efímero, abre el socket y lo deja listo para recibir audio.
 * Devuelve null si algo falla; nunca lanza.
 */
export async function openLiveTranscriber(): Promise<LiveTranscriber | null> {
  let token: string;
  let model: string;
  try {
    const res = await fetch('/api/realtime-token', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!data?.success || !data.token) return null;
    token = data.token;
    model = data.model;
  } catch {
    return null;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      ['realtime', `openai-insecure-api-key.${token}`]
    );
  } catch {
    return null;
  }

  let roto = false;
  let acumulado = '';
  let final: string | null = null;
  let avisarFinal: (() => void) | null = null;

  const abierto = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), ESPERA_APERTURA_MS);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(true); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); resolve(false); }, { once: true });
    ws.addEventListener('close', () => { clearTimeout(t); resolve(false); }, { once: true });
  });

  if (!abierto) {
    try { ws.close(); } catch { /* ya cerrado */ }
    return null;
  }

  ws.addEventListener('close', () => {
    roto = true;
    avisarFinal?.();
  });
  ws.addEventListener('error', () => {
    roto = true;
    avisarFinal?.();
  });

  ws.addEventListener('message', (event) => {
    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'conversation.item.input_audio_transcription.delta':
        if (msg.delta) acumulado += msg.delta;
        break;
      case 'conversation.item.input_audio_transcription.completed':
        // Puede haber varios turnos: se van concatenando
        final = ((final ?? '') + ' ' + (msg.transcript || '')).trim();
        avisarFinal?.();
        break;
      case 'error':
        console.error('[live-transcriber] Error de OpenAI:', msg.error?.message || msg);
        roto = true;
        avisarFinal?.();
        break;
    }
  });

  return {
    get broken() { return roto; },

    sendPcm(pcm: Int16Array) {
      if (roto || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: pcmABase64(pcm),
        }));
      } catch {
        roto = true;
      }
    },

    async finish(): Promise<string> {
      if (roto || ws.readyState !== WebSocket.OPEN) {
        return (final ?? acumulado).trim();
      }

      try {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } catch {
        roto = true;
        return (final ?? acumulado).trim();
      }

      const espera = acumulado.trim() ? ESPERA_FINAL_MS : ESPERA_SIN_PARCIALES_MS;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, espera);
        avisarFinal = () => { clearTimeout(t); resolve(); };
        if (final !== null || roto) { clearTimeout(t); resolve(); }
      });
      avisarFinal = null;

      try { ws.close(); } catch { /* ya cerrado */ }
      // Los parciales son el respaldo si el final nunca llegó
      return (final ?? acumulado).trim();
    },

    close() {
      avisarFinal = null;
      try { ws.close(); } catch { /* ya cerrado */ }
    },
  };
}
