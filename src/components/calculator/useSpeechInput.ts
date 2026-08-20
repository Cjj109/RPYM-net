import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToBase64, blobToWavBase64 } from '../../lib/audio-to-wav';
import { openLiveTranscriber, type LiveTranscriber } from '../../lib/live-transcriber';

/**
 * Dictado para la anotación rápida.
 *
 * 1. Grabar y transcribir en el servidor. Es el camino normal. El servidor
 *    sesga el reconocimiento con los nombres reales de clientes y productos,
 *    que es lo único que hace acertar "Delcy" o "Camaron Vivito", y aguanta
 *    mucho mejor el ruido del mercado.
 * 2. Reconocimiento nativo del navegador (SpeechRecognition), solo si no se
 *    puede grabar (micrófono denegado o sin MediaRecorder).
 *
 * El nativo era el camino principal y se degradó a respaldo tras probarlo en
 * uso real: no conoce el vocabulario del negocio, falla con ruido, y al mostrar
 * resultados parciales reescribe las palabras mientras uno habla, que se ve
 * como si se equivocara. Grabar entero y transcribir de una vez da un texto
 * estable y correcto a cambio de unos segundos de espera.
 */

export type SpeechState = 'idle' | 'listening' | 'transcribing' | 'unsupported';

/** Silencio tras el cual se da por terminado el dictado. Generoso a propósito:
 *  al enumerar productos uno hace pausas de un segundo largo pensando el
 *  siguiente, y cortar ahí parte la frase por la mitad. */
const SILENCE_MS = 3000;
/** Piso mínimo de voz. En sitios ruidosos el umbral real se calcula sobre el
 *  ruido ambiente medido, no sobre este valor. */
const SILENCE_FLOOR = 8;
/** Cuánto debe superar la voz al ruido de fondo para contar como habla */
const VOICE_OVER_NOISE = 1.7;
/** Cuánto basta para dar por sostenida una voz ya empezada (histéresis) */
const SUSTAIN_OVER_NOISE = 1.25;
/** Corte duro para que una grabación olvidada no crezca sin límite */
const MAX_RECORDING_MS = 60000;

interface UseSpeechInputOptions {
  /** Texto parcial mientras se dicta (solo camino nativo) */
  onInterim?: (text: string) => void;
  /** Texto final listo para procesar */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}

export function useSpeechInput({ onInterim, onFinal, onError }: UseSpeechInputOptions) {
  const [state, setState] = useState<SpeechState>('idle');
  /** true mientras se graba (camino normal); false si corrió el nativo */
  const [isRecording, setIsRecording] = useState(false);
  /** Nivel de voz 0-1 para el medidor. Se actualiza ~8 veces por segundo, no
   *  por frame, para no re-renderizar el panel 60 veces por segundo. */
  const [level, setLevel] = useState(0);
  const lastLevelPushRef = useRef(0);
  /** true cuando el audio está viajando en vivo: la espera al final es mínima */
  const [isLive, setIsLive] = useState(false);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveRef = useRef<LiveTranscriber | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  /** true cuando ya no tiene sentido usar la vía en vivo en esta grabación */
  const liveDescartadoRef = useRef(false);
  /** Voz presente en este instante. `hablo` recuerda que YA hubo voz; esta
   *  refleja el momento actual, que es lo que decide si se transmite. */
  const vozDetectadaRef = useRef(false);
  const finalTextRef = useRef('');
  /** Evita que onFinal se dispare dos veces (p.ej. silencio + onend del navegador) */
  const settledRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }, []);

  const releaseMic = useCallback(() => {
    try { workletRef.current?.port.postMessage('stop'); } catch { /* ya cerrado */ }
    try { workletRef.current?.disconnect(); } catch { /* ya desconectado */ }
    workletRef.current = null;
    liveDescartadoRef.current = true;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  // Si el componente se desmonta mientras escucha, hay que soltar el micrófono
  // o el indicador del navegador se queda encendido.
  useEffect(() => {
    return () => {
      clearTimers();
      try { recognitionRef.current?.abort(); } catch { /* ya estaba detenido */ }
      try { mediaRecorderRef.current?.stop(); } catch { /* ya estaba detenido */ }
      liveDescartadoRef.current = true;
      liveRef.current?.close();
      liveRef.current = null;
      releaseMic();
    };
  }, [clearTimers, releaseMic]);

  // ─── Camino 2: grabar y transcribir en el servidor ────────────────────

  const startRecording = useCallback(async () => {
    setIsRecording(true);
    setIsLive(false);
    vozDetectadaRef.current = false;
    liveDescartadoRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // El DSP del navegador es lo que salva la grabación en un sitio
          // ruidoso; sin esto el modelo transcribe el mercado junto con la voz.
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        clearTimers();
        releaseMic();
        setLevel(0);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        chunksRef.current = [];

        if (blob.size < 1000) { // ruido o toque accidental
          setState('idle');
          return;
        }

        setState('transcribing');
        try {
          // Camino en vivo: el audio ya viajó mientras se hablaba, así que solo
          // falta cerrar el turno y recoger el texto. Si el socket se rompió o
          // vuelve vacío, se cae al envío por lotes con lo que se grabó.
          const live = liveRef.current;
          liveRef.current = null;
          if (live) {
            let texto = '';
            const t0 = performance.now();
            try {
              texto = await live.finish();
            } catch {
              texto = '';
            }
            console.log(`[dictado] cierre de turno en vivo: ${Math.round(performance.now() - t0)}ms`);
            if (texto) {
              onFinal(texto);
              setState('idle');
              return;
            }
            console.warn('[dictado] La vía en vivo no devolvió texto, se reintenta por lotes');
          }

          // Se manda el audio comprimido tal cual lo grabó el navegador: OpenAI
          // acepta webm y mp4, así que convertir a WAV solo agregaba trabajo de
          // CPU y multiplicaba por ~8 los bytes a subir. El WAV se arma solo si
          // hace falta caer a Gemini, que sí exige un formato de su lista.
          const enviar = async (audioBase64: string, mimeType: string) => {
            const res = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ audioBase64, mimeType }),
            });
            return res.json();
          };

          let data = await enviar(await blobToBase64(blob), blob.type || recorder.mimeType);

          if (data?.needsWav) {
            data = await enviar(await blobToWavBase64(blob), 'audio/wav');
          }

          if (data.success && data.text?.trim()) {
            onFinal(data.text.trim());
          } else if (!data.success) {
            onError?.(data.error || 'No se pudo transcribir');
          }
        } catch {
          onError?.('Error al transcribir el audio');
        } finally {
          setState('idle');
        }
      };

      // Detección de silencio sobre el nivel del micrófono
      // 24 kHz es la tasa que exige la transcripción en vivo. Pedirla al crear
      // el contexto evita tener que remuestrear a mano, y al medidor de nivel
      // le da igual la tasa.
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx({ sampleRate: 24000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      // El audio se transmite mientras se habla, pero abrir el socket toma unos
      // cientos de milisegundos. Grabar se empieza YA y el PCM se guarda hasta
      // que el socket esté listo: si se esperara, se perderían las primeras
      // palabras, que suelen ser el nombre del cliente.
      // La grabación local sigue corriendo en paralelo pase lo que pase: es lo
      // que salva la nota si la señal se cae a mitad de frase.
      const pendientes: Int16Array[] = [];
      let muestrasPendientes = 0;
      const MAX_PENDIENTES = 24000 * 12; // 12s: si no abrió para entonces, no abre

      try {
        await ctx.audioWorklet.addModule('/pcm-worklet.js');
        const worklet = new AudioWorkletNode(ctx, 'pcm-processor');
        // Reserva corta de audio previo. Transmitir el silencio anterior a que
        // el usuario hable es banda desperdiciada —PCM crudo son ~48KB/s— pero
        // arrancar justo al detectar voz corta el primer fonema. Se guardan los
        // últimos ~350ms y se sueltan de golpe cuando empieza la voz.
        const reserva: Int16Array[] = [];
        const MAX_RESERVA = 4; // 4 bloques de 2048 muestras ≈ 340ms

        worklet.port.onmessage = (e) => {
          const pcm = e.data as Int16Array;
          const live = liveRef.current;

          if (live && !live.broken) {
            if (vozDetectadaRef.current) {
              while (reserva.length) live.sendPcm(reserva.shift()!);
              live.sendPcm(pcm);
            } else {
              reserva.push(pcm);
              if (reserva.length > MAX_RESERVA) reserva.shift();
            }
            return;
          }

          if (!liveDescartadoRef.current && muestrasPendientes < MAX_PENDIENTES) {
            pendientes.push(pcm);
            muestrasPendientes += pcm.length;
          }
        };
        source.connect(worklet);
        workletRef.current = worklet;

        // Abrir el socket en paralelo, sin bloquear la grabación
        openLiveTranscriber().then((live) => {
          if (!live) { liveDescartadoRef.current = true; pendientes.length = 0; return; }
          if (liveDescartadoRef.current || !audioCtxRef.current) { live.close(); return; }
          liveRef.current = live;
          setIsLive(true);
          for (const bloque of pendientes) live.sendPcm(bloque);
          pendientes.length = 0;
        }).catch(() => { liveDescartadoRef.current = true; pendientes.length = 0; });
      } catch (e) {
        // Sin captura cruda no hay vía en vivo, pero la grabación ya está en
        // marcha, así que simplemente se sigue por el camino por lotes.
        console.warn('[dictado] AudioWorklet no disponible, se usa el flujo por lotes:', e);
        liveDescartadoRef.current = true;
      }
      const data = new Uint8Array(analyser.frequencyBinCount);
      let hablo = false;

      // Detección de voz por energía, con el piso de ruido rastreado de forma
      // continua en vez de calibrado al inicio.
      //
      // La primera versión medía el ambiente en el primer medio segundo, y si
      // el usuario empezaba a hablar de una tomaba su propia voz como "ruido":
      // el umbral quedaba altísimo y la primera pausa natural (antes de decir
      // el siguiente producto) se leía como silencio y cortaba a mitad de frase.
      //
      // Ahora el piso baja rápido cuando hay calma y sube muy lento, así la voz
      // nunca lo arrastra hacia arriba. Además hay histéresis: cuesta más
      // empezar a considerar que hablás que dejar de considerarlo, para no
      // cortar en las pausas cortas de una enumeración.
      let pisoRuido = -1;
      const tick = () => {
        if (!audioCtxRef.current) return;
        analyser.getByteFrequencyData(data);
        const nivel = data.reduce((a, b) => a + b, 0) / data.length;

        if (pisoRuido < 0) {
          pisoRuido = nivel;
        } else if (nivel < pisoRuido) {
          pisoRuido = pisoRuido * 0.7 + nivel * 0.3;   // baja rápido
        } else {
          pisoRuido = pisoRuido * 0.999 + nivel * 0.001; // sube casi nada
        }

        const base = Math.max(pisoRuido, 1);
        const umbralVoz = Math.max(SILENCE_FLOOR, base * VOICE_OVER_NOISE);
        // Para SEGUIR hablando basta con menos: evita cortar entre palabras.
        const umbralSostener = Math.max(SILENCE_FLOOR * 0.6, base * SUSTAIN_OVER_NOISE);

        const ahora = performance.now();
        if (ahora - lastLevelPushRef.current > 125) {
          lastLevelPushRef.current = ahora;
          // Se muestra cuánto supera la voz al piso de ruido, no el volumen
          // crudo: así el medidor no queda pegado arriba por el ruido del local.
          setLevel(Math.min(1, Math.max(0, (nivel - base) / (base * 2 + 12))));
        }

        vozDetectadaRef.current = nivel > (hablo ? umbralSostener : umbralVoz);

        if (vozDetectadaRef.current) {
          hablo = true;
          if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        } else if (hablo && !silenceTimerRef.current) {
          // Solo se corta por silencio si antes hubo voz, para no cerrar
          // mientras el usuario todavía no empieza a hablar.
          silenceTimerRef.current = window.setTimeout(() => {
            try { recorder.stop(); } catch { /* ya detenido */ }
          }, SILENCE_MS);
        }
        requestAnimationFrame(tick);
      };

      recorder.start();
      setState('listening');
      requestAnimationFrame(tick);

      maxTimerRef.current = window.setTimeout(() => {
        try { recorder.stop(); } catch { /* ya detenido */ }
      }, MAX_RECORDING_MS);
    } catch {
      setState('idle');
      onError?.('No se pudo acceder al micrófono. Revisa los permisos.');
    }
  }, [clearTimers, releaseMic, onFinal, onError]);

  // ─── Camino 1: reconocimiento nativo ──────────────────────────────────

  const startNative = useCallback(() => {
    setIsRecording(false);
    finalTextRef.current = '';
    settledRef.current = false;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setState('idle');
      onError?.('Este navegador no permite dictar. Escribe la anotación.');
      return;
    }

    const settle = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimers();
      try { recognitionRef.current?.stop(); } catch { /* ya detenido */ }
      setState('idle');
      const texto = finalTextRef.current.trim();
      if (texto) onFinal(texto);
    };

    try {
      const recognition = new SR();
      recognitionRef.current = recognition;
      recognition.lang = 'es-VE';
      // continuous permite dictar una lista completa sin que se corte entre
      // producto y producto; el cierre lo decide el temporizador de silencio.
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalTextRef.current += res[0].transcript;
          else interim += res[0].transcript;
        }
        onInterim?.((finalTextRef.current + interim).trim());

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(settle, SILENCE_MS);
      };

      recognition.onerror = (event: any) => {
        clearTimers();
        // 'not-allowed' y 'service-not-allowed' son el bloqueo de Safari en PWA
        // y también el permiso denegado. En el primer caso el respaldo funciona;
        // en el segundo volverá a pedir permiso, que es lo correcto.
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setState('idle');
          onError?.('Permiso de micrófono denegado.');
          return;
        }
        if (event.error === 'no-speech' || event.error === 'aborted') {
          setState('idle');
          return;
        }
        setState('idle');
        onError?.('No se pudo escuchar. Intenta de nuevo.');
      };

      recognition.onend = settle;

      recognition.start();
      setState('listening');
      maxTimerRef.current = window.setTimeout(settle, MAX_RECORDING_MS);
    } catch {
      setState('idle');
      onError?.('No se pudo iniciar el dictado.');
    }
  }, [clearTimers, onInterim, onFinal, onError]);

  /**
   * Punto de entrada: intenta grabar (camino bueno) y solo cae al
   * reconocimiento nativo si el navegador no da acceso al micrófono.
   */
  const start = useCallback(() => {
    if (state !== 'idle') return;
    settledRef.current = false;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      startNative();
      return;
    }
    startRecording();
  }, [state, startRecording, startNative]);

  /** Corta el dictado y procesa lo que se haya capturado */
  const stop = useCallback(() => {
    clearTimers();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch { /* ya detenido */ }
      return;
    }
    try { recognitionRef.current?.stop(); } catch { /* ya detenido */ }
  }, [clearTimers]);

  /** Cancela sin procesar nada */
  const cancel = useCallback(() => {
    settledRef.current = true;
    finalTextRef.current = '';
    liveDescartadoRef.current = true;
    liveRef.current?.close();
    liveRef.current = null;
    clearTimers();
    try { recognitionRef.current?.abort(); } catch { /* ya detenido */ }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      chunksRef.current = [];
      try { mediaRecorderRef.current.stop(); } catch { /* ya detenido */ }
    }
    releaseMic();
    setState('idle');
  }, [clearTimers, releaseMic]);

  return { state, isRecording, isLive, level, start, stop, cancel };
}
